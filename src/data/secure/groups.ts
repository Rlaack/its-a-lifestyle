import Crypto from '../../../modules/lifestyle-crypto';
import { opPlanId, planForSending, planFromSender, type PlanOp } from '../planOps';
import { noteMessage, notePlanOp, noteReaction } from '../notices';
import { actions, getState, onPlanOp } from '../store';
import type { Chat, Message, Plan } from '../types';
import { attFor, incomingMsg, outgoingMsg, type Outgoing } from './attachments';
import { downloadPhoto, isRoundedGeo, mirrorToMyDevices, sendPayload, sendToGroupKey, uploadPhoto, type Attachment, type GroupKeyPayload, type GroupPayload } from './client';

// Encrypted groups: each real neighborhood, and each group chat, is a Signal Sender Key group.
//   - Members are relay account IDs (for a neighborhood, everyone who joined with the invite code).
//   - My Sender Key goes to each member once, inside our 1:1 Signal session. After that, a group
//     message is encrypted once and the same ciphertext is delivered to everyone.
//   - When someone leaves or is removed, I switch to a fresh key (new distribution ID), so they
//     can't read anything sent afterwards.
//   - Plans with a restricted audience ("pick people", "everyone except", a calendar) never use the
//     shared key: each of those messages is encrypted 1:1 to exactly the people invited, so someone
//     left out can't read it even if the server hands it to them. That's what keeps surprise parties
//     secret from the guest of honor.
// Everything here lives in the encrypted vault through the callbacks the sync layer passes in.

export type Group = {
  id: string; kind: 'hood' | 'chat'; name: string;
  hood?: string;            // hood invite code (neighborhood groups)
  members: string[];        // other members' account IDs
  dist: string;             // my current Sender Key distribution ID
  keyed: string[];          // members who have my current key
};

/** What group messages carry (inside the encryption). */
type Body =
  | { t: 'op'; op: PlanOp }                                       // a plan or a change to one
  | { t: 'hello' }                                                 // a new member asking to catch up
  | { t: 'chat'; plan?: string; mid: string; text: string; att?: Attachment; loc?: string } // a plan or group chat message (att: an encrypted photo; loc: a rounded location)
  | { t: 'chat-new'; name: string; custom?: boolean; members: string[] } // a group chat was created
  | { t: 'timer'; plan?: string; value: string }                   // disappearing messages changed for a chat
  | { t: 'rekey' }
  | { t: 'rotate' }                                                 // a member removed a device: everyone switches to a new key
  | { t: 'owner'; secret: string }                                  // the owner secret, to a new co-owner (1:1)
  | { t: 'meta' }
  | { t: 'react'; plan?: string; mid: string; e: string; on: boolean }  // a reaction to a group or plan chat message
  | { t: 'profile'; pic: SharedPic }                              // my picture changed (empty: back to initials)
  | { t: 'report'; about: string; aboutName: string; kind: 'message' | 'plan' | 'picture'; text: string; where: string }; // to owners only                                                  // "the neighborhood's settings or members changed"                                                // "I couldn't read your last group message: send your key again"

/** A picture as it travels: color and emoji, or an encrypted photo's key (never a local file path). */
export type SharedPic = { tone?: string; emoji?: string; att?: { id: string; key: string; digest: string } };

export type OutboxItem = { group: string; body: Body; onlyTo?: string[]; noMirror?: boolean };

type Ctx = {
  me: () => { account: string | null; name: string | null };
  nameOf: (account: string, hoodCode?: string) => string | undefined;
  accountOf: (name: string, hoodCode: string) => string | undefined;
  hoodMembers: (hoodCode: string) => string[];  // accounts, excluding me
  hoodIdOf: (hoodCode: string) => string;       // store id, e.g. r-ABCD-EFGH-JKLM
  save: () => void;
  onOwnerSecret: (hoodCode: string, secret: string) => void;
  onMetaChanged: (hoodCode: string) => Promise<void>;
  onReport: (hoodCode: string, from: string, r: { about: string; aboutName: string; kind: 'message' | 'plan' | 'picture'; text: string; where: string }) => void;
  isBlocked: (account: string) => boolean;
  myPic: () => SharedPic | undefined;
  /** The neighborhood board: copy a change of mine there, or read it again. */
  toBoard: (hoodCode: string, op: PlanOp, plan: Plan, prev?: Plan) => void;
  loadBoard: (hoodCode: string) => void;
  onProfile: (account: string, name: string, pic: SharedPic) => void;
};

let ctx: Ctx | null = null;
let groups: Group[] = [];
let outbox: OutboxItem[] = [];
/** My recently sent group items, per group (kept in memory), so they can be resent to someone who missed my key. */
const recent: Record<string, OutboxItem[]> = {};
const RECENT_MAX = 100;

export const groupState = () => ({ groups, outbox });
export function loadGroupState(saved?: { groups?: Group[]; outbox?: OutboxItem[] }) {
  groups = saved?.groups ?? []; outbox = saved?.outbox ?? [];
}

const uuid = () => { const h = Crypto!.randomId(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
let gidOf: (code: string) => string | undefined = () => undefined;
/** The sync layer supplies a neighborhood's fixed group ID (set when its code first changes). */
export const setHoodGidLookup = (f: (code: string) => string | undefined) => { gidOf = f; };
export const hoodGidFromCode = (code: string) => Crypto!.secretLookup(code).slice(0, 24);
export const hoodGroupId = (code: string) => `h:${gidOf(code) ?? hoodGidFromCode(code)}`;
const fromMe = () => (ctx?.me().name ? { from: { name: ctx.me().name! } } : {});
const findGroup = (id: string) => groups.find(g => g.id === id);

/* ---------- membership ---------- */

/** Keeps a neighborhood's group in step with its member list. Removals rotate my key. */
export function syncHoodGroup(code: string, name: string, members: string[]) {
  const id = hoodGroupId(code);
  let g = findGroup(id);
  if (!g) { g = { id, kind: 'hood', name, hood: code, members, dist: uuid(), keyed: [] }; groups = [...groups, g]; ctx?.save(); return g; }
  const removed = g.members.filter(m => !members.includes(m));
  if (removed.length) dbg('member left', removed.map(x => x.slice(0, 8)), '→ new key for', g.name);
  if (removed.length || members.some(m => !g!.members.includes(m)) || g.name !== name) {
    g = { ...g, name, members, ...(removed.length ? { dist: uuid(), keyed: [] } : {}) };
    groups = groups.map(x => (x.id === id ? g! : x));
    ctx?.save();
  }
  return g;
}

export function dropHoodGroup(code: string) {
  const id = hoodGroupId(code);
  groups = groups.filter(g => g.id !== id);
  ctx?.save();
}

/** Hands my current Sender Key to every member who doesn't have it yet (1:1 encrypted). */
async function ensureKeyed(g: Group) {
  const missing = g.members.filter(m => !g.keyed.includes(m));
  if (!missing.length) return;
  const key = await Crypto!.groupKey(g.dist);
  const payload: GroupKeyPayload = { v: 1, kind: 'gkey', group: g.id, key, ...fromMe() };
  const done: string[] = [];
  for (const m of missing) {
    try { await sendPayload(m, payload); done.push(m); } catch { /* try again next time */ }
  }
  // If my key was replaced while this ran, these people have the old one and still need the new one.
  groups = groups.map(x => (x.id === g.id && x.dist === g.dist ? { ...x, keyed: [...new Set([...x.keyed, ...done])] } : x));
  ctx?.save();
}

/* ---------- sending ---------- */

const dbg = (...a: unknown[]) => { if (__DEV__) console.log('[groups]', ctx?.me().name ?? '?', ...a); };

async function deliver(item: OutboxItem) {
  const g = findGroup(item.group);
  dbg('deliver', (item.body as { t: string }).t, 'group', item.group.slice(0, 10), 'found', !!g, 'members', g?.members.length, 'onlyTo', item.onlyTo?.length);
  if (!g) return;
  const payload: GroupPayload = { v: 1, kind: 'group', group: g.id, id: Crypto!.randomId(), sentAt: Date.now(), body: item.body, ...fromMe() };
  if (!item.noMirror && ['op', 'chat', 'chat-new', 'timer'].includes((item.body as { t: string }).t)) mirrorToMyDevices({ inner: payload });
  if (item.onlyTo) {
    // Restricted audience: 1:1 to each invited person; the shared key is never used.
    for (const to of item.onlyTo.filter(a => a !== ctx?.me().account)) await sendPayload(to, payload);
    return;
  }
  await ensureKeyed(findGroup(g.id)!);
  const fresh = findGroup(g.id)!;
  try { await sendToGroupKey(fresh.dist, fresh.members.filter(m => fresh.keyed.includes(m)), payload); }
  catch (e) {
    if (!String((e as Error)?.message).includes('missing sender key')) throw e;
    // This device has no key for that ID: make a new one and hand it out.
    groups = groups.map(x => (x.id === g.id ? { ...x, dist: uuid(), keyed: [] } : x));
    ctx?.save();
    await ensureKeyed(findGroup(g.id)!);
    const next = findGroup(g.id)!;
    await sendToGroupKey(next.dist, next.members.filter(m => next.keyed.includes(m)), payload);
  }
}

/** Sends now; if that fails (offline), it's kept in the encrypted outbox and retried. */
/** Keeps what I sent, so someone who couldn't read it (a missed key) gets it again. Chat messages are
 *  de-duplicated by their ID on arrival, and plan changes are safe to apply twice. */
function remember(item: OutboxItem) {
  if (!['hello', 'owner', 'meta', 'report', 'rotate', 'profile'].includes((item.body as { t: string }).t)) recent[item.group] = [...(recent[item.group] ?? []), item].slice(-RECENT_MAX);
}

async function send(item: OutboxItem) {
  remember(item);
  try { await deliver(item); }
  catch (e) { dbg('send failed', String(e)); outbox = [...outbox, item]; ctx?.save(); }
}

export async function flushOutbox() {
  if (!outbox.length) return;
  const pending = outbox; outbox = []; ctx?.save();
  for (const item of pending) await send(item);
}

/* ---------- recovering from a missed key ---------- */

const lastRekey: Record<string, number> = {};
/** I couldn't read a group message from `from`: ask them (1:1) to send me their keys again. */
export function requestGroupKey(from: string, force = false) {
  if (!force && Date.now() - (lastRekey[from] ?? 0) < 60_000) return;
  lastRekey[from] = Date.now();
  dbg('asking for keys again from', from.slice(0, 8));
  sendPayload(from, { v: 1, kind: 'group', group: '', id: Crypto!.randomId(), sentAt: Date.now(), body: { t: 'rekey' }, ...fromMe() }).catch(() => {});
}
/** Someone couldn't read my group messages: mark them as not having my keys, so they get them again. */
export async function resendGroupKeys(to: string) {
  groups = groups.map(g => (g.members.includes(to) ? { ...g, keyed: g.keyed.filter(m => m !== to) } : g));
  ctx?.save();
  for (const g of groups.filter(x => x.members.includes(to))) {
    try {
      await ensureKeyed(g);
      // Then whatever they couldn't read: changes are safe to apply twice. Only items they were allowed to see.
      for (const item of recent[g.id] ?? []) {
        if (item.onlyTo && !item.onlyTo.includes(to)) continue;
        await deliver({ ...item, onlyTo: [to], noMirror: true });
      }
    } catch { /* next rekey request will retry */ }
  }
}

/** After restoring a backup: my saved Sender Keys are stale, so every group gets a fresh one (sent to
 *  each member again with the next message). */
export function rotateMyGroupKeys() {
  groups = groups.map(g => ({ ...g, dist: uuid(), keyed: [] }));
  ctx?.save();
}

/** After I remove a linked device: it held everyone's group keys, so all of us switch to new ones. */
export function rotateAfterDeviceRemoved() {
  rotateMyGroupKeys();
  for (const g of groups) send({ group: g.id, body: { t: 'rotate' }, noMirror: true });
}
const lastRotate: Record<string, number> = {};

export const chatGroupsForSync = () => groups.filter(g => g.kind === 'chat').map(g => ({ id: g.id, name: g.name, members: g.members }));
/** Group chats my other device knows about. */
export function mergeChatGroups(list: { id: string; name: string; members: string[] }[]) {
  const fresh = list.filter(x => typeof x.id === 'string' && Array.isArray(x.members) && !findGroup(x.id));
  if (!fresh.length) return;
  groups = [...groups, ...fresh.map(x => ({ id: x.id, kind: 'chat' as const, name: String(x.name).slice(0, 60), members: x.members, dist: uuid(), keyed: [] }))];
  for (const x of fresh) actions.appendChat(null, { id: groupChatId(x.id), name: x.name, members: x.members.length + 1, people: x.members.map(a => ctx?.nameOf(a) ?? 'Neighbor'), shared: { group: x.id }, timer: 'Off', msgs: [] }, { f: 'sys', t: 'Messages from before this device was linked aren’t shown.' });
  ctx?.save();
}

/** Something I sent from another of my devices: shown here as mine. */
export function onMyMirror(p: GroupPayload) {
  if (!ctx) return;
  const body = p.body as Body, me = ctx.me();
  let g = findGroup(p.group);
  if (body?.t === 'chat-new') {
    if (g || !me.account || !Array.isArray(body.members)) return;
    const members = body.members.filter(a => a !== me.account), names = members.map(a => ctx!.nameOf(a) ?? 'Neighbor');
    const name = body.custom ? String(body.name).slice(0, 60) : names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
    g = { id: p.group, kind: 'chat', name, members, dist: uuid(), keyed: [] };
    groups = [...groups, g];
    actions.appendChat(null, { id: groupChatId(g.id), name, members: members.length + 1, people: names, shared: { group: g.id }, timer: 'Off', msgs: [] }, { f: 'sys', t: `You started this group with ${names.join(', ')}.` });
    ctx.save();
    return;
  }
  if (!g) return;
  if (g.kind === 'hood' && g.hood) {
    const hoodId = ctx.hoodIdOf(g.hood);
    if (body.t === 'op') {
      const op = body.op.t === 'plan' ? { t: 'plan' as const, plan: planFromSender(body.op.plan, me.name ?? '') } : body.op;
      actions.applyRemote(hoodId, op.t === 'plan' ? { ...op, plan: { ...op.plan, host: 'You' } } : op, 'You');
    } else if ((body.t === 'chat' || body.t === 'timer') && body.plan) {
      const plan = actions.plansOf(hoodId).find(x => x.id === body.plan);
      if (!plan) return;
      const chat: Chat = { id: `c-${plan.id}`, gid: plan.id, name: plan.title, members: plan.going.length, timer: 'Off', shared: { group: '', plan: plan.id }, msgs: [{ f: 'sys', t: 'Chat created. Everyone who can see this plan can join.' }] };
      if (body.t === 'chat') showChatMessage(hoodId, chat, 'You', body);
      else if (validTimer(body.value)) { actions.appendChat(hoodId, chat, { f: 'sys', t: '' }); actions.dropEmptyNotes(chat.id); actions.setChatTimer(chat.id, body.value); }
    }
  } else if (body.t === 'chat') {
    showChatMessage(null, { id: groupChatId(g.id), name: g.name, members: g.members.length + 1, shared: { group: g.id }, timer: 'Off', msgs: [] }, 'You', body);
  } else if (body.t === 'timer' && validTimer(body.value)) actions.setChatTimer(groupChatId(g.id), body.value);
  ctx.save();
}

/** On start: ask each neighborhood to bring me up to date (hosts send their plans' current state). */
export function catchUpAll() {
  for (const g of groups.filter(x => x.kind === 'hood')) askAgain(g);
}

/* ---------- plans ---------- */

/** Who should receive messages about a plan: undefined = everyone (shared key), or a list (1:1). */
function audienceOf(p: Plan, code: string): string[] | undefined {
  if (p.audience === 'all') return undefined;
  const all = ctx!.hoodMembers(code);
  const acct = (n: string) => (n === 'You' ? ctx!.me().account ?? undefined : ctx!.accountOf(n, code));
  const host = acct(p.host);
  let names: string[];
  if (p.audience === 'pick') names = p.invited ?? [];
  else if (p.audience === 'except') {
    const out = new Set((p.excluded ?? []).map(acct).filter(Boolean) as string[]);
    return all.filter(a => !out.has(a));
  } else {
    const cal = getState().cals.find(c => `cal:${c.name}` === p.audience);
    names = cal?.members ?? [];
  }
  const list = names.map(acct).filter(Boolean) as string[];
  return [...new Set([...list, ...(host ? [host] : [])])].filter(a => a !== ctx!.me().account);
}

function hoodCodeOfCurrent(): string | null {
  const h = getState().hood;
  return h.remote ? h.code : null;
}

/** Called by the store for every plan change I make. Sends it if the neighborhood is a real one. */
function onMyOp(hoodId: string, op: PlanOp, prev?: Plan) {
  const code = hoodCodeOfCurrent();
  dbg('myOp', op.t, 'hood', hoodId, 'code', code, 'ctx', !!ctx, 'groups', groups.length);
  if (!code || !ctx || ctx.hoodIdOf(code) !== hoodId) return;
  const g = findGroup(hoodGroupId(code));
  if (!g) return;
  const planId = op.t === 'plan' ? op.plan.id : op.id;
  const plan = op.t === 'plan' ? op.plan : op.t === 'cancel' ? prev : getState().plans.find(x => x.id === planId);
  if (!plan) return;
  const wire: PlanOp = op.t === 'plan' ? { t: 'plan', plan: planForSending(op.plan, ctx.me().name ?? 'Neighbor') } : op;
  const now = audienceOf(plan, code);
  send({ group: g.id, body: { t: 'op', op: wire }, onlyTo: now });
  ctx.toBoard(code, op, plan, prev);
  // An edit that narrows who's invited: the people taken off get a cancel, 1:1, and nothing else.
  if (op.t === 'plan' && prev) {
    const everyone = ctx.hoodMembers(code);
    const before = audienceOf(prev, code) ?? everyone, after = now ?? everyone;
    const removed = before.filter(a => !after.includes(a));
    if (removed.length) send({ group: g.id, body: { t: 'op', op: { t: 'cancel', id: planId } }, onlyTo: removed });
  }
}

/** A new member asks to catch up: I send them the plans I host that they're allowed to see. */
async function catchUp(g: Group, newcomer: string) {
  if (!g.hood || !ctx) return;
  const hoodId = ctx.hoodIdOf(g.hood);
  const pic = ctx.myPic();
  if (pic) await send({ group: g.id, body: { t: 'profile', pic }, onlyTo: [newcomer], noMirror: true });
  for (const p of actions.plansOf(hoodId).filter(x => x.host === 'You')) {
    const aud = audienceOf(p, g.hood);
    if (aud && !aud.includes(newcomer)) continue;
    await send({ group: g.id, body: { t: 'op', op: { t: 'plan', plan: planForSending(p, ctx.me().name ?? 'Neighbor') } }, onlyTo: [newcomer], noMirror: true });
  }
}

const lastAsk: Record<string, number> = {};
function askAgain(g: Group) {
  if (Date.now() - (lastAsk[g.id] ?? 0) < 60_000) return;
  lastAsk[g.id] = Date.now();
  if (g.hood) ctx?.loadBoard(g.hood); // the board has every plan for everyone, even if its host is away
  send({ group: g.id, body: { t: 'hello' } });
}

/** Gives the owner secret to these members, 1:1 encrypted. */
export function sendOwnerSecret(code: string, to: string[], secret: string) {
  if (to.length) send({ group: hoodGroupId(code), body: { t: 'owner', secret }, onlyTo: to });
}
/** Sends a report to a neighborhood's owners (1:1 encrypted to each owner). */
export function sendReport(code: string, owners: string[], r: { about: string; aboutName: string; kind: 'message' | 'plan' | 'picture'; text: string; where: string }) {
  send({ group: hoodGroupId(code), body: { t: 'report', ...r, text: r.text.slice(0, 2000) }, onlyTo: owners });
}
/** Resets everything this module holds (after deleting the account). */
export function resetGroups() { groups = []; outbox = []; for (const k of Object.keys(recent)) delete recent[k]; }

/** Tells everyone the settings or member list changed, so they refresh now (and rotate keys if someone left). */
export function announceMeta(code: string) {
  send({ group: hoodGroupId(code), body: { t: 'meta' } });
}

/** Tells everyone I share a neighborhood or group chat with that my picture changed. */
export function sendMyPicture(pic: SharedPic) {
  for (const g of groups) send({ group: g.id, body: { t: 'profile', pic } });
}

/** Ask everyone already in the neighborhood for its current plans (after I join). */
export function sayHello(code: string) {
  const g = findGroup(hoodGroupId(code));
  if (g) send({ group: g.id, body: { t: 'hello' } });
}

/* ---------- chats ---------- */

export const groupChatId = (groupId: string) => `g-${groupId}`;

/** Starts an encrypted group chat with these neighbors. Returns the chat's id. */
export function createGroupChat(name: string, members: string[], memberNames: string[], custom = false): string {
  const id = uuid();
  const g: Group = { id, kind: 'chat', name, members, dist: uuid(), keyed: [] };
  groups = [...groups, g];
  const chat: Chat = { id: groupChatId(id), name, members: members.length + 1, people: memberNames, shared: { group: id }, timer: 'Off',
    msgs: [] };
  actions.appendChat(null, chat, { f: 'sys', t: `You started this group with ${memberNames.join(', ').replace(/\.$/, '')}.` });
  ctx?.save();
  const me = ctx?.me().account;
  send({ group: id, body: { t: 'chat-new', name, custom, members: me ? [me, ...members] : members } });
  return chat.id;
}

/** Sends a message in a plan chat (real neighborhood) or a group chat. */
/** Where a group or plan chat message goes: the plan's audience, or the group chat's members. */
function chatItem(chat: Chat, mid: string, text: string, att?: Attachment, loc?: string): OutboxItem | null {
  const extra = { ...(att ? { att } : {}), ...(loc ? { loc } : {}) };
  if (chat.shared?.plan) {
    const code = hoodCodeOfCurrent();
    const plan = getState().plans.find(p => p.id === chat.shared!.plan);
    if (!code || !plan) return null;
    return { group: hoodGroupId(code), body: { t: 'chat', plan: plan.id, mid, text, ...extra }, onlyTo: audienceOf(plan, code) };
  }
  return chat.shared ? { group: chat.shared.group, body: { t: 'chat', mid, text, ...extra } } : null;
}

/** A photo, voice message or file in a group or plan chat: encrypted on this phone with its own key;
 *  the key travels in the group message, and the relay only ever holds the ciphertext. */
export async function sendGroupAttachment(chat: Chat, pickedUri: string, o: Outgoing = { kind: 'photo' }) {
  if (!chat.shared || !ctx) return;
  const mid = Crypto!.randomId();
  actions.appendChat(null, chat, outgoingMsg(o, pickedUri, mid));
  try {
    const up = await uploadPhoto(pickedUri, false, o.kind, o.kind === 'file' ? o.name : undefined);
    actions.patchChatMsg(chat.id, mid, { uri: up.uri });
    const item = chatItem(chat, mid, '', attFor(o, up.att));
    if (!item) throw new Error('no audience');
    remember(item);
    await deliver(item);
    actions.setChatMsgStatus(chat.id, mid, 'sent');
  } catch (e) {
    dbg('attachment failed', String(e));
    actions.setChatMsgStatus(chat.id, mid, 'failed');
  }
}

/** Shows an incoming chat message; a photo is fetched, checked and decrypted in the background. */
/** Already showing this message (a repeat delivery)? */
function chatHas(hoodId: string | null, chatId: string, mid: string) {
  const st = getState();
  const chats = hoodId && hoodId !== st.cur ? st.stash[hoodId]?.chats ?? [] : st.chats;
  return !!chats.find(c => c.id === chatId)?.msgs.some(m => 'mid' in m && m.mid === mid);
}

function showChatMessage(hoodId: string | null, chat: Chat, who: string, body: Extract<Body, { t: 'chat' }>) {
  if (body.loc !== undefined) {
    if (isRoundedGeo(body.loc)) {
      const msg = { f: who, type: 'loc', t: 'Approximate location (about 1 km)', geo: body.loc, mid: body.mid } as Message;
      const had = chatHas(hoodId, chat.id, body.mid);
      actions.appendChat(hoodId, chat, msg);
      if (!had) noteMessage({ chatId: chat.id, chatName: chat.name, who, msg, hood: hoodId, direct: false });
    }
    return;
  }
  const att = body.att && typeof body.att === 'object' ? body.att : undefined;
  const msg = (att
    ? incomingMsg(att, who, body.mid, body.text)
    : { f: who, t: String(body.text).slice(0, 4000), mid: body.mid }) as Message;
  const had = chatHas(hoodId, chat.id, body.mid);
  actions.appendChat(hoodId, chat, msg);
  if (!had) noteMessage({ chatId: chat.id, chatName: chat.name, who, msg, hood: hoodId, direct: false });
  if (att) downloadPhoto(att).then(uri => { actions.patchChatMsg(chat.id, body.mid, { uri }); ctx?.save(); }).catch(e => dbg('photo download failed', String(e)));
}

/** A reaction: one emoji, nothing else (no letters or markup). */
export const validEmoji = (e: unknown): e is string => typeof e === 'string' && e.length > 0 && e.length <= 8 && !/[A-Za-z0-9<>&"'\\/\s]/.test(e);

/** Adds or takes back my reaction on a group or plan chat message, for everyone in the chat. */
export function sendGroupReaction(chat: Chat, mid: string, e: string, on: boolean) {
  if (!chat.shared || !ctx) return;
  const item = chatItem(chat, mid, '');
  if (!item) return;
  const plan = (item.body as { plan?: string }).plan;
  send({ ...item, body: { t: 'react', ...(plan ? { plan } : {}), mid, e, on } });
}

/** Shares a rounded location (about 1 km) in a group or plan chat. */
export function sendGroupLocation(chat: Chat, geo: string) {
  if (!chat.shared || !ctx || !isRoundedGeo(geo)) return;
  const mid = Crypto!.randomId(), t = 'My approximate location (about 1 km)';
  actions.appendChat(null, chat, { f: 'You', type: 'loc', t, geo, mid, status: 'sending' });
  const item = chatItem(chat, mid, t, undefined, geo);
  if (!item) return;
  remember(item);
  deliver(item).then(() => actions.setChatMsgStatus(chat.id, mid, 'sent'))
    .catch(() => { actions.setChatMsgStatus(chat.id, mid, 'failed'); outbox = [...outbox, item]; ctx?.save(); });
}

export function sendGroupChat(chat: Chat, text: string) {
  if (!chat.shared || !ctx) return;
  const mid = Crypto!.randomId();
  actions.appendChat(null, chat, { f: 'You', t: text, mid, status: 'sending' });
  const item = chatItem(chat, mid, text);
  if (!item) return;
  remember(item);
  deliver(item)
    .then(() => actions.setChatMsgStatus(chat.id, mid, 'sent'))
    .catch(() => { actions.setChatMsgStatus(chat.id, mid, 'failed'); outbox = [...outbox, item]; ctx?.save(); });
}

/** Tells everyone in a group or plan chat that its disappearing timer changed. */
export function sendGroupTimer(chat: Chat, value: string) {
  if (!chat.shared || !ctx) return;
  if (chat.shared.plan) {
    const code = hoodCodeOfCurrent(), plan = getState().plans.find(p => p.id === chat.shared!.plan);
    if (code && plan) send({ group: hoodGroupId(code), body: { t: 'timer', plan: plan.id, value }, onlyTo: audienceOf(plan, code) });
  } else send({ group: chat.shared.group, body: { t: 'timer', value } });
}
const validTimer = (v: unknown): v is string => v === 'Off' || v === '1 day' || v === '1 week';

/* ---------- receiving ---------- */

/** A member's Sender Key arrived (1:1). */
export async function onGroupKey(from: string, fromDevice: number, p: GroupKeyPayload) {
  // Already stored by receive() (in order, before later messages were decrypted).
  dbg('got key from', from.slice(0, 8), fromDevice, p.group.slice(0, 8));
}

/** A group message arrived. Ignored unless the sender is a member of that group. */
export async function onGroupMessage(from: string, p: GroupPayload) {
  dbg('received', (p.body as { t: string })?.t, 'from', from.slice(0, 8), 'group known', !!findGroup(p.group), 'member', findGroup(p.group)?.members.includes(from));
  if (!ctx) return;
  const body = p.body as Body;
  let g = findGroup(p.group);

  if (!g && body?.t === 'chat-new') {
    const me = ctx.me().account;
    if (!me || !Array.isArray(body.members) || !body.members.includes(me) || !body.members.includes(from)) return;
    const members = body.members.filter(a => a !== me);
    const names = members.map(a => (a === from ? ctx!.nameOf(a) ?? p.from?.name?.slice(0, 40) : ctx!.nameOf(a)) ?? 'Neighbor');
    // An unnamed group is named after the other people, as seen from this phone.
    const name = body.custom ? String(body.name).slice(0, 60) : names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
    g = { id: p.group, kind: 'chat', name, members, dist: uuid(), keyed: [] };
    groups = [...groups, g];
    actions.appendChat(null, { id: groupChatId(g.id), name: g.name, members: members.length + 1, people: names, shared: { group: g.id }, timer: 'Off', msgs: [] },
      { f: 'sys', t: `${ctx.nameOf(from) ?? 'A neighbor'} added you to this group. Messages are end-to-end encrypted.` });
    ctx.save();
    return;
  }
  // Someone new in a neighborhood: re-check its member list now (they may have just joined).
  if (g?.kind === 'hood' && g.hood && !g.members.includes(from)) {
    await ctx.onMetaChanged(g.hood);
    g = findGroup(p.group);
  }
  if (!g || !g.members.includes(from)) return;
  if (body.t === 'rotate') {
    if (Date.now() - (lastRotate[`${from}:${g.id}`] ?? 0) > 600_000) {
      lastRotate[`${from}:${g.id}`] = Date.now();
      groups = groups.map(x => (x.id === g!.id ? { ...x, dist: uuid(), keyed: [] } : x));
      ctx.save();
    }
    return;
  }
  const who = ctx.nameOf(from, g.hood) ?? p.from?.name?.slice(0, 40) ?? 'Neighbor';
  if (body.t === 'react') {
    if (ctx.isBlocked(from) || typeof body.mid !== 'string' || !validEmoji(body.e)) return;
    const chatId = g.kind === 'hood' ? (body.plan ? `c-${body.plan}` : null) : groupChatId(g.id);
    if (chatId) {
      actions.reactById(chatId, body.mid, who, body.e, body.on !== false);
      noteReaction({ chatId, who, e: body.e, mid: body.mid, on: body.on !== false, hood: g.kind === 'hood' && g.hood ? ctx.hoodIdOf(g.hood) : null });
      ctx.save();
    }
    return;
  }
  if (body.t === 'profile') { if (!ctx.isBlocked(from) && body.pic && typeof body.pic === 'object') ctx.onProfile(from, who, body.pic); return; }

  if (g.kind === 'hood' && g.hood) {
    const hoodId = ctx.hoodIdOf(g.hood);
    if (body.t === 'hello') return catchUp(g, from);
    if (body.t === 'meta') { await ctx.onMetaChanged(g.hood); return; }
    if (body.t === 'report') return ctx.onReport(g.hood, from, body);
    if (ctx.isBlocked(from) && body.t === 'chat') return; // blocked: their chat messages are dropped
    if (body.t === 'owner' && typeof body.secret === 'string') return ctx.onOwnerSecret(g.hood, body.secret);
    if (body.t === 'op') {
      const op = body.op.t === 'plan' ? { t: 'plan' as const, plan: planFromSender(body.op.plan, ctx.me().name ?? '') } : body.op;
      // A change to a plan this phone never got (missed while offline, or from before I joined):
      // ask the neighborhood to send its plans again. Throttled.
      if (op.t !== 'plan' && op.t !== 'cancel' && !actions.plansOf(hoodId).some(x => x.id === op.id)) askAgain(g);
      const pid = opPlanId(op);
      const before = actions.plansOf(hoodId).find(x => x.id === pid);
      actions.applyRemote(hoodId, op, who);
      const after = actions.plansOf(hoodId).find(x => x.id === pid);
      if (before !== after) notePlanOp(hoodId, op, who, before, after);
      ctx.save();
      return;
    }
    if (body.t === 'timer' && body.plan && validTimer(body.value) && !ctx.isBlocked(from)) {
      const plan = actions.plansOf(hoodId).find(x => x.id === body.plan);
      if (plan) { actions.appendChat(hoodId, { id: `c-${plan.id}`, gid: plan.id, name: plan.title, members: plan.going.length, timer: 'Off', shared: { group: '', plan: plan.id },
        msgs: [{ f: 'sys', t: 'Chat created. Everyone who can see this plan can join.' }] }, { f: 'sys', t: '' }); actions.dropEmptyNotes(`c-${plan.id}`); actions.setChatTimer(`c-${plan.id}`, body.value, who); ctx.save(); }
      return;
    }
    if (body.t === 'chat' && body.plan) {
      const plan = actions.plansOf(hoodId).find(x => x.id === body.plan);
      dbg('plan chat for', body.plan, 'hood', hoodId, 'found', !!plan, 'cur', getState().cur);
      if (!plan) return;
      const chat: Chat = { id: `c-${plan.id}`, gid: plan.id, name: plan.title, members: plan.going.length, timer: 'Off', shared: { group: '', plan: plan.id },
        msgs: [{ f: 'sys', t: 'Chat created. Everyone who can see this plan can join.' }] };
      showChatMessage(hoodId, chat, who, body);
      ctx.save();
    }
    return;
  }
  if (g.kind === 'chat' && body.t === 'timer' && validTimer(body.value) && !ctx.isBlocked(from)) { actions.setChatTimer(groupChatId(g.id), body.value, who); ctx.save(); return; }
  if (g.kind === 'chat' && body.t === 'chat') {
    if (ctx.isBlocked(from)) return;
    showChatMessage(null, { id: groupChatId(g.id), name: g.name, members: g.members.length + 1, shared: { group: g.id }, timer: 'Off', msgs: [] }, who, body);
    ctx.save();
  }
}

export function initGroups(c: Ctx) {
  ctx = c;
  onPlanOp(onMyOp);
}

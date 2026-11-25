import { useSyncExternalStore } from 'react';
import { connectLink } from '../links';
import { AppState } from 'react-native';
import Crypto, { CryptoErrors } from '../../../modules/lifestyle-crypto';
import { actions, getState, mutate, onHoodChange, onMessagesExpired, subscribeStore, type HoodChange } from '../store';
import { toast } from '../../components/Toast';
import { attFor, incomingMsg, localUri, outgoingMsg, tooBigText, type Outgoing } from './attachments';
import type { Chat, Member, Message, Pic, Plan } from '../types';
import { SAMPLE_MODE } from '../store';
import { enablePush, listenForWakeups } from './push';
import { rotateMyGroupKeys, rotateAfterDeviceRemoved, chatGroupsForSync, mergeChatGroups, onMyMirror, sendGroupTimer, hoodGroupId, setHoodGidLookup, announceMeta, catchUpAll, resetGroups, sendReport, requestGroupKey, sendOwnerSecret, resendGroupKeys, dropHoodGroup, flushOutbox, groupState, initGroups, loadGroupState, onGroupKey, onGroupMessage, sayHello, sendGroupReaction, sendMyPicture, syncHoodGroup, validEmoji, type Group, type OutboxItem, type SharedPic } from './groups';
import {
  confirmPhone, createRemoteHood, ensureRegistered, findByPhone, joinRemoteHood, leaveRemoteHood, looksLikeRemoteCode,
  deleteEverything, forgetSessionCache, backupSecrets, uploadBackup, deleteBackup, fetchBackup, republishKeysAfterRestore, newRecoveryCode, isRecoveryCode, onAccountClosed, newTransfer, uploadTransfer, transferStatus, downloadTransfer, finishTransfer, onHoodMoved, setLiveCodeLookup, moveRemoteHood, ensureAccessKey, getMyAccessKey, refreshMyHoodProfile, setAccessKeyLookup, normalizePhone, PHONE_ENABLED, receive, removeRemoteMember, updateRemoteMeta, type HoodMeta, RelayError, remoteHood, removePhone, sendText, startPhoneVerification, type HoodMember,
  uploadPhoto, downloadPhoto, isRoundedGeo, billingStatus, coverRemoteHood, onHoodPlan, sendPayload, adoptAccessKey, finishDeviceLink, forgetMyDevices, listMyDevices, mirrorToMyDevices, onDeviceRevoked, removeMyDevice, sendStateToMyDevices, startDeviceLink, type SyncPayload, type SyncState, type TextPayload } from './client';
import { setHoodPlan } from '@/data/billing';

// Encrypted one-on-one chats. Four ways to reach someone, all ending in the same libsignal session:
//   1. In person: scan their code. Their identity key is pinned on the spot ("verified in person").
//   2. Invite link: the same code sent as a link. Key pinned too, but not verified in person.
//   3. Phone number: like Signal. The relay maps a verified number to an account.
//   4. Neighborhood: everyone who joined with the invite code shows up in New chat.
// Ways 3 and 4 take the key from the relay on first contact (like Signal's default); scanning in
// person later upgrades the chat to verified, and a mismatch shows as a key change.
// Contacts, neighborhoods (with their secret codes) and message history live in the native vault:
// AES-256-GCM, key in this phone's Keychain only.

export type Via = 'in-person' | 'link' | 'phone' | 'neighborhood' | 'message';
export type Contact = { account: string; name: string; identityKey?: string; verified: boolean; via?: Via; phone?: string; added: number };
/** `ownerSecret` is only on owners' phones: it proves ownership to the relay. */
/** `code` is the code this phone joined with and stays its local key; `live` is the current code after an owner changed it. */
type SavedHood = { code: string; name: string; ownerSecret?: string; live?: string };
type Saved = { v: 1; agreed?: boolean; myName: string | null; myPhone?: string | null; contacts: Contact[]; chats: Chat[]; hoods?: SavedHood[];
  groups?: Group[]; outbox?: OutboxItem[]; hoodData?: Record<string, { plans: Plan[]; chats: Chat[] }>; cur?: string; blocked?: string[]; accessKeys?: Record<string, string>;
  /** My picture as shared, and neighbors' pictures by account (with the name they had). */
  myPic?: SharedPic; pics?: Record<string, { name: string; pic: SharedPic }> };
export type SecureStatus = 'unavailable' | 'starting' | 'ready' | 'offline' | 'closed';

const VAULT = 'chats-v1';
const POLL_MS = 3000;
const HOOD_REFRESH_MS = 60_000;
const CODE_PREFIX = 'itsalifestyle:connect:v1:';

let status: SecureStatus = Crypto ? 'starting' : 'unavailable';
let myAccount: string | null = null;
let myName: string | null = null;
let myPhone: string | null = null;
let contacts: Contact[] = [];
let hoods: SavedHood[] = [];
let hoodMembers: Record<string, HoodMember[]> = {};
let savedHoodData: Saved['hoodData'] = {};
const hoodMeta: Record<string, HoodMeta> = {};
let blocked: string[] = [];
/** Other people's access keys (learned from their messages and neighborhood profiles): needed to send them sealed messages. */
let accessKeys: Record<string, string> = {};
let myPic: SharedPic | undefined;
let pics: Record<string, { name: string; pic: SharedPic }> = {};
let savedCur: string | undefined;
let started = false;
let generation = 0; // a new start (after deleting the account) stops the old message loop
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version++; listeners.forEach(l => l()); };
// Once closed, only a fresh start (after wiping this phone) changes the status again.
const setStatus = (s: SecureStatus) => { if (status === 'closed' && s !== 'starting') return; if (s !== status) { status = s; notify(); } };
export const secureStatus = () => status;
export const getMyAccount = () => myAccount;
/** The short form of my account ID that support asks for (the relay's admin tool accepts it). */
export const supportId = (account: string | null = myAccount) => account?.slice(0, 8) ?? null;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const chatIdFor = (account: string) => `s-${account}`;
// Codes use URL-safe base64 so they survive links and QR readers that mangle '+' and '/'.
const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (u: string) => { const b = u.replace(/-/g, '+').replace(/_/g, '/'); return b + '='.repeat((4 - (b.length % 4)) % 4); };
const short = (account: string) => account.slice(0, 4).toUpperCase();
const hoodNameFor = (account: string) => Object.values(hoodMembers).flat().find(m => m.account === account)?.name;

/* ---------- 18+ and terms ---------- */
let agreed = false;
export const hasAgreedToTerms = () => agreed;
export function agreeToTerms() { agreed = true; save(); }

/* ---------- my other devices ---------- */
let myDeviceId = 1;
export const isLinkedDevice = () => myDeviceId !== 1;
let lastSharedState = '';
const accountState = (): SyncState => ({ name: myName, blocked: [...blocked].sort(), accessKeys,
  contacts: [...contacts].sort((a, b) => a.account.localeCompare(b.account)),
  hoods: [...hoods].sort((a, b) => a.code.localeCompare(b.code)),
  chatGroups: chatGroupsForSync().sort((a, b) => a.id.localeCompare(b.id)) });
/** Neighborhoods, contacts and blocks stay the same on all my devices. */
function shareStateWithMyDevices() {
  if (!myAccount) return;
  const st = accountState(), text = JSON.stringify(st);
  if (text === lastSharedState) return;
  sendStateToMyDevices(st).then(() => { lastSharedState = text; }).catch(() => {});
}
async function onSyncFromMyDevice(p: SyncPayload) {
  if (p.state) {
    const st = p.state;
    if (st.name) myName = String(st.name).slice(0, 40);
    if (Array.isArray(st.blocked)) blocked = st.blocked.filter(x => typeof x === 'string');
    accessKeys = { ...accessKeys, ...(st.accessKeys ?? {}) };
    const incoming = (Array.isArray(st.contacts) ? st.contacts : []) as Contact[];
    contacts = [...contacts.filter(c => !incoming.some(x => x.account === c.account)), ...incoming.filter(c => typeof c?.account === 'string')];
    for (const h of (Array.isArray(st.hoods) ? st.hoods : []) as SavedHood[]) {
      if (typeof h?.code !== 'string') continue;
      hoods = hoods.some(x => x.code === h.code) ? hoods.map(x => (x.code === h.code ? { ...x, ...h } : x)) : [...hoods, h];
    }
    if (Array.isArray(st.chatGroups)) mergeChatGroups(st.chatGroups);
    lastSharedState = JSON.stringify(accountState());
    save();
    await refreshHoods(true).catch(() => {});
    return;
  }
  const inner = p.inner;
  if (inner?.kind === 'group') return onMyMirror(inner);
  if (inner?.kind !== 'text' || typeof p.to !== 'string') return;
  if (inner.timer !== undefined) {
    if (['Off', '1 day', '1 week'].includes(inner.timer)) { ensureChatFor(p.to); actions.setChatTimer(chatIdFor(p.to), inner.timer); }
    return;
  }
  if (getState().chats.find(c => c.id === chatIdFor(p.to!))?.msgs.some(m => 'mid' in m && m.mid === inner.id)) return;
  const to = p.to;
  if (inner.loc !== undefined) { if (isRoundedGeo(inner.loc)) appendTo(to, { f: 'You', type: 'loc', t: inner.text, geo: inner.loc, mid: inner.id, status: 'sent' }); return; }
  if (inner.att && typeof inner.att === 'object') {
    const att = inner.att;
    appendTo(to, { ...incomingMsg(att, 'You', inner.id, inner.text), status: 'sent' } as Message);
    downloadPhoto(att).then(uri => patchMsg(to, inner.id, { uri })).catch(() => {});
    return;
  }
  appendTo(to, { f: 'You', t: inner.text, mid: inner.id, status: 'sent' });
}
function ensureChatFor(account: string) {
  if (getState().chats.some(c => c.id === chatIdFor(account))) return;
  appendTo(account, { f: 'sys', t: '' });
  actions.dropEmptyNotes(chatIdFor(account));
}

/* ---------- saving (encrypted) ---------- */

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  notify();
  if (!Crypto || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeVault(); }, 400);
}
/** Writes everything to the encrypted vault now. */
async function writeVault() {
  {
    // Real neighborhoods' plans and plan chats are kept too, so they survive a restart.
    const st = getState();
    const hoodData: NonNullable<Saved['hoodData']> = {};
    for (const h of hoods) {
      const id = `r-${h.code}`, d = st.cur === id ? { plans: st.plans, chats: st.chats } : st.stash[id];
      hoodData[h.code] = d ? { plans: d.plans, chats: d.chats.filter(c => c.shared?.plan || c.system) } : savedHoodData?.[h.code] ?? { plans: [], chats: [] };
    }
    const { groups, outbox } = groupState();
    const data: Saved = { v: 1, agreed, myName, myPhone, contacts, hoods, groups, outbox, hoodData, cur: st.cur, blocked, accessKeys, myPic, pics,
      chats: st.chats.filter(c => c.secure || (c.shared && !c.shared.plan)) };
    try { await Crypto!.vaultWrite(VAULT, JSON.stringify(data)); } catch (e) { console.warn('Could not save encrypted chats', e); }
    shareStateWithMyDevices();
  }
}

function upsertChat(account: string, make: () => Chat, change: (c: Chat) => Chat) {
  const id = chatIdFor(account);
  mutate(s => {
    const existing = s.chats.find(c => c.id === id);
    const next = change(existing ?? make());
    return { ...s, chats: existing ? s.chats.map(c => (c.id === id ? next : c)) : [next, ...s.chats] };
  });
  save();
  return id;
}

/** Someone we know in some way: a contact, or a member of one of our neighborhoods. */
const isKnown = (account: string) => contacts.some(c => c.account === account) || !!hoodNameFor(account);

/** Updates one message (by its encrypted ID) in a 1:1 chat, if the chat is still there. */
function patchMsg(account: string, mid: string, patch: Record<string, unknown>) {
  const id = chatIdFor(account);
  mutate(s => ({ ...s, chats: s.chats.map(c => (c.id !== id ? c : { ...c, msgs: c.msgs.map(m => ('mid' in m && m.mid === mid ? { ...m, ...patch } as Message : m)) })) }));
}

function appendTo(account: string, msg: Message, nameHint?: string) {
  const known = isKnown(account);
  const name = contacts.find(c => c.account === account)?.name ?? hoodNameFor(account) ?? nameHint ?? `Neighbor ${short(account)}`;
  return upsertChat(account,
    () => ({ id: chatIdFor(account), name, members: 2, secure: { account, verified: false, ...(known ? {} : { unknown: true }) },
      msgs: known ? [] : [{ f: 'sys', t: `${nameHint ? `“${nameHint}” isn’t` : 'This person isn’t'} one of your connections or neighbors. Only reply if you know who it is.` }] }),
    c => ({ ...c, msgs: [...c.msgs, msg] }));
}

/* ---------- start-up ---------- */

/** Registers (first run), loads saved chats and neighborhoods, and starts listening. Safe to call more than once. */
export async function startSecureMessaging() {
  if (!Crypto || started) return;
  started = true;
  // We closed this account for breaking the community guidelines: stop syncing and say so.
  onAccountClosed(() => { generation++; setStatus('closed'); });
  onDeviceRevoked(() => {
    if (myDeviceId === 1 || !started) return;
    generation++;
    Crypto!.forgetLocally().then(restartFresh).then(() => toast('This device was removed from your account.')).catch(() => {});
  });
  // Invite codes can change: relay calls use the current code; the group ID stays fixed.
  onMessagesExpired(uris => { for (const u of uris) { try { Crypto?.deleteAttachment(localUri(u)); } catch { /* already gone */ } } });
  setLiveCodeLookup(k => hoods.find(h => h.code === k)?.live);
  setHoodGidLookup(k => hoodMeta[k]?.gid);
  onHoodMoved((k, next) => {
    const h = hoods.find(x => x.code === k);
    if (!h || h.live === next) return;
    hoods = hoods.map(x => (x.code === k ? { ...x, live: next } : x));
    if (__DEV__) console.log('[hood] code changed for', h.name);
    save();
    // The owner re-sealed my profile; post my own so my name is mine again.
    if (myName) setTimeout(() => refreshMyHoodProfile(k, myName!).catch(() => {}), 0);
  });
  initGroups({
    me: () => ({ account: myAccount, name: myName }),
    nameOf: (a, code) => contacts.find(c => c.account === a)?.name ?? (code ? hoodMembers[code]?.find(m => m.account === a)?.name : hoodNameFor(a)),
    accountOf: (name, code) => hoodMembers[code]?.find(m => m.name === name && m.account !== myAccount)?.account,
    hoodMembers: code => (hoodMembers[code] ?? []).map(m => m.account).filter(a => a !== myAccount),
    hoodIdOf: code => `r-${code}`,
    save,
    onOwnerSecret,
    onReport,
    isBlocked: a => blocked.includes(a),
    myPic: () => myPic,
    onProfile,
    onMetaChanged: async () => { await refreshHoods(false).catch(() => {}); },
  });
  onHoodChange((id, ch) => { onMyHoodChange(id, ch); });
  // Any change to a real neighborhood's plans (mine or a neighbor's) gets saved, encrypted.
  let lastPlans = getState().plans;
  subscribeStore(() => { const st = getState(); if (st.plans !== lastPlans) { lastPlans = st.plans; if (st.hood.remote) save(); } });
  try {
    myAccount = await ensureRegistered();
    myDeviceId = (await Crypto.account())?.deviceId ?? 1;
    setAccessKeyLookup(a => accessKeys[a] ?? Object.values(hoodMembers).flat().find(m => m.account === a)?.ak);
    await ensureAccessKey().catch(e => { if (__DEV__) console.log('[sealed] no access key yet', String(e)); });
    const raw = await Crypto.vaultRead(VAULT);
    if (raw) {
      const saved = JSON.parse(raw) as Saved;
      agreed = !!saved.agreed || !!saved.hoods?.length; myName = saved.myName; myPhone = saved.myPhone ?? null; contacts = saved.contacts; hoods = saved.hoods ?? [];
      savedHoodData = saved.hoodData ?? {};
      savedCur = saved.cur;
      blocked = saved.blocked ?? [];
      accessKeys = saved.accessKeys ?? {};
      myPic = saved.myPic; pics = saved.pics ?? {};
      showPic('You', myPic);
      for (const p of Object.values(pics)) showPic(p.name, p.pic);
      loadGroupState(saved);
      const ids = new Set(saved.chats.map(c => c.id));
      // Anything still "sending" when the app last closed didn't finish: show it as not sent.
      const loaded = saved.chats.map(c => ({ ...c, msgs: c.msgs.map(m => ('status' in m && m.status === 'sending' ? { ...m, status: 'failed' as const } : m)) }));
      mutate(s => ({ ...s, chats: [...loaded, ...s.chats.filter(c => !ids.has(c.id))] }));
    }
    setStatus('ready');
  } catch (e) {
    console.warn('Encrypted messaging could not start', e);
    started = false;
    setStatus('offline');
    return;
  }
  await refreshHoods(true);
  catchUpAll();
  // Reopen the neighborhood I was on last time.
  if (savedCur && savedCur !== getState().cur && getState().stash[savedCur]) actions.switchHood(savedCur);
  if (!wakeListening) { wakeListening = true; listenForWakeups(() => wakeNow?.()); }
  // Ask for notifications once there's someone to hear from (iOS only asks the person once).
  if (hoods.length || contacts.length) enablePush().catch(() => {});
  pollLoop(++generation);
  refreshBackup();
}
let wakeListening = false;

let wakeNow: (() => void) | null = null;
async function pollLoop(gen: number) {
  let lastHoods = Date.now();
  while (started && gen === generation) {
    if (AppState.currentState === 'active') {
      try {
        await pollOnce();
        await flushOutbox();
        if (Date.now() - lastHoods > HOOD_REFRESH_MS) { lastHoods = Date.now(); await refreshHoods(false); }
        setStatus('ready');
      } catch { setStatus('offline'); }
    }
    // Wait for the next round, or less if a push (or opening the app) says something arrived.
    await new Promise<void>(r => { const t = setTimeout(r, POLL_MS); wakeNow = () => { clearTimeout(t); r(); }; });
    wakeNow = null;
  }
}

async function pollOnce() {
  for (const r of await receive()) {
    if (r.from === myAccount) { if (r.ok && r.payload.kind === 'sync') await onSyncFromMyDevice(r.payload).catch(() => {}); continue; }
    const contact = contacts.find(c => c.account === r.from);
    // Learn their access key, so my replies to them go sealed.
    const ak = r.ok ? r.payload.from?.ak : undefined;
    if (r.ok && typeof ak === 'string' && ak.length <= 64 && accessKeys[r.from] !== ak) { accessKeys[r.from] = ak; save(); }
    // Blocked people: their 1:1 messages are dropped. Keys and group housekeeping still go through.
    if (blocked.includes(r.from) && !(r.ok && (r.payload.kind === 'gkey' || r.payload.kind === 'group'))) continue;
    if (r.ok && r.payload.kind === 'group' && (r.payload.body as { t?: string })?.t === 'rekey') { resendGroupKeys(r.from); continue; }
    if (r.ok && r.payload.kind === 'gkey') { await onGroupKey(r.from, r.fromDevice, r.payload).catch(e => { if (__DEV__) console.log('[groups] key error', String(e).slice(0, 200)); }); continue; }
    if (r.ok && r.payload.kind === 'group') { await onGroupMessage(r.from, r.payload); continue; }
    if (__DEV__ && !r.ok) console.log('[groups] undecryptable from', r.from.slice(0, 8), r.reason);
    if (!r.ok && r.viaGroupKey) {
      // A group message I couldn't read (their key never reached me). Never shown in a 1:1 chat;
      // ask them for their key again so the next one works.
      requestGroupKey(r.from);
      continue;
    }
    if (!r.ok) {
      // A key change is shown. Anything else unreadable (a duplicate, or an old session) is dropped quietly:
      // there's nothing the person can do with it, and the sender's next message starts a fresh session.
      if (r.reason === 'identity-changed') appendTo(r.from, { f: 'key', who: contact?.name ?? 'This person' });
      continue;
    }
    // A key pinned in person (or from their link) must match the key the message came from.
    if (contact?.identityKey && (await Crypto!.identityChanged(r.from, r.fromDevice))) {
      appendTo(r.from, { f: 'key', who: contact.name });
      continue;
    }
    const pl = r.payload;
    if (pl.kind === 'react') {
      if (validEmoji(pl.e)) { actions.reactById(chatIdFor(r.from), pl.mid, contact?.name ?? hoodNameFor(r.from) ?? 'Neighbor', pl.e, pl.on !== false); save(); }
      continue;
    }
    if (pl.kind !== 'text') continue;
    if (pl.timer !== undefined) {
      if (pl.timer === 'Off' || pl.timer === '1 day' || pl.timer === '1 week') { ensureChatFor(r.from); actions.setChatTimer(chatIdFor(r.from), pl.timer, contact?.name ?? hoodNameFor(r.from) ?? 'Your neighbor'); }
      continue;
    }
    const chat = getState().chats.find(c => c.id === chatIdFor(r.from));
    if (chat?.msgs.some(m => 'mid' in m && m.mid === pl.id)) continue; // duplicate delivery
    const sender = contact?.name ?? hoodNameFor(r.from) ?? pl.from?.name?.slice(0, 40);
    if (pl.loc !== undefined) {
      if (!isRoundedGeo(pl.loc)) continue; // too precise or malformed: not shown
      appendTo(r.from, { f: sender ?? `Neighbor ${short(r.from)}`, type: 'loc', t: 'Approximate location (about 1 km)', geo: pl.loc, mid: pl.id }, pl.from?.name?.slice(0, 40));
      continue;
    }
    if (pl.att && typeof pl.att === 'object') {
      const att = pl.att;
      appendTo(r.from, incomingMsg(att, sender ?? `Neighbor ${short(r.from)}`, pl.id, pl.text), pl.from?.name?.slice(0, 40));
      // Fetch, check and decrypt in the background; the bubble shows "loading" until then.
      downloadPhoto(att).then(uri => patchMsg(r.from, pl.id, { uri }))
        .catch(e => { if (__DEV__) console.log('[photo] could not load', String(e)); });
      continue;
    }
    appendTo(r.from, { f: sender ?? `Neighbor ${short(r.from)}`, t: pl.text, mid: pl.id }, pl.from?.name?.slice(0, 40));
  }
}

/* ---------- my name, my code, my link ---------- */

export const getMyName = () => myName;
export function setMyName(name: string) { myName = name.trim().slice(0, 40) || null; save(); }

export async function myConnectCode(): Promise<string | null> {
  if (!Crypto || !myAccount || !myName) return null;
  const acct = await Crypto.account();
  if (!acct) return null;
  return `${CODE_PREFIX}${myAccount}:${toUrlSafe(acct.identityKey)}:${encodeURIComponent(myName)}`;
}

/** The same code as a link you can text to someone. Opening it connects you (not verified in person). */
export async function myInviteLink(): Promise<string | null> {
  const code = await myConnectCode();
  return code ? connectLink(code) : null;
}

export type ConnectResult = { ok: true; chatId: string; name: string } | { ok: false; reason: string };

/** Connects using someone's code. `inPerson`: scanned off their screen (verified) vs. opened from a link. */
export async function connectWithCode(code: string, inPerson = true): Promise<ConnectResult> {
  if (!Crypto || status === 'unavailable') return { ok: false, reason: 'Encrypted chat needs the full app build.' };
  if (!code.startsWith(CODE_PREFIX)) return { ok: false, reason: 'That isn’t a connect code from this app.' };
  const [account, keyPart, enc] = code.slice(CODE_PREFIX.length).split(':');
  const identityKey = keyPart && /^[A-Za-z0-9_-]+$/.test(keyPart) ? fromUrlSafe(keyPart) : '';
  let name = '';
  try { name = decodeURIComponent(enc ?? '').trim().slice(0, 40); } catch { /* bad encoding */ }
  if (!/^[0-9a-f-]{36}$/.test(account ?? '') || !identityKey || !name) return { ok: false, reason: 'That code is damaged. Ask them to show it again.' };
  if (account === myAccount) return { ok: false, reason: 'That’s your own code.' };
  try {
    await Crypto.pinIdentity(account, 1, identityKey);
  } catch {
    return { ok: false, reason: 'That code is damaged. Ask them to show it again.' };
  }
  if (await Crypto.identityChanged(account, 1)) {
    return { ok: false, reason: `${name}’s code doesn’t match the key you already have for them. Don’t trust messages from this account until you’ve checked in person.` };
  }
  const prev = contacts.find(c => c.account === account);
  const verified = inPerson || !!prev?.verified;
  const contact: Contact = { ...prev, account, name: prev?.name && !inPerson ? prev.name : name, identityKey, verified, via: inPerson ? 'in-person' : prev?.via ?? 'link', added: prev?.added ?? Date.now() };
  contacts = [...contacts.filter(c => c.account !== account), contact];
  const note = inPerson
    ? `You connected with ${name} in person. Messages are end-to-end encrypted, and only your phones can read them.`
    : `You connected with ${name} through their invite link. Messages are end-to-end encrypted. Scan their code next time you meet to verify in person.`;
  const chatId = upsertChat(account,
    () => ({ id: chatIdFor(account), name: contact.name, members: 2, secure: { account, verified }, msgs: [{ f: 'sys', t: note }] }),
    c => ({ ...c, name: contact.name, secure: { account, verified }, msgs: inPerson && !c.secure?.verified ? [...c.msgs, { f: 'sys', t: `You verified ${name} in person.` }] : c.msgs }));
  return { ok: true, chatId, name: contact.name };
}

/** Opens (or creates) an encrypted chat with an account found by phone number or in a neighborhood. */
export function openSecureChat(account: string, name: string, via: Via, phone?: string): string {
  if (account === myAccount) return '';
  const prev = contacts.find(c => c.account === account);
  if (!prev) contacts = [...contacts, { account, name, verified: false, via, ...(phone ? { phone } : {}), added: Date.now() }];
  const how = via === 'phone' ? 'by phone number' : via === 'neighborhood' ? 'in your neighborhood' : '';
  return upsertChat(account,
    () => ({ id: chatIdFor(account), name: prev?.name ?? name, members: 2, secure: { account, verified: !!prev?.verified },
      msgs: [{ f: 'sys', t: `Messages are end-to-end encrypted. You found ${name} ${how}; scan their code in person to verify.` }] }),
    c => ({ ...c, secure: { ...c.secure!, unknown: undefined } }));
}

/* ---------- phone numbers ---------- */

export const getMyPhone = () => myPhone;
export const phoneEnabled = PHONE_ENABLED;
export type PhoneStep = { ok: true } | { ok: false; reason: string };

export async function sendPhoneCode(input: string): Promise<PhoneStep & { phone?: string }> {
  const phone = normalizePhone(input);
  if (!phone) return { ok: false, reason: 'Enter the full number. Outside the US and Canada, start with + and the country code.' };
  try { await startPhoneVerification(phone); return { ok: true, phone }; }
  catch (e) { return { ok: false, reason: e instanceof RelayError && e.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Couldn’t send a code. Check your connection.' }; }
}

export async function verifyPhoneCode(phone: string, code: string): Promise<PhoneStep> {
  try { await confirmPhone(phone, code.replace(/\D/g, '')); myPhone = phone; save(); return { ok: true }; }
  catch { return { ok: false, reason: 'That code didn’t work. Check it, or ask for a new one.' }; }
}

export async function forgetMyPhone() { await removePhone(); myPhone = null; save(); }

/** Finds someone by phone number and opens your encrypted chat. */
export async function chatByPhone(input: string, name: string): Promise<ConnectResult> {
  const phone = normalizePhone(input);
  if (!phone) return { ok: false, reason: 'Enter the full number. Outside the US and Canada, start with + and the country code.' };
  try {
    const [hit] = await findByPhone([phone]);
    if (!hit) return { ok: false, reason: 'That number isn’t on the app yet. Send them an invite link instead.' };
    const label = name.trim().slice(0, 40) || contacts.find(c => c.account === hit.account)?.name || hoodNameFor(hit.account) || phone;
    return { ok: true, chatId: openSecureChat(hit.account, label, 'phone', phone), name: label };
  } catch (e) {
    return { ok: false, reason: e instanceof RelayError && e.status === 429 ? 'Too many lookups. Wait a minute.' : 'Couldn’t look that up. Check your connection.' };
  }
}

/* ---------- neighborhoods ---------- */

const toMembers = (list: HoodMember[], meta?: HoodMeta): Member[] =>
  list.map((m, i) => {
    const owner = ownersOf(meta, list).includes(m.account);
    const inv = meta?.inviters !== 'chosen' || !!owner;
    return m.account === myAccount ? { n: 'You', by: i === 0 ? 'Started' : 'Joined', inv, account: m.account } : { n: m.name, by: i === 0 ? 'Started' : 'Joined', inv, account: m.account };
  });
const nameOfAcct = (a: string, list: HoodMember[]) => (a === myAccount ? 'You' : list.find(m => m.account === a)?.name);
/** Owners from the sealed settings; neighborhoods made before owners existed: the founding member. */
const ownersOf = (meta: HoodMeta | undefined, list: HoodMember[]) => (meta?.owners?.length ? meta.owners : list[0] ? [list[0].account] : []);
function infoOf(meta: HoodMeta, list: HoodMember[]) {
  const owners = ownersOf(meta, list).map(a => nameOfAcct(a, list)).filter((n): n is string => !!n);
  return {
    name: meta.name.slice(0, 60), about: (meta.about ?? '').slice(0, 500), places: (meta.places ?? []).slice(0, 20).map(x => String(x).slice(0, 40)),
    inviters: meta.inviters === 'chosen' ? 'chosen' as const : 'everyone' as const, owners, owner: owners[0] ?? '',
    ...(meta.cover === 'drawing' || meta.cover === 'none' ? { cover: { kind: meta.cover } as { kind: 'drawing' } | { kind: 'none' } } : {}),
  };
}

/* Owner actions in a real neighborhood. The change is already on this phone; this puts it on the relay
   (sealed) and tells everyone to refresh. Without the owner secret the relay refuses. */
async function onMyHoodChange(hoodId: string, ch: HoodChange) {
  const h = hoods.find(x => `r-${x.code}` === hoodId);
  if (__DEV__) console.log('[groups]', myName, 'hood change', ch.t, 'found', !!h, 'secret', !!h?.ownerSecret);
  if (!h) return;
  // Founding member of an older neighborhood without an owner key: claim one now.
  if (!h.ownerSecret && (hoodMembers[h.code] ?? [])[0]?.account === myAccount && !hoodMeta[h.code]?.owners?.length) {
    const fresh = Crypto!.randomId() + Crypto!.randomId();
    hoods = hoods.map(x => (x.code === h.code ? { ...x, ownerSecret: fresh } : x));
    h.ownerSecret = '';
    try {
      await updateRemoteMeta(h.code, { ...(hoodMeta[h.code] ?? { v: 1, name: h.name }), owners: [myAccount!] }, '', fresh);
      h.ownerSecret = fresh;
      hoodMeta[h.code] = { ...(hoodMeta[h.code] ?? { v: 1, name: h.name }), owners: [myAccount!] };
    } catch { hoods = hoods.map(x => (x.code === h.code ? { ...x, ownerSecret: undefined } : x)); return toast('Couldn’t reach the server. Try again.'); }
  }
  if (!h.ownerSecret) return toast('Only owners can change this, and this phone doesn’t have the owner key.');
  const st = getState(), hood = st.cur === hoodId ? st.hood : st.stash[hoodId]?.hood;
  if (!hood) return;
  const list = hoodMembers[h.code] ?? [];
  const acct = (n: string) => (n === 'You' ? myAccount : list.find(m => m.name === n && m.account !== myAccount)?.account);
  const owners = hood.owners.map(acct).filter((a): a is string => !!a);
  // A cover photo is encrypted and uploaded once; members get its key inside the sealed settings.
  let cover = hood.cover;
  if (cover?.kind === 'photo' && !cover.att) {
    try {
      const up = await uploadPhoto(cover.uri, true);
      cover = { kind: 'photo', uri: up.uri, att: up.att };
      actions.setRemoteHoodInfo(hoodId, { cover });
    } catch (e) { if (__DEV__) console.log('[cover] upload failed', String(e)); return toast('Couldn’t share the cover photo. Try again.'); }
  }
  const prev = hoodMeta[h.code];
  const meta: HoodMeta = { v: 1, name: hood.name, about: hood.about, places: hood.places, inviters: hood.inviters, owners,
    ...(prev?.gid ? { gid: prev.gid } : {}), // the fixed group ID must survive every settings change
    ...(cover?.kind === 'drawing' || cover?.kind === 'none' ? { cover: cover.kind } : {}),
    ...(cover?.kind === 'photo' && cover.att ? { cover: 'photo' as const, coverImg: cover.att } : {}) };
  try {
    if (ch.t === 'remove') {
      const who = acct(ch.name);
      if (!who) return;
      await removeRemoteMember(h.code, who, h.ownerSecret);
    }
    const prevOwners = hoodMeta[h.code]?.owners ?? [];
    const lostOwner = prevOwners.some(a => !owners.includes(a));
    if (lostOwner) {
      // An owner stepped down or was removed: new owner secret, given only to the remaining owners.
      const next = Crypto!.randomId() + Crypto!.randomId();
      await updateRemoteMeta(h.code, meta, h.ownerSecret, next);
      const stillOwner = owners.includes(myAccount ?? '');
      hoods = hoods.map(x => (x.code === h.code ? { ...x, ownerSecret: stillOwner ? next : undefined } : x));
      sendOwnerSecret(h.code, owners.filter(a => a !== myAccount), next);
    } else {
      await updateRemoteMeta(h.code, meta, h.ownerSecret);
      if (ch.t === 'owner' && ch.on) { const a = acct(ch.name); if (a) sendOwnerSecret(h.code, [a], h.ownerSecret); }
    }
    hoodMeta[h.code] = meta;
    save();
    announceMeta(h.code);
    await refreshHoods(false);
  } catch (e) {
    if (__DEV__) console.log('[groups]', myName, 'hood change failed', String(e));
    toast(e instanceof RelayError && e.status === 403 ? 'The relay refused: this phone’s owner key is out of date.' : 'Couldn’t reach the server. The change is only on this phone for now.');
  }
}

/** A co-owner handed me the owner secret (inside an encrypted group message). */
function onOwnerSecret(code: string, secret: string) {
  hoods = hoods.map(x => (x.code === code ? { ...x, ownerSecret: String(secret).slice(0, 128) } : x));
  save();
}

async function refreshHoods(addMissing: boolean) {
  for (const h of hoods) {
    try {
      const r = await remoteHood(h.code);
      hoodMembers[h.code] = r.members;
      hoodMeta[h.code] = r.meta;
      // My profile has no access key (made before sealed sender) or an outdated one (account switch): post it again.
      const mine = r.members.find(m => m.account === myAccount);
      if (mine && getMyAccessKey() && mine.ak !== getMyAccessKey() && myName) refreshMyHoodProfile(h.code, myName).catch(() => {});
      syncHoodGroup(h.code, r.name, r.members.map(m => m.account).filter(a => a !== myAccount));
      const id = `r-${h.code}`;
      const inStore = getState().cur === id || !!getState().stash[id];
      if (inStore) { actions.setRemoteMembers(id, toMembers(r.members, r.meta)); actions.setRemoteHoodInfo(id, { ...infoOf(r.meta, r.members), invite: liveCode(h.code) }); syncCoverPhoto(id, r.meta); }
      else if (addMissing) {
        const cur = getState().cur;
        actions.addRemoteHood({ code: h.code, name: r.name, members: toMembers(r.members, r.meta) });
        actions.setRemoteHoodInfo(id, { ...infoOf(r.meta, r.members), invite: liveCode(h.code) });
        syncCoverPhoto(id, r.meta);
        const d = savedHoodData?.[h.code];
        if (d) actions.restoreHoodData(id, d.plans, d.chats);
        if (cur !== id && getState().stash[cur]) actions.switchHood(cur); // restore without jumping away
      }
    } catch (e) {
      if (e instanceof RelayError && e.status === 404) {
        // Removed by an owner, or the neighborhood is gone: it leaves this phone.
        hoods = hoods.filter(x => x.code !== h.code);
        dropHoodGroup(h.code);
        actions.forgetHood(`r-${h.code}`);
        save();
      }
    }
  }
  notify();
}

export const isRemoteCode = looksLikeRemoteCode;

/** A neighborhood's shared cover photo: fetched, checked and decrypted once per photo. */
function syncCoverPhoto(hoodId: string, meta: HoodMeta) {
  if (meta.cover !== 'photo' || !meta.coverImg) return;
  const st = getState(), have = (st.cur === hoodId ? st.hood : st.stash[hoodId]?.hood)?.cover;
  if (have?.kind === 'photo' && have.att?.digest === meta.coverImg.digest) return;
  const att = meta.coverImg;
  downloadPhoto(att).then(uri => actions.setRemoteHoodInfo(hoodId, { cover: { kind: 'photo', uri, att } }))
    .catch(e => { if (__DEV__) console.log('[cover] download failed', String(e)); });
}
const liveCode = (key: string) => hoods.find(h => h.code === key)?.live ?? key;

/** Owners: gives a real neighborhood a new invite code. Everyone in it keeps access; the old code and
 *  links stop working, so people removed earlier (or anyone who saw the old code) can't use it. */
export async function changeInviteCode(hoodId: string): Promise<string> {
  const h = hoods.find(x => `r-${x.code}` === hoodId);
  if (!h) throw new Error('Not a shared neighborhood.');
  if (!h.ownerSecret) throw new Error('Only owners can change the code, and this phone doesn’t have the owner key.');
  const next = await moveRemoteHood(h.code, h.ownerSecret, hoodGroupId(h.code).slice(2));
  hoods = hoods.map(x => (x.code === h.code ? { ...x, live: next } : x));
  hoodMeta[h.code] = { ...(hoodMeta[h.code] ?? { v: 1, name: h.name }), gid: hoodMeta[h.code]?.gid ?? hoodGroupId(h.code).slice(2) };
  save();
  actions.setRemoteHoodInfo(hoodId, { invite: next });
  announceMeta(h.code); // everyone refreshes now and learns the new code
  return next;
}

onHoodPlan((key, plan) => setHoodPlan(`r-${key}`, plan));

/** Keeps a lapsed neighborhood going with my subscription. If I'm not an owner, I become the only owner
 *  (the relay allows this only after the owner's first 7 days to renew). */
export async function coverNeighborhood(hoodId: string): Promise<'need-plan' | 'covered' | 'took-over'> {
  const h = hoods.find(x => `r-${x.code}` === hoodId);
  if (!h) throw new Error('Not a shared neighborhood.');
  if (!(await billingStatus()).active) return 'need-plan';
  const list = hoodMembers[h.code] ?? [], meta = hoodMeta[h.code] ?? { v: 1 as const, name: h.name };
  if (ownersOf(meta, list).includes(myAccount ?? '') && h.ownerSecret) { await coverRemoteHood(h.code, h.ownerSecret); return 'covered'; }
  const newSecret = Crypto!.randomId() + Crypto!.randomId(), next: HoodMeta = { ...meta, owners: [myAccount!], gid: meta.gid ?? hoodGroupId(h.code).slice(2) };
  await coverRemoteHood(h.code, undefined, { meta: next, newSecret });
  hoods = hoods.map(x => (x.code === h.code ? { ...x, ownerSecret: newSecret } : x));
  hoodMeta[h.code] = next;
  save();
  actions.setRemoteMembers(hoodId, toMembers(list, next));
  actions.setRemoteHoodInfo(hoodId, infoOf(next, list));
  announceMeta(h.code);
  return 'took-over';
}

/** Creates a neighborhood on the relay. Returns its invite code (XXXX-XXXX-XXXX). */
export async function createHoodOnline(name: string, extra: { about?: string; places?: string[]; inviters?: 'everyone' | 'chosen' } = {}): Promise<string> {
  const { code, ownerSecret } = await createRemoteHood({ name, ...extra }, myName ?? 'Neighbor');
  hoodMeta[code] = { v: 1, name, ...extra, owners: [myAccount!] };
  hoods = [...hoods, { code, name, ownerSecret }];
  hoodMembers[code] = [{ account: myAccount!, name: myName ?? 'Neighbor' }];
  syncHoodGroup(code, name, []);
  save();
  enablePush().catch(() => {});
  return code;
}

/** Joins with an invite code. Returns the neighborhood's name, or null if the code is wrong. */
export async function joinHoodOnline(code: string): Promise<string | null> {
  const r = await joinRemoteHood(code, myName ?? 'Neighbor');
  if (!r) return null;
  hoods = [...hoods.filter(h => h.code !== r.code), { code: r.code, name: r.name }];
  hoodMembers[r.code] = r.members;
  hoodMeta[r.code] = r.meta;
  syncHoodGroup(r.code, r.name, r.members.map(m => m.account).filter(a => a !== myAccount));
  save();
  actions.addRemoteHood({ code: r.code, name: r.name, members: toMembers(r.members, r.meta) });
  actions.setRemoteHoodInfo(`r-${r.code}`, { ...infoOf(r.meta, r.members), invite: r.code });
  syncCoverPhoto(`r-${r.code}`, r.meta);
  sayHello(r.code); // everyone already there sends me the plans I'm allowed to see
  enablePush().catch(() => {});
  return r.name;
}

export async function leaveHoodOnline(code: string) {
  await leaveRemoteHood(code);
  hoods = hoods.filter(h => h.code !== code);
  delete hoodMembers[code];
  dropHoodGroup(code);
  save();
}

/* ---------- sending ---------- */

/** Sends a photo, voice message or file in an encrypted 1:1 chat: encrypted on this phone with its own
 *  key; the relay only ever holds the ciphertext. */
export async function sendSecureAttachment(chatId: string, pickedUri: string, o: Outgoing = { kind: 'photo' }) {
  const chat = getState().chats.find(c => c.id === chatId);
  if (!chat?.secure || !Crypto) return;
  const account = chat.secure.account, mid = Crypto.randomId();
  const set = (patch: Record<string, unknown>) => patchMsg(account, mid, patch);
  upsertChat(account, () => chat, c => ({ ...c, msgs: [...c.msgs, outgoingMsg(o, pickedUri, mid)] }));
  try {
    const up = await uploadPhoto(pickedUri, false, o.kind, o.kind === 'file' ? o.name : undefined);
    set({ uri: up.uri });
    await sendText(account, '', mid, myName, attFor(o, up.att));
    set({ status: 'sent' });
  } catch (e) {
    set({ status: 'failed' });
    if (String((e as Error).message).includes('too large')) toast(tooBigText(o));
    else if (!(e instanceof RelayError)) console.warn('Encrypted attachment failed', e);
  }
}

/** Shares a rounded location (about 1 km) in an encrypted 1:1 chat. */
export async function sendSecureLocation(chatId: string, geo: string) {
  const chat = getState().chats.find(c => c.id === chatId);
  if (!chat?.secure || !Crypto || !isRoundedGeo(geo)) return;
  const account = chat.secure.account, mid = Crypto.randomId(), t = 'My approximate location (about 1 km)';
  upsertChat(account, () => chat, c => ({ ...c, msgs: [...c.msgs, { f: 'You', type: 'loc', t, geo, mid, status: 'sending' }] }));
  try { await sendText(account, t, mid, myName, undefined, geo); patchMsg(account, mid, { status: 'sent' }); }
  catch { patchMsg(account, mid, { status: 'failed' }); }
}

export async function sendSecure(chatId: string, text: string, retryMid?: string) {
  const chat = getState().chats.find(c => c.id === chatId);
  if (!chat?.secure || !Crypto) return;
  const account = chat.secure.account;
  const mid = retryMid ?? Crypto.randomId();
  const setMsgStatus = (st: 'sending' | 'sent' | 'failed') =>
    upsertChat(account, () => chat, c => ({ ...c, msgs: c.msgs.map(m => ('mid' in m && m.mid === mid ? { ...m, status: st } : m)) }));
  if (retryMid) setMsgStatus('sending');
  else upsertChat(account, () => chat, c => ({ ...c, msgs: [...c.msgs, { f: 'You', t: text, mid, status: 'sending' }] }));
  try {
    await sendText(account, text, mid, myName);
    setMsgStatus('sent');
  } catch (e) {
    setMsgStatus('failed');
    if (String((e as Error).message).startsWith(CryptoErrors.identityChanged)) {
      upsertChat(account, () => chat, c => ({ ...c, msgs: [...c.msgs, { f: 'key', who: chat.name }] }));
    } else if (!(e instanceof RelayError)) console.warn('Encrypted send failed', e);
  }
}

/** Adds or takes back my reaction on a message, here and for everyone in the chat. */
export function reactToMessage(chat: Chat, mid: string, e: string) {
  const m = chat.msgs.find(x => 'mid' in x && x.mid === mid) as { r?: Record<string, string[]> } | undefined;
  const on = !(m?.r?.[e] ?? []).includes('You');
  actions.reactById(chat.id, mid, 'You', e, on);
  save();
  if (chat.shared) return sendGroupReaction(chat, mid, e, on);
  if (chat.secure && Crypto) sendPayload(chat.secure.account, { v: 1, kind: 'react', id: Crypto.randomId(), mid, e, on }).catch(() => toast('Couldn’t send your reaction. Check your connection.'));
}

/** Changes disappearing messages for a chat on this phone and everyone else's in it. */
export async function setChatDisappearing(chat: Chat, value: string) {
  actions.setChatTimer(chat.id, value);
  save();
  if (chat.shared) return sendGroupTimer(chat, value);
  if (chat.secure) {
    const inner: TextPayload = { v: 1, kind: 'text', id: Crypto!.randomId(), text: '', sentAt: Date.now(), timer: value };
    await sendPayload(chat.secure.account, inner);
    mirrorToMyDevices({ to: chat.secure.account, inner });
  }
}

/** Live status for screens (re-renders when status, name, phone or neighborhoods change). */
export function useSecureStatus() {
  return useSyncExternalStore(subscribe, secureStatus, secureStatus);
}
export function useSecureVersion() {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export { createGroupChat, sendGroupAttachment, sendGroupChat, sendGroupLocation } from './groups';
/** Account ID of a member of the current (real) neighborhood, by the name shown on this phone. */
export function accountInCurrentHood(name: string): string | undefined {
  const h = getState().hood;
  return h.remote ? hoodMembers[h.code]?.find(m => m.name === name && m.account !== myAccount)?.account : undefined;
}

/* ---------- block and report ---------- */

export const isBlocked = (account: string) => blocked.includes(account);
export function setBlocked(account: string, on: boolean, name?: string) {
  blocked = on ? [...new Set([...blocked, account])] : blocked.filter(a => a !== account);
  const id = chatIdFor(account);
  if (getState().chats.some(c => c.id === id)) {
    mutate(s => ({ ...s, chats: s.chats.map(c => (c.id === id ? { ...c, msgs: [...c.msgs, { f: 'sys', t: on ? `You blocked ${name ?? 'this person'}. You won’t get their messages.` : `You unblocked ${name ?? 'this person'}.` }] } : c)) }));
  }
  save();
}

/** Account of the person behind a chat message, by the name shown in it. */
export function accountForName(name: string, chat?: Chat): string | undefined {
  if (chat?.secure) return chat.secure.account;
  return contacts.find(c => c.name === name)?.account ?? hoodNameToAccount(name);
}
function hoodNameToAccount(name: string) {
  for (const list of Object.values(hoodMembers)) { const m = list.find(x => x.name === name && x.account !== myAccount); if (m) return m.account; }
  return undefined;
}

export type ReportTarget = { code: string; hoodName: string; ownersOther: string[]; iAmOwner: boolean } | null;
/** Which neighborhood's owners a report about `account` goes to (the current one if they're a member). */
export function reportTarget(account: string): ReportTarget {
  const st = getState();
  const order = [...hoods].sort((a, b) => (`r-${a.code}` === st.cur ? -1 : `r-${b.code}` === st.cur ? 1 : 0));
  for (const h of order) {
    if (!(hoodMembers[h.code] ?? []).some(m => m.account === account)) continue;
    const owners = ownersOf(hoodMeta[h.code], hoodMembers[h.code] ?? []);
    return { code: h.code, hoodName: h.name, ownersOther: owners.filter(a => a !== myAccount && a !== account), iAmOwner: owners.includes(myAccount ?? '') };
  }
  return null;
}
export function report(target: NonNullable<ReportTarget>, r: { about: string; aboutName: string; kind: 'message' | 'plan' | 'picture'; text: string; where: string }) {
  sendReport(target.code, target.ownersOther, r);
}

function onReport(code: string, from: string, r: { about: string; aboutName: string; kind: 'message' | 'plan' | 'picture'; text: string; where: string }) {
  if (!ownersOf(hoodMeta[code], hoodMembers[code] ?? []).includes(myAccount ?? '')) return; // only owners keep reports
  const list = hoodMembers[code] ?? [];
  const by = list.find(m => m.account === from)?.name ?? 'A neighbor';
  const about = list.find(m => m.account === r.about)?.name ?? r.aboutName;
  const hood = hoods.find(h => h.code === code);
  const what = r.kind === 'plan' ? 'a plan' : r.kind === 'picture' ? 'the profile picture' : 'a message';
  actions.appendChat(`r-${code}`, { id: `reports-${code}`, name: `Reports · ${hood?.name ?? 'neighborhood'}`, members: 1, system: true, icon: 'shield',
    msgs: [{ f: 'sys', t: 'Reports from members come here, only to owners. To act on one, remove the person from the neighborhood page.' }] },
    { f: 'sys', t: `${by} reported ${what} ${r.kind === 'picture' ? 'of' : 'by'} ${about} (${String(r.where).slice(0, 80)}): “${String(r.text).slice(0, 500)}” Support ID of ${about}: ${supportId(r.about) ?? 'unknown'}. For serious problems, send this to admin@cyber-affinity.com.` });
  save();
}

/** Deletes this account everywhere: relay (account, phone number, memberships, queued messages) and
 *  this phone (keys and every encrypted file). Then starts fresh with a new, empty account. */
export async function deleteMyAccount(): Promise<void> {
  if (__DEV__) console.log('[groups] deleting account', myAccount);
  started = false;
  generation++;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  // A closed account can't be deleted on the relay (it's already gone there), only wiped here.
  await deleteEverything().catch(e => { if (status !== 'closed') throw e; });
  await restartFresh();
}

/** Forgets everything held in memory and starts again from what's on this phone now. */
async function restartFresh() {
  started = false;
  generation++;
  forgetSessionCache(); // the old account's access key and sender certificate must not carry over
  myAccount = null; myName = null; myPhone = null; contacts = []; hoods = []; blocked = []; myDeviceId = 1; lastSharedState = ''; agreed = false;
  for (const k of Object.keys(hoodMembers)) delete hoodMembers[k];
  for (const k of Object.keys(hoodMeta)) delete hoodMeta[k];
  savedHoodData = {}; savedCur = undefined; accessKeys = {}; myPic = undefined; pics = {};
  resetGroups();
  actions.resetAll();
  setStatus('starting');
  await startSecureMessaging();
}

/* ---------- moving to a new phone ---------- */
// The new phone shows a QR code holding a random transfer ID and key. The old phone scans it, stops
// syncing, encrypts everything with that key and uploads it. The new phone downloads it, takes the
// account over and tells the relay it's done; the old phone sees that and wipes itself. Only one
// phone can use the account at a time, so nothing arrives on the old phone after it's exported.

export type TransferStep = string;

/** Old phone: moves this account to the phone that's showing `qr`. Resolves 'moved' (this phone is
 *  then empty) or 'timeout' (nothing changed; syncing resumes). */
export async function moveAccountOut(qr: string, onStep: (s: TransferStep) => void): Promise<'moved' | 'timeout'> {
  if (!Crypto || !myAccount) throw new Error('This phone has no account to move.');
  const t = parseTransfer(qr);
  if (!t) throw new Error('That QR code isn’t a transfer code from It’s a Lifestyle.');
  generation++; // stop receiving: anything that arrives now waits on the relay for the new phone
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  onStep('Packing up your chats and keys…');
  await writeVault();
  try {
    const blob = await Crypto.exportTransfer(t.key);
    onStep('Encrypting and sending…');
    await uploadTransfer(t.id, t.key, blob, (done, all) => onStep(`Sending… ${Math.round((done / all) * 100)}%`));
    onStep('Waiting for your new phone…');
    const until = Date.now() + 15 * 60_000;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 3000));
      if ((await transferStatus(t.id).catch(() => 'error' as const)) === null) {
        await Crypto.forgetLocally();
        await restartFresh();
        return 'moved';
      }
    }
    pollLoop(++generation);
    return 'timeout';
  } catch (e) {
    pollLoop(++generation);
    throw e;
  }
}

/** New phone: makes a transfer code to show as a QR code, and a function that waits for the old
 *  phone and takes the account over. Only for a phone with nothing on it yet. */
export function prepareMoveIn() {
  const t = newTransfer();
  const wait = async (onStep: (s: TransferStep) => void, cancelled: () => boolean) => {
    if (!Crypto) throw new Error('This needs the full app build.');
    if (hoods.length || contacts.length) throw new Error('This phone already has neighborhoods. Delete its account first (Me → Delete my account).');
    const until = Date.now() + 30 * 60_000;
    let st: { parts: number; ready: number } | null = null;
    while (Date.now() < until && !cancelled()) {
      st = await transferStatus(t.id).catch(() => null);
      if (st && st.ready === st.parts) break;
      if (st) onStep(`Receiving… ${Math.round((st.ready / st.parts) * 100)}%`);
      await new Promise(r => setTimeout(r, 2500));
    }
    if (cancelled()) return false;
    if (!st || st.ready !== st.parts) throw new Error('Nothing arrived from your old phone. Try again.');
    onStep('Unpacking…');
    const blob = await downloadTransfer(t.id, st.parts);
    generation++;
    // This phone's own empty account is no longer needed.
    await deleteEverything().catch(() => {});
    await Crypto.importTransfer(blob, t.key);
    await finishTransfer(t.id, t.key);
    await restartFresh();
    return true;
  };
  return { qr: t.qr, wait };
}

const parseTransfer = (qr: string) => {
  const m = /^itsalifestyle-transfer:([0-9a-f]{32}):([0-9a-f]{64})$/.exec(qr.trim());
  return m ? { id: m[1], key: m[2] } : null;
};
export const isTransferCode = (qr: string) => !!parseTransfer(qr);

/* ---------- linked devices ---------- */
// The new device shows a QR code with a random ID and key. The phone scans it, gets a one-time approval
// from the relay, and sends the account's identity key, contacts and neighborhoods sealed with that key.
// The new device makes its own session keys. It receives new messages from then on, not chat history.

const parseLink = (qr: string) => {
  const m = /^itsalifestyle-link:([0-9a-f]{32}):([0-9a-f]{64})$/.exec(qr.trim());
  return m ? { id: m[1], key: m[2] } : null;
};
export const isLinkCode = (qr: string) => !!parseLink(qr);
export const myDevices = () => listMyDevices();

/** The phone's side, after the person approves. */
export async function linkDevice(qr: string, onStep: (s: string) => void): Promise<boolean> {
  if (!Crypto || !myAccount) throw new Error('Connect first, then try again.');
  if (isLinkedDevice()) throw new Error('Only your phone can link a device.');
  const t = parseLink(qr);
  if (!t) throw new Error('That QR code isn’t a link code from It’s a Lifestyle.');
  onStep('Getting approval…');
  const { linkToken } = await startDeviceLink();
  const st = getState(), hoodData: NonNullable<Saved['hoodData']> = {};
  for (const h of hoods) {
    const d = st.cur === `r-${h.code}` ? st.plans : st.stash[`r-${h.code}`]?.plans ?? savedHoodData?.[h.code]?.plans ?? [];
    hoodData[h.code] = { plans: d, chats: [] };
  }
  const saved: Saved = { v: 1, agreed, myName, myPhone, contacts, chats: [], hoods, groups: groupState().groups.map(g => ({ ...g, keyed: [] })), outbox: [], hoodData, cur: st.cur, blocked, accessKeys };
  onStep('Encrypting and sending…');
  const blob = await Crypto.exportLink(t.key, JSON.stringify({ linkToken, access: await ensureAccessKey(), saved }));
  await uploadTransfer(t.id, t.key, blob, (done, all) => onStep(`Sending… ${Math.round((done / all) * 100)}%`));
  onStep('Waiting for the other device…');
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, 2500));
    if ((await transferStatus(t.id).catch(() => 'error' as const)) === null) { forgetMyDevices(); lastSharedState = ''; save(); return true; }
  }
  return false;
}

/** The new device's side: shows a code, waits for the phone, then joins the account. */
export function prepareLinkIn() {
  const t = newTransfer(), qr = t.qr.replace('itsalifestyle-transfer:', 'itsalifestyle-link:');
  const wait = async (onStep: (s: string) => void, cancelled: () => boolean) => {
    if (!Crypto) throw new Error('This needs the full app build.');
    if (hoods.length || contacts.length) throw new Error('This device already has neighborhoods. Delete its account first (Me → Delete my account).');
    const until = Date.now() + 15 * 60_000;
    let ready: { parts: number; ready: number } | null = null;
    while (Date.now() < until && !cancelled()) {
      ready = await transferStatus(t.id).catch(() => null);
      if (ready && ready.ready === ready.parts) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (cancelled()) return false;
    if (!ready || ready.ready !== ready.parts) throw new Error('Nothing arrived from your phone. Try again.');
    onStep('Linking…');
    const blob = await downloadTransfer(t.id, ready.parts);
    generation++;
    await deleteEverything().catch(() => {}); // this device's empty account isn't needed
    const text = await Crypto.importLink(blob, t.key);
    const got = JSON.parse(text) as { linkToken: string; access: string; saved: Saved };
    await finishDeviceLink(got.linkToken);
    await adoptAccessKey(got.access);
    await Crypto.vaultWrite(VAULT, JSON.stringify(got.saved));
    await finishTransfer(t.id, t.key);
    await restartFresh();
    // Fresh keys of my own, and everyone's keys for this device.
    rotateMyGroupKeys();
    const people = new Set<string>([...contacts.map(c => c.account), ...Object.values(hoodMembers).flat().map(m => m.account)]);
    people.delete(myAccount ?? '');
    for (const a of people) requestGroupKey(a, true);
    catchUpAll();
    return true;
  };
  return { qr, wait };
}

/** Removes a linked device. It held group keys, so every group moves to new ones. */
export async function removeLinkedDevice(device: number) {
  await removeMyDevice(device);
  rotateAfterDeviceRemoved();
  save();
}
/** A linked device removing itself: only this device is erased; the account lives on. */
export async function unlinkThisDevice() {
  if (!Crypto || myDeviceId === 1) return;
  const d = myDeviceId;
  started = false; generation++;
  await removeMyDevice(d);
  await Crypto.forgetLocally();
  await restartFresh();
}

/* ---------- recovery backup ---------- */
// Optional. Turning it on shows a recovery code once; the account (keys, chats, plans, settings, but not
// photos) is backed up encrypted and refreshed at most once a day while the app is used. Only the key
// derived from the code is kept on this phone (in the encrypted vault), never the code itself.

const BACKUP_VAULT = 'backup-v1';
type BackupInfo = { key: string; lookup: string; last: number };
async function backupInfo(): Promise<BackupInfo | null> {
  try { const raw = await Crypto?.vaultRead(BACKUP_VAULT); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export async function backupStatus(): Promise<{ on: boolean; last?: number }> {
  const b = await backupInfo();
  return b ? { on: true, last: b.last } : { on: false };
}
/** Turns the backup on (or replaces the code). Returns the new recovery code to show once. */
export async function turnOnBackup(): Promise<string> {
  if (!Crypto || !myAccount) throw new Error('Connect first, then try again.');
  if (isLinkedDevice()) throw new Error('Set up the recovery backup on your phone.');
  const code = newRecoveryCode();
  const { key, lookup } = backupSecrets(code);
  await writeVault();
  await uploadBackup(key, lookup);
  await Crypto.vaultWrite(BACKUP_VAULT, JSON.stringify({ key, lookup, last: Date.now() }));
  return code;
}
export async function turnOffBackup() {
  if (!Crypto) return;
  await deleteBackup().catch(() => {});
  await Crypto.vaultWrite(BACKUP_VAULT, '');
}
/** Keeps the backup current: at most once a day. */
async function refreshBackup() {
  if (isLinkedDevice()) return;
  const b = await backupInfo();
  if (!b || Date.now() - b.last < 864e5) return;
  try {
    await writeVault();
    await uploadBackup(b.key, b.lookup);
    await Crypto!.vaultWrite(BACKUP_VAULT, JSON.stringify({ ...b, last: Date.now() }));
  } catch (e) { if (__DEV__) console.log('[backup] refresh failed', String(e)); }
}

export const looksLikeRecoveryCode = isRecoveryCode;

/* ---------- pictures ---------- */
const TONES = ['pine', 'ember', 'plum', 'sky'];
/** Only what a picture may contain: a known color, a short emoji, an attachment reference. */
function cleanPic(p: SharedPic): SharedPic {
  const out: SharedPic = {};
  if (typeof p.tone === 'string' && TONES.includes(p.tone)) out.tone = p.tone;
  if (typeof p.emoji === 'string' && p.emoji.length <= 8 && !/[A-Za-z0-9<>&"'\\/]/.test(p.emoji)) out.emoji = p.emoji;
  const a = p.att;
  if (a && typeof a === 'object' && /^[0-9a-f]{32}$/.test(String(a.id)) && /^[0-9a-f]{64}$/.test(String(a.digest)) && typeof a.key === 'string') out.att = { id: a.id, key: a.key, digest: a.digest };
  return out;
}
/** Shows a picture: color and emoji right away; a photo once it's downloaded and decrypted. */
function showPic(name: string, p: SharedPic | undefined) {
  if (!p || (!p.tone && !p.emoji && !p.att)) return actions.setPic(name, null);
  const base: Pic = { ...(p.tone ? { tone: p.tone as Pic['tone'] } : {}), ...(p.emoji ? { emoji: p.emoji } : {}) };
  if (!p.att) return actions.setPic(name, base);
  const have = getState().pics[name];
  if (have?.att?.digest === p.att.digest && have.uri) return;
  downloadPhoto(p.att).then(uri => actions.setPic(name, { ...base, att: p.att, uri }))
    .catch(e => { if (__DEV__) console.log('[pic] download failed', String(e)); actions.setPic(name, base.tone || base.emoji ? base : null); });
}
function onProfile(account: string, name: string, p: SharedPic) {
  const pic = cleanPic(p);
  if (pic.tone || pic.emoji || pic.att) pics[account] = { name, pic }; else delete pics[account];
  showPic(name, pic);
  save();
}
/** Sets my picture (null: back to initials). A photo is encrypted on this phone and uploaded; only my
 *  neighbors and group chats get its key. */
export async function setMyPicture(p: { tone?: Pic['tone']; emoji?: string; photoUri?: string; keepPhoto?: boolean } | null): Promise<void> {
  const base: SharedPic = p ? { ...(p.tone ? { tone: p.tone } : {}), ...(p.emoji ? { emoji: p.emoji } : {}) } : {};
  // Demo data and Expo Go: nothing to share, just show it here.
  const keptUri = p?.keepPhoto ? getState().pics.You?.uri : undefined;
  if (SAMPLE_MODE || !Crypto || status !== 'ready') { actions.setPic('You', p ? { ...base as Pic, ...(p.photoUri || keptUri ? { uri: p.photoUri ?? keptUri } : {}) } : null); return; }
  let shared = base, uri: string | undefined;
  if (p?.keepPhoto && myPic?.att) { shared = { ...base, att: myPic.att }; uri = keptUri; }
  if (p?.photoUri) {
    const up = await uploadPhoto(p.photoUri, true); // kept about a year, like a neighborhood cover
    shared = { ...base, att: { id: up.att.id, key: up.att.key, digest: up.att.digest } }; uri = up.uri;
  }
  myPic = shared.tone || shared.emoji || shared.att ? shared : undefined;
  actions.setPic('You', myPic ? { ...(shared as Pic), ...(uri ? { uri } : {}) } : null);
  sendMyPicture(shared);
  save();
}
/** Whether this neighbor has a photo I could report. */
export const hasPhoto = (name: string) => !!getState().pics[name]?.uri;

/** A new (empty) phone: restores the account from a recovery code. Neighbors' phones start fresh
 *  conversations with it, and they resend recent messages and plans. */
export async function restoreFromBackup(code: string, onStep: (s: string) => void): Promise<void> {
  if (!Crypto) throw new Error('This needs the full app build.');
  if (!isRecoveryCode(code)) throw new Error('Recovery codes are 24 letters and numbers.');
  if (hoods.length || contacts.length) throw new Error('This phone already has neighborhoods. Delete its account first (Me → Delete my account).');
  onStep('Looking for your backup…');
  const b = await fetchBackup(code);
  if (!b) throw new Error('No backup found for that code. Check it and try again.');
  onStep('Restoring…');
  generation++;
  await deleteEverything().catch(() => {}); // this phone's empty account isn't needed
  await Crypto.importTransfer(b.data, b.key);
  await markAttachmentsNotRestored();
  await republishKeysAfterRestore();
  // Linked devices share conversation keys that a restore replaces: they need linking again.
  await listMyDevices().then(r => Promise.all(r.devices.filter(d => d.device !== 1).map(d => removeMyDevice(d.device)))).catch(() => {});
  // Keep backing up with the same code.
  const { lookup } = backupSecrets(code);
  await Crypto.vaultWrite(BACKUP_VAULT, JSON.stringify({ key: b.key, lookup, last: b.updated }));
  await restartFresh();
  onStep('Reconnecting with your neighbors…');
  resyncAfterRestore();
}

/** Backups leave photos, voice messages and files behind: their messages say so instead of looking empty. */
async function markAttachmentsNotRestored() {
  const raw = await Crypto!.vaultRead(VAULT);
  if (!raw) return;
  const gone = (c: Chat): Chat => ({ ...c, msgs: c.msgs.map(m => ('type' in m && (m.type === 'photo' || m.type === 'voice' || m.type === 'file') ? { ...m, uri: undefined, gone: true } : m)) as Message[] });
  const saved = JSON.parse(raw) as Saved;
  saved.chats = saved.chats.map(gone);
  for (const k of Object.keys(saved.hoodData ?? {})) saved.hoodData![k] = { ...saved.hoodData![k], chats: saved.hoodData![k].chats.map(gone) };
  await Crypto!.vaultWrite(VAULT, JSON.stringify(saved));
}

/** Every saved conversation key is gone, so: ask everyone I know to resend their group keys and recent
 *  items (which also starts fresh 1:1 sessions), and switch my own group keys. */
function resyncAfterRestore() {
  const people = new Set<string>([...contacts.map(c => c.account), ...Object.values(hoodMembers).flat().map(m => m.account)]);
  people.delete(myAccount ?? '');
  rotateMyGroupKeys();
  for (const a of people) requestGroupKey(a, true);
  catchUpAll();
}

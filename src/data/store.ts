import { useRef, useSyncExternalStore } from 'react';
import sample from './sample.json';
import type { Calendar, Chat, Me, Member, Message, Neighborhood, Pic, Plan, Reactions } from './types';
import { ENCRYPTION_LIVE, NOT_ENCRYPTED_WARNING } from './security';
import { canLog, phaseOf, prettyISO, signupOpen, splitTeams } from './challenge';
import { applyOp, opPlanId, type PlanOp } from './planOps';

// A small in-memory store. Screens read through useStore() and change data only through
// the actions below, so swapping in the encrypted messaging backend later touches this file only.

// One neighborhood's world. Switching neighborhoods swaps these in and out.
type HoodData = { hood: Neighborhood; plans: Plan[]; chats: Chat[]; cals: Calendar[] };

export type State = HoodData & {
  me: Me; favorites: string[]; groups: { name: string; members: string[] }[]; verified: string[];
  cur: string; hoodList: { id: string; name: string }[]; stash: Record<string, HoodData>;
  /** Pictures by display name ('You' is mine). People without one show their initials. */
  pics: Record<string, Pic>;
};

/** The sample neighborhood (the prototype's data) exists only in development builds.
 *  Release builds (TestFlight, App Store) start empty: pick a name, then join or start a neighborhood.
 *  To try the empty start in development: EXPO_PUBLIC_NO_SAMPLE=1 npx expo start */
export const SAMPLE_MODE = __DEV__ && process.env.EXPO_PUBLIC_NO_SAMPLE !== '1';

/** Development only: EXPO_PUBLIC_SCREENSHOTS=1 hides the sample's lake drawing and shows its chats as encrypted,
 *  the way real neighborhoods look in App Store screenshots. */
const SCREENSHOTS = __DEV__ && process.env.EXPO_PUBLIC_SCREENSHOTS === '1';
const PLACES: [string, string][] = [['"map":"lake"', '"map":""']];
// Screenshot mode also shows the sample chats the way real ones look: encrypted group and 1:1 chats.
// (Sample photos and key-change notes are left out: they only make sense in the unencrypted demo.)
type SampleMsg = { f: string; t?: string; type?: string };
const tidy = (msgs: SampleMsg[]) => msgs.filter(m => m.f !== 'device' && m.f !== 'key' && m.type !== 'photo');
const asRealChats = (d: typeof sample): typeof sample => ({ ...d, chats: d.chats.map(c => (
  c.id === 'c-tj' ? { ...c, secure: { account: 'sample', verified: true }, msgs: [...tidy(c.msgs as SampleMsg[]),
      { f: 'You', t: 'On our way! Bringing marshmallows.' }, { f: 'Paul & Kate', t: 'Perfect. Kids are already down by the water.' }] }
    : ['c-lake', 'c-hike', 'c-dave'].includes(c.id) ? { ...c, shared: { group: `sample-${c.id}` }, timer: 'Off', members: Math.min(c.members, 12), msgs: tidy(c.msgs as SampleMsg[]) } : c)) as typeof d.chats });
const sampleData: typeof sample = SCREENSHOTS
  ? asRealChats(JSON.parse(PLACES.reduce((s, [a, b]) => s.replaceAll(a, b), JSON.stringify(sample))))
  : sample;

const sampleState = (): State => ({
  me: sampleData.me as Me,
  hood: sampleData.hood as unknown as Neighborhood,
  plans: sampleData.gatherings as unknown as Plan[],
  chats: sampleData.chats as unknown as Chat[],
  cals: sampleData.cals as Calendar[],
  favorites: sampleData.favorites,
  groups: sampleData.groups,
  verified: sampleData.verified,
  cur: 'sample',
  hoodList: [{ id: 'sample', name: (sampleData.hood as { name: string }).name }],
  stash: {},
  pics: {},
});
const emptyHood: Neighborhood = { name: '', about: '', owner: '', owners: [], code: '', places: [], inviters: 'everyone', joined: false, more: 0, members: [], extra: [] };
const emptyState = (): State => ({
  me: { ...(sampleData.me as Me), street: '', devices: [], visPeople: {}, calPref: null },
  hood: emptyHood, plans: [], chats: [], cals: [],
  favorites: [], groups: [], verified: [], cur: '', hoodList: [], stash: {}, pics: {},
});

let state: State = SAMPLE_MODE ? sampleState() : emptyState();

const listeners = new Set<() => void>();
const TIMER_MS: Record<string, number> = { '1 day': 864e5, '1 week': 7 * 864e5 };
/** A new message in a chat with a timer gets its expiry here, whichever path added it. `exp: 0` means "keep". */
const needsExpiry = (m: Message) => m.f !== 'sys' && m.f !== 'key' && !('exp' in m && m.exp !== undefined);
const stampChats = (cs: Chat[]) => {
  let changed = false;
  const next = cs.map(c => {
    const ms = TIMER_MS[c.timer ?? ''];
    if (!ms || !c.msgs.some(needsExpiry)) return c;
    changed = true;
    return { ...c, msgs: c.msgs.map(m => (needsExpiry(m) ? { ...m, exp: Date.now() + ms } as Message : m)) };
  });
  return changed ? next : cs;
};
const stamp = (s: State): State => {
  const chats = stampChats(s.chats);
  let stash = s.stash;
  for (const [k, v] of Object.entries(s.stash)) { if (!v.chats) continue; const n = stampChats(v.chats); if (n !== v.chats) stash = { ...stash, [k]: { ...v, chats: n } }; }
  return chats === s.chats && stash === s.stash ? s : { ...s, chats, stash };
};
let expiredListener: (uris: string[]) => void = () => {};
/** Told which saved files belonged to messages that just disappeared, so they're erased too. */
export const onMessagesExpired = (f: (uris: string[]) => void) => { expiredListener = f; };
const set = (fn: (s: State) => State) => { state = stamp(fn(state)); listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

// Selectors may build new arrays or objects (filter, map, `?? []`). Returning a fresh one every time
// makes React re-render forever, so results are cached per state and selector, and a result whose
// items are all the same as last time is replaced by the previous one.
const sameItems = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

export function useStore<T>(select: (s: State) => T): T {
  const cache = useRef<{ s: State; f: (s: State) => T; v: T } | null>(null);
  const get = () => {
    const prev = cache.current;
    if (prev && prev.s === state && prev.f === select) return prev.v;
    let v = select(state);
    if (prev && sameItems(prev.v, v)) v = prev.v;
    cache.current = { s: state, f: select, v };
    return v;
  };
  return useSyncExternalStore(subscribe, get, get);
}
export const getState = () => state;
/** For the encrypted sync layer: notified after every change. */
export const subscribeStore = subscribe;
/** For src/data/secure only: the encrypted-chat layer updates state through this. */
export const mutate = (fn: (s: State) => State) => set(fn);
/** Encrypted chats belong to you, not to a neighborhood, so they follow you when you switch. */
/** Encrypted 1:1 chats and group chats belong to you, not to one neighborhood (a plan's chat stays with its plan). */
const followsMe = (c: Chat) => !!c.secure || (!!c.shared && !c.shared.plan);
const secureOnly = (chats: Chat[]) => chats.filter(followsMe);

/* ---------- shared plans ----------
 * Changes to plans go through runOp: applied here as "You", then handed to the encrypted sync layer
 * (src/data/secure/sync.ts registers onPlanOp), which sends them to the neighborhood if it's a real one. */
let opListener: ((hoodId: string, op: PlanOp, prev?: Plan) => void) | null = null;
export const onPlanOp = (f: (hoodId: string, op: PlanOp, prev?: Plan) => void) => { opListener = f; };
/* Real neighborhoods: owner actions also go to the relay (src/data/secure/sync.ts registers this). */
export type HoodChange = { t: 'settings' } | { t: 'owner'; name: string; on: boolean } | { t: 'remove'; name: string };
let hoodListener: ((hoodId: string, ch: HoodChange) => void) | null = null;
export const onHoodChange = (f: (hoodId: string, ch: HoodChange) => void) => { hoodListener = f; };
const hoodChanged = (ch: HoodChange) => { if (state.hood.remote) hoodListener?.(state.cur, ch); };
let entrySeq = 0;
const newEntryId = () => `e${Date.now().toString(36)}${(entrySeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function runOp(op: PlanOp) {
  const id = opPlanId(op);
  set(s => ({ ...s, plans: s.plans.map(p => (p.id === id ? applyOp(p, op, 'You', { authorIsHost: p.host === 'You' }) : p)) }));
  opListener?.(state.cur, op);
}

const updatePlan = (id: string, fn: (p: Plan) => Plan) =>
  set(s => ({ ...s, plans: s.plans.map(p => (p.id === id ? fn(p) : p)) }));
const toggleIn = (list: string[] = [], who: string) => (list.includes(who) ? list.filter(x => x !== who) : [...list, who]);
/** The host, or someone the host made an editor. */
export const canEdit = (p: Plan, who: string) => p.host === who || (p.editors ?? []).includes(who);

const toggleReaction = (r: Reactions = {}, e: string): Reactions => ({ ...r, [e]: toggleIn(r[e], 'You') });
/** The first calendar is the whole neighborhood's and carries its name. A custom calendar can already have
 *  that name, and plans find calendars by name, so the main one stays distinct. */
const withHoodName = (cals: Calendar[], name: string): Calendar[] => {
  const main = cals[0];
  if (!main) return cals;
  const taken = cals.slice(1).some(c => c.name.toLowerCase() === name.toLowerCase());
  const next = taken ? `${name} (everyone)` : name;
  return main.name === next ? cals : [{ ...main, name: next }, ...cals.slice(1)];
};

/* ---------- derived ---------- */
const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
/** How many calendar days a plan covers (meal trains, challenges and multi-day plans span several). */
export function spanDays(p: Plan): number {
  if (p.days) return p.days.length;
  const endISO = p.end ?? p.challenge?.end;
  if (!endISO) return 1;
  const start = new Date(p.y ?? 2026, p.m - 1, p.d), [ey, em, ed] = endISO.split('-').map(Number);
  return Math.max(1, Math.round((new Date(ey, em - 1, ed).getTime() - start.getTime()) / 864e5) + 1);
}
/** The plan's last day as YYYY-MM-DD. */
export const lastDayOf = (p: Plan) => { const d = new Date(p.y ?? 2026, p.m - 1, p.d + spanDays(p) - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Finished: its last day is before today. Beacons and polls aren't "past plans". */
export const isPast = (p: Plan) => !p.live && p.type !== 'poll' && lastDayOf(p) < todayStr();
export const slotsOf = (p: Plan) => (p.days ?? []).flatMap(d => d.slots);
export const openCount = (p: Plan) =>
  p.days ? slotsOf(p).filter(x => !x.by).length : p.lists ? p.lists.flatMap(l => l.items).filter(x => !x.by).length : 0;
export const planDate = (p: Plan) => new Date(p.y ?? 2026, p.m - 1, p.d);
export const byDate = (a: Plan, b: Plan) => planDate(a).getTime() - planDate(b).getTime();
export const hoodCount = (h: Neighborhood) => h.more + h.members.length;
export type Group = { name: string; members: string[] };
export const groupIn = (g: Group, list: string[]) => g.members.length > 0 && g.members.every(m => list.includes(m));
// "Dock crew, Lena W." — whole groups by name, then anyone not covered by one.
export function inviteSummary(list: string[], groups: Group[] = state.groups) {
  const whole = groups.filter(g => groupIn(g, list));
  const covered = new Set(whole.flatMap(g => g.members));
  return [...whole.map(g => g.name), ...list.filter(n => !covered.has(n))].join(', ');
}
export function audienceText(p: Plan, hood: Neighborhood) {
  if (p.audience === 'all') return `All of ${hood.name}`;
  if (p.audience.startsWith('cal:')) return `${p.audience.slice(4)} calendar`;
  if (p.audience === 'except') return `Everyone except ${inviteSummary(p.excluded ?? [])}`;
  return `Invited: ${inviteSummary(p.invited ?? [])}`;
}
const shortDay = (iso: string, weekday = true) => new Date(`${iso}T12:00`).toLocaleDateString('en-US', weekday ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
export const whenText = (p: Plan) =>
  p.challenge ? `${shortDay(p.challenge.start, false)} to ${shortDay(p.challenge.end, false)}`
  : p.live ? p.when ?? 'Now'
  : p.end ? `${planDate(p).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} to ${shortDay(p.end)}${p.time ? ` · starts ${p.time}` : ''}`
  : `${planDate(p).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}${p.time ? ` · ${p.time}` : ''}`;
/** Finished plans are kept this long so they can be copied for next time. */
export const KEEP_PAST_DAYS = 90;

/* ---------- actions ---------- */

export const actions = {
  rsvp(id: string, k: 'going' | 'maybe' | 'no') {
    const p = state.plans.find(x => x.id === id);
    if (!p) return;
    const v = p.rsvp === k ? null : k;
    runOp({ t: 'rsvp', id, v });
    if (v === 'going' && !p.live && !(p.remind ?? []).length && state.me.remindDefault !== 'None') updatePlan(id, q => ({ ...q, remind: [state.me.remindDefault] }));
  },
  claimItem(id: string, li: number, ii: number) {
    const it = state.plans.find(x => x.id === id)?.lists?.[li]?.items[ii];
    if (!it || (it.by && it.by !== 'You')) return;
    runOp({ t: 'claim', id, li, ii, on: it.by !== 'You' });
  },
  addItem(id: string, name: string) {
    const p = state.plans.find(x => x.id === id);
    if (p?.lists?.length) runOp({ t: 'addItem', id, name, mine: p.type !== 'help' });
  },
  claimMeal(id: string, di: number, si: number) {
    const sl = state.plans.find(x => x.id === id)?.days?.[di]?.slots[si];
    if (!sl || (sl.by && sl.by !== 'You')) return;
    runOp({ t: 'meal', id, di, si, on: sl.by !== 'You' });
    const p = state.plans.find(x => x.id === id)!;
    if (p.days?.some(d => d.slots.some(x => x.by === 'You')) && !(p.remind ?? []).length) updatePlan(id, q => ({ ...q, remind: ['Morning of my meal'] }));
  },
  // Organizer controls: add a meal to a day (kept in Lunch, Dinner order) or remove an open one.
  addMeal(id: string, di: number, meal: 'Lunch' | 'Dinner') { runOp({ t: 'addMeal', id, di, meal }); },
  removeMeal(id: string, di: number, si: number) { runOp({ t: 'rmMeal', id, di, si }); },
  setCalCopy(id: string, copy: Plan['calCopy']) {
    updatePlan(id, p => ({ ...p, calCopy: copy }));
  },
  setCalPref(v: 'phone' | 'google' | null) {
    set(s => ({ ...s, me: { ...s.me, calPref: v } }));
  },
  setMealNote(id: string, di: number, si: number, what: string) { runOp({ t: 'mealNote', id, di, si, what }); },
  reactPost(id: string, e: string) {
    const p = state.plans.find(x => x.id === id);
    if (p) runOp({ t: 'react', id, e, on: !(p.r?.[e] ?? []).includes('You') });
  },
  toggleRemind(id: string, o: string) {
    updatePlan(id, p => ({ ...p, remind: toggleIn(p.remind, o) }));
  },
  vote(id: string, i: number) {
    const o = state.plans.find(x => x.id === id)?.options?.[i];
    if (o) runOp({ t: 'vote', id, i, on: !o.v.includes('You') });
  },
  /* challenges */
  /** Sign up (or drop out before it starts). With "pick your team" teams, pass the team. */
  joinChallenge(id: string, team?: string): string | null {
    const p = state.plans.find(x => x.id === id), ch = p?.challenge;
    if (!p || !ch) return 'That challenge is gone.';
    if (p.going.includes('You')) {
      if (todayStr() >= ch.start) return 'The challenge has started, so you can’t drop out now.';
      runOp({ t: 'join', id, on: false });
      return null;
    }
    if (!signupOpen(ch)) return 'Sign-up for this challenge has closed.';
    if (ch.teams?.assign === 'choose' && !(team && ch.teams.names.includes(team))) return 'Pick a team first.';
    runOp({ t: 'join', id, on: true, team });
    return null;
  },
  /** Organizer: put someone on a team (or split everyone without a team evenly at random). */
  setTeam(id: string, who: string, team: string) {
    const t = state.plans.find(x => x.id === id)?.challenge?.teams;
    if (t) runOp({ t: 'teams', id, of: { ...t.of, [who]: team } });
  },
  splitTeams(id: string) {
    const p = state.plans.find(x => x.id === id), t = p?.challenge?.teams;
    if (p && t) runOp({ t: 'teams', id, of: splitTeams(p.going, t.names, t.of) });
  },
  /** Log (or, with `replaceId`, edit) your own entry. Honor system, with sanity checks. */
  logActivity(id: string, e: { day: string; what: string; amount: number; level: number }, replaceId?: string): string | null {
    const p = state.plans.find(x => x.id === id);
    const ch = p?.challenge;
    if (!p || !ch) return 'That challenge is gone.';
    if (!p.going.includes('You')) return 'Sign up first.';
    if (!canLog(ch)) return phaseOf(ch) === 'upcoming' ? `Logging opens ${prettyISO(ch.start)}.` : 'This challenge is closed for logging.';
    const max = ch.mode === 'time' ? 600 : ch.mode === 'distance' ? 200 : ch.mode === 'count' ? 10000 : 50;
    if (!Number.isFinite(e.amount) || e.amount <= 0 || e.amount > max) return `Enter an amount between 1 and ${max}.`;
    if (e.day < ch.start || e.day > ch.end) return 'That day isn’t part of the challenge.';
    if (e.day > todayStr()) return 'You can’t log a day that hasn’t happened yet.';
    if (ch.mode === 'checkin' && ch.log.some(x => x.who === 'You' && x.day === e.day && x.id !== replaceId)) return 'You already checked in for that day.';
    if (ch.mode === 'tasks' && !ch.tasks?.some(t => t.name === e.what)) return 'Pick a task.';
    const amount = ch.mode === 'time' || ch.mode === 'count' ? Math.round(e.amount) : Math.round(e.amount * 100) / 100;
    runOp({ t: 'log', id, entry: { id: replaceId ?? newEntryId(), day: e.day, what: e.what, amount, level: ch.levels[e.level] ? e.level : 0 } });
    return null;
  },
  // You can only remove your own entries.
  removeEntry(id: string, entryId: string) { runOp({ t: 'unlog', id, entryId }); },
  /** Sets or clears someone's picture (by display name; 'You' for mine). */
  setPic(name: string, pic: Pic | null) {
    set(s => { const pics = { ...s.pics }; if (pic && (pic.tone || pic.emoji || pic.uri)) pics[name] = pic; else delete pics[name]; return { ...s, pics }; });
  },
  addPlan(p: Plan) {
    set(s => ({ ...s, plans: [p, ...s.plans] }));
    opListener?.(state.cur, { t: 'plan', plan: p });
  },
  /** Host or an editor: save changes to a posted plan (sign-ups, RSVPs and the like are kept). */
  editPlan(next: Plan) {
    const prev = state.plans.find(x => x.id === next.id);
    if (!prev || !canEdit(prev, 'You')) return;
    if (prev.host !== 'You') { next = { ...next, host: prev.host, editors: prev.editors }; } // only the host changes who can edit
    set(s => ({ ...s, plans: s.plans.map(x => (x.id === next.id ? next : x)), chats: s.chats.map(c => (c.gid === next.id ? { ...c, name: next.title } : c)) }));
    opListener?.(state.cur, { t: 'plan', plan: next }, prev);
  },
  /** Host: cancel a plan. It disappears for everyone, with its chat. */
  cancelPlan(id: string) {
    const prev = state.plans.find(x => x.id === id);
    if (!prev || prev.host !== 'You') return;
    set(s => ({ ...s, plans: s.plans.filter(x => x.id !== id), chats: s.chats.filter(c => c.gid !== id) }));
    opListener?.(state.cur, { t: 'cancel', id }, prev);
  },
  /** The neighborhood board (plans for everyone, read from the relay). `rebuild`: take the board's copy
   *  and replay every change on it; otherwise just apply the changes this phone hasn't seen. Plans this
   *  phone got from the board that are no longer on it were cancelled. */
  boardMerge(hoodId: string, items: { plan: Plan; bu: number; rebuild: boolean; ops: { op: PlanOp; who: string }[] }[], onBoard: Set<string>) {
    const merge = (plans: Plan[]): Plan[] => {
      let out = plans.filter(p => !(p.bu && !onBoard.has(p.id)));
      for (const it of items) {
        const have = out.find(p => p.id === it.plan.id);
        let p: Plan | undefined = it.rebuild ? { ...it.plan, remind: have?.remind ?? [], calCopy: have?.calCopy ?? null } : have;
        if (!p) continue;
        for (const { op, who } of it.ops) if (op.t !== 'plan' && op.t !== 'cancel' && opPlanId(op) === p.id) p = applyOp(p, op, who, { authorIsHost: canEdit(p, who) });
        const rsvp = p.going.includes('You') ? 'going' : p.maybe?.includes('You') ? 'maybe' : have?.rsvp === 'no' ? 'no' : null;
        const next: Plan = { ...p, rsvp, bu: Math.max(it.bu, have?.bu ?? 0) };
        out = have ? out.map(x => (x.id === next.id ? next : x)) : [next, ...out];
      }
      return out;
    };
    set(s => {
      if (s.cur === hoodId) return { ...s, plans: merge(s.plans) };
      const h = s.stash[hoodId];
      return h ? { ...s, stash: { ...s.stash, [hoodId]: { ...h, plans: merge(h.plans) } } } : s;
    });
  },
  /** A plan or a change arrived from a neighbor (already decrypted). `who` is their name. */
  applyRemote(hoodId: string, op: PlanOp, who: string) {
    const apply = (plans: Plan[]): Plan[] => {
      if (op.t === 'plan') {
        const incoming = op.plan;
        const i = plans.findIndex(x => x.id === incoming.id);
        const have = i < 0 ? undefined : plans[i];
        // The host publishes and edits their plan; editors the host chose may edit it too, but the host
        // and the editor list stay as the host set them.
        const byEditor = !!have && incoming.host !== who && have.host === incoming.host && (have.editors ?? []).includes(who);
        if (incoming.host !== who && !byEditor) return plans;
        if (byEditor) incoming.editors = have!.editors;
        // A host's edit to a challenge changes its settings only: sign-ups, teams and everyone's log stay as this phone has them.
        const keep = (x: Plan): Plan => (x.challenge && incoming.challenge ? { going: x.going, challenge: { ...incoming.challenge, log: x.challenge.log, teams: x.challenge.teams } } as Plan : {} as Plan);
        return i < 0 ? [incoming, ...plans] : plans.map(x => (x.id === incoming.id ? { ...incoming, ...keep(x), rsvp: x.rsvp, remind: x.remind, calCopy: x.calCopy } : x));
      }
      if (op.t === 'cancel') return plans.filter(x => !(x.id === op.id && x.host === who));
      if (!plans.some(x => x.id === opPlanId(op))) return plans;
      return plans.map(x => (x.id !== opPlanId(op) ? x : applyOp(x, op, who, { authorIsHost: canEdit(x, who) })));
    };
    // A cancelled plan takes its chat with it.
    const dropChats = (chats: Chat[], plans: Plan[]) => (op.t === 'cancel' && !plans.some(x => x.id === op.id) ? chats.filter(c => c.gid !== op.id) : chats);
    set(s => {
      if (s.cur === hoodId) { const plans = apply(s.plans); return { ...s, plans, chats: dropChats(s.chats, plans) }; }
      const h = s.stash[hoodId];
      if (!h) return s;
      const plans = apply(h.plans);
      return { ...s, stash: { ...s.stash, [hoodId]: { ...h, plans, chats: dropChats(h.chats, plans) } } };
    });
  },
  /** Restores a real neighborhood's saved plans and plan chats (from the encrypted vault). */
  restoreHoodData(hoodId: string, plans: Plan[], chats: Chat[]) {
    const merge = <T extends { id: string }>(have: T[], add: T[]) => [...add.filter(a => !have.some(h => h.id === a.id)), ...have];
    set(s => {
      if (s.cur === hoodId) return { ...s, plans: merge(s.plans, plans), chats: merge(s.chats, chats) };
      const h = s.stash[hoodId];
      return h ? { ...s, stash: { ...s.stash, [hoodId]: { ...h, plans: merge(h.plans, plans), chats: merge(h.chats, chats) } } } : s;
    });
  },
  /** Adds a message to a chat (creating the chat if needed), in whichever neighborhood holds it. */
  appendChat(hoodId: string | null, chat: Chat, msg: Message) {
    const add = (chats: Chat[]) => {
      const have = chats.find(c => c.id === chat.id);
      if (have?.msgs.some(m => 'mid' in m && 'mid' in msg && m.mid && m.mid === msg.mid)) return chats;
      return have ? chats.map(c => (c.id === chat.id ? { ...c, msgs: [...c.msgs, msg] } : c)) : [{ ...chat, msgs: [...chat.msgs, msg] }, ...chats];
    };
    set(s => {
      if (!hoodId || s.cur === hoodId) return { ...s, chats: add(s.chats) };
      const h = s.stash[hoodId];
      return h ? { ...s, stash: { ...s.stash, [hoodId]: { ...h, chats: add(h.chats) } } } : s;
    });
  },
  /** Updates one message's delivery status. */
  /** Changes one message (by its encrypted ID) wherever its chat is: open neighborhood or stashed. */
  patchChatMsg(chatId: string, mid: string, patch: Record<string, unknown>) {
    const fix = (cs: Chat[]) => cs.map(c => (c.id !== chatId ? c : { ...c, msgs: c.msgs.map(m => ('mid' in m && m.mid === mid ? { ...m, ...patch } as Message : m)) }));
    set(s => ({ ...s, chats: fix(s.chats), stash: Object.fromEntries(Object.entries(s.stash).map(([k, v]) => [k, { ...v, chats: fix(v.chats) }])) }));
  },
  setChatMsgStatus(chatId: string, mid: string, status: 'sending' | 'sent' | 'failed') {
    set(s => ({ ...s, chats: s.chats.map(c => (c.id !== chatId ? c : { ...c, msgs: c.msgs.map(m => ('mid' in m && m.mid === mid ? { ...m, status } : m)) })) }));
  },
  /** Plans in a neighborhood (current or not), for catching up a new member. */
  plansOf(hoodId: string): Plan[] {
    return state.cur === hoodId ? state.plans : state.stash[hoodId]?.plans ?? [];
  },
  sendMessage(chatId: string, text: string) {
    set(s => ({ ...s, chats: s.chats.map(c => (c.id === chatId ? { ...c, msgs: [...c.msgs, { f: 'You', t: text }] } : c)) }));
  },
  sendRich(chatId: string, msg: { t?: string; type: 'photo' | 'file' | 'loc' | 'voice'; uri?: string; alt?: string; name?: string; size?: string; dur?: string; geo?: string }) {
    set(s => ({ ...s, chats: s.chats.map(c => (c.id === chatId ? { ...c, msgs: [...c.msgs, { f: 'You', ...msg }] } : c)) }));
  },
  // New messages get an expiry while the timer is on. Older messages keep theirs, like other secure messengers.
  setChatTimer(chatId: string, timer: string, by = 'You') {
    const note = timer === 'Off' ? `${by} turned off disappearing messages.` : `${by} set new messages to disappear after ${timer}.`;
    const fix = (cs: Chat[]) => cs.map(c => (c.id !== chatId || (c.timer ?? 'Off') === timer ? c : { ...c, timer,
      msgs: [...c.msgs.map(m => (needsExpiry(m) ? { ...m, exp: 0 } as Message : m)), { f: 'sys', t: note }] }));
    set(s => ({ ...s, chats: fix(s.chats), stash: Object.fromEntries(Object.entries(s.stash).map(([k, v]) => [k, v.chats ? { ...v, chats: fix(v.chats) } : v])) }));
  },
  /** Clears the blank note used to make sure a chat exists. */
  dropEmptyNotes(chatId: string) {
    const fix = (cs: Chat[]) => cs.map(c => (c.id !== chatId ? c : { ...c, msgs: c.msgs.filter(m => !(m.f === 'sys' && m.t === '')) }));
    set(s => ({ ...s, chats: fix(s.chats), stash: Object.fromEntries(Object.entries(s.stash).map(([k, v]) => [k, v.chats ? { ...v, chats: fix(v.chats) } : v])) }));
  },
  // Removes expired messages from every chat, in every neighborhood. Runs on a timer and when the app opens.
  pruneExpired() {
    const now = Date.now(), gone: string[] = [];
    const prune = (chats: Chat[]) => {
      let changed = false;
      const next = chats.map(c => {
        const msgs = c.msgs.filter(m => !('exp' in m) || !m.exp || m.exp > now);
        if (msgs.length === c.msgs.length) return c;
        for (const m of c.msgs) if ('exp' in m && m.exp && m.exp <= now && 'uri' in m && m.uri) gone.push(m.uri);
        changed = true;
        return { ...c, msgs };
      });
      return changed ? next : chats;
    };
    // Finished plans are kept 3 months (to copy for next time), then removed.
    const cutoffD = new Date(); cutoffD.setDate(cutoffD.getDate() - KEEP_PAST_DAYS);
    const cutoff = `${cutoffD.getFullYear()}-${String(cutoffD.getMonth() + 1).padStart(2, '0')}-${String(cutoffD.getDate()).padStart(2, '0')}`;
    const keep = (p: Plan) => p.live || p.type === 'poll' || lastDayOf(p) >= cutoff;
    if (state.plans.some(p => !keep(p))) set(s => ({ ...s, plans: s.plans.filter(keep) }));
    const chats = prune(state.chats);
    const stash = Object.fromEntries(Object.entries(state.stash).map(([k, v]) => [k, v.chats ? { ...v, chats: prune(v.chats) } : v]));
    const stashChanged = Object.keys(stash).some(k => stash[k].chats !== state.stash[k].chats);
    if (chats !== state.chats || stashChanged) set(s => ({ ...s, chats, stash: stashChanged ? stash : s.stash }));
    if (gone.length) expiredListener(gone);
  },
  // A group chat from the people you picked. One person reuses or opens a direct message.
  createChat(people: string[], name?: string): string {
    if (people.length === 1) return actions.dmWith(people[0]);
    const exact = state.groups.find(g => g.members.length === people.length && g.members.every(m => people.includes(m)));
    const title = name?.trim() || exact?.name || people.slice(0, 3).join(', ') + (people.length > 3 ? ` +${people.length - 3}` : '');
    const chat: Chat = { id: `c${Date.now()}`, name: title, members: people.length + 1, people, timer: state.me.sec.disappear, msgs: [{ f: 'sys', t: `You started this chat with ${people.join(', ').replace(/\.$/, '')}.${ENCRYPTION_LIVE ? ' Messages are end-to-end encrypted.' : ''}` }] };
    set(s => ({ ...s, chats: [chat, ...s.chats] }));
    return chat.id;
  },
  reactMessage(chatId: string, i: number, e: string) {
    set(s => ({
      ...s,
      chats: s.chats.map(c => (c.id !== chatId ? c : { ...c, msgs: c.msgs.map((m, k) => (k !== i || !('t' in m || 'type' in m) ? m : { ...m, r: toggleReaction((m as { r?: Reactions }).r, e) })) })),
    }));
  },
  /** Sets one person's reaction on a message (by its ID). `who` is 'You' or a neighbor's name. */
  reactById(chatId: string, mid: string, who: string, e: string, on: boolean) {
    set(s => ({
      ...s,
      chats: s.chats.map(c => (c.id !== chatId ? c : { ...c, msgs: c.msgs.map(m => {
        if (!('mid' in m) || m.mid !== mid) return m;
        const r = { ...((m as { r?: Reactions }).r ?? {}) };
        const list = (r[e] ?? []).filter(x => x !== who);
        if (on) list.push(who);
        if (list.length) r[e] = list; else delete r[e];
        return { ...m, r };
      }) })),
    }));
  },
  openChatFor(planId: string): string {
    const existing = state.chats.find(c => c.gid === planId);
    if (existing) return existing.id;
    const p = state.plans.find(x => x.id === planId)!;
    const chat: Chat = { id: `c-${planId}`, gid: planId, name: p.title, members: p.going.length, timer: state.me.sec.disappear, msgs: [{ f: 'sys', t: 'Chat created. Everyone who can see this plan can join.' }],
      ...(state.hood.remote ? { shared: { group: '', plan: planId }, timer: 'Off' } : {}) };
    set(s => ({ ...s, chats: [chat, ...s.chats] }));
    return chat.id;
  },
  toggleCalendar(i: number) {
    set(s => ({ ...s, cals: s.cals.map((c, k) => (k === i ? { ...c, on: !c.on } : c)) }));
  },
  // Calendars stay inside the neighborhood: no outside or subscription links.
  createCalendar(name: string, members: string[]): boolean {
    if (!name.trim() || state.cals.some(c => c.name.toLowerCase() === name.trim().toLowerCase())) return false;
    const tones: Calendar['tone'][] = ['ember', 'sky', 'plum', 'pine'];
    set(s => ({ ...s, cals: [...s.cals, { name: name.trim(), n: members.length + 1, tone: tones[s.cals.length % 4], on: true, members }] }));
    return true;
  },
  toggleCalendarMember(i: number, name: string) {
    set(s => ({ ...s, cals: s.cals.map((c, k) => {
      if (k !== i) return c;
      const had = (c.members ?? []).includes(name);
      return { ...c, members: toggleIn(c.members, name), n: c.n + (had ? -1 : 1) };
    }) }));
  },
  setVisibility(k: keyof Me['vis'], v: string) {
    set(s => ({ ...s, me: { ...s.me, vis: { ...s.me.vis, [k]: v } } }));
  },
  setSecurity<K extends keyof Me['sec']>(k: K, v: Me['sec'][K]) {
    set(s => ({ ...s, me: { ...s.me, sec: { ...s.me.sec, [k]: v } } }));
  },
  // People picked for "Pick people" on phone, address or location. Picking no one hides the field.
  setVisibilityPeople(k: keyof Me['vis'], people: string[]) {
    set(s => ({
      ...s, me: { ...s.me, visPeople: { ...(s.me.visPeople ?? {}), [k]: people },
        vis: { ...s.me.vis, [k]: people.length ? 'Pick people' : k === 'location' ? 'Off' : 'Nobody' } },
    }));
  },
  removeDevice(i: number) {
    set(s => ({ ...s, me: { ...s.me, devices: s.me.devices.filter((_, k) => k !== i) } }));
  },
  setRemindDefault(v: string) {
    set(s => ({ ...s, me: { ...s.me, remindDefault: v } }));
  },

  /* favorites and groups */
  toggleFavorite(name: string) {
    set(s => ({ ...s, favorites: toggleIn(s.favorites, name) }));
  },
  addGroup(name: string, members: string[]): boolean {
    if (!name.trim() || state.groups.some(g => g.name.toLowerCase() === name.trim().toLowerCase())) return false;
    set(s => ({ ...s, groups: [...s.groups, { name: name.trim(), members }] }));
    return true;
  },
  toggleGroupMember(i: number, name: string) {
    set(s => ({ ...s, groups: s.groups.map((g, k) => (k === i ? { ...g, members: toggleIn(g.members, name) } : g)) }));
  },
  renameGroup(i: number, name: string) {
    if (!name.trim()) return;
    set(s => ({ ...s, groups: s.groups.map((g, k) => (k === i ? { ...g, name: name.trim() } : g)) }));
  },
  deleteGroup(i: number) {
    set(s => ({ ...s, groups: s.groups.filter((_, k) => k !== i) }));
  },

  /* neighborhood */
  setInviters(v: 'everyone' | 'chosen') {
    set(s => ({ ...s, hood: { ...s.hood, inviters: v, members: s.hood.members.map(m => ({ ...m, inv: v === 'everyone' || s.hood.owners.includes(m.n) })) } }));
    hoodChanged({ t: 'settings' });
  },
  toggleCanInvite(name: string) {
    const flip = (list: Member[] = []) => list.map(m => (m.n === name ? { ...m, inv: !m.inv } : m));
    set(s => ({ ...s, hood: { ...s.hood, members: flip(s.hood.members), extra: flip(s.hood.extra) } }));
  },
  newJoinCode() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ', pick = () => a[Math.floor(Math.random() * a.length)];
    set(s => ({ ...s, hood: { ...s.hood, code: `${pick()}${pick()}${pick()}-${1000 + Math.floor(Math.random() * 9000)}` } }));
  },
  saveHood(name: string, about: string, places: string[]) {
    set(s => ({ ...s, hood: { ...s.hood, name, about, places }, cals: withHoodName(s.cals, name), hoodList: s.hoodList.map(h => (h.id === s.cur ? { ...h, name } : h)) }));
    hoodChanged({ t: 'settings' });
  },
  makeOwner(name: string) {
    set(s => ({ ...s, hood: { ...s.hood, owners: s.hood.owners.includes(name) ? s.hood.owners : [...s.hood.owners, name] } }));
    hoodChanged({ t: 'owner', name, on: true });
  },
  removeOwner(name: string): boolean {
    if (state.hood.owners.length <= 1) return false;   // a neighborhood always keeps at least one owner
    set(s => ({ ...s, hood: { ...s.hood, owners: s.hood.owners.filter(n => n !== name) } }));
    hoodChanged({ t: 'owner', name, on: false });
    return true;
  },
  removeMember(name: string) {
    // Removing someone also takes away owner rights. The last owner can't be removed this way.
    if (state.hood.owners.includes(name) && state.hood.owners.length <= 1) return;
    set(s => {
      const inExtra = (s.hood.extra ?? []).some(m => m.n === name);
      return { ...s, hood: { ...s.hood, owners: s.hood.owners.filter(n => n !== name), members: s.hood.members.filter(m => m.n !== name), extra: (s.hood.extra ?? []).filter(m => m.n !== name), more: s.hood.more - (inExtra ? 1 : 0) } };
    });
    hoodChanged({ t: 'remove', name });
  },
  leaveHood(): boolean {
    const others = state.hood.owners.filter(n => n !== 'You');
    if (state.hood.owners.includes('You') && !others.length) return false; // the only owner must name another first
    set(s => ({ ...s, hood: { ...s.hood, joined: false, owners: s.hood.owners.filter(n => n !== 'You') } }));
    return true;
  },
  joinHood(code: string): boolean {
    if (code.trim().toUpperCase() !== state.hood.code) return false;
    set(s => ({ ...s, hood: { ...s.hood, joined: true } }));
    return true;
  },
  /** `remoteCode`: the neighborhood was created on the relay with this (strong) invite code. */
  createHood(input: { name: string; about: string; places: string[]; inviters: 'everyone' | 'chosen'; remoteCode?: string }) {
    const id = input.remoteCode ? `r-${input.remoteCode}` : `h${Date.now()}`;
    const letters = (input.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() + 'XXX').slice(0, 3);
    const hood: Neighborhood = {
      name: input.name, about: input.about, owner: 'You', owners: ['You'], code: input.remoteCode ?? `${letters}-${1000 + Math.floor(Math.random() * 9000)}`,
      places: input.places, inviters: input.inviters, joined: true, more: 0, members: [{ n: 'You', by: 'Started', inv: true }], extra: [],
      ...(input.remoteCode ? { remote: true } : {}),
    };
    set(s => ({
      ...s, stash: s.cur ? { ...s.stash, [s.cur]: { hood: s.hood, plans: s.plans, chats: s.chats.filter(c => !followsMe(c)), cals: s.cals } } : s.stash,
      cur: id, hoodList: [...s.hoodList, { id, name: input.name }],
      hood, plans: [], chats: secureOnly(s.chats), cals: [{ name: input.name, n: 1, tone: 'pine', on: true }],
    }));
  },
  /** Joined a relay neighborhood with its code: add it (or refresh it) and switch to it. */
  addRemoteHood(input: { code: string; name: string; members: Member[] }) {
    const id = `r-${input.code}`;
    if (state.cur === id) return actions.setRemoteMembers(id, input.members);
    if (state.stash[id]) { actions.setRemoteMembers(id, input.members); return actions.switchHood(id); }
    const hood: Neighborhood = {
      name: input.name, about: '', owner: input.members[0]?.n ?? '', owners: input.members[0] ? [input.members[0].n] : [], code: input.code,
      places: [], inviters: 'everyone', joined: true, more: 0, members: input.members, extra: [], remote: true,
    };
    set(s => ({
      ...s, stash: s.cur ? { ...s.stash, [s.cur]: { hood: s.hood, plans: s.plans, chats: s.chats.filter(c => !followsMe(c)), cals: s.cals } } : s.stash,
      cur: id, hoodList: [...s.hoodList.filter(h => h.id !== id), { id, name: input.name }],
      hood, plans: [], chats: secureOnly(s.chats), cals: [{ name: input.name, n: 1, tone: 'pine', on: true }],
    }));
  },
  /** Refreshes a relay neighborhood's member list (current or stashed). */
  setRemoteMembers(id: string, members: Member[]) {
    set(s => {
      if (s.cur === id) return { ...s, hood: { ...s.hood, members } };
      const h = s.stash[id];
      return h ? { ...s, stash: { ...s.stash, [id]: { ...h, hood: { ...h.hood, members } } } } : s;
    });
  },
  switchHood(id: string) {
    if (id === state.cur || !state.stash[id]) return;
    set(s => {
      const next = s.stash[id];
      const stash = { ...s.stash, [s.cur]: { hood: s.hood, plans: s.plans, chats: s.chats.filter(c => !followsMe(c)), cals: s.cals } };
      delete stash[id];
      return { ...s, ...next, chats: [...secureOnly(s.chats), ...next.chats.filter(c => !followsMe(c))], cur: id, stash };
    });
  },
  /** Owner: the picture at the top of the home screen. */
  setCover(cover: Neighborhood['cover']) {
    set(s => ({ ...s, hood: { ...s.hood, cover } }));
    hoodChanged({ t: 'settings' }); // shared neighborhoods: photos are encrypted and shared too
  },
  /** A real neighborhood's shared settings arrived (decrypted on this phone). */
  setRemoteHoodInfo(id: string, info: Partial<Pick<Neighborhood, 'name' | 'about' | 'places' | 'inviters' | 'owners' | 'owner' | 'cover' | 'invite'>>) {
    const patch = (h: Neighborhood): Neighborhood => ({ ...h, ...info, cover: h.cover?.kind === 'photo' && !info.cover ? h.cover : info.cover ?? h.cover });
    set(s => {
      const hoodList = info.name ? s.hoodList.map(h => (h.id === id ? { ...h, name: info.name! } : h)) : s.hoodList;
      const named = (cals: Calendar[]) => (info.name ? withHoodName(cals, info.name) : cals);
      if (s.cur === id) return { ...s, hoodList, hood: patch(s.hood), cals: named(s.cals) };
      const st = s.stash[id];
      return st ? { ...s, hoodList, stash: { ...s.stash, [id]: { ...st, hood: patch(st.hood), cals: named(st.cals) } } } : { ...s, hoodList };
    });
  },
  /** I was removed from a real neighborhood (or it no longer exists): it leaves this phone. */
  forgetHood(id: string) {
    set(s => {
      const hoodList = s.hoodList.filter(h => h.id !== id);
      if (s.cur !== id) { const stash = { ...s.stash }; delete stash[id]; return { ...s, hoodList, stash }; }
      const nextId = hoodList.find(h => s.stash[h.id])?.id;
      if (nextId) {
        const next = s.stash[nextId]; const stash = { ...s.stash }; delete stash[nextId];
        return { ...s, ...next, chats: [...secureOnly(s.chats), ...next.chats.filter(c => !followsMe(c))], cur: nextId, hoodList, stash };
      }
      return { ...s, hoodList, plans: [], chats: secureOnly(s.chats), cur: '', hood: { ...s.hood, joined: false, members: [], owners: [], name: '' } };
    });
  },
  /** The last member can delete the neighborhood. Switches to another one, or to the join screen. */
  deleteHood(): boolean {
    const real = state.hood.members.filter(m => m.n !== 'You');
    if (real.length > 0 || state.hood.more > 0) return false;
    set(s => {
      const others = s.hoodList.filter(h => h.id !== s.cur);
      const nextId = others.find(h => s.stash[h.id])?.id;
      if (nextId) {
        const next = s.stash[nextId]; const stash = { ...s.stash }; delete stash[nextId];
        return { ...s, ...next, chats: [...secureOnly(s.chats), ...next.chats.filter(c => !followsMe(c))], cur: nextId, hoodList: others, stash };
      }
      return { ...s, hoodList: others, plans: [], chats: secureOnly(s.chats), cur: '', hood: { ...s.hood, joined: false, members: [], owners: [], name: '' } };
    });
    return true;
  },
  /** After deleting the account: back to a brand-new start. */
  resetAll() {
    set(() => (SAMPLE_MODE ? sampleState() : emptyState()));
  },
  dmWith(name: string): string {
    const existing = state.chats.find(c => c.members === 2 && c.name === name && !c.gid);
    if (existing) return existing.id;
    const chat: Chat = { id: `c${Date.now()}`, name, members: 2, timer: state.me.sec.disappear, msgs: [{ f: 'sys', t: ENCRYPTION_LIVE ? 'Messages are end-to-end encrypted.' : NOT_ENCRYPTED_WARNING }] };
    set(s => ({ ...s, chats: [chat, ...s.chats] }));
    return chat.id;
  },
};

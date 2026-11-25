import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

// The notification list behind the bell: everything that happened while you weren't looking, each with
// the screen it's about. It lives only on this phone, inside the encrypted vault, like your chats.
// When the app isn't open, the same items also become phone notifications (src/data/notify.ts).

/** What a notification is about. `pref` decides which setting turns it off. */
export type ActivityKind = 'message' | 'plan' | 'change' | 'cancel' | 'response' | 'reaction' | 'reminder' | 'notice';
export type NotifyPref = 'messages' | 'plans' | 'updates' | 'responses' | 'reactions' | 'reminders';
export const PREF_OF: Record<ActivityKind, NotifyPref> = {
  message: 'messages', plan: 'plans', change: 'updates', cancel: 'updates', response: 'responses', reaction: 'reactions', reminder: 'reminders', notice: 'updates',
};
export const PREF_LABELS: [NotifyPref, string, string][] = [
  ['messages', 'Messages', 'New messages in your private, group and plan chats'],
  ['plans', 'New plans', 'Plans, beacons, polls and challenges neighbors post'],
  ['updates', 'Changes to your plans', 'A plan you’re in moves, changes or is cancelled'],
  ['responses', 'Replies to your plans', 'Who’s going, what they’re bringing, votes and sign-ups'],
  ['reactions', 'Reactions', 'Someone reacts to your message or plan'],
  ['reminders', 'Reminders', 'The reminders you set on plans'],
];

export type Activity = {
  id: string; kind: ActivityKind; title: string; body: string; at: number; read: boolean;
  /** The screen it opens (an Expo Router path), and the neighborhood it's in, if it belongs to one. */
  route: string; hood?: string;
  /** Items with the same group (one chat, one plan's sign-ups) collapse into one line while unread. */
  group?: string; n?: number;
};
export type NewActivity = Omit<Activity, 'id' | 'at' | 'read' | 'n'>;

type State = { items: Activity[]; prefs: Partial<Record<NotifyPref, boolean>>; boardKnown: string[] };
let state: State = { items: [], prefs: {}, boardKnown: [] };
const MAX_ITEMS = 200, KEEP_MS = 30 * 864e5;

const subs = new Set<() => void>();
let persist: () => void = () => {};
let onNew: (a: Activity) => void = () => {};
const changed = (save = true) => { subs.forEach(f => f()); if (save) persist(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** The encrypted vault saves this along with the chats. */
export const activityForSave = () => state;
export function loadActivity(saved: Partial<State> | undefined) {
  if (!saved) return;
  const now = Date.now();
  state = {
    items: (saved.items ?? []).filter(a => a && typeof a.route === 'string' && now - a.at < KEEP_MS).slice(0, MAX_ITEMS),
    prefs: saved.prefs ?? {},
    boardKnown: saved.boardKnown ?? [],
  };
  changed(false);
}
export function resetActivity() { state = { items: [], prefs: {}, boardKnown: [] }; changed(false); }
/** `save` writes the vault; `post` shows a phone notification when the app isn't on screen. */
export function initActivity(o: { save: () => void; post: (a: Activity) => void }) { persist = o.save; onNew = o.post; }

/* ---------- what's on screen ---------- */
let viewing = '';
let active = AppState.currentState === 'active';
/** The screen the person is looking at. Opening a chat or plan marks its notifications read. */
export function setViewing(path: string) { viewing = path; markRouteRead(path); }
export function setAppActive(on: boolean) { active = on; if (on) markRouteRead(viewing); }

export const prefOn = (p: NotifyPref) => state.prefs[p] !== false;
export function setPref(p: NotifyPref, on: boolean) { state = { ...state, prefs: { ...state.prefs, [p]: on } }; changed(); }

/** Adds a notification (or folds it into the unread one for the same chat or plan). */
export function addActivity(a: NewActivity) {
  if (!prefOn(PREF_OF[a.kind])) return;
  // Already looking at it: nothing to tell.
  if (active && viewing && a.route !== '/' && viewing === a.route) return;
  const now = Date.now();
  const same = a.group ? state.items.find(x => !x.read && x.group === a.group) : undefined;
  const item: Activity = same
    ? { ...same, ...a, id: same.id, at: now, read: false, n: (same.n ?? 1) + 1 }
    : { ...a, id: `a${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`, at: now, read: false };
  state = { ...state, items: [item, ...state.items.filter(x => x.id !== item.id)].slice(0, MAX_ITEMS) };
  changed();
  onNew({ ...item, n: 1 });
}

export function markRead(id: string, read = true) {
  if (!state.items.some(a => a.id === id && a.read !== read)) return;
  state = { ...state, items: state.items.map(a => (a.id === id ? { ...a, read } : a)) };
  changed();
}
export function markRouteRead(route: string) {
  if (!route || !state.items.some(a => a.route === route && !a.read)) return;
  state = { ...state, items: state.items.map(a => (a.route === route ? { ...a, read: true } : a)) };
  changed();
}
export function markAllRead() {
  if (!state.items.some(a => !a.read)) return;
  state = { ...state, items: state.items.map(a => ({ ...a, read: true })) };
  changed();
}
export function removeActivity(id: string) { state = { ...state, items: state.items.filter(a => a.id !== id) }; changed(); }
export function clearActivity() { state = { ...state, items: [] }; changed(); }
/** A plan that's gone (cancelled, or the neighborhood was left): its notifications go too. */
export function dropActivityFor(route: string) {
  if (!state.items.some(a => a.route === route)) return;
  state = { ...state, items: state.items.filter(a => a.route !== route) };
  changed();
}

/** Just joined a neighborhood: its existing plans arrive all at once, and none of them is news. */
const quiet: Record<string, number> = {};
export function quietHood(hoodId: string, ms = 180_000) { quiet[hoodId] = Date.now() + ms; }
export const isQuiet = (hoodId: string) => (quiet[hoodId] ?? 0) > Date.now();

/** A neighborhood's shared board is announced only after the first time this phone has read it,
 *  so joining (or updating the app) doesn't bring a pile of "new plan" notifications. */
export const boardKnown = (code: string) => state.boardKnown.includes(code);
export function markBoardKnown(code: string) { if (!boardKnown(code)) { state = { ...state, boardKnown: [...state.boardKnown, code] }; changed(); } }

export const unreadCount = () => state.items.filter(a => !a.read).length;
export const getActivity = () => state.items;
export const useActivity = () => useSyncExternalStore(subscribe, () => state.items);
export const usePrefs = () => useSyncExternalStore(subscribe, () => state.prefs);
const unreadSel = () => { let n = 0; for (const a of state.items) if (!a.read) n++; return n; };
export const useUnreadCount = () => useSyncExternalStore(subscribe, unreadSel);
export const subscribeActivity = subscribe;

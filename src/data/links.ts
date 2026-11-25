import { useSyncExternalStore } from 'react';
import { SITE } from './security';

// Invite links are ordinary web links, so they're tappable in Messages, Mail and everywhere else:
//   https://www.cyber-affinity.com/its-a-lifestyle/join#ABCD-EFGH-JKLM      join a neighborhood
//   https://www.cyber-affinity.com/its-a-lifestyle/connect#<connect code>   start a private chat
// The code is after the #, which browsers never send to the website, so only the app and the person
// holding the link ever see it. With the app installed, iOS opens these links straight in the app
// (universal links); without it, the web page shows the code and the App Store button.

export const JOIN_URL = `${SITE}/join`;
export const CONNECT_URL = `${SITE}/connect`;
export const joinLink = (code: string) => `${JOIN_URL}#${code}`;
export const connectLink = (code: string) => `${CONNECT_URL}#${encodeURIComponent(code)}`;

/** Finds a join code in anything: the code itself, a pasted invite message, or a join link.
 *  Forgiving about case, spaces and missing dashes. */
export function findJoinCode(text: string): string | null {
  const t = text.trim();
  const frag = /its-a-lifestyle\/join\/?#([A-Za-z0-9 -]+)/i.exec(t);
  const src = frag ? frag[1] : t;
  // In a sentence, only a dashed code counts ("Your join code is ABCD-EFGH-JKLM.").
  const dashed = /(?:^|[^A-Za-z0-9-])([A-Za-z0-9]{4})-([A-Za-z0-9]{4})-([A-Za-z0-9]{4})(?![A-Za-z0-9-])/.exec(` ${src}`);
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`.toUpperCase();
  // Otherwise the whole thing has to be the code, typed any which way ("abcd efgh jklm").
  const bare = src.replace(/[\s-]/g, '');
  return /^[A-Za-z0-9]{12}$/.test(bare) ? bare.toUpperCase().replace(/(.{4})(?=.)/g, '$1-') : null;
}

// A code from a link the app was opened with, waiting for the Join screen (or the connect sheet) to pick it up.
let pending: { join?: string; connect?: string } = {};
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Reads an incoming link. Returns which kind it was, or null if it isn't one of ours. */
export function handleIncomingUrl(url: string | null | undefined): 'join' | 'connect' | null {
  if (!url) return null;
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  if (/its-a-lifestyle\/join\b/i.test(url)) {
    const code = hash ? findJoinCode(hash) : null;
    if (code) { pending = { ...pending, join: code }; notify(); }
    return 'join';
  }
  if (/its-a-lifestyle\/connect\b/i.test(url)) {
    let code = '';
    try { code = decodeURIComponent(hash); } catch { /* a damaged link: the sheet says so */ }
    if (code) { pending = { ...pending, connect: code }; notify(); }
    return 'connect';
  }
  return null;
}

export const usePendingJoin = () => useSyncExternalStore(subscribe, () => pending.join);
export const usePendingConnect = () => useSyncExternalStore(subscribe, () => pending.connect);
export function takePendingJoin() { const c = pending.join; if (c) { pending = { ...pending, join: undefined }; notify(); } return c; }
export function takePendingConnect() { const c = pending.connect; if (c) { pending = { ...pending, connect: undefined }; notify(); } return c; }

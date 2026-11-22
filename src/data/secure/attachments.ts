import Crypto from '../../../modules/lifestyle-crypto';
import type { Message } from '../types';
import type { Attachment } from './client';

const MARK = '/LifestyleAttachments/';
let dir: string | null = null;

/** Decrypted photos are saved with an absolute file URI, but the app's folder moves when it's
 *  reinstalled or updated. This re-points a saved URI at the current folder. Other URIs pass through. */
export function localUri(uri: string): string {
  const i = uri.indexOf(MARK);
  if (i < 0 || !Crypto?.attachmentsDir) return uri;
  dir ??= Crypto.attachmentsDir().replace(/\/?$/, '/');
  return dir + uri.slice(i + MARK.length);
}

/* ---------- attachment messages (photos, voice, files) ---------- */

/** What's being sent: a photo, a voice message (with its length) or a file (with its name and size). */
export type Outgoing = { kind: 'photo' } | { kind: 'voice'; dur: string } | { kind: 'file'; name: string; size: number };

export const fmtBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const cleanName = (s: unknown) => String(s ?? 'File').replace(/[\u0000-\u001f/\\]/g, '').slice(0, 120) || 'File';

/** My own bubble while it sends. */
export function outgoingMsg(o: Outgoing, uri: string, mid: string): Message {
  if (o.kind === 'voice') return { f: 'You', type: 'voice', uri, dur: o.dur, mid, status: 'sending' };
  if (o.kind === 'file') return { f: 'You', type: 'file', uri, name: cleanName(o.name), size: fmtBytes(o.size), mid, status: 'sending' };
  return { f: 'You', type: 'photo', uri, alt: 'Photo', mid, status: 'sending' };
}

/** The attachment details that travel inside the encrypted message. */
export function attFor(o: Outgoing, att: Attachment): Attachment {
  if (o.kind === 'voice') return { ...att, dur: String(o.dur).slice(0, 8) };
  if (o.kind === 'file') return { ...att, name: cleanName(o.name), size: Math.max(0, Math.floor(o.size)) };
  return att;
}

/** Someone else's bubble, before the attachment is downloaded. */
export function incomingMsg(att: Attachment, who: string, mid: string, text?: string): Message {
  if (att.kind === 'voice') return { f: who, type: 'voice', dur: typeof att.dur === 'string' ? att.dur.slice(0, 8) : undefined, mid };
  if (att.kind === 'file') return { f: who, type: 'file', name: cleanName(att.name), size: typeof att.size === 'number' ? fmtBytes(att.size) : '', mid };
  return { f: who, type: 'photo', alt: 'Photo', mid, ...(text ? { t: String(text).slice(0, 4000) } : {}) };
}

export const tooBigText = (o: Outgoing) => `That ${o.kind === 'photo' ? 'photo' : o.kind === 'voice' ? 'recording' : 'file'} is too big to send (over 6 MB).`;

import Crypto, { CryptoErrors, type Envelope, type FetchedBundle } from '../../../modules/lifestyle-crypto';

// End-to-end encrypted messaging over the relay. All cryptography happens in the native module;
// this file only moves public keys and ciphertext around. The relay identifies people by random
// account IDs; names, photos and everything else travel inside encrypted messages.

// Development builds talk to the relay on this Mac; release (TestFlight) builds to the hosted relay.
// Still to come: our own domain with certificate pinning.
export const RELAY_URL = __DEV__ ? 'http://localhost:8787' : 'https://relay-production-43719318.up.railway.app';
/** Phone-number signup needs a text-message provider; until one is set up it only exists in development. */
export const PHONE_ENABLED = __DEV__;

/** Public half of the sealed-sender trust root. Its private half is kept offline; the relay only holds a
 *  server certificate signed by it. A sender certificate that doesn't chain to this key is refused. */
export const SEALED_TRUST_ROOT = 'BXsGxnAThiUp4RYl264jZIdGtFwu32ChTxgSWv7ZlutV';

const PREKEY_LOW_WATER = 20;
const PREKEY_BATCH = 100;

/** What travels inside the encryption. Versioned so it can grow (timers, reactions, media…).
 *  `from` carries the name the sender chose, so a new contact shows a name instead of an ID. */
/** `from.ak` is the sender's access key: knowing it lets you send them sealed messages. */
export type From = { name?: string; ak?: string };
/** An encrypted photo: where the ciphertext is on the relay, its key, and the ciphertext's SHA-256. */
export type Attachment = { id: string; key: string; digest: string; kind?: 'voice' | 'file'; dur?: string; name?: string; size?: number };
const extOf = (name?: string) => (name?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'bin').toLowerCase();
/** `loc`: a rounded location ("lat,lon" to 2 decimals, about 1 km), only when the sender chose to share it. */
export type TextPayload = { v: 1; kind: 'text'; id: string; text: string; sentAt: number; from?: From; att?: Attachment; loc?: string; timer?: string };
/** A shared location must be rounded to 2 decimals; anything more precise is refused on arrival. */
export const isRoundedGeo = (g: unknown): g is string => typeof g === 'string' && /^-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}$/.test(g);
/** My Sender Key for a group, handed over inside a 1:1 session. */
export type GroupKeyPayload = { v: 1; kind: 'gkey'; group: string; key: string; from?: From };
/** Anything sent to a group (Sender Key encrypted, or 1:1 for restricted audiences). */
export type GroupPayload = { v: 1; kind: 'group'; group: string; id: string; sentAt: number; body: unknown; from?: From };
/** Between my own devices only: a copy of something I sent, or my shared account state. */
export type SyncState = { name: string | null; contacts: unknown[]; hoods: unknown[]; blocked: string[]; accessKeys: Record<string, string>; chatGroups: { id: string; name: string; members: string[] }[] };
export type SyncPayload = { v: 1; kind: 'sync'; id: string; from?: From; to?: string; inner?: TextPayload | GroupPayload; state?: SyncState };
/** A reaction to a message in a 1:1 chat (on: added, or false: taken back). Older app versions ignore it. */
export type ReactPayload = { v: 1; kind: 'react'; id: string; mid: string; e: string; on: boolean; from?: From };
export type Payload = TextPayload | GroupKeyPayload | GroupPayload | SyncPayload | ReactPayload;

export type Received =
  | { ok: true; from: string; fromDevice: number; payload: Payload; relayTs: number; viaGroupKey: boolean }
  | { ok: false; from: string; fromDevice: number; reason: 'identity-changed' | 'undecryptable'; relayTs: number; viaGroupKey: boolean };

export class RelayError extends Error {
  constructor(public status: number, public body: Record<string, unknown> = {}) { super(`relay ${status}`); }
}

function native() {
  if (!Crypto) throw new Error('Encryption needs a development build (it can’t run in Expo Go).');
  return Crypto;
}

let revokedHandler: () => void = () => {};
/** The relay no longer recognizes this device: on a linked device, that means it was removed. */
export const onDeviceRevoked = (f: () => void) => { revokedHandler = f; };
let closedHandler: () => void = () => {};
/** The sync layer is told when the relay says this account was closed for breaking the guidelines. */
export const onAccountClosed = (f: () => void) => { closedHandler = f; };

async function api<T>(path: string, init: RequestInit = {}, authed = true): Promise<T> {
  const token = authed ? await native().relayToken() : null;
  if (authed && !token) throw new Error(CryptoErrors.noAccount);
  const r = await fetch(RELAY_URL + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const text = await r.text();
  const body = text ? JSON.parse(text) : undefined;
  if (r.status === 403 && body?.error === 'account closed') closedHandler();
  if (r.status === 401 && authed) revokedHandler();
  if (!r.ok) throw new RelayError(r.status, body);
  return body as T;
}


/** Makes sure this phone has keys and is registered with the relay. Returns my account ID. */
export async function ensureRegistered(): Promise<string> {
  const c = native();
  let acct = await c.account();
  if (acct && acct.name !== 'pending' && (await c.relayToken())) return acct.name;
  // A half-finished registration (app closed mid-way) is thrown away and redone from scratch.
  if (acct) await c.deleteAccount();
  acct = await c.createAccount('pending', 1);
  const keys = await c.publicBundle();
  const reg = await api<{ account: string; device: number; token: string }>(
    '/v1/accounts', { method: 'POST', body: JSON.stringify(keys) }, false);
  await c.finishRegistration(reg.account, reg.device, reg.token);
  return reg.account;
}

/* ---------- sealed sender ---------- */

let myAccessKey: string | null = null;
let accessKeyOf: (account: string) => string | undefined = () => undefined;
/** The sync layer tells this file how to look up other people's access keys. */
export const setAccessKeyLookup = (f: (account: string) => string | undefined) => { accessKeyOf = f; };

/** My access key: created once, its fingerprint registered with the relay, kept in the encrypted vault. */
export async function ensureAccessKey(): Promise<string> {
  if (myAccessKey) return myAccessKey;
  const c = native();
  let k = await c.vaultRead('access-v1');
  if (!k) {
    k = c.randomId();
    await api('/v1/access', { method: 'PUT', body: JSON.stringify({ keyHash: c.sha256Hex(k) }) });
    await c.vaultWrite('access-v1', k);
  }
  myAccessKey = k;
  return k;
}
export const getMyAccessKey = () => myAccessKey;

let cert: { b64: string; expires: number } | null = null;
/** Forgets account-specific things held in memory (after deleting the account, or moving another one in). */
export function forgetSessionCache() { myAccessKey = null; cert = null; myDevicesCache = null; }
/** A linked device takes the account's access key from the phone instead of making a new one. */
export const adoptAccessKey = (k: string) => native().vaultWrite('access-v1', k);
async function senderCertificate(): Promise<string | null> {
  if (cert && cert.expires - Date.now() > 3600_000) return cert.b64;
  try {
    const r = await api<{ certificate: string; expires: number }>('/v1/certificate');
    cert = { b64: r.certificate, expires: r.expires };
    return cert.b64;
  } catch { return null; } // relay without sealed sender: fall back to the normal path
}

/** Sealed delivery: no login, so the relay can't tell who's sending. */
async function sendSealed(recipients: { to: string; accessKey: string; messages: { deviceId: number; body: string }[] }[]) {
  const r = await fetch(RELAY_URL + '/v1/sealed', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipients }) });
  if (!r.ok) { const t = await r.text(); throw new RelayError(r.status, t ? JSON.parse(t) : {}); }
}

/** Every payload carries my name (if given) and access key, inside the encryption. */
const withFrom = <P extends Payload>(p: P): P => ({ ...p, from: { ...(p.from ?? {}), ...(myAccessKey ? { ak: myAccessKey } : {}) } });

/** Sends a text to every phone of `to`. Starts sessions (PQXDH) with any phone we haven't met. */
export async function sendText(to: string, text: string, id = native().randomId(), fromName?: string | null, att?: Attachment, loc?: string): Promise<TextPayload> {
  const payload: TextPayload = { v: 1, kind: 'text', id, text, sentAt: Date.now(), ...(fromName ? { from: { name: fromName } } : {}), ...(att ? { att } : {}), ...(loc ? { loc } : {}) };
  await sendPayload(to, payload);
  mirrorToMyDevices({ to, inner: payload });
  return payload;
}

/* ---------- my other devices ---------- */
let myDevicesCache: { at: number; others: number[] } | null = null;
export const forgetMyDevices = () => { myDevicesCache = null; };
async function myOtherDevices(): Promise<number[]> {
  if (myDevicesCache && Date.now() - myDevicesCache.at < 30_000) return myDevicesCache.others;
  const r = await api<{ me: number; devices: { device: number }[] }>('/v1/devices/mine');
  myDevicesCache = { at: Date.now(), others: r.devices.map(d => d.device).filter(d => d !== r.me) };
  return myDevicesCache.others;
}
/** Sends to my own other devices over ordinary 1:1 sessions. Does nothing if I only have one. */
async function sendToMyDevices(body: Omit<SyncPayload, 'v' | 'kind' | 'id'>, retry = true): Promise<void> {
  const c = native(), others = await myOtherDevices();
  if (!others.length) return;
  const me = (await c.account())!.name, who = encodeURIComponent(me);
  const payload: SyncPayload = { v: 1, kind: 'sync', id: c.randomId(), ...body };
  for (const d of others) {
    if (await c.hasSession(me, d)) continue;
    const { devices: [bundle] } = await api<{ devices: FetchedBundle[] }>(`/v1/keys/${who}?device=${d}`);
    if (bundle) await c.startSession(me, bundle);
  }
  const messages: (Envelope & { deviceId: number })[] = [];
  for (const d of others) messages.push({ deviceId: d, ...(await c.encrypt(me, d, JSON.stringify(payload))) });
  try { await api(`/v1/messages/${who}`, { method: 'PUT', body: JSON.stringify({ messages }) }); }
  catch (e) {
    if (!(retry && e instanceof RelayError && e.status === 409)) throw e;
    forgetMyDevices();
    await sendToMyDevices(body, false);
  }
}
/** Keeps my other devices showing what I sent. A failure here never fails the send itself. */
export function mirrorToMyDevices(body: { to?: string; inner: TextPayload | GroupPayload }) {
  sendToMyDevices(body).catch(e => { if (__DEV__) console.log('[devices] mirror failed', String(e).slice(0, 120)); });
}
export const sendStateToMyDevices = (state: SyncState) => sendToMyDevices({ state });

export type LinkedDevice = { device: number; created: number };
export const listMyDevices = () => api<{ me: number; limit: number; devices: LinkedDevice[] }>('/v1/devices/mine');
export const startDeviceLink = () => api<{ linkToken: string }>('/v1/devices/link/start', { method: 'POST', body: '{}' });
export async function removeMyDevice(device: number) { await api(`/v1/devices/mine/${device}`, { method: 'DELETE' }); forgetMyDevices(); }
/** New device: registers with its own keys, using the phone's one-time approval. */
export async function finishDeviceLink(linkToken: string) {
  const c = native(), keys = await c.publicBundle();
  const reg = await api<{ account: string; device: number; token: string }>('/v1/devices/link/finish', { method: 'POST', body: JSON.stringify({ ...keys, linkToken }) }, false);
  await c.finishRegistration(reg.account, reg.device, reg.token);
  return reg;
}

/** Sends any payload to every phone of `to` over 1:1 Signal sessions, sealed when possible. */
export async function sendPayload(to: string, payloadIn: Payload, retry = true): Promise<void> {
  const c = native();
  const payload = withFrom(payloadIn);
  const who = encodeURIComponent(to);
  const { devices } = await api<{ devices: number[] }>(`/v1/devices/${who}`);
  // Only fetch a bundle (which uses up one of their one-time prekeys) for phones we haven't met.
  for (const d of devices) {
    if (await c.hasSession(to, d)) continue;
    const { devices: [bundle] } = await api<{ devices: FetchedBundle[] }>(`/v1/keys/${who}?device=${d}`);
    await c.startSession(to, bundle);
  }
  const plaintext = JSON.stringify(payload);
  const ak = accessKeyOf(to), certificate = ak ? await senderCertificate() : null;
  if (ak && certificate) {
    try {
      const sealed: { deviceId: number; body: string }[] = [];
      for (const d of devices) sealed.push({ deviceId: d, body: await c.sealedEncrypt(to, d, plaintext, certificate) });
      await sendSealed([{ to, accessKey: ak, messages: sealed }]);
      if (__DEV__) console.log('[sealed] 1:1 sent sealed to', to.slice(0, 8));
      return;
    } catch (e) {
      if (retry && e instanceof RelayError && e.status === 409) return sendPayload(to, payloadIn, false);
      if (!(e instanceof RelayError && e.status === 401)) throw e;
      // Their access key changed or isn't registered yet: this one goes the normal way.
    }
  }
  if (__DEV__) console.log('[sealed] 1:1 sent the normal way to', to.slice(0, 8), ak ? '(key refused)' : '(no access key yet)');
  const messages: (Envelope & { deviceId: number })[] = [];
  for (const d of devices) messages.push({ deviceId: d, ...(await c.encrypt(to, d, plaintext)) });
  try {
    await api(`/v1/messages/${encodeURIComponent(to)}`, { method: 'PUT', body: JSON.stringify({ messages }) });
  } catch (e) {
    // Their device list changed between our two calls: refetch once and resend.
    if (retry && e instanceof RelayError && e.status === 409) return sendPayload(to, payloadIn, false);
    throw e;
  }
}

/** Collects, decrypts and acknowledges everything waiting on the relay for this phone. */
export async function receive(): Promise<Received[]> {
  const c = native(), me = await c.account();
  const { messages } = await api<{ messages: ({ type: Envelope['type'] | 'sealed'; body: string } & { id: string; from: string; fromDevice: number; ts: number })[] }>('/v1/messages');
  const out: Received[] = [];
  for (const m of messages) {
    try {
      let viaGroupKey = m.type === 'group';
      let text: string;
      if (m.type === 'sealed') {
        if (__DEV__) console.log('[sealed] received a sealed message (relay saw no sender)');
        // The relay doesn't know the sender; the certificate inside says who it is (checked natively).
        const o = await c.sealedDecrypt(m.body, SEALED_TRUST_ROOT);
        m.from = o.from; m.fromDevice = o.fromDevice; viaGroupKey = o.type === 'group';
        text = o.plaintext;
      } else text = viaGroupKey ? await c.groupDecrypt(m.from, m.fromDevice, m.body) : await c.decrypt(m.from, m.fromDevice, m.type, m.body);
      const payload = JSON.parse(text) as Payload;
      const valid = payload?.v === 1 && (
        (payload.kind === 'text' && typeof payload.text === 'string' && !viaGroupKey)
        || (payload.kind === 'gkey' && typeof payload.group === 'string' && typeof payload.key === 'string' && !viaGroupKey)
        || (payload.kind === 'group' && typeof payload.group === 'string' && typeof payload.id === 'string')
        || (payload.kind === 'react' && typeof payload.mid === 'string' && typeof payload.e === 'string' && !viaGroupKey)
        || (payload.kind === 'sync' && !viaGroupKey && m.from === me?.name && m.fromDevice !== me?.deviceId));
      if (!valid) throw new Error('bad payload');
      // A group key must be stored before the next message in this batch is decrypted: the
      // sender's first group message usually arrives right behind it.
      if (payload.kind === 'gkey') await c.acceptGroupKey(m.from, m.fromDevice, payload.key);
      out.push({ ok: true, from: m.from, fromDevice: m.fromDevice, payload, relayTs: m.ts, viaGroupKey });
    } catch (e) {
      if (__DEV__) console.log('[groups] decrypt error', m.type, String((e as Error).message).slice(0, 200));
      const changed = String((e as Error).message).startsWith(CryptoErrors.identityChanged);
      out.push({ ok: false, from: m.from, fromDevice: m.fromDevice, reason: changed ? 'identity-changed' : 'undecryptable', relayTs: m.ts, viaGroupKey: m.type === 'group' });
      if (m.type === 'sealed' && !m.from) { await api(`/v1/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); out.pop(); continue; }
    }
    // Acknowledge even failures: a message that can't be decrypted now never will be, and leaving
    // it would block the queue. The UI shows the failure instead.
    await api(`/v1/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
  }
  if (messages.length) await topUpPreKeys();
  return out;
}

/** Keeps enough one-time prekeys on the relay that new contacts get full forward secrecy. */
export async function topUpPreKeys(): Promise<void> {
  const { preKeys } = await api<{ preKeys: number }>('/v1/keys/status');
  if (preKeys >= PREKEY_LOW_WATER) return;
  const fresh = await native().generatePreKeys(PREKEY_BATCH);
  await api('/v1/keys', { method: 'PUT', body: JSON.stringify({ preKeys: fresh }) });
}

/** Erases this phone's account on the relay and its keys on the phone. Can't be undone. */
export async function deleteEverything(): Promise<void> {
  try { await api('/v1/accounts/me', { method: 'DELETE' }); } finally { await native().deleteAccount(); }
}

export async function safetyNumber(withAccount: string, deviceId = 1) {
  return native().safetyNumber(withAccount, deviceId);
}

/* ---------- phone numbers ---------- */

/** Normalizes to +<country><number>. US/Canada numbers may be typed without the +1. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^0-9+]/g, '');
  if (/^\+[1-9][0-9]{7,14}$/.test(digits)) return digits;
  const d = digits.replace(/\+/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}
export const startPhoneVerification = (phone: string) => api('/v1/phone/start', { method: 'POST', body: JSON.stringify({ phone }) });
export const confirmPhone = (phone: string, code: string) => api('/v1/phone/verify', { method: 'POST', body: JSON.stringify({ phone, code }) });
export const removePhone = () => api('/v1/phone', { method: 'DELETE' });
export async function findByPhone(phones: string[]): Promise<{ phone: string; account: string }[]> {
  const { found } = await api<{ found: { phone: string; account: string }[] }>('/v1/phone/lookup', { method: 'POST', body: JSON.stringify({ phones }) });
  return found;
}

/* ---------- neighborhoods ---------- */
// The invite code never leaves the phone. The server gets a one-way fingerprint of it (to find the
// neighborhood) and data sealed with a key derived from it (its name and each member's name).

export type HoodMember = { account: string; name: string; ak?: string };
/** A neighborhood's shared settings, sealed with its invite code. Owners are account IDs. */
export type HoodMeta = { v: 1; name: string; about?: string; places?: string[]; inviters?: 'everyone' | 'chosen'; owners?: string[]; cover?: 'drawing' | 'none' | 'photo';
  /** The cover photo, encrypted on the relay (only with cover: 'photo'). */
  coverImg?: Attachment;
  /** The neighborhood's group ID, fixed when it first changes its code, so members who joined with
   *  different codes still land in the same encrypted group. */
  gid?: string;
  /** The board secret: seals the neighborhood board (plans for everyone). Only members have it, and it
   *  survives a new invite code because it travels inside these sealed settings. */
  board?: string };

// Each phone keeps a neighborhood under the code it joined with (its local key). After an owner
// changes the code, relay calls use the current one, which the sync layer looks up here.
let liveCodeOf: (key: string) => string | undefined = () => undefined;
let movedHandler: (key: string, newCode: string) => void = () => {};
export const setLiveCodeLookup = (f: (key: string) => string | undefined) => { liveCodeOf = f; };
export const onHoodMoved = (f: (key: string, newCode: string) => void) => { movedHandler = f; };
const live = (key: string) => liveCodeOf(key) ?? key;
const normCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
export const looksLikeRemoteCode = (code: string) => /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normCode(code));

export type HoodPlan = { state: 'active' | 'grace' | 'paused'; until: number; takeover: boolean; mine: boolean };
export type BillingStatus = { on: boolean; product: string; limit: number; active: boolean; expires: number; used: number };
let planHandler: (key: string, plan?: HoodPlan) => void = () => {};
export const onHoodPlan = (f: typeof planHandler) => { planHandler = f; };
export const billingStatus = () => api<BillingStatus>('/v1/billing');
export const submitApplePurchase = (jws: string) => api<{ active: boolean; expires: number; used: number; limit: number }>('/v1/billing/apple', { method: 'POST', body: JSON.stringify({ jws }) });
/** Puts my subscription on a neighborhood. A non-owner taking over a lapsed one also seals new settings naming them owner. */
export async function coverRemoteHood(key: string, ownerSecret: string | undefined, takeover?: { meta: HoodMeta; newSecret: string }) {
  const c = native(), code = live(key);
  const r = await api<{ plan: HoodPlan; tookOver?: boolean }>(`/v1/hoods/${c.secretLookup(code)}/plan`, { method: 'POST', body: JSON.stringify({
    proof: ownerSecret, ...(takeover ? { meta: c.sealWithSecret(code, JSON.stringify(takeover.meta)), newOwnerHash: c.sha256Hex(takeover.newSecret) } : {}) }) });
  planHandler(key, r.plan);
  return r;
}

/** Creates a neighborhood. Returns its invite code and the owner secret (kept only on owners' phones). */
export async function createRemoteHood(meta: Omit<HoodMeta, 'v' | 'owners'>, myName: string): Promise<{ code: string; ownerSecret: string; board: string }> {
  const c = native(), me = await ensureRegistered(), code = c.randomInviteCode(), ownerSecret = c.randomId() + c.randomId(), board = c.randomId() + c.randomId();
  await api('/v1/hoods', { method: 'POST', body: JSON.stringify({
    lookup: c.secretLookup(code), meta: c.sealWithSecret(code, JSON.stringify({ v: 1, ...meta, owners: [me], board })),
    profile: c.sealWithSecret(code, JSON.stringify({ v: 1, account: me, name: myName, ak: myAccessKey ?? undefined })),
    ownerHash: c.sha256Hex(ownerSecret) }) });
  return { code, ownerSecret, board };
}

/** Owners: replace the shared settings. With `newSecret`, the owner secret is rotated too. */
export async function updateRemoteMeta(key: string, meta: HoodMeta, ownerSecret: string, newSecret?: string) {
  const c = native(), code = live(key);
  await api(`/v1/hoods/${c.secretLookup(code)}/meta`, { method: 'PUT', body: JSON.stringify({
    proof: ownerSecret, meta: c.sealWithSecret(code, JSON.stringify(meta)), ...(newSecret ? { newOwnerHash: c.sha256Hex(newSecret) } : {}) }) });
}

/* ---------- the neighborhood board ---------- */
// Plans for everyone in a neighborhood, sealed with the board secret, so people who join later see them
// at once. The relay only knows which account posted each one and who may change it.
export type BoardItem = { id: string; author: string; editors: string[]; sealed: string; updated: number };
export type BoardOp = { seq: number; plan: string; author: string; sealed: string };
export async function boardGet(key: string, after = 0): Promise<{ items: BoardItem[]; ops: BoardOp[] }> {
  const c = native(), code = live(key);
  return api(`/v1/hoods/${c.secretLookup(code)}/board?after=${after}`);
}
export async function boardPut(key: string, secret: string, id: string, plan: unknown, editors?: string[]) {
  const c = native(), code = live(key);
  await api(`/v1/hoods/${c.secretLookup(code)}/board/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({
    sealed: c.sealWithSecret(secret, JSON.stringify(plan)), ...(editors ? { editors } : {}) }) });
}
export async function boardRemove(key: string, id: string, ownerSecret?: string) {
  const c = native(), code = live(key);
  await api(`/v1/hoods/${c.secretLookup(code)}/board/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify(ownerSecret ? { proof: ownerSecret } : {}) });
}
export async function boardAddOp(key: string, secret: string, id: string, op: unknown) {
  const c = native(), code = live(key);
  await api(`/v1/hoods/${c.secretLookup(code)}/board/${encodeURIComponent(id)}/ops`, { method: 'POST', body: JSON.stringify({ sealed: c.sealWithSecret(secret, JSON.stringify(op)) }) });
}
/** Opens something sealed with the board secret (null if it doesn't open). */
export function boardOpen<T>(secret: string, sealed: string): T | null {
  try { return JSON.parse(native().openWithSecret(secret, sealed)) as T; } catch { return null; }
}

/** Owners: remove a member (they can't rejoin with that account). */
export async function removeRemoteMember(key: string, account: string, ownerSecret: string) {
  const c = native(), code = live(key);
  await api(`/v1/hoods/${c.secretLookup(code)}/members/${encodeURIComponent(account)}`, { method: 'DELETE', body: JSON.stringify({ proof: ownerSecret }) });
}

/** Joins with a code. Returns the neighborhood's name and members, or null if the code is wrong. */
export async function joinRemoteHood(rawCode: string, myName: string): Promise<{ code: string; name: string; meta: HoodMeta; members: HoodMember[] } | null> {
  const c = native(), me = await ensureRegistered(), code = normCode(rawCode);
  try {
    await api(`/v1/hoods/${c.secretLookup(code)}/members`, { method: 'POST', body: JSON.stringify({
      profile: c.sealWithSecret(code, JSON.stringify({ v: 1, account: me, name: myName, ak: myAccessKey ?? undefined })) }) });
  } catch (e) {
    if (e instanceof RelayError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
  return { code, ...(await remoteHood(code)) };
}

/** The neighborhood's name and member list, decrypted on this phone. */
export async function remoteHood(key: string, followed = false): Promise<{ name: string; meta: HoodMeta; members: HoodMember[] }> {
  const c = native(), code = live(key);
  const r = await api<{ meta: string; members: { account: string; profile: string }[]; moved?: string; plan?: HoodPlan }>(`/v1/hoods/${c.secretLookup(code)}`);
  if (r.moved) {
    // An owner changed the invite code. The new one is sealed with the code I have.
    const next = normCode(String((JSON.parse(c.openWithSecret(code, r.moved)) as { code?: string }).code ?? ''));
    if (followed || !looksLikeRemoteCode(next)) throw new RelayError(404, { error: 'not found' });
    movedHandler(key, next);
    return remoteHood(key, true);
  }
  planHandler(key, r.plan);
  const meta = JSON.parse(c.openWithSecret(code, r.meta)) as HoodMeta;
  const members: HoodMember[] = [];
  for (const m of r.members) {
    try {
      const p = JSON.parse(c.openWithSecret(code, m.profile)) as { account: string; name: string; ak?: string };
      // A profile only counts if it names the account that posted it.
      if (p.account === m.account && typeof p.name === 'string') members.push({ account: m.account, name: p.name.slice(0, 40), ...(typeof p.ak === 'string' && p.ak.length <= 64 ? { ak: p.ak } : {}) });
    } catch { /* unreadable entry: skip it */ }
  }
  return { name: meta.name.slice(0, 60), meta, members };
}

export const leaveRemoteHood = (key: string) => api(`/v1/hoods/${native().secretLookup(live(key))}/members/me`, { method: 'DELETE' });

/** Owners: moves the neighborhood to a brand-new invite code. Every current member keeps access (their
 *  phones learn the new code); the old code and links stop working. Returns the new code. */
export async function moveRemoteHood(key: string, ownerSecret: string, groupId: string): Promise<string> {
  const c = native(), me = await ensureRegistered(), old = live(key), next = c.randomInviteCode();
  const r = await remoteHood(key);
  const profiles: Record<string, string> = {};
  for (const m of r.members) profiles[m.account] = c.sealWithSecret(next, JSON.stringify({ v: 1, account: m.account, name: m.name, ...(m.ak ? { ak: m.ak } : {}) }));
  await api(`/v1/hoods/${c.secretLookup(old)}/move`, { method: 'POST', body: JSON.stringify({
    proof: ownerSecret, newLookup: c.secretLookup(next),
    meta: c.sealWithSecret(next, JSON.stringify({ ...r.meta, gid: r.meta.gid ?? groupId })),
    profiles: { ...profiles, [me]: profiles[me] ?? c.sealWithSecret(next, JSON.stringify({ v: 1, account: me, name: 'Neighbor' })) },
    forward: c.sealWithSecret(old, JSON.stringify({ code: next })) }) });
  return next;
}

/* ---------- groups (Signal Sender Keys) ---------- */

/** Device numbers for many accounts at once. */
export async function devicesOf(accounts: string[]): Promise<Record<string, number[]>> {
  if (!accounts.length) return {};
  const { devices } = await api<{ devices: Record<string, number[]> }>('/v1/devices/lookup', { method: 'POST', body: JSON.stringify({ accounts }) });
  return devices;
}

/** Encrypts a payload once with my Sender Key for the group and sends that ciphertext to every
 *  member's phones in one request. Everyone must already have my key (see groups.ts). */
export async function sendToGroupKey(distributionId: string, members: string[], payloadIn: GroupPayload): Promise<void> {
  if (!members.length) return;
  const c = native();
  const payload = withFrom(payloadIn);
  const devs = await devicesOf(members);
  // A member may have just linked a new device: sealing to it needs a session first.
  for (const m of members) for (const d of devs[m] ?? []) {
    if (await c.hasSession(m, d)) continue;
    const { devices: [bundle] } = await api<{ devices: FetchedBundle[] }>(`/v1/keys/${encodeURIComponent(m)}?device=${d}`);
    if (bundle) await c.startSession(m, bundle);
  }
  const certificate = await senderCertificate();
  // Members whose access key I know get it sealed; anyone else (older app) the normal way.
  const sealedTo = certificate ? members.filter(m => accessKeyOf(m) && devs[m]?.length) : [];
  const plainTo = members.filter(m => !sealedTo.includes(m));
  if (sealedTo.length) {
    const recips = sealedTo.flatMap(m => devs[m].map(d => [m, String(d)] as [string, string]));
    try {
      const bodies = await c.sealedGroupEncrypt(distributionId, JSON.stringify(payload), certificate!, recips);
      if (__DEV__) console.log('[sealed] group sent sealed to', sealedTo.length, 'normal to', plainTo.length);
      await sendSealed(sealedTo.map(m => ({ to: m, accessKey: accessKeyOf(m)!, messages: recips.map((r, i) => ({ r, body: bodies[i] })).filter(x => x.r[0] === m).map(x => ({ deviceId: Number(x.r[1]), body: x.body })) })));
    } catch (e) {
      if (!(e instanceof RelayError && (e.status === 401 || e.status === 409))) throw e;
      plainTo.push(...sealedTo);
    }
  }
  if (!plainTo.length) return;
  const body = await c.groupEncrypt(distributionId, JSON.stringify(payload));
  const messages = plainTo.flatMap(to => (devs[to] ?? []).map(deviceId => ({ to, deviceId, type: 'group', body })));
  if (messages.length) await api('/v1/messages', { method: 'PUT', body: JSON.stringify({ messages }) });
}

/* ---------- encrypted attachments ---------- */

/** Encrypts a photo on this phone and uploads only the ciphertext. Returns what the message needs
 *  (and my local copy's URI). */
export async function uploadPhoto(uri: string, keep = false, kind: 'photo' | 'voice' | 'file' = 'photo', name?: string): Promise<{ att: Attachment; uri: string }> {
  const e = await native().encryptAttachment(uri, kind, kind === 'file' ? extOf(name) : undefined);
  // `keep`: a neighborhood cover, kept about a year instead of 30 days (a few per account).
  const { id } = await api<{ id: string }>('/v1/attachments', { method: 'PUT', body: JSON.stringify({ data: e.data, ...(keep ? { keep: true } : {}) }) });
  return { att: { id, key: e.key, digest: e.digest, ...(kind !== 'photo' ? { kind } : {}), ...(kind === 'file' && name ? { name: name.slice(0, 120) } : {}) }, uri: e.uri };
}

/** Downloads an attachment, checks it against the digest from the encrypted message and decrypts it. */
export async function downloadPhoto(att: Attachment): Promise<string> {
  if (!/^[0-9a-f]{32}$/.test(att.id) || !/^[0-9a-f]{64}$/.test(att.digest)) throw new Error('bad attachment');
  const { data } = await api<{ data: string }>(`/v1/attachments/${att.id}`);
  const kind = att.kind === 'voice' || att.kind === 'file' ? att.kind : 'photo';
  return native().decryptAttachment(data, att.key, att.digest, kind, kind === 'file' ? extOf(att.name) : undefined);
}

/* ---------- recovery backup ---------- */
// A recovery code is 24 letters and digits (120 random bits), shown once for the person to write down.
// From it come the backup's encryption key and the fingerprint the relay files it under. The relay never
// sees the code or the key.

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U
export const normalizeRecoveryCode = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
export function newRecoveryCode(): string {
  const c = native(), bits = (c.randomId() + c.randomId()).split('').map(h => parseInt(h, 16).toString(2).padStart(4, '0')).join('');
  let out = '';
  for (let i = 0; i < 24; i++) out += B32[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return out.replace(/(.{4})(?=.)/g, '$1-');
}
export const isRecoveryCode = (s: string) => normalizeRecoveryCode(s).length === 24 && [...normalizeRecoveryCode(s)].every(ch => B32.includes(ch));
export function backupSecrets(code: string) {
  const c = native(), n = normalizeRecoveryCode(code);
  return { key: c.sha256Hex(`lifestyle-backup-key:v1:${n}`), lookup: c.sha256Hex(`lifestyle-backup-id:v1:${n}`) };
}
/** Encrypts this phone's account (no attachments) with the backup key and replaces the backup on the relay. */
export async function uploadBackup(key: string, lookup: string) {
  const data = await native().exportBackup(key);
  await api('/v1/backup', { method: 'PUT', body: JSON.stringify({ lookup, data }) });
}
export const deleteBackup = () => api('/v1/backup', { method: 'DELETE' });
/** Fetches a backup by its recovery code (no account needed). Null if there's none. */
export async function fetchBackup(code: string): Promise<{ data: string; updated: number; key: string } | null> {
  const { key, lookup } = backupSecrets(code);
  try { return { ...(await api<{ data: string; updated: number }>(`/v1/backup/${lookup}`, {}, false)), key }; }
  catch (e) { if (e instanceof RelayError && e.status === 404) return null; throw e; }
}
/** After a restore: fresh signed prekeys and one-time prekeys replace everything on the relay. */
export async function republishKeysAfterRestore() {
  const c = native();
  await c.resetAfterRestore();
  const b = await c.publicBundle();
  const preKeys = await c.generatePreKeys(PREKEY_BATCH);
  await api('/v1/keys', { method: 'PUT', body: JSON.stringify({ ...b, preKeys, replacePreKeys: true }) });
}

/* ---------- moving to a new phone ---------- */

/** A fresh transfer ID and key (both random), and the QR text the new phone shows. */
export function newTransfer() {
  const c = native(), id = c.randomId(), key = c.randomId() + c.randomId();
  return { id, key, qr: `itsalifestyle-transfer:${id}:${key}` };
}
const doneProof = (key: string) => native().sha256Hex(`lifestyle-transfer-done:${key}`);

/** Old phone: uploads the encrypted account in parts (about 7 MB each). */
export async function uploadTransfer(id: string, key: string, blob: string, onProgress: (done: number, all: number) => void) {
  const size = 7_000_000, parts = Math.max(1, Math.ceil(blob.length / size));
  if (parts > 16) throw new Error('There’s too much to move at once.');
  const doneHash = native().sha256Hex(doneProof(key));
  for (let n = 0; n < parts; n++) {
    await api(`/v1/transfer/${id}/${n}`, { method: 'PUT', body: JSON.stringify({ data: blob.slice(n * size, (n + 1) * size), parts, doneHash }) });
    onProgress(n + 1, parts);
  }
}
/** How far along a transfer is, or null once it's finished (or expired). */
export async function transferStatus(id: string): Promise<{ parts: number; ready: number } | null> {
  try { return await api(`/v1/transfer/${id}`, {}, false); }
  catch (e) { if (e instanceof RelayError && e.status === 404) return null; throw e; }
}
export async function downloadTransfer(id: string, parts: number): Promise<string> {
  let out = '';
  for (let n = 0; n < parts; n++) out += (await api<{ data: string }>(`/v1/transfer/${id}/${n}`, {}, false)).data;
  return out;
}
/** New phone: tells the relay it has everything, which deletes it there and lets the old phone wipe. */
export const finishTransfer = (id: string, key: string) =>
  api(`/v1/transfer/${id}/done`, { method: 'POST', body: JSON.stringify({ proof: doneProof(key) }) }, false);

/* ---------- push wake-ups ---------- */

/** Registers this phone's Apple push token (or clears it with null). The relay only ever sends an
 *  empty "you have something new" ping to it. */
export const setPushToken = (token: string | null, env: 'sandbox' | 'production') =>
  api('/v1/push', { method: 'PUT', body: JSON.stringify({ token, env }) });

/** Re-posts my profile in a neighborhood (adds my access key to profiles made before sealed sender). */
export async function refreshMyHoodProfile(key: string, myName: string) {
  const c = native(), me = await ensureRegistered(), code = live(key);
  await api(`/v1/hoods/${c.secretLookup(code)}/members`, { method: 'POST', body: JSON.stringify({
    profile: c.sealWithSecret(code, JSON.stringify({ v: 1, account: me, name: myName, ak: myAccessKey ?? undefined })) }) });
}

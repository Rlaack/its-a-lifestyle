// The relay: stores public prekeys and queues ciphertext until each device confirms receipt.
// It never sees a private key, a readable message, a name or a phone number:
//   - accounts are random IDs it hands out; names live only inside encrypted messages
//   - device secrets are stored as SHA-256 hashes, so a stolen database can't impersonate anyone
//   - queued messages are deleted once acknowledged, and after 30 days regardless
//   - no request logging (sizes and timing are metadata too)
// Still to come: sealed sender (phase 5, hides who sent a message from the relay), linked devices
// (phase 4), push wakeups, and TLS in front of it in production (Caddy; see server/README.md).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { connect as h2connect } from 'node:http2';
import { createHash, createHmac, createPrivateKey, randomBytes, randomInt, randomUUID, sign as cryptoSign, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PrivateKey, PublicKey, SenderCertificate, ServerCertificate } from '@signalapp/libsignal-client';
import { appleRoot, PRODUCT, readTransaction, verifyAppleJws } from './billing.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? '/data/relay.db';
const MAX_BODY = 256 * 1024;
const MAX_QUEUE = 5000;
const MAX_PREKEYS = 200;
const TTL_MS = 30 * 864e5;
// Encrypted attachments (photos): ciphertext only, kept next to the database, deleted after 30 days.
const ATTACH_DIR = join(dirname(DB_PATH), 'attachments');
const XFER = /^[0-9a-f]{32}$/, XFER_PARTS = 16; // up to 16 parts of ~8 MB
const ATTACH_MAX = 6_000_000 * 4 / 3 + 1024; // base64 of the 6 MB the app allows, plus a little
// Neighborhood covers are "kept": about a year instead of 30 days, and only the newest few per account.
const KEEP_MS = 400 * 864e5, KEEP_MAX = 10;
mkdirSync(ATTACH_DIR, { recursive: true });
// Phone numbers are stored as HMAC-SHA256 under this secret, never as digits. Set it in production.
const PHONE_PEPPER = process.env.PHONE_PEPPER ?? 'dev-only-pepper-change-me';
// 'log' prints codes to this server's console (local development only). Production: 'twilio' (not built yet).
const SMS_MODE = process.env.SMS_MODE ?? 'log';
if (process.env.NODE_ENV === 'production' && (SMS_MODE === 'log' || !process.env.PHONE_PEPPER)) {
  throw new Error('Refusing to start: set PHONE_PEPPER and a real SMS_MODE in production.');
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA secure_delete = ON;
  CREATE TABLE IF NOT EXISTS devices (
    account TEXT NOT NULL, device INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    registration_id INTEGER NOT NULL, identity_key TEXT NOT NULL,
    signed_id INTEGER NOT NULL, signed_key TEXT NOT NULL, signed_sig TEXT NOT NULL,
    kyber_id INTEGER NOT NULL, kyber_key TEXT NOT NULL, kyber_sig TEXT NOT NULL,
    created INTEGER NOT NULL, PRIMARY KEY (account, device));
  CREATE TABLE IF NOT EXISTS prekeys (
    account TEXT NOT NULL, device INTEGER NOT NULL, id INTEGER NOT NULL, key TEXT NOT NULL,
    PRIMARY KEY (account, device, id),
    FOREIGN KEY (account, device) REFERENCES devices(account, device) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS queue (
    id TEXT PRIMARY KEY, account TEXT NOT NULL, device INTEGER NOT NULL,
    sender TEXT NOT NULL, sender_device INTEGER NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL,
    ts INTEGER NOT NULL,
    FOREIGN KEY (account, device) REFERENCES devices(account, device) ON DELETE CASCADE);
  CREATE INDEX IF NOT EXISTS queue_by_device ON queue(account, device, ts);
  CREATE TABLE IF NOT EXISTS phones (phone_hmac TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE, verified INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS phone_codes (account TEXT PRIMARY KEY, phone_hmac TEXT NOT NULL, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS hoods (lookup TEXT PRIMARY KEY, meta TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS push_tokens (account TEXT NOT NULL, device INTEGER NOT NULL, token TEXT NOT NULL, env TEXT NOT NULL,
    PRIMARY KEY (account, device), FOREIGN KEY (account, device) REFERENCES devices(account, device) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS access_keys (account TEXT PRIMARY KEY, key_hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS hood_owners (lookup TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, FOREIGN KEY (lookup) REFERENCES hoods(lookup) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS hood_bans (lookup TEXT NOT NULL, account TEXT NOT NULL, PRIMARY KEY (lookup, account), FOREIGN KEY (lookup) REFERENCES hoods(lookup) ON DELETE CASCADE);
  -- A neighborhood moved to a new invite code: the new code, sealed with the old code's key, for the
  -- accounts that were members at the time (people removed earlier can't read where it went).
  CREATE TABLE IF NOT EXISTS hood_forward (lookup TEXT PRIMARY KEY, sealed TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS hood_forward_members (lookup TEXT NOT NULL, account TEXT NOT NULL, PRIMARY KEY (lookup, account),
    FOREIGN KEY (lookup) REFERENCES hood_forward(lookup) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, account TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL);
  -- Recovery backups: one per account, ciphertext only (encrypted with a key from the person's recovery
  -- code). Found by a fingerprint of that code, so restoring needs only the code.
  CREATE TABLE IF NOT EXISTS backups (account TEXT PRIMARY KEY, lookup TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, updated INTEGER NOT NULL);
  -- Moving an account to a new phone: encrypted parts waiting for pickup (1 hour). The relay sees a
  -- random ID and ciphertext only; finishing needs a value derived from the key in the QR code.
  CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, parts INTEGER NOT NULL, done_hash TEXT NOT NULL, created INTEGER NOT NULL);
  -- Crash reports people chose to send: the error, app and iOS version only. No account, no IP.
  CREATE TABLE IF NOT EXISTS crash_reports (id INTEGER PRIMARY KEY, received INTEGER NOT NULL, app TEXT NOT NULL, os TEXT NOT NULL, message TEXT NOT NULL, stack TEXT NOT NULL);
  -- Accounts closed by us for breaking the community guidelines (server/admin.mjs). Only hashes are
  -- kept: the closed phone's token hashes (so it's told why it stopped working) and the phone number's
  -- HMAC (so the same number can't be verified again).
  CREATE TABLE IF NOT EXISTS closed_accounts (account TEXT PRIMARY KEY, reason TEXT NOT NULL, closed INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS closed_tokens (token_hash TEXT PRIMARY KEY, account TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS closed_phones (phone_hmac TEXT PRIMARY KEY, account TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS hood_members (lookup TEXT NOT NULL, account TEXT NOT NULL, profile TEXT NOT NULL, joined INTEGER NOT NULL,
    PRIMARY KEY (lookup, account), FOREIGN KEY (lookup) REFERENCES hoods(lookup) ON DELETE CASCADE);
`);

db.exec('CREATE TABLE IF NOT EXISTS device_links (token_hash TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL)');
const MAX_DEVICES = 3; // the phone plus 2 linked devices

// Neighborhood subscriptions. The purchase is stored only as a keyed hash; no Apple ID, name or email.
db.exec(`
  CREATE TABLE IF NOT EXISTS subs (id TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL, signed INTEGER NOT NULL, env TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS subs_account ON subs(account);
  CREATE TABLE IF NOT EXISTS hood_plans (lookup TEXT PRIMARY KEY, sub TEXT, free_until INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (lookup) REFERENCES hoods(lookup) ON DELETE CASCADE);
  CREATE INDEX IF NOT EXISTS hood_plans_sub ON hood_plans(sub);
`);
const BILLING_ON = process.env.BILLING === 'on';
const HOODS_PER_SUB = 3, GRACE_MS = 30 * 864e5, OWNER_FIRST_MS = 7 * 864e5, FOUNDER_MS = 365 * 864e5;
// Apple reviews production builds with sandbox purchases, so sandbox stays accepted unless turned off.
const ALLOW_SANDBOX = process.env.BILLING_SANDBOX !== 'off';
// Tests can supply their own root, but never against the production database path.
const APPLE_ROOT = process.env.RELAY_TEST === '1' && DB_PATH !== '/data/relay.db' && process.env.BILLING_TEST_ROOT
  ? readFileSync(process.env.BILLING_TEST_ROOT) : appleRoot();
// Neighborhoods that exist the first time billing is on get a free first year.
if (BILLING_ON) db.prepare('INSERT OR IGNORE INTO hood_plans (lookup, sub, free_until) SELECT lookup, NULL, ? FROM hoods').run(Date.now() + FOUNDER_MS);

// Added after launch: older databases get the column here.
try { db.exec('ALTER TABLE attachments ADD COLUMN keep INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }

const lq = {
  add: db.prepare('INSERT INTO device_links VALUES (?,?,?)'),
  take: db.prepare('DELETE FROM device_links WHERE token_hash = ? RETURNING account, expires'),
  dropFor: db.prepare('DELETE FROM device_links WHERE account = ?'),
  expire: db.prepare('DELETE FROM device_links WHERE expires < ?'),
  dropDevice: db.prepare('DELETE FROM devices WHERE account = ? AND device = ?'),
};
const bq = {
  sub: db.prepare('SELECT * FROM subs WHERE id = ?'),
  subOf: db.prepare('SELECT * FROM subs WHERE account = ? ORDER BY expires DESC LIMIT 1'),
  subSet: db.prepare('INSERT OR REPLACE INTO subs VALUES (?,?,?,?,?)'),
  subForget: db.prepare("UPDATE subs SET account = '' WHERE account = ?"),
  plan: db.prepare('SELECT p.*, s.expires, s.account AS payer FROM hood_plans p LEFT JOIN subs s ON s.id = p.sub WHERE p.lookup = ?'),
  planSet: db.prepare('INSERT OR REPLACE INTO hood_plans VALUES (?,?,?)'),
  used: db.prepare('SELECT COUNT(*) AS n FROM hood_plans WHERE sub = ?'),
};

const q = {
  deviceByToken: db.prepare('SELECT account, device FROM devices WHERE token_hash = ?'),
  devicesOf: db.prepare('SELECT * FROM devices WHERE account = ? ORDER BY device'),
  insertDevice: db.prepare(`INSERT INTO devices VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  updateSigned: db.prepare(`UPDATE devices SET signed_id=?, signed_key=?, signed_sig=?, kyber_id=?, kyber_key=?, kyber_sig=? WHERE account=? AND device=?`),
  insertPreKey: db.prepare('INSERT OR IGNORE INTO prekeys VALUES (?,?,?,?)'),
  countPreKeys: db.prepare('SELECT COUNT(*) AS n FROM prekeys WHERE account=? AND device=?'),
  takePreKey: db.prepare('DELETE FROM prekeys WHERE rowid = (SELECT rowid FROM prekeys WHERE account=? AND device=? ORDER BY id LIMIT 1) RETURNING id, key'),
  queueSize: db.prepare('SELECT COUNT(*) AS n FROM queue WHERE account=? AND device=?'),
  enqueue: db.prepare('INSERT INTO queue VALUES (?,?,?,?,?,?,?,?)'),
  pending: db.prepare('SELECT id, sender, sender_device, type, body, ts FROM queue WHERE account=? AND device=? ORDER BY ts LIMIT 100'),
  ack: db.prepare('DELETE FROM queue WHERE id=? AND account=? AND device=?'),
  deleteAccount: db.prepare('DELETE FROM devices WHERE account=?'),
  forwardSet: db.prepare('INSERT OR REPLACE INTO hood_forward VALUES (?,?,?)'),
  forwardMember: db.prepare('INSERT OR IGNORE INTO hood_forward_members VALUES (?,?)'),
  forwardFor: db.prepare('SELECT f.sealed FROM hood_forward f JOIN hood_forward_members m ON m.lookup = f.lookup WHERE f.lookup = ? AND m.account = ?'),
  forwardExpire: db.prepare('DELETE FROM hood_forward WHERE created < ?'),
  hoodRow: db.prepare('SELECT created FROM hoods WHERE lookup = ?'),
  hoodMembersFull: db.prepare('SELECT account, joined FROM hood_members WHERE lookup = ?'),
  bansOf: db.prepare('SELECT account FROM hood_bans WHERE lookup = ?'),
  hoodCreateAt: db.prepare('INSERT INTO hoods VALUES (?,?,?)'),
  attachAdd: db.prepare('INSERT INTO attachments (id, account, size, created) VALUES (?,?,?,?)'),
  attachGet: db.prepare('SELECT id FROM attachments WHERE id = ?'),
  attachToday: db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE account = ? AND created > ?'),
  attachOld: db.prepare('DELETE FROM attachments WHERE (keep = 0 AND created < ?) OR created < ? RETURNING id'),
  attachKeep: db.prepare('UPDATE attachments SET keep = 1 WHERE id = ?'),
  attachKeptOf: db.prepare('SELECT id FROM attachments WHERE account = ? AND keep = 1 ORDER BY created DESC'),
  attachUnkeep: db.prepare('UPDATE attachments SET keep = 0 WHERE id = ?'),
  backupSet: db.prepare('INSERT OR REPLACE INTO backups VALUES (?,?,?,?)'),
  backupOf: db.prepare('SELECT * FROM backups WHERE account = ?'),
  backupByLookup: db.prepare('SELECT * FROM backups WHERE lookup = ?'),
  backupDrop: db.prepare('DELETE FROM backups WHERE account = ? RETURNING lookup'),
  dropPreKeys: db.prepare('DELETE FROM prekeys WHERE account = ? AND device = ?'),
  xferGet: db.prepare('SELECT * FROM transfers WHERE id = ?'),
  xferAdd: db.prepare('INSERT INTO transfers VALUES (?,?,?,?)'),
  xferDel: db.prepare('DELETE FROM transfers WHERE id = ?'),
  xferOld: db.prepare('DELETE FROM transfers WHERE created < ? RETURNING id, parts'),
  crashAdd: db.prepare('INSERT INTO crash_reports (received, app, os, message, stack) VALUES (?,?,?,?,?)'),
  crashOld: db.prepare('DELETE FROM crash_reports WHERE received < ?'),
  closedToken: db.prepare('SELECT 1 FROM closed_tokens WHERE token_hash = ?'),
  closedPhone: db.prepare('SELECT 1 FROM closed_phones WHERE phone_hmac = ?'),
  expire: db.prepare('DELETE FROM queue WHERE ts < ?'),
  accountExists: db.prepare('SELECT 1 AS x FROM devices WHERE account = ? LIMIT 1'),
  setCode: db.prepare('INSERT OR REPLACE INTO phone_codes VALUES (?,?,?,?,0)'),
  getCode: db.prepare('SELECT * FROM phone_codes WHERE account = ?'),
  bumpCode: db.prepare('UPDATE phone_codes SET tries = tries + 1 WHERE account = ?'),
  dropCode: db.prepare('DELETE FROM phone_codes WHERE account = ?'),
  dropPhoneOf: db.prepare('DELETE FROM phones WHERE account = ? OR phone_hmac = ?'),
  setPhone: db.prepare('INSERT INTO phones VALUES (?,?,1)'),
  phoneLookup: db.prepare('SELECT account FROM phones WHERE phone_hmac = ?'),
  deletePhone: db.prepare('DELETE FROM phones WHERE account = ?'),
  hoodGet: db.prepare('SELECT * FROM hoods WHERE lookup = ?'),
  hoodCreate: db.prepare('INSERT INTO hoods VALUES (?,?,?)'),
  hoodJoin: db.prepare('INSERT OR REPLACE INTO hood_members VALUES (?,?,?,?)'),
  hoodIsMember: db.prepare('SELECT 1 AS x FROM hood_members WHERE lookup = ? AND account = ?'),
  hoodMembers: db.prepare('SELECT account, profile FROM hood_members WHERE lookup = ? ORDER BY joined'),
  hoodLeave: db.prepare('DELETE FROM hood_members WHERE lookup = ? AND account = ?'),
  hoodCount: db.prepare('SELECT COUNT(*) AS n FROM hood_members WHERE lookup = ?'),
  hoodDelete: db.prepare('DELETE FROM hoods WHERE lookup = ?'),
  ownerSet: db.prepare('INSERT OR REPLACE INTO hood_owners VALUES (?,?)'),
  ownerGet: db.prepare('SELECT owner_hash FROM hood_owners WHERE lookup = ?'),
  metaSet: db.prepare('UPDATE hoods SET meta = ? WHERE lookup = ?'),
  ban: db.prepare('INSERT OR IGNORE INTO hood_bans VALUES (?,?)'),
  isBanned: db.prepare('SELECT 1 AS x FROM hood_bans WHERE lookup = ? AND account = ?'),
  pushSet: db.prepare('INSERT OR REPLACE INTO push_tokens VALUES (?,?,?,?)'),
  pushGet: db.prepare('SELECT token, env FROM push_tokens WHERE account = ? AND device = ?'),
  pushDrop: db.prepare('DELETE FROM push_tokens WHERE account = ? AND device = ?'),
  accessSet: db.prepare('INSERT OR REPLACE INTO access_keys VALUES (?,?)'),
  accessGet: db.prepare('SELECT key_hash FROM access_keys WHERE account = ?'),
  accessDrop: db.prepare('DELETE FROM access_keys WHERE account = ?'),
  deviceKey: db.prepare('SELECT identity_key FROM devices WHERE account = ? AND device = ?'),
  forgetAccountPhone: db.prepare('DELETE FROM phones WHERE account = ?'),
  forgetAccountCodes: db.prepare('DELETE FROM phone_codes WHERE account = ?'),
  forgetAccountHoods: db.prepare('DELETE FROM hood_members WHERE account = ?'),
};

const hash = (t) => createHash('sha256').update(t).digest('hex');
const phoneHmac = (p) => createHmac('sha256', PHONE_PEPPER).update(p).digest('hex');
const E164 = /^\+[1-9][0-9]{7,14}$/;
const LOOKUP = /^[0-9a-f]{64}$/;
const isSealed = (s) => isB64(s, 4096);

/* ---------- push wake-ups (Apple) ----------
 * A push carries no message, no name and no sender: only "You have something new." The phone opens
 * the app, which fetches and decrypts the real messages itself. Apple learns only that this device
 * got a ping. At most one ping per device every 30 seconds. */
const APNS = process.env.APNS_KEY_B64 && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID ? {
  key: createPrivateKey(Buffer.from(process.env.APNS_KEY_B64, 'base64').toString('utf8')),
  keyId: process.env.APNS_KEY_ID, team: process.env.APNS_TEAM_ID, topic: process.env.APNS_TOPIC ?? 'com.itsalifestyle.app',
} : null;
let apnsJwt = { token: '', at: 0 };
function apnsToken() {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwt.token && now - apnsJwt.at < 2400) return apnsJwt.token; // Apple wants a fresh one at most hourly
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64u({ alg: 'ES256', kid: APNS.keyId })}.${b64u({ iss: APNS.team, iat: now })}`;
  const sig = cryptoSign('sha256', Buffer.from(head), { key: APNS.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  apnsJwt = { token: `${head}.${sig}`, at: now };
  return apnsJwt.token;
}
const lastPush = new Map();
function wake(account, device) {
  if (!APNS) return;
  const row = q.pushGet.get(account, device);
  if (!row) return;
  const k = `${account}.${device}`, now = Date.now();
  if (now - (lastPush.get(k) ?? 0) < 30_000) return;
  lastPush.set(k, now);
  const host = row.env === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  try {
    const client = h2connect(host);
    client.on('error', () => client.close());
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${row.token}`, authorization: `bearer ${apnsToken()}`,
      'apns-topic': APNS.topic, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': 'new', 'content-type': 'application/json',
    });
    req.setEncoding('utf8');
    let status = 0, body = '';
    req.on('response', (h) => { status = Number(h[':status']); });
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      client.close();
      if (process.env.PUSH_DEBUG === '1') console.log(`push ${row.env} -> ${status} ${body}`);
      // Apple says the token is dead (app deleted, or a token from the other environment): forget it.
      if (status === 410 || (status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(body))) q.pushDrop.run(account, device);
    });
    req.end(JSON.stringify({ aps: { alert: { title: 'It’s a Lifestyle', body: 'You have something new.' }, sound: 'default' } }));
  } catch { /* a missed ping only delays delivery until the app is opened */ }
}

/* ---------- sealed sender ----------
 * The relay issues each device a short-lived certificate (signed by a server key, which is in turn
 * certified by a trust root whose private key never touches this server). Senders put it INSIDE the
 * encryption, then hand the sealed message to the relay without logging in, proving only that they
 * know the recipient's access key (shared among neighbors and contacts, inside encrypted messages).
 * The relay learns who receives a message, never who sent it. */
const SEALED = process.env.SS_SERVER_KEY_B64 && process.env.SS_SERVER_CERT_B64 ? {
  key: PrivateKey.deserialize(Buffer.from(process.env.SS_SERVER_KEY_B64, 'base64')),
  cert: ServerCertificate.deserialize(Buffer.from(process.env.SS_SERVER_CERT_B64, 'base64')),
} : null;
const CERT_HOURS = 24;

function sendSms(phone, text) {
  if (SMS_MODE === 'log') { console.log(`DEV SMS to ...${phone.slice(-4)}: ${text}`); return; }
  throw new HttpError(503, 'text messages are not set up on this server');
}
const ACCOUNT = /^[0-9a-f-]{36}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const isB64 = (s, max = 8192) => typeof s === 'string' && s.length > 0 && s.length <= max && B64.test(s);
const TYPES = ['prekey', 'message', 'group'];
const isId = (n) => Number.isInteger(n) && n >= 0 && n <= 0xFFFFFF;

class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req, max = MAX_BODY) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'too large'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'bad json'); }
}

function auth(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
  const row = m && q.deviceByToken.get(hash(m[1]));
  if (!row && m && q.closedToken.get(hash(m[1]))) throw new HttpError(403, 'account closed');
  if (!row) throw new HttpError(401, 'unauthorized');
  return { account: row.account, device: row.device };
}

// Simple per-key token bucket: enough to stop a runaway client or a guessing loop.
const buckets = new Map();
function limit(key, perMinute) {
  const now = Date.now(), b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute); b.at = now;
  if (b.tokens < 1) throw new HttpError(429, 'slow down');
  b.tokens -= 1; buckets.set(key, b);
}

/** Owner actions: the caller must be a member and know the owner secret. */
function checkOwner(lookup, me, proof) {
  if (!LOOKUP.test(lookup) || !q.hoodIsMember.get(lookup, me.account)) throw new HttpError(404, 'not found');
  const row = q.ownerGet.get(lookup);
  // Neighborhoods made before owner keys existed: the founding member (first to join) may set one.
  if (!row) {
    const first = q.hoodMembers.all(lookup)[0];
    if (first?.account === me.account) return;
    throw new HttpError(403, 'owners only');
  }
  const given = Buffer.from(hash(String(proof ?? ''))), want = Buffer.from(row?.owner_hash ?? '');
  if (!row || given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(403, 'owners only');
}

/* ---------- subscriptions ---------- */
const subId = (original) => createHmac('sha256', PHONE_PEPPER).update(`apple-sub:${original}`).digest('hex');
const activeSub = (account) => { const s = bq.subOf.get(account); return s && s.expires > Date.now() ? s : null; };
/** active: paid. grace: 30 days after it lapsed. paused: nobody new can join until someone subscribes. */
function planOf(lookup) {
  if (!BILLING_ON) return { state: 'active', until: 0, takeover: false };
  const p = bq.plan.get(lookup), until = Math.max(p?.free_until ?? 0, p?.expires ?? 0), now = Date.now();
  const state = now < until ? 'active' : now < until + GRACE_MS ? 'grace' : 'paused';
  return { state, until, takeover: now >= until + OWNER_FIRST_MS, sub: p?.sub ?? null, freeUntil: p?.free_until ?? 0 };
}
const planView = (lookup, me) => { const { state, until, takeover, sub } = planOf(lookup); return { state, until, takeover, mine: !!sub && sub === activeSub(me)?.id }; };
function saveTransaction(t, account) {
  if (t.env === 'Sandbox' && !ALLOW_SANDBOX) throw new HttpError(400, 'sandbox purchase');
  const id = subId(t.original), old = bq.sub.get(id);
  if (old && t.signed < old.signed) { if (account) bq.subSet.run(id, account, old.expires, old.signed, old.env); return id; } // never roll back to an older record
  const owner = account ?? old?.account;
  if (owner === undefined) return null; // a store notice for a purchase nobody has claimed yet
  bq.subSet.run(id, owner, t.expires, t.signed, t.env);
  return id;
}

function checkSigned(b) {
  if (!isId(b.signedPreKeyId) || !isB64(b.signedPreKey) || !isB64(b.signedPreKeySignature)
    || !isId(b.kyberPreKeyId) || !isB64(b.kyberPreKey) || !isB64(b.kyberPreKeySignature)) throw new HttpError(400, 'invalid keys');
}
function checkPreKeys(list) {
  if (!Array.isArray(list) || list.length > MAX_PREKEYS || !list.every(p => isId(p.id) && isB64(p.key, 100))) throw new HttpError(400, 'invalid prekeys');
}
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Behind a hosting proxy (Railway), the real client address is the last hop the proxy added.
// Used only as a rate-limit key, never logged or stored.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const clientKey = (req) => {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map(x => x.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket.remoteAddress ?? 'unknown';
};

const routes = {
  // Create an account with its first device. Returns the random account ID and the device secret.
  'POST /v1/accounts': async (req) => {
    limit(`reg:${clientKey(req)}`, 5);
    const b = await readJson(req);
    if (!Number.isInteger(b.registrationId) || b.registrationId < 1 || b.registrationId > 16380 || !isB64(b.identityKey, 100)) throw new HttpError(400, 'invalid registration');
    checkSigned(b); checkPreKeys(b.preKeys);
    const account = randomUUID(), device = 1, token = randomBytes(32).toString('base64url');
    tx(() => {
      q.insertDevice.run(account, device, hash(token), b.registrationId, b.identityKey,
        b.signedPreKeyId, b.signedPreKey, b.signedPreKeySignature, b.kyberPreKeyId, b.kyberPreKey, b.kyberPreKeySignature, Date.now());
      for (const p of b.preKeys) q.insertPreKey.run(account, device, p.id, p.key);
    });
    return [201, { account, device, token }];
  },

  // Replace my signed + post-quantum prekeys and/or add one-time prekeys.
  'PUT /v1/keys': async (req) => {
    const me = auth(req); limit(`keys:${me.account}`, 30);
    const b = await readJson(req);
    if (b.signedPreKey !== undefined) checkSigned(b);
    checkPreKeys(b.preKeys ?? []);
    const have = b.replacePreKeys === true ? 0 : q.countPreKeys.get(me.account, me.device).n;
    if (have + (b.preKeys ?? []).length > MAX_PREKEYS * 2) throw new HttpError(400, 'too many prekeys');
    tx(() => {
      // After restoring a backup: one-time prekeys on the relay may have no private half anymore.
      if (b.replacePreKeys === true) q.dropPreKeys.run(me.account, me.device);
      if (b.signedPreKey !== undefined) q.updateSigned.run(b.signedPreKeyId, b.signedPreKey, b.signedPreKeySignature,
        b.kyberPreKeyId, b.kyberPreKey, b.kyberPreKeySignature, me.account, me.device);
      for (const p of b.preKeys ?? []) q.insertPreKey.run(me.account, me.device, p.id, p.key);
    });
    return [204];
  },

  'GET /v1/keys/status': async (req) => {
    const me = auth(req);
    return [200, { preKeys: q.countPreKeys.get(me.account, me.device).n }];
  },

  // Just the device numbers of an account, so senders only fetch bundles for phones they haven't met.
  'GET /v1/devices/:account': async (req, { account }) => {
    const me = auth(req); limit(`devs:${me.account}`, 240);
    if (!ACCOUNT.test(account)) throw new HttpError(404, 'not found');
    const devs = q.devicesOf.all(account);
    if (!devs.length) throw new HttpError(404, 'not found');
    return [200, { devices: devs.map(d => d.device) }];
  },

  // Bundles for every device of an account (or one, with ?device=N). Each hands out (and deletes)
  // one one-time prekey.
  'GET /v1/keys/:account': async (req, { account }) => {
    const me = auth(req); limit(`fetch:${me.account}`, 60);
    if (!ACCOUNT.test(account)) throw new HttpError(404, 'not found');
    const only = new URL(req.url, 'http://relay').searchParams.get('device');
    const devs = q.devicesOf.all(account).filter(d => only === null || d.device === Number(only));
    if (!devs.length) throw new HttpError(404, 'not found');
    const out = tx(() => devs.map(d => {
      const one = q.takePreKey.get(d.account, d.device);
      return {
        deviceId: d.device, registrationId: d.registration_id, identityKey: d.identity_key,
        signedPreKeyId: d.signed_id, signedPreKey: d.signed_key, signedPreKeySignature: d.signed_sig,
        kyberPreKeyId: d.kyber_id, kyberPreKey: d.kyber_key, kyberPreKeySignature: d.kyber_sig,
        ...(one ? { preKeyId: one.id, preKey: one.key } : {}),
      };
    }));
    return [200, { devices: out }];
  },

  // Send one ciphertext per recipient device. The set must match the recipient's devices exactly,
  // so nobody's phone silently misses a message (409 tells the sender which to add or drop).
  'PUT /v1/messages/:account': async (req, { account }) => {
    const me = auth(req); limit(`send:${me.account}`, 120);
    if (!ACCOUNT.test(account)) throw new HttpError(404, 'not found');
    const { messages } = await readJson(req);
    // Writing to my own account means my other devices: this one never gets its own copy.
    const devs = q.devicesOf.all(account).map(d => d.device).filter(d => account !== me.account || d !== me.device);
    if (!devs.length) throw new HttpError(404, 'not found');
    if (!Array.isArray(messages) || !messages.every(m => Number.isInteger(m.deviceId) && TYPES.includes(m.type) && isB64(m.body, 200_000)))
      throw new HttpError(400, 'invalid messages');
    const sent = messages.map(m => m.deviceId);
    const missing = devs.filter(d => !sent.includes(d)), extra = sent.filter(d => !devs.includes(d));
    if (missing.length || extra.length || new Set(sent).size !== sent.length) throw new HttpError(409, 'device mismatch', { missing, extra });
    tx(() => {
      for (const m of messages) {
        if (q.queueSize.get(account, m.deviceId).n >= MAX_QUEUE) throw new HttpError(429, 'queue full');
        q.enqueue.run(randomUUID(), account, m.deviceId, me.account, me.device, m.type, m.body, Date.now());
      }
    });
    for (const m of messages) wake(account, m.deviceId);
    return [202];
  },

  /* ---------- linked devices (the phone plus up to 2) ---------- */
  // Only the phone can approve a new device. The one-time token is useless without the account's
  // private identity key, which reaches the new device only inside the end-to-end encrypted hand-off.
  'POST /v1/devices/link/start': async (req) => {
    const me = auth(req); limit(`link:${me.account}`, 6);
    if (me.device !== 1) throw new HttpError(403, 'only your phone can link devices');
    if (q.devicesOf.all(me.account).length >= MAX_DEVICES) throw new HttpError(409, 'device limit');
    const linkToken = randomBytes(32).toString('base64url');
    tx(() => { lq.expire.run(Date.now()); lq.dropFor.run(me.account); lq.add.run(hash(linkToken), me.account, Date.now() + 15 * 60_000); });
    return [201, { linkToken }];
  },
  'POST /v1/devices/link/finish': async (req) => {
    limit(`linkfinish:${clientKey(req)}`, 10);
    const b = await readJson(req);
    if (typeof b.linkToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.linkToken)) throw new HttpError(403, 'invalid link');
    if (!Number.isInteger(b.registrationId) || b.registrationId < 1 || b.registrationId > 16380 || !isB64(b.identityKey, 100)) throw new HttpError(400, 'invalid registration');
    checkSigned(b); checkPreKeys(b.preKeys);
    const token = randomBytes(32).toString('base64url');
    // Used up by the first attempt, even a failed one.
    const row = lq.take.get(hash(b.linkToken));
    if (!row || row.expires < Date.now()) throw new HttpError(403, 'invalid link');
    const out = tx(() => {
      const have = q.devicesOf.all(row.account), phone = have.find(d => d.device === 1);
      if (!phone || phone.identity_key !== b.identityKey) throw new HttpError(403, 'invalid link');
      if (have.length >= MAX_DEVICES) throw new HttpError(409, 'device limit');
      const device = [2, 3].find(n => !have.some(d => d.device === n));
      q.insertDevice.run(row.account, device, hash(token), b.registrationId, b.identityKey,
        b.signedPreKeyId, b.signedPreKey, b.signedPreKeySignature, b.kyberPreKeyId, b.kyberPreKey, b.kyberPreKeySignature, Date.now());
      for (const p of b.preKeys) q.insertPreKey.run(row.account, device, p.id, p.key);
      return { account: row.account, device };
    });
    return [201, { ...out, token }];
  },
  'GET /v1/devices/mine': async (req) => {
    const me = auth(req); limit(`devs:${me.account}`, 240);
    return [200, { me: me.device, limit: MAX_DEVICES, devices: q.devicesOf.all(me.account).map(d => ({ device: d.device, created: d.created })) }];
  },
  // The phone can remove a linked device; a linked device can remove itself. The phone can't be removed.
  'DELETE /v1/devices/mine/:device': async (req, { device }) => {
    const me = auth(req); limit(`unlink:${me.account}`, 12);
    const n = Number(device);
    if (n !== 2 && n !== 3) throw new HttpError(400, 'invalid device');
    if (me.device !== 1 && me.device !== n) throw new HttpError(403, 'only your phone can remove other devices');
    lq.dropDevice.run(me.account, n);
    return [204];
  },

  // Device numbers for many accounts at once (group fan-out). Unknown accounts are left out.
  'POST /v1/devices/lookup': async (req) => {
    const me = auth(req); limit(`devs:${me.account}`, 240);
    const { accounts } = await readJson(req);
    if (!Array.isArray(accounts) || accounts.length > 500 || !accounts.every(a => ACCOUNT.test(a))) throw new HttpError(400, 'invalid accounts');
    const out = {};
    for (const a of new Set(accounts)) { const d = q.devicesOf.all(a).map(x => x.device); if (d.length) out[a] = d; }
    return [200, { devices: out }];
  },

  // One request, many recipients: [{ to, deviceId, type, body }]. Group messages send the same
  // Sender Key ciphertext to every member's devices. Every device of each recipient must be covered.
  'PUT /v1/messages': async (req) => {
    const me = auth(req); limit(`send:${me.account}`, 120);
    const { messages } = await readJson(req);
    if (!Array.isArray(messages) || !messages.length || messages.length > 2000
      || !messages.every(m => ACCOUNT.test(m.to ?? '') && Number.isInteger(m.deviceId) && TYPES.includes(m.type) && isB64(m.body, 200_000)))
      throw new HttpError(400, 'invalid messages');
    const byTo = new Map();
    for (const m of messages) byTo.set(m.to, [...(byTo.get(m.to) ?? []), m.deviceId]);
    const mismatch = {};
    for (const [to, sent] of byTo) {
      const devs = q.devicesOf.all(to).map(d => d.device);
      const missing = devs.filter(d => !sent.includes(d)), extra = sent.filter(d => !devs.includes(d));
      if (!devs.length || missing.length || extra.length || new Set(sent).size !== sent.length) mismatch[to] = { missing, extra, gone: !devs.length };
    }
    if (Object.keys(mismatch).length) throw new HttpError(409, 'device mismatch', { mismatch });
    tx(() => {
      for (const m of messages) {
        if (q.queueSize.get(m.to, m.deviceId).n >= MAX_QUEUE) throw new HttpError(429, 'queue full');
        q.enqueue.run(randomUUID(), m.to, m.deviceId, me.account, me.device, m.type, m.body, Date.now());
      }
    });
    for (const m of messages) wake(m.to, m.deviceId);
    return [202];
  },

  // Register (or clear, with token null) this device's Apple push token.
  'PUT /v1/push': async (req) => {
    const me = auth(req); limit(`push:${me.account}`, 20);
    const { token, env } = await readJson(req);
    if (token === null) { q.pushDrop.run(me.account, me.device); return [204]; }
    if (!/^[0-9a-f]{64,200}$/.test(token ?? '') || !['sandbox', 'production'].includes(env)) throw new HttpError(400, 'invalid push token');
    q.pushSet.run(me.account, me.device, token, env);
    return [204];
  },

  // A sender certificate for this device (sealed sender). Valid for 24 hours.
  'GET /v1/certificate': async (req) => {
    const me = auth(req); limit(`cert:${me.account}`, 30);
    if (!SEALED) throw new HttpError(503, 'sealed sender is not set up on this server');
    const row = q.deviceKey.get(me.account, me.device);
    const expires = Date.now() + CERT_HOURS * 3600_000;
    const cert = SenderCertificate.new(me.account, null, me.device, PublicKey.deserialize(Buffer.from(row.identity_key, 'base64')), expires, SEALED.cert, SEALED.key);
    return [200, { certificate: Buffer.from(cert.serialize()).toString('base64'), expires }];
  },

  // My access key's fingerprint. Only people who know the key itself can send me sealed messages.
  'PUT /v1/access': async (req) => {
    const me = auth(req); limit(`access:${me.account}`, 10);
    const { keyHash } = await readJson(req);
    if (!LOOKUP.test(keyHash ?? '')) throw new HttpError(400, 'invalid access key');
    q.accessSet.run(me.account, keyHash);
    return [204];
  },

  // Sealed delivery: NO login. [{ to, accessKey, messages: [{ deviceId, body }] }]. The relay checks the
  // access key and the recipient's device list, and stores the message without any sender.
  'PUT /v1/sealed': async (req) => {
    limit(`sealed:${clientKey(req)}`, 240);
    const { recipients } = await readJson(req);
    if (!Array.isArray(recipients) || !recipients.length || recipients.length > 500) throw new HttpError(400, 'invalid recipients');
    const bad = {}, mismatch = {};
    for (const r of recipients) {
      if (!ACCOUNT.test(r?.to ?? '') || typeof r.accessKey !== 'string' || r.accessKey.length > 64 || !Array.isArray(r.messages)
        || !r.messages.every(m => Number.isInteger(m.deviceId) && isB64(m.body, 200_000))) throw new HttpError(400, 'invalid recipient');
      const want = q.accessGet.get(r.to)?.key_hash;
      const given = Buffer.from(hash(r.accessKey)), wantB = Buffer.from(want ?? '');
      if (!want || given.length !== wantB.length || !timingSafeEqual(given, wantB)) { bad[r.to] = true; continue; }
      const devs = q.devicesOf.all(r.to).map(d => d.device), sent = r.messages.map(m => m.deviceId);
      const missing = devs.filter(d => !sent.includes(d)), extra = sent.filter(d => !devs.includes(d));
      if (missing.length || extra.length || new Set(sent).size !== sent.length) mismatch[r.to] = { missing, extra };
    }
    // Same answer for "no such account" and "wrong key", so this can't be used to probe who exists.
    if (Object.keys(bad).length) throw new HttpError(401, 'access denied', { denied: Object.keys(bad) });
    if (Object.keys(mismatch).length) throw new HttpError(409, 'device mismatch', { mismatch });
    tx(() => {
      for (const r of recipients) for (const m of r.messages) {
        if (q.queueSize.get(r.to, m.deviceId).n >= MAX_QUEUE) throw new HttpError(429, 'queue full');
        q.enqueue.run(randomUUID(), r.to, m.deviceId, '', 0, 'sealed', m.body, Date.now());
      }
    });
    for (const r of recipients) for (const m of r.messages) wake(r.to, m.deviceId);
    return [202];
  },

  // My queued ciphertexts (oldest first). They stay until acknowledged.
  'GET /v1/messages': async (req) => {
    const me = auth(req); limit(`poll:${me.account}.${me.device}`, 120);
    const rows = q.pending.all(me.account, me.device);
    return [200, { messages: rows.map(r => ({ id: r.id, from: r.sender, fromDevice: r.sender_device, type: r.type, body: r.body, ts: r.ts })) }];
  },

  // Confirm receipt; the relay then deletes the ciphertext.
  'DELETE /v1/messages/:id': async (req, { id }) => {
    const me = auth(req);
    q.ack.run(id, me.account, me.device);
    return [204];
  },

  // Delete my account, every device, every prekey, everything queued for me, my phone number
  // and my neighborhood memberships.
  'DELETE /v1/accounts/me': async (req) => {
    const me = auth(req);
    if (me.device !== 1) throw new HttpError(403, 'only your phone can delete the account');
    tx(() => {
      bq.subForget.run(me.account); q.forgetAccountPhone.run(me.account); q.forgetAccountCodes.run(me.account); q.forgetAccountHoods.run(me.account); q.accessDrop.run(me.account);
      for (const { lookup } of q.backupDrop.all(me.account)) rmSync(join(ATTACH_DIR, `backup-${lookup}`), { force: true });
      q.deleteAccount.run(me.account);
    });
    return [204];
  },

  /* ---------- phone numbers (find each other like Signal) ---------- */

  // Text a 6-digit code to the number. Rate limited per account and per number.
  'POST /v1/phone/start': async (req) => {
    const me = auth(req); limit(`sms:${me.account}`, 3);
    const { phone } = await readJson(req);
    if (!E164.test(phone ?? '')) throw new HttpError(400, 'use the full number with country code, like +15555550123');
    const h = phoneHmac(phone); limit(`smsto:${h}`, 3);
    if (q.closedPhone.get(h)) throw new HttpError(403, 'this number can’t be used');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    q.setCode.run(me.account, h, hash(`${me.account}:${code}`), Date.now() + 10 * 60_000);
    sendSms(phone, `Your It's a Lifestyle code is ${code}. Don't share it with anyone.`);
    return [202];
  },

  // Confirm the code. The number then points to this account (and stops pointing anywhere else).
  'POST /v1/phone/verify': async (req) => {
    const me = auth(req); limit(`verify:${me.account}`, 10);
    const { phone, code } = await readJson(req);
    const row = q.getCode.get(me.account);
    if (!row || !E164.test(phone ?? '') || row.phone_hmac !== phoneHmac(phone) || row.expires < Date.now() || row.tries >= 5) throw new HttpError(400, 'code expired, ask for a new one');
    q.bumpCode.run(me.account);
    const want = Buffer.from(row.code_hash), got = Buffer.from(hash(`${me.account}:${String(code ?? '')}`));
    if (!timingSafeEqual(want, got)) throw new HttpError(400, 'wrong code');
    tx(() => { q.dropPhoneOf.run(me.account, row.phone_hmac); q.setPhone.run(row.phone_hmac, me.account); q.dropCode.run(me.account); });
    return [204];
  },

  // Which of these numbers are on the app? Capped and rate limited so nobody can sweep the phone book.
  'POST /v1/phone/lookup': async (req) => {
    const me = auth(req); limit(`lookup:${me.account}`, 20);
    const { phones } = await readJson(req);
    if (!Array.isArray(phones) || phones.length > 50 || !phones.every(p => E164.test(p))) throw new HttpError(400, 'invalid numbers');
    const found = phones.map(p => ({ phone: p, account: q.phoneLookup.get(phoneHmac(p))?.account })).filter(x => x.account && x.account !== me.account);
    return [200, { found }];
  },

  'DELETE /v1/phone': async (req) => { const me = auth(req); q.deletePhone.run(me.account); return [204]; },

  /* ---------- neighborhoods (member lists the server can't read) ---------- */
  // `lookup` is a one-way fingerprint of the invite code; `meta` and each `profile` are sealed with a
  // key derived from the code. The server never sees the code, the neighborhood's name or anyone's name.

  // `ownerHash` is SHA-256 of a secret only the owners' phones hold. The relay can check it but
  // never learns who the owners are.
  'POST /v1/hoods': async (req) => {
    const me = auth(req); limit(`hood:${me.account}`, 10);
    const { lookup, meta, profile, ownerHash } = await readJson(req);
    if (!LOOKUP.test(lookup ?? '') || !isSealed(meta) || !isSealed(profile) || (ownerHash !== undefined && !LOOKUP.test(ownerHash))) throw new HttpError(400, 'invalid neighborhood');
    if (q.hoodGet.get(lookup)) throw new HttpError(409, 'exists');
    const sub = BILLING_ON ? activeSub(me.account) : null;
    if (BILLING_ON && !sub) throw new HttpError(402, 'subscription required');
    if (sub && bq.used.get(sub.id).n >= HOODS_PER_SUB) throw new HttpError(409, 'subscription full');
    tx(() => {
      q.hoodCreate.run(lookup, meta, Date.now()); if (ownerHash) q.ownerSet.run(lookup, ownerHash); q.hoodJoin.run(lookup, me.account, profile, Date.now());
      if (sub) bq.planSet.run(lookup, sub.id, 0);
    });
    return [201];
  },

  // Owners: replace the sealed settings (name, places, owners…), optionally with a new owner secret.
  'PUT /v1/hoods/:lookup/meta': async (req, { lookup }) => {
    const me = auth(req); limit(`hoodmeta:${me.account}`, 30);
    const { proof, meta, newOwnerHash } = await readJson(req);
    checkOwner(lookup, me, proof);
    if (!isSealed(meta) || (newOwnerHash !== undefined && !LOOKUP.test(newOwnerHash))) throw new HttpError(400, 'invalid settings');
    tx(() => { q.metaSet.run(meta, lookup); if (newOwnerHash) q.ownerSet.run(lookup, newOwnerHash); });
    return [204];
  },

  // Owners: remove a member. They're barred from joining again with this account.
  'DELETE /v1/hoods/:lookup/members/:account': async (req, { lookup, account }) => {
    const me = auth(req); limit(`hoodmeta:${me.account}`, 30);
    if (account === 'me') return routes['DELETE /v1/hoods/:lookup/members/me'](req, { lookup }); // leaving
    const { proof } = await readJson(req);
    checkOwner(lookup, me, proof);
    if (!ACCOUNT.test(account)) throw new HttpError(400, 'invalid account');
    tx(() => { q.hoodLeave.run(lookup, account); q.ban.run(lookup, account); });
    return [204];
  },

  // Join with the code's fingerprint. Strict rate limit: guessing codes through the server is hopeless.
  'POST /v1/hoods/:lookup/members': async (req, { lookup }) => {
    const me = auth(req); limit(`join:${me.account}`, 10);
    const { profile } = await readJson(req);
    if (!LOOKUP.test(lookup) || !isSealed(profile) || !q.hoodGet.get(lookup)) throw new HttpError(404, 'not found');
    if (q.isBanned.get(lookup, me.account)) throw new HttpError(403, 'removed from this neighborhood');
    if (q.hoodCount.get(lookup).n >= 2000) throw new HttpError(409, 'neighborhood full');
    // Existing members can always refresh their profile; only new people are held back.
    if (!q.hoodIsMember.get(lookup, me.account) && planOf(lookup).state === 'paused') throw new HttpError(402, 'neighborhood paused');
    q.hoodJoin.run(lookup, me.account, profile, Date.now());
    return [204];
  },

  // Owners: move the neighborhood to a new invite code. The owner's phone re-seals the settings and
  // every member's profile with the new code; the old code stops working at once. Members at the time
  // can still read where it went (sealed with the old code) for 90 days, so offline phones catch up.
  // Removed members and anyone else holding the old code get "not found".
  'POST /v1/hoods/:lookup/move': async (req, { lookup }) => {
    const me = auth(req); limit(`hoodmeta:${me.account}`, 30);
    const { proof, newLookup, meta, profiles, forward } = await readJson(req);
    checkOwner(lookup, me, proof);
    if (!LOOKUP.test(newLookup ?? '') || newLookup === lookup || !isSealed(meta) || !isSealed(forward) || !profiles || typeof profiles !== 'object') throw new HttpError(400, 'invalid move');
    if (q.hoodGet.get(newLookup)) throw new HttpError(409, 'exists');
    const members = q.hoodMembersFull.all(lookup);
    const entries = Object.entries(profiles);
    if (entries.length > 2000 || !entries.every(([a, p]) => members.some(m => m.account === a) && isSealed(p)) || !profiles[me.account]) throw new HttpError(400, 'invalid profiles');
    tx(() => {
      const owner = q.ownerGet.get(lookup), bans = q.bansOf.all(lookup), plan = bq.plan.get(lookup);
      q.hoodCreateAt.run(newLookup, meta, q.hoodRow.get(lookup).created);
      if (plan) bq.planSet.run(newLookup, plan.sub, plan.free_until);
      if (owner) q.ownerSet.run(newLookup, owner.owner_hash);
      for (const m of members) if (profiles[m.account]) q.hoodJoin.run(newLookup, m.account, profiles[m.account], m.joined);
      for (const b of bans) q.ban.run(newLookup, b.account);
      q.forwardSet.run(lookup, forward, Date.now());
      for (const m of members) q.forwardMember.run(lookup, m.account);
      q.hoodDelete.run(lookup);
    });
    return [204];
  },

  // Members only: the sealed name and the sealed member list. After a move, members at the time get
  // the new code sealed with the old one instead.
  'GET /v1/hoods/:lookup': async (req, { lookup }) => {
    const me = auth(req); limit(`hoodget:${me.account}`, 120);
    if (!LOOKUP.test(lookup)) throw new HttpError(404, 'not found');
    if (!q.hoodIsMember.get(lookup, me.account)) {
      const fwd = q.forwardFor.get(lookup, me.account);
      if (fwd) return [200, { moved: fwd.sealed }];
      throw new HttpError(404, 'not found');
    }
    return [200, { meta: q.hoodGet.get(lookup).meta, members: q.hoodMembers.all(lookup), plan: planView(lookup, me.account) }];
  },

  'DELETE /v1/hoods/:lookup/members/me': async (req, { lookup }) => {
    const me = auth(req);
    if (!LOOKUP.test(lookup)) throw new HttpError(404, 'not found');
    tx(() => { q.hoodLeave.run(lookup, me.account); if (q.hoodCount.get(lookup).n === 0) q.hoodDelete.run(lookup); });
    return [204];
  },

  /* ---------- neighborhood subscriptions ---------- */
  'GET /v1/billing': async (req) => {
    const me = auth(req); limit(`billing:${me.account}`, 60);
    const s = activeSub(me.account);
    return [200, { on: BILLING_ON, product: PRODUCT, limit: HOODS_PER_SUB, active: !!s, expires: s?.expires ?? 0, used: s ? bq.used.get(s.id).n : 0 }];
  },

  // The phone hands over Apple's signed record of the purchase; the relay checks Apple's signature.
  'POST /v1/billing/apple': async (req) => {
    const me = auth(req); limit(`billing:${me.account}`, 20);
    const { jws } = await readJson(req);
    let t; try { t = readTransaction(verifyAppleJws(jws, APPLE_ROOT)); } catch { throw new HttpError(400, 'invalid purchase'); }
    tx(() => saveTransaction(t, me.account));
    const s = activeSub(me.account);
    return [200, { active: !!s, expires: s?.expires ?? 0, used: s ? bq.used.get(s.id).n : 0, limit: HOODS_PER_SUB }];
  },

  // App Store Server Notifications V2: renewals, expirations and refunds. Signed by Apple, so no login.
  'POST /v1/billing/apple/notify': async (req) => {
    limit(`applenotify:${clientKey(req)}`, 120);
    const { signedPayload } = await readJson(req);
    try {
      const n = verifyAppleJws(signedPayload, APPLE_ROOT);
      if (n.data?.bundleId !== 'com.itsalifestyle.app' || !n.data?.signedTransactionInfo) return [200, {}];
      const t = readTransaction(verifyAppleJws(n.data.signedTransactionInfo, APPLE_ROOT));
      tx(() => saveTransaction(t));
    } catch { throw new HttpError(400, 'invalid notification'); }
    return [200, {}];
  },

  // Put my subscription on a neighborhood. An owner can do this any time it isn't covered. After the
  // owner's first 7 days to fix a lapse, any member can pay and become the owner.
  'POST /v1/hoods/:lookup/plan': async (req, { lookup }) => {
    const me = auth(req); limit(`hoodmeta:${me.account}`, 30);
    if (!BILLING_ON) throw new HttpError(409, 'billing off');
    if (!LOOKUP.test(lookup) || !q.hoodIsMember.get(lookup, me.account)) throw new HttpError(404, 'not found');
    const { proof, newOwnerHash, meta } = await readJson(req);
    const sub = activeSub(me.account);
    if (!sub) throw new HttpError(402, 'subscription required');
    const plan = planOf(lookup);
    if (plan.sub === sub.id) return [200, { plan: planView(lookup, me.account) }];
    if (plan.state === 'active') throw new HttpError(409, 'already covered');
    if (bq.used.get(sub.id).n >= HOODS_PER_SUB) throw new HttpError(409, 'subscription full');
    let isOwner = false;
    try { checkOwner(lookup, me, proof); isOwner = true; } catch (e) { if (e.status !== 403) throw e; }
    if (!isOwner) {
      if (!plan.takeover) throw new HttpError(403, 'owner has time to renew');
      if (!LOOKUP.test(newOwnerHash ?? '') || !isSealed(meta)) throw new HttpError(400, 'invalid takeover');
    }
    tx(() => {
      bq.planSet.run(lookup, sub.id, plan.freeUntil);
      if (!isOwner) { q.ownerSet.run(lookup, newOwnerHash); q.metaSet.run(meta, lookup); }
    });
    return [200, { plan: planView(lookup, me.account), tookOver: !isOwner }];
  },

  /* ---------- encrypted attachments ---------- */
  // The phone encrypts each photo with its own key before upload; the key and the ciphertext's SHA-256
  // travel only inside the end-to-end encrypted message. The relay sees a random ID and a size.
  'PUT /v1/attachments': async (req) => {
    const me = auth(req); limit(`attach:${me.account}`, 20);
    const { data, keep } = await readJson(req, ATTACH_MAX + 64);
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(data) || data.length > ATTACH_MAX) throw new HttpError(400, 'invalid attachment');
    const size = Math.floor(data.length * 3 / 4);
    if (q.attachToday.get(me.account, Date.now() - 864e5).n + size > 200_000_000) throw new HttpError(429, 'daily limit reached');
    const id = randomBytes(16).toString('hex');
    writeFileSync(join(ATTACH_DIR, id), Buffer.from(data, 'base64'));
    q.attachAdd.run(id, me.account, size, Date.now());
    if (keep === true) tx(() => { q.attachKeep.run(id); for (const o of q.attachKeptOf.all(me.account).slice(KEEP_MAX)) q.attachUnkeep.run(o.id); });
    return [201, { id }];
  },
  'GET /v1/attachments/:id': async (req, { id }) => {
    const me = auth(req); limit(`attachget:${me.account}`, 120);
    if (!/^[0-9a-f]{32}$/.test(id) || !q.attachGet.get(id)) throw new HttpError(404, 'not found');
    return [200, { data: readFileSync(join(ATTACH_DIR, id)).toString('base64') }];
  },

  /* ---------- recovery backups ---------- */
  'PUT /v1/backup': async (req) => {
    const me = auth(req); limit(`backup:${me.account}`, 10);
    const { lookup, data } = await readJson(req, ATTACH_MAX + 256);
    if (!LOOKUP.test(lookup ?? '') || typeof data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(data) || data.length > ATTACH_MAX) throw new HttpError(400, 'invalid backup');
    const taken = q.backupByLookup.get(lookup);
    if (taken && taken.account !== me.account) throw new HttpError(409, 'pick a new recovery code');
    const old = q.backupOf.get(me.account);
    if (old && old.lookup !== lookup) rmSync(join(ATTACH_DIR, `backup-${old.lookup}`), { force: true });
    writeFileSync(join(ATTACH_DIR, `backup-${lookup}`), data);
    q.backupSet.run(me.account, lookup, data.length, Date.now());
    return [204];
  },
  'DELETE /v1/backup': async (req) => {
    const me = auth(req);
    for (const { lookup } of q.backupDrop.all(me.account)) rmSync(join(ATTACH_DIR, `backup-${lookup}`), { force: true });
    return [204];
  },
  // No login: a restoring phone has no account yet. The lookup is 256 bits derived from a 120-bit
  // recovery code, and the data is useless without the code. Strictly rate limited anyway.
  'GET /v1/backup/:lookup': async (req, { lookup }) => {
    limit(`backupget:${clientKey(req)}`, 10);
    const row = LOOKUP.test(lookup) && q.backupByLookup.get(lookup);
    if (!row) throw new HttpError(404, 'not found');
    return [200, { data: readFileSync(join(ATTACH_DIR, `backup-${lookup}`), 'utf8'), updated: row.updated }];
  },

  /* ---------- moving to a new phone ---------- */
  // The old phone uploads the encrypted account in parts; the new phone (which showed the QR code)
  // downloads them and then finishes the transfer, which tells the old phone to wipe itself.
  'PUT /v1/transfer/:id/:part': async (req, { id, part }) => {
    const me = auth(req); limit(`xfer:${me.account}`, 60);
    const n = Number(part);
    const { data, parts, doneHash } = await readJson(req, ATTACH_MAX + 256);
    if (!XFER.test(id) || !Number.isInteger(n) || n < 0 || n >= XFER_PARTS || typeof data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(data) || data.length > ATTACH_MAX) throw new HttpError(400, 'invalid transfer');
    let row = q.xferGet.get(id);
    if (!row) {
      if (!Number.isInteger(parts) || parts < 1 || parts > XFER_PARTS || !LOOKUP.test(doneHash ?? '')) throw new HttpError(400, 'invalid transfer');
      q.xferAdd.run(id, parts, doneHash, Date.now()); row = q.xferGet.get(id);
    }
    if (n >= row.parts) throw new HttpError(400, 'invalid part');
    const file = join(ATTACH_DIR, `xfer-${id}-${n}`);
    if (existsSync(file)) throw new HttpError(409, 'already uploaded');
    writeFileSync(file, data);
    return [204];
  },
  // No login: the new phone may not have an account yet. The ID is 128 random bits from its QR code.
  'GET /v1/transfer/:id': async (req, { id }) => {
    limit(`xferget:${clientKey(req)}`, 120);
    const row = XFER.test(id) && q.xferGet.get(id);
    if (!row) throw new HttpError(404, 'not found');
    let ready = 0;
    for (let n = 0; n < row.parts; n++) if (existsSync(join(ATTACH_DIR, `xfer-${id}-${n}`))) ready++;
    return [200, { parts: row.parts, ready }];
  },
  'GET /v1/transfer/:id/:part': async (req, { id, part }) => {
    limit(`xferget:${clientKey(req)}`, 120);
    const row = XFER.test(id) && q.xferGet.get(id), n = Number(part);
    const file = join(ATTACH_DIR, `xfer-${id}-${n}`);
    if (!row || !Number.isInteger(n) || n < 0 || n >= row.parts || !existsSync(file)) throw new HttpError(404, 'not found');
    return [200, { data: readFileSync(file, 'utf8') }];
  },
  // Finishing deletes everything; only someone holding the transfer key can do it.
  'POST /v1/transfer/:id/done': async (req, { id }) => {
    limit(`xferget:${clientKey(req)}`, 120);
    const row = XFER.test(id) && q.xferGet.get(id);
    const { proof } = await readJson(req);
    if (!row) throw new HttpError(404, 'not found');
    const want = Buffer.from(row.done_hash), got = Buffer.from(hash(String(proof ?? '')));
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw new HttpError(403, 'wrong proof');
    for (let n = 0; n < row.parts; n++) rmSync(join(ATTACH_DIR, `xfer-${id}-${n}`), { force: true });
    q.xferDel.run(id);
    return [204];
  },

  /* ---------- crash reports (opt-in, anonymous) ---------- */
  // No login, so a report can't be tied to an account. The IP is used only for the rate limit.
  'POST /v1/crash': async (req) => {
    limit(`crash:${clientKey(req)}`, 5);
    const { message, stack, app, os } = await readJson(req, 16 * 1024);
    const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
    if (!str(message, 1)) throw new HttpError(400, 'invalid report');
    q.crashAdd.run(Date.now(), str(app, 40), str(os, 40), str(message, 300), str(stack, 3000));
    return [204];
  },

  'GET /health': async () => [200, { ok: true }],
};

function match(method, path) {
  for (const [key, fn] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const a = pattern.split('/'), b = path.split('/');
    if (a.length !== b.length) continue;
    const params = {};
    if (a.every((seg, i) => seg.startsWith(':') ? (params[seg.slice(1)] = decodeURIComponent(b[i]), true) : seg === b[i])) return [fn, params];
  }
  return [null];
}

/* ---------- public web pages (privacy policy, guidelines, support) ---------- */
// Plain static HTML, built once at start-up. The App Store needs public URLs for these.
const SITE = new URL('./site/', import.meta.url);
const SUPPORT_EMAIL = /^[^\s@<>"']+@[^\s@<>"']+$/.test(process.env.SUPPORT_EMAIL ?? '') ? process.env.SUPPORT_EMAIL : '';
// Shown as (929) 555-0123; dialed as +19295550123. Digits only are accepted.
const SUPPORT_PHONE = /^\+?1?\d{10}$/.test((process.env.SUPPORT_PHONE ?? '').replace(/[\s().-]/g, '')) ? (process.env.SUPPORT_PHONE ?? '').replace(/[\s().-]/g, '').replace(/^\+?1?(\d{10})$/, '$1') : '';
const PAGES = (() => {
  const read = f => readFileSync(new URL(f, SITE), 'utf8');
  const phone = SUPPORT_PHONE && `<a href="tel:+1${SUPPORT_PHONE}">(${SUPPORT_PHONE.slice(0, 3)}) ${SUPPORT_PHONE.slice(3, 6)}-${SUPPORT_PHONE.slice(6)}</a>`;
  const fill = html => (SUPPORT_EMAIL ? html.replaceAll('{{SUPPORT_EMAIL}}', SUPPORT_EMAIL)
    : html.replace(/<a href="mailto:\{\{SUPPORT_EMAIL\}\}">\{\{SUPPORT_EMAIL\}\}<\/a>/g, 'us (address coming soon)'))
    .replace(/<span data-phone>(.*?)<\/span>/g, (_, text) => (phone ? text.replace('{{SUPPORT_PHONE}}', phone) : ''));
  const out = { '/style.css': ['text/css', read('style.css')] };
  for (const [path, file, title] of [['/', 'index.html', 'Home'], ['/privacy', 'privacy.html', 'Privacy policy'], ['/guidelines', 'guidelines.html', 'Community guidelines'], ['/support', 'support.html', 'Support']])
    out[path] = ['text/html; charset=utf-8', fill(read('_head.html').replace('{{TITLE}}', title) + read(file) + read('_foot.html'))];
  return out;
})();
function sendPage(res, [type, body]) {
  res.writeHead(200, {
    'content-type': type, 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://relay').pathname;
    if (req.method === 'GET' && PAGES[path]) return sendPage(res, PAGES[path]);
    // Static routes win over parameter routes (e.g. /v1/keys/status vs /v1/keys/:account).
    const [fn, params] = routes[`${req.method} ${path}`] ? [routes[`${req.method} ${path}`], {}] : match(req.method, path);
    if (!fn) return send(res, 404, { error: 'not found' });
    const [status, body] = await fn(req, params);
    send(res, status, body);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...e.extra });
    send(res, 500, { error: 'server error' });
  }
});

/* ---------- backups ---------- */
// Once a day, a consistent copy of the database (VACUUM INTO) next to it; the newest 7 are kept.
// It holds what the relay holds: hashes, public keys and ciphertext, no readable messages.
// Attachments aren't backed up: they're temporary (30 days) and each sender keeps the original.
const BACKUP_DIR = join(dirname(DB_PATH), 'backups');
function backupNow() {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const file = join(BACKUP_DIR, `relay-${new Date().toISOString().slice(0, 10)}.db`);
    if (existsSync(file)) return;
    db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    const old = readdirSync(BACKUP_DIR).filter(f => /^relay-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -7);
    for (const f of old) rmSync(join(BACKUP_DIR, f), { force: true });
    console.log(`backup written (${old.length} old removed)`);
  } catch (e) { console.error('backup failed', String(e)); }
}
if (DB_PATH !== ':memory:') { backupNow(); setInterval(backupNow, 3600_000).unref(); }

setInterval(() => {
  for (const { id } of q.attachOld.all(Date.now() - TTL_MS, Date.now() - KEEP_MS)) rmSync(join(ATTACH_DIR, id), { force: true });
  q.expire.run(Date.now() - TTL_MS); q.crashOld.run(Date.now() - 90 * 864e5);
  for (const { id, parts } of q.xferOld.all(Date.now() - 3600_000)) for (let n = 0; n < parts; n++) rmSync(join(ATTACH_DIR, `xfer-${id}-${n}`), { force: true }); q.forwardExpire.run(Date.now() - 90 * 864e5); }, 3600_000).unref();
server.listen(PORT, '0.0.0.0', () => console.log(`relay listening on ${PORT}${APNS ? ' (push on)' : ''}${SEALED ? ' (sealed sender on)' : ''}`));

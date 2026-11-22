// Verifies Apple's signed subscription records (JWS) without any third-party service or Apple API key.
// A record counts only if its certificate chain ends at Apple's pinned root and its signature checks out.
import { createHash, createVerify, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PRODUCT = 'com.itsalifestyle.app.neighborhood.annual';
export const BUNDLE = 'com.itsalifestyle.app';
const ROOT_SHA256 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';
// Apple's marker extensions: 1.2.840.113635.100.6.11.1 (leaf) and 1.2.840.113635.100.6.2.1 (intermediate).
const OID_LEAF = Buffer.from('06 0a 2a 86 48 86 f7 63 64 06 0b 01'.replaceAll(' ', ''), 'hex');
const OID_MID = Buffer.from('06 0a 2a 86 48 86 f7 63 64 06 02 01'.replaceAll(' ', ''), 'hex');

export function appleRoot() {
  const der = readFileSync(new URL('./apple-root-ca-g3.cer', import.meta.url));
  if (createHash('sha256').update(der).digest('hex') !== ROOT_SHA256) throw new Error('Apple root certificate does not match its pin');
  return der;
}

const part = (s) => { if (!/^[A-Za-z0-9_-]+$/.test(s ?? '')) throw new Error('bad jws'); return Buffer.from(s, 'base64url'); };
const within = (c, t) => t >= Date.parse(c.validFrom) && t <= Date.parse(c.validTo);

/** Returns the payload of an Apple-signed JWS, or throws. `rootDer` is the trusted root certificate. */
export function verifyAppleJws(jws, rootDer, now = Date.now()) {
  if (typeof jws !== 'string' || jws.length > 32768) throw new Error('bad jws');
  const [h, p, s, extra] = jws.split('.');
  if (extra !== undefined) throw new Error('bad jws');
  const header = JSON.parse(part(h).toString('utf8'));
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length !== 3) throw new Error('bad jws header');
  const ders = header.x5c.map(x => Buffer.from(String(x), 'base64'));
  if (!ders[2].equals(rootDer)) throw new Error('untrusted root');
  if (!ders[0].includes(OID_LEAF) || !ders[1].includes(OID_MID)) throw new Error('not an App Store certificate');
  const [leaf, mid, root] = ders.map(d => new X509Certificate(d));
  if (!leaf.verify(mid.publicKey) || !mid.verify(root.publicKey) || !mid.ca || leaf.ca) throw new Error('bad chain');
  const payload = JSON.parse(part(p).toString('utf8'));
  // Certificates are checked at signing time: an old record stays valid after its certificate rotates.
  const at = Number(payload.signedDate) || now;
  if (at > now + 300_000 || ![leaf, mid, root].every(c => within(c, at))) throw new Error('certificate not valid');
  const v = createVerify('SHA256'); v.update(`${h}.${p}`);
  if (!v.verify({ key: leaf.publicKey, dsaEncoding: 'ieee-p1363' }, part(s))) throw new Error('bad signature');
  return payload;
}

/** The fields we keep from a verified subscription transaction. */
export function readTransaction(t) {
  if (t?.bundleId !== BUNDLE || t?.productId !== PRODUCT || typeof t?.originalTransactionId !== 'string') throw new Error('wrong product');
  if (t.environment !== 'Production' && t.environment !== 'Sandbox') throw new Error('bad environment');
  const expires = t.revocationDate ? 0 : Number(t.expiresDate);
  if (!Number.isFinite(expires)) throw new Error('no expiry');
  return { original: t.originalTransactionId, expires, signed: Number(t.signedDate) || 0, env: t.environment };
}

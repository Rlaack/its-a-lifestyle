// One-time setup for sealed sender. Run on a trusted computer, never on the server:
//   node tools/make-sealed-sender-keys.mjs <file to keep the trust-root private key in>
// - The trust root's PRIVATE key is written only to that file: keep it offline (password manager).
//   It's needed again only to make a new server certificate (e.g. if the server key leaks).
// - The trust root's PUBLIC key goes into the app (src/data/secure/client.ts, SEALED_TRUST_ROOT).
// - The server key and the server certificate signed by the trust root go into the relay's settings.
import { writeFileSync } from 'node:fs';
import { PrivateKey, ServerCertificate } from '@signalapp/libsignal-client';

const out = process.argv[2];
if (!out) { console.error('usage: node tools/make-sealed-sender-keys.mjs <trust-root-file>'); process.exit(1); }
const trustRoot = PrivateKey.generate();
const serverKey = PrivateKey.generate();
const cert = ServerCertificate.new(1, serverKey.getPublicKey(), trustRoot);
writeFileSync(out, trustRoot.serialize().toString('base64') + '\n', { mode: 0o600 });
// Printed so they can be piped into settings; only the public key is meant to be read by people.
console.log(`TRUST_ROOT_PUBLIC=${Buffer.from(trustRoot.getPublicKey().serialize()).toString('base64')}`);
console.log(`SS_SERVER_KEY_B64=${Buffer.from(serverKey.serialize()).toString('base64')}`);
console.log(`SS_SERVER_CERT_B64=${Buffer.from(cert.serialize()).toString('base64')}`);

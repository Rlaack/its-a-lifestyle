import { requireOptionalNativeModule } from 'expo';
import type { Account, Envelope, FetchedBundle, PreKey, PublishedKeys } from './LifestyleCrypto.types';

type NativeCrypto = {
  libsignalVersion: string;
  /** Current folder (file URI) for decrypted attachments; it moves when the app is reinstalled or updated. */
  attachmentsDir(): string;
  deleteAttachment(uri: string): void;
  exportLink(transferKey: string, text: string): Promise<string>;
  importLink(blob: string, transferKey: string): Promise<string>;
  /** Encrypts a photo with a fresh key. `data` goes to the relay; `key` and `digest` go in the encrypted message; `uri` is my local copy. */
  encryptAttachment(uri: string, kind?: 'photo' | 'voice' | 'file', ext?: string): Promise<{ data: string; key: string; digest: string; uri: string }>;
  /** Verifies (digest) and decrypts a downloaded attachment; returns a local file URI. */
  decryptAttachment(data: string, key: string, digest: string, kind?: 'photo' | 'voice' | 'file', ext?: string): Promise<string>;
  /** 128 random bits from the system CSPRNG, hex. Synchronous. */
  randomId(): string;
  /** XXXX-XXXX-XXXX, ~60 random bits. */
  randomInviteCode(): string;
  /** One-way fingerprint of a shared secret; what the server sees instead of the invite code. */
  secretLookup(secret: string): string;
  /** Plain SHA-256 as hex. */
  sha256Hex(text: string): string;
  /** AES-256-GCM with a key derived from a shared secret (HKDF-SHA256). */
  sealWithSecret(secret: string, text: string): string;
  openWithSecret(secret: string, sealed: string): string;
  account(): Promise<Account | null>;
  createAccount(name: string, deviceId: number): Promise<Account>;
  publicBundle(): Promise<PublishedKeys>;
  generatePreKeys(count: number): Promise<PreKey[]>;
  rotateSignedPreKeys(): Promise<void>;
  preKeyCount(): Promise<number>;
  hasSession(name: string, deviceId: number): Promise<boolean>;
  startSession(name: string, bundle: FetchedBundle): Promise<void>;
  encrypt(name: string, deviceId: number, plaintext: string): Promise<Envelope>;
  decrypt(name: string, deviceId: number, type: Envelope['type'], body: string): Promise<string>;
  safetyNumber(name: string, deviceId: number): Promise<string>;
  /** Groups (Sender Keys): my key for a group, to hand to each member over 1:1 sessions. */
  groupKey(distributionId: string): Promise<string>;
  acceptGroupKey(name: string, deviceId: number, key: string): Promise<void>;
  groupEncrypt(distributionId: string, plaintext: string): Promise<string>;
  groupDecrypt(name: string, deviceId: number, body: string): Promise<string>;
  /** Sealed sender: the relay can't see who sent these. */
  sealedEncrypt(name: string, deviceId: number, plaintext: string, certificate: string): Promise<string>;
  sealedGroupEncrypt(distributionId: string, plaintext: string, certificate: string, recipients: [string, string][]): Promise<string[]>;
  sealedDecrypt(body: string, trustRoot: string): Promise<{ from: string; fromDevice: number; type: 'prekey' | 'message' | 'group'; plaintext: string }>;
  identityChanged(name: string, deviceId: number): Promise<boolean>;
  remoteIdentity(name: string, deviceId: number): Promise<string | null>;
  pinIdentity(name: string, deviceId: number, identityKey: string): Promise<void>;
  vaultWrite(name: string, text: string): Promise<void>;
  vaultRead(name: string): Promise<string | null>;
  acceptIdentityChange(name: string, deviceId: number): Promise<void>;
  /** After the relay registers this device: bind keys to the issued account ID. Once only. */
  finishRegistration(accountId: string, deviceId: number, token: string): Promise<void>;
  relayToken(): Promise<string | null>;
  setRelayToken(token: string): Promise<void>;
  deleteAccount(): Promise<void>;
  /** Moving to a new phone: everything on this phone, encrypted with the transfer key (base64). */
  exportTransfer(transferKey: string): Promise<string>;
  /** The new phone: replaces its (empty) account with the transferred one. */
  importTransfer(blob: string, transferKey: string): Promise<void>;
  /** Wipes this phone's keys and data but leaves the account on the relay (it moved). */
  forgetLocally(): Promise<void>;
  /** Recovery backup: keys, chats and settings (no attachments), encrypted with the backup key (base64). */
  exportBackup(backupKey: string): Promise<string>;
  /** After a restore: drops stale sessions and one-time prekeys and rotates the signed prekeys. */
  resetAfterRestore(): Promise<void>;
};

/** Errors the native side raises on purpose; check `error.message` for these. */
export const CryptoErrors = {
  noAccount: 'NO_ACCOUNT',
  accountExists: 'ACCOUNT_EXISTS',
  identityChanged: 'IDENTITY_CHANGED',
} as const;

// null in Expo Go, which can't load our native code; a development build is required.
export default requireOptionalNativeModule<NativeCrypto>('LifestyleCrypto');

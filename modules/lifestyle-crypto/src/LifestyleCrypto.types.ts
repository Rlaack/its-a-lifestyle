// Public values only. Private keys never leave native code.
export type Account = { name: string; deviceId: number; registrationId: number; identityKey: string };

export type PreKey = { id: number; key: string };

export type PublicBundle = {
  registrationId: number;
  deviceId: number;
  identityKey: string;
  signedPreKeyId: number;
  signedPreKey: string;
  signedPreKeySignature: string;
  kyberPreKeyId: number;
  kyberPreKey: string;
  kyberPreKeySignature: string;
};

/** What we publish to the relay: the bundle plus a batch of one-time prekeys. */
export type PublishedKeys = PublicBundle & { preKeys: PreKey[] };

/** What the relay hands out: the bundle plus at most one one-time prekey (used once, then deleted). */
export type FetchedBundle = PublicBundle & { preKeyId?: number; preKey?: string };

/** 'group' bodies are Sender Key ciphertext; the others are 1:1 Signal messages. */
export type Envelope = { type: 'prekey' | 'message' | 'group'; body: string };

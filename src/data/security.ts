// Single switch for whether real end-to-end encryption is running.
// Legacy switch for the prototype's chats. Real chats are encrypted with libsignal whatever this says.
// Keep it false: turning it on would show claims for features that don't exist (calls, a public key log).
export const ENCRYPTION_LIVE = false;

export const NOT_ENCRYPTED_WARNING = 'This chat isn’t encrypted. Don’t share anything private.';

// Shown to everyone, always: encryption protects messages, but this is still a neighborhood app.
export const SENSITIVE_INFO_NOTICE =
  'Not for official or sensitive information. Don’t share operational, controlled or classified details, deployment dates or duty locations here. Follow your organization’s rules for those.';

/** Where people reach us: support questions, abuse reports, App Review. */
const SITE = 'https://www.cyber-affinity.com/its-a-lifestyle';
export const PRIVACY_URL = `${SITE}/privacy`;
export const TERMS_URL = `${SITE}/terms`;
export const SUPPORT_URL = SITE;

export const SUPPORT_EMAIL = 'admin@cyber-affinity.com';
export const SUPPORT_PHONE = '+19292601089';

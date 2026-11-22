# Encryption design: libsignal

Status: phase 1 passed; phase 2 core passed on iOS, 2026-11-19. Remaining in phase 2: real chat screens on top of it. `ENCRYPTION_LIVE` in `src/data/security.ts` stays `false` until this is built, independently audited and pentested.

## Decision

The app uses **libsignal**, Signal's own library, through the official Swift (iOS) and Kotlin (Android) bindings. We **never write our own cryptography** and never change libsignal's.

Facts this design relies on (libsignal v0.108.1, pinned; 0.108.2 published no iOS build):
- **Post-quantum protection is built in.** PQXDH key agreement is mandatory, and the SPQR "triple ratchet" (ML-KEM 768) is integrated.
- **Groups:** Sender Keys are exposed in both bindings.
- **Sealed sender** (the server can't see who sent a message) is exposed in both bindings.
- **No official React Native binding exists.** The community wrappers are tiny, unaudited and single-maintainer. We use none of them.

## Architecture

```
iPhone / Android app (Expo)
  └─ our native module "lifestyle-crypto" (Expo Modules API)
       ├─ iOS: LibSignalClient (Swift Package + prebuilt XCFramework)
       └─ Android: org.signal:libsignal-android (Signal's Maven repo)
  └─ key stores: SQLCipher database; its key is held in the Secure Enclave / Android Keystore
         ⇅ TLS (certificate pinned)
Relay server (ours, small) — only ever sees ciphertext
  ├─ accounts and device lists
  ├─ public identity keys and prekey bundles (EC + Kyber, one-time keys consumed atomically)
  ├─ a ciphertext queue per device (deleted once delivered)
  ├─ group membership lists
  ├─ sender-certificate service (for sealed sender)
  └─ push wakeups with no content (APNs / FCM)
```

The JavaScript side never sees private keys. The native module exposes only high-level calls: `encrypt(to, bytes)`, `decrypt(envelope)`, `groupEncrypt` and `groupDecrypt`, `fingerprint(user)`, `linkDevice` and `rotatePrekeys`.

## What maps to what

| App feature | Mechanism |
|---|---|
| 1:1 chat | Signal session (PQXDH + Double Ratchet / SPQR), one session per device |
| Group chat, plans, sign-ups, polls | Sender Keys per group; each plan's audience is its own group |
| Surprise party ("everyone except") | Its own group without the honoree; the server never learns the reason |
| Meal train address | A separate group: the organizer plus people who signed up |
| Photos, files, voice | Encrypted on the phone with a random key (AES-256-GCM, via libsignal's attachment helpers); the key travels inside the encrypted message |
| Linked devices | Each device has its own keys; a new device is added only by scanning a QR code from an existing one; neighbors get a notice |
| Verify a neighbor in person | QR code carrying the libsignal fingerprint |
| Key change | Notice in the chat; the message is held if the contact was verified |
| Disappearing messages | Timer inside the encrypted message; deleted on every device |

## Phases

1. **Spike (first):** prove LibSignalClient builds inside an Expo SDK 58 development build. libsignal moved to Swift Package Manager only (Oct 2026), while Expo modules use CocoaPods, so this is the main technical risk. Two simulators then exchange one PQXDH-encrypted message through a local relay.
2. **1:1 chat** end to end: registration, prekeys, the session store, delivery queue, multiple devices.
3. **Groups** with Sender Keys, so plans and group chats become encrypted.
4. **Media**, linked devices, QR verification, key-change notices.
5. **Sealed sender**, push wakeups and metadata hardening.
6. **Independent cryptography audit plus pentest.** Fix and retest. Only then flip `ENCRYPTION_LIVE` to true.

## Known risks

- **License (decided 2026-11-19: open source):** libsignal is **AGPL-3.0-only**, so the app is AGPL-3.0-only too (`LICENSE`, `package.json`). The source must be published when the app ships. The relay doesn't link libsignal, but it's in the same repo and is published under the same license.
- **Unsupported API:** Signal says outside use is unsupported, and APIs change often. Pin one exact version on both platforms and budget time for upgrades.
- **Our own code is the weak spot:** the stores, device linking and the group logic are ours. That is what the audit must cover.
- **Metadata:** even with sealed sender, the server knows group membership lists. Signal's anonymous-credential groups (zkgroup) are possible later but heavy.

## Phase 1 spike: what exists

- `modules/lifestyle-crypto/`: our Expo module (iOS only for now). `scripts/fetch-libsignal.sh` downloads libsignal 0.108.1's Swift source and Signal's prebuilt `LibSignalFfi.xcframework`, and stops the build if either SHA-256 checksum doesn't match. The podspec compiles Signal's Swift wrapper into our pod and links the xcframework, which avoids the SPM-versus-CocoaPods problem. The downloads are kept out of git (`ios/vendor/`).
- `server/`: the relay (Node, no dependencies), run with `docker compose up -d` in `server/`. It's bound to 127.0.0.1, its container is read-only with every capability dropped, and it logs no requests. It keeps everything in memory, uses plain HTTP and identifies the sender with a token; phases 2 and 5 replace all three.
- `src/app/dev/crypto-test.tsx`: a developer-only screen (`__DEV__`, linked from nowhere) that runs the exchange: register, fetch bundle, PQXDH, encrypt, relay, decrypt, reply, safety number.
- The key stores are libsignal's in-memory store. Phase 2 adds an encrypted, persistent store whose key is held in the Keychain / Secure Enclave.

**Result (2026-11-19, iOS simulators, development build):** two devices each created keys and published them. One fetched the other's bundle, ran PQXDH (both prekey signatures verified) and sent a prekey message through the relay. The other decrypted it and replied over the same Double Ratchet session, and the reply decrypted. Both showed the same safety number. Android is not tested yet (the module is iOS-only; the Kotlin side comes with Android Studio).

## Phase 2 progress (2026-11-19)

Built and tested on two iOS simulators:
- **Keys survive restarts.** `PersistentStore.swift` keeps all Signal state in one AES-256-GCM file. The file key is in the Keychain (this device only, after first unlock, never synced). The file has iOS Data Protection and is excluded from backups. Writes are atomic.
- **Key changes are handled safely.** If a contact's identity key changes, their messages still arrive, but the app won't send to the new key until the change is accepted (`identityChanged` / `acceptIdentityChange`). Accepting starts a fresh session.
- **Relay v2** (`server/relay.mjs`, SQLite on a Docker volume):
  - Accounts are random IDs the relay hands out, with no names.
  - Device secrets are stored as SHA-256 hashes.
  - Each one-time prekey is handed out once.
  - Messages stay queued until acknowledged, then are securely deleted, and expire after 30 days.
  - Every recipient device must get its own copy (409 if one is missing).
  - Per-account rate limits, full account deletion, and no request logging.
  - 14 behavior tests pass.
- **Client** (`src/data/secure/client.ts`): register, send to every device of a contact (bundles fetched only for devices without a session), receive + acknowledge, prekey top-up, delete everything. The message payload is versioned JSON inside the encryption.
- **Test result:** B sent to A over a new PQXDH session. Both apps were killed and relaunched, then A replied over the saved session with no new key exchange and B decrypted it. A's used one-time prekey was deleted (100 → 99), and both safety numbers matched. Afterwards the relay database had no plaintext and no names, and its message queue was empty.

**Real one-on-one chats (2026-11-19):**
- **Connect in person:** your connect code (Me → your code) holds your random account ID, your public identity key (URL-safe base64) and the name you choose. Scanning it pins that key before any session exists, so the relay can't substitute its own key. Any other key shows up as a key change: sending is refused and incoming text is held back until you accept the change.
- **Encrypted history:** contacts and encrypted chats are saved in a native "vault" file, AES-256-GCM with the same device-only Keychain key.
- **Chat screen:** encrypted chats send through the secure client and show Sending… / "Not sent · Tap to try again". The banner reads "End-to-end encrypted · verified in person · test version, not yet audited". The details screen shows the real safety number and lets you accept a key change, with an in-person warning.
- **Text only for now:** photos, files, voice, location, reactions and disappearing timers are turned off in encrypted chats until they're encrypted too.
- **Messages from strangers** land in a chat marked "not one of your connections".
- **Tested on two simulators through the real screens:**
  - Connected both ways and sent both ways.
  - Restarted the app and the history was still there.
  - Neither file on disk contains any of the message text.

Still to do in phase 2:
- TLS and certificate pinning for a hosted relay.
- Push wakeups, so messages arrive when the app is closed.
- Encrypted attachments, reactions and disappearing timers.

## Finding people (2026-11-19)

There are four ways to reach someone. All of them end in the same libsignal session.

| Way | How | Trust |
|---|---|---|
| In person | Scan their QR code | Key pinned, **verified in person** |
| Invite link | The same code as a link (`itsalifestyle://connect?code=…`); the app asks before connecting | Key pinned from the link, not verified |
| Phone number | The relay maps a verified number to an account (decision: the server may hold numbers) | Key from the relay on first contact (like Signal's default) |
| Neighborhood | Joining with the invite code lists every member in New chat | Key from the relay on first contact |

- **Phone numbers:**
  - Stored as HMAC-SHA256 under a server secret (`PHONE_PEPPER`), not as digits.
  - Codes are 6 digits, expire after 10 minutes, and allow 5 tries.
  - Lookups are capped at 50 numbers per request and rate limited.
  - Text messages aren't set up yet: in development, codes print to the relay log (`SMS_MODE=log`), and the relay refuses to start in production without a real provider and a pepper.
- **Neighborhoods on the relay:**
  - Invite codes are 12 random characters (`XXXX-XXXX-XXXX`, about 60 bits).
  - The relay sees only `SHA-256("lifestyle-hood-id:v1:" + code)` and data sealed with `HKDF-SHA256(code)` → AES-256-GCM (the neighborhood's name and each member's name).
  - A member entry only counts if its sealed account ID matches the account that posted it.
  - Joining is rate limited.
- **Names:** every message carries the sender's chosen name inside the encryption.

**Tested on three simulators** (`server/` tests: 28/28):
- A created a neighborhood and B and C joined; members' names were decrypted on each phone.
- C messaged A from the member list over a fresh PQXDH session.
- B verified a phone number, C found B by number and messaged him.
- C opened B's invite link; it asked first, and the key in the link matched the key the relay had served.
- Not yet tested: a link-only first contact with no earlier session (same code path as the QR scan, which was tested).

## Metadata: what the relay can see today

- Who sends to whom, and when; sizes; IP addresses (not logged, but visible).
- Phone numbers (as HMACs) and which accounts are in which neighborhood (but not names).
- **Sealed sender is now on** (see below): for most messages the relay no longer learns who sent them.
- Planned: calls relayed so neighbors never see each other's IPs, and a no-logging policy that will be published and audited.

## Phase 3: groups (2026-11-20)

Plans and group chats in real neighborhoods are now end-to-end encrypted, using Signal's Sender Keys.

- **Groups:** each real neighborhood is a group, and so is each group chat. My Sender Key goes to each member once, inside our 1:1 session. Each group message is then encrypted once, and the same ciphertext is delivered to every member's devices in one relay request.
- **Membership changes:** when someone leaves or is removed, I switch to a fresh key (new distribution ID), so they can't read anything sent afterwards.
- **Restricted audiences never use the shared key.** That covers "pick people", "everyone except" (surprises) and calendars. Those messages are encrypted 1:1 to exactly the people invited, so someone left out never receives them at all. Tested: Ben's own surprise party never reached Ben's phone.
- **What gets shared:** every change to a plan travels as a small "op" (`src/data/planOps.ts`): RSVP, sign-up claim, meal slot, poll vote, reaction, challenge sign-up, team, log entry. Each op carries its end state, so applying it twice changes nothing. Only the host can publish or cancel a plan, or set its teams and meals. Nobody can edit someone else's challenge entries.
- **Names:** plans travel with real names and are switched to "You" on arrival. "Your place" becomes "Alice M.'s place" for everyone else.
- **Catching up:**
  - Joining a neighborhood sends a "hello", and hosts reply with their plans 1:1, filtered to what that person may see. Every phone also does this on start-up.
  - A change to a plan the phone doesn't have triggers the same.
  - If a group message can't be decrypted (a missed key), the phone asks the sender to resend their key and their recent changes.
- **Ordering fix:** a group key is stored the moment it's decrypted, before the next message in the same batch. Without this, the first group message after a new key always failed.
- **Saving:** real neighborhoods' plans and plan chats, groups, and an outbox of unsent changes are saved in the encrypted vault, along with which neighborhood was open.
- **Tested on three iOS simulators:**
  - A potluck reached both neighbors; claims and an RSVP went both ways.
  - Plan chat and group chat messages arrived.
  - A surprise party was hidden from its guest of honor.
  - A missed RSVP healed after a restart.
  - The relay database contained none of the text. Live relay group checks: 6/6.

Not yet:
- **Edits and cancels for posted plans.** The host can't change or cancel one after posting yet.
- **Owner changes and member removal in real neighborhoods.**
- **Neighborhood cover photos.**
- ~~Push wakeups~~ built 2026-11-20.
- ~~Sealed sender~~ built 2026-11-20 (below).

## Sealed sender (2026-11-20)

The relay no longer learns who sent most messages. This is libsignal's sealed sender, as Signal uses it.

- **Certificates:** once a day each phone fetches a sender certificate from the relay (`GET /v1/certificate`, logged in). It names the account, device and identity key, lasts 24 hours, and is signed by the relay's server key, which is itself signed by an offline trust root. The app holds only the trust root's public key; the private key never touches the relay.
- **Sending:** the message and certificate are encrypted together for the recipient, and sent to `PUT /v1/sealed` with **no login**. The relay sees the recipient, the size and the time, but not the sender.
- **Abuse control:** to send sealed you must know the recipient's access key (a random 16 bytes, shared only inside encrypted messages and encrypted neighborhood profiles). The relay stores only a hash of it and refuses senders without it, giving the same answer whether or not the account exists.
- **Receiving:** the phone checks the certificate against the trust root, checks it hasn't expired, and checks the sender's identity key matches the one already pinned for that person. A forged certificate (not signed by our root) is refused; tested.
- **Groups:** Sender Key group messages are sealed too, one multi-recipient envelope per send.

Honest limits:
- The **first** message to someone whose access key the phone doesn't know yet goes unsealed (normal login). After one encrypted exchange, or once their neighborhood profile is read, it's sealed.
- The relay still sees **who receives**, timing, sizes and IP addresses, and it knows neighborhood membership lists. Sealed sender hides the sender of each message, not the whole social graph.
- If a sealed send is refused (for example a stale access key), the phone falls back to a normal send so the message still arrives.

Tested: relay checks 11/11 locally and against Railway; on two simulators, group keys and a 1:1 message travelled sealed and the relay stored them with an empty sender.

## Changing a neighborhood's invite code (2026-11-20)

The invite code is the neighborhood's key, so changing it means moving the neighborhood.

- **The owner's phone** makes a new random code, decrypts the settings and member list with the old code, re-seals them with the new one, and asks the relay to move everything to the new fingerprint (`POST /v1/hoods/:lookup/move`, owner secret required). The old entry is deleted in the same transaction; bans and the owner key carry over.
- **Forwarding:** the relay keeps the new code, sealed with the old one, for the accounts that were members at the time (90 days). Their phones pick it up on the next refresh and switch over by themselves. Anyone else asking with the old code, including removed members, gets "not found". The relay never sees either code.
- **Names stay each member's own:** the owner re-seals members' profiles so nobody drops out, and each member's phone then posts its own profile again under the new code.
- **One group:** the neighborhood's group ID is fixed in its sealed settings at the first change, so people who joined with different codes share the same Sender Key group.
- **On the phone**, a neighborhood stays filed under the code it joined with; relay calls use the current code.

Tested: relay checks 16/16 (removed members and outsiders can't follow the old code; bans carry over; non-owners refused). On three simulators the owner changed the code, an existing member switched automatically, the old code was refused for a new phone, the new code worked, and a beacon reached both the old and the new member.

## Encrypted photos (2026-11-20)

Photos in 1:1 encrypted chats, the same way Signal handles attachments.

- **On the sender's phone:** the photo (compressed to stay under 6 MB) is encrypted with AES-256-GCM under a fresh random 256-bit key. Only the ciphertext is uploaded (`PUT /v1/attachments`), and the relay returns a random 128-bit ID.
- **In the message:** the ID, the key and the SHA-256 of the ciphertext travel inside the normal end-to-end encrypted (and usually sealed) message.
- **On the recipient's phone:** it downloads the ciphertext, checks the SHA-256 before decrypting (so the relay can't swap the file), decrypts it and keeps it in the app's protected storage.
- **The relay** sees a random ID, a size, and which account uploaded it. Files are deleted after 30 days. Downloading needs an account and the random ID.
- **Fixed during testing:** saved photo paths survive app reinstalls and updates (the app's folder moves), and a message still "sending" when the app closed shows as "Not sent".

Tested: relay checks 9/9 (needs an account, rejects non-base64, over-size and path tricks); on two simulators a photo went from Ben to Dana, and the stored file on the relay was ciphertext, not a JPEG.

### Photos in group and plan chats, cover photos, metadata (2026-11-20)

- **Group and plan chats:** same scheme as 1:1. The photo's ID, key and hash go inside the Sender Key group message (to the plan's audience only, for restricted plans).
- **Cover photos:** the owner's phone encrypts the photo once; its key and hash go inside the neighborhood's sealed settings, so only members can open it. The relay keeps cover uploads about a year instead of 30 days, and only the newest 10 per account.
- **Hidden photo data removed:** before encryption the phone re-draws every photo as a fresh JPEG (at most 2048 px), which drops GPS location, camera and time details, as Signal does.
- **Missed messages:** chat messages and photos are now included when a phone re-sends what someone couldn't read after a key mix-up (they're de-duplicated on arrival). Before this, only plan changes were re-sent.
- **The fixed group ID** is kept on every settings change (it was only set when an invite code changed and could have been dropped by a later edit).

Tested: relay checks 3/3 for kept uploads; on two simulators a plan-chat photo went from Dana to Ben, a cover photo from Ben reached Dana's home screen, and a photo with GPS arrived with none (the system picker's own compression also removes it, so the re-draw is a backstop).

### Location and voice messages (2026-11-20)

- **Location:** only when the person taps Share. Rounded on the phone to 2 decimal places (about 1 km) and sent inside the encrypted message. A receiving phone refuses anything more precise.
- **Voice messages:** encrypted exactly like photos (own key, hash checked before decrypting), but sent as recorded (no re-drawing).

Tested on two simulators: a shared location and a 3-second voice message went from Ben to Dana; Dana's copy decrypted to a valid audio file.

## Moving to a new phone (2026-11-20)

- **New phone** makes a random 128-bit transfer ID and 256-bit key and shows them as a QR code. Nothing about it is sent anywhere yet.
- **Old phone** scans it, stops syncing (anything that arrives waits on the relay), and exports its key state, encrypted vault contents and recent attachments (up to 40 MB), encrypted with AES-256-GCM under a key derived from the QR key. It uploads the ciphertext in parts to `PUT /v1/transfer/:id/:part` (logged in; one hour to collect).
- **New phone** downloads the parts (no login: the ID is unguessable), decrypts, re-encrypts everything under its own Keychain key, and calls `POST /v1/transfer/:id/done` with a proof derived from the QR key, which deletes the parts.
- **Old phone** sees the transfer gone and wipes its keys and data locally (the account stays on the relay; it now lives on the new phone).
- Only one device holds the account at a time, so Signal sessions carry on unchanged; neighbors see no key change.
- **Fixed while testing:** the access key and sender certificate were cached in memory and survived an account switch (also after "Delete my account"), so the new account advertised the old key and sealed sends were refused. They're cleared now.
- **Not covered:** a lost or broken phone (no backup exists); two devices used at the same time.

Tested: relay checks 12/12; on simulators, an iPhone's account moved to a fresh iPad with both chats, six photos, a voice message and the neighborhood; the iPhone emptied itself; a new message from Ben reached the iPad, and sealed sending resumed after the cache fix.

## Recovery backup (2026-11-20)

Optional, for a lost or broken phone.

- **Recovery code:** 24 characters from a 32-letter alphabet (120 random bits), shown once. From it the phone derives the backup key, SHA-256("lifestyle-backup-key:v1:" + code), and the lookup, SHA-256("lifestyle-backup-id:v1:" + code). The relay sees only the lookup and ciphertext. A fast hash is enough because the code itself carries 120 bits; there's nothing to brute-force.
- **What's backed up:** the key state, vault (chats, plans, contacts, settings) but no attachments, sealed with AES-256-GCM under the backup key. Refreshed at most once a day while the app is used. Only the derived key (not the code) is kept on the phone, in the encrypted vault.
- **Relay:** `PUT /v1/backup` (logged in; one per account; a new code replaces the old file), `GET /v1/backup/:lookup` (no login, 10 per minute per IP), `DELETE /v1/backup`; deleted with the account or when it's closed.
- **Restoring:** the backup's sessions and one-time prekeys are stale, so the phone drops them, rotates its signed and post-quantum prekeys, replaces all one-time prekeys on the relay, switches its group Sender Keys, and asks every contact and neighborhood member to resend their keys and recent items (which also starts fresh 1:1 sessions). Neighbors see no safety-number change, since the identity key is the same.
- **Honest limits:** anyone with the code can restore the account, so the app tells people to keep it offline. Messages from the gap between the last backup and the restore may be lost. Photos, voice messages and files aren't included and show as "not restored".

Tested: relay checks 9/9; on simulators an account was backed up, the app deleted, and the account restored from the code; chats and the neighborhood came back, neighbors reconnected automatically, and a new message from Ben arrived sealed.

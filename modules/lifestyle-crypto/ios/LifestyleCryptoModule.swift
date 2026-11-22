import CryptoKit
import ExpoModulesCore
import Foundation
import LibSignalClient
import Security
import UIKit

// The app's only door to encryption. Private keys are created, stored and used here, in native
// code, and never cross into JavaScript: JS gets public keys, ciphertext and plaintext only.
// State lives in PersistentStore (AES-256-GCM file, key in the Keychain, this device only).
// Nothing here is audited yet; ENCRYPTION_LIVE in src/data/security.ts stays false until it is.

struct PublicBundle: ExpoModulesCore.Record {
  @Field var registrationId: Int = 0
  @Field var deviceId: Int = 1
  @Field var identityKey: String = ""
  @Field var signedPreKeyId: Int = 0
  @Field var signedPreKey: String = ""
  @Field var signedPreKeySignature: String = ""
  @Field var kyberPreKeyId: Int = 0
  @Field var kyberPreKey: String = ""
  @Field var kyberPreKeySignature: String = ""
  @Field var preKeyId: Int? = nil
  @Field var preKey: String? = nil
}

enum CryptoError: Error, CustomStringConvertible {
  case noAccount, exists, badInput(String), signal(String)
  var description: String {
    switch self {
    case .signal(let what): return "Signal: \(what)"
    case .noAccount: return "NO_ACCOUNT"
    case .exists: return "ACCOUNT_EXISTS"
    case .badInput(let what): return "Invalid \(what)."
    }
  }
}

extension CryptoError: LocalizedError { var errorDescription: String? { description } }

private func b64(_ d: Data) -> String { d.base64EncodedString() }
private func unb64(_ s: String, _ what: String) throws -> Data {
  guard let d = Data(base64Encoded: s) else { throw CryptoError.badInput(what) }
  return d
}
private let ctx = NullContext()
private func nowMs() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }

public class LifestyleCryptoModule: Module {
  private let lock = NSLock()
  private var loaded = false
  private var store: PersistentStore?

  /// Runs `body` with the open store, holding a lock so calls never interleave.
  private func locked<T>(_ needAccount: Bool = true, _ body: (PersistentStore?) throws -> T) throws -> T {
    lock.lock(); defer { lock.unlock() }
    if !loaded { store = try PersistentStore.open(); loaded = true }
    if needAccount && store == nil { throw CryptoError.noAccount }
    do { return try body(store) } catch SignalError.untrustedIdentity(let who) {
      throw StoreError.identityChanged(who)
    } catch let e as SignalError {
      // Keep libsignal's own reason (e.g. "invalidMessage(...)") instead of a bare error number.
      throw CryptoError.signal(String(describing: e).prefix(300).description)
    }
  }

  private func address(_ name: String, _ deviceId: Int) throws -> ProtocolAddress {
    guard !name.isEmpty, (1...127).contains(deviceId) else { throw CryptoError.badInput("address") }
    return try ProtocolAddress(name: name, deviceId: UInt32(deviceId))
  }

  private func me(_ s: PersistentStore) throws -> ProtocolAddress {
    try ProtocolAddress(name: s.state.name, deviceId: s.state.deviceId)
  }

  /// New signed EC prekey + post-quantum (ML-KEM) prekey, both signed by the identity key.
  private func rotateSigned(_ s: PersistentStore) throws {
    let identity = try s.identityKeyPair(context: ctx)
    let sid = s.state.signedPreKeyId &+ 1, kid = s.state.kyberPreKeyId &+ 1
    let ec = PrivateKey.generate()
    let ecSig = identity.privateKey.generateSignature(message: ec.publicKey.serialize())
    let kem = KEMKeyPair.generate()
    let kemSig = identity.privateKey.generateSignature(message: kem.publicKey.serialize())
    let signed = try SignedPreKeyRecord(id: sid, timestamp: nowMs(), privateKey: ec, signature: ecSig)
    let kyber = try KyberPreKeyRecord(id: kid, timestamp: nowMs(), keyPair: kem, signature: kemSig)
    try s.update {
      $0.signedPreKeys[sid] = signed.serialize()
      $0.kyberPreKeys[kid] = kyber.serialize()
      $0.signedPreKeyId = sid
      $0.kyberPreKeyId = kid
      // Keep the previous pair for messages already in flight; drop anything older.
      $0.signedPreKeys = $0.signedPreKeys.filter { $0.key + 1 >= sid }
      $0.kyberPreKeys = $0.kyberPreKeys.filter { $0.key + 1 >= kid }
      $0.kyberBaseKeysSeen = $0.kyberBaseKeysSeen.filter { k, _ in (UInt32(k.split(separator: ".")[0]) ?? 0) + 1 >= kid }
    }
  }

  /// Fresh one-time prekeys. Returns their public halves for the relay.
  private func makePreKeys(_ s: PersistentStore, _ count: Int) throws -> [[String: Any]] {
    var out: [[String: Any]] = []
    var records: [UInt32: Data] = [:]
    var id = s.state.nextPreKeyId
    for _ in 0..<count {
      let pk = PrivateKey.generate()
      records[id] = try PreKeyRecord(id: id, privateKey: pk).serialize()
      out.append(["id": Int(id), "key": b64(pk.publicKey.serialize())])
      id = id >= 0xFFFFFF ? 1 : id + 1
    }
    try s.update { st in
      records.forEach { st.preKeys[$0.key] = $0.value }
      st.nextPreKeyId = id
    }
    return out
  }

  private func accountInfo(_ s: PersistentStore) throws -> [String: Any] {
    ["name": s.state.name, "deviceId": Int(s.state.deviceId), "registrationId": Int(s.state.registrationId),
     "identityKey": b64(try s.identityKeyPair(context: ctx).identityKey.serialize())]
  }

  public func definition() -> ModuleDefinition {
    Name("LifestyleCrypto")

    Constant("libsignalVersion") { "0.108.1" }

    /// A neighborhood invite code: 12 characters from an unambiguous alphabet (~60 bits), as XXXX-XXXX-XXXX.
    Function("randomInviteCode") { () -> String in
      let alphabet = Array("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
      var out = ""
      for i in 0..<12 {
        var b: UInt8 = 0
        repeat { guard SecRandomCopyBytes(kSecRandomDefault, 1, &b) == errSecSuccess else { throw CryptoError.badInput("random source") } } while b >= 248 // 248 = 31 * 8, no modulo bias
        out.append(alphabet[Int(b) % alphabet.count])
        if i == 3 || i == 7 { out.append("-") }
      }
      return out
    }

    /// Plain SHA-256, hex (the relay checks owner secrets against this).
    Function("sha256Hex") { (text: String) -> String in
      SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// What the server sees instead of an invite code: a one-way fingerprint of it.
    Function("secretLookup") { (secret: String) -> String in
      let d = SHA256.hash(data: Data("lifestyle-hood-id:v1:\(secret)".utf8))
      return d.map { String(format: "%02x", $0) }.joined()
    }

    /// Encrypts text with a key derived from a shared secret (the invite code), AES-256-GCM.
    /// Used for the neighborhood member list, so the server stores names it can't read.
    Function("sealWithSecret") { (secret: String, text: String) -> String in
      let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: Data(secret.utf8)),
                                       salt: Data("lifestyle-hood-key".utf8), info: Data("roster v1".utf8), outputByteCount: 32)
      guard let sealed = try AES.GCM.seal(Data(text.utf8), using: key).combined else { throw CryptoError.badInput("seal") }
      return sealed.base64EncodedString()
    }
    Function("openWithSecret") { (secret: String, sealed: String) -> String in
      let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: Data(secret.utf8)),
                                       salt: Data("lifestyle-hood-key".utf8), info: Data("roster v1".utf8), outputByteCount: 32)
      let box = try AES.GCM.SealedBox(combined: unb64(sealed, "sealed data"))
      guard let s = String(data: try AES.GCM.open(box, using: key), encoding: .utf8) else { throw CryptoError.badInput("sealed text") }
      return s
    }

    /// Photos in encrypted chats. Each attachment gets its own random AES-256-GCM key; the relay only
    /// ever stores the ciphertext, and the key travels inside the end-to-end encrypted message.
    /// Returns the ciphertext (base64), its key, the SHA-256 of the ciphertext (checked on arrival),
    /// and a copy of the plaintext kept in this app's protected storage for my own chat.
    /// Where decrypted attachments live now. The app's folder moves when it's reinstalled or updated,
    /// so saved file URIs are re-pointed here.
    Function("attachmentsDir") { () -> String in Self.attachmentsDir().absoluteString }
    /// Erases a decrypted attachment when its message disappears. Only files in the attachments folder.
    Function("deleteAttachment") { (uri: String) in
      guard let u = URL(string: uri), u.isFileURL else { return }
      let dir = Self.attachmentsDir().standardizedFileURL.path + "/", path = u.standardizedFileURL.path
      if path.hasPrefix(dir) { try? FileManager.default.removeItem(atPath: path) }
    }
    /// `kind` "photo" (re-drawn to drop hidden data, stored .jpg), "voice" (as recorded, .m4a) or
    /// "file" (as is, stored with `ext`, the file's own extension).
    AsyncFunction("encryptAttachment") { (uri: String, kind: String?, ext: String?) -> [String: Any] in
      let src = uri.hasPrefix("file://") ? URL(string: uri)! : URL(fileURLWithPath: uri)
      let isVoice = kind == "voice", isFile = kind == "file"
      let raw = try Data(contentsOf: src)
      let plain = isVoice || isFile ? raw : try Self.cleanPhoto(raw)
      guard plain.count <= 6_000_000 else { throw CryptoError.badInput("attachment too large") }
      let key = SymmetricKey(size: .bits256)
      guard let sealed = try AES.GCM.seal(plain, using: key).combined else { throw CryptoError.badInput("attachment") }
      let digest = SHA256.hash(data: sealed).map { String(format: "%02x", $0) }.joined()
      let local = try Self.attachmentURL(String(digest.prefix(32)), isFile ? (ext ?? "bin") : isVoice ? "m4a" : "jpg")
      try plain.write(to: local, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      return ["data": sealed.base64EncodedString(), "key": key.withUnsafeBytes { Data($0) }.base64EncodedString(),
              "digest": digest, "uri": local.absoluteString]
    }
    /// Verifies (digest) and decrypts an attachment, then saves it in protected storage.
    AsyncFunction("decryptAttachment") { (data: String, key: String, digest: String, kind: String?, ext: String?) -> String in
      let sealed = try unb64(data, "attachment")
      let actual = SHA256.hash(data: sealed).map { String(format: "%02x", $0) }.joined()
      guard actual == digest.lowercased() else { throw CryptoError.badInput("attachment digest") }
      let k = try unb64(key, "attachment key")
      guard k.count == 32 else { throw CryptoError.badInput("attachment key") }
      let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: sealed), using: SymmetricKey(data: k))
      let local = try Self.attachmentURL(String(digest.prefix(32)), kind == "file" ? (ext ?? "bin") : kind == "voice" ? "m4a" : "jpg")
      try plain.write(to: local, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      return local.absoluteString
    }

    /// 128 random bits from the system CSPRNG, hex encoded (message IDs and the like).
    Function("randomId") { () -> String in
      var bytes = [UInt8](repeating: 0, count: 16)
      guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
        throw CryptoError.badInput("random source")
      }
      return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// This device's account, or null if it has none yet.
    AsyncFunction("account") { () -> [String: Any]? in
      try self.locked(false) { s in try s.map(self.accountInfo) }
    }

    /// Creates this device's identity and keys. Refuses if an account already exists.
    AsyncFunction("createAccount") { (name: String, deviceId: Int) -> [String: Any] in
      try self.locked(false) { existing in
        if existing != nil { throw CryptoError.exists }
        _ = try self.address(name, deviceId)
        var rid: UInt32 = 0
        while rid == 0 { rid = UInt32.random(in: 1...16380) }
        let identity = IdentityKeyPair.generate()
        let s = try PersistentStore.create(state: StateFile(
          name: name, deviceId: UInt32(deviceId), registrationId: rid, identity: identity.serialize()))
        self.store = s
        try self.rotateSigned(s)
        _ = try self.makePreKeys(s, 100)
        return try self.accountInfo(s)
      }
    }

    /// Everything the relay needs to publish: the signed + post-quantum prekeys and all unused
    /// one-time prekeys. Public halves only.
    AsyncFunction("publicBundle") { () -> [String: Any] in
      try self.locked { s in
        let s = s!
        let identity = try s.identityKeyPair(context: ctx)
        let signed = try s.loadSignedPreKey(id: s.state.signedPreKeyId, context: ctx)
        let kyber = try s.loadKyberPreKey(id: s.state.kyberPreKeyId, context: ctx)
        let pre = try s.state.preKeys.sorted { $0.key < $1.key }.map { id, d in
          ["id": Int(id), "key": b64(try PreKeyRecord(bytes: d).publicKey().serialize())] as [String: Any]
        }
        return [
          "registrationId": Int(s.state.registrationId), "deviceId": Int(s.state.deviceId),
          "identityKey": b64(identity.identityKey.serialize()),
          "signedPreKeyId": Int(signed.id), "signedPreKey": b64(try signed.publicKey().serialize()),
          "signedPreKeySignature": b64(signed.signature),
          "kyberPreKeyId": Int(kyber.id), "kyberPreKey": b64(try kyber.publicKey().serialize()),
          "kyberPreKeySignature": b64(kyber.signature),
          "preKeys": pre,
        ]
      }
    }

    /// Tops up one-time prekeys after the relay runs low. Returns only the new public halves.
    AsyncFunction("generatePreKeys") { (count: Int) -> [[String: Any]] in
      guard (1...200).contains(count) else { throw CryptoError.badInput("count") }
      return try self.locked { s in try self.makePreKeys(s!, count) }
    }

    /// Replaces the signed and post-quantum prekeys (done on a schedule, e.g. weekly).
    AsyncFunction("rotateSignedPreKeys") { () in
      try self.locked { s in try self.rotateSigned(s!) }
    }

    AsyncFunction("hasSession") { (name: String, deviceId: Int) -> Bool in
      try self.locked { s in try s!.loadSession(for: self.address(name, deviceId), context: ctx) != nil }
    }

    /// PQXDH: start a session from a bundle the relay handed out. libsignal checks both prekey
    /// signatures against their identity key, and refuses if that identity changed.
    AsyncFunction("startSession") { (name: String, bundle: PublicBundle) in
      try self.locked { s in
        let s = s!
        let identity = try IdentityKey(bytes: unb64(bundle.identityKey, "identity key"))
        let signedPre = try PublicKey(unb64(bundle.signedPreKey, "signed prekey"))
        let kyber = try KEMPublicKey(unb64(bundle.kyberPreKey, "kyber prekey"))
        let sig = try unb64(bundle.signedPreKeySignature, "signature")
        let ksig = try unb64(bundle.kyberPreKeySignature, "kyber signature")
        let rid = UInt32(bundle.registrationId), did = UInt32(bundle.deviceId)
        let pb: PreKeyBundle
        if let pid = bundle.preKeyId, let pkey = bundle.preKey {
          pb = try PreKeyBundle(
            registrationId: rid, deviceId: did, prekeyId: UInt32(pid), prekey: PublicKey(unb64(pkey, "prekey")),
            signedPrekeyId: UInt32(bundle.signedPreKeyId), signedPrekey: signedPre, signedPrekeySignature: sig,
            identity: identity, kyberPrekeyId: UInt32(bundle.kyberPreKeyId), kyberPrekey: kyber, kyberPrekeySignature: ksig)
        } else {
          pb = try PreKeyBundle(
            registrationId: rid, deviceId: did,
            signedPrekeyId: UInt32(bundle.signedPreKeyId), signedPrekey: signedPre, signedPrekeySignature: sig,
            identity: identity, kyberPrekeyId: UInt32(bundle.kyberPreKeyId), kyberPrekey: kyber, kyberPrekeySignature: ksig)
        }
        try processPreKeyBundle(pb, for: self.address(name, bundle.deviceId), ourAddress: self.me(s),
                                sessionStore: s, identityStore: s, context: ctx)
      }
    }

    AsyncFunction("encrypt") { (name: String, deviceId: Int, plaintext: String) -> [String: Any] in
      try self.locked { s in
        let s = s!
        let msg = try signalEncrypt(message: Data(plaintext.utf8), for: self.address(name, deviceId),
                                    localAddress: self.me(s), sessionStore: s, identityStore: s, context: ctx)
        return ["type": msg.messageType == .preKey ? "prekey" : "message", "body": b64(msg.serialize())]
      }
    }

    AsyncFunction("decrypt") { (name: String, deviceId: Int, type: String, body: String) -> String in
      try self.locked { s in
        let s = s!
        let them = try self.address(name, deviceId)
        let bytes = try unb64(body, "message")
        let plain: Data
        switch type {
        case "prekey":
          plain = try signalDecryptPreKey(
            message: PreKeySignalMessage(bytes: bytes), from: them, localAddress: self.me(s),
            sessionStore: s, identityStore: s, preKeyStore: s, signedPreKeyStore: s, kyberPreKeyStore: s, context: ctx)
        case "message":
          plain = try signalDecrypt(message: SignalMessage(bytes: bytes), from: them, to: self.me(s),
                                    sessionStore: s, identityStore: s, context: ctx)
        default: throw CryptoError.badInput("message type")
        }
        guard let text = String(data: plain, encoding: .utf8) else { throw CryptoError.badInput("message text") }
        return text
      }
    }

    // MARK: Groups (Signal Sender Keys)
    // Each group has a random distribution ID. A member's sender key for it is handed to the
    // other members once (inside their 1:1 Signal sessions); after that, each group message is
    // encrypted once and the same ciphertext goes to everyone. Rotating the ID when someone
    // leaves means they can't read anything sent afterwards.

    /// My sender-key distribution message for a group: send it to each member over 1:1 sessions.
    AsyncFunction("groupKey") { (distributionId: String) -> String in
      try self.locked { s in
        let s = s!
        guard let dist = UUID(uuidString: distributionId) else { throw CryptoError.badInput("group id") }
        let skdm = try SenderKeyDistributionMessage(from: self.me(s), distributionId: dist, store: s, context: ctx)
        return b64(skdm.serialize())
      }
    }

    /// Store a member's sender key (received inside a 1:1 encrypted message).
    AsyncFunction("acceptGroupKey") { (name: String, deviceId: Int, key: String) in
      try self.locked { s in
        let skdm = try SenderKeyDistributionMessage(bytes: unb64(key, "group key"))
        try processSenderKeyDistributionMessage(skdm, from: self.address(name, deviceId), store: s!, context: ctx)
      }
    }

    AsyncFunction("groupEncrypt") { (distributionId: String, plaintext: String) -> String in
      try self.locked { s in
        let s = s!
        guard let dist = UUID(uuidString: distributionId) else { throw CryptoError.badInput("group id") }
        let msg = try groupEncrypt(Data(plaintext.utf8), from: self.me(s), distributionId: dist, store: s, context: ctx)
        return b64(msg.serialize())
      }
    }

    AsyncFunction("groupDecrypt") { (name: String, deviceId: Int, body: String) -> String in
      try self.locked { s in
        let plain = try groupDecrypt(unb64(body, "message"), from: self.address(name, deviceId), store: s!, context: ctx)
        guard let text = String(data: plain, encoding: .utf8) else { throw CryptoError.badInput("message text") }
        return text
      }
    }

    // MARK: Sealed sender
    // The sender's certificate (issued by the relay, certified by a trust root built into the app)
    // goes INSIDE the encryption, so the relay that delivers the message can't see who sent it.

    /// 1:1 message, sealed. `certificate` is my current sender certificate from the relay.
    AsyncFunction("sealedEncrypt") { (name: String, deviceId: Int, plaintext: String, certificate: String) -> String in
      try self.locked { s in
        let s = s!
        let them = try self.address(name, deviceId)
        let cert = try SenderCertificate(unb64(certificate, "certificate"))
        let inner = try signalEncrypt(message: Data(plaintext.utf8), for: them, localAddress: self.me(s),
                                      sessionStore: s, identityStore: s, context: ctx)
        let usmc = try UnidentifiedSenderMessageContent(inner, from: cert, contentHint: .default, groupId: Data())
        return b64(try sealedSenderEncrypt(usmc, for: them, identityStore: s, context: ctx))
      }
    }

    /// Group message: encrypted once with my Sender Key, then sealed separately for each recipient device.
    AsyncFunction("sealedGroupEncrypt") { (distributionId: String, plaintext: String, certificate: String, recipients: [[String]]) -> [String] in
      try self.locked { s in
        let s = s!
        guard let dist = UUID(uuidString: distributionId) else { throw CryptoError.badInput("group id") }
        let cert = try SenderCertificate(unb64(certificate, "certificate"))
        let inner = try groupEncrypt(Data(plaintext.utf8), from: self.me(s), distributionId: dist, store: s, context: ctx)
        let gid = withUnsafeBytes(of: dist.uuid) { Data($0) }
        let usmc = try UnidentifiedSenderMessageContent(inner, from: cert, contentHint: .default, groupId: gid)
        return try recipients.map { r in
          guard r.count == 2, let d = Int(r[1]) else { throw CryptoError.badInput("recipient") }
          return b64(try sealedSenderEncrypt(usmc, for: self.address(r[0], d), identityStore: s, context: ctx))
        }
      }
    }

    /// Opens a sealed message. Checks the certificate against the trust root and its expiry, decrypts,
    /// then checks the certificate's identity key is the sender's real one. Returns who sent it.
    AsyncFunction("sealedDecrypt") { (body: String, trustRoot: String) -> [String: Any] in
      try self.locked { s in
        let s = s!
        let usmc = try UnidentifiedSenderMessageContent(message: unb64(body, "message"), identityStore: s, context: ctx)
        let cert = usmc.senderCertificate
        let root = try PublicKey(unb64(trustRoot, "trust root"))
        guard cert.validate(trustRoot: root, time: nowMs()) else { throw CryptoError.badInput("sender certificate") }
        let sender = try ProtocolAddress(name: cert.senderUuid, deviceId: cert.deviceId)
        if sender.name == s.state.name && sender.deviceId == s.state.deviceId { throw CryptoError.badInput("sender (it's me)") }
        let plain: Data
        let type: String
        switch usmc.messageType {
        case .preKey:
          plain = try signalDecryptPreKey(message: PreKeySignalMessage(bytes: usmc.contents), from: sender, localAddress: self.me(s),
                                          sessionStore: s, identityStore: s, preKeyStore: s, signedPreKeyStore: s, kyberPreKeyStore: s, context: ctx)
          type = "prekey"
        case .whisper:
          plain = try signalDecrypt(message: SignalMessage(bytes: usmc.contents), from: sender, to: self.me(s), sessionStore: s, identityStore: s, context: ctx)
          type = "message"
        case .senderKey:
          plain = try groupDecrypt(usmc.contents, from: sender, store: s, context: ctx)
          type = "group"
        default: throw CryptoError.badInput("message type")
        }
        // The certificate must carry the same identity key this phone knows for that person.
        guard let known = try s.identity(for: sender, context: ctx), known.publicKey == cert.publicKey else {
          throw CryptoError.badInput("sender certificate key")
        }
        guard let text = String(data: plain, encoding: .utf8) else { throw CryptoError.badInput("message text") }
        return ["from": sender.name, "fromDevice": Int(sender.deviceId), "type": type, "plaintext": text]
      }
    }

    /// One-time prekeys still unused on this device (the relay hands each out once).
    AsyncFunction("preKeyCount") { () -> Int in
      try self.locked { s in s!.state.preKeys.count }
    }

    /// The 60-digit safety number both people see. Matches only if no one is in the middle.
    AsyncFunction("safetyNumber") { (name: String, deviceId: Int) -> String in
      try self.locked { s in
        let s = s!
        guard let theirs = try s.identity(for: self.address(name, deviceId), context: ctx) else {
          throw CryptoError.badInput("contact (no session yet)")
        }
        let fp = try NumericFingerprintGenerator(iterations: 5200).create(
          version: 2, localIdentifier: Data(s.state.name.utf8), localKey: s.identityKeyPair(context: ctx).publicKey,
          remoteIdentifier: Data(name.utf8), remoteKey: theirs.publicKey)
        return fp.displayable.formatted
      }
    }

    /// Their identity key as this phone knows it (pinned in person or first seen), base64.
    AsyncFunction("remoteIdentity") { (name: String, deviceId: Int) -> String? in
      try self.locked { s in try s!.identity(for: self.address(name, deviceId), context: ctx).map { b64($0.serialize()) } }
    }

    /// Pins the identity key scanned from a neighbor's code, before any session exists.
    AsyncFunction("pinIdentity") { (name: String, deviceId: Int, identityKey: String) in
      try self.locked { s in
        let key = try unb64(identityKey, "identity key")
        _ = try IdentityKey(bytes: key) // must parse as a real key
        _ = try self.address(name, deviceId)
        try s!.pinIdentity("\(name).\(deviceId)", key)
      }
    }

    /// Encrypted storage for message history and contacts (same device-only key as the keys).
    AsyncFunction("vaultWrite") { (name: String, text: String) in
      try self.locked { _ in try PersistentStore.vaultWrite(name, text) }
    }
    AsyncFunction("vaultRead") { (name: String) -> String? in
      try self.locked { _ in try PersistentStore.vaultRead(name) }
    }

    /// True if this person's key changed and the change hasn't been accepted yet.
    AsyncFunction("identityChanged") { (name: String, deviceId: Int) -> Bool in
      try self.locked { s in s!.state.pendingIdentityChanges["\(name).\(deviceId)"] != nil }
    }

    /// The person confirmed the new key (ideally after re-verifying in person). Starts a fresh session.
    AsyncFunction("acceptIdentityChange") { (name: String, deviceId: Int) in
      try self.locked { s in try s!.acceptIdentityChange("\(name).\(deviceId)") }
    }

    /// Called once, right after the relay registers this device: binds the keys to the random
    /// account ID the relay issued. Refused once set, so an identity can't be renamed later.
    AsyncFunction("finishRegistration") { (accountId: String, deviceId: Int, token: String) in
      try self.locked { s in
        let s = s!
        guard s.state.name == "pending", s.state.sessions.isEmpty else { throw CryptoError.exists }
        _ = try self.address(accountId, deviceId)
        try s.update { $0.name = accountId; $0.deviceId = UInt32(deviceId); $0.relayToken = token }
      }
    }

    /// The relay's secret for this device, kept inside the encrypted store rather than in JS storage.
    AsyncFunction("relayToken") { () -> String? in
      try self.locked { s in s!.state.relayToken }
    }
    AsyncFunction("setRelayToken") { (token: String) in
      try self.locked { s in try s!.update { $0.relayToken = token } }
    }

    /// Erases this device's keys for good. Messages encrypted to them can never be read again.
    /// Moving to a new phone. The new phone shows a QR code with a random transfer key; this phone
    /// encrypts everything (keys, vault, recent attachments up to 40 MB) with that key. The relay only
    /// ever sees the ciphertext.
    AsyncFunction("exportTransfer") { (transferKey: String) -> String in
      try self.locked { s in
        let plain = try PersistentStore.exportBundle(s!, attachmentsDir: Self.attachmentsDir(), maxFiles: 40_000_000)
        guard let sealed = try AES.GCM.seal(plain, using: Self.transferKey(transferKey)).combined else { throw CryptoError.badInput("transfer") }
        return sealed.base64EncodedString()
      }
    }
    /// Recovery backup: like a transfer but without attachments (kept small enough to refresh daily),
    /// encrypted with a key derived from the recovery code.
    AsyncFunction("exportBackup") { (backupKey: String) -> String in
      try self.locked { s in
        let plain = try PersistentStore.exportBundle(s!, attachmentsDir: Self.attachmentsDir(), maxFiles: 0)
        guard let sealed = try AES.GCM.seal(plain, using: Self.transferKey(backupKey)).combined else { throw CryptoError.badInput("backup") }
        return sealed.base64EncodedString()
      }
    }
    /// After restoring a backup: the saved conversation keys are out of date, so they're dropped and the
    /// signed and post-quantum prekeys are replaced. Neighbors' next messages start fresh sessions.
    AsyncFunction("resetAfterRestore") { () in
      try self.locked { s in
        try s!.update { $0.sessions = [:]; $0.preKeys = [:] }
        try self.rotateSigned(s!)
      }
    }

    /// The new phone's side: decrypts with its transfer key and replaces this phone's (empty) account.
    AsyncFunction("importTransfer") { (blob: String, transferKey: String) in
      try self.locked(false) { _ in
        let plain: Data
        do { plain = try AES.GCM.open(AES.GCM.SealedBox(combined: unb64(blob, "transfer")), using: Self.transferKey(transferKey)) }
        catch { throw CryptoError.badInput("transfer (wrong code or damaged)") }
        self.store = try PersistentStore.importBundle(plain, attachmentsDir: Self.attachmentsDir())
        self.loaded = true
      }
    }
    /// Linking a device: seals this account's identity key and `text` with the key from the new device's QR code.
    AsyncFunction("exportLink") { (transferKey: String, text: String) -> String in
      try self.locked { s in
        let body: [String: String] = ["identity": b64(s!.state.identity), "text": text]
        let plain = try JSONSerialization.data(withJSONObject: body)
        guard let sealed = try AES.GCM.seal(plain, using: Self.transferKey(transferKey)).combined else { throw CryptoError.badInput("link") }
        return sealed.base64EncodedString()
      }
    }
    /// The new device's side: opens the hand-off, keeps the identity, makes this device's own keys
    /// (it stays "pending" until the relay assigns its device number) and returns `text`.
    AsyncFunction("importLink") { (blob: String, transferKey: String) -> String in
      try self.locked(false) { existing in
        if existing != nil { throw CryptoError.exists }
        let plain: Data
        do { plain = try AES.GCM.open(AES.GCM.SealedBox(combined: unb64(blob, "link")), using: Self.transferKey(transferKey)) }
        catch { throw CryptoError.badInput("link (wrong code or damaged)") }
        guard let body = try JSONSerialization.jsonObject(with: plain) as? [String: String],
              let idB64 = body["identity"], let text = body["text"] else { throw CryptoError.badInput("link") }
        let identity = try unb64(idB64, "identity")
        _ = try IdentityKeyPair(bytes: identity) // refuse anything that isn't a real key pair
        var rid: UInt32 = 0
        while rid == 0 { rid = UInt32.random(in: 1...16380) }
        let s = try PersistentStore.create(state: StateFile(name: "pending", deviceId: 1, registrationId: rid, identity: identity))
        self.store = s
        self.loaded = true
        try self.rotateSigned(s)
        _ = try self.makePreKeys(s, 100)
        return text
      }
    }

    /// Removes this phone's keys and data without touching the account on the relay (after moving it).
    AsyncFunction("forgetLocally") { () in
      try self.locked(false) { _ in PersistentStore.destroy(); self.store = nil }
      try? FileManager.default.removeItem(at: Self.attachmentsDir())
    }

    AsyncFunction("deleteAccount") { () in
      try self.locked(false) { _ in PersistentStore.destroy(); self.store = nil }
      try? FileManager.default.removeItem(at: Self.attachmentsDir())
    }
  }

  /// Re-draws a photo as a fresh JPEG: this drops its metadata (GPS location, camera, time) the way
  /// Signal does, applies its rotation, and caps it at 2048 px on the long side.
  private static func cleanPhoto(_ data: Data) throws -> Data {
    guard let img = UIImage(data: data), img.size.width > 0, img.size.height > 0 else { throw CryptoError.badInput("photo") }
    let scale = min(1, 2048 / max(img.size.width * img.scale, img.size.height * img.scale))
    let size = CGSize(width: (img.size.width * img.scale * scale).rounded(), height: (img.size.height * img.scale * scale).rounded())
    let format = UIGraphicsImageRendererFormat.default(); format.scale = 1; format.opaque = true
    let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    guard let jpeg = drawn.jpegData(compressionQuality: 0.82) else { throw CryptoError.badInput("photo") }
    return jpeg
  }

  private static func transferKey(_ k: String) throws -> SymmetricKey {
    guard k.count >= 32 else { throw CryptoError.badInput("transfer key") }
    return SymmetricKey(data: SHA256.hash(data: Data(("lifestyle-transfer-v1:" + k).utf8)))
  }

  private static func attachmentsDir() -> URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LifestyleAttachments", isDirectory: true)
  }
  private static func attachmentURL(_ name: String, _ ext: String = "jpg") throws -> URL {
    let dir = attachmentsDir()
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    // Only short letters-and-digits extensions, so a received name can't reach outside this folder.
    let safe = ext.lowercased().filter { $0.isLetter || $0.isNumber }.prefix(8)
    return dir.appendingPathComponent(name.filter { $0.isHexDigit } + "." + (safe.isEmpty ? "bin" : String(safe)))
  }
}

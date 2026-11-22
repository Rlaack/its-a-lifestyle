import CryptoKit
import Foundation
import LibSignalClient
import Security

// The device's Signal Protocol state (identity, prekeys, sessions, other people's identity keys,
// group sender keys), kept in ONE file encrypted with AES-256-GCM.
//
// - The file key is a random 256-bit key in the Keychain, marked "this device only" and readable
//   only after the phone is first unlocked: it never syncs to iCloud and never lands in a backup.
// - The file itself also has iOS Data Protection and is excluded from backups.
// - Every change is written atomically (whole file to a temp file, then renamed), so a crash can't
//   leave half-written key material.

enum StoreError: Error, CustomStringConvertible {
  case keychain(OSStatus), corrupt, identityChanged(String)
  var description: String {
    switch self {
    case .keychain(let s): return "Keychain error \(s)."
    case .corrupt: return "The encrypted key store could not be read."
    case .identityChanged(let who): return "IDENTITY_CHANGED:\(who)"
    }
  }
}

/// The 256-bit key that encrypts the state file. Created once; lives only in this phone's Keychain.
enum FileKey {
  private static let service = "com.itsalifestyle.crypto"
  private static let account = "state-file-key-v1"

  static func load(create: Bool) throws -> SymmetricKey? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
    ]
    var out: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    if status == errSecSuccess, let data = out as? Data, data.count == 32 { return SymmetricKey(data: data) }
    if status != errSecItemNotFound { throw StoreError.keychain(status) }
    guard create else { return nil }

    var bytes = [UInt8](repeating: 0, count: 32)
    let rs = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard rs == errSecSuccess else { throw StoreError.keychain(rs) }
    query.removeValue(forKey: kSecReturnData as String)
    query[kSecValueData as String] = Data(bytes)
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    query[kSecAttrSynchronizable as String] = false
    let add = SecItemAdd(query as CFDictionary, nil)
    guard add == errSecSuccess else { throw StoreError.keychain(add) }
    return SymmetricKey(data: bytes)
  }

  static func delete() {
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                            kSecAttrService as String: service, kSecAttrAccount as String: account]
    SecItemDelete(q as CFDictionary)
  }
}

/// Everything on disk. Records are libsignal's own serialized forms.
struct StateFile: Codable {
  var version = 1
  var name: String
  var deviceId: UInt32
  var registrationId: UInt32
  var identity: Data
  var relayToken: String?
  var nextPreKeyId: UInt32 = 1
  var signedPreKeyId: UInt32 = 0
  var kyberPreKeyId: UInt32 = 0
  var preKeys: [UInt32: Data] = [:]
  var signedPreKeys: [UInt32: Data] = [:]
  var kyberPreKeys: [UInt32: Data] = [:]
  /// "kyberId.signedId" → base keys already used with that last-resort Kyber key (replay protection).
  var kyberBaseKeysSeen: [String: [Data]] = [:]
  /// "name.device" → session record
  var sessions: [String: Data] = [:]
  /// "name.device" → their identity key, first seen or accepted
  var identities: [String: Data] = [:]
  /// "name.device" → their identity key changed and the change has not been accepted yet
  var pendingIdentityChanges: [String: Data] = [:]
  /// "name.device.distributionId" → sender key record (groups, phase 3)
  var senderKeys: [String: Data] = [:]
}

private func addr(_ a: ProtocolAddress) -> String { "\(a.name).\(a.deviceId)" }

final class PersistentStore: IdentityKeyStore, PreKeyStore, SignedPreKeyStore, KyberPreKeyStore, SessionStore, SenderKeyStore {
  private(set) var state: StateFile
  private let key: SymmetricKey
  private let identityPair: IdentityKeyPair
  let url: URL

  static var defaultURL: URL {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("crypto", isDirectory: true)
    return dir.appendingPathComponent("state.bin")
  }

  /// Opens the existing store, or returns nil if this device has no account yet.
  static func open(url: URL = defaultURL) throws -> PersistentStore? {
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    guard let key = try FileKey.load(create: false) else { throw StoreError.corrupt }
    let sealed = try Data(contentsOf: url)
    let plain: Data
    do { plain = try AES.GCM.open(AES.GCM.SealedBox(combined: sealed), using: key) } catch { throw StoreError.corrupt }
    let state = try PropertyListDecoder().decode(StateFile.self, from: plain)
    return try PersistentStore(state: state, key: key, url: url)
  }

  /// Creates a brand-new account state and writes it.
  static func create(state: StateFile, url: URL = defaultURL) throws -> PersistentStore {
    FileKey.delete()
    guard let key = try FileKey.load(create: true) else { throw StoreError.corrupt }
    let s = try PersistentStore(state: state, key: key, url: url)
    try s.save()
    return s
  }

  /// Erases this device's keys and message history for good, plus the Keychain key that could decrypt them.
  static func destroy(url: URL = defaultURL) {
    try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    FileKey.delete()
  }

  // MARK: Vault (message history and contacts), encrypted with the same device-only key.

  private static func vaultURL(_ name: String) throws -> URL {
    guard name.range(of: "^[a-z0-9-]{1,40}$", options: .regularExpression) != nil else { throw StoreError.corrupt }
    return defaultURL.deletingLastPathComponent().appendingPathComponent("vault", isDirectory: true)
      .appendingPathComponent("\(name).bin")
  }

  static func vaultWrite(_ name: String, _ text: String) throws {
    guard let key = try FileKey.load(create: false) else { throw StoreError.corrupt }
    let url = try vaultURL(name)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    guard let combined = try AES.GCM.seal(Data(text.utf8), using: key).combined else { throw StoreError.corrupt }
    try combined.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    var u = url; var rv = URLResourceValues(); rv.isExcludedFromBackup = true
    try? u.setResourceValues(rv)
  }

  static func vaultRead(_ name: String) throws -> String? {
    let url = try vaultURL(name)
    guard FileManager.default.fileExists(atPath: url.path), let key = try FileKey.load(create: false) else { return nil }
    let plain = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: url)), using: key)
    return String(data: plain, encoding: .utf8)
  }

  // MARK: Moving to a new phone

  /// Everything this phone holds for the account: the key state, the vault (decrypted, so the new
  /// phone can re-encrypt it with its own device key) and saved attachments up to `maxFiles` bytes.
  static func exportBundle(_ store: PersistentStore, attachmentsDir: URL, maxFiles: Int) throws -> Data {
    let enc = PropertyListEncoder(); enc.outputFormat = .binary
    var vault: [String: String] = [:]
    let vdir = defaultURL.deletingLastPathComponent().appendingPathComponent("vault", isDirectory: true)
    for f in (try? FileManager.default.contentsOfDirectory(atPath: vdir.path)) ?? [] where f.hasSuffix(".bin") {
      let name = String(f.dropLast(4))
      if let text = try vaultRead(name) { vault[name] = text }
    }
    var files: [String: String] = [:], total = 0
    let listed = (try? FileManager.default.contentsOfDirectory(at: attachmentsDir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    // Newest first, so if the cap is reached it's the oldest photos that stay behind.
    let sorted = listed.sorted { a, b in
      ((try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) >
      ((try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
    for url in sorted {
      guard let d = try? Data(contentsOf: url), total + d.count <= maxFiles else { continue }
      files[url.lastPathComponent] = d.base64EncodedString(); total += d.count
    }
    let bundle: [String: Any] = ["v": 1, "state": try enc.encode(store.state).base64EncodedString(), "vault": vault, "files": files]
    return try JSONSerialization.data(withJSONObject: bundle)
  }

  /// Replaces whatever is on this phone with an exported bundle, re-encrypted with a fresh device key.
  static func importBundle(_ data: Data, attachmentsDir: URL) throws -> PersistentStore {
    guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any], obj["v"] as? Int == 1,
          let stateB64 = obj["state"] as? String, let stateData = Data(base64Encoded: stateB64) else { throw StoreError.corrupt }
    let state = try PropertyListDecoder().decode(StateFile.self, from: stateData)
    guard state.name != "pending", state.relayToken != nil else { throw StoreError.corrupt }
    destroy()
    try? FileManager.default.removeItem(at: attachmentsDir)
    let store = try create(state: state)
    for (name, text) in (obj["vault"] as? [String: String]) ?? [:] { try? vaultWrite(name, text) }
    try FileManager.default.createDirectory(at: attachmentsDir, withIntermediateDirectories: true,
                                            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    for (name, b64) in (obj["files"] as? [String: String]) ?? [:] {
      // Only plain file names (hex plus an extension) land in the attachments folder.
      guard name.range(of: "^[0-9a-f]{1,64}\\.[a-z0-9]{1,8}$", options: .regularExpression) != nil, let d = Data(base64Encoded: b64) else { continue }
      try? d.write(to: attachmentsDir.appendingPathComponent(name), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    return store
  }

  private init(state: StateFile, key: SymmetricKey, url: URL) throws {
    self.state = state
    self.key = key
    self.url = url
    self.identityPair = try IdentityKeyPair(bytes: state.identity)
  }

  func update(_ change: (inout StateFile) throws -> Void) throws {
    var next = state
    try change(&next)
    let old = state
    state = next
    do { try save() } catch { state = old; throw error }
  }

  func save() throws {
    let dir = url.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    let enc = PropertyListEncoder(); enc.outputFormat = .binary
    let sealed = try AES.GCM.seal(try enc.encode(state), using: key)
    guard let combined = sealed.combined else { throw StoreError.corrupt }
    try combined.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    var u = url; var rv = URLResourceValues(); rv.isExcludedFromBackup = true
    try? u.setResourceValues(rv)
  }

  // MARK: IdentityKeyStore

  func identityKeyPair(context: StoreContext) throws -> IdentityKeyPair { identityPair }
  func localRegistrationId(context: StoreContext) throws -> UInt32 { state.registrationId }

  func saveIdentity(_ identity: IdentityKey, for address: ProtocolAddress, context: StoreContext) throws -> IdentityChange {
    let k = addr(address), new = identity.serialize()
    if let old = state.identities[k], old != new {
      // Their key changed (new phone, reinstall, or someone in the middle). Keep the old one as the
      // trusted key and park the new one until the person accepts the change in the app.
      try update { $0.pendingIdentityChanges[k] = new }
      return .replacedExisting
    }
    if state.identities[k] == nil { try update { $0.identities[k] = new } }
    return .newOrUnchanged
  }

  func isTrustedIdentity(_ identity: IdentityKey, for address: ProtocolAddress, direction: Direction, context: StoreContext) throws -> Bool {
    guard let known = state.identities[addr(address)] else { return true } // first contact
    if known == identity.serialize() { return true }
    // Incoming messages under a new key are allowed to arrive (so the change can be shown), but we
    // never SEND to a changed key until the person accepts it.
    if direction == .receiving { try update { $0.pendingIdentityChanges[addr(address)] = identity.serialize() }; return true }
    return false
  }

  func identity(for address: ProtocolAddress, context: StoreContext) throws -> IdentityKey? {
    try state.identities[addr(address)].map { try IdentityKey(bytes: $0) }
  }

  // MARK: PreKeyStore

  func loadPreKey(id: UInt32, context: StoreContext) throws -> PreKeyRecord {
    guard let d = state.preKeys[id] else { throw SignalError.invalidKeyIdentifier("no prekey \(id)") }
    return try PreKeyRecord(bytes: d)
  }
  func storePreKey(_ record: PreKeyRecord, id: UInt32, context: StoreContext) throws {
    try update { $0.preKeys[id] = record.serialize() }
  }
  func removePreKey(id: UInt32, context: StoreContext) throws {
    try update { $0.preKeys.removeValue(forKey: id) }
  }

  // MARK: SignedPreKeyStore

  func loadSignedPreKey(id: UInt32, context: StoreContext) throws -> SignedPreKeyRecord {
    guard let d = state.signedPreKeys[id] else { throw SignalError.invalidKeyIdentifier("no signed prekey \(id)") }
    return try SignedPreKeyRecord(bytes: d)
  }
  func storeSignedPreKey(_ record: SignedPreKeyRecord, id: UInt32, context: StoreContext) throws {
    try update { $0.signedPreKeys[id] = record.serialize() }
  }

  // MARK: KyberPreKeyStore

  func loadKyberPreKey(id: UInt32, context: StoreContext) throws -> KyberPreKeyRecord {
    guard let d = state.kyberPreKeys[id] else { throw SignalError.invalidKeyIdentifier("no kyber prekey \(id)") }
    return try KyberPreKeyRecord(bytes: d)
  }
  func storeKyberPreKey(_ record: KyberPreKeyRecord, id: UInt32, context: StoreContext) throws {
    try update { $0.kyberPreKeys[id] = record.serialize() }
  }
  func markKyberPreKeyUsed(id: UInt32, signedPreKeyId: UInt32, baseKey: PublicKey, context: StoreContext) throws {
    let k = "\(id).\(signedPreKeyId)", b = baseKey.serialize()
    if state.kyberBaseKeysSeen[k, default: []].contains(b) { throw SignalError.invalidMessage("reused base key") }
    try update { $0.kyberBaseKeysSeen[k, default: []].append(b) }
  }

  // MARK: SessionStore

  func loadSession(for address: ProtocolAddress, context: StoreContext) throws -> SessionRecord? {
    try state.sessions[addr(address)].map { try SessionRecord(bytes: $0) }
  }
  func loadExistingSessions(for addresses: [ProtocolAddress], context: StoreContext) throws -> [SessionRecord] {
    try addresses.map { a in
      guard let d = state.sessions[addr(a)] else { throw SignalError.sessionNotFound("\(a)") }
      return try SessionRecord(bytes: d)
    }
  }
  func storeSession(_ record: SessionRecord, for address: ProtocolAddress, context: StoreContext) throws {
    try update { $0.sessions[addr(address)] = record.serialize() }
  }

  // MARK: SenderKeyStore

  func storeSenderKey(from sender: ProtocolAddress, distributionId: UUID, record: SenderKeyRecord, context: StoreContext) throws {
    try update { $0.senderKeys["\(addr(sender)).\(distributionId.uuidString)"] = record.serialize() }
  }
  func loadSenderKey(from sender: ProtocolAddress, distributionId: UUID, context: StoreContext) throws -> SenderKeyRecord? {
    try state.senderKeys["\(addr(sender)).\(distributionId.uuidString)"].map { try SenderKeyRecord(bytes: $0) }
  }

  // MARK: Identity changes

  /// Pins a key learned in person (QR). Later bundles or messages under any other key are treated
  /// as a key change: sending is refused and incoming text is held back until it's accepted.
  func pinIdentity(_ k: String, _ key: Data) throws {
    if let known = state.identities[k] {
      if known != key { try update { $0.pendingIdentityChanges[k] = key } }
      return
    }
    try update { $0.identities[k] = key }
  }

  func acceptIdentityChange(_ k: String) throws {
    guard let new = state.pendingIdentityChanges[k] else { return }
    try update {
      $0.identities[k] = new
      $0.pendingIdentityChanges.removeValue(forKey: k)
      $0.sessions.removeValue(forKey: k) // start fresh with the new key
    }
  }
}

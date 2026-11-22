#!/bin/bash
# Fetches Signal's libsignal for iOS at one pinned version and checks both downloads against
# pinned SHA-256 checksums. Any mismatch stops the build: we never build with unverified code.
#   - Swift wrapper source: the GitHub tag tarball (checksum pinned here, tag commit noted below)
#   - Rust core: Signal's prebuilt LibSignalFfi.xcframework (checksum published on the GitHub release)
set -euo pipefail

VERSION="0.108.1"
TAG_COMMIT="583e32ff3ee50ed9723e71fca05093ad175273f6"
SRC_SHA256="8812acee12405866bbe9f162c44593557b493b93249a7d2191e71ae93680bf2c"
FFI_SHA256="1a1ebf8b50a9f885ae0d336b1aaa5d0d1b984794ef9280b20df11c3156a896cb"

HERE="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$HERE/ios/vendor"
STAMP="$VENDOR/.version"

if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$VERSION" ]]; then exit 0; fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fetch() { curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o "$2" "$1"; }
check() { echo "$1  $2" | shasum -a 256 -c - >/dev/null || { echo "libsignal: checksum mismatch for $2" >&2; exit 1; }; }

fetch "https://github.com/signalapp/libsignal/archive/refs/tags/v$VERSION.tar.gz" "$TMP/src.tar.gz"
check "$SRC_SHA256" "$TMP/src.tar.gz"
fetch "https://build-artifacts.signal.org/libraries/libsignal-client-ios-build-v$VERSION.xcframework.zip" "$TMP/ffi.zip"
check "$FFI_SHA256" "$TMP/ffi.zip"

rm -rf "$VENDOR"; mkdir -p "$VENDOR"
tar -xzf "$TMP/src.tar.gz" -C "$TMP"
SRC="$TMP/libsignal-$VERSION"
cp -R "$SRC/swift/Sources/LibSignalClient" "$VENDOR/LibSignalClient"
mkdir -p "$VENDOR/SignalFfi"
cp "$SRC/swift/Sources/SignalFfi/signal_ffi.h" "$SRC/swift/Sources/SignalFfi/signal_ffi_testing.h" "$VENDOR/SignalFfi/"
# Same module as Signal's, minus the `link` line: the xcframework below is linked by CocoaPods.
printf 'module SignalFfi {\n  header "signal_ffi.h"\n  header "signal_ffi_testing.h"\n  export *\n}\n' > "$VENDOR/SignalFfi/module.modulemap"
cp "$SRC/LICENSE" "$VENDOR/LICENSE-libsignal"
cp "$SRC/acknowledgments/acknowledgments-ios.plist" "$VENDOR/" 2>/dev/null || true
(cd "$VENDOR" && unzip -q "$TMP/ffi.zip")
echo "$VERSION" > "$STAMP"
echo "libsignal $VERSION ($TAG_COMMIT) verified and vendored."

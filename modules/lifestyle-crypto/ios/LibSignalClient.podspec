# Signal's libsignal Swift wrapper (AGPL-3.0-only), compiled unchanged under its own module name,
# linked against Signal's prebuilt Rust core. Both are pinned and SHA-256 verified by
# scripts/fetch-libsignal.sh, which runs here before CocoaPods reads any of the files.
fetch = File.join(__dir__, '..', 'scripts', 'fetch-libsignal.sh')
system(fetch) or raise 'lifestyle-crypto: could not fetch and verify libsignal'

Pod::Spec.new do |s|
  s.name           = 'LibSignalClient'
  s.version        = '0.108.1'
  s.summary        = 'Signal Protocol (libsignal) Swift wrapper and prebuilt core.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'Signal Messenger LLC'
  s.homepage       = 'https://github.com/signalapp/libsignal'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/signalapp/libsignal.git', tag: "v#{s.version}" }
  s.static_framework = true
  s.swift_version  = '5'

  s.source_files = 'vendor/LibSignalClient/**/*.swift'
  s.preserve_paths = ['vendor/SignalFfi', 'vendor/LICENSE-libsignal', 'vendor/acknowledgments-ios.plist']
  s.vendored_frameworks = 'vendor/LibSignalFfi.xcframework'
  s.libraries = ['z', 'c++']

  ffi = '$(PODS_TARGET_SRCROOT)/vendor/SignalFfi'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => ffi,
    'SWIFT_INCLUDE_PATHS' => ffi,
    'OTHER_SWIFT_FLAGS' => '$(inherited) -enable-experimental-feature StrictConcurrency',
  }
  # Anything importing LibSignalClient also needs to see the SignalFfi C module.
  s.user_target_xcconfig = { 'SWIFT_INCLUDE_PATHS' => '$(inherited) "${PODS_ROOT}/../../modules/lifestyle-crypto/ios/vendor/SignalFfi"' }
end

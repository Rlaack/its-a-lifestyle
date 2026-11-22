# The app's encryption module: a thin Expo bridge over LibSignalClient (see LibSignalClient.podspec).
Pod::Spec.new do |s|
  s.name           = 'LifestyleCrypto'
  s.version        = '0.1.0'
  s.summary        = 'End-to-end encryption for the app, built on libsignal.'
  s.license        = 'AGPL-3.0-only'
  s.author         = 'It’s a Lifestyle'
  s.homepage       = 'https://github.com/signalapp/libsignal'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5'

  s.dependency 'ExpoModulesCore'
  s.dependency 'LibSignalClient'

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_INCLUDE_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/vendor/SignalFfi"',
  }
end

# macOS media declarations (not runtime acceptance)

`src-tauri/tauri.macos.conf.json` is the macOS-only Tauri overlay. The normal
browser build driver also loads this platform overlay before generating the
development app plist or final bundle configuration. It selects:

- `Info.plist`: camera/microphone purpose strings, merged into the application
  plist. `scripts/native/browser-app-plist.py` also uses this file for development
  bundles; it preserves the app identity rather than substituting a helper plist.
- `Entitlements.plist`: only `com.apple.security.device.camera` and
  `com.apple.security.device.audio-input`. Hardened runtime remains enabled.

The common `helperPlist` template in `scripts/browser-runtime-package.mjs` adds
matching purpose strings to all five helpers in both official and custom CEF
staging. These strings are descriptions, not permissions or code entitlements.
An explicit custom plist/signing configuration remains the caller's responsibility.
These declarations do not auto-grant website access, bypass macOS privacy consent,
enable screen capture, turn off CEF's sandbox, or add runtime-security exceptions.
See Apple's [hardened runtime resource-access requirements](https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime).

## Remaining signing and runtime gate

Helper signing is not established by this change. The current browser driver
copies helpers using `bundle.macOS.files`. In the installed Tauri CLI version
2.11.4, [`copy_custom_files_to_bundle`](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/macos/app.rs)
does not add them to `sign_paths`; automatic framework traversal is separate.
The app's configured entitlements must not be assumed to apply to these helpers.
Coordinate inside-out helper signing with the driver owner before notarization,
including the capture-process camera/audio entitlements and reviewed CEF
per-role requirements. Do not fix this by blanket `--deep` signing or disabling
the sandbox, library validation, or hardened runtime.

On real Intel and Apple Silicon Macs, inspect the final code signatures of the
app and relevant helpers (`codesign -d --entitlements :- <bundle>`), verify the
bundle (`codesign --verify --deep --strict <app>`), and test camera-only,
microphone-only, combined, denied, cancelled, expired, navigation, and owner-lock
requests. macOS privacy consent remains required in addition to native website
approval. Signed helper launch, notarization, actual TCC prompts and capture have
not been tested on this Windows host. Token deadline/owner checks do not by
themselves prove prompt dismissal or CEF callback revocation.

## Focused declaration checks

```powershell
node --test tests/tooling/browserMacosMedia.node-test.mjs tests/tooling/browserRuntimePackage.node-test.mjs tests/tooling/browserCustomRuntime.node-test.mjs
```

These checks parse real plists, execute the development plist generator and
exercise synthetic custom-runtime staging on both macOS architectures. Synthetic
fixtures never execute CEF or certify signing, OS consent, or device access.

Windows validation on 2026-10-07: 77 passed, 3 skipped (two unavailable symlink
privilege checks and one Unix executable-mode check). Full output:
`.cache/browser-macos-media-packaging-20261007.log`. Scoped Prettier and
`git diff --check` passed. No Cargo or macOS compilation was run in this lane.

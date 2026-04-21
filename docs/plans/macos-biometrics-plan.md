# macOS Biometrics (Touch ID) — Implementation Plan

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Architecture Overview](#3-architecture-overview)
4. [Phase 1: Native LocalAuthentication Framework](#4-phase-1-native-localauthentication-framework)
5. [Phase 2: Secure Enclave Key Storage](#5-phase-2-secure-enclave-key-storage)
6. [Phase 3: Keychain Integration with Biometric ACL](#6-phase-3-keychain-integration-with-biometric-acl)
7. [Phase 4: Frontend Platform Adaptation](#7-phase-4-frontend-platform-adaptation)
8. [Phase 5: Apple Watch Unlock Support](#8-phase-5-apple-watch-unlock-support)
9. [Phase 6: Testing Strategy](#9-phase-6-testing-strategy)
10. [Phase 7: Unify sorng-biometrics and sorng-auth/passkey](#10-phase-7-unify-sorng-biometrics-and-sorng-authpasskey)
11. [Cargo Dependencies](#11-cargo-dependencies)
12. [Entitlements & Code Signing](#12-entitlements--code-signing)
13. [Security Considerations](#13-security-considerations)
14. [Migration Path](#14-migration-path)
15. [File-by-File Change Map](#15-file-by-file-change-map)
16. [Rollout & Milestones](#16-rollout--milestones)

---

## 1. Executive Summary

We have a working Windows Hello implementation using WinRT `UserConsentVerifier`.
The current macOS implementation is **incomplete** — it shells out to `bioutil`/`security`
CLI tools, which doesn't reliably trigger Touch ID and bypasses the Secure Enclave entirely.

This plan upgrades macOS biometrics to use **native Apple frameworks** via Objective-C FFI:

| Capability | Current (macOS) | Target (macOS) |
|---|---|---|
| Touch ID prompt | `security find-generic-password` (unreliable) | `LAContext.evaluatePolicy()` (native) |
| Hardware detection | `bioutil -c` / `system_profiler` shell commands | `LAContext.canEvaluatePolicy()` (instant) |
| Key storage | SHA256(machine_id) — no hardware binding | Secure Enclave `kSecAttrTokenIDSecureEnclave` |
| Biometric-gated secrets | Keychain without proper ACL | Keychain + `SecAccessControl` with `.biometryCurrentSet` |
| Apple Watch unlock | Not supported | `LAPolicy.deviceOwnerAuthenticationWithBiometricsOrWatch` |
| Machine ID | `ioreg` shell command | `IOPlatformUUID` via IOKit FFI (already fine, minor cleanup) |

**Minimum macOS version**: 10.13.2+ (Touch ID on MacBook Pro with Touch Bar);
realistically targets **macOS 12+** (Monterey) for modern LAPolicy options.

---

## 2. Current State Analysis

### 2.1 What Works (Windows)

`src-tauri/crates/sorng-biometrics/src/platform/windows.rs`:
- Uses `Windows.Security.Credentials.UI.UserConsentVerifier` (proper WinRT API)
- `CheckAvailabilityAsync()` for hardware/enrollment detection
- `RequestVerificationAsync()` for biometric prompt
- WBF registry queries for sensor-kind detection (fingerprint/face/iris)
- Clean error mapping to `BiometricError` variants

### 2.2 What's Broken (macOS)

`src-tauri/crates/sorng-biometrics/src/platform/macos.rs`:

**Problem 1: Shell-command-based availability check**
```rust
// Current — unreliable, slow, spawns 3 processes
let bioutil_ok = Command::new("bioutil").arg("-c").output()...;
let has_secure_enclave = Command::new("system_profiler").args(["SPiBridgeDataType"]).output()...;
let is_apple_silicon = Command::new("sysctl").args(["-n", "machdep.cpu.brand_string"]).output()...;
```
- `bioutil -c` may not exist on all macOS versions
- `system_profiler` is slow (~1s)
- Does NOT check if Touch ID is actually enrolled (only guesses)

**Problem 2: Canary-item trick doesn't trigger Touch ID**
```rust
// Current — "security find-generic-password" does NOT trigger Touch ID
// It only triggers the Keychain password dialog, not the biometric prompt
let output = Command::new("security")
    .args(["find-generic-password", "-s", service_name, "-a", account_name, "-w"])
    .output()?;
```
The `security` CLI tool does NOT prompt for Touch ID — it shows a password dialog.
Touch ID is only triggered when a Keychain item has a `SecAccessControl` with
biometric policy, AND is accessed via the Security framework C API (not CLI).

**Problem 3: No Secure Enclave usage**
The key derivation is `SHA256(machine_id + reason + salt)` — purely software.
A compromised machine can reconstruct this key without any biometric.

**Problem 4: `security-framework` dependency unused**
```toml
# In Cargo.toml but never imported in macos.rs
[target.'cfg(target_os = "macos")'.dependencies]
security-framework = "2.11"
```

### 2.3 Duplicate Code in sorng-auth/passkey.rs

`src-tauri/crates/sorng-auth/src/passkey.rs` has its own `authenticate_macos()` with
the same shell-command approach. This duplicates `sorng-biometrics` and should be
consolidated (Phase 7).

---

## 3. Architecture Overview

### 3.1 Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React/TypeScript)                                │
│  PasswordDialog.tsx → usePasswordDialog.ts → invoke()       │
│  Platform-aware text: "Touch ID" / "Windows Hello"          │
└──────────────────────┬──────────────────────────────────────┘
                       │ Tauri IPC
┌──────────────────────▼──────────────────────────────────────┐
│  sorng-biometrics/commands.rs  (Tauri commands)             │
│  biometric_check_availability                               │
│  biometric_verify                                           │
│  biometric_verify_and_derive_key                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  sorng-biometrics/authenticate.rs + availability.rs         │
│  Platform dispatch via cfg(target_os)                       │
└───────┬──────────────┬────────────────┬─────────────────────┘
        │              │                │
   ┌────▼────┐   ┌────▼─────┐   ┌─────▼──────┐
   │ Windows  │   │  macOS   │   │   Linux    │
   │ Hello    │   │ Touch ID │   │  fprintd   │
   │ WinRT    │   │ LAContext│   │  polkit    │
   │          │   │ Keychain │   │            │
   │          │   │ SecureEnc│   │            │
   └──────────┘   └──────────┘   └────────────┘
```

### 3.2 macOS Objective-C Bridge Strategy

We'll use the `objc2` family of crates for type-safe Objective-C FFI:

```
objc2                          — Core ObjC runtime bindings
objc2-foundation               — NSString, NSError, etc.
objc2-local-authentication     — LAContext, LAPolicy (Touch ID)
security-framework             — SecKeychain, SecAccessControl (already dep'd)
core-foundation                — CFString, CFData helpers
```

**Why `objc2` over raw `objc` crate?**
- Type-safe: compile-time checked message sends
- Well-maintained (part of the official `objc2` ecosystem)
- Direct struct wrappers for Apple frameworks
- No unsafe `msg_send!` boilerplate

**Fallback plan**: If `objc2-local-authentication` doesn't cover all needed APIs,
we can use `block2` + raw `objc2::msg_send!` to fill gaps — the underlying ObjC
runtime is fully accessible.

---

## 4. Phase 1: Native LocalAuthentication Framework

> **Goal**: Replace shell commands with direct `LAContext` calls for availability
> checking and biometric prompting.

### 4.1 Overview

The `LocalAuthentication` framework is Apple's official API for biometrics:

```objc
// What we're calling from Rust via objc2:
LAContext *context = [[LAContext alloc] init];
NSError *error = nil;
BOOL canEvaluate = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                                        error:&error];
// If canEvaluate == YES → Touch ID hardware exists and fingerprints enrolled
```

### 4.2 Files to Create/Modify

#### New: `src-tauri/crates/sorng-biometrics/src/platform/macos/mod.rs`

Split `macos.rs` into a sub-module directory for organization:

```
platform/macos/
├── mod.rs              — Public API: check_availability(), prompt()
├── la_context.rs       — LAContext wrapper (FFI bridge)
├── keychain.rs         — Biometric-gated Keychain operations
├── secure_enclave.rs   — SE key generation & signing
└── helpers.rs          — Machine ID, enrollment detection
```

#### `la_context.rs` — LAContext FFI Bridge

```rust
//! Safe Rust wrapper around macOS LocalAuthentication framework.

use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LAContext, LAPolicy, LABiometryType};
use crate::types::*;
use std::sync::mpsc;

/// Biometric evaluation policies
pub(crate) enum Policy {
    /// Touch ID only (no password fallback)
    BiometricOnly,
    /// Touch ID with password fallback
    BiometricOrPassword,
    /// Touch ID or Apple Watch
    BiometricOrWatch,
}

impl Policy {
    fn to_la_policy(&self) -> LAPolicy {
        match self {
            Policy::BiometricOnly =>
                LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            Policy::BiometricOrPassword =>
                LAPolicy::DeviceOwnerAuthentication,
            Policy::BiometricOrWatch =>
                LAPolicy::DeviceOwnerAuthenticationWithBiometricsOrWatch,
        }
    }
}

/// Check if biometric authentication is available.
///
/// This is synchronous and fast — it queries the Secure Enclave directly,
/// no shell commands involved.
pub(crate) fn can_evaluate(policy: Policy) -> Result<BiometryInfo, BiometricError> {
    let context = unsafe { LAContext::new() };
    let mut error: Option<Retained<NSError>> = None;
    let can = unsafe {
        context.canEvaluatePolicy_error(policy.to_la_policy(), Some(&mut error))
    };

    if can {
        let biometry_type = unsafe { context.biometryType() };
        Ok(BiometryInfo {
            available: true,
            biometry_type: map_biometry_type(biometry_type),
            enrolled: true,
        })
    } else {
        let (kind, message) = map_la_error(&error);
        Ok(BiometryInfo {
            available: kind != BiometricErrorKind::HardwareUnavailable,
            biometry_type: BiometryType::None,
            enrolled: kind != BiometricErrorKind::NotEnrolled,
        })
    }
}

/// Prompt the user for biometric authentication.
///
/// This pops the native Touch ID dialog with the given reason string.
/// Blocks the current thread until the user responds.
pub(crate) fn evaluate(reason: &str, policy: Policy) -> BiometricResult<bool> {
    let context = unsafe { LAContext::new() };
    let ns_reason = NSString::from_str(reason);

    // LAContext.evaluatePolicy is async (completion handler).
    // We bridge to sync using a channel.
    let (tx, rx) = mpsc::channel();

    let block = block2::ConcreteBlock::new(move |success: Bool, error: *mut NSError| {
        let result = if success.as_bool() {
            Ok(true)
        } else if error.is_null() {
            Err(BiometricError::auth_failed())
        } else {
            let err = unsafe { &*error };
            let code = unsafe { err.code() };
            match code {
                -2 => Err(BiometricError::user_cancelled()),  // errSecUserCanceled
                -1 => Err(BiometricError::auth_failed()),     // errSecAuthFailed
                -5 => Err(BiometricError::platform("App cancelled")),
                -6 => Err(BiometricError::platform("System cancelled")),
                -7 => Err(BiometricError::platform("Not interactive")),
                -8 => Err(BiometricError {
                    kind: BiometricErrorKind::HardwareUnavailable,
                    message: "Biometry not available".into(),
                    detail: None,
                }),
                -11 => Err(BiometricError {
                    kind: BiometricErrorKind::NotEnrolled,
                    message: "No biometrics enrolled".into(),
                    detail: None,
                }),
                _ => Err(BiometricError::platform(
                    format!("LAError code {code}")
                )),
            }
        };
        let _ = tx.send(result);
    });
    let block = block.copy();

    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            policy.to_la_policy(),
            &ns_reason,
            &block,
        );
    }

    rx.recv().map_err(|_| BiometricError::internal("Channel closed"))?
}

/// Map LABiometryType to our type
fn map_biometry_type(t: LABiometryType) -> BiometryType {
    match t {
        LABiometryType::TouchID => BiometryType::TouchID,
        LABiometryType::FaceID => BiometryType::FaceID,   // future Mac with Face ID
        LABiometryType::OpticID => BiometryType::OpticID,  // Vision Pro
        _ => BiometryType::None,
    }
}
```

### 4.3 Updated `check_availability()` (mod.rs)

```rust
pub(crate) async fn check_availability() -> BiometricResult<BiometricStatus> {
    tokio::task::spawn_blocking(|| {
        let info = la_context::can_evaluate(la_context::Policy::BiometricOnly)?;

        let kinds = match info.biometry_type {
            BiometryType::TouchID => vec![BiometricKind::Fingerprint],
            BiometryType::FaceID  => vec![BiometricKind::FaceRecognition],
            _                     => vec![],
        };

        let label = match info.biometry_type {
            BiometryType::TouchID => "Touch ID",
            BiometryType::FaceID  => "Face ID",
            BiometryType::OpticID => "Optic ID",
            _                     => "macOS Biometrics",
        };

        Ok(BiometricStatus {
            hardware_available: info.available,
            enrolled: info.enrolled,
            kinds,
            platform_label: label.into(),
            unavailable_reason: if !info.available {
                Some("No biometric hardware detected".into())
            } else if !info.enrolled {
                Some("No biometrics enrolled — open System Settings → Touch ID".into())
            } else {
                None
            },
        })
    })
    .await
    .map_err(|e| BiometricError::internal(format!("spawn_blocking: {e}")))?
}
```

### 4.4 Updated `prompt()` (mod.rs)

```rust
pub(crate) async fn prompt(reason: &str) -> BiometricResult<bool> {
    let reason = reason.to_owned();
    tokio::task::spawn_blocking(move || {
        la_context::evaluate(&reason, la_context::Policy::BiometricOrPassword)
    })
    .await
    .map_err(|e| BiometricError::internal(format!("spawn_blocking: {e}")))?
}
```

### 4.5 LAError Code Reference

| Code | Constant | Our Mapping |
|------|----------|-------------|
| 0 | Success | `Ok(true)` |
| -1 | `LAErrorAuthenticationFailed` | `BiometricError::auth_failed()` |
| -2 | `LAErrorUserCancel` | `BiometricError::user_cancelled()` |
| -3 | `LAErrorUserFallback` | User chose "Enter Password" — handle as password flow |
| -4 | `LAErrorSystemCancel` | System cancelled (e.g., another app came to front) |
| -5 | `LAErrorPasscodeNotSet` | No system passcode set |
| -6 | `LAErrorBiometryNotAvailable` [previously TouchIDNotAvailable] | `HardwareUnavailable` |
| -7 | `LAErrorBiometryNotEnrolled` [previously TouchIDNotEnrolled] | `NotEnrolled` |
| -8 | `LAErrorBiometryLockout` [previously TouchIDLockout] | Too many failures, need passcode |
| -9 | `LAErrorAppCancel` | App cancelled the evaluation |
| -10 | `LAErrorInvalidContext` | Context invalidated |
| -11 | `LAErrorNotInteractive` | Not running interactively |
| -1004 | `LAErrorWatchNotAvailable` | Apple Watch not paired/nearby |

---

## 5. Phase 2: Secure Enclave Key Storage

> **Goal**: Replace the `SHA256(machine_id + reason)` key derivation with a Secure
> Enclave-backed asymmetric key that requires biometric authentication to access.

### 5.1 Why Secure Enclave?

Currently, `verify_and_derive_key()` derives a key via:
```rust
SHA256(machine_id + reason + "sorng-biometrics-key-v1")
```
This key can be reconstructed by anyone with access to the machine ID — no biometric
needed. A proper implementation uses the **Secure Enclave** to generate a key that
physically cannot be extracted without biometric verification.

### 5.2 Architecture

```
┌──────────┐   biometric verify   ┌──────────────┐
│ LAContext ├─────────────────────►│ Secure       │
│ Touch ID │                      │ Enclave      │
└──────────┘                      │              │
                                  │ Private Key  │──► Sign(challenge)
                                  │ (never       │
                                  │  leaves SE)  │
                                  └──────┬───────┘
                                         │
                                  ┌──────▼───────┐
                                  │ Keychain     │
                                  │ (stores key  │
                                  │  reference)  │
                                  └──────────────┘
```

### 5.3 Implementation: `secure_enclave.rs`

```rust
//! Secure Enclave key management for biometric-derived key material.
//!
//! Generates an EC P-256 key pair in the Secure Enclave, protected by
//! biometric access control. The private key NEVER leaves the SE.
//! We derive a symmetric key by signing a deterministic challenge and
//! hashing the signature.

use security_framework::access_control::{SecAccessControl, ProtectionMode};
use security_framework::item::{ItemClass, ItemSearchOptions, Reference};
use security_framework::key::{SecKey, KeyType, Algorithm};
use core_foundation::string::CFString;
use core_foundation::data::CFData;
use sha2::{Digest, Sha256};

const SE_KEY_TAG: &str = "com.sortofremoteng.biometric.se-key";
const SE_KEY_SIZE: usize = 256;  // EC P-256

/// Get or create the Secure Enclave key pair.
///
/// The key is tagged with SE_KEY_TAG in the Keychain, so subsequent calls
/// return the same key (deterministic per device).
pub(crate) fn get_or_create_se_key() -> Result<SecKey, BiometricError> {
    // 1. Try to find existing key
    if let Ok(key) = find_se_key() {
        return Ok(key);
    }

    // 2. Create new key with biometric-gated access control
    let access_control = SecAccessControl::create_with_flags(
        ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly,
        SecAccessControlCreateFlags::PRIVATE_KEY_USAGE
            | SecAccessControlCreateFlags::BIOMETRY_CURRENT_SET,
    ).map_err(|e| BiometricError::platform(format!("SecAccessControl: {e}")))?;

    let attributes = KeyAttributes {
        key_type: KeyType::ec(),
        key_size: SE_KEY_SIZE,
        token_id: Some(TokenId::SecureEnclave),
        tag: SE_KEY_TAG.into(),
        access_control: Some(access_control),
        is_permanent: true,
    };

    SecKey::generate(attributes)
        .map_err(|e| BiometricError::platform(format!("SecKey::generate: {e}")))
}

/// Derive a 32-byte symmetric key from the Secure Enclave private key.
///
/// Process:
/// 1. Build a deterministic challenge from `reason`
/// 2. Sign the challenge with the SE private key (requires biometric)
/// 3. SHA-256 hash the signature to produce the symmetric key
///
/// Because the SE key never changes (persistent in Keychain) and the signing
/// is deterministic for EC signatures with RFC 6979, this always produces
/// the same derived key for the same reason on the same device.
pub(crate) fn derive_key_from_se(reason: &str) -> Result<Vec<u8>, BiometricError> {
    let se_key = get_or_create_se_key()?;

    // Build challenge
    let mut hasher = Sha256::new();
    hasher.update(reason.as_bytes());
    hasher.update(b"sorng-se-challenge-v1");
    let challenge = hasher.finalize();

    // Sign with SE key (this triggers Touch ID if access control requires it)
    let signature = se_key.sign(
        Algorithm::ECDSASignatureMessageX962SHA256,
        &challenge,
    ).map_err(|e| BiometricError::platform(format!("SE sign: {e}")))?;

    // Derive symmetric key from signature
    let mut key_hasher = Sha256::new();
    key_hasher.update(&signature);
    key_hasher.update(b"sorng-se-derived-key-v1");
    Ok(key_hasher.finalize().to_vec())
}

/// Find an existing SE key in the Keychain by tag.
fn find_se_key() -> Result<SecKey, BiometricError> {
    ItemSearchOptions::new()
        .class(ItemClass::key())
        .tag(SE_KEY_TAG)
        .return_ref(true)
        .limit(1)
        .search()
        .map_err(|e| BiometricError::platform(format!("Keychain search: {e}")))?
        .into_iter()
        .filter_map(|item| match item {
            Reference::Key(key) => Some(key),
            _ => None,
        })
        .next()
        .ok_or_else(|| BiometricError::platform("SE key not found"))
}

/// Delete the SE key (for key rotation or reset).
pub(crate) fn delete_se_key() -> Result<(), BiometricError> {
    ItemSearchOptions::new()
        .class(ItemClass::key())
        .tag(SE_KEY_TAG)
        .delete()
        .map_err(|e| BiometricError::platform(format!("Delete SE key: {e}")))
}
```

### 5.4 Updated `verify_and_derive_key()` (authenticate.rs)

For macOS, the key derivation path changes:

```rust
#[cfg(target_os = "macos")]
{
    // Phase 2: Use Secure Enclave for key derivation.
    // The SE sign operation itself triggers Touch ID.
    let derived = crate::platform::macos::secure_enclave::derive_key_from_se(reason)?;
    Ok(BiometricAuthResult {
        success: true,
        derived_key_hex: Some(hex::encode(&derived)),
        message: "Touch ID + Secure Enclave verification succeeded".into(),
    })
}
```

### 5.5 Hardware Requirements

| Mac Model | Secure Enclave | Touch ID | Notes |
|-----------|---------------|----------|-------|
| MacBook Pro 2016+ (Touch Bar) | T1 chip | Yes | Original Touch ID Macs |
| MacBook Pro 2018+ | T2 chip | Yes | |
| MacBook Air 2018+ | T2 chip | Yes | |
| iMac Pro 2017 | T2 chip | No (no sensor) | SE available but no biometric |
| Mac mini 2018+ | T2 chip | No (no sensor) | Can use Magic Keyboard w/ Touch ID |
| Apple Silicon (M1/M2/M3/M4+) | Built-in | Yes (laptops) | Desktops: Magic Keyboard w/ Touch ID |
| Mac Pro (Intel) | No | No | No SE or Touch ID |
| Mac Pro (Apple Silicon) | Built-in | No (no sensor) | Magic Keyboard w/ Touch ID |

**Fallback**: Mac desktops without Touch ID sensor but with SE can still use
`DeviceOwnerAuthentication` (password-based). Macs without SE fall back to
pure Keychain storage without SE key protection.

---

## 6. Phase 3: Keychain Integration with Biometric ACL

> **Goal**: Store and retrieve secrets in the macOS Keychain with biometric
> access control, so accessing the secret triggers Touch ID automatically.

### 6.1 Overview

This replaces the `security` CLI tool approach with proper `security-framework` calls:

```rust
// Instead of:
Command::new("security").args(["find-generic-password", "-s", service, "-a", account, "-w"])

// We do:
let query = KeychainItemQuery {
    service: "com.sortofremoteng.vault",
    account: "master-key",
    access_group: None,
};
let secret = keychain::read_with_biometric(&query, "Unlock sortOfRemoteNG vault")?;
```

### 6.2 Implementation: `keychain.rs`

```rust
//! Biometric-gated Keychain operations.
//!
//! Stores secrets in the macOS Keychain with `SecAccessControl` requiring
//! biometric authentication. Reading the secret automatically triggers
//! the Touch ID prompt.

use security_framework::access_control::SecAccessControl;
use security_framework::item::*;
use security_framework::passwords;
use crate::types::*;

pub(crate) struct KeychainQuery {
    pub service: String,
    pub account: String,
}

/// Store a secret in the Keychain with biometric access control.
///
/// The stored item requires Touch ID (`.biometryCurrentSet`) to read.
/// If the user re-enrolls fingerprints, the item becomes inaccessible
/// (security feature — prevents unauthorized fingerprint replacement).
pub(crate) fn store_with_biometric(
    query: &KeychainQuery,
    secret: &[u8],
    la_reason: &str,
) -> BiometricResult<()> {
    // Delete existing item first (upsert pattern)
    let _ = passwords::delete_generic_password(&query.service, &query.account);

    let access_control = SecAccessControl::create_with_flags(
        ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly,
        SecAccessControlCreateFlags::BIOMETRY_CURRENT_SET,
    ).map_err(|e| BiometricError::platform(format!("Access control: {e}")))?;

    // Create LAContext with reason for the biometric prompt
    let context = la_context::create_context(la_reason);

    let mut add_query = ItemAddOptions::new(ItemAddValue::Data {
        class: ItemClass::generic_password(),
        data: secret,
    });
    add_query
        .set_service(&query.service)
        .set_account(&query.account)
        .set_access_control(&access_control)
        .set_authentication_context(&context);

    add_query.add()
        .map_err(|e| BiometricError::platform(format!("Keychain store: {e}")))
}

/// Read a secret from the Keychain, triggering biometric authentication.
///
/// This causes the OS to display the Touch ID prompt with the given reason.
/// The call blocks until the user authenticates or cancels.
pub(crate) fn read_with_biometric(
    query: &KeychainQuery,
    la_reason: &str,
) -> BiometricResult<Vec<u8>> {
    let context = la_context::create_context(la_reason);

    let results = ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service(&query.service)
        .account(&query.account)
        .authentication_context(&context)
        .return_data(true)
        .limit(1)
        .search()
        .map_err(|e| map_keychain_error(e))?;

    results.into_iter()
        .filter_map(|item| match item {
            SearchResult::Data(data) => Some(data),
            _ => None,
        })
        .next()
        .ok_or_else(|| BiometricError::platform("Keychain item not found"))
}

/// Delete a biometric-protected Keychain item.
pub(crate) fn delete_item(query: &KeychainQuery) -> BiometricResult<()> {
    passwords::delete_generic_password(&query.service, &query.account)
        .map_err(|e| BiometricError::platform(format!("Keychain delete: {e}")))
}

/// Map Security framework errors to BiometricError.
fn map_keychain_error(err: security_framework::Error) -> BiometricError {
    let code = err.code();
    match code {
        -128  => BiometricError::user_cancelled(),        // errSecUserCanceled
        -25293 => BiometricError::auth_failed(),           // errSecAuthFailed
        -25300 => BiometricError::platform("Item not found"), // errSecItemNotFound
        -25299 => BiometricError::platform("Duplicate item"), // errSecDuplicateItem
        _      => BiometricError::platform(format!("Keychain error {code}: {err}")),
    }
}
```

### 6.3 Vault Integration

Update `src-tauri/src/vault_commands.rs` to use the new Keychain module:

```rust
#[tauri::command]
pub async fn vault_biometric_store(
    service: String, account: String, secret: String, reason: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let query = KeychainQuery { service, account };
        keychain::store_with_biometric(&query, secret.as_bytes(), &reason)
            .map_err(|e| e.to_string())
    }
    // ... Windows/Linux paths unchanged
}
```

---

## 7. Phase 4: Frontend Platform Adaptation

> **Goal**: Make the UI platform-aware — show "Touch ID" on macOS, "Windows Hello"
> on Windows, with appropriate icons and messaging.

### 7.1 Platform Detection

Add a Tauri command to expose platform info to the frontend:

```rust
// New command in sorng-biometrics/commands.rs
#[tauri::command]
pub async fn biometric_platform_info() -> Result<BiometricPlatformInfo, String> {
    Ok(BiometricPlatformInfo {
        os: std::env::consts::OS.into(),
        platform_label: get_platform_label(),
        icon_hint: get_icon_hint(),
    })
}
```

```typescript
// New type
interface BiometricPlatformInfo {
  os: 'windows' | 'macos' | 'linux';
  platformLabel: string;  // "Touch ID", "Windows Hello", "Fingerprint"
  iconHint: 'fingerprint' | 'face' | 'shield' | 'watch';
}
```

### 7.2 PasswordDialog.tsx Changes

```diff
- <p>Use Windows Hello or your device biometrics to secure your data</p>
+ <p>Use {biometricInfo?.platformLabel ?? 'your device biometrics'} to secure your data</p>

- <Fingerprint size={48} ... />
+ {biometricIcon === 'fingerprint' && <Fingerprint size={48} ... />}
+ {biometricIcon === 'face' && <ScanFace size={48} ... />}
+ {biometricIcon === 'shield' && <ShieldCheck size={48} ... />}
```

### 7.3 macOS-Specific UI Enhancements

| Element | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Icon | Fingerprint / Shield | Fingerprint (Touch ID) | Fingerprint |
| Label | "Windows Hello" | "Touch ID" | "Fingerprint" |
| Setup text | "Use Windows Hello..." | "Use Touch ID to secure..." | "Use fingerprint..." |
| Fallback text | "Enter PIN" | "Enter password" | "Enter password" |
| Settings toggle | "Require Windows Hello" | "Require Touch ID" | "Require fingerprint" |

### 7.4 Security Settings Panel

Add biometric-specific settings in `SecuritySettings.tsx`:

```typescript
// New settings
interface BiometricSettings {
  enabled: boolean;                    // Master toggle
  requireForUnlock: boolean;           // Require biometric to unlock vault
  requireForConnectionPassword: boolean; // Require biometric to view saved passwords
  allowPasswordFallback: boolean;      // Allow system password when biometric fails
  lockoutBehavior: 'block' | 'fallback'; // What to do when biometric is locked out
  // macOS-specific:
  watchUnlockEnabled: boolean;         // Allow Apple Watch to unlock
  // Windows-specific:
  windowsHelloPin: boolean;            // Allow PIN as fallback in Windows Hello
}
```

### 7.5 New React Hook: `useBiometricInfo`

```typescript
// src/hooks/security/useBiometricInfo.ts

export interface BiometricInfo {
  available: boolean;
  enrolled: boolean;
  platformLabel: string;
  kinds: BiometricKind[];    // 'fingerprint' | 'face_recognition' | 'iris' | 'other'
  os: string;
  iconHint: 'fingerprint' | 'face' | 'shield';
}

export function useBiometricInfo() {
  const [info, setInfo] = useState<BiometricInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function check() {
      try {
        const status = await invoke<BiometricStatus>('biometric_check_availability');
        setInfo({
          available: status.hardwareAvailable && status.enrolled,
          enrolled: status.enrolled,
          platformLabel: status.platformLabel,
          kinds: status.kinds,
          os: await getOS(),
          iconHint: status.kinds.includes('fingerprint') ? 'fingerprint'
                  : status.kinds.includes('face_recognition') ? 'face'
                  : 'shield',
        });
      } catch {
        setInfo(null);
      } finally {
        setLoading(false);
      }
    }
    check();
  }, []);

  return { info, loading };
}
```

---

## 8. Phase 5: Apple Watch Unlock Support

> **Goal**: Allow users to authenticate using a nearby paired Apple Watch,
> just like macOS itself supports "Unlock with Apple Watch".

### 8.1 How It Works

Apple's `LocalAuthentication` framework supports the policy
`LAPolicyDeviceOwnerAuthenticationWithBiometricsOrWatch` (macOS 10.15+).
When this policy is used:
- Touch ID is tried first
- If Touch ID is unavailable or fails, the nearby Apple Watch is attempted
- The Watch shows a "Double-click to approve" prompt

### 8.2 Implementation

```rust
// In la_context.rs — the Policy enum already includes this:
Policy::BiometricOrWatch =>
    LAPolicy::DeviceOwnerAuthenticationWithBiometricsOrWatch,
```

The only change needed is:
1. A user setting to enable Apple Watch unlock
2. A check for Watch availability:
   ```rust
   fn is_watch_available() -> bool {
       let context = LAContext::new();
       let mut error = None;
       context.canEvaluatePolicy_error(
           LAPolicy::DeviceOwnerAuthenticationWithBiometricsOrWatch,
           &mut error,
       )
   }
   ```
3. Use `Policy::BiometricOrWatch` when the setting is enabled

### 8.3 Frontend: Watch Toggle in Settings

```
┌─ Security Settings ─────────────────────────────────┐
│                                                      │
│  ☑ Require Touch ID to unlock vault                 │
│  ☑ Require Touch ID to view passwords               │
│  ☐ Allow Apple Watch unlock                          │
│    └ "Double-click your Apple Watch side button      │
│       to authenticate when Touch ID isn't available" │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 8.4 Not in Scope

- **Face ID on Mac**: No Mac currently ships with Face ID. If Apple adds it,
  `LAContext` will handle it transparently — no code changes needed.
- **Optic ID**: Vision Pro only. Same story — `LAContext` abstracts it.

---

## 9. Phase 6: Testing Strategy

### 9.1 Unit Tests (Rust — run on all platforms)

Tests for platform-agnostic code that doesn't require biometric hardware:

```
tests/
└── security/
    └── biometrics.test.ts     ← Frontend tests (mocked invoke)

src-tauri/crates/sorng-biometrics/
└── src/
    ├── authenticate.rs        ← #[cfg(test)] for key derivation logic
    ├── types.rs               ← #[cfg(test)] for serialization roundtrips
    └── platform/
        └── macos/
            ├── mod.rs         ← Integration test markers
            └── helpers.rs     ← Machine ID parsing tests
```

#### Type Serialization Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn biometric_status_serializes_correctly() {
        let status = BiometricStatus {
            hardware_available: true,
            enrolled: true,
            kinds: vec![BiometricKind::Fingerprint],
            platform_label: "Touch ID".into(),
            unavailable_reason: None,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"platformLabel\":\"Touch ID\""));
        assert!(json.contains("\"fingerprint\""));
    }

    #[test]
    fn biometric_error_display() {
        let err = BiometricError::user_cancelled();
        assert_eq!(err.to_string(), "[UserCancelled] User cancelled biometric prompt");
    }
}
```

#### Key Derivation Tests

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn key_derivation_is_deterministic() {
        // Same inputs should always produce the same key
        let key1 = derive_key_software("machine1", "unlock vault");
        let key2 = derive_key_software("machine1", "unlock vault");
        assert_eq!(key1, key2);
    }

    #[test]
    fn key_derivation_varies_by_reason() {
        let key1 = derive_key_software("machine1", "unlock vault");
        let key2 = derive_key_software("machine1", "view password");
        assert_ne!(key1, key2);
    }

    #[test]
    fn key_derivation_varies_by_machine() {
        let key1 = derive_key_software("machine1", "unlock vault");
        let key2 = derive_key_software("machine2", "unlock vault");
        assert_ne!(key1, key2);
    }
}
```

### 9.2 Frontend Tests (Vitest — mocked Tauri invoke)

```typescript
// tests/security/biometrics.test.ts

describe('useBiometricInfo', () => {
  it('reports Touch ID on macOS', async () => {
    mockInvoke('biometric_check_availability', {
      hardwareAvailable: true,
      enrolled: true,
      kinds: ['fingerprint'],
      platformLabel: 'Touch ID',
      unavailableReason: null,
    });

    const { result } = renderHook(() => useBiometricInfo());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.info?.platformLabel).toBe('Touch ID');
    expect(result.current.info?.iconHint).toBe('fingerprint');
  });

  it('reports Windows Hello on Windows', async () => {
    mockInvoke('biometric_check_availability', {
      hardwareAvailable: true,
      enrolled: true,
      kinds: ['fingerprint', 'face_recognition'],
      platformLabel: 'Windows Hello',
      unavailableReason: null,
    });

    const { result } = renderHook(() => useBiometricInfo());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.info?.platformLabel).toBe('Windows Hello');
  });

  it('handles unavailable biometrics gracefully', async () => {
    mockInvoke('biometric_check_availability', {
      hardwareAvailable: false,
      enrolled: false,
      kinds: [],
      platformLabel: 'Unknown',
      unavailableReason: 'No biometric hardware detected',
    });

    const { result } = renderHook(() => useBiometricInfo());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.info?.available).toBe(false);
  });
});

describe('PasswordDialog biometric integration', () => {
  it('shows Touch ID label on macOS', async () => {
    mockInvoke('passkey_is_available', true);
    mockInvoke('biometric_check_availability', {
      platformLabel: 'Touch ID',
      kinds: ['fingerprint'],
      hardwareAvailable: true,
      enrolled: true,
    });

    render(<PasswordDialog isOpen={true} mode="unlock" ... />);

    expect(await screen.findByText(/Touch ID/)).toBeInTheDocument();
    expect(screen.queryByText(/Windows Hello/)).not.toBeInTheDocument();
  });

  it('hides passkey option when biometrics unavailable', async () => {
    mockInvoke('passkey_is_available', false);

    render(<PasswordDialog isOpen={true} mode="unlock" ... />);

    expect(screen.queryByText(/Passkey/)).not.toBeInTheDocument();
  });
});
```

### 9.3 Integration Tests (macOS CI runner with Touch ID Simulator)

For CI on macOS:

```yaml
# .github/workflows/macos-biometric-tests.yml
jobs:
  biometric-integration:
    runs-on: macos-14  # Apple Silicon runner
    steps:
      - uses: actions/checkout@v4
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      - name: Run biometric availability tests
        run: |
          # CI runners don't have Touch ID hardware, but we can test:
          # 1. LAContext creation succeeds
          # 2. canEvaluatePolicy returns BiometryNotAvailable (expected)
          # 3. Error mapping is correct
          # 4. Keychain operations work (without biometric ACL)
          cargo test -p sorng-biometrics --features ci-test
      - name: Run frontend biometric tests
        run: npx vitest run tests/security/
```

#### CI-only test feature:

```rust
// In Cargo.toml
[features]
ci-test = []

// In tests
#[cfg(all(test, feature = "ci-test", target_os = "macos"))]
mod ci_tests {
    #[test]
    fn la_context_creation_succeeds() {
        // LAContext::new() should always work even without hardware
        let context = LAContext::new();
        assert!(!context.is_null());
    }

    #[test]
    fn no_biometric_hardware_detected_on_ci() {
        let result = super::la_context::can_evaluate(Policy::BiometricOnly);
        // CI runner has no Touch ID — this should return available: false
        match result {
            Ok(info) => assert!(!info.available),
            Err(e) => assert!(matches!(e.kind, BiometricErrorKind::HardwareUnavailable)),
        }
    }

    #[test]
    fn machine_id_is_deterministic() {
        let id1 = super::helpers::get_macos_machine_id();
        let id2 = super::helpers::get_macos_machine_id();
        assert_eq!(id1, id2);
        assert!(!id1.is_empty());
    }
}
```

### 9.4 Manual Test Matrix

| # | Scenario | Expected Result | Platform |
|---|----------|----------------|----------|
| 1 | Open unlock dialog on MacBook with Touch ID enrolled | Shows "Touch ID" label + fingerprint icon | macOS |
| 2 | Tap "Authenticate" → place finger on sensor | Touch ID sheet appears → success → vault unlocks | macOS |
| 3 | Tap "Authenticate" → wrong finger 3x | Error: "Biometric verification failed" | macOS |
| 4 | Tap "Authenticate" → press Cancel | Error: "User cancelled" → dialog stays open | macOS |
| 5 | Touch ID locked out (too many failures) | Falls back to system password prompt | macOS |
| 6 | Mac desktop without Touch ID (no Magic Keyboard w/Touch ID) | Passkey option hidden or shows "Enter Password" | macOS |
| 7 | Mac desktop with Magic Keyboard w/Touch ID | Touch ID works normally | macOS |
| 8 | Unenroll all fingerprints → open app | Shows "No fingerprints enrolled" warning | macOS |
| 9 | Add new fingerprint after SE key was created | SE key invalidated (`.biometryCurrentSet`), re-setup required | macOS |
| 10 | Apple Watch unlock enabled, Touch ID fails → Watch prompt | Watch shows "Double-click to approve" | macOS |
| 11 | Store secret → read secret back | Touch ID prompt on read, correct data returned | macOS |
| 12 | Lid closed (clamshell mode) with external display | Touch ID unavailable → password fallback | macOS |

---

## 10. Phase 7: Unify sorng-biometrics and sorng-auth/passkey

> **Goal**: Eliminate the duplicate biometric code in `sorng-auth/passkey.rs` by
> making it call into `sorng-biometrics` instead of reimplementing.

### 10.1 Current Duplication

Both crates implement:
- Platform detection (`is_available`)
- macOS authentication via `security` CLI
- Machine ID retrieval
- Key derivation (SHA256-based)

### 10.2 Refactoring Plan

```diff
// sorng-auth/passkey.rs

- #[cfg(target_os = "macos")]
- async fn authenticate_macos(&mut self, reason: &str) -> Result<Vec<u8>, String> {
-     use std::process::Command;
-     let output = Command::new("security")...  // 50+ lines of duplicate code
- }

+ async fn authenticate_platform(&mut self, reason: &str) -> Result<Vec<u8>, String> {
+     // Delegate to the single biometrics crate
+     let result = sorng_biometrics::authenticate::verify_and_derive_key(reason)
+         .await
+         .map_err(|e| e.to_string())?;
+     
+     if result.success {
+         let key = hex::decode(&result.derived_key_hex.unwrap_or_default())
+             .map_err(|e| e.to_string())?;
+         self.derived_key = Some(key.clone());
+         Ok(key)
+     } else {
+         Err(result.message)
+     }
+ }
```

### 10.3 Dependency Change

```toml
# sorng-auth/Cargo.toml
[dependencies]
sorng-biometrics = { path = "../sorng-biometrics" }
```

---

## 11. Cargo Dependencies

### 11.1 Updated `sorng-biometrics/Cargo.toml`

```toml
[target.'cfg(target_os = "macos")'.dependencies]
# Core ObjC runtime + Foundation types
objc2 = "0.6"
objc2-foundation = { version = "0.3", features = ["NSError", "NSString"] }

# LocalAuthentication framework (LAContext, LAPolicy)
objc2-local-authentication = "0.3"

# Completion handler support
block2 = "0.6"

# Keychain + SecAccessControl + SecKey
security-framework = "2.11"          # already present, now actually used
security-framework-sys = "2.11"      # for raw constants

# CoreFoundation helpers
core-foundation = "0.10"
```

### 11.2 Why Each Dependency

| Crate | Purpose | Size Impact |
|-------|---------|-------------|
| `objc2` | Type-safe ObjC FFI runtime | ~50KB (macOS only) |
| `objc2-foundation` | `NSString`, `NSError` wrappers | ~30KB |
| `objc2-local-authentication` | `LAContext`, `LAPolicy`, `LABiometryType` | ~15KB |
| `block2` | ObjC block (closure) support for callbacks | ~10KB |
| `security-framework` | Keychain, `SecAccessControl`, `SecKey` | Already dep'd |
| `core-foundation` | `CFString`, `CFData` for Security API interop | ~20KB |

**Total added binary size**: ~125KB (macOS target only, zero impact on Windows/Linux).

---

## 12. Entitlements & Code Signing

### 12.1 Required Entitlements

The Tauri app's entitlements plist must include:

```xml
<!-- src-tauri/entitlements.plist (or info.plist Entitlements section) -->

<!-- Required for Keychain access -->
<key>keychain-access-groups</key>
<array>
    <string>$(TeamIdentifierPrefix)com.sortofremoteng</string>
</array>

<!-- Required for Secure Enclave key generation (only needed for Phase 2) -->
<!-- No explicit entitlement needed — SE access is governed by code signing -->

<!-- Required for Apple Watch unlock (Phase 5) -->
<!-- No entitlement needed — LAPolicy handles this -->
```

### 12.2 Info.plist Keys

```xml
<!-- Required: Reason string shown in system prompts -->
<key>NSFaceIDUsageDescription</key>
<string>sortOfRemoteNG uses Touch ID to protect your saved connections and passwords.</string>
```

> **Note**: Despite the key name `NSFaceIDUsageDescription`, this is required for
> **all** biometric types (Touch ID, Face ID, Optic ID) since macOS 10.15 / iOS 11.

### 12.3 Tauri Configuration

In `src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "macOS": {
      "entitlements": "./entitlements.plist",
      "signingIdentity": "Developer ID Application: ...",
      "provisioningProfile": null,
      "minimumSystemVersion": "12.0"
    }
  }
}
```

### 12.4 Code Signing Requirements

- **Secure Enclave** keys require the app to be **code-signed**. Unsigned builds
  cannot create SE keys.
- Debug builds work with **ad-hoc signing** (`codesign -s -`).
- Release builds must use a proper **Developer ID** certificate.
- Keychain items with biometric ACL require code signing to persist across launches.

---

## 13. Security Considerations

### 13.1 Threat Model

| Threat | Mitigation |
|--------|-----------|
| Malware reads derived key from memory | SE key never leaves hardware; derived key zeroed after use |
| Fingerprint spoofing | Apple's Secure Enclave handles anti-spoofing; we trust the OS |
| Keychain item accessed without biometric | `SecAccessControlCreateFlags::BIOMETRY_CURRENT_SET` prevents this |
| New fingerprint enrolled → unauthorized access | `.biometryCurrentSet` invalidates key when enrollment changes |
| App impersonation (another app triggers our Keychain) | Keychain ACL bound to our code signing identity |
| CI/CD secrets leakage | No biometric secrets stored in CI; tests use mocks |
| Downgrade to shell-command approach | Remove all `Command::new("security")`/`Command::new("bioutil")` code |

### 13.2 `.biometryCurrentSet` vs `.biometryAny`

We use **`.biometryCurrentSet`**:
- Key/secret is invalidated if ANY fingerprint is added or removed
- More secure: prevents a new (potentially unauthorized) fingerprint from accessing old data
- User must re-setup biometric encryption after fingerprint changes
- Trade-off: slight inconvenience when user adds a new finger

Alternative `.biometryAny`:
- Key survives fingerprint enrollment changes
- Less secure: a new fingerprint could access old data
- Better UX for users who frequently update fingerprints

**Recommendation**: Default to `.biometryCurrentSet`, with a setting to switch to
`.biometryAny` for users who prioritize convenience.

### 13.3 Key Rotation

When the biometric enrollment changes (`.biometryCurrentSet` invalidates):
1. Detect the invalidation on next unlock attempt (Keychain returns `errSecAuthFailed`)
2. Show a re-setup dialog: "Your fingerprints have changed. Please re-authenticate
   with your password to re-enable Touch ID."
3. User enters password → app re-creates the SE key + re-encrypts vault envelope key
4. Touch ID is re-enabled with new enrollment set

---

## 14. Migration Path

### 14.1 Data Migration

Users who set up biometric auth with the old shell-command approach:
1. On first launch with new code, detect the old canary Keychain item
   (`com.sortofremoteng.biometric` / `biometric-canary`)
2. Prompt user to re-authenticate with password
3. Create new SE key + biometric-protected Keychain item
4. Delete old canary item
5. Log the migration event

```rust
pub(crate) fn needs_migration() -> bool {
    // Check for old-style canary item
    passwords::get_generic_password("com.sortofremoteng.biometric", "biometric-canary").is_ok()
}

pub(crate) fn cleanup_legacy_items() -> Result<(), BiometricError> {
    let _ = passwords::delete_generic_password(
        "com.sortofremoteng.biometric",
        "biometric-canary",
    );
    let _ = passwords::delete_generic_password(
        "sortofremoteng-passkey",    // from passkey.rs
        "sortofremoteng",
    );
    Ok(())
}
```

### 14.2 Settings Migration

Add a version field to biometric settings:

```json
{
  "biometric": {
    "version": 2,
    "enabled": true,
    "method": "secure_enclave",    // v1 was "keychain_canary"
    "watchUnlock": false,
    "created": "2026-04-15T..."
  }
}
```

---

## 15. File-by-File Change Map

### Rust (Backend)

| File | Action | Description |
|------|--------|-------------|
| `sorng-biometrics/Cargo.toml` | **Modify** | Add `objc2`, `objc2-foundation`, `objc2-local-authentication`, `block2` deps |
| `sorng-biometrics/src/platform/macos.rs` | **Delete** | Replace with directory module |
| `sorng-biometrics/src/platform/macos/mod.rs` | **Create** | Public API: `check_availability()`, `prompt()`, `needs_migration()` |
| `sorng-biometrics/src/platform/macos/la_context.rs` | **Create** | LAContext FFI wrapper, `can_evaluate()`, `evaluate()` |
| `sorng-biometrics/src/platform/macos/keychain.rs` | **Create** | Biometric-gated Keychain read/write/delete |
| `sorng-biometrics/src/platform/macos/secure_enclave.rs` | **Create** | SE key generation, signing, key derivation |
| `sorng-biometrics/src/platform/macos/helpers.rs` | **Create** | Machine ID, enrollment detection, biometry type mapping |
| `sorng-biometrics/src/platform/macos/migration.rs` | **Create** | Legacy canary item detection and cleanup |
| `sorng-biometrics/src/platform/mod.rs` | **Modify** | Update `macos` module declaration |
| `sorng-biometrics/src/types.rs` | **Modify** | Add `BiometryType` enum (TouchID/FaceID/OpticID/None) |
| `sorng-biometrics/src/authenticate.rs` | **Modify** | macOS path uses SE key derivation instead of SHA256 |
| `sorng-biometrics/src/commands.rs` | **Modify** | Add `biometric_platform_info`, `biometric_needs_migration` |
| `sorng-auth/Cargo.toml` | **Modify** | Add `sorng-biometrics` dependency |
| `sorng-auth/src/passkey.rs` | **Modify** | Delegate to `sorng-biometrics` instead of reimplementing |
| `src-tauri/src/vault_commands.rs` | **Modify** | Use new Keychain module for macOS vault ops |
| `src-tauri/tauri.conf.json` | **Modify** | Add macOS entitlements path, min system version |
| `src-tauri/entitlements.plist` | **Create** | Keychain access groups |
| `src-tauri/Info.plist` | **Modify** | Add `NSFaceIDUsageDescription` |

### TypeScript (Frontend)

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/security/useBiometricInfo.ts` | **Create** | Hook for platform-aware biometric info |
| `src/hooks/security/usePasswordDialog.ts` | **Modify** | Use `useBiometricInfo` for platform-aware labels |
| `src/components/security/PasswordDialog.tsx` | **Modify** | Dynamic labels, icons, platform-specific messaging |
| `src/components/SettingsDialog/sections/SecuritySettings.tsx` | **Modify** | Biometric settings (watch unlock, enrollment policy) |
| `src/utils/storage/storage.ts` | **Modify** | Add `getBiometricPlatformInfo()` method |
| `src/types/biometrics.ts` | **Create** | TypeScript types for biometric status/info |

### Tests

| File | Action | Description |
|------|--------|-------------|
| `tests/security/biometrics.test.ts` | **Create** | Frontend biometric hook + dialog tests |
| `sorng-biometrics/src/platform/macos/mod.rs` | tests module | CI integration tests |
| `sorng-biometrics/src/types.rs` | tests module | Serialization roundtrip tests |
| `sorng-biometrics/src/authenticate.rs` | tests module | Key derivation determinism tests |

### Config / CI

| File | Action | Description |
|------|--------|-------------|
| `.github/workflows/macos-biometric-tests.yml` | **Create** | macOS CI runner for biometric tests |
| `src-tauri/entitlements.plist` | **Create** | macOS code signing entitlements |

---

## 16. Rollout & Milestones

### Milestone 1: Native Touch ID Prompt (Phase 1)
- Replace shell commands with `LAContext.evaluatePolicy()`
- Instant availability detection via `canEvaluatePolicy()`
- Proper LAError code mapping
- All existing tests pass
- **Deliverable**: Touch ID works natively on macOS

### Milestone 2: Secure Enclave Keys (Phase 2)
- SE key generation with biometric ACL
- Key derivation via SE signing
- Keychain-based SE key persistence
- **Deliverable**: Derived keys are hardware-bound

### Milestone 3: Proper Keychain Integration (Phase 3)
- Biometric-gated secret storage
- `store_with_biometric()` / `read_with_biometric()`
- Vault commands updated
- **Deliverable**: Secrets require Touch ID to access

### Milestone 4: Platform-Aware UI (Phase 4)
- Dynamic labels ("Touch ID" / "Windows Hello")
- Platform-appropriate icons
- Biometric settings panel
- `useBiometricInfo` hook
- **Deliverable**: UI adapts to platform

### Milestone 5: Apple Watch + Migration (Phases 5 + 7)
- Apple Watch unlock option
- Legacy canary item migration
- `sorng-auth/passkey.rs` consolidation
- **Deliverable**: Full feature parity + clean codebase

### Milestone 6: Testing + Polish (Phase 6)
- Full test suite (unit + integration + frontend)
- CI pipeline for macOS
- Manual test matrix completion
- Documentation
- **Deliverable**: Production-ready macOS biometrics

---

## Appendix A: Apple Framework Quick Reference

### LAContext Methods

| Method | Purpose |
|--------|---------|
| `canEvaluatePolicy:error:` | Check if biometric is available & enrolled |
| `evaluatePolicy:localizedReason:reply:` | Show biometric prompt |
| `biometryType` | Returns `.touchID`, `.faceID`, `.opticID`, or `.none` |
| `invalidate` | Invalidate context (force re-auth next time) |
| `evaluatedPolicyDomainState` | Opaque data representing current enrollment state |

### LAPolicy Values

| Policy | Description | macOS Version |
|--------|-------------|---------------|
| `deviceOwnerAuthenticationWithBiometrics` | Biometric only | 10.12.2+ |
| `deviceOwnerAuthentication` | Biometric + password fallback | 10.12.2+ |
| `deviceOwnerAuthenticationWithBiometricsOrWatch` | Biometric + Apple Watch | 10.15+ |
| `deviceOwnerAuthenticationWithWatch` | Apple Watch only | 10.15+ |

### SecAccessControl Flags

| Flag | Description |
|------|-------------|
| `.biometryCurrentSet` | Require currently enrolled biometrics (invalidated on enrollment change) |
| `.biometryAny` | Require any enrolled biometric (survives enrollment changes) |
| `.privateKeyUsage` | Allow private key operations (needed for SE keys) |
| `.userPresence` | Biometric or passcode |
| `.devicePasscode` | Device passcode only |

### Security Error Codes (Keychain)

| Code | Name | Meaning |
|------|------|---------|
| 0 | `errSecSuccess` | Operation succeeded |
| -128 | `errSecUserCanceled` | User cancelled the auth prompt |
| -25293 | `errSecAuthFailed` | Authentication failed |
| -25299 | `errSecDuplicateItem` | Item already exists |
| -25300 | `errSecItemNotFound` | Item not found |
| -34018 | `errSecMissingEntitlement` | Missing entitlement for Keychain access |

---

## Appendix B: Comparison with Windows Hello Implementation

| Aspect | Windows Hello | macOS Touch ID (Target) |
|--------|--------------|------------------------|
| **API** | WinRT `UserConsentVerifier` | `LAContext` (LocalAuthentication) |
| **Availability check** | `CheckAvailabilityAsync()` | `canEvaluatePolicy:error:` |
| **Auth prompt** | `RequestVerificationAsync()` | `evaluatePolicy:localizedReason:reply:` |
| **Key storage** | Software SHA256 | Secure Enclave (hardware) |
| **Keychain/Credential** | Windows Credential Manager | macOS Keychain + SecAccessControl |
| **Sensor detection** | WBF Registry | `LAContext.biometryType` |
| **Watch support** | N/A | `deviceOwnerAuthenticationWithBiometricsOrWatch` |
| **FFI approach** | `windows` crate (WinRT) | `objc2` crate (ObjC) |
| **Async model** | WinRT IAsyncOperation | ObjC completion block → mpsc channel |

> **Future parity opportunity**: Windows Hello also supports Secure Enclave-equivalent
> via **TPM 2.0** + **Windows Hello for Business**. A follow-up project could upgrade
> the Windows path to use `NCryptCreatePersistedKey` with TPM-backed keys, matching
> the macOS Secure Enclave approach.

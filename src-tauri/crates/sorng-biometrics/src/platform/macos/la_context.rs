//! Safe Rust wrapper around macOS LocalAuthentication framework.
//!
//! Uses raw Objective-C FFI to call `LAContext` methods for biometric
//! availability checking and user verification prompts.
//! Links against the `LocalAuthentication` and `Foundation` frameworks.

use crate::types::*;
use std::ffi::c_void;
use std::sync::mpsc;

// ── Objective-C runtime FFI ─────────────────────────────────────────

#[link(name = "objc", kind = "dylib")]
extern "C" {
    fn objc_getClass(name: *const u8) -> *mut c_void;
    fn sel_registerName(name: *const u8) -> *mut c_void;
    fn objc_msgSend(obj: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
}

#[link(name = "LocalAuthentication", kind = "framework")]
extern "C" {}

#[link(name = "Foundation", kind = "framework")]
extern "C" {}

// ── LAPolicy constants ──────────────────────────────────────────────

/// `LAPolicyDeviceOwnerAuthenticationWithBiometrics` — biometric only.
const LA_POLICY_BIOMETRICS: i64 = 1;
/// `LAPolicyDeviceOwnerAuthentication` — biometric with password fallback.
const LA_POLICY_BIOMETRICS_OR_PASSWORD: i64 = 2;
/// `LAPolicyDeviceOwnerAuthenticationWithWatch` — Apple Watch only (macOS 10.15+).
#[allow(dead_code)]
const LA_POLICY_WATCH: i64 = 3;
/// `LAPolicyDeviceOwnerAuthenticationWithBiometricsOrWatch` — biometric or Watch (macOS 10.15+).
#[allow(dead_code)]
const LA_POLICY_BIOMETRICS_OR_WATCH: i64 = 4;

// ── LABiometryType constants ────────────────────────────────────────

const LA_BIOMETRY_TYPE_NONE: i64 = 0;
const LA_BIOMETRY_TYPE_TOUCH_ID: i64 = 1;
const LA_BIOMETRY_TYPE_FACE_ID: i64 = 2;
// OpticID = 4 (visionOS, unlikely on Mac but included for completeness)
#[allow(dead_code)]
const LA_BIOMETRY_TYPE_OPTIC_ID: i64 = 4;

// ── LAError codes ───────────────────────────────────────────────────

const LA_ERROR_AUTH_FAILED: i64 = -1;
const LA_ERROR_USER_CANCEL: i64 = -2;
const LA_ERROR_USER_FALLBACK: i64 = -3;
const LA_ERROR_SYSTEM_CANCEL: i64 = -4;
const LA_ERROR_PASSCODE_NOT_SET: i64 = -5;
const LA_ERROR_BIOMETRY_NOT_AVAILABLE: i64 = -6;
const LA_ERROR_BIOMETRY_NOT_ENROLLED: i64 = -7;
const LA_ERROR_BIOMETRY_LOCKOUT: i64 = -8;
#[allow(dead_code)]
const LA_ERROR_APP_CANCEL: i64 = -9;
#[allow(dead_code)]
const LA_ERROR_INVALID_CONTEXT: i64 = -10;

// ── Public biometric evaluation policy ──────────────────────────────

/// Which biometric policy to use for evaluation.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Policy {
    /// Touch ID only (no password fallback).
    BiometricOnly,
    /// Touch ID with system password fallback.
    BiometricOrPassword,
    /// Touch ID or Apple Watch (macOS 10.15+).
    BiometricOrWatch,
}

impl Policy {
    fn to_la_policy(self) -> i64 {
        match self {
            Policy::BiometricOnly => LA_POLICY_BIOMETRICS,
            Policy::BiometricOrPassword => LA_POLICY_BIOMETRICS_OR_PASSWORD,
            Policy::BiometricOrWatch => LA_POLICY_BIOMETRICS_OR_WATCH,
        }
    }
}

// ── Helper: create an NSString from a Rust &str ─────────────────────

unsafe fn nsstring_from_str(s: &str) -> *mut c_void {
    let cls = objc_getClass(b"NSString\0".as_ptr());
    let sel = sel_registerName(b"stringWithUTF8String:\0".as_ptr());
    let cstr = std::ffi::CString::new(s).unwrap_or_default();
    objc_msgSend(cls, sel, cstr.as_ptr())
}

/// Get the NSError code (NSInteger) from an NSError pointer.
unsafe fn nserror_code(error: *mut c_void) -> i64 {
    if error.is_null() {
        return 0;
    }
    let sel = sel_registerName(b"code\0".as_ptr());
    let code: i64 = std::mem::transmute(objc_msgSend(error, sel));
    code
}

// ── Availability check ──────────────────────────────────────────────

/// Check if biometric authentication can be evaluated.
///
/// Calls `[[LAContext alloc] init]` then `canEvaluatePolicy:error:`.
/// Returns a `BiometryInfo` with availability, type, and enrollment info.
pub(crate) fn can_evaluate(policy: Policy) -> Result<BiometryInfo, BiometricError> {
    unsafe {
        // LAContext *ctx = [[LAContext alloc] init];
        let la_class = objc_getClass(b"LAContext\0".as_ptr());
        if la_class.is_null() {
            return Err(BiometricError::platform(
                "LAContext class not found — LocalAuthentication framework not linked",
            ));
        }
        let alloc_sel = sel_registerName(b"alloc\0".as_ptr());
        let init_sel = sel_registerName(b"init\0".as_ptr());
        let ctx = objc_msgSend(objc_msgSend(la_class, alloc_sel), init_sel);
        if ctx.is_null() {
            return Err(BiometricError::platform("Failed to create LAContext"));
        }

        // NSError *error = nil;
        let mut error: *mut c_void = std::ptr::null_mut();

        // BOOL can = [ctx canEvaluatePolicy:policy error:&error];
        let can_sel = sel_registerName(b"canEvaluatePolicy:error:\0".as_ptr());
        let can_raw: *mut c_void = objc_msgSend(
            ctx,
            can_sel,
            policy.to_la_policy(),
            &mut error as *mut *mut c_void,
        );
        let can = can_raw as i64 != 0;

        // LABiometryType type = ctx.biometryType;
        let biometry_sel = sel_registerName(b"biometryType\0".as_ptr());
        let biometry_raw: i64 = std::mem::transmute(objc_msgSend(ctx, biometry_sel));

        let biometry_type = match biometry_raw {
            LA_BIOMETRY_TYPE_TOUCH_ID => BiometryType::TouchID,
            LA_BIOMETRY_TYPE_FACE_ID => BiometryType::FaceID,
            LA_BIOMETRY_TYPE_OPTIC_ID => BiometryType::OpticID,
            LA_BIOMETRY_TYPE_NONE | _ => BiometryType::None,
        };

        // Release context
        let release_sel = sel_registerName(b"release\0".as_ptr());
        let _ = objc_msgSend(ctx, release_sel);

        if can {
            Ok(BiometryInfo {
                available: true,
                biometry_type,
                enrolled: true,
            })
        } else {
            let code = nserror_code(error);
            let (available, enrolled) = match code {
                LA_ERROR_BIOMETRY_NOT_AVAILABLE => (false, false),
                LA_ERROR_BIOMETRY_NOT_ENROLLED => (true, false),
                LA_ERROR_PASSCODE_NOT_SET => (true, false),
                LA_ERROR_BIOMETRY_LOCKOUT => (true, true), // locked out but hardware exists
                _ => (false, false),
            };
            Ok(BiometryInfo {
                available,
                biometry_type,
                enrolled,
            })
        }
    }
}

// ── Biometric prompt ────────────────────────────────────────────────

/// Prompt the user for biometric authentication using the native Touch ID dialog.
///
/// This calls `[LAContext evaluatePolicy:localizedReason:reply:]` which displays
/// the system Touch ID sheet. The call blocks until the user responds.
///
/// # Arguments
/// * `reason` — The message shown in the Touch ID dialog (e.g. "Unlock sortOfRemoteNG vault")
/// * `policy` — Which authentication policy to use
pub(crate) fn evaluate(reason: &str, policy: Policy) -> BiometricResult<bool> {
    // We use a synchronous channel to bridge the async ObjC completion handler.
    let (tx, rx) = mpsc::channel::<BiometricResult<bool>>();

    unsafe {
        // Create LAContext
        let la_class = objc_getClass(b"LAContext\0".as_ptr());
        let alloc_sel = sel_registerName(b"alloc\0".as_ptr());
        let init_sel = sel_registerName(b"init\0".as_ptr());
        let ctx = objc_msgSend(objc_msgSend(la_class, alloc_sel), init_sel);
        if ctx.is_null() {
            return Err(BiometricError::platform("Failed to create LAContext"));
        }

        let ns_reason = nsstring_from_str(reason);

        // Build the completion block.
        // LAContext evaluatePolicy:localizedReason:reply: takes a block of type
        //   void (^)(BOOL success, NSError *error)
        //
        // We use a C function pointer + context approach instead of the block ABI
        // for simplicity.  We dispatch via GCD to ensure the reply block works.

        // For the reply block, we use a simpler approach: spawn a thread that
        // calls evaluatePolicy synchronously by polling.  The native API is
        // callback-based, so we bridge it with dispatch_semaphore.

        // Actually, the simplest safe approach on macOS: use dispatch_semaphore
        // to wait for the ObjC block callback.

        // Create dispatch semaphore
        let sem = dispatch_semaphore_create(0);

        // Shared result storage
        let result_ptr = Box::into_raw(Box::new(None::<BiometricResult<bool>>));

        // Create the ObjC block
        // The block signature is: void (^)(BOOL success, NSError *error)
        //
        // We'll use the C block ABI layout directly.
        let block = create_evaluate_block(result_ptr, sem);

        // [ctx evaluatePolicy:policy localizedReason:nsReason reply:block]
        let eval_sel =
            sel_registerName(b"evaluatePolicy:localizedReason:reply:\0".as_ptr());
        let _ = objc_msgSend(ctx, eval_sel, policy.to_la_policy(), ns_reason, block);

        // Wait for completion (timeout 120 seconds — user may take time with Touch ID)
        let timeout = dispatch_time(DISPATCH_TIME_NOW, 120_000_000_000); // 120s in nanos
        let wait_result = dispatch_semaphore_wait(sem, timeout);

        // Retrieve result
        let result = Box::from_raw(result_ptr);

        // Release context
        let release_sel = sel_registerName(b"release\0".as_ptr());
        let _ = objc_msgSend(ctx, release_sel);

        // Release semaphore
        dispatch_release(sem as *mut c_void);

        // Free the block
        free_evaluate_block(block);

        if wait_result != 0 {
            return Err(BiometricError::platform(
                "Touch ID prompt timed out after 120 seconds",
            ));
        }

        match *result {
            Some(r) => r,
            None => Err(BiometricError::internal("No result from Touch ID evaluation")),
        }
    }
}

// ── ObjC Block ABI for the evaluatePolicy completion handler ────────

/// The C layout of an Objective-C block as used by the runtime.
/// This matches the `Block_layout` structure from the ObjC block ABI.
#[repr(C)]
struct EvaluateBlock {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    invoke: unsafe extern "C" fn(*mut EvaluateBlock, i8, *mut c_void),
    descriptor: *const BlockDescriptor,
    result_ptr: *mut Option<BiometricResult<bool>>,
    semaphore: *mut c_void,
}

#[repr(C)]
struct BlockDescriptor {
    reserved: u64,
    size: u64,
}

static BLOCK_DESCRIPTOR: BlockDescriptor = BlockDescriptor {
    reserved: 0,
    size: std::mem::size_of::<EvaluateBlock>() as u64,
};

/// The class for stack blocks.
extern "C" {
    #[link_name = "_NSConcreteStackBlock"]
    static NS_CONCRETE_STACK_BLOCK: *const c_void;
}

/// C function that serves as the block's invoke function.
/// Called by the ObjC runtime with (BOOL success, NSError *error).
unsafe extern "C" fn evaluate_block_invoke(
    block: *mut EvaluateBlock,
    success: i8,
    error: *mut c_void,
) {
    let result = if success != 0 {
        Ok(true)
    } else {
        let code = nserror_code(error);
        Err(map_la_error(code))
    };

    let result_ptr = (*block).result_ptr;
    *result_ptr = Some(result);

    // Signal the semaphore
    dispatch_semaphore_signal((*block).semaphore);
}

/// Create a block suitable for passing to evaluatePolicy:localizedReason:reply:
unsafe fn create_evaluate_block(
    result_ptr: *mut Option<BiometricResult<bool>>,
    semaphore: *mut c_void,
) -> *mut EvaluateBlock {
    let block = Box::into_raw(Box::new(EvaluateBlock {
        isa: &NS_CONCRETE_STACK_BLOCK as *const *const c_void as *const c_void,
        flags: 1 << 25, // BLOCK_HAS_DESCRIPTOR
        reserved: 0,
        invoke: evaluate_block_invoke,
        descriptor: &BLOCK_DESCRIPTOR,
        result_ptr,
        semaphore,
    }));
    block
}

/// Free the block memory.
unsafe fn free_evaluate_block(block: *mut EvaluateBlock) {
    let _ = Box::from_raw(block);
}

// ── GCD (Grand Central Dispatch) FFI ────────────────────────────────

const DISPATCH_TIME_NOW: u64 = 0;

#[link(name = "System", kind = "dylib")]
extern "C" {
    fn dispatch_semaphore_create(value: i64) -> *mut c_void;
    fn dispatch_semaphore_wait(dsema: *mut c_void, timeout: u64) -> i64;
    fn dispatch_semaphore_signal(dsema: *mut c_void) -> i64;
    fn dispatch_time(when: u64, delta: i64) -> u64;
    fn dispatch_release(object: *mut c_void);
}

// ── Error mapping ───────────────────────────────────────────────────

/// Map an LAError code to a BiometricError.
fn map_la_error(code: i64) -> BiometricError {
    match code {
        LA_ERROR_AUTH_FAILED => BiometricError::auth_failed(),
        LA_ERROR_USER_CANCEL => BiometricError::user_cancelled(),
        LA_ERROR_USER_FALLBACK => BiometricError {
            kind: BiometricErrorKind::UserCancelled,
            message: "User chose password fallback".into(),
            detail: None,
        },
        LA_ERROR_SYSTEM_CANCEL => BiometricError::platform("System cancelled authentication"),
        LA_ERROR_PASSCODE_NOT_SET => BiometricError {
            kind: BiometricErrorKind::NotEnrolled,
            message: "System passcode not set".into(),
            detail: None,
        },
        LA_ERROR_BIOMETRY_NOT_AVAILABLE => BiometricError {
            kind: BiometricErrorKind::HardwareUnavailable,
            message: "Biometric hardware not available".into(),
            detail: None,
        },
        LA_ERROR_BIOMETRY_NOT_ENROLLED => BiometricError {
            kind: BiometricErrorKind::NotEnrolled,
            message: "No biometrics enrolled — open System Settings → Touch ID".into(),
            detail: None,
        },
        LA_ERROR_BIOMETRY_LOCKOUT => BiometricError {
            kind: BiometricErrorKind::AuthFailed,
            message: "Biometric locked out — too many failed attempts, enter system password".into(),
            detail: None,
        },
        _ => BiometricError::platform(format!("LAError code {code}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_conversion() {
        assert_eq!(Policy::BiometricOnly.to_la_policy(), 1);
        assert_eq!(Policy::BiometricOrPassword.to_la_policy(), 2);
        assert_eq!(Policy::BiometricOrWatch.to_la_policy(), 4);
    }

    #[test]
    fn la_error_mapping() {
        let err = map_la_error(LA_ERROR_USER_CANCEL);
        assert!(matches!(err.kind, BiometricErrorKind::UserCancelled));

        let err = map_la_error(LA_ERROR_AUTH_FAILED);
        assert!(matches!(err.kind, BiometricErrorKind::AuthFailed));

        let err = map_la_error(LA_ERROR_BIOMETRY_NOT_ENROLLED);
        assert!(matches!(err.kind, BiometricErrorKind::NotEnrolled));

        let err = map_la_error(LA_ERROR_BIOMETRY_NOT_AVAILABLE);
        assert!(matches!(err.kind, BiometricErrorKind::HardwareUnavailable));
    }
}

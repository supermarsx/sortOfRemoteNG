//! Windows Credential Manager + DPAPI back-end.
//!
//! Uses `CredWriteW` / `CredReadW` / `CredDeleteW` from
//! `Win32_Security_Credentials` to store secrets in the Windows
//! Credential Manager.  Secrets are additionally protected by DPAPI
//! (`CryptProtectData` / `CryptUnprotectData`) so they are bound to
//! the current user's Windows login session.

use crate::types::*;

/// Store a secret in Windows Credential Manager (DPAPI-protected).
pub(crate) fn store_secret(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {
    use windows::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };
    use windows::core::HSTRING;
    use windows::Win32::Foundation::FILETIME;

    // DPAPI-protect the secret first
    let protected = dpapi_protect(secret)?;

    let target = format!("{service}/{account}");
    let target_h = HSTRING::from(&target);

    let mut cred = CREDENTIALW {
        Flags: Default::default(),
        Type: CRED_TYPE_GENERIC,
        TargetName: windows::core::PWSTR(target_h.as_ptr() as *mut u16),
        Comment: windows::core::PWSTR::null(),
        LastWritten: FILETIME::default(),
        CredentialBlobSize: protected.len() as u32,
        CredentialBlob: protected.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: std::ptr::null_mut(),
        TargetAlias: windows::core::PWSTR::null(),
        UserName: windows::core::PWSTR::null(),
    };

    unsafe {
        CredWriteW(&mut cred, 0)
            .map_err(|e| VaultError::platform(format!("CredWriteW failed: {e}")))?;
    }

    Ok(())
}

/// Read a secret from Windows Credential Manager (DPAPI-unprotected).
pub(crate) fn read_secret(service: &str, account: &str) -> VaultResult<Vec<u8>> {
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };
    use windows::core::HSTRING;

    let target = format!("{service}/{account}");
    let target_h = HSTRING::from(&target);

    unsafe {
        let mut pcred: *mut CREDENTIALW = std::ptr::null_mut();
        CredReadW(
            windows::core::PCWSTR(target_h.as_ptr()),
            CRED_TYPE_GENERIC,
            Some(0),
            &mut pcred,
        )
        .map_err(|e| VaultError::not_found(format!("CredReadW failed: {e}")))?;

        let cred = &*pcred;
        let blob = std::slice::from_raw_parts(
            cred.CredentialBlob,
            cred.CredentialBlobSize as usize,
        );
        let protected = blob.to_vec();
        CredFree(pcred as *const _ as *const std::ffi::c_void);

        // DPAPI-unprotect
        dpapi_unprotect(&protected)
    }
}

/// Delete a secret from Windows Credential Manager.
pub(crate) fn delete_secret(service: &str, account: &str) -> VaultResult<()> {
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    use windows::core::HSTRING;

    let target = format!("{service}/{account}");
    let target_h = HSTRING::from(&target);

    unsafe {
        CredDeleteW(
            windows::core::PCWSTR(target_h.as_ptr()),
            CRED_TYPE_GENERIC,
            Some(0),
        )
        .map_err(|e| VaultError::not_found(format!("CredDeleteW failed: {e}")))?;
    }

    Ok(())
}

pub(crate) fn is_available() -> bool {
    // Credential Manager is always available on Windows Vista+
    true
}

pub(crate) fn backend_name() -> &'static str {
    "Windows Credential Manager + DPAPI"
}

// ── DPAPI helpers ───────────────────────────────────────────────────

/// Protect data with DPAPI (bound to current user).
fn dpapi_protect(plaintext: &[u8]) -> VaultResult<Vec<u8>> {
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPT_INTEGER_BLOB,
    };
    use windows::Win32::Foundation::LocalFree;

    let mut data_in = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        CryptProtectData(
            &mut data_in,
            None,           // description
            None,           // optional entropy
            None,           // reserved
            None,           // prompt struct
            0,              // flags
            &mut data_out,
        )
        .map_err(|e| VaultError::crypto(format!("CryptProtectData failed: {e}")))?;

        let result =
            std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();

        // Free the buffer allocated by DPAPI
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            data_out.pbData as *mut _,
        )));

        Ok(result)
    }
}

/// Unprotect DPAPI-protected data.
fn dpapi_unprotect(protected: &[u8]) -> VaultResult<Vec<u8>> {
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPT_INTEGER_BLOB,
    };
    use windows::Win32::Foundation::LocalFree;

    let mut data_in = CRYPT_INTEGER_BLOB {
        cbData: protected.len() as u32,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        CryptUnprotectData(
            &mut data_in,
            None,           // description
            None,           // optional entropy
            None,           // reserved
            None,           // prompt struct
            0,              // flags
            &mut data_out,
        )
        .map_err(|e| VaultError::crypto(format!("CryptUnprotectData failed: {e}")))?;

        let result =
            std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();

        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            data_out.pbData as *mut _,
        )));

        Ok(result)
    }
}

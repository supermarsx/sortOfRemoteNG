#[cfg(target_os = "windows")]
pub fn store_secret(service: &str, account: &str, secret: &[u8]) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    let protected = dpapi_protect(secret)?;
    let target = format!("{service}/{account}");
    let target_h = HSTRING::from(&target);

    let cred = CREDENTIALW {
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
        CredWriteW(&cred, 0).map_err(|e| format!("CredWriteW failed: {e}"))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn read_secret(service: &str, account: &str) -> Result<Vec<u8>, String> {
    use windows::core::HSTRING;
    use windows::Win32::Security::Credentials::{
        CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
    };

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
        .map_err(|e| format!("CredReadW failed: {e}"))?;

        let cred = &*pcred;
        let blob =
            std::slice::from_raw_parts(cred.CredentialBlob, cred.CredentialBlobSize as usize);
        let protected = blob.to_vec();
        CredFree(pcred as *const _ as *const std::ffi::c_void);

        dpapi_unprotect(&protected)
    }
}

#[cfg(target_os = "windows")]
pub fn delete_secret(service: &str, account: &str) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

    let target = format!("{service}/{account}");
    let target_h = HSTRING::from(&target);

    unsafe {
        CredDeleteW(
            windows::core::PCWSTR(target_h.as_ptr()),
            CRED_TYPE_GENERIC,
            Some(0),
        )
        .map_err(|e| format!("CredDeleteW failed: {e}"))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn is_available() -> bool {
    true
}

#[cfg(target_os = "windows")]
pub fn backend_name() -> &'static str {
    "Windows Credential Manager + DPAPI"
}

/// Count stored credentials whose target name starts with `{service}/`.
#[cfg(target_os = "windows")]
pub fn count_entries(service: &str) -> Result<usize, String> {
    use windows::core::HSTRING;
    use windows::Win32::Security::Credentials::{
        CredEnumerateW, CredFree, CREDENTIALW, CRED_ENUMERATE_FLAGS,
    };

    let filter = format!("{service}/*");
    let filter_h = HSTRING::from(&filter);

    unsafe {
        let mut count: u32 = 0;
        let mut pcreds: *mut *mut CREDENTIALW = std::ptr::null_mut();

        let result = CredEnumerateW(
            windows::core::PCWSTR(filter_h.as_ptr()),
            Some(CRED_ENUMERATE_FLAGS(0)),
            &mut count,
            &mut pcreds,
        );

        match result {
            Ok(()) => {
                CredFree(pcreds as *const _ as *const std::ffi::c_void);
                Ok(count as usize)
            }
            Err(e) => {
                // ERROR_NOT_FOUND (1168) means no matching credentials — that's 0 entries
                let code = e.code().0 as u32;
                if code == 0x8007_0490 || code == 1168 {
                    Ok(0)
                } else {
                    Err(format!("CredEnumerateW failed: {e}"))
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn dpapi_protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};

    let data_in = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        CryptProtectData(&data_in, None, None, None, None, 0, &mut data_out)
            .map_err(|e| format!("CryptProtectData failed: {e}"))?;

        let result = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();

        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            data_out.pbData as *mut _,
        )));

        Ok(result)
    }
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(protected: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    let data_in = CRYPT_INTEGER_BLOB {
        cbData: protected.len() as u32,
        pbData: protected.as_ptr() as *mut u8,
    };
    let mut data_out = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        CryptUnprotectData(&data_in, None, None, None, None, 0, &mut data_out)
            .map_err(|e| format!("CryptUnprotectData failed: {e}"))?;

        let result = std::slice::from_raw_parts(data_out.pbData, data_out.cbData as usize).to_vec();

        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            data_out.pbData as *mut _,
        )));

        Ok(result)
    }
}

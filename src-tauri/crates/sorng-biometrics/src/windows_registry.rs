pub(crate) fn machine_guid() -> Option<String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
        REG_VALUE_TYPE,
    };

    unsafe {
        let key_path: Vec<u16> = "SOFTWARE\\Microsoft\\Cryptography"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let value_name: Vec<u16> = "MachineGuid"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut hkey: HKEY = std::ptr::null_mut();

        let result = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            key_path.as_ptr(),
            0,
            KEY_READ,
            &mut hkey,
        );
        if result != 0 {
            return None;
        }

        let mut buffer = [0u16; 256];
        let mut size = (buffer.len() * 2) as u32;
        let mut value_type: REG_VALUE_TYPE = 0;

        let result = RegQueryValueExW(
            hkey,
            value_name.as_ptr(),
            std::ptr::null(),
            &mut value_type,
            buffer.as_mut_ptr() as *mut u8,
            &mut size,
        );

        let _ = RegCloseKey(hkey);

        if result == 0 {
            let len = (size as usize / 2).saturating_sub(1);
            Some(String::from_utf16_lossy(&buffer[..len]))
        } else {
            None
        }
    }
}

pub(crate) fn has_wbf_sensor(sensor_type: &str) -> bool {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
    };

    let path = format!(
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WinBio\\Sensor Types\\{sensor_type}"
    );
    let key_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        let result = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            key_path.as_ptr(),
            0,
            KEY_READ,
            &mut hkey,
        );
        if result == 0 {
            let _ = RegCloseKey(hkey);
            true
        } else {
            false
        }
    }
}

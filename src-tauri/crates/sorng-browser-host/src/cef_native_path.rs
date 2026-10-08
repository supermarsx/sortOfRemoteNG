//! Native filesystem paths at the CEF string boundary. Std-only for rustc tests.

use std::path::Path;

pub(crate) fn text(path: &Path, file: bool) -> Option<String> {
    if !path.is_absolute() || !(if file { path.is_file() } else { path.is_dir() }) {
        return None;
    }
    let value = path.to_str().filter(|value| !value.contains('\0'))?;
    #[cfg(windows)]
    {
        windows_text(value)
    }
    #[cfg(not(windows))]
    {
        Some(value.to_owned())
    }
}

// Chromium appends forward-slash suffixes such as /LOCK. Win32 rejects those
// under a verbatim prefix, so admit only paths representable in ordinary DOS/UNC
// syntax without changing their target. Do not canonicalize or trim components:
// that could hide aliases before validation. Non-Windows strings stay untouched.
#[cfg(any(windows, test))]
fn windows_text(value: &str) -> Option<String> {
    fn disk_root(value: &str) -> bool {
        let bytes = value.as_bytes();
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\'
    }

    let ordinary = if let Some(rest) = value.strip_prefix(r"\\?\") {
        // '/' is NOT a separator in the verbatim namespace. Repairing such an
        // input would reinterpret its target; only ordinary paths can mix them.
        if rest.contains('/') {
            return None;
        }
        if let Some(unc) = rest.strip_prefix(r"UNC\") {
            format!(r"\\{unc}")
        } else if disk_root(rest) {
            rest.to_owned()
        } else {
            return None;
        }
    } else {
        value.replace('/', r"\")
    };

    let tail = if disk_root(&ordinary) {
        &ordinary[3..]
    } else if let Some(unc) = ordinary.strip_prefix(r"\\") {
        let mut parts = unc.splitn(3, '\\');
        if !ordinary_component(parts.next()?) || !ordinary_component(parts.next()?) {
            return None;
        }
        parts.next().unwrap_or("")
    } else {
        return None;
    };
    // Allow a root or one trailing separator, but never collapse empty, dot or
    // parent components. Inspect raw components: Path::components hides some.
    if !tail.is_empty()
        && !tail
            .strip_suffix('\\')
            .unwrap_or(tail)
            .split('\\')
            .all(ordinary_component)
    {
        return None;
    }
    Some(ordinary)
}

#[cfg(any(windows, test))]
fn ordinary_component(value: &str) -> bool {
    if value.is_empty()
        || value.ends_with(['.', ' '])
        || value.chars().any(|c| c < ' ' || "<>:\"/\\|?*".contains(c))
    {
        return false;
    }
    // Devices remain reserved with extensions (including spaces before the
    // extension), case variants, and Windows' superscript port digits.
    // https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
    let stem = value
        .split('.')
        .next()
        .unwrap()
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" | "CLOCK$"
    ) {
        return false;
    }
    !stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"))
        .is_some_and(|port| {
            matches!(
                port,
                "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_and_verbatim_dos_and_unc_keep_their_target() {
        for ordinary in [
            r"C:\",
            r"c:\Program Files\CEF\",
            r"D:\café\缓存",
            r"\\server\share",
            r"\\server\share\",
            r"\\server\share\CEF\cache",
        ] {
            assert_eq!(windows_text(ordinary).as_deref(), Some(ordinary));
            let verbatim = match ordinary.strip_prefix(r"\\") {
                Some(unc) => format!(r"\\?\UNC\{unc}"),
                None => format!(r"\\?\{ordinary}"),
            };
            assert_eq!(windows_text(&verbatim).as_deref(), Some(ordinary));
        }
    }

    #[test]
    fn ordinary_mixed_separators_and_chromium_suffixes_are_supported() {
        for (input, expected) in [
            (r"C:/CEF\cache/LOCK", r"C:\CEF\cache\LOCK"),
            (r"//server/share\CEF/cache", r"\\server\share\CEF\cache"),
            (r"\\server/share\CEF/", r"\\server\share\CEF\"),
        ] {
            assert_eq!(windows_text(input).as_deref(), Some(expected));
        }
        let root = windows_text(r"\\?\C:\CEF\cache").unwrap();
        assert_eq!(
            windows_text(&format!("{root}/LOCK")).as_deref(),
            Some(r"C:\CEF\cache\LOCK")
        );
    }

    #[test]
    fn relative_incomplete_and_device_namespaces_are_rejected() {
        for input in [
            "",
            "cache",
            "C:",
            r"C:cache",
            r"\cache",
            "/cache",
            r"1:\cache",
            r"\\server",
            r"\\server\",
            r"\\\share\cache",
            r"\\server\\cache",
            r"\\.\C:\cache",
            r"//./C:/cache",
            r"\??\C:\cache",
            r"\\??\C:\cache",
            r"\\?\Volume{1234}\cache",
            r"\\?\GLOBALROOT\Device\HarddiskVolume1\cache",
            r"\\?\pipe\cache",
            r"\\?\C:cache",
            r"\\?\UNC\server",
            r"\\?\UNC\server\",
            r"\\?\unc\server\share",
            r"//?/C:/cache",
            r"\\?\C:/cache",
            r"\\?\C:\cache/child",
            r"\\?\UNC\server\share/child",
        ] {
            assert_eq!(windows_text(input), None, "{input:?}");
        }
    }

    #[test]
    fn aliases_and_invalid_components_are_rejected_in_every_position() {
        for component in [
            ".",
            "..",
            "cache.",
            "cache ",
            "cache:stream",
            "cache:",
            "bad\0name",
            "bad\u{1f}name",
            "bad<name",
            "bad>name",
            "bad\"name",
            "bad|name",
            "bad?name",
            "bad*name",
            "CON",
            "nul.txt",
            "NuL .txt",
            "PRN",
            "aux.tar.gz",
            "CONIN$",
            "CONOUT$",
            "CLOCK$",
            "COM0",
            "com1.txt",
            "COM9",
            "LPT0",
            "lpt1",
            "LPT9.log",
            "COM¹",
            "COM².txt",
            "LPT³",
        ] {
            for input in [
                format!(r"C:\{component}"),
                format!(r"C:\{component}\child"),
                format!(r"\\?\C:\{component}\child"),
                format!(r"\\server\share\{component}"),
                format!(r"\\?\UNC\server\share\{component}"),
                format!(r"\\{component}\share"),
                format!(r"\\server\{component}"),
            ] {
                assert_eq!(windows_text(&input), None, "{input:?}");
            }
        }
        for input in [r"C:\cache\\child", r"\\?\C:\cache\\child", r"C:\cache\\"] {
            assert_eq!(windows_text(input), None, "{input:?}");
        }
    }

    #[test]
    fn similar_but_ordinary_names_and_long_paths_are_not_rewritten() {
        for component in [
            ".cache",
            "cache..ok",
            "Console",
            "nulled",
            "COM10",
            "LPT10",
            "auxiliary",
            "with space",
        ] {
            let ordinary = format!(r"C:\{component}");
            assert_eq!(windows_text(&ordinary).as_deref(), Some(ordinary.as_str()));
        }
        let ordinary = format!(r"C:\{}leaf", "segment\\".repeat(40));
        assert_eq!(
            windows_text(&format!(r"\\?\{ordinary}")).as_deref(),
            Some(ordinary.as_str())
        );
    }

    #[test]
    fn boundary_preserves_absolute_existence_kind_utf8_and_nul_checks() {
        let executable = std::env::current_exe().unwrap();
        let directory = executable.parent().unwrap();
        assert!(text(&executable, true).is_some());
        assert!(text(directory, false).is_some());
        assert_eq!(text(&executable, false), None);
        assert_eq!(text(directory, true), None);
        assert_eq!(text(Path::new("relative"), false), None);
        assert_eq!(text(&directory.join("absent-cef-path\0"), false), None);
        assert_eq!(text(&executable.join("missing"), true), None);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStringExt;
            let invalid = std::ffi::OsString::from_wide(&[b'C' as u16, 58, 92, 0xd800]);
            assert_eq!(text(Path::new(&invalid), false), None);
            let canonical = directory.canonicalize().unwrap();
            assert!(canonical.to_str().unwrap().starts_with(r"\\?\"));
            let normalized = text(&canonical, false).unwrap();
            assert!(!normalized.starts_with(r"\\?\"));
            assert_eq!(Path::new(&normalized).canonicalize().unwrap(), canonical);
        }
    }

    #[cfg(unix)]
    #[test]
    fn non_windows_preserves_native_spelling_even_for_windows_special_names() {
        use std::os::unix::ffi::OsStringExt;
        let root = std::env::temp_dir().join(format!("cef-native-path-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let unusual = root.join(r"CON\cache:stream. ");
        std::fs::create_dir(&unusual).unwrap();
        assert_eq!(text(&unusual, false).as_deref(), unusual.to_str());
        let dotted = root.join("./CON\\cache:stream. ");
        assert_eq!(text(&dotted, false).as_deref(), dotted.to_str());
        let invalid = root.join(std::ffi::OsString::from_vec(vec![0xff]));
        std::fs::create_dir(&invalid).unwrap();
        assert_eq!(text(&invalid, false), None);
        std::fs::remove_dir(&invalid).unwrap();
        std::fs::remove_dir(&unusual).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn existing_verbatim_only_names_are_rejected_without_redirecting_to_aliases() {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        let root = std::env::temp_dir().join(format!("cef-native-path-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let ordinary = root.join("cache");
        std::fs::create_dir(&ordinary).unwrap();
        for name in [
            OsString::from("cache."),
            OsString::from("cache "),
            OsString::from("NUL"),
            OsString::from("COM¹"),
            OsString::from_wide(&[0xd800]),
        ] {
            let native = root.join(name);
            std::fs::create_dir(&native).unwrap();
            assert!(native.is_dir());
            assert_eq!(text(&native, false), None, "{native:?}");
            std::fs::remove_dir(&native).unwrap();
        }
        assert!(text(&ordinary, false).is_some());
        std::fs::remove_dir(&ordinary).unwrap();
        std::fs::remove_dir(&root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn win32_accepts_chromium_slash_suffix_after_boundary_conversion() {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetFileAttributesW(path: *const u16) -> u32;
        }
        fn attributes(path: &str) -> Result<u32, i32> {
            let wide: Vec<_> = path.encode_utf16().chain(Some(0)).collect();
            let value = unsafe { GetFileAttributesW(wide.as_ptr()) };
            if value == u32::MAX {
                Err(std::io::Error::last_os_error().raw_os_error().unwrap())
            } else {
                Ok(value)
            }
        }
        let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
        let root = executable.parent().unwrap();
        let suffix = executable.file_name().unwrap().to_str().unwrap();
        assert_eq!(
            attributes(&format!("{}/{suffix}", root.display())),
            Err(123)
        );
        let ordinary = text(root, false).unwrap();
        assert_eq!(
            attributes(&format!("{ordinary}/{suffix}")),
            attributes(executable.to_str().unwrap())
        );
        // Same spelling as Chromium's lock probe; a missing LOCK must be a
        // normal file-not-found result, never ERROR_INVALID_NAME (123).
        assert_eq!(
            attributes(&format!("{ordinary}/LOCK")),
            attributes(root.join("LOCK").to_str().unwrap())
        );
    }
}

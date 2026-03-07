//! Locale and timezone detection.

use crate::client;
use crate::error::OsDetectError;
use crate::types::*;

/// Detect system locale (LANG, LC_ALL).
pub async fn detect_locale(host: &OsDetectHost) -> Result<(Option<String>, Option<String>), OsDetectError> {
    // Try localectl
    let localectl = client::exec_soft(host, "localectl", &["status"]).await;
    if !localectl.is_empty() {
        let mut lang = None;
        for line in localectl.lines() {
            let line = line.trim();
            if let Some(val) = line.strip_prefix("System Locale:") {
                // "System Locale: LANG=en_US.UTF-8"
                let val = val.trim();
                if let Some(l) = val.strip_prefix("LANG=") {
                    lang = Some(l.to_string());
                } else {
                    lang = Some(val.to_string());
                }
            }
        }
        if lang.is_some() {
            return Ok((lang, None));
        }
    }

    // Fallback: locale command
    let locale_output = client::exec_soft(host, "locale", &[]).await;
    let mut lang = None;
    let mut lc_all = None;
    for line in locale_output.lines() {
        if let Some(val) = line.strip_prefix("LANG=") {
            lang = Some(val.trim_matches('"').to_string());
        } else if let Some(val) = line.strip_prefix("LC_ALL=") {
            let v = val.trim_matches('"').to_string();
            if !v.is_empty() { lc_all = Some(v); }
        }
    }

    // env var fallback
    if lang.is_none() {
        let env_lang = client::shell_exec(host, "echo $LANG").await;
        if !env_lang.trim().is_empty() {
            lang = Some(env_lang.trim().to_string());
        }
    }

    Ok((lang, lc_all))
}

/// Detect system timezone.
pub async fn detect_timezone(host: &OsDetectHost) -> Result<Option<String>, OsDetectError> {
    // timedatectl (systemd)
    let timedatectl = client::exec_soft(host, "timedatectl", &["show", "--property=Timezone", "--value"]).await;
    if !timedatectl.is_empty() {
        return Ok(Some(timedatectl.trim().to_string()));
    }

    // timedatectl status (older systemd)
    let timedatectl_status = client::exec_soft(host, "timedatectl", &["status"]).await;
    for line in timedatectl_status.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("Time zone:") {
            // "Time zone: America/New_York (EST, -0500)"
            let tz = val.trim().split_whitespace().next().unwrap_or("");
            if !tz.is_empty() {
                return Ok(Some(tz.to_string()));
            }
        }
    }

    // /etc/timezone (Debian)
    let etc_tz = client::shell_exec(host, "cat /etc/timezone 2>/dev/null").await;
    if !etc_tz.is_empty() {
        return Ok(Some(etc_tz.trim().to_string()));
    }

    // /etc/localtime symlink
    let localtime = client::shell_exec(host, "readlink -f /etc/localtime 2>/dev/null").await;
    if localtime.contains("zoneinfo/") {
        let tz = localtime.trim().split("zoneinfo/").last().unwrap_or("");
        if !tz.is_empty() {
            return Ok(Some(tz.to_string()));
        }
    }

    // macOS
    let mac_tz = client::shell_exec(host, "systemsetup -gettimezone 2>/dev/null").await;
    if mac_tz.contains("Time Zone:") {
        let tz = mac_tz.split("Time Zone:").last().unwrap_or("").trim();
        if !tz.is_empty() {
            return Ok(Some(tz.to_string()));
        }
    }

    Ok(None)
}

/// Detect keyboard/console keymap.
pub async fn detect_keymap(host: &OsDetectHost) -> Result<Option<String>, OsDetectError> {
    // localectl
    let localectl = client::exec_soft(host, "localectl", &["status"]).await;
    for line in localectl.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("VC Keymap:") {
            let km = val.trim();
            if !km.is_empty() && km != "(unset)" && km != "n/a" {
                return Ok(Some(km.to_string()));
            }
        }
        if let Some(val) = line.strip_prefix("X11 Layout:") {
            let km = val.trim();
            if !km.is_empty() && km != "(unset)" {
                return Ok(Some(km.to_string()));
            }
        }
    }

    // /etc/vconsole.conf
    let vconsole = client::shell_exec(host, "cat /etc/vconsole.conf 2>/dev/null").await;
    for line in vconsole.lines() {
        if let Some(val) = line.strip_prefix("KEYMAP=") {
            return Ok(Some(val.trim_matches('"').to_string()));
        }
    }

    // /etc/default/keyboard (Debian)
    let kbd = client::shell_exec(host, "cat /etc/default/keyboard 2>/dev/null").await;
    for line in kbd.lines() {
        if let Some(val) = line.strip_prefix("XKBLAYOUT=") {
            return Ok(Some(val.trim_matches('"').to_string()));
        }
    }

    Ok(None)
}

/// Build a full SystemLocale struct.
pub async fn detect_system_locale(host: &OsDetectHost) -> Result<SystemLocale, OsDetectError> {
    let (lang, lc_all) = detect_locale(host).await.unwrap_or((None, None));
    let keymap = detect_keymap(host).await.unwrap_or(None);
    let timezone = detect_timezone(host).await.unwrap_or(None);

    Ok(SystemLocale {
        lang,
        lc_all,
        keymap,
        timezone,
    })
}

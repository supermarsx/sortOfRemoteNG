//! localectl — locale, keymap, X11 layout management.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;
use std::collections::HashMap;

/// Get locale and keymap info.
pub async fn get_info(host: &SystemdHost) -> Result<LocaleInfo, SystemdError> {
    let stdout = client::exec_ok(host, "localectl", &["status", "--no-pager"]).await?;
    Ok(parse_localectl(&stdout))
}

/// Set system locale.
pub async fn set_locale(host: &SystemdHost, locale_vars: &[&str]) -> Result<(), SystemdError> {
    let mut args = vec!["set-locale"];
    args.extend_from_slice(locale_vars);
    client::exec_ok(host, "localectl", &args).await?;
    Ok(())
}

/// Set virtual console keymap.
pub async fn set_keymap(host: &SystemdHost, keymap: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "localectl", &["set-keymap", keymap]).await?;
    Ok(())
}

/// Set X11 keyboard layout.
pub async fn set_x11_keymap(
    host: &SystemdHost,
    layout: &str,
    model: Option<&str>,
    variant: Option<&str>,
) -> Result<(), SystemdError> {
    let mut args = vec!["set-x11-keymap", layout];
    if let Some(m) = model {
        args.push(m);
    }
    if let Some(v) = variant {
        args.push(v);
    }
    client::exec_ok(host, "localectl", &args).await?;
    Ok(())
}

/// List available locales.
pub async fn list_locales(host: &SystemdHost) -> Result<Vec<String>, SystemdError> {
    let stdout = client::exec_ok(host, "localectl", &["list-locales", "--no-pager"]).await?;
    Ok(stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

fn parse_localectl(output: &str) -> LocaleInfo {
    let mut locale = HashMap::new();
    let mut vc_keymap = None;
    let mut x11_layout = None;
    let mut x11_model = None;
    let mut x11_variant = None;
    let mut x11_options = None;

    for line in output.lines() {
        let line = line.trim();
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim();
            let val = val.trim().to_string();
            if key.starts_with("System Locale") || key.starts_with("LANG") || key.contains('=') {
                // Parse locale vars
                for part in val.split_whitespace() {
                    if let Some((k, v)) = part.split_once('=') {
                        locale.insert(k.to_string(), v.to_string());
                    }
                }
            } else if key == "VC Keymap" {
                vc_keymap = Some(val);
            } else if key == "X11 Layout" {
                x11_layout = Some(val);
            } else if key == "X11 Model" {
                x11_model = Some(val);
            } else if key == "X11 Variant" {
                x11_variant = Some(val);
            } else if key == "X11 Options" {
                x11_options = Some(val);
            }
        }
    }

    LocaleInfo {
        system_locale: locale,
        vc_keymap,
        x11_layout,
        x11_model,
        x11_variant,
        x11_options,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}

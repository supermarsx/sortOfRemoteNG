//! Windows RAS (Remote Access Service) helper for VPN protocols.
//! Provides shared functions for PPTP, L2TP, IKEv2, and SSTP connections.

#[cfg(windows)]
use crate::{platform, validation};
#[cfg(windows)]
use std::mem::size_of;
#[cfg(windows)]
use std::ptr::{null, null_mut};
#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::Rras::{RasDialW, RasHangUpW, RASDIALPARAMSW};
#[cfg(windows)]
use zeroize::Zeroize;

#[cfg(windows)]
const CREATE_ENTRY_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; Add-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -ServerAddress $env:SORNG_VPN_SERVER -TunnelType $env:SORNG_VPN_TUNNEL_TYPE -Force -RememberCredential";
#[cfg(windows)]
const REMOVE_ENTRY_SCRIPT: &str =
    "$ErrorActionPreference = 'Stop'; Remove-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -Force";
#[cfg(windows)]
const GET_ENTRY_ADDRESS_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; (Get-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME).ServerAddress";
#[cfg(windows)]
const SET_EAP_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; Set-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -AuthenticationMethod $env:SORNG_VPN_AUTH_METHOD -Force";
#[cfg(windows)]
const CREATE_L2TP_ENTRY_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; Add-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -ServerAddress $env:SORNG_VPN_SERVER -TunnelType L2tp -L2tpPsk $env:SORNG_VPN_SHARED_SECRET -Force -RememberCredential";
#[cfg(windows)]
const SET_IPSEC_POLICY_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; Set-VpnConnectionIPsecConfiguration -ConnectionName $env:SORNG_VPN_ENTRY_NAME -AuthenticationTransformConstants SHA256128 -CipherTransformConstants AES256 -DHGroup Group14 -EncryptionMethod AES256 -IntegrityCheckMethod SHA256 -PfsGroup None -Force";

#[cfg(windows)]
struct PowerShellInvocation {
    script: &'static str,
    environment: Vec<(&'static str, String)>,
}

#[cfg(windows)]
async fn run_powershell(
    invocation: PowerShellInvocation,
    operation: &str,
) -> Result<std::process::Output, String> {
    let binary = platform::resolve_binary("powershell")?;
    let mut command = tokio::process::Command::new(binary);
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        invocation.script,
    ]);
    for (key, value) in invocation.environment {
        command.env(key, value);
    }
    let output = command
        .output()
        .await
        .map_err(|error| format!("PowerShell {operation} error: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "PowerShell {operation} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output)
}

#[cfg(windows)]
fn create_entry_invocation(
    entry_name: &str,
    server: &str,
    tunnel_type: &str,
) -> Result<PowerShellInvocation, String> {
    validation::validate_hostname(server)?;
    let tunnel_type = match tunnel_type {
        "Pptp" | "L2tp" | "Ikev2" | "Sstp" => tunnel_type,
        _ => return Err("Unsupported Windows VPN tunnel type".to_string()),
    };
    Ok(PowerShellInvocation {
        script: CREATE_ENTRY_SCRIPT,
        environment: vec![
            ("SORNG_VPN_ENTRY_NAME", entry_name.to_string()),
            ("SORNG_VPN_SERVER", server.to_string()),
            ("SORNG_VPN_TUNNEL_TYPE", tunnel_type.to_string()),
        ],
    })
}

/// Create a Windows VPN connection entry via a static PowerShell script.
/// User-controlled values are carried only in the child environment and are
/// never interpolated into PowerShell source or command-line arguments.
#[cfg(windows)]
pub async fn create_ras_entry(
    entry_name: &str,
    server: &str,
    tunnel_type: &str,
) -> Result<(), String> {
    run_powershell(
        create_entry_invocation(entry_name, server, tunnel_type)?,
        "VPN entry creation",
    )
    .await?;
    Ok(())
}

/// Create an L2TP/IPsec entry with its pre-shared key through the supported
/// `Add-VpnConnection -L2tpPsk` parameter. The PSK remains environment-bound,
/// and the follow-up cmdlet applies only the cryptographic policy.
#[cfg(windows)]
pub async fn create_l2tp_ras_entry(
    entry_name: &str,
    server: &str,
    psk: Option<&str>,
) -> Result<(), String> {
    validation::validate_hostname(server)?;
    let Some(psk) = psk.filter(|value| !value.is_empty()) else {
        return create_ras_entry(entry_name, server, "L2tp").await;
    };
    run_powershell(
        PowerShellInvocation {
            script: CREATE_L2TP_ENTRY_SCRIPT,
            environment: vec![
                ("SORNG_VPN_ENTRY_NAME", entry_name.to_string()),
                ("SORNG_VPN_SERVER", server.to_string()),
                ("SORNG_VPN_SHARED_SECRET", psk.to_string()),
            ],
        },
        "L2TP/IPsec entry creation",
    )
    .await?;

    if let Err(error) = run_powershell(
        PowerShellInvocation {
            script: SET_IPSEC_POLICY_SCRIPT,
            environment: vec![("SORNG_VPN_ENTRY_NAME", entry_name.to_string())],
        },
        "L2TP/IPsec policy configuration",
    )
    .await
    {
        let _ = remove_ras_entry(entry_name).await;
        return Err(error);
    }
    Ok(())
}

/// Configure the supported EAP mode without placing the mode or entry name in
/// executable PowerShell source.
#[cfg(windows)]
pub async fn configure_ras_eap(entry_name: &str, eap_method: &str) -> Result<(), String> {
    let authentication_method = match eap_method {
        "mschapv2" => "MSChapv2",
        "tls" | "peap" => "Eap",
        _ => return Err("Unsupported IKEv2 EAP method".to_string()),
    };
    run_powershell(
        PowerShellInvocation {
            script: SET_EAP_SCRIPT,
            environment: vec![
                ("SORNG_VPN_ENTRY_NAME", entry_name.to_string()),
                ("SORNG_VPN_AUTH_METHOD", authentication_method.to_string()),
            ],
        },
        "VPN authentication configuration",
    )
    .await?;
    Ok(())
}

/// Connect a Windows VPN entry through the native RAS API. This avoids
/// exposing the username and password in a `rasdial` process argument list.
#[cfg(windows)]
pub async fn rasdial_connect(
    entry_name: &str,
    username: &str,
    password: &str,
) -> Result<(), String> {
    let entry_name = entry_name.to_string();
    let username = username.to_string();
    let password = password.to_string();
    tokio::task::spawn_blocking(move || rasdial_connect_blocking(&entry_name, &username, &password))
        .await
        .map_err(|error| format!("Windows RAS connection task failed: {error}"))?
}

#[cfg(windows)]
fn rasdial_connect_blocking(
    entry_name: &str,
    username: &str,
    password: &str,
) -> Result<(), String> {
    let mut entry = encode_wide_field::<257>(entry_name, "VPN entry name")?;
    let mut user = encode_wide_field::<257>(username, "VPN username")?;
    let mut secret = encode_wide_field::<257>(password, "VPN password")?;
    let mut parameters = RASDIALPARAMSW {
        dwSize: size_of::<RASDIALPARAMSW>() as u32,
        szEntryName: entry,
        szPhoneNumber: [0; 129],
        szCallbackNumber: [0; 129],
        szUserName: user,
        szPassword: secret,
        szDomain: [0; 16],
        dwSubEntry: 0,
        dwCallbackId: 0,
        dwIfIndex: 0,
        szEncPassword: null_mut(),
    };
    let mut connection = null_mut();
    // SAFETY: all pointers reference initialized storage for the duration of
    // the synchronous call, and callback parameters are intentionally null.
    let result = unsafe {
        RasDialW(
            null(),
            null(),
            std::ptr::addr_of!(parameters),
            0,
            null(),
            &mut connection,
        )
    };
    entry.zeroize();
    user.zeroize();
    secret.zeroize();
    // RASDIALPARAMSW is packed on 64-bit Windows, so wipe it through a raw
    // pointer instead of taking references to its individual fields.
    unsafe { std::ptr::write_bytes(std::ptr::addr_of_mut!(parameters), 0, 1) };

    if result != 0 {
        if !connection.is_null() {
            // SAFETY: a non-null handle came directly from RasDialW.
            unsafe { RasHangUpW(connection) };
        }
        return Err(format!("Windows RAS connection failed with error {result}"));
    }
    Ok(())
}

#[cfg(windows)]
fn encode_wide_field<const N: usize>(value: &str, label: &str) -> Result<[u16; N], String> {
    if value.contains('\0') {
        return Err(format!("{label} must not contain null characters"));
    }
    let encoded: Vec<u16> = value.encode_utf16().collect();
    if encoded.len() >= N {
        return Err(format!("{label} is too long"));
    }
    let mut result = [0; N];
    result[..encoded.len()].copy_from_slice(&encoded);
    Ok(result)
}

/// Disconnect a Windows VPN entry. The entry name is passed as one native
/// process argument, not interpreted by a shell.
#[cfg(windows)]
pub async fn rasdial_disconnect(entry_name: &str) -> Result<(), String> {
    let binary = platform::resolve_binary("rasdial")?;
    let output = tokio::process::Command::new(binary)
        .args([entry_name, "/disconnect"])
        .output()
        .await
        .map_err(|error| format!("rasdial disconnect error: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "rasdial disconnect failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

/// Remove a Windows VPN connection entry.
#[cfg(windows)]
pub async fn remove_ras_entry(entry_name: &str) -> Result<(), String> {
    let result = run_powershell(
        PowerShellInvocation {
            script: REMOVE_ENTRY_SCRIPT,
            environment: vec![("SORNG_VPN_ENTRY_NAME", entry_name.to_string())],
        },
        "VPN entry removal",
    )
    .await;
    if let Err(error) = result {
        log::warn!("Failed to remove VPN entry: {error}");
    }
    Ok(())
}

/// Get the server address of a connected Windows VPN entry.
#[cfg(windows)]
pub async fn get_vpn_ip(entry_name: &str) -> Result<Option<String>, String> {
    let output = run_powershell(
        PowerShellInvocation {
            script: GET_ENTRY_ADDRESS_SCRIPT,
            environment: vec![("SORNG_VPN_ENTRY_NAME", entry_name.to_string())],
        },
        "VPN address query",
    )
    .await?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok((!stdout.is_empty()).then_some(stdout))
}

// Linux/macOS stubs (these protocols primarily target Windows).
#[cfg(not(windows))]
pub async fn create_ras_entry(_: &str, _: &str, _: &str) -> Result<(), String> {
    Err("RAS API is Windows-only. Use protocol-specific Linux tools.".to_string())
}
#[cfg(not(windows))]
pub async fn create_l2tp_ras_entry(_: &str, _: &str, _: Option<&str>) -> Result<(), String> {
    Err("RAS API is Windows-only".to_string())
}
#[cfg(not(windows))]
pub async fn configure_ras_eap(_: &str, _: &str) -> Result<(), String> {
    Err("RAS API is Windows-only".to_string())
}
#[cfg(not(windows))]
pub async fn rasdial_connect(_: &str, _: &str, _: &str) -> Result<(), String> {
    Err("RAS API is Windows-only".to_string())
}
#[cfg(not(windows))]
pub async fn rasdial_disconnect(_: &str) -> Result<(), String> {
    Err("RAS API is Windows-only".to_string())
}
#[cfg(not(windows))]
pub async fn remove_ras_entry(_: &str) -> Result<(), String> {
    Ok(())
}
#[cfg(not(windows))]
pub async fn get_vpn_ip(_: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn powershell_invocations_keep_attacker_input_out_of_source() {
        let attacker = "vpn.example.com'; Write-Output injected; #";
        assert!(create_entry_invocation("entry", attacker, "Ikev2").is_err());

        let invocation = PowerShellInvocation {
            script: CREATE_L2TP_ENTRY_SCRIPT,
            environment: vec![
                ("SORNG_VPN_ENTRY_NAME", "entry'; injected".to_string()),
                ("SORNG_VPN_SHARED_SECRET", attacker.to_string()),
            ],
        };
        assert!(!invocation.script.contains(attacker));
        assert!(!invocation.script.contains("entry'; injected"));
        assert!(invocation.script.contains("-L2tpPsk"));
        assert!(!invocation.script.contains("-SharedSecret"));
        assert!(!SET_IPSEC_POLICY_SCRIPT.contains("-SharedSecret"));
        assert!(invocation
            .environment
            .iter()
            .any(|(_, value)| value == attacker));
    }

    #[test]
    fn native_ras_fields_reject_nulls_and_overflow() {
        assert!(encode_wide_field::<8>("safe", "field").is_ok());
        assert!(encode_wide_field::<8>("bad\0value", "field").is_err());
        assert!(encode_wide_field::<4>("four", "field").is_err());
    }
}

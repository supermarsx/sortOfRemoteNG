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
use zeroize::{Zeroize, Zeroizing};

#[cfg(windows)]
const CREATE_ENTRY_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; Add-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -ServerAddress $env:SORNG_VPN_SERVER -TunnelType $env:SORNG_VPN_TUNNEL_TYPE -Force -RememberCredential";
#[cfg(windows)]
const REMOVE_ENTRY_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; $vpn = Get-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -ErrorAction SilentlyContinue; if ($null -ne $vpn) { Remove-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -Force }";
#[cfg(windows)]
const GET_ENTRY_ADDRESS_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; (Get-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME).ServerAddress";
#[cfg(windows)]
const GET_ENTRY_STATUS_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; $vpn = Get-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -ErrorAction SilentlyContinue; if ($null -eq $vpn) { 'Absent' } else { $vpn.ConnectionStatus }";
#[cfg(windows)]
const SET_EAP_MSCHAPV2_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; $eap = New-EapConfiguration; Set-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -AuthenticationMethod Eap -EapConfigXmlStream $eap.EapConfigXmlStream -Force";
#[cfg(windows)]
const SET_EAP_TLS_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; $eap = New-EapConfiguration -Tls -UserCertificate -VerifyServerIdentity; Set-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -AuthenticationMethod Eap -EapConfigXmlStream $eap.EapConfigXmlStream -Force";
#[cfg(windows)]
const SET_EAP_PEAP_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; $inner = New-EapConfiguration; $eap = New-EapConfiguration -Peap -VerifyServerIdentity -FastReconnect $true -TunneledEapAuthMethod $inner.EapConfigXmlStream; Set-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -AuthenticationMethod Eap -EapConfigXmlStream $eap.EapConfigXmlStream -Force";
#[cfg(windows)]
const CREATE_L2TP_ENTRY_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; Add-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -ServerAddress $env:SORNG_VPN_SERVER -TunnelType L2tp -L2tpPsk $env:SORNG_VPN_SHARED_SECRET -Force -RememberCredential";
#[cfg(windows)]
const SET_IPSEC_POLICY_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; Set-VpnConnectionIPsecConfiguration -ConnectionName $env:SORNG_VPN_ENTRY_NAME -AuthenticationTransformConstants SHA256128 -CipherTransformConstants AES256 -DHGroup Group14 -EncryptionMethod AES256 -IntegrityCheckMethod SHA256 -PfsGroup None -Force";
#[cfg(windows)]
const SET_ROUTING_MODE_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; $split = $env:SORNG_VPN_SPLIT_TUNNELING -eq 'true'; Set-VpnConnection -Name $env:SORNG_VPN_ENTRY_NAME -SplitTunneling $split -Force";
#[cfg(windows)]
const ADD_ROUTE_SCRIPT: &str = "$ErrorActionPreference = 'Stop'; Add-VpnConnectionRoute -ConnectionName $env:SORNG_VPN_ENTRY_NAME -DestinationPrefix $env:SORNG_VPN_DESTINATION_PREFIX -PassThru:$false";

#[cfg(windows)]
#[derive(Debug)]
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
    run_powershell(
        eap_invocation(entry_name, eap_method)?,
        "VPN authentication configuration",
    )
    .await?;
    Ok(())
}

#[cfg(windows)]
fn eap_invocation(entry_name: &str, eap_method: &str) -> Result<PowerShellInvocation, String> {
    let script = match eap_method {
        "mschapv2" => SET_EAP_MSCHAPV2_SCRIPT,
        "tls" => SET_EAP_TLS_SCRIPT,
        "peap" => SET_EAP_PEAP_SCRIPT,
        _ => return Err("Unsupported IKEv2 EAP method".to_string()),
    };
    Ok(PowerShellInvocation {
        script,
        environment: vec![("SORNG_VPN_ENTRY_NAME", entry_name.to_string())],
    })
}

#[cfg(windows)]
fn routing_mode_invocation(entry_name: &str, split: bool) -> PowerShellInvocation {
    PowerShellInvocation {
        script: SET_ROUTING_MODE_SCRIPT,
        environment: vec![
            ("SORNG_VPN_ENTRY_NAME", entry_name.to_string()),
            (
                "SORNG_VPN_SPLIT_TUNNELING",
                if split { "true" } else { "false" }.to_string(),
            ),
        ],
    }
}

#[cfg(windows)]
fn route_invocation(
    entry_name: &str,
    destination_prefix: &str,
    item_number: usize,
) -> Result<PowerShellInvocation, String> {
    crate::routing::validate_cidr(destination_prefix)
        .map_err(|reason| format!("remote subnet item {item_number} is invalid: {reason}"))?;
    Ok(PowerShellInvocation {
        script: ADD_ROUTE_SCRIPT,
        environment: vec![
            ("SORNG_VPN_ENTRY_NAME", entry_name.to_string()),
            (
                "SORNG_VPN_DESTINATION_PREFIX",
                destination_prefix.to_string(),
            ),
        ],
    })
}

/// Apply full- or split-tunnel routing to a Windows RAS entry. All dynamic
/// values remain environment-bound to static PowerShell source.
#[cfg(windows)]
pub async fn configure_ras_routing(
    entry_name: &str,
    split: bool,
    remote_subnets: &[String],
) -> Result<(), String> {
    if remote_subnets.is_empty() {
        return Err("At least one remote subnet is required".to_string());
    }
    let route_invocations = remote_subnets
        .iter()
        .enumerate()
        .map(|(index, subnet)| route_invocation(entry_name, subnet, index + 1))
        .collect::<Result<Vec<_>, _>>()?;

    run_powershell(
        routing_mode_invocation(entry_name, split),
        "VPN routing mode configuration",
    )
    .await?;
    if split {
        for invocation in route_invocations {
            run_powershell(invocation, "VPN route configuration").await?;
        }
    }
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
    let password = Zeroizing::new(password.to_string());
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
    let mut result = [0; N];
    for (index, code_unit) in value.encode_utf16().enumerate() {
        if index >= N.saturating_sub(1) {
            result.zeroize();
            return Err(format!("{label} is too long"));
        }
        result[index] = code_unit;
    }
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
    result.map(|_| ())
}

/// Reconcile and remove a deterministic RAS entry. This is safe after an app
/// restart because it probes the OS instead of trusting cached profile state.
#[cfg(windows)]
pub async fn teardown_ras_entry(entry_name: &str) -> Result<(), String> {
    let mut errors = Vec::new();
    match is_ras_active(entry_name).await {
        Ok(true) => {
            if let Err(error) = rasdial_disconnect(entry_name).await {
                errors.push(error);
            }
        }
        Ok(false) => {}
        Err(error) => errors.push(error),
    }
    if let Err(error) = remove_ras_entry(entry_name).await {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
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

#[cfg(windows)]
pub async fn is_ras_active(entry_name: &str) -> Result<bool, String> {
    let output = run_powershell(
        PowerShellInvocation {
            script: GET_ENTRY_STATUS_SCRIPT,
            environment: vec![("SORNG_VPN_ENTRY_NAME", entry_name.to_string())],
        },
        "VPN status query",
    )
    .await?;
    match String::from_utf8_lossy(&output.stdout).trim() {
        "Connected" => Ok(true),
        "Disconnected" | "Absent" => Ok(false),
        status => Err(format!(
            "Windows RAS returned indeterminate status: {status}"
        )),
    }
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
pub async fn configure_ras_routing(_: &str, _: bool, _: &[String]) -> Result<(), String> {
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
pub async fn teardown_ras_entry(_: &str) -> Result<(), String> {
    Err("RAS API is Windows-only".to_string())
}
#[cfg(not(windows))]
pub async fn get_vpn_ip(_: &str) -> Result<Option<String>, String> {
    Ok(None)
}
#[cfg(not(windows))]
pub async fn is_ras_active(_: &str) -> Result<bool, String> {
    Err("RAS API is Windows-only".to_string())
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

    #[test]
    fn eap_scripts_select_exact_methods_and_keep_names_out_of_source() {
        let attacker = "entry'; Write-Output injected; #";
        let mschapv2 = eap_invocation(attacker, "mschapv2").unwrap();
        let tls = eap_invocation(attacker, "tls").unwrap();
        let peap = eap_invocation(attacker, "peap").unwrap();

        for invocation in [&mschapv2, &tls, &peap] {
            assert!(!invocation.script.contains(attacker));
            assert!(invocation.script.contains("-AuthenticationMethod Eap"));
            assert!(invocation.script.contains("-EapConfigXmlStream"));
            assert!(invocation
                .environment
                .iter()
                .any(|(_, value)| value == attacker));
        }
        assert!(mschapv2.script.contains("New-EapConfiguration;"));
        assert!(tls
            .script
            .contains("New-EapConfiguration -Tls -UserCertificate -VerifyServerIdentity"));
        assert!(peap.script.contains("$inner = New-EapConfiguration"));
        assert!(peap.script.contains("-Peap -VerifyServerIdentity"));
        assert!(peap
            .script
            .contains("-TunneledEapAuthMethod $inner.EapConfigXmlStream"));
        assert!(eap_invocation("entry", "unknown").is_err());
    }

    #[test]
    fn routing_scripts_are_static_and_routes_are_environment_bound() {
        let attacker = "entry'; Write-Output injected; #";
        let mode = routing_mode_invocation(attacker, true);
        assert_eq!(mode.script, SET_ROUTING_MODE_SCRIPT);
        assert!(mode.script.contains("-SplitTunneling $split"));
        assert!(!mode.script.contains(attacker));
        assert!(mode.environment.iter().any(|(_, value)| value == attacker));
        assert!(mode
            .environment
            .iter()
            .any(|(key, value)| *key == "SORNG_VPN_SPLIT_TUNNELING" && value == "true"));

        for destination in ["10.20.0.0/16", "2001:db8:42::/48"] {
            let route = route_invocation(attacker, destination, 1).unwrap();
            assert_eq!(route.script, ADD_ROUTE_SCRIPT);
            assert!(route.script.contains("Add-VpnConnectionRoute"));
            assert!(!route.script.contains(attacker));
            assert!(!route.script.contains(destination));
            assert!(route
                .environment
                .iter()
                .any(|(_, value)| value == destination));
        }
    }

    #[test]
    fn routing_invocation_revalidates_cidrs_without_echoing_input() {
        let marker = "secret-host.example/24'; injected";
        let error = route_invocation("entry", marker, 3).unwrap_err();
        assert!(!error.contains(marker));
        assert!(error.contains("item 3"));
    }
}

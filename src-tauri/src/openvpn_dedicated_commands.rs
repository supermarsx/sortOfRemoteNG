// Thin re-export shim for the dedicated `sorng-openvpn` crate's
// `#[tauri::command]` handlers.
//
// The legacy wrapper `openvpn_commands.rs` still wires the older
// `sorng_vpn::openvpn` service. The dedicated crate (`sorng-openvpn`)
// is a separate, newer implementation with its own `OpenVpnService`
// and `openvpn_*`-prefixed commands — registered alongside the legacy
// set. There is no command-name collision (legacy uses `*_openvpn`,
// dedicated uses `openvpn_*`).
//
// Commands delegate directly to `OpenVpnServiceState`
// (`Arc<OpenVpnService>`) managed in `state_registry::connectivity`.

#[allow(unused_imports)]
pub(crate) use sorng_app_domains::openvpn_dedicated::openvpn::commands::*;

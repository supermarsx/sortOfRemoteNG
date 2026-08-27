// ── sorng-commands-ops/src/draytek_commands.rs ──────────────────────────────
// Tauri commands for the DrayTek Vigor integration (t68 D2) – thin wrappers
// around `sorng_draytek::service::DraytekServiceWrapper`.
//
// Unlike pfSense (whose command file lives in its crate and is `include!`d
// here), `sorng-draytek` is deliberately tauri-free, so the wrappers live in
// this crate. The wire shapes follow the frontend contract fixed by t68-e3
// (`src/types/draytek/index.ts`): snake_case config incl. `vendor`, and a
// status payload whose WAN rows use `status` (the crate names it `state`).
//
// `draytek_run_cli` (SSH `sys version` / `wan status` / `sys reboot`) is
// deferred to v2: the `{ id, verb }` contract carries no SSH session and the
// HTTP path already serves status + reboot.

use serde::Serialize;
use tauri::State;

use crate::draytek::service::DraytekServiceState;
use crate::draytek::types::{
    DraytekConnectionConfig, DraytekConnectionSummary, DraytekRebootResult, DraytekStatus,
    WanStatus,
};

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ── Wire shapes (frontend contract) ───────────────────────────────

/// `DraytekWanStatus` on the wire – `state` is exposed as `status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DraytekWanStatusWire {
    pub name: String,
    pub status: Option<String>,
    pub ip: Option<String>,
    pub gateway: Option<String>,
    pub mode: Option<String>,
    pub uptime: Option<String>,
}

impl From<WanStatus> for DraytekWanStatusWire {
    fn from(wan: WanStatus) -> Self {
        Self {
            name: wan.name,
            status: wan.state,
            ip: wan.ip,
            gateway: wan.gateway,
            mode: wan.mode,
            uptime: wan.uptime,
        }
    }
}

/// `DraytekStatus` on the wire – every field optional, `wan` always present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DraytekStatusWire {
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub build: Option<String>,
    pub hostname: Option<String>,
    pub uptime: Option<String>,
    pub wan: Vec<DraytekWanStatusWire>,
}

impl From<DraytekStatus> for DraytekStatusWire {
    fn from(status: DraytekStatus) -> Self {
        Self {
            model: status.model,
            firmware: status.firmware,
            build: status.build,
            hostname: status.hostname,
            uptime: status.uptime,
            wan: status.wan.into_iter().map(Into::into).collect(),
        }
    }
}

/// `DraytekActionResult` on the wire (`draytek_reboot`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DraytekActionResultWire {
    pub accepted: bool,
    pub message: Option<String>,
    pub output: Option<String>,
}

impl From<DraytekRebootResult> for DraytekActionResultWire {
    fn from(result: DraytekRebootResult) -> Self {
        Self {
            accepted: result.accepted,
            message: Some(result.message),
            output: None,
        }
    }
}

// ── Connection ────────────────────────────────────────────────────

#[tauri::command]
pub async fn draytek_connect(
    state: State<'_, DraytekServiceState>,
    id: String,
    config: DraytekConnectionConfig,
) -> CmdResult<DraytekConnectionSummary> {
    state
        .lock()
        .await
        .connect(id, config)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn draytek_disconnect(
    state: State<'_, DraytekServiceState>,
    id: String,
) -> CmdResult<()> {
    state.lock().await.disconnect(&id).map_err(map_err)
}

#[tauri::command]
pub async fn draytek_list_connections(
    state: State<'_, DraytekServiceState>,
) -> CmdResult<Vec<String>> {
    Ok(state.lock().await.list_connections())
}

#[tauri::command]
pub async fn draytek_ping(
    state: State<'_, DraytekServiceState>,
    id: String,
) -> CmdResult<DraytekConnectionSummary> {
    state.lock().await.ping(&id).await.map_err(map_err)
}

// ── Status / actions ──────────────────────────────────────────────

#[tauri::command]
pub async fn draytek_get_status(
    state: State<'_, DraytekServiceState>,
    id: String,
) -> CmdResult<DraytekStatusWire> {
    state
        .lock()
        .await
        .get_status(&id)
        .await
        .map(Into::into)
        .map_err(map_err)
}

/// Reboots the device. State-changing: the panel confirms before calling.
#[tauri::command]
pub async fn draytek_reboot(
    state: State<'_, DraytekServiceState>,
    id: String,
) -> CmdResult<DraytekActionResultWire> {
    state
        .lock()
        .await
        .reboot(&id)
        .await
        .map(Into::into)
        .map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every registered DrayTek command name (v1 surface).
    const DRAYTEK_COMMANDS: &[&str] = &[
        "draytek_connect",
        "draytek_disconnect",
        "draytek_list_connections",
        "draytek_ping",
        "draytek_get_status",
        "draytek_reboot",
    ];

    /// t40-f5 both-lists rule: each command must be in an `is_command_*`
    /// block AND a `build_*` `generate_handler!` list, or dispatch is dead.
    #[test]
    fn draytek_commands_are_in_both_handler_lists() {
        let handler_src = include_str!("ops_handler.rs");
        for name in DRAYTEK_COMMANDS {
            assert!(
                crate::ops_handler::is_command(name),
                "{name} missing from is_command_*"
            );
            let build_entry = format!("draytek_commands::{name},");
            assert!(
                handler_src.contains(&build_entry),
                "{name} missing from build_* generate_handler! list"
            );
        }
        assert!(!crate::ops_handler::is_command("draytek_run_cli"));
    }

    #[test]
    fn wan_state_is_exposed_as_status_on_the_wire() {
        let wire: DraytekWanStatusWire = WanStatus {
            name: "WAN1".into(),
            state: Some("Up".into()),
            ip: Some("203.0.113.5".into()),
            gateway: None,
            mode: Some("PPPoE".into()),
            uptime: None,
        }
        .into();
        let json = serde_json::to_value(&wire).unwrap();
        assert_eq!(json["status"], "Up");
        assert!(json.get("state").is_none());
        assert_eq!(json["mode"], "PPPoE");
    }

    #[test]
    fn status_and_reboot_match_frontend_contract() {
        let status: DraytekStatusWire = DraytekStatus {
            model: Some("Vigor2865".into()),
            firmware: Some("4.4.2".into()),
            ..Default::default()
        }
        .into();
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["model"], "Vigor2865");
        assert!(json["wan"].as_array().unwrap().is_empty());

        let reboot: DraytekActionResultWire = DraytekRebootResult {
            accepted: true,
            message: "reboot requested".into(),
        }
        .into();
        let json = serde_json::to_value(&reboot).unwrap();
        assert_eq!(json["accepted"], true);
        assert_eq!(json["message"], "reboot requested");
        assert!(json["output"].is_null());
    }
}

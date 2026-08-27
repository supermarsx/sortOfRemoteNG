//! t64 — the Portainer command surface must be dispatchable.
//!
//! `is_command` (the string match arm) and `generate_handler!` (the typed
//! entry list) are two hand-maintained lists that have to agree: the frontend
//! `invoke("portainer_…")` calls are validated against the *string* list by
//! `tests/ipc/invokeRegistration.test.ts`, while only the *typed* list can
//! actually route the call at runtime. Registering a name in one and not the
//! other yields a command that passes CI and fails in the app, so pin both.

use sorng_commands_services::is_command;

/// Every command exported by `sorng-portainer/src/commands.rs`.
const PORTAINER_COMMANDS: &[&str] = &[
    "portainer_connect",
    "portainer_disconnect",
    "portainer_list_connections",
    "portainer_ping",
    "portainer_web_ui_url",
    "portainer_list_endpoints",
    "portainer_list_containers",
    "portainer_start_container",
    "portainer_stop_container",
    "portainer_restart_container",
    "portainer_container_logs",
    "portainer_list_stacks",
    "portainer_start_stack",
    "portainer_stop_stack",
];

#[test]
fn portainer_commands_are_dispatched_by_the_services_handler() {
    assert_eq!(
        PORTAINER_COMMANDS.len(),
        14,
        "t64 froze the Portainer surface at 14 commands"
    );
    for command in PORTAINER_COMMANDS {
        assert!(is_command(command), "{command} is not registered");
    }
}

#[test]
fn portainer_string_and_typed_handler_lists_agree() {
    let source = include_str!("../src/services_handler.rs");

    for command in PORTAINER_COMMANDS {
        assert!(
            source.contains(&format!("\"{command}\"")),
            "{command} is missing from the `is_command` match arm"
        );
        assert!(
            source.contains(&format!("portainer_commands::{command},")),
            "{command} is missing from the `generate_handler!` list"
        );
    }

    // Neither list may grow a Portainer name the other does not have.
    assert_eq!(
        source.matches("\"portainer_").count(),
        PORTAINER_COMMANDS.len(),
        "unexpected `portainer_*` entry in the `is_command` match arm"
    );
    assert_eq!(
        source.matches("portainer_commands::").count(),
        PORTAINER_COMMANDS.len(),
        "unexpected `portainer_*` entry in the `generate_handler!` list"
    );
}

#[test]
fn unknown_portainer_commands_are_rejected() {
    assert!(!is_command("portainer_delete_everything"));
}

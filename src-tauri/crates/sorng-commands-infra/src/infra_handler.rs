pub fn is_command(command: &str) -> bool {
    sorng_commands_bmc::is_command(command)
        || sorng_commands_virtualization::is_command(command)
        || sorng_commands_proxmox::is_command(command)
        || sorng_commands_nas::is_command(command)
        || sorng_commands_remote::is_command(command)
}

pub fn build() -> crate::Handler {
    let bmc = sorng_commands_bmc::build();
    let virtualization = sorng_commands_virtualization::build();
    let proxmox = sorng_commands_proxmox::build();
    let nas = sorng_commands_nas::build();
    let remote = sorng_commands_remote::build();
    Box::new(move |invoke| {
        let command = invoke.message.command();
        if sorng_commands_bmc::is_command(command) {
            return bmc(invoke);
        }
        if sorng_commands_virtualization::is_command(command) {
            return virtualization(invoke);
        }
        if sorng_commands_proxmox::is_command(command) {
            return proxmox(invoke);
        }
        if sorng_commands_nas::is_command(command) {
            return nas(invoke);
        }
        if sorng_commands_remote::is_command(command) {
            return remote(invoke);
        }
        false
    })
}

#[cfg(test)]
mod tests {
    use super::is_command;

    #[test]
    fn bounded_child_inventories_are_disjoint_and_completely_routed() {
        let children = [
            sorng_commands_bmc::COMMAND_NAMES,
            sorng_commands_virtualization::COMMAND_NAMES,
            sorng_commands_proxmox::COMMAND_NAMES,
            sorng_commands_nas::COMMAND_NAMES,
            sorng_commands_remote::COMMAND_NAMES,
        ];
        let mut all = std::collections::BTreeSet::new();
        for child in children {
            assert!(child.len() <= 250);
            for command in child {
                assert!(all.insert(*command), "duplicate child command: {command}");
                assert!(is_command(command), "unrouted child command: {command}");
            }
        }
        assert_eq!(all.len(), 683);
        assert!(!is_command("__unknown_infrastructure_command__"));
    }

    const VOIP_PHONE_COMMANDS: &[&str] = &[
        "voip_phone_probe",
        "voip_phone_connect",
        "voip_phone_disconnect",
        "voip_phone_list",
        "voip_phone_get_config",
        "voip_phone_get_status",
        "voip_phone_reboot",
        "voip_phone_web_login_hint",
    ];

    #[test]
    fn scoped_file_station_recognition_matches_handler_registration() {
        let source = include_str!("../../sorng-commands-nas/src/handler.rs");
        for command in [
            "syn_fs_connect",
            "syn_fs_disconnect",
            "syn_fs_session_health",
            "syn_get_section_access",
            "syn_fs_preview_file",
            "syn_fs_close_preview",
            "syn_fs_open_external",
            "syn_fs_list",
            "syn_fs_create_folder",
            "syn_fs_rename",
            "syn_fs_start_task",
            "syn_fs_task_status",
            "syn_fs_stop_task",
            "syn_fs_upload",
            "syn_fs_download",
        ] {
            assert!(
                is_command(command),
                "{command} missing from dispatch recognition"
            );
            assert_eq!(
                source
                    .matches(&format!("synology_commands::{command},"))
                    .count(),
                1,
                "{command} must have exactly one handler"
            );
        }
        assert!(!is_command("syn_fs_unknown"));
    }

    #[test]
    fn voip_phone_command_recognition_matches_handler_registration() {
        let source = include_str!("../../sorng-commands-remote/src/handler.rs");
        for command in VOIP_PHONE_COMMANDS {
            assert!(is_command(command), "{command} missing from is_command");
            let registration = format!("voip_phone_commands::{command},");
            assert!(
                source.contains(&registration),
                "{command} missing from generate_handler!"
            );
        }
        assert!(!is_command("voip_phone_unknown"));
    }
}

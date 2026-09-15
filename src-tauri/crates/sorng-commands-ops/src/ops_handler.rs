// Children are consulted in the order their modules first appeared in the
// pre-split ops dispatch groups. Their inventories are disjoint (see tests),
// so the order does not change which child handles a command.
pub fn is_command(command: &str) -> bool {
    sorng_commands_ops_system::is_command(command)
        || sorng_commands_ops_identity::is_command(command)
        || sorng_commands_ops_web::is_command(command)
        || sorng_commands_ops_network::is_command(command)
        || sorng_commands_ops_databases::is_command(command)
        || sorng_commands_ops_monitoring::is_command(command)
        || sorng_commands_ops_platform::is_command(command)
        || sorng_commands_ops_messaging::is_command(command)
        || sorng_commands_ops_orchestration::is_command(command)
}

pub fn build() -> crate::Handler {
    let system = sorng_commands_ops_system::build();
    let identity = sorng_commands_ops_identity::build();
    let web = sorng_commands_ops_web::build();
    let network = sorng_commands_ops_network::build();
    let databases = sorng_commands_ops_databases::build();
    let monitoring = sorng_commands_ops_monitoring::build();
    let platform = sorng_commands_ops_platform::build();
    let messaging = sorng_commands_ops_messaging::build();
    let orchestration = sorng_commands_ops_orchestration::build();
    Box::new(move |invoke| {
        let command = invoke.message.command();
        if sorng_commands_ops_system::is_command(command) {
            return system(invoke);
        }
        if sorng_commands_ops_identity::is_command(command) {
            return identity(invoke);
        }
        if sorng_commands_ops_web::is_command(command) {
            return web(invoke);
        }
        if sorng_commands_ops_network::is_command(command) {
            return network(invoke);
        }
        if sorng_commands_ops_databases::is_command(command) {
            return databases(invoke);
        }
        if sorng_commands_ops_monitoring::is_command(command) {
            return monitoring(invoke);
        }
        if sorng_commands_ops_platform::is_command(command) {
            return platform(invoke);
        }
        if sorng_commands_ops_messaging::is_command(command) {
            return messaging(invoke);
        }
        if sorng_commands_ops_orchestration::is_command(command) {
            return orchestration(invoke);
        }
        false
    })
}

#[cfg(test)]
mod tests {
    use super::is_command;

    #[cfg(feature = "kafka")]
    const EXPECTED_COMMANDS: usize = 1773;
    #[cfg(not(feature = "kafka"))]
    const EXPECTED_COMMANDS: usize = 1734;

    #[test]
    fn bounded_child_inventories_are_disjoint_and_completely_routed() {
        let children = [
            sorng_commands_ops_system::COMMAND_NAMES,
            sorng_commands_ops_identity::COMMAND_NAMES,
            sorng_commands_ops_web::COMMAND_NAMES,
            sorng_commands_ops_network::COMMAND_NAMES,
            sorng_commands_ops_databases::COMMAND_NAMES,
            sorng_commands_ops_monitoring::COMMAND_NAMES,
            sorng_commands_ops_platform::COMMAND_NAMES,
            sorng_commands_ops_messaging::COMMAND_NAMES,
            sorng_commands_ops_orchestration::COMMAND_NAMES,
        ];
        let mut all = std::collections::BTreeSet::new();
        for child in children {
            assert!(child.len() <= 250);
            for command in child {
                assert!(all.insert(*command), "duplicate child command: {command}");
                assert!(is_command(command), "unrouted child command: {command}");
            }
        }
        assert_eq!(all.len(), EXPECTED_COMMANDS);
        assert!(!is_command("__unknown_operations_command__"));
    }

    #[test]
    fn kafka_commands_are_routed_only_with_the_kafka_feature() {
        for command in ["kafka_connect", "kafka_disconnect"] {
            assert_eq!(is_command(command), cfg!(feature = "kafka"), "{command}");
        }
        assert!(is_command("rabbit_aliveness_test"));
    }
}

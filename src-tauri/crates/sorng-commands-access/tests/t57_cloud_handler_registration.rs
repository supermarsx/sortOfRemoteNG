use sorng_commands_access::is_command;

#[test]
fn ibm_cloud_commands_are_dispatched_by_the_access_handler() {
    for command in [
        "connect_ibm",
        "disconnect_ibm",
        "list_ibm_virtual_servers",
        "get_ibm_session",
        "list_ibm_sessions",
    ] {
        assert!(is_command(command), "{command} is not registered");
    }
}

#[test]
fn heroku_commands_are_dispatched_by_the_access_handler() {
    for command in [
        "connect_heroku",
        "disconnect_heroku",
        "list_heroku_dynos",
        "get_heroku_session",
        "list_heroku_sessions",
    ] {
        assert!(is_command(command), "{command} is not registered");
    }
}

#[test]
fn scaleway_commands_are_dispatched_by_the_access_handler() {
    for command in [
        "connect_scaleway",
        "disconnect_scaleway",
        "list_scaleway_instances",
        "get_scaleway_session",
        "list_scaleway_sessions",
    ] {
        assert!(is_command(command), "{command} is not registered");
    }
}

#[test]
fn linode_commands_are_dispatched_by_the_access_handler() {
    for command in [
        "connect_linode",
        "disconnect_linode",
        "list_linode_instances",
        "get_linode_session",
        "list_linode_sessions",
    ] {
        assert!(is_command(command), "{command} is not registered");
    }
}

#[test]
fn ovh_commands_are_dispatched_by_the_access_handler() {
    for command in [
        "connect_ovh",
        "disconnect_ovh",
        "list_ovh_instances",
        "get_ovh_session",
        "list_ovh_sessions",
    ] {
        assert!(is_command(command), "{command} is not registered");
    }
}

//! SSH configuration selected only from this browser's owning saved database.
use super::*;
use serde_json::json;

const ERROR: NativeAuthorityError = NativeAuthorityError::RouteUnsupported;

fn text<'a>(row: &'a Value, key: &str) -> Result<&'a str, NativeAuthorityError> {
    match row.get(key) {
        None | Some(Value::Null) => Ok(""),
        Some(Value::String(value)) if value.len() <= 256 * 1024 && !value.contains('\0') => {
            Ok(value)
        }
        _ => Err(ERROR),
    }
}

fn reference(spec: &Value, owner: &str) -> Result<Option<String>, NativeAuthorityError> {
    no_nested_route(spec)?;
    if let Some(value) = spec.get("ownerDatabaseId").filter(|v| !v.is_null()) {
        if value.as_str() != Some(owner) {
            return Err(ERROR);
        }
    }
    let id = text(spec, "connectionId")?;
    if id.is_empty() && spec.get("connectionId").is_none() {
        return Ok(None);
    }
    if id.is_empty() || id.len() > 256 {
        return Err(ERROR);
    }
    // Reference selection never mixes in a second inline authentication source.
    for key in ["host", "username", "password", "privateKey", "passphrase"] {
        if !text(spec, key)?.is_empty() {
            return Err(ERROR);
        }
    }
    Ok(Some(id.to_owned()))
}

fn no_nested_route(source: &Value) -> Result<(), NativeAuthorityError> {
    for key in ["proxyCommand", "jumpTargetHost", "jumpTargetPort"] {
        if source.get(key).is_some_and(|v| !v.is_null() && v != "") {
            return Err(ERROR);
        }
    }
    if source
        .get("jumpHosts")
        .is_some_and(|v| !v.as_array().is_some_and(Vec::is_empty))
    {
        return Err(ERROR);
    }
    for key in [
        "proxyProfileId",
        "proxyChainId",
        "tunnelProfileId",
        "tunnelChainId",
        "connectionChainId",
    ] {
        if source.get(key).is_some_and(|v| !v.is_null() && v != "") {
            return Err(ERROR);
        }
    }
    if let Some(security) = source.get("security").filter(|v| !v.is_null()) {
        if !security.is_object() {
            return Err(ERROR);
        }
        for key in ["proxy", "openvpn", "sshTunnel"] {
            if security
                .get(key)
                .is_some_and(|v| !v.is_null() && v.get("enabled") != Some(&Value::Bool(false)))
            {
                return Err(ERROR);
            }
        }
        if let Some(layers) = security.get("tunnelChain") {
            let layers = layers.as_array().ok_or(ERROR)?;
            if layers
                .iter()
                .any(|v| v.get("enabled") != Some(&Value::Bool(false)))
            {
                return Err(ERROR);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
fn build(
    source: &Value,
    vault: Option<&Value>,
    inline: bool,
) -> Result<crate::ssh::SshConnectionConfig, NativeAuthorityError> {
    build_with_settings(source, vault, inline, &Value::Null)
}

fn build_with_settings(
    source: &Value,
    vault: Option<&Value>,
    inline: bool,
    settings: &Value,
) -> Result<crate::ssh::SshConnectionConfig, NativeAuthorityError> {
    no_nested_route(source)?;
    if !inline
        && (source.get("protocol").and_then(Value::as_str) != Some("ssh")
            || source.get("isGroup") == Some(&Value::Bool(true)))
    {
        return Err(ERROR);
    }
    // Integration endpoints belong to integration:* protocols. Retained panel
    // metadata must never redirect a saved SSH connection's credentials.
    let host = text(source, if inline { "host" } else { "hostname" })?;
    if host.is_empty()
        || host.len() > 253
        || host.chars().any(|c| c.is_whitespace() || c.is_control())
        || host.contains(['/', '\\', '@', '?', '#'])
    {
        return Err(ERROR);
    }
    let host = if host.starts_with('[') || host.ends_with(']') {
        let literal = host
            .strip_prefix('[')
            .and_then(|v| v.strip_suffix(']'))
            .ok_or(ERROR)?;
        literal.parse::<std::net::Ipv6Addr>().map_err(|_| ERROR)?;
        literal
    } else {
        if host.contains(':') {
            host.parse::<std::net::Ipv6Addr>().map_err(|_| ERROR)?;
        }
        host
    };
    let port = match source.get("port") {
        None | Some(Value::Null) => 22,
        Some(v) => v.as_u64().filter(|v| *v > 0 && *v <= 65535).ok_or(ERROR)?,
    };
    let saved_auth = text(source, if inline { "authMethod" } else { "authType" })?;
    let auth = if saved_auth.is_empty() {
        if vault.is_none() && !text(source, "privateKey")?.is_empty() {
            "key"
        } else {
            "password"
        }
    } else {
        saved_auth
    };
    if !matches!(auth, "password" | "key" | "totp") {
        return Err(ERROR);
    }
    let fields = vault.map(|v| &v["facets"]).unwrap_or(source);
    if !fields.is_object() {
        return Err(ERROR);
    }
    let username = text(fields, "username")?;
    if username.is_empty() || username.len() > 256 || username.chars().any(char::is_control) {
        return Err(ERROR);
    }
    let password = text(fields, "password")?;
    let private_key = text(fields, "privateKey")?;
    if vault.is_some()
        && ((auth == "key" && private_key.is_empty()) || (auth != "key" && password.is_empty()))
    {
        return Err(ERROR);
    }
    let mut config = json!({
        "host": host, "port": port, "username": username,
        "password": if password.is_empty() { Value::Null } else { json!(password) },
        "private_key_path": if auth == "key" && vault.is_none() && !private_key.is_empty() { json!(private_key) } else { Value::Null },
        "private_key_content": if auth == "key" && vault.is_some() && !private_key.is_empty() { json!(private_key) } else { Value::Null },
        "private_key_passphrase": text(fields, "passphrase")?,
        "allow_agent_auth": vault.is_none() && auth == "key" && private_key.is_empty(),
        "jump_hosts": [], "strict_host_key_checking": true,
        "accept_new_host_keys": false, "also_write_known_hosts": true,
        "connect_timeout": 30, "keep_alive_interval": 30,
        "tcp_no_delay": true, "tcp_keepalive": true, "keepalive_probes": 3,
        "ip_protocol": "auto", "compression": false, "compression_level": 6,
        "ssh_version": "auto", "agent_forwarding": false
    });
    if let Some(options) = source
        .get("sshConnectionConfigOverride")
        .filter(|v| !v.is_null())
    {
        if !options.is_object() {
            return Err(ERROR);
        }
        // An unsupported upstream route must never silently become direct SSH.
        if options.get("enableJumpHost") == Some(&Value::Bool(true))
            || options
                .get("proxyCommand")
                .is_some_and(|v| !v.is_null() && v != "")
        {
            return Err(ERROR);
        }
        if let Some(value) = options.get("knownHostsPath").filter(|v| !v.is_null()) {
            config["known_hosts_path"] = value.clone();
        }
    }
    if let Some(value) = source.get("sshKnownHostsPath").filter(|v| !v.is_null()) {
        config["known_hosts_path"] = value.clone();
    }
    apply_terminal_options(&mut config, source, settings)?;
    // The editor's empty default means the verified platform known_hosts path,
    // not a literal empty filesystem path. Normalize after override precedence.
    if config.get("known_hosts_path").and_then(Value::as_str) == Some("") {
        config["known_hosts_path"] = Value::Null;
    }
    let totp_id = source
        .pointer("/credentialSource/totpId")
        .and_then(Value::as_str);
    if vault.is_some() && totp_id.is_some() {
        let selected: Vec<_> = fields["totp"]
            .as_array()
            .ok_or(ERROR)?
            .iter()
            .filter(|v| v["id"].as_str() == totp_id)
            .collect();
        if selected.len() != 1 {
            return Err(ERROR);
        }
        config["totp_secret"] = json!(text(selected[0], "secret")?);
        config["totp_options"] = json!({"algorithm":selected[0]["algorithm"],"digits":selected[0]["digits"],"period":selected[0]["period"]});
    } else if vault.is_none() {
        let secret = text(source, "totpSecret")?;
        if !secret.is_empty() {
            config["totp_secret"] = json!(secret);
        }
    }
    if auth == "totp"
        && config
            .get("totp_secret")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
    {
        return Err(ERROR);
    }
    serde_json::from_value(config).map_err(|_| ERROR)
}

pub(super) async fn resolve<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    lease: &NativeOwnerLease,
    _route_source: &Value,
    ssh_spec: &Value,
    settings: &Value,
) -> Result<crate::ssh::SshConnectionConfig, NativeAuthorityError> {
    let id = reference(ssh_spec, lease.database_id())?;
    let source = if let Some(id) = &id {
        lease
            .read_dependency(window, state, false, id)
            .await
            .map_err(|_| ERROR)?
    } else {
        ssh_spec.clone()
    };
    let vault = if let Some(id) = credentials::vault_id(&source)? {
        Some(
            lease
                .read_dependency(window, state, true, &id)
                .await
                .map_err(|_| NativeAuthorityError::CredentialUnavailable)?,
        )
    } else {
        None
    };
    build_with_settings(&source, vault.as_ref(), id.is_none(), settings)
}

// Mirrors useWebTerminal's merged terminal/tcp producer. Transport policy is
// not sourced from the unrelated shell/environment connection options.
fn apply_terminal_options(
    config: &mut Value,
    source: &Value,
    settings: &Value,
) -> Result<(), NativeAuthorityError> {
    let global = settings.get("sshTerminal").filter(|v| !v.is_null());
    let local = source
        .get("sshTerminalConfigOverride")
        .filter(|v| !v.is_null());
    for value in [global, local].into_iter().flatten() {
        if !value.is_object() {
            return Err(ERROR);
        }
    }
    let pick = |key: &str| {
        local
            .and_then(|v| v.get(key))
            .or_else(|| global.and_then(|v| v.get(key)))
            .filter(|v| !v.is_null())
            .cloned()
    };
    for (saved, native) in [
        ("enableCompression", "compression"),
        ("compressionLevel", "compression_level"),
        ("sshVersion", "ssh_version"),
        ("preferredCiphers", "preferred_ciphers"),
        ("preferredMACs", "preferred_macs"),
        ("preferredKeyExchanges", "preferred_kex"),
        (
            "preferredHostKeyAlgorithms",
            "preferred_host_key_algorithms",
        ),
    ] {
        if let Some(value) = pick(saved) {
            config[native] = value;
        }
    }
    let global_tcp = global
        .and_then(|v| v.get("tcpOptions"))
        .filter(|v| !v.is_null());
    let local_tcp = local
        .and_then(|v| v.get("tcpOptions"))
        .filter(|v| !v.is_null());
    for value in [global_tcp, local_tcp].into_iter().flatten() {
        if !value.is_object() {
            return Err(ERROR);
        }
    }
    let tcp = |key: &str, default: Value| {
        local_tcp
            .and_then(|v| v.get(key))
            .or_else(|| global_tcp.and_then(|v| v.get(key)))
            .filter(|v| !v.is_null())
            .cloned()
            .unwrap_or(default)
    };
    let fallback = |key: &str, default: Value| {
        source
            .get(key)
            .filter(|value| !value.is_null())
            .cloned()
            .unwrap_or(default)
    };
    config["connect_timeout"] = tcp(
        "connectionTimeout",
        fallback("sshConnectTimeout", json!(30)),
    );
    config["keep_alive_interval"] = if tcp("tcpKeepAlive", json!(false)).as_bool().ok_or(ERROR)? {
        tcp(
            "keepAliveInterval",
            fallback("sshKeepAliveInterval", json!(30)),
        )
    } else {
        Value::Null
    };
    config["tcp_no_delay"] = tcp("tcpNoDelay", json!(true));
    config["tcp_keepalive"] = tcp("soKeepAlive", json!(true));
    config["keepalive_probes"] = tcp("keepAliveProbes", json!(3));
    config["ip_protocol"] = tcp("ipProtocol", json!("auto"));
    if !matches!(
        config["ip_protocol"].as_str(),
        Some("auto" | "ipv4" | "ipv6")
    ) {
        return Err(ERROR);
    }
    let global_connection = settings.get("sshConnection").filter(|v| !v.is_null());
    let local_connection = source
        .get("sshConnectionConfigOverride")
        .filter(|v| !v.is_null());
    for value in [global_connection, local_connection].into_iter().flatten() {
        if !value.is_object() {
            return Err(ERROR);
        }
    }
    let connection = |key: &str| {
        local_connection
            .and_then(|v| v.get(key))
            .or_else(|| global_connection.and_then(|v| v.get(key)))
    };
    // Never discard an effective route selector. An explicit local empty
    // command does override the global command, just like the terminal merge.
    for key in ["proxyCommand", "proxyCommandTemplate"] {
        if connection(key).is_some_and(|v| !v.is_null() && v != "") {
            return Err(ERROR);
        }
    }
    if connection("enableJumpHost") == Some(&Value::Bool(true))
        || connection("mixedChain").is_some_and(|v| {
            !v.is_null()
                && !v
                    .get("hops")
                    .and_then(Value::as_array)
                    .is_some_and(Vec::is_empty)
        })
    {
        return Err(ERROR);
    }
    if let Some(value) = local_connection
        .and_then(|v| v.get("agentForwarding"))
        .or_else(|| global_connection.and_then(|v| v.get("agentForwarding")))
        .filter(|v| !v.is_null())
    {
        config["agent_forwarding"] = value.clone();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row() -> Value {
        json!({"protocol":"ssh","hostname":"ssh.example.test","port":22,"username":"account","password":"fixture-password"})
    }
    #[test]
    fn browser_transport_matches_terminal_merged_tcp_and_algorithm_options() {
        let settings = json!({"sshTerminal":{"tcpOptions":{"connectionTimeout":41,"ipProtocol":"ipv6","tcpNoDelay":false,"soKeepAlive":false,"keepAliveProbes":7,"keepAliveInterval":21,"tcpKeepAlive":true},"enableCompression":true,"preferredCiphers":["aes256-ctr"]},"sshConnection":{"agentForwarding":true}});
        let mut source = row();
        source["sshConnectTimeout"] = 99.into();
        source["sshConnectionConfigOverride"] = json!({"connectTimeout":88,"ipProtocol":"ipv4"});
        source["sshTerminalConfigOverride"] = json!({"tcpOptions":{"connectionTimeout":17,"ipProtocol":"ipv4"},"preferredCiphers":["aes128-ctr"]});
        let config = build_with_settings(&source, None, false, &settings).unwrap();
        assert_eq!(config.host, "ssh.example.test");
        assert_eq!(config.port, 22);
        assert_eq!(config.connect_timeout, Some(17));
        assert_eq!(config.ip_protocol, "ipv4");
        assert!(!config.tcp_no_delay);
        assert!(!config.tcp_keepalive);
        assert_eq!(config.keepalive_probes, 7);
        assert_eq!(config.keep_alive_interval, Some(21));
        assert!(config.compression);
        assert!(config.agent_forwarding);
        assert_eq!(config.preferred_ciphers, vec!["aes128-ctr"]);
        source["sshTerminalConfigOverride"]["tcpOptions"]["tcpKeepAlive"] = false.into();
        assert_eq!(
            build_with_settings(&source, None, false, &settings)
                .unwrap()
                .keep_alive_interval,
            None
        );
        source["sshTerminalConfigOverride"]["tcpOptions"]["ipProtocol"] = "bogus".into();
        assert!(build_with_settings(&source, None, false, &settings).is_err());
    }
    #[test]
    fn partial_terminal_settings_follow_actual_terminal_legacy_fallbacks() {
        let mut source = row();
        source["sshConnectTimeout"] = 43.into();
        source["sshKeepAliveInterval"] = 27.into();
        for settings in [
            Value::Null,
            json!({"sshTerminal":{}}),
            json!({"sshTerminal":{"tcpOptions":{}}}),
        ] {
            let config = build_with_settings(&source, None, false, &settings).unwrap();
            assert_eq!(config.connect_timeout, Some(43));
            assert_eq!(config.keep_alive_interval, None);
        }
        source["sshTerminalConfigOverride"] = json!({"tcpOptions":{"tcpKeepAlive":true}});
        let config = build_with_settings(&source, None, false, &Value::Null).unwrap();
        assert_eq!(config.keep_alive_interval, Some(27));
        assert_eq!(config.connect_timeout, Some(43));
        source.as_object_mut().unwrap().remove("sshConnectTimeout");
        source
            .as_object_mut()
            .unwrap()
            .remove("sshKeepAliveInterval");
        let config = build_with_settings(&source, None, false, &Value::Null).unwrap();
        assert_eq!(config.connect_timeout, Some(30));
        assert_eq!(config.keep_alive_interval, Some(30));
    }
    #[test]
    fn template_only_and_mixed_routes_are_never_silently_replaced_by_direct_tcp() {
        for options in [
            json!({"proxyCommandTemplate":"nc"}),
            json!({"mixedChain":{"hops":[{"type":"proxy","host":"proxy.example.test","port":1080}]}}),
        ] {
            let mut source = row();
            source["sshConnectionConfigOverride"] = options.clone();
            assert!(build(&source, None, false).is_err());
            assert!(
                build_with_settings(&row(), None, false, &json!({"sshConnection":options}))
                    .is_err()
            );
        }
    }
    #[test]
    fn selects_local_config_without_disabling_host_key_verification() {
        let config = build(&row(), None, false).unwrap();
        assert_eq!(config.host, "ssh.example.test");
        assert!(config.strict_host_key_checking);
        assert!(!config.accept_new_host_keys);
        assert!(!config.allow_agent_auth);
    }
    #[test]
    fn linked_ssh_uses_the_same_effective_endpoint_as_an_ordinary_terminal() {
        let mut source = row();
        source["hostname"] = "127.0.0.1".into();
        source["port"] = 2222.into();
        source["integration"] = json!({"host":"actual-ssh.example.test", "port":10000});
        let config = build(&source, None, false).unwrap();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 2222);
        assert!(config.strict_host_key_checking);
        // Choosing a vault changes credentials, never the saved endpoint.
        let vault = json!({"facets":{"username":"vault-account","password":"vault-password"}});
        assert_eq!(
            build(&source, Some(&vault), false).unwrap().host,
            config.host
        );
        // Explicit inline routes do not borrow a linked-record compatibility host.
        source["host"] = "inline-ssh.example.test".into();
        assert_eq!(
            build(&source, None, true).unwrap().host,
            "inline-ssh.example.test"
        );
        for integration in [
            Value::Null,
            json!({}),
            json!({"host":null}),
            json!({"host":""}),
        ] {
            source["integration"] = integration;
            assert_eq!(build(&source, None, false).unwrap().host, "127.0.0.1");
        }
    }
    #[test]
    fn retained_integration_metadata_cannot_redirect_a_saved_ssh_endpoint() {
        for integration in [
            json!(false),
            json!("not-an-object"),
            json!({"host":false}),
            json!({"host":"https://ssh.example.test"}),
            json!({"host":"user@ssh.example.test"}),
            json!({"host":"ssh.example.test:22"}),
            json!({"host":"ssh.example.test\n"}),
        ] {
            let mut source = row();
            source["integration"] = integration;
            assert_eq!(
                build(&source, None, false).unwrap().host,
                "ssh.example.test"
            );
        }
    }
    #[test]
    fn omitted_local_auth_type_preserves_saved_private_key_authentication() {
        for inline in [false, true] {
            let mut source = row();
            if inline {
                source["host"] = source["hostname"].clone();
            }
            source["privateKey"] = "fixture-key-path".into();
            let selector = if inline { "authMethod" } else { "authType" };
            for value in [None, Some(Value::Null), Some(json!(""))] {
                source.as_object_mut().unwrap().remove(selector);
                if let Some(value) = value {
                    source[selector] = value;
                }
                let config = build(&source, None, inline).unwrap();
                assert_eq!(config.private_key_path.as_deref(), Some("fixture-key-path"));
                assert!(config.strict_host_key_checking);
                assert!(!config.accept_new_host_keys);
            }
            for value in [json!(false), json!(23), json!({}), json!("unsupported")] {
                source[selector] = value;
                assert!(build(&source, None, inline).is_err());
            }
        }
    }
    #[test]
    fn empty_known_hosts_path_uses_the_normal_verified_default() {
        let mut source = row();
        source["sshKnownHostsPath"] = "".into();
        assert!(build(&source, None, false)
            .unwrap()
            .known_hosts_path
            .is_none());
        source["sshKnownHostsPath"] = "fixture-known-hosts".into();
        assert_eq!(
            build(&source, None, false)
                .unwrap()
                .known_hosts_path
                .as_deref(),
            Some("fixture-known-hosts")
        );
        source.as_object_mut().unwrap().remove("sshKnownHostsPath");
        source["sshConnectionConfigOverride"] = json!({"knownHostsPath":""});
        assert!(build(&source, None, false)
            .unwrap()
            .known_hosts_path
            .is_none());
        source["sshConnectionConfigOverride"]["knownHostsPath"] = "fixture-override".into();
        assert_eq!(
            build(&source, None, false)
                .unwrap()
                .known_hosts_path
                .as_deref(),
            Some("fixture-override")
        );
        source["sshKnownHostsPath"] = "".into();
        assert!(build(&source, None, false)
            .unwrap()
            .known_hosts_path
            .is_none());
        source["sshKnownHostsPath"] = false.into();
        assert!(build(&source, None, false).is_err());
        source.as_object_mut().unwrap().remove("sshKnownHostsPath");
        source["sshConnectionConfigOverride"]["knownHostsPath"] = false.into();
        assert!(build(&source, None, false).is_err());
    }
    #[test]
    fn local_key_inference_never_overrides_explicit_auth_or_vault_selection() {
        for inline in [false, true] {
            let mut source = row();
            if inline {
                source["host"] = source["hostname"].clone();
            }
            source["privateKey"] = "fixture-key-path".into();
            source[if inline { "authMethod" } else { "authType" }] = "password".into();
            let config = build(&source, None, inline).unwrap();
            assert!(config.private_key_path.is_none());
            assert!(!config.allow_agent_auth);
            source
                .as_object_mut()
                .unwrap()
                .remove(if inline { "authMethod" } else { "authType" });
            let vault = json!({"facets":{"username":"vault-account","password":"vault-password"}});
            let config = build(&source, Some(&vault), inline).unwrap();
            assert!(config.private_key_path.is_none());
            assert!(config.private_key_content.is_none());
            assert!(!config.allow_agent_auth);
            assert_eq!(config.username, "vault-account");
            assert!(build(
                &source,
                Some(&json!({"facets":{"username":"vault-account","privateKey":"vault-key"}})),
                inline
            )
            .is_err());
        }
    }
    #[test]
    fn vault_is_exclusive_and_private_key_material_is_not_a_file_path() {
        let vault = json!({"facets":{"username":"vault-account","privateKey":"fixture-private-key","passphrase":"fixture-passphrase"}});
        let mut source = row();
        source["authType"] = "key".into();
        source["privateKey"] = "fallback-file".into();
        let config = build(&source, Some(&vault), false).unwrap();
        assert_eq!(config.username, "vault-account");
        assert!(config.private_key_path.is_none());
        assert!(config.private_key_content.is_some());
        assert!(!config.allow_agent_auth);
        assert!(build(
            &source,
            Some(&json!({"facets":{"username":"account"}})),
            false
        )
        .is_err());
    }
    #[test]
    fn references_cannot_switch_database_or_mix_inline_credentials() {
        assert!(reference(
            &json!({"connectionId":"ssh","ownerDatabaseId":"other"}),
            "owner"
        )
        .is_err());
        assert!(reference(&json!({"connectionId":"ssh","password":"inline"}), "owner").is_err());
        assert_eq!(
            reference(
                &json!({"connectionId":"ssh","ownerDatabaseId":"owner"}),
                "owner"
            )
            .unwrap(),
            Some("ssh".into())
        );
    }
    #[test]
    fn upstream_routes_and_malformed_auth_never_fall_back_to_direct() {
        for edit in [
            json!({"security":{"proxy":{"enabled":true}}}),
            json!({"tunnelProfileId":"profile"}),
            json!({"sshConnectionConfigOverride":{"enableJumpHost":true}}),
            json!({"protocol":"https"}),
            json!({"port":0}),
            json!({"hostname":"[other-host]"}),
            json!({"hostname":"host:22"}),
            json!({"hostname":"host\u{001b}"}),
        ] {
            let mut source = row();
            for (k, v) in edit.as_object().unwrap() {
                source[k] = v.clone();
            }
            assert!(build(&source, None, false).is_err());
        }
    }
    #[test]
    fn selected_vault_totp_has_no_local_seed_fallback() {
        let mut source = row();
        source["authType"] = "totp".into();
        source["totpSecret"] = "LOCAL".into();
        let vault = json!({"facets":{"username":"vault","password":"pw","totp":[{"id":"selected","secret":"JBSWY3DPEHPK3PXP","algorithm":"sha1","digits":6,"period":30}]}});
        assert!(build(&source, Some(&vault), false).is_err());
        source["credentialSource"] = json!({"kind":"vault","totpId":"selected"});
        assert!(build(&source, Some(&vault), false)
            .unwrap()
            .totp_options
            .is_some());
    }
}

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

fn build(
    source: &Value,
    vault: Option<&Value>,
    inline: bool,
) -> Result<crate::ssh::SshConnectionConfig, NativeAuthorityError> {
    no_nested_route(source)?;
    if !inline
        && (source.get("protocol").and_then(Value::as_str) != Some("ssh")
            || source.get("isGroup") == Some(&Value::Bool(true)))
    {
        return Err(ERROR);
    }
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
        for (saved, native) in [
            ("connectTimeout", "connect_timeout"),
            ("keepAliveInterval", "keep_alive_interval"),
            ("knownHostsPath", "known_hosts_path"),
            ("tcpNoDelay", "tcp_no_delay"),
            ("tcpKeepAlive", "tcp_keepalive"),
            ("keepAliveProbes", "keepalive_probes"),
            ("ipProtocol", "ip_protocol"),
            ("enableCompression", "compression"),
            ("compressionLevel", "compression_level"),
            ("compressionConfig", "compression_config"),
            ("sshVersion", "ssh_version"),
            ("preferredCiphers", "preferred_ciphers"),
            ("preferredMACs", "preferred_macs"),
            ("preferredKeyExchanges", "preferred_kex"),
            (
                "preferredHostKeyAlgorithms",
                "preferred_host_key_algorithms",
            ),
            ("agentForwarding", "agent_forwarding"),
        ] {
            if let Some(value) = options.get(saved).filter(|v| !v.is_null()) {
                config[native] = value.clone();
            }
        }
    }
    for (saved, native) in [
        ("sshConnectTimeout", "connect_timeout"),
        ("sshKeepAliveInterval", "keep_alive_interval"),
        ("sshKnownHostsPath", "known_hosts_path"),
    ] {
        if let Some(value) = source.get(saved).filter(|v| !v.is_null()) {
            config[native] = value.clone();
        }
    }
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
    build(&source, vault.as_ref(), id.is_none())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row() -> Value {
        json!({"protocol":"ssh","hostname":"ssh.example.test","port":22,"username":"account","password":"fixture-password"})
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

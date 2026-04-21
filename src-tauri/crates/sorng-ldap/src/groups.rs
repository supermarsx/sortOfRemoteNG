//! LDAP group management.
use crate::error::LdapError;
use crate::types::*;

pub async fn list_groups(host: &LdapHost) -> Result<Vec<LdapGroup>, LdapError> {
    let opts = LdapSearchOpts {
        base_dn: host.base_dn.clone(),
        scope: LdapScope::Sub,
        filter: "(objectClass=posixGroup)".into(),
        attributes: vec![
            "cn".into(),
            "gidNumber".into(),
            "memberUid".into(),
            "description".into(),
        ],
        size_limit: None,
    };
    let result = crate::entries::search(host, &opts).await?;
    Ok(result.entries.iter().map(entry_to_group).collect())
}

pub async fn create_group(host: &LdapHost, opts: &CreateLdapGroupOpts) -> Result<(), LdapError> {
    let ou = opts.ou.as_deref().unwrap_or("groups");
    let dn = format!("cn={},ou={},{}", opts.cn, ou, host.base_dn);
    let mut attrs = std::collections::HashMap::new();
    attrs.insert("cn".into(), vec![opts.cn.clone()]);
    if let Some(gn) = opts.gid_number {
        attrs.insert("gidNumber".into(), vec![gn.to_string()]);
    }
    if let Some(ref d) = opts.description {
        attrs.insert("description".into(), vec![d.clone()]);
    }
    let entry = LdapEntry {
        dn,
        object_classes: vec!["posixGroup".into()],
        attributes: attrs,
    };
    crate::entries::add(host, &entry).await
}

pub async fn add_member(host: &LdapHost, group_dn: &str, uid: &str) -> Result<(), LdapError> {
    let ldif = format!("dn: {group_dn}\nchangetype: modify\nadd: memberUid\nmemberUid: {uid}");
    let mut args: Vec<&str> = vec!["-x", "-H", &host.ldap_uri];
    let bind_dn_ref;
    let bind_pw_ref;
    if let Some(ref dn) = host.bind_dn {
        bind_dn_ref = dn.clone();
        args.push("-D");
        args.push(&bind_dn_ref);
    }
    if let Some(ref pw) = host.bind_password {
        bind_pw_ref = pw.clone();
        args.push("-w");
        args.push(&bind_pw_ref);
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_ref()).collect();
    crate::client::exec_ok_with_stdin(host, "ldapmodify", &refs, ldif.as_bytes()).await?;
    Ok(())
}

fn entry_to_group(entry: &LdapEntry) -> LdapGroup {
    let get = |k: &str| {
        entry
            .attributes
            .get(k)
            .and_then(|v| v.first())
            .cloned()
            .unwrap_or_default()
    };
    LdapGroup {
        dn: entry.dn.clone(),
        cn: get("cn"),
        gid_number: entry
            .attributes
            .get("gidNumber")
            .and_then(|v| v.first())
            .and_then(|v| v.parse().ok()),
        members: entry
            .attributes
            .get("memberUid")
            .cloned()
            .unwrap_or_default(),
        description: entry
            .attributes
            .get("description")
            .and_then(|v| v.first())
            .cloned(),
    }
}

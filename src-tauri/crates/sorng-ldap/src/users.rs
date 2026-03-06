//! LDAP user management.
use crate::error::LdapError;
use crate::types::*;

pub async fn list_users(host: &LdapHost) -> Result<Vec<LdapUser>, LdapError> {
    let opts = LdapSearchOpts { base_dn: host.base_dn.clone(), scope: LdapScope::Sub, filter: "(objectClass=posixAccount)".into(), attributes: vec!["uid".into(), "cn".into(), "sn".into(), "givenName".into(), "mail".into(), "uidNumber".into(), "gidNumber".into(), "homeDirectory".into(), "loginShell".into(), "memberOf".into()], size_limit: None };
    let result = crate::entries::search(host, &opts).await?;
    Ok(result.entries.iter().map(entry_to_user).collect())
}

pub async fn create_user(host: &LdapHost, opts: &CreateLdapUserOpts) -> Result<(), LdapError> {
    let ou = opts.ou.as_deref().unwrap_or("users");
    let dn = format!("uid={},ou={},{}", opts.uid, ou, host.base_dn);
    let mut attrs = std::collections::HashMap::new();
    attrs.insert("uid".into(), vec![opts.uid.clone()]);
    attrs.insert("cn".into(), vec![opts.cn.clone()]);
    attrs.insert("sn".into(), vec![opts.sn.clone()]);
    if let Some(ref gn) = opts.given_name { attrs.insert("givenName".into(), vec![gn.clone()]); }
    if let Some(ref m) = opts.mail { attrs.insert("mail".into(), vec![m.clone()]); }
    if let Some(un) = opts.uid_number { attrs.insert("uidNumber".into(), vec![un.to_string()]); }
    if let Some(gn) = opts.gid_number { attrs.insert("gidNumber".into(), vec![gn.to_string()]); }
    if let Some(ref hd) = opts.home_directory { attrs.insert("homeDirectory".into(), vec![hd.clone()]); }
    if let Some(ref ls) = opts.login_shell { attrs.insert("loginShell".into(), vec![ls.clone()]); }
    let entry = LdapEntry { dn, object_classes: vec!["inetOrgPerson".into(), "posixAccount".into(), "shadowAccount".into()], attributes: attrs };
    crate::entries::add(host, &entry).await
}

fn entry_to_user(entry: &LdapEntry) -> LdapUser {
    let get = |k: &str| entry.attributes.get(k).and_then(|v| v.first()).cloned().unwrap_or_default();
    let get_opt = |k: &str| entry.attributes.get(k).and_then(|v| v.first()).cloned();
    LdapUser {
        dn: entry.dn.clone(), uid: get("uid"), cn: get("cn"), sn: get("sn"),
        given_name: get_opt("givenName"), display_name: get_opt("displayName"),
        mail: get_opt("mail"), uid_number: get_opt("uidNumber").and_then(|v| v.parse().ok()),
        gid_number: get_opt("gidNumber").and_then(|v| v.parse().ok()),
        home_directory: get_opt("homeDirectory"), login_shell: get_opt("loginShell"),
        member_of: entry.attributes.get("memberOf").cloned().unwrap_or_default(),
        disabled: false,
    }
}

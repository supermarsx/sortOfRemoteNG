//! Generic LDAP entry CRUD via ldapsearch/ldapadd/ldapmodify/ldapdelete.
use crate::client;
use crate::error::LdapError;
use crate::types::*;
use std::collections::HashMap;

pub async fn search(host: &LdapHost, opts: &LdapSearchOpts) -> Result<LdapSearchResult, LdapError> {
    let scope = match opts.scope {
        LdapScope::Base => "base",
        LdapScope::One => "one",
        LdapScope::Sub => "sub",
    };
    let mut args = vec!["-x", "-H", &host.ldap_uri, "-b", &opts.base_dn, "-s", scope];
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
    args.push(&opts.filter);
    for a in &opts.attributes {
        args.push(a);
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_ref()).collect();
    let stdout = client::exec_ok(host, "ldapsearch", &refs).await?;
    Ok(parse_ldif_search(&stdout))
}

pub async fn add(host: &LdapHost, entry: &LdapEntry) -> Result<(), LdapError> {
    let ldif = entry_to_ldif(entry);
    let mut args = vec!["-x", "-H", &host.ldap_uri];
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
    client::exec_ok_with_stdin(host, "ldapadd", &refs, ldif.as_bytes()).await?;
    Ok(())
}

pub async fn delete(host: &LdapHost, dn: &str) -> Result<(), LdapError> {
    let mut args = vec!["-x", "-H", &host.ldap_uri];
    let bind_dn_ref;
    let bind_pw_ref;
    if let Some(ref d) = host.bind_dn {
        bind_dn_ref = d.clone();
        args.push("-D");
        args.push(&bind_dn_ref);
    }
    if let Some(ref p) = host.bind_password {
        bind_pw_ref = p.clone();
        args.push("-w");
        args.push(&bind_pw_ref);
    }
    args.push(dn);
    let refs: Vec<&str> = args.iter().map(|s| s.as_ref()).collect();
    client::exec_ok(host, "ldapdelete", &refs).await?;
    Ok(())
}

pub fn parse_ldif_search(output: &str) -> LdapSearchResult {
    let mut entries = Vec::new();
    let mut dn = String::new();
    let mut attrs: HashMap<String, Vec<String>> = HashMap::new();
    for line in output.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            if !dn.is_empty() {
                let oc = attrs.get("objectClass").cloned().unwrap_or_default();
                entries.push(LdapEntry {
                    dn: dn.clone(),
                    object_classes: oc,
                    attributes: attrs.clone(),
                });
                dn.clear();
                attrs.clear();
            }
            continue;
        }
        if line.starts_with("dn:") {
            dn = line[3..].trim().to_string();
        } else if let Some((k, v)) = line.split_once(':') {
            let v = v.trim().to_string();
            attrs.entry(k.trim().to_string()).or_default().push(v);
        }
    }
    if !dn.is_empty() {
        let oc = attrs.get("objectClass").cloned().unwrap_or_default();
        entries.push(LdapEntry {
            dn,
            object_classes: oc,
            attributes: attrs,
        });
    }
    let total = entries.len() as u32;
    LdapSearchResult {
        entries,
        referrals: Vec::new(),
        total,
    }
}

fn entry_to_ldif(entry: &LdapEntry) -> String {
    let mut lines = vec![format!("dn: {}", entry.dn)];
    for oc in &entry.object_classes {
        lines.push(format!("objectClass: {oc}"));
    }
    for (k, vals) in &entry.attributes {
        if k == "objectClass" {
            continue;
        }
        for v in vals {
            lines.push(format!("{k}: {v}"));
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_ldif() {
        let output = "dn: uid=john,ou=users,dc=example,dc=com\nobjectClass: inetOrgPerson\nobjectClass: posixAccount\nuid: john\ncn: John Doe\n\n";
        let result = parse_ldif_search(output);
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].dn, "uid=john,ou=users,dc=example,dc=com");
        assert_eq!(result.entries[0].object_classes.len(), 2);
    }
}

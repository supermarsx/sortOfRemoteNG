//! LDIF import/export.
use crate::client;
use crate::error::LdapError;
use crate::types::*;

pub async fn import_ldif(host: &LdapHost, ldif_path: &str) -> Result<String, LdapError> {
    client::exec_ok(host, "ldapadd", &["-x", "-H", &host.ldap_uri, "-D", host.bind_dn.as_deref().unwrap_or(""), "-w", host.bind_password.as_deref().unwrap_or(""), "-f", ldif_path]).await
}

pub async fn export_ldif(host: &LdapHost, output_path: &str) -> Result<(), LdapError> {
    let cmd = format!("ldapsearch -x -H {} -b '{}' -D '{}' -w '{}' > {}",
        host.ldap_uri, host.base_dn, host.bind_dn.as_deref().unwrap_or(""), host.bind_password.as_deref().unwrap_or(""), output_path);
    client::exec_ok(host, "sh", &["-c", &cmd]).await?; Ok(())
}

pub fn parse_ldif(content: &str) -> Vec<LdifRecord> {
    let mut records = Vec::new();
    let mut dn = String::new();
    let mut attrs = std::collections::HashMap::new();
    let mut change_type = LdifChangeType::Add;
    for line in content.lines() {
        if line.trim().is_empty() {
            if !dn.is_empty() { records.push(LdifRecord { dn: dn.clone(), change_type: change_type.clone(), attributes: attrs.clone() }); dn.clear(); attrs.clear(); change_type = LdifChangeType::Add; }
            continue;
        }
        if line.starts_with('#') { continue; }
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim(); let v = v.trim().to_string();
            if k == "dn" { dn = v; }
            else if k == "changetype" { change_type = match v.as_str() { "add" => LdifChangeType::Add, "delete" => LdifChangeType::Delete, "modify" => LdifChangeType::Modify, "modrdn" => LdifChangeType::ModRdn, _ => LdifChangeType::Add }; }
            else { attrs.entry(k.to_string()).or_insert_with(Vec::new).push(v); }
        }
    }
    if !dn.is_empty() { records.push(LdifRecord { dn, change_type, attributes: attrs }); }
    records
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_ldif() {
        let content = "dn: uid=test,dc=example,dc=com\nobjectClass: inetOrgPerson\ncn: Test User\nsn: User\n\ndn: uid=test2,dc=example,dc=com\nchangetype: delete\n";
        let records = parse_ldif(content);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].change_type, LdifChangeType::Add);
        assert_eq!(records[1].change_type, LdifChangeType::Delete);
    }
}

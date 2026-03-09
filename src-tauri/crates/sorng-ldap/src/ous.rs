//! Organizational unit management.
use crate::error::LdapError;
use crate::types::*;

pub async fn list_ous(host: &LdapHost) -> Result<Vec<OrganizationalUnit>, LdapError> {
    let opts = LdapSearchOpts {
        base_dn: host.base_dn.clone(),
        scope: LdapScope::One,
        filter: "(objectClass=organizationalUnit)".into(),
        attributes: vec!["ou".into(), "description".into()],
        size_limit: None,
    };
    let result = crate::entries::search(host, &opts).await?;
    Ok(result
        .entries
        .iter()
        .map(|e| OrganizationalUnit {
            dn: e.dn.clone(),
            ou: e
                .attributes
                .get("ou")
                .and_then(|v| v.first())
                .cloned()
                .unwrap_or_default(),
            description: e
                .attributes
                .get("description")
                .and_then(|v| v.first())
                .cloned(),
        })
        .collect())
}

pub async fn create_ou(
    host: &LdapHost,
    ou_name: &str,
    description: Option<&str>,
) -> Result<(), LdapError> {
    let dn = format!("ou={},{}", ou_name, host.base_dn);
    let mut attrs = std::collections::HashMap::new();
    attrs.insert("ou".into(), vec![ou_name.to_string()]);
    if let Some(d) = description {
        attrs.insert("description".into(), vec![d.to_string()]);
    }
    let entry = LdapEntry {
        dn,
        object_classes: vec!["organizationalUnit".into()],
        attributes: attrs,
    };
    crate::entries::add(host, &entry).await
}

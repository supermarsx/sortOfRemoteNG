//! LDAP schema browsing.
use crate::client;
use crate::error::LdapError;
use crate::types::*;

pub async fn list_schemas(host: &LdapHost) -> Result<Vec<LdapSchema>, LdapError> {
    let stdout = client::exec_ok(
        host,
        "ldapsearch",
        &[
            "-x",
            "-H",
            &host.ldap_uri,
            "-b",
            "cn=schema,cn=config",
            "-s",
            "one",
            "cn",
        ],
    )
    .await?;
    let result = crate::entries::parse_ldif_search(&stdout);
    Ok(result
        .entries
        .iter()
        .map(|e| LdapSchema {
            name: e
                .attributes
                .get("cn")
                .and_then(|v| v.first())
                .cloned()
                .unwrap_or_default(),
            oid: String::new(),
            description: None,
            attributes: Vec::new(),
            object_classes: Vec::new(),
        })
        .collect())
}

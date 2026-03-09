//! Data types for every FreeIPA domain: connections, users, groups, hosts,
//! services, DNS, RBAC, certificates, sudo, HBAC, trusts, and dashboard.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════
//  CONNECTION
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeIpaConnectionConfig {
    pub server_url: String,
    pub username: String,
    #[serde(skip_serializing)]
    pub password: String,
    pub realm: Option<String>,
    pub verify_ssl: Option<bool>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeIpaConnectionSummary {
    pub server_url: String,
    pub realm: String,
    pub authenticated_user: Option<String>,
}

// ── JSON-RPC envelope ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpaResponse<T> {
    pub result: Option<IpaResult<T>>,
    pub error: Option<IpaApiError>,
    pub id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpaResult<T> {
    pub result: T,
    pub count: Option<u32>,
    pub truncated: Option<bool>,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpaApiError {
    pub code: i32,
    pub name: String,
    pub message: String,
}

// ═══════════════════════════════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaUser {
    pub uid: String,
    pub givenname: Option<String>,
    pub sn: Option<String>,
    pub cn: Option<String>,
    pub displayname: Option<String>,
    pub mail: Option<Vec<String>>,
    pub telephonenumber: Option<Vec<String>>,
    pub title: Option<String>,
    pub ou: Option<String>,
    pub manager: Option<String>,
    pub homedirectory: Option<String>,
    pub loginshell: Option<String>,
    pub uidnumber: Option<u32>,
    pub gidnumber: Option<u32>,
    pub nsaccountlock: Option<bool>,
    pub krbprincipalname: Option<Vec<String>>,
    pub memberof_group: Option<Vec<String>>,
    pub memberof_role: Option<Vec<String>>,
    pub memberof_hbacrule: Option<Vec<String>>,
    pub memberof_sudorule: Option<Vec<String>>,
    pub sshpubkeyfp: Option<Vec<String>>,
    pub ipasshpubkey: Option<Vec<String>>,
    pub krblastpwdchange: Option<String>,
    pub krbpasswordexpiration: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
    pub uid: String,
    pub givenname: String,
    pub sn: String,
    pub cn: Option<String>,
    pub displayname: Option<String>,
    pub mail: Option<String>,
    pub userpassword: Option<String>,
    pub loginshell: Option<String>,
    pub homedirectory: Option<String>,
    pub title: Option<String>,
    pub ou: Option<String>,
    pub telephonenumber: Option<String>,
    pub manager: Option<String>,
    pub gidnumber: Option<u32>,
    pub ipasshpubkey: Option<Vec<String>>,
    pub noprivate: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModifyUserRequest {
    pub givenname: Option<String>,
    pub sn: Option<String>,
    pub cn: Option<String>,
    pub displayname: Option<String>,
    pub mail: Option<Vec<String>>,
    pub title: Option<String>,
    pub ou: Option<String>,
    pub manager: Option<String>,
    pub loginshell: Option<String>,
    pub telephonenumber: Option<Vec<String>>,
    pub ipasshpubkey: Option<Vec<String>>,
    pub nsaccountlock: Option<bool>,
    pub userpassword: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  GROUPS
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaGroup {
    pub cn: String,
    pub description: Option<String>,
    pub gidnumber: Option<u32>,
    pub member_user: Option<Vec<String>>,
    pub member_group: Option<Vec<String>>,
    pub memberof_group: Option<Vec<String>>,
    pub memberof_role: Option<Vec<String>>,
    pub memberof_hbacrule: Option<Vec<String>>,
    pub memberof_sudorule: Option<Vec<String>>,
    pub posix: Option<bool>,
    pub external: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupRequest {
    pub cn: String,
    pub description: Option<String>,
    pub gidnumber: Option<u32>,
    pub posix: Option<bool>,
    pub external: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════
//  HOSTS
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaHost {
    pub fqdn: String,
    pub description: Option<String>,
    pub ip_address: Option<String>,
    pub locality: Option<String>,
    pub location: Option<String>,
    pub platform: Option<String>,
    pub operating_system: Option<String>,
    pub ns_hardware_platform: Option<String>,
    pub userpassword: Option<bool>,
    pub has_keytab: Option<bool>,
    pub managedby_host: Option<Vec<String>>,
    pub memberof_hostgroup: Option<Vec<String>>,
    pub memberof_hbacrule: Option<Vec<String>>,
    pub memberof_sudorule: Option<Vec<String>>,
    pub krbprincipalname: Option<Vec<String>>,
    pub sshpubkeyfp: Option<Vec<String>>,
    pub has_password: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateHostRequest {
    pub fqdn: String,
    pub description: Option<String>,
    pub ip_address: Option<String>,
    pub userpassword: Option<String>,
    pub force: Option<bool>,
    pub locality: Option<String>,
    pub ns_hardware_platform: Option<String>,
    pub ns_os_version: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  SERVICES
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaService {
    pub krbprincipalname: Vec<String>,
    pub managedby_host: Option<Vec<String>>,
    pub has_keytab: Option<bool>,
    pub ipakrbokasdelegate: Option<bool>,
    pub ipakrbrequirespreauth: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateServiceRequest {
    pub krbprincipalname: String,
    pub force: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════
//  DNS
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DnsZone {
    pub idnsname: String,
    pub idnszoneactive: Option<bool>,
    pub idnssoamname: Option<String>,
    pub idnssoarname: Option<String>,
    pub idnssoaserial: Option<u64>,
    pub idnssoarefresh: Option<u32>,
    pub idnssoaretry: Option<u32>,
    pub idnssoaexpire: Option<u32>,
    pub idnssoaminimum: Option<u32>,
    pub nsrecord: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecord {
    pub idnsname: String,
    pub record_type: String,
    pub dnsrecords: serde_json::Value,
    pub dnsttl: Option<u32>,
    pub dnsclass: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateDnsZoneRequest {
    pub idnsname: String,
    pub idnssoamname: Option<String>,
    pub idnssoarname: Option<String>,
    pub idnssoarefresh: Option<u32>,
    pub idnssoaretry: Option<u32>,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddDnsRecordRequest {
    pub zone: String,
    pub record_name: String,
    pub record_type: String,
    pub record_data: String,
    pub ttl: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════
//  RBAC
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaRole {
    pub cn: String,
    pub description: Option<String>,
    pub member_user: Option<Vec<String>>,
    pub member_group: Option<Vec<String>>,
    pub member_host: Option<Vec<String>>,
    pub member_hostgroup: Option<Vec<String>>,
    pub member_service: Option<Vec<String>>,
    pub memberof_privilege: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaPrivilege {
    pub cn: String,
    pub description: Option<String>,
    pub memberof_permission: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaPermission {
    pub cn: String,
    pub description: Option<String>,
    pub ipapermlocation: Option<String>,
    pub ipapermtarget: Option<String>,
    pub ipapermright: Option<Vec<String>>,
    pub attrs: Option<Vec<String>>,
    pub memberof: Option<Vec<String>>,
    #[serde(rename = "type")]
    pub type_field: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoleRequest {
    pub cn: String,
    pub description: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  CERTIFICATES
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaCertificate {
    pub serial_number: u64,
    pub subject: String,
    pub issuer: String,
    pub valid_not_before: String,
    pub valid_not_after: String,
    pub status: String,
    pub revoked: Option<bool>,
    pub certificate: Option<String>,
    pub san: Option<Vec<String>>,
    pub owner_user: Option<Vec<String>>,
    pub owner_host: Option<Vec<String>>,
    pub owner_service: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CertRequestParams {
    pub principal: String,
    pub csr: String,
    pub profile_id: Option<String>,
    pub add_principal: Option<bool>,
}

// ═══════════════════════════════════════════════════════════════════════
//  SUDO
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaSudoRule {
    pub cn: String,
    pub description: Option<String>,
    pub ipaenabledflag: Option<bool>,
    pub usercategory: Option<String>,
    pub hostcategory: Option<String>,
    pub cmdcategory: Option<String>,
    pub memberuser_user: Option<Vec<String>>,
    pub memberuser_group: Option<Vec<String>>,
    pub memberhost_host: Option<Vec<String>>,
    pub memberhost_hostgroup: Option<Vec<String>>,
    pub memberallowcmd_sudocmd: Option<Vec<String>>,
    pub memberallowcmd_sudocmdgroup: Option<Vec<String>>,
    pub memberdenycmd_sudocmd: Option<Vec<String>>,
    pub memberdenycmd_sudocmdgroup: Option<Vec<String>>,
    pub ipasudoopt: Option<Vec<String>>,
    pub ipasudorunasusercategory: Option<String>,
    pub ipasudorunasgroupcategory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaSudoCmd {
    pub sudocmd: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaSudoCmdGroup {
    pub cn: String,
    pub description: Option<String>,
    pub member_sudocmd: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateSudoRuleRequest {
    pub cn: String,
    pub description: Option<String>,
    pub usercategory: Option<String>,
    pub hostcategory: Option<String>,
    pub cmdcategory: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  HBAC
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaHbacRule {
    pub cn: String,
    pub description: Option<String>,
    pub ipaenabledflag: Option<bool>,
    pub usercategory: Option<String>,
    pub hostcategory: Option<String>,
    pub servicecategory: Option<String>,
    pub memberuser_user: Option<Vec<String>>,
    pub memberuser_group: Option<Vec<String>>,
    pub memberhost_host: Option<Vec<String>>,
    pub memberhost_hostgroup: Option<Vec<String>>,
    pub memberservice_hbacsvc: Option<Vec<String>>,
    pub memberservice_hbacsvcgroup: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaHbacService {
    pub cn: String,
    pub description: Option<String>,
    pub memberof_hbacsvcgroup: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateHbacRuleRequest {
    pub cn: String,
    pub description: Option<String>,
    pub usercategory: Option<String>,
    pub hostcategory: Option<String>,
    pub servicecategory: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  TRUSTS
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IpaTrust {
    pub cn: String,
    pub ipantflatname: Option<String>,
    pub ipanttrusteddomainsid: Option<String>,
    pub trusttype: Option<String>,
    pub trustdirection: Option<String>,
    pub trust_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateTrustRequest {
    pub realm: String,
    pub admin: String,
    #[serde(skip_serializing)]
    pub password: String,
    pub trust_type: Option<String>,
    pub base_id: Option<u32>,
    pub range_size: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FreeIpaDashboard {
    pub total_users: u64,
    pub active_users: u64,
    pub disabled_users: u64,
    pub total_groups: u64,
    pub total_hosts: u64,
    pub total_services: u64,
    pub total_dns_zones: u64,
    pub total_sudo_rules: u64,
    pub total_hbac_rules: u64,
    pub total_roles: u64,
    pub total_trusts: u64,
    pub total_certificates: u64,
    pub expired_certificates: u64,
}

// ═══════════════════════════════════════════════════════════════════════
//  MEMBER OPERATIONS
// ═══════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemberResult {
    pub completed: Option<u32>,
    pub failed: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════

/// Extract the first value from an `Option<Vec<String>>` field.
pub fn first_value(v: &Option<Vec<String>>) -> Option<&str> {
    v.as_ref().and_then(|v| v.first().map(|s| s.as_str()))
}

/// Extract all values from a multi-valued field.
pub fn all_values(v: &Option<Vec<String>>) -> Vec<&str> {
    match v {
        Some(vals) => vals.iter().map(|s| s.as_str()).collect(),
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_value_some() {
        let v = Some(vec!["alice".into()]);
        assert_eq!(first_value(&v), Some("alice"));
    }

    #[test]
    fn first_value_none() {
        let v: Option<Vec<String>> = None;
        assert_eq!(first_value(&v), None);
    }

    #[test]
    fn serde_roundtrip_user() {
        let user = IpaUser {
            uid: "jdoe".into(),
            givenname: Some("John".into()),
            sn: Some("Doe".into()),
            mail: Some(vec!["jdoe@example.com".into()]),
            ..Default::default()
        };
        let json = serde_json::to_string(&user).unwrap();
        let deserialized: IpaUser = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.uid, "jdoe");
        assert_eq!(deserialized.givenname.as_deref(), Some("John"));
    }

    #[test]
    fn serde_roundtrip_group() {
        let group = IpaGroup {
            cn: "admins".into(),
            description: Some("Admin group".into()),
            posix: Some(true),
            ..Default::default()
        };
        let json = serde_json::to_string(&group).unwrap();
        let deserialized: IpaGroup = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.cn, "admins");
        assert_eq!(deserialized.posix, Some(true));
    }

    #[test]
    fn serde_roundtrip_host() {
        let host = IpaHost {
            fqdn: "web1.example.com".into(),
            ip_address: Some("10.0.0.1".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&host).unwrap();
        let deserialized: IpaHost = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.fqdn, "web1.example.com");
    }

    #[test]
    fn serde_roundtrip_dns_zone() {
        let zone = DnsZone {
            idnsname: "example.com.".into(),
            idnszoneactive: Some(true),
            ..Default::default()
        };
        let json = serde_json::to_string(&zone).unwrap();
        let deserialized: DnsZone = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.idnsname, "example.com.");
    }

    #[test]
    fn serde_roundtrip_role() {
        let role = IpaRole {
            cn: "helpdesk".into(),
            description: Some("Helpdesk operators".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&role).unwrap();
        let deserialized: IpaRole = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.cn, "helpdesk");
    }

    #[test]
    fn serde_roundtrip_sudo_rule() {
        let rule = IpaSudoRule {
            cn: "allow_all".into(),
            ipaenabledflag: Some(true),
            usercategory: Some("all".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&rule).unwrap();
        let deserialized: IpaSudoRule = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.cn, "allow_all");
    }

    #[test]
    fn serde_roundtrip_hbac_rule() {
        let rule = IpaHbacRule {
            cn: "allow_ssh".into(),
            servicecategory: Some("all".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&rule).unwrap();
        let deserialized: IpaHbacRule = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.cn, "allow_ssh");
    }

    #[test]
    fn serde_roundtrip_trust() {
        let trust = IpaTrust {
            cn: "ad.example.com".into(),
            ipantflatname: Some("AD".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&trust).unwrap();
        let deserialized: IpaTrust = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.cn, "ad.example.com");
    }

    #[test]
    fn serde_roundtrip_certificate() {
        let cert = IpaCertificate {
            serial_number: 12345,
            subject: "CN=test".into(),
            issuer: "CN=IPA CA".into(),
            valid_not_before: "2024-01-01".into(),
            valid_not_after: "2025-01-01".into(),
            status: "VALID".into(),
            ..Default::default()
        };
        let json = serde_json::to_string(&cert).unwrap();
        let deserialized: IpaCertificate = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.serial_number, 12345);
    }

    #[test]
    fn serde_roundtrip_dashboard() {
        let dash = FreeIpaDashboard {
            total_users: 100,
            active_users: 90,
            disabled_users: 10,
            total_groups: 20,
            ..Default::default()
        };
        let json = serde_json::to_string(&dash).unwrap();
        let deserialized: FreeIpaDashboard = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.total_users, 100);
        assert_eq!(deserialized.disabled_users, 10);
    }

    #[test]
    fn serde_roundtrip_service() {
        let svc = IpaService {
            krbprincipalname: vec!["HTTP/web.example.com@EXAMPLE.COM".into()],
            has_keytab: Some(true),
            ..Default::default()
        };
        let json = serde_json::to_string(&svc).unwrap();
        let deserialized: IpaService = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.krbprincipalname.len(), 1);
    }

    #[test]
    fn serde_roundtrip_permission() {
        let perm = IpaPermission {
            cn: "System: Read Users".into(),
            type_field: Some("user".into()),
            ipapermright: Some(vec!["read".into()]),
            ..Default::default()
        };
        let json = serde_json::to_string(&perm).unwrap();
        let deserialized: IpaPermission = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.cn, "System: Read Users");
    }

    #[test]
    fn connection_config_skip_password() {
        let cfg = FreeIpaConnectionConfig {
            server_url: "https://ipa.example.com".into(),
            username: "admin".into(),
            password: "secret".into(),
            realm: None,
            verify_ssl: Some(true),
            timeout_secs: None,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("secret"));
    }

    #[test]
    fn deserialize_ipa_response() {
        let json = r#"{
            "result": {
                "result": [{"uid": "admin"}],
                "count": 1,
                "truncated": false,
                "summary": "1 user matched"
            },
            "error": null,
            "id": 0
        }"#;
        let resp: IpaResponse<Vec<serde_json::Value>> = serde_json::from_str(json).unwrap();
        assert!(resp.error.is_none());
        let envelope = resp.result.unwrap();
        assert_eq!(envelope.count, Some(1));
    }

    #[test]
    fn create_trust_skips_password() {
        let req = CreateTrustRequest {
            realm: "AD.EXAMPLE.COM".into(),
            admin: "Administrator".into(),
            password: "s3cret".into(),
            ..Default::default()
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("s3cret"));
    }
}

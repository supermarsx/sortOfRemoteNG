//! Data types for every FreeIPA domain: connections, users, groups, hosts,
//! HBAC, sudo, DNS, certificates, policies, and dashboard summary.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════
//  CONNECTION
// ═══════════════════════════════════════════════════════════════════════

/// Configuration required to connect to a FreeIPA server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeIpaConnectionConfig {
    /// Unique connection identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Base URL, e.g. `https://ipa.example.com`.
    pub server_url: String,
    /// Admin / service account username.
    pub username: String,
    /// Password (never serialised to the frontend).
    #[serde(skip_serializing)]
    pub password: String,
    /// Verify TLS certificate.
    #[serde(default = "default_true")]
    pub verify_ssl: bool,
    /// Optional path to a PEM CA bundle.
    pub ca_cert_path: Option<String>,
    /// Kerberos realm, e.g. `EXAMPLE.COM`.
    pub realm: Option<String>,
}

/// Safe connection metadata returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeIpaConnectionInfo {
    pub id: String,
    pub name: String,
    pub server_url: String,
    pub connected: bool,
    pub realm: Option<String>,
    pub version: Option<String>,
}

// ── JSON-RPC envelope ───────────────────────────────────────────────

/// Top-level JSON-RPC response returned by `/ipa/session/json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeIpaApiResponse<T> {
    pub result: Option<FreeIpaResultEnvelope<T>>,
    pub error: Option<FreeIpaApiError>,
    pub id: i32,
}

/// The `result` object inside the JSON-RPC response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeIpaResultEnvelope<T> {
    pub result: T,
    pub count: Option<u32>,
    pub truncated: Option<bool>,
    pub summary: Option<String>,
}

/// Error block returned by FreeIPA when a call fails.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeIpaApiError {
    pub code: i32,
    pub message: String,
    pub name: String,
    pub data: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════════════════════════════

/// A FreeIPA user entry.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpaUser {
    pub uid: Option<Vec<String>>,
    pub givenname: Option<Vec<String>>,
    pub sn: Option<Vec<String>>,
    pub cn: Option<Vec<String>>,
    pub displayname: Option<Vec<String>>,
    pub mail: Option<Vec<String>>,
    pub uidnumber: Option<Vec<String>>,
    pub gidnumber: Option<Vec<String>>,
    pub homedirectory: Option<Vec<String>>,
    pub loginshell: Option<Vec<String>>,
    pub krbprincipalname: Option<Vec<String>>,
    pub sshpubkeyfp: Option<Vec<String>>,
    pub nsaccountlock: Option<Vec<String>>,
    pub memberof_group: Option<Vec<String>>,
    pub memberof_hbacrule: Option<Vec<String>>,
    pub memberof_sudorule: Option<Vec<String>>,
    pub krbpasswordexpiration: Option<Vec<String>>,
    pub krblastpwdchange: Option<Vec<String>>,
    pub has_password: Option<bool>,
    pub has_keytab: Option<bool>,
}

/// Request body for `user_add`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    pub sshpubkey: Option<Vec<String>>,
    /// Generate a random password.
    pub random: Option<bool>,
}

/// Request body for `user_mod`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModifyUserRequest {
    pub givenname: Option<String>,
    pub sn: Option<String>,
    pub displayname: Option<String>,
    pub mail: Option<String>,
    pub loginshell: Option<String>,
    pub homedirectory: Option<String>,
    pub sshpubkey: Option<Vec<String>>,
    pub nsaccountlock: Option<bool>,
    pub userpassword: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  GROUPS
// ═══════════════════════════════════════════════════════════════════════

/// A FreeIPA group entry.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpaGroup {
    pub cn: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub gidnumber: Option<Vec<String>>,
    pub member_user: Option<Vec<String>>,
    pub member_group: Option<Vec<String>>,
    pub memberof_group: Option<Vec<String>>,
    pub memberof_hbacrule: Option<Vec<String>>,
    pub memberof_sudorule: Option<Vec<String>>,
    pub memberindirect_user: Option<Vec<String>>,
    pub memberindirect_group: Option<Vec<String>>,
    pub posix: Option<bool>,
    pub external: Option<bool>,
}

/// Request body for `group_add`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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

/// A FreeIPA host entry.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpaHost {
    pub fqdn: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub locality: Option<Vec<String>>,
    #[serde(rename = "nshostlocation")]
    pub location: Option<Vec<String>>,
    pub platform: Option<Vec<String>>,
    #[serde(rename = "nshardwareplatform")]
    pub operatingsystem: Option<Vec<String>>,
    pub operatingsystemversion: Option<Vec<String>>,
    pub sshpubkeyfp: Option<Vec<String>>,
    pub managedby_host: Option<Vec<String>>,
    pub memberof_hostgroup: Option<Vec<String>>,
    pub memberof_hbacrule: Option<Vec<String>>,
    pub memberof_sudorule: Option<Vec<String>>,
    pub has_keytab: Option<bool>,
    pub has_password: Option<bool>,
    #[serde(rename = "ipakrbokasdelegate")]
    pub ip_address: Option<Vec<String>>,
    pub krbprincipalname: Option<Vec<String>>,
}

/// A FreeIPA host group.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpaHostGroup {
    pub cn: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub member_host: Option<Vec<String>>,
    pub member_hostgroup: Option<Vec<String>>,
    pub memberof_hbacrule: Option<Vec<String>>,
    pub memberof_sudorule: Option<Vec<String>>,
}

/// Request body for `host_add`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateHostRequest {
    pub fqdn: String,
    pub description: Option<String>,
    pub ip_address: Option<String>,
    pub force: Option<bool>,
    pub random: Option<bool>,
    pub userpassword: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  HBAC (Host-Based Access Control)
// ═══════════════════════════════════════════════════════════════════════

/// An HBAC rule.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HbacRule {
    pub cn: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub ipaenabledflag: Option<Vec<String>>,
    pub accessruletype: Option<Vec<String>>,
    pub usercategory: Option<Vec<String>>,
    pub hostcategory: Option<Vec<String>>,
    pub servicecategory: Option<Vec<String>>,
    pub memberuser_user: Option<Vec<String>>,
    pub memberuser_group: Option<Vec<String>>,
    pub memberhost_host: Option<Vec<String>>,
    pub memberhost_hostgroup: Option<Vec<String>>,
    pub memberservice_hbacsvc: Option<Vec<String>>,
    pub memberservice_hbacsvcgroup: Option<Vec<String>>,
}

/// An HBAC service.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HbacService {
    pub cn: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub memberof_hbacsvcgroup: Option<Vec<String>>,
}

/// An HBAC service group.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HbacServiceGroup {
    pub cn: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub member_hbacsvc: Option<Vec<String>>,
}

/// Request body for `hbacrule_add`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateHbacRuleRequest {
    pub cn: String,
    pub description: Option<String>,
    pub usercategory: Option<String>,
    pub hostcategory: Option<String>,
    pub servicecategory: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  SUDO RULES
// ═══════════════════════════════════════════════════════════════════════

/// A sudo rule.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SudoRule {
    pub cn: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub ipaenabledflag: Option<Vec<String>>,
    pub usercategory: Option<Vec<String>>,
    pub hostcategory: Option<Vec<String>>,
    pub cmdcategory: Option<Vec<String>>,
    pub runasusercategory: Option<Vec<String>>,
    pub runasgroupcategory: Option<Vec<String>>,
    pub memberuser_user: Option<Vec<String>>,
    pub memberuser_group: Option<Vec<String>>,
    pub memberhost_host: Option<Vec<String>>,
    pub memberhost_hostgroup: Option<Vec<String>>,
    pub memberallowcmd_sudocmd: Option<Vec<String>>,
    pub memberallowcmd_sudocmdgroup: Option<Vec<String>>,
    pub memberdenycmd_sudocmd: Option<Vec<String>>,
    pub ipasudoopt: Option<Vec<String>>,
    pub ipasudorunasusercategory: Option<Vec<String>>,
    pub externaluser: Option<Vec<String>>,
}

/// A sudo command.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SudoCommand {
    pub sudocmd: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub memberof_sudocmdgroup: Option<Vec<String>>,
}

/// A sudo command group.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SudoCommandGroup {
    pub cn: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub member_sudocmd: Option<Vec<String>>,
}

/// Request body for `sudorule_add`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateSudoRuleRequest {
    pub cn: String,
    pub description: Option<String>,
    pub usercategory: Option<String>,
    pub hostcategory: Option<String>,
    pub cmdcategory: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  DNS
// ═══════════════════════════════════════════════════════════════════════

/// A DNS zone.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DnsZone {
    pub idnsname: Option<Vec<String>>,
    pub idnszoneactive: Option<Vec<String>>,
    pub idnssoamname: Option<Vec<String>>,
    pub idnssoarname: Option<Vec<String>>,
    pub idnssoaserial: Option<Vec<String>>,
    pub idnssoarefresh: Option<Vec<String>>,
    pub idnssoaretry: Option<Vec<String>>,
    pub idnssoaexpire: Option<Vec<String>>,
    pub idnssoaminimum: Option<Vec<String>>,
    pub idnsforwardpolicy: Option<Vec<String>>,
    pub idnsforwarders: Option<Vec<String>>,
}

/// A DNS record within a zone.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DnsRecord {
    pub idnsname: Option<Vec<String>>,
    pub arecord: Option<Vec<String>>,
    pub aaaarecord: Option<Vec<String>>,
    pub cnamerecord: Option<Vec<String>>,
    pub mxrecord: Option<Vec<String>>,
    pub ptrrecord: Option<Vec<String>>,
    pub srvrecord: Option<Vec<String>>,
    pub txtrecord: Option<Vec<String>>,
    pub nsrecord: Option<Vec<String>>,
    pub dnsttl: Option<Vec<String>>,
}

/// Request body for `dnszone_add`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreateDnsZoneRequest {
    pub idnsname: String,
    pub idnssoamname: Option<String>,
    pub idnssoarname: Option<String>,
    pub name_from_ip: Option<String>,
    pub skip_overlap_check: Option<bool>,
}

/// Request body for `dnsrecord_add`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AddDnsRecordRequest {
    /// Zone name the record belongs to.
    pub dnszoneidnsname: String,
    /// Record name (e.g. `www`).
    pub idnsname: String,
    /// Record type: `a`, `aaaa`, `cname`, `mx`, `ptr`, `srv`, `txt`, `ns`.
    pub record_type: String,
    /// Record value.
    pub record_value: String,
    /// Optional TTL.
    pub dnsttl: Option<u32>,
}

/// Request body for `dnsrecord_mod`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModifyDnsRecordRequest {
    pub dnszoneidnsname: String,
    pub idnsname: String,
    pub record_type: String,
    pub record_value: String,
    pub dnsttl: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════
//  CERTIFICATES
// ═══════════════════════════════════════════════════════════════════════

/// A certificate returned by FreeIPA's CA.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpaCertificate {
    pub serial_number: Option<i64>,
    pub subject: Option<String>,
    pub issuer: Option<String>,
    pub valid_not_before: Option<String>,
    pub valid_not_after: Option<String>,
    pub status: Option<String>,
    pub revocation_reason: Option<i32>,
    pub certificate: Option<String>,
    pub san: Option<Vec<String>>,
}

/// Certificate signing request.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CertificateRequest {
    /// Kerberos principal the cert is issued to.
    pub principal: String,
    /// PEM-encoded CSR.
    pub csr: String,
    /// Certificate profile (e.g. `caIPAserviceCert`).
    pub profile_id: Option<String>,
    /// Automatically add the principal if missing.
    pub add: Option<bool>,
}

/// A Certificate Authority entry.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpaCertificateAuthority {
    pub cn: Option<Vec<String>>,
    pub description: Option<Vec<String>>,
    pub ipacaid: Option<Vec<String>>,
    pub ipacaissuerdn: Option<Vec<String>>,
    pub ipacasubjectdn: Option<Vec<String>>,
}

// ═══════════════════════════════════════════════════════════════════════
//  POLICIES
// ═══════════════════════════════════════════════════════════════════════

/// A password policy.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PasswordPolicy {
    pub krbmaxpwdlife: Option<Vec<String>>,
    pub krbminpwdlife: Option<Vec<String>>,
    pub krbpwdhistorylength: Option<Vec<String>>,
    pub krbpwdmindiffchars: Option<Vec<String>>,
    pub krbpwdminlength: Option<Vec<String>>,
    pub krbpwdmaxfailure: Option<Vec<String>>,
    pub krbpwdfailurecountinterval: Option<Vec<String>>,
    pub krbpwdlockoutduration: Option<Vec<String>>,
    pub cn: Option<Vec<String>>,
    pub cospriority: Option<Vec<String>>,
}

/// Request body for `pwpolicy_mod`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModifyPasswordPolicyRequest {
    pub cn: Option<String>,
    pub krbmaxpwdlife: Option<u32>,
    pub krbminpwdlife: Option<u32>,
    pub krbpwdhistorylength: Option<u32>,
    pub krbpwdmindiffchars: Option<u32>,
    pub krbpwdminlength: Option<u32>,
    pub krbpwdmaxfailure: Option<u32>,
    pub krbpwdfailurecountinterval: Option<u32>,
    pub krbpwdlockoutduration: Option<u32>,
}

/// A Kerberos ticket policy.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KerberosPolicy {
    pub krbmaxticketlife: Option<Vec<String>>,
    pub krbmaxrenewableage: Option<Vec<String>>,
}

/// Request body for `krbtpolicy_mod`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModifyKerberosPolicyRequest {
    pub krbmaxticketlife: Option<u32>,
    pub krbmaxrenewableage: Option<u32>,
}

/// Global IPA configuration.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IpaConfig {
    pub ipamaxusernamelength: Option<Vec<String>>,
    pub ipahomesrootdir: Option<Vec<String>>,
    pub ipadefaultloginshell: Option<Vec<String>>,
    pub ipadefaultprimarygroup: Option<Vec<String>>,
    pub ipasearchtimelimit: Option<Vec<String>>,
    pub ipasearchrecordslimit: Option<Vec<String>>,
    pub ipausersearchfields: Option<Vec<String>>,
    pub ipagroupsearchfields: Option<Vec<String>>,
    pub ipamigrationenabled: Option<Vec<String>>,
    pub ipacertificatesubjectbase: Option<Vec<String>>,
    pub ipapwdexpadvnotify: Option<Vec<String>>,
    pub ipaselinuxusermapdefault: Option<Vec<String>>,
    pub ipaselinuxusermaporder: Option<Vec<String>>,
    pub ipaconfigstring: Option<Vec<String>>,
    pub ipakrbauthzdata: Option<Vec<String>>,
}

/// Request body for `config_mod`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModifyConfigRequest {
    pub ipamaxusernamelength: Option<u32>,
    pub ipahomesrootdir: Option<String>,
    pub ipadefaultloginshell: Option<String>,
    pub ipadefaultprimarygroup: Option<String>,
    pub ipasearchtimelimit: Option<i32>,
    pub ipasearchrecordslimit: Option<i32>,
    pub ipapwdexpadvnotify: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════════════
//  DASHBOARD / SUMMARY
// ═══════════════════════════════════════════════════════════════════════

/// Aggregate dashboard for a FreeIPA server.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FreeIpaDashboard {
    pub server_url: String,
    pub realm: Option<String>,
    pub total_users: u32,
    pub active_users: u32,
    pub total_groups: u32,
    pub total_hosts: u32,
    pub total_hbac_rules: u32,
    pub total_sudo_rules: u32,
    pub total_dns_zones: u32,
    pub version: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
//  MEMBER OPERATIONS (shared across HBAC / sudo / groups / hosts)
// ═══════════════════════════════════════════════════════════════════════

/// Result of an add/remove member operation.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MemberResult {
    pub completed: Option<u32>,
    pub failed: Option<serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════

fn default_true() -> bool {
    true
}

/// Extract the first value from an `Option<Vec<String>>` field,
/// which is the standard FreeIPA multi-value format.
pub fn first_value(v: &Option<Vec<String>>) -> Option<&str> {
    v.as_ref().and_then(|v| v.first().map(|s| s.as_str()))
}

/// Extract all values from multi-valued field.
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
    fn create_user_request_defaults() {
        let r = CreateUserRequest {
            uid: "jdoe".into(),
            givenname: "John".into(),
            sn: "Doe".into(),
            ..Default::default()
        };
        assert_eq!(r.uid, "jdoe");
        assert!(r.mail.is_none());
    }

    #[test]
    fn connection_config_skip_password() {
        let cfg = FreeIpaConnectionConfig {
            id: "1".into(),
            name: "test".into(),
            server_url: "https://ipa.example.com".into(),
            username: "admin".into(),
            password: "secret".into(),
            verify_ssl: true,
            ca_cert_path: None,
            realm: None,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("secret"));
    }

    #[test]
    fn deserialize_api_response() {
        let json = r#"{
            "result": {
                "result": [{"uid": ["admin"]}],
                "count": 1,
                "truncated": false,
                "summary": "1 user matched"
            },
            "error": null,
            "id": 0
        }"#;
        let resp: FreeIpaApiResponse<Vec<serde_json::Value>> =
            serde_json::from_str(json).unwrap();
        assert!(resp.error.is_none());
        let envelope = resp.result.unwrap();
        assert_eq!(envelope.count, Some(1));
    }
}

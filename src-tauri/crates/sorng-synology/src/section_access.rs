//! Receipt-bound, read-only section access check (plan t84 §4.2).
//!
//! Every read of a section is probed and classified; nothing returns early.
//! API presence is not permission: only an authenticated successful read makes
//! data available. The account role DSM reports only chooses the explanation,
//! so a delegated administration role never hides a read DSM allows.
//!
//! The snapshot carries closed states, static API names, fixed explanations,
//! the signed-in username and closed session facts. It never contains NAS
//! data, hosts, URLs, SIDs, tokens or keys.
use crate::{
    api_access::{
        self, ApiPrivilege, ApiSpec, AppPrivilege, ReadCall, ReadSpec, DOWNLOAD_STATION,
        FILE_STATION, SURVEILLANCE_STATION,
    },
    client::ReadBudget,
    error::{SynologyError, SynologyErrorKind, SynologyResult},
    file_transfer::FileTransferContext,
    login_handshake::{
        LoginHandshake, SecondFactor, SessionIdentity, SessionProfile, SessionRoute,
    },
    response_diagnostics::Category,
    service::SynologyService,
};
use serde::{Deserialize, Serialize};
use std::{future::Future, sync::atomic::Ordering, time::Duration};
use tokio::time::Instant;

const INITDATA_API: &str = "SYNO.Core.Desktop.Initdata";

/// What one read shows for this session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadState {
    Available,
    RequiresAdministrator,
    SessionRestricted,
    RequiresApplicationPrivilege,
    PermissionDenied,
    PackageNotInstalled,
    NotSupported,
    Unknown,
}

impl ReadState {
    fn requirement(self) -> Option<AccessRequirement> {
        match self {
            Self::Available | Self::Unknown => None,
            Self::RequiresAdministrator => Some(AccessRequirement::Administrator),
            Self::SessionRestricted => Some(AccessRequirement::Session),
            Self::RequiresApplicationPrivilege => Some(AccessRequirement::ApplicationPrivilege),
            Self::PermissionDenied => Some(AccessRequirement::Permission),
            Self::PackageNotInstalled => Some(AccessRequirement::Package),
            Self::NotSupported => Some(AccessRequirement::DsmVersion),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SectionAccessStatus {
    Available,
    Partial,
    Denied,
    Unavailable,
    Unknown,
}

/// Why data is missing. Declared in dominance order: the first requirement
/// present among a section's reads explains the section.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessRequirement {
    Administrator,
    Session,
    ApplicationPrivilege,
    Permission,
    Package,
    DsmVersion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountRole {
    Administrator,
    Standard,
    Unknown,
}

/// DSM login session name of a named instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SessionName {
    FileStation,
    #[serde(rename = "webui")]
    Webui,
}

/// Who is signed in and how. Everything except `role` comes from the login
/// itself; no request is needed for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountAccess {
    pub signed_in_as: String,
    pub role: AccountRole,
    pub portal_session: bool,
    pub session_name: SessionName,
    pub login_handshake: LoginHandshake,
    pub auth_version: u32,
    pub route: SessionRoute,
    pub second_factor: SecondFactor,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReadAccess {
    pub field: &'static str,
    pub api: &'static str,
    pub state: ReadState,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionAccessSnapshot {
    pub section: &'static str,
    pub status: SectionAccessStatus,
    pub requirement: Option<AccessRequirement>,
    pub reason: String,
    pub account: AccountAccess,
    pub reads: Vec<ReadAccess>,
}

const KNOWN_APPLICATIONS: [&AppPrivilege; 3] =
    [&FILE_STATION, &DOWNLOAD_STATION, &SURVEILLANCE_STATION];
const ALL_APPLICATIONS: &str = "SYNO.ALLOW.ALL.APPLICATIONS";

/// What DSM's desktop bootstrap says about the signed-in account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AccountFacts {
    role: AccountRole,
    all_applications: Option<bool>,
    /// Indexed like `KNOWN_APPLICATIONS`.
    applications: [Option<bool>; 3],
}

impl AccountFacts {
    const UNKNOWN: Self = Self {
        role: AccountRole::Unknown,
        all_applications: None,
        applications: [None; 3],
    };

    fn application(self, app: &AppPrivilege) -> Option<bool> {
        if self.all_applications == Some(true) {
            return Some(true);
        }
        KNOWN_APPLICATIONS
            .iter()
            .position(|known| known.dsm_id == app.dsm_id)
            .and_then(|index| self.applications[index])
    }
}

/// `SYNO.Core.Desktop.Initdata` `get`: only these keys are decoded; the rest
/// of the (large) desktop bootstrap is skipped and never kept.
#[derive(Deserialize)]
struct Initdata {
    #[serde(rename = "Session", default)]
    session: Option<InitdataSession>,
    #[serde(rename = "AppPrivilege", default)]
    app_privilege: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct InitdataSession {
    #[serde(rename = "is_admin", default)]
    is_admin: Option<serde_json::Value>,
}

impl From<Initdata> for AccountFacts {
    fn from(initdata: Initdata) -> Self {
        let role = match initdata
            .session
            .and_then(|session| session.is_admin)
            .and_then(|value| value.as_bool())
        {
            Some(true) => AccountRole::Administrator,
            Some(false) => AccountRole::Standard,
            None => AccountRole::Unknown,
        };
        let granted = |id: &str| {
            initdata
                .app_privilege
                .as_ref()
                .and_then(|privileges| privileges.get(id))
                .and_then(serde_json::Value::as_bool)
        };
        Self {
            role,
            all_applications: granted(ALL_APPLICATIONS),
            applications: KNOWN_APPLICATIONS.map(|app| granted(app.dsm_id)),
        }
    }
}

enum AccountLookup {
    Expired,
    /// Not cached: a later check asks again.
    Transient,
}

/// Time limits of one section check. Waiting behind another signed request of
/// the same session counts against the deadlines, never against the time a
/// dispatched read gets for DSM's answer.
#[derive(Clone, Copy, Debug)]
struct ProbeBudget {
    /// Role lookup, queue wait included; runs before the reads.
    account: Duration,
    /// All reads of the section, queue waits included.
    total: Duration,
    /// One dispatched read.
    per_read: Duration,
}

const PROBE_BUDGET: ProbeBudget = ProbeBudget {
    account: Duration::from_secs(5),
    total: Duration::from_secs(10),
    per_read: Duration::from_secs(3),
};

/// How DSM answered one distinct call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Data,
    Refused(i32),
    Unsupported,
    Failed,
}

const AVAILABLE_READ: &str = "Read successfully.";
const UNKNOWN_REASON: &str = "Access could not be confirmed. A network, timeout, or compatibility issue is not a permission denial; retry explicitly.";
const SECTION_AVAILABLE: &str =
    "All data in this section was read successfully. Changes still require NAS permission.";
const SECTION_PARTIAL: &str =
    "Some data in this section needs additional DSM access; the parts you can read are shown.";
const SECTION_ADMINISTRATOR: &str =
    "This section needs a DSM administrator account or a delegated administration role.";
const SECTION_PERMISSION: &str =
    "DSM denied this section's data for this account. Review the account's DSM permissions for this data.";
const SECTION_DSM_VERSION: &str = "This DSM version does not provide this section's API.";

pub struct SectionAccessContext {
    lease: FileTransferContext,
}

impl SynologyService {
    /// Capture under the instance mutex, then release it before awaiting probe.
    pub fn section_access_context(&self, expected: &str) -> SynologyResult<SectionAccessContext> {
        Ok(SectionAccessContext {
            lease: self.fs_transfer_context(expected)?,
        })
    }
}

impl SectionAccessContext {
    fn assert_active(&self) -> SynologyResult<()> {
        if self.lease.active.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(SynologyError::session_expired(
                "NAS session ended during section access discovery; reconnect before continuing",
            ))
        }
    }

    fn expire(&self) -> SynologyError {
        self.lease.active.store(false, Ordering::Release);
        self.lease.cancelled.notify_waiters();
        SynologyError::session_expired("NAS rejected this API session during section access discovery; reconnect before continuing")
    }

    /// Runs `future` unless the lease is revoked first; revocation drops the
    /// in-flight request.
    async fn while_active<F: Future>(&self, future: F) -> SynologyResult<F::Output> {
        let cancelled = self.lease.cancelled.notified();
        tokio::pin!(cancelled);
        cancelled.as_mut().enable();
        self.assert_active()?;
        let output = tokio::select! {
            biased;
            _ = &mut cancelled => return Err(self.expire()),
            output = future => output,
        };
        self.assert_active()?;
        Ok(output)
    }

    pub async fn probe(&self, section: &str) -> SynologyResult<SectionAccessSnapshot> {
        self.probe_bounded(section, PROBE_BUDGET).await
    }

    async fn probe_bounded(
        &self,
        section: &str,
        budget: ProbeBudget,
    ) -> SynologyResult<SectionAccessSnapshot> {
        self.assert_active()?;
        let unknown_section = || SynologyError::parse("Unknown Synology section");
        let (section, fields) = api_access::section_reads(section).ok_or_else(unknown_section)?;
        let client = &self.lease.client;
        let planned = fields
            .iter()
            .map(|field| {
                let spec = api_access::read_spec(field).ok_or_else(unknown_section)?;
                let primary = spec.alternatives.first().ok_or_else(unknown_section)?;
                let present = spec
                    .alternatives
                    .iter()
                    .find(|call| client.has_api(call.api));
                Ok((spec, primary, present))
            })
            .collect::<SynologyResult<Vec<_>>>()?;

        let facts = if planned.iter().any(|(_, _, present)| present.is_some()) {
            self.account_facts(budget.account).await?
        } else {
            client
                .account
                .get()
                .copied()
                .unwrap_or(AccountFacts::UNKNOWN)
        };

        let identity = client.session_identity();
        let deadline = Instant::now() + budget.total;
        let mut answered: Vec<(&ReadCall, Outcome)> = Vec::new();
        let mut reads = Vec::with_capacity(planned.len());
        for (spec, primary, present) in planned {
            self.assert_active()?;
            let Some(call) = present else {
                reads.push(absent(spec, primary));
                continue;
            };
            // Reads that share one call (storage) are asked once per section.
            let outcome = match answered.iter().find(|(seen, _)| *seen == call) {
                Some((_, outcome)) => *outcome,
                None => {
                    let outcome = self.read(call, deadline, budget.per_read).await?;
                    answered.push((call, outcome));
                    outcome
                }
            };
            reads.push(classify(spec, call, outcome, identity, facts));
        }
        self.assert_active()?;
        Ok(snapshot(
            section,
            account_access(identity, facts.role),
            reads,
        ))
    }

    async fn read(
        &self,
        call: &ReadCall,
        deadline: Instant,
        per_read: Duration,
    ) -> SynologyResult<Outcome> {
        let client = &self.lease.client;
        let Some(version) = client.best_version(call.api, call.max_version) else {
            return Ok(Outcome::Unsupported);
        };
        if Instant::now() >= deadline {
            return Ok(Outcome::Failed);
        }
        let budget = ReadBudget {
            deadline,
            response: per_read,
        };
        let result = self
            .while_active(client.post_bounded::<serde_json::Value>(
                call.api,
                version,
                call.method,
                call.params,
                budget,
            ))
            .await?;
        Ok(match result {
            Ok(value) if value.is_object() || value.is_array() => Outcome::Data,
            Ok(_) => Outcome::Failed,
            Err(error) => match (error.dsm_code(), &error.kind) {
                (Some(106 | 107 | 119 | 150), _) | (None, SynologyErrorKind::SessionExpired) => {
                    return Err(self.expire())
                }
                (Some(code), _) => Outcome::Refused(code),
                (None, SynologyErrorKind::ApiNotFound | SynologyErrorKind::VersionNotSupported) => {
                    Outcome::Unsupported
                }
                _ => Outcome::Failed,
            },
        })
    }

    /// Role and application privileges from `SYNO.Core.Desktop.Initdata`,
    /// requested at most once per login across concurrent checks. A refusal
    /// or an unreadable answer is remembered as unknown; a timeout or network
    /// failure is not. It never changes which reads are probed.
    async fn account_facts(&self, limit: Duration) -> SynologyResult<AccountFacts> {
        let client = &self.lease.client;
        if let Some(facts) = client.account.get() {
            return Ok(*facts);
        }
        let Some(version) = client.best_version(INITDATA_API, 1) else {
            return Ok(AccountFacts::UNKNOWN);
        };
        let deadline = Instant::now() + limit;
        let budget = ReadBudget {
            deadline,
            response: limit,
        };
        let lookup = client.account.get_or_try_init(|| async {
            match client
                .post_bounded::<Initdata>(INITDATA_API, version, "get", &[], budget)
                .await
            {
                Ok(initdata) => Ok(AccountFacts::from(initdata)),
                Err(error) => match (error.dsm_code(), &error.kind) {
                    (Some(106 | 107 | 119 | 150), _)
                    | (None, SynologyErrorKind::SessionExpired) => Err(AccountLookup::Expired),
                    (Some(102..=105), _) => Ok(AccountFacts::UNKNOWN),
                    (None, _)
                        if matches!(
                            error.response_category(),
                            Some(Category::JsonSchema | Category::ResponseTooLarge)
                        ) =>
                    {
                        Ok(AccountFacts::UNKNOWN)
                    }
                    _ => Err(AccountLookup::Transient),
                },
            }
        });
        match self
            .while_active(tokio::time::timeout_at(deadline, lookup))
            .await?
        {
            Ok(Ok(facts)) => Ok(*facts),
            Ok(Err(AccountLookup::Expired)) => Err(self.expire()),
            Ok(Err(AccountLookup::Transient)) | Err(_) => Ok(AccountFacts::UNKNOWN),
        }
    }
}

/// No alternative of the read is in `SYNO.API.Info`: nothing is requested.
fn absent(spec: &ReadSpec, primary: &ReadCall) -> ReadAccess {
    let api_spec = api_access::privilege_for(primary.api);
    let package = api_spec.and_then(|api_spec| api_spec.package);
    let (state, reason) = match package {
        Some(package) => (
            ReadState::PackageNotInstalled,
            format!("{package} is not installed or not running on this NAS."),
        ),
        None => (
            ReadState::NotSupported,
            format!("This DSM version does not provide {}.", primary.api),
        ),
    };
    read_access(spec, primary, api_spec, state, reason)
}

fn classify(
    spec: &ReadSpec,
    call: &ReadCall,
    outcome: Outcome,
    identity: &SessionIdentity,
    facts: AccountFacts,
) -> ReadAccess {
    let api = call.api;
    let api_spec = api_access::privilege_for(api);
    let (state, reason) = match outcome {
        Outcome::Data => (ReadState::Available, AVAILABLE_READ.to_owned()),
        Outcome::Unsupported | Outcome::Refused(102..=104) => (
            ReadState::NotSupported,
            format!("This DSM version does not support the requested {api} version or method."),
        ),
        Outcome::Refused(105) => refusal(api, api_spec, identity, facts),
        Outcome::Refused(code) => (
            ReadState::Unknown,
            format!("DSM answered {api} with code {code}, which does not identify a permission problem. Access could not be confirmed; retry explicitly."),
        ),
        Outcome::Failed => (ReadState::Unknown, UNKNOWN_REASON.to_owned()),
    };
    read_access(spec, call, api_spec, state, reason)
}

fn read_access(
    spec: &ReadSpec,
    call: &ReadCall,
    api_spec: Option<&ApiSpec>,
    state: ReadState,
    reason: String,
) -> ReadAccess {
    ReadAccess {
        field: spec.field,
        api: call.api,
        state,
        reason,
        package: api_spec.and_then(|api_spec| api_spec.package),
        application: match api_spec.map(|api_spec| api_spec.privilege) {
            Some(ApiPrivilege::Application(app)) => Some(app.name),
            _ => None,
        },
    }
}

/// DSM code 105 on `api`.
fn refusal(
    api: &str,
    api_spec: Option<&ApiSpec>,
    identity: &SessionIdentity,
    facts: AccountFacts,
) -> (ReadState, String) {
    match api_spec.map(|api_spec| api_spec.privilege) {
        Some(ApiPrivilege::Administrator) if identity.portal_session => (
            ReadState::SessionRestricted,
            format!("This API session was opened through a DSM application portal, which limits it to that application. Connect to the DSM port (for example 5001) to use {api}."),
        ),
        Some(ApiPrivilege::Administrator) if facts.role == AccountRole::Administrator => (
            ReadState::SessionRestricted,
            administrator_session_reason(api, identity),
        ),
        Some(ApiPrivilege::Administrator) => (
            ReadState::RequiresAdministrator,
            format!("DSM allows {api} only for administrators or accounts with a matching delegated administration role."),
        ),
        Some(ApiPrivilege::Application(app)) if facts.application(app) != Some(true) => (
            ReadState::RequiresApplicationPrivilege,
            format!(
                "The account needs the {} application privilege (Control Panel › Application Privileges) to read {api}.",
                app.name
            ),
        ),
        _ => (
            ReadState::PermissionDenied,
            format!("DSM denied {api} for this account (code 105). Review the account's DSM permissions for this data."),
        ),
    }
}

/// DSM says the account is an administrator, yet refused an administrator API.
fn administrator_session_reason(api: &str, identity: &SessionIdentity) -> String {
    let user = display_username(&identity.signed_in_as);
    let session = session_name(identity);
    let route = match identity.route {
        SessionRoute::Direct => "Direct",
        SessionRoute::HttpProxy => "HTTP proxy",
        SessionRoute::QuickconnectRelay => "QuickConnect relay",
        SessionRoute::QuickconnectDirect => "QuickConnect direct",
    };
    let session_label = match session {
        SessionName::FileStation => "FileStation",
        SessionName::Webui => "DSM desktop (webui)",
    };
    match (identity.login_handshake, session) {
        (LoginHandshake::Legacy | LoginHandshake::LegacyUnavailable | LoginHandshake::IkIncomplete, _) => format!("DSM identifies {user} as an administrator but limited this API session: it was signed in without DSM 7's secure login handshake, which DSM requires for full access over QuickConnect or remote addresses. Reconnect; if this remains, copy the session diagnostics."),
        (LoginHandshake::Ik, SessionName::FileStation) => format!("DSM identifies {user} as an administrator but denied {api} for this API session (session {session_label}, route {route}). Use Reconnect as DSM session, then recheck access. If it remains, copy the session diagnostics."),
        (LoginHandshake::Ik, SessionName::Webui) => format!("DSM identifies {user} as an administrator but denied {api} for this API session (session {session_label}, route {route}). Reconnect, then recheck access. If it remains, copy the session diagnostics."),
    }
}

/// Named instances sign in as `FileStation` or, on explicit request, `webui`.
fn session_name(identity: &SessionIdentity) -> SessionName {
    if identity.session_name == SessionProfile::DsmDesktop.session_name() {
        SessionName::Webui
    } else {
        SessionName::FileStation
    }
}

/// The username as display text: control, zero-width and bidirectional
/// override characters are replaced, and it is limited to 256 UTF-16 units.
fn display_username(raw: &str) -> String {
    let mut units = 0;
    let name: String = raw
        .chars()
        .map(|character| match character {
            '\u{0}'..='\u{1f}'
            | '\u{7f}'..='\u{9f}'
            | '\u{200b}'..='\u{200f}'
            | '\u{2028}'..='\u{202e}'
            | '\u{2060}'..='\u{2069}'
            | '\u{feff}' => char::REPLACEMENT_CHARACTER,
            other => other,
        })
        .take_while(|character| {
            units += character.len_utf16();
            units <= 256
        })
        .collect();
    if name.trim().is_empty() {
        "(unnamed account)".to_owned()
    } else {
        name
    }
}

fn account_access(identity: &SessionIdentity, role: AccountRole) -> AccountAccess {
    AccountAccess {
        signed_in_as: display_username(&identity.signed_in_as),
        role,
        portal_session: identity.portal_session,
        session_name: session_name(identity),
        login_handshake: identity.login_handshake,
        auth_version: identity.auth_version,
        route: identity.route,
        second_factor: identity.second_factor,
    }
}

/// Mirrors `aggregateSectionStatus` in `src/utils/synology/synologyAccess.ts`.
fn aggregate(reads: &[ReadAccess]) -> SectionAccessStatus {
    let available = reads
        .iter()
        .filter(|read| read.state == ReadState::Available)
        .count();
    if !reads.is_empty() && available == reads.len() {
        SectionAccessStatus::Available
    } else if available > 0 {
        SectionAccessStatus::Partial
    } else if reads.iter().any(|read| read.state == ReadState::Unknown) {
        SectionAccessStatus::Unknown
    } else if reads.iter().any(|read| {
        matches!(
            read.state,
            ReadState::RequiresAdministrator
                | ReadState::SessionRestricted
                | ReadState::RequiresApplicationPrivilege
                | ReadState::PermissionDenied
        )
    }) {
        SectionAccessStatus::Denied
    } else {
        SectionAccessStatus::Unavailable
    }
}

fn snapshot(
    section: &'static str,
    account: AccountAccess,
    reads: Vec<ReadAccess>,
) -> SectionAccessSnapshot {
    let status = aggregate(&reads);
    let requirement = reads
        .iter()
        .filter_map(|read| read.state.requirement())
        .min();
    let first = |state: ReadState| reads.iter().find(|read| read.state == state);
    let reason = match (status, requirement) {
        (SectionAccessStatus::Available, _) => SECTION_AVAILABLE.to_owned(),
        (SectionAccessStatus::Partial, _) => SECTION_PARTIAL.to_owned(),
        (SectionAccessStatus::Denied, Some(AccessRequirement::Administrator)) => {
            SECTION_ADMINISTRATOR.to_owned()
        }
        (SectionAccessStatus::Denied, Some(AccessRequirement::Session)) => {
            first(ReadState::SessionRestricted)
                .map_or_else(|| UNKNOWN_REASON.to_owned(), |read| read.reason.clone())
        }
        (SectionAccessStatus::Denied, Some(AccessRequirement::ApplicationPrivilege)) => {
            match first(ReadState::RequiresApplicationPrivilege).and_then(|read| read.application) {
                Some(app) => format!("This section needs the {app} application privilege."),
                None => SECTION_PERMISSION.to_owned(),
            }
        }
        (SectionAccessStatus::Denied, _) => SECTION_PERMISSION.to_owned(),
        (SectionAccessStatus::Unavailable, Some(AccessRequirement::Package)) => {
            let mut packages: Vec<&str> = Vec::new();
            for package in reads
                .iter()
                .filter(|read| read.state == ReadState::PackageNotInstalled)
                .filter_map(|read| read.package)
            {
                if !packages.contains(&package) {
                    packages.push(package);
                }
            }
            match packages.as_slice() {
                [package] => format!("{package} is not installed or not running on this NAS."),
                _ => format!(
                    "{} are not installed or not running on this NAS.",
                    packages.join(" and ")
                ),
            }
        }
        (SectionAccessStatus::Unavailable, _) => SECTION_DSM_VERSION.to_owned(),
        (SectionAccessStatus::Unknown, _) => UNKNOWN_REASON.to_owned(),
    };
    SectionAccessSnapshot {
        section,
        status,
        requirement,
        reason,
        account,
        reads,
    }
}

#[cfg(test)]
#[path = "section_access_tests.rs"]
mod tests;

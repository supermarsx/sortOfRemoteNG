//! Receipt-bound File Station API. The renderer never receives a DSM SID or
//! supplies a raw NAS task id. API geometry follows Synology's File Station guide.
use crate::{
    auth::{AuthManager, AuthMethod},
    client::SynoClient,
    device_trust::{self, DeviceLogin, TrustedDevice},
    error::{SynologyError, SynologyErrorKind, SynologyResult},
    login_handshake::LoginOptions,
    service::SynologyService,
    types::*,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

/// `syn_fs_connect`'s result: a receipt, or the second-factor state DSM
/// asked for. `Debug` never shows a device token (`TrustedDevice` redacts it).
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum FileStationLogin {
    Connected {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: String,
        /// Present only when this sign-in asked DSM to trust the computer and
        /// DSM issued a usable device token.
        #[serde(rename = "trustedDevice", skip_serializing_if = "Option::is_none")]
        trusted_device: Option<TrustedDevice>,
    },
    /// DSM code 403.
    OtpRequired {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        methods: Option<Vec<AuthMethod>>,
        /// A saved device token was sent and DSM still asked for a code.
        #[serde(
            rename = "trustedDeviceRejected",
            skip_serializing_if = "std::ops::Not::not"
        )]
        trusted_device_rejected: bool,
        /// The saved device belongs to another computer, so it was not sent.
        #[serde(
            rename = "trustedDeviceMismatch",
            skip_serializing_if = "std::ops::Not::not"
        )]
        trusted_device_mismatch: bool,
    },
    /// DSM code 404.
    OtpInvalid { message: String },
    /// DSM code 406: two-factor setup must be completed in DSM first.
    OtpEnrollmentRequired { message: String },
    /// DSM code 449: a sign-in method this client cannot complete.
    UnsupportedMfa {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        methods: Option<Vec<AuthMethod>>,
    },
}

const SIGN_IN_FALLBACK: &str = "Approve-sign-in push and security keys can't complete an API sign-in; use the DSM website view for those.";

fn otp_required(methods: Option<Vec<AuthMethod>>, device: &DeviceLogin) -> FileStationLogin {
    let rejected = device.sent_token();
    let mismatch = device.is_mismatch();
    let other_methods = methods
        .as_deref()
        .is_some_and(|methods| methods.iter().any(|method| *method != AuthMethod::Otp));
    let lead = if rejected {
        "This NAS no longer accepts the saved trusted device. Enter a code to continue."
    } else if mismatch {
        "The saved trusted device was set up on another computer, so it wasn't used. Enter a code to continue."
    } else if other_methods {
        "Enter the one-time code from your authenticator app or the code shown in Synology Secure SignIn."
    } else {
        "Enter the current one-time code from your authenticator."
    };
    FileStationLogin::OtpRequired {
        message: if other_methods {
            format!("{lead} {SIGN_IN_FALLBACK}")
        } else {
            lead.into()
        },
        methods,
        trusted_device_rejected: rejected,
        trusted_device_mismatch: mismatch,
    }
}

/// Maps DSM's login refusal to a challenge or a safe error. Only 403 and 449
/// look up the account's sign-in methods. Messages never repeat a password,
/// code or device token, and diagnostics keep only closed metadata.
async fn login_refusal(
    client: &SynoClient,
    device: &DeviceLogin,
    error: SynologyError,
    active: &AtomicBool,
) -> SynologyResult<FileStationLogin> {
    let refused = |message: &str| Err(SynologyError::auth(message).with_diagnostic_from(&error));
    match error.kind {
        SynologyErrorKind::ApiError(403) => Ok(otp_required(
            AuthManager::sign_in_methods(client, active).await?,
            device,
        )),
        SynologyErrorKind::ApiError(404) => Ok(FileStationLogin::OtpInvalid {
            message: "The one-time code was not accepted. Enter a fresh code.".into(),
        }),
        SynologyErrorKind::ApiError(406) => Ok(FileStationLogin::OtpEnrollmentRequired {
            message: "DSM requires this account to set up two-factor authentication before it can sign in. Complete setup once in DSM in your browser (the DSM website view works), then connect again.".into(),
        }),
        SynologyErrorKind::ApiError(449) => Ok(FileStationLogin::UnsupportedMfa {
            message: format!("DSM requires a sign-in method the NAS API can't complete. {SIGN_IN_FALLBACK}"),
            methods: AuthManager::sign_in_methods(client, active).await?,
        }),
        SynologyErrorKind::ApiError(400) => refused("NAS rejected the username or password"),
        SynologyErrorKind::ApiError(401) => refused("The DSM account is disabled."),
        SynologyErrorKind::ApiError(402) => refused("DSM refused API sign-in for this account. The NAS API view signs in as a File Station session, so check the account's File Station application privilege and DSM login restrictions."),
        SynologyErrorKind::ApiError(407) => refused("This client IP is blocked by the NAS. Review DSM security settings before retrying."),
        SynologyErrorKind::ApiError(408) => refused("The password has expired and this account cannot change it. Ask a DSM administrator to reset it."),
        SynologyErrorKind::ApiError(409) => refused("The NAS password has expired. Change it in DSM, then reconnect."),
        SynologyErrorKind::ApiError(410) => refused("DSM requires a password change. Complete it in your browser, then reconnect."),
        _ => Err(error),
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileOperation {
    Delete,
    Copy,
    Move,
    Search,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTaskReceipt {
    pub task_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTaskStatus {
    pub task_id: String,
    pub operation: FileOperation,
    pub finished: bool,
    pub progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<FileListResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferOutcome {
    pub cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileShareLink {
    pub id: String,
    pub path: String,
    pub url: String,
    #[serde(alias = "date_expired", skip_serializing_if = "Option::is_none")]
    pub date_expired: Option<String>,
    #[serde(alias = "has_password", skip_serializing_if = "Option::is_none")]
    pub has_password: Option<bool>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileShareList {
    pub links: Vec<FileShareLink>,
    pub offset: u64,
    pub total: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraSnapshot {
    pub mime_type: &'static str,
    pub data_base64: String,
}
impl FileTransferOutcome {
    pub fn cancelled() -> Self {
        Self {
            cancelled: true,
            name: None,
            bytes: None,
        }
    }
}

pub(crate) struct FileSession {
    id: String,
    tasks: HashMap<String, FileTask>,
    active: Arc<AtomicBool>,
    cancelled: Arc<tokio::sync::Notify>,
}

#[derive(Clone)]
struct FileTask {
    nas_id: String,
    operation: FileOperation,
    created: Instant,
}
impl FileTask {
    fn api(&self) -> (&'static str, u32) {
        operation_api(self.operation)
    }
}
fn operation_api(operation: FileOperation) -> (&'static str, u32) {
    match operation {
        FileOperation::Delete => ("SYNO.FileStation.Delete", 2),
        FileOperation::Copy | FileOperation::Move => ("SYNO.FileStation.CopyMove", 3),
        FileOperation::Search => ("SYNO.FileStation.Search", 2),
    }
}

pub fn validate_remote_path(path: &str) -> SynologyResult<()> {
    if path.len() > 4096
        || !path.starts_with('/')
        || path == "/"
        || path.ends_with('/')
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .skip(1)
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(SynologyError::parse(
            "Select a valid path inside a shared folder",
        ));
    }
    Ok(())
}
pub fn validate_name(name: &str) -> SynologyResult<()> {
    if name.is_empty()
        || name.len() > 255
        || name == "."
        || name == ".."
        || name.chars().any(|c| c.is_control() || "/\\".contains(c))
    {
        return Err(SynologyError::parse(
            "Enter one file or folder name, without a path",
        ));
    }
    Ok(())
}
pub(crate) fn camera_snapshot(bytes: Vec<u8>) -> SynologyResult<CameraSnapshot> {
    use base64::Engine;
    if bytes.len() > 3 * 1024 * 1024 {
        return Err(SynologyError::parse(
            "NAS snapshot exceeds the 3 MiB preview limit",
        ));
    }
    let mime_type = if bytes.starts_with(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10]) {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else {
        return Err(SynologyError::parse(
            "NAS snapshot is not a supported PNG or JPEG image",
        ));
    };
    Ok(CameraSnapshot {
        mime_type,
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}
fn validate_share_id(id: &str) -> SynologyResult<()> {
    if id.is_empty() || id.len() > 1024 || id.chars().any(|c| c.is_control() || c == ',') {
        return Err(SynologyError::parse(
            "Select a valid sharing link identifier",
        ));
    }
    Ok(())
}
fn validate_page(offset: u64, limit: u64) -> SynologyResult<()> {
    if !(1..=500).contains(&limit) || offset > 10_000_000 {
        return Err(SynologyError::parse(
            "File Station page must contain 1–500 entries",
        ));
    }
    Ok(())
}

impl SynologyService {
    pub(crate) fn fs_install_lease(
        &mut self,
        active: Arc<AtomicBool>,
        cancelled: Arc<tokio::sync::Notify>,
    ) {
        if let Some(session) = &mut self.file_session {
            session.active = active;
            session.cancelled = cancelled;
        }
    }
    pub async fn fs_connect(&mut self, config: SynologyConfig) -> SynologyResult<FileStationLogin> {
        self.fs_connect_cancellable(config, &AtomicBool::new(true))
            .await
    }
    pub(crate) async fn fs_connect_cancellable(
        &mut self,
        config: SynologyConfig,
        active: &AtomicBool,
    ) -> SynologyResult<FileStationLogin> {
        self.fs_connect_routed(
            config,
            active,
            crate::http_route::NativeHttpRoute::Direct {},
        )
        .await
    }

    pub(crate) async fn fs_connect_routed(
        &mut self,
        config: SynologyConfig,
        active: &AtomicBool,
        route: crate::http_route::NativeHttpRoute,
    ) -> SynologyResult<FileStationLogin> {
        self.fs_connect_with_options(config, active, route, LoginOptions::default())
            .await
    }

    pub(crate) async fn fs_connect_with_options(
        &mut self,
        config: SynologyConfig,
        active: &AtomicBool,
        route: crate::http_route::NativeHttpRoute,
        options: LoginOptions,
    ) -> SynologyResult<FileStationLogin> {
        if config.username.is_empty()
            || config.username.len() > 256
            || config.password.is_empty()
            || config.password.len() > 4096
            || config.otp_code.as_ref().is_some_and(|code| {
                code.is_empty() || code.len() > 128 || code.chars().any(char::is_control)
            })
        {
            return Err(SynologyError::auth(
                "Enter a username, password, and a valid one-time code when requested",
            ));
        }
        device_trust::check(
            options.device_trust.as_ref(),
            config.device_token.as_deref(),
        )?;
        let mut client = SynoClient::new_with_route(&config, route)?;
        drop(config);
        crate::quickconnect::prepare(&mut client, active).await?;
        if !active.load(Ordering::Acquire) {
            return Err(SynologyError::session_expired(
                "Synology connection attempt was cancelled",
            ));
        }
        let sign_in = AuthManager::login_file_station(&mut client, &options, active).await;
        let trusted_device = match sign_in.result {
            Ok(trusted_device) => trusted_device,
            Err(error) => return login_refusal(&client, &sign_in.device, error, active).await,
        };
        drop(sign_in.device);
        if !active.load(Ordering::Acquire) {
            let _ = tokio::time::timeout(Duration::from_secs(2), AuthManager::logout(&mut client))
                .await;
            return Err(SynologyError::session_expired(
                "Synology connection attempt was cancelled",
            ));
        }
        // Do not replace a usable session with a login that lacks File Station.
        if let Err(error) = client
            .file_call("SYNO.FileStation.Info", 2, "get", &[])
            .await
        {
            let _ = tokio::time::timeout(Duration::from_secs(2), AuthManager::logout(&mut client))
                .await;
            return Err(SynologyError::new(
                error.kind.clone(),
                format!("DSM accepted sign-in, but the first authenticated File Station check failed. {}", error.message),
            ).with_diagnostic_from(&error));
        }
        if !active.load(Ordering::Acquire) {
            let _ = tokio::time::timeout(Duration::from_secs(2), AuthManager::logout(&mut client))
                .await;
            return Err(SynologyError::session_expired(
                "Synology connection attempt was cancelled",
            ));
        }
        self.fs_cleanup().await;
        if let Some(old) = self.client.as_mut() {
            let _ = tokio::time::timeout(Duration::from_secs(2), AuthManager::logout(old)).await;
        }
        let session_id = uuid::Uuid::new_v4().to_string();
        self.config = Some(client.config.clone());
        self.client = Some(client);
        self.file_session = Some(FileSession {
            id: session_id.clone(),
            tasks: HashMap::new(),
            active: Arc::new(AtomicBool::new(true)),
            cancelled: Arc::new(tokio::sync::Notify::new()),
        });
        Ok(FileStationLogin::Connected {
            session_id,
            message: "Connected to Synology File Station".into(),
            trusted_device,
        })
    }

    pub fn fs_assert_session(&self, expected: &str) -> SynologyResult<()> {
        if !self
            .file_session
            .as_ref()
            .is_some_and(|s| s.id == expected && s.active.load(Ordering::Acquire))
            || !self.is_connected()
        {
            return Err(SynologyError::session_expired(
                "This File Station session changed or ended. Connect again before continuing.",
            ));
        }
        Ok(())
    }
    fn fs_client(&self, expected: &str) -> SynologyResult<&SynoClient> {
        self.fs_assert_session(expected)?;
        self.client
            .as_ref()
            .ok_or_else(|| SynologyError::session_expired("File Station is disconnected"))
    }
    pub(crate) async fn fs_keep_alive(&self, expected: &str) -> SynologyResult<()> {
        // Public API discovery cannot prove authentication. This read is
        // authenticated with the current native SID/SynoToken and is inert.
        self.fs_client(expected)?
            .file_call("SYNO.FileStation.Info", 2, "get", &[])
            .await?;
        self.fs_assert_session(expected)
    }
    pub async fn fs_disconnect(&mut self, expected: &str) -> SynologyResult<bool> {
        if self.fs_assert_session(expected).is_err() {
            return Ok(false);
        }
        self.disconnect().await?;
        Ok(true)
    }
    pub(crate) async fn fs_cleanup(&mut self) {
        if let Some(session) = self.file_session.take() {
            session.active.store(false, Ordering::Release);
            session.cancelled.notify_waiters();
            if let Some(client) = &self.client {
                let _ = tokio::time::timeout(Duration::from_secs(3), async {
                    for task in session.tasks.into_values() {
                        let _ = stop_task(client, &task).await;
                    }
                })
                .await;
            }
        }
    }

    pub async fn fs_list(
        &self,
        expected: &str,
        folder: Option<&str>,
        offset: u64,
        limit: u64,
        sort: &str,
        direction: &str,
    ) -> SynologyResult<FileListResult> {
        let client = self.fs_client(expected)?;
        validate_page(offset, limit)?;
        if !["name", "size", "mtime", "type", "crtime"].contains(&sort)
            || !["asc", "desc"].contains(&direction)
        {
            return Err(SynologyError::parse("Invalid File Station sort order"));
        }
        let mut params = vec![
            ("offset", json!(offset)),
            ("limit", json!(limit)),
            ("sort_by", json!(sort)),
            ("sort_direction", json!(direction)),
            (
                "additional",
                json!(["size", "time", "type", "perm", "owner"]),
            ),
        ];
        let method = if let Some(folder) = folder {
            validate_remote_path(folder)?;
            params.push(("folder_path", json!(folder)));
            "list"
        } else {
            "list_share"
        };
        let mut value = client
            .file_call("SYNO.FileStation.List", 2, method, &params)
            .await?;
        if folder.is_none() {
            let shares = value.get_mut("shares").map(Value::take).ok_or_else(|| {
                SynologyError::parse("NAS shared-folder response is missing shares")
            })?;
            value["files"] = shares;
        }
        serde_json::from_value(value).map_err(Into::into)
    }
    pub async fn fs_create_share_link(
        &self,
        expected: &str,
        path: &str,
        password: Option<&str>,
        expire_date: Option<&str>,
    ) -> SynologyResult<FileShareLink> {
        let client = self.fs_client(expected)?;
        validate_remote_path(path)?;
        if password
            .is_some_and(|value| value.chars().count() > 16 || value.chars().any(char::is_control))
        {
            return Err(SynologyError::parse(
                "Sharing password must contain at most 16 characters, without control characters",
            ));
        }
        if let Some(date) = expire_date {
            if date.len() != 10
                || chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                    .map(|parsed| parsed.format("%Y-%m-%d").to_string() != date)
                    .unwrap_or(true)
            {
                return Err(SynologyError::parse(
                    "Sharing expiry must be a valid YYYY-MM-DD date",
                ));
            }
        }
        if client.best_version("SYNO.FileStation.Sharing", 3) != Some(3) {
            return Err(SynologyError::api_not_found(
                "This NAS does not provide File Station sharing API version 3",
            ));
        }
        let mut params = vec![("path", json!(path))];
        if let Some(password) = password.filter(|value| !value.is_empty()) {
            params.push(("password", json!(password)));
        }
        if let Some(date) = expire_date {
            params.push(("date_expired", json!(date)));
        }
        let value = client
            .file_call("SYNO.FileStation.Sharing", 3, "create", &params)
            .await?;
        let link = value
            .get("links")
            .and_then(Value::as_array)
            .filter(|links| links.len() == 1)
            .and_then(|links| links.first())
            .ok_or_else(|| SynologyError::parse("NAS did not return one sharing link"))?;
        if let Some(error) = link.get("error") {
            if error.as_i64() != Some(0) && !error.is_null() {
                return Err(SynologyError::api(
                    400,
                    "NAS refused this sharing link. Check permissions and sharing policy.",
                ));
            }
        }
        let id = link
            .get("id")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty() && v.len() <= 1024 && !v.chars().any(char::is_control))
            .ok_or_else(|| {
                SynologyError::parse("NAS returned an invalid sharing link identifier")
            })?;
        let url = link
            .get("url")
            .and_then(Value::as_str)
            .filter(|v| v.len() <= 4096 && !v.chars().any(char::is_control))
            .ok_or_else(|| SynologyError::parse("NAS returned an invalid sharing URL"))?;
        let parsed = url::Url::parse(url)?;
        if !["http", "https"].contains(&parsed.scheme())
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.host_str().is_none()
        {
            return Err(SynologyError::parse(
                "NAS returned an unsupported sharing URL",
            ));
        }
        Ok(FileShareLink {
            id: id.into(),
            path: path.into(),
            url: url.into(),
            date_expired: expire_date.map(str::to_string),
            has_password: Some(password.is_some_and(|value| !value.is_empty())),
        })
    }
    pub async fn fs_list_share_links(
        &self,
        expected: &str,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<FileShareList> {
        let client = self.fs_client(expected)?;
        validate_page(offset, limit)?;
        let response = client
            .file_call(
                "SYNO.FileStation.Sharing",
                3,
                "list",
                &[("offset", json!(offset)), ("limit", json!(limit))],
            )
            .await?;
        let result: FileShareList = serde_json::from_value(response)?;
        if result.links.len() > limit as usize {
            return Err(SynologyError::parse("NAS returned too many sharing links"));
        }
        for link in &result.links {
            validate_share_id(&link.id)?;
            validate_remote_path(&link.path)?;
            if link.url.len() > 4096 || link.url.chars().any(char::is_control) {
                return Err(SynologyError::parse("NAS returned an invalid sharing URL"));
            }
            let url = url::Url::parse(&link.url)?;
            if !["http", "https"].contains(&url.scheme())
                || !url.username().is_empty()
                || url.password().is_some()
                || url.host_str().is_none()
            {
                return Err(SynologyError::parse(
                    "NAS returned an unsupported sharing URL",
                ));
            }
        }
        Ok(result)
    }
    pub async fn fs_delete_share_links(
        &self,
        expected: &str,
        ids: &[String],
    ) -> SynologyResult<()> {
        let client = self.fs_client(expected)?;
        if ids.is_empty() || ids.len() > 100 {
            return Err(SynologyError::parse(
                "Select between 1 and 100 sharing links",
            ));
        }
        for id in ids {
            validate_share_id(id)?;
        }
        let value = client
            .file_call(
                "SYNO.FileStation.Sharing",
                3,
                "delete",
                &[("id", json!(ids.join(",")))],
            )
            .await?;
        if value.is_null()
            || value.as_object().is_some_and(|v| v.is_empty())
            || value.as_array().is_some_and(|v| v.is_empty())
        {
            Ok(())
        } else {
            Err(SynologyError::parse("NAS did not confirm revoking every sharing link. Refresh the list before retrying."))
        }
    }
    pub async fn fs_camera_snapshot(
        &self,
        expected: &str,
        cam_id: &str,
    ) -> SynologyResult<CameraSnapshot> {
        let client = self.fs_client(expected)?;
        if cam_id.is_empty() || cam_id.len() > 64 || !cam_id.bytes().all(|c| c.is_ascii_digit()) {
            return Err(SynologyError::parse("Select one valid camera"));
        }
        let version = client
            .best_version("SYNO.SurveillanceStation.Camera", 9)
            .ok_or_else(|| SynologyError::api_not_found("Surveillance Station is unavailable"))?;
        let bytes = client
            .raw_download_bounded(
                "SYNO.SurveillanceStation.Camera",
                version,
                "GetSnapshot",
                &[("cameraId", cam_id)],
                3 * 1024 * 1024,
            )
            .await?;
        camera_snapshot(bytes)
    }
    pub async fn fs_create_folder(
        &self,
        expected: &str,
        folder: &str,
        name: &str,
    ) -> SynologyResult<()> {
        let client = self.fs_client(expected)?;
        validate_remote_path(folder)?;
        validate_name(name)?;
        client
            .file_call(
                "SYNO.FileStation.CreateFolder",
                2,
                "create",
                &[
                    ("folder_path", json!([folder])),
                    ("name", json!([name])),
                    ("force_parent", json!(false)),
                ],
            )
            .await?;
        Ok(())
    }
    pub async fn fs_rename(&self, expected: &str, path: &str, name: &str) -> SynologyResult<()> {
        let client = self.fs_client(expected)?;
        validate_remote_path(path)?;
        validate_name(name)?;
        client
            .file_call(
                "SYNO.FileStation.Rename",
                2,
                "rename",
                &[("path", json!([path])), ("name", json!([name]))],
            )
            .await?;
        Ok(())
    }
    pub async fn fs_start_task(
        &mut self,
        expected: &str,
        operation: FileOperation,
        paths: Vec<String>,
        destination: Option<String>,
        pattern: Option<String>,
        overwrite: Option<bool>,
    ) -> SynologyResult<FileTaskReceipt> {
        let client = self.fs_client(expected)?;
        if paths.is_empty() || paths.len() > 1000 {
            return Err(SynologyError::parse("Select 1–1000 files or folders"));
        }
        for path in &paths {
            validate_remote_path(path)?;
        }
        if self
            .file_session
            .as_ref()
            .is_some_and(|s| s.tasks.len() >= 32)
        {
            return Err(SynologyError::busy(
                "Too many File Station tasks; stop or finish an existing task first",
            ));
        }
        let mut params = if operation == FileOperation::Search {
            let pattern = pattern
                .filter(|s| !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
                .ok_or_else(|| {
                    SynologyError::parse("Enter a search pattern of 1–256 characters")
                })?;
            if paths.len() != 1 {
                return Err(SynologyError::parse("Search one folder at a time"));
            }
            vec![
                ("folder_path", json!(paths)),
                ("pattern", json!(pattern)),
                ("recursive", json!(true)),
            ]
        } else {
            vec![("path", json!(paths)), ("accurate_progress", json!(true))]
        };
        if matches!(operation, FileOperation::Copy | FileOperation::Move) {
            let destination =
                destination.ok_or_else(|| SynologyError::parse("Choose a destination folder"))?;
            validate_remote_path(&destination)?;
            params.push(("dest_folder_path", json!(destination)));
            params.push(("remove_src", json!(operation == FileOperation::Move)));
            // Omit overwrite by default: DSM then refuses collisions, instead of
            // silently skipping them (overwrite=false) or replacing them (true).
            if let Some(overwrite) = overwrite {
                params.push(("overwrite", json!(overwrite)));
            }
        }
        if operation == FileOperation::Delete {
            params.push(("recursive", json!(true)));
        }
        let (api, version) = operation_api(operation);
        let data = client.file_call(api, version, "start", &params).await?;
        let nas_id = data["taskid"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 4096 && !s.chars().any(char::is_control))
            .ok_or_else(|| SynologyError::parse("NAS did not return a valid task receipt"))?
            .to_string();
        let task_id = uuid::Uuid::new_v4().to_string();
        self.file_session
            .as_mut()
            .ok_or_else(|| SynologyError::session_expired("File Station session ended"))?
            .tasks
            .insert(
                task_id.clone(),
                FileTask {
                    nas_id,
                    operation,
                    created: Instant::now(),
                },
            );
        Ok(FileTaskReceipt { task_id })
    }
    pub async fn fs_task_status(
        &mut self,
        expected: &str,
        task_id: &str,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<FileTaskStatus> {
        self.fs_assert_session(expected)?;
        validate_page(offset, limit)?;
        let task = self
            .file_session
            .as_ref()
            .and_then(|s| s.tasks.get(task_id))
            .cloned()
            .ok_or_else(|| {
                SynologyError::parse(
                    "This task does not belong to the current File Station session",
                )
            })?;
        if task.created.elapsed() > Duration::from_secs(24 * 60 * 60) {
            self.fs_stop_task(expected, task_id).await?;
            return Err(SynologyError::busy("File Station task exceeded its 24-hour monitoring limit and was stopped; refresh to inspect partial results"));
        }
        let client = self.fs_client(expected)?;
        let (api, version) = task.api();
        let mut params = vec![("taskid", json!(task.nas_id))];
        let method = if task.operation == FileOperation::Search {
            params.extend([
                ("offset", json!(offset)),
                ("limit", json!(limit)),
                ("additional", json!(["size", "time", "type"])),
            ]);
            "list"
        } else {
            "status"
        };
        let data = match client.file_call(api, version, method, &params).await {
            Ok(data) => data,
            Err(error) => {
                let _ = self.fs_stop_task(expected, task_id).await;
                return Err(error);
            }
        };
        let finished = data["finished"].as_bool().ok_or_else(|| {
            SynologyError::parse("NAS task response is missing its completion state")
        })?;
        let progress = data["progress"]
            .as_f64()
            .filter(|n| n.is_finite() && (0.0..=1.0).contains(n));
        let files = if task.operation == FileOperation::Search {
            Some(serde_json::from_value(data)?)
        } else {
            None
        };
        if finished && task.operation != FileOperation::Search {
            if let Some(session) = self.file_session.as_mut() {
                session.tasks.remove(task_id);
            }
        }
        Ok(FileTaskStatus {
            task_id: task_id.to_string(),
            operation: task.operation,
            finished,
            progress,
            files,
        })
    }
    pub async fn fs_stop_task(&mut self, expected: &str, task_id: &str) -> SynologyResult<()> {
        self.fs_assert_session(expected)?;
        let task = self
            .file_session
            .as_ref()
            .and_then(|s| s.tasks.get(task_id))
            .cloned()
            .ok_or_else(|| {
                SynologyError::parse(
                    "This task does not belong to the current File Station session",
                )
            })?;
        stop_task(self.fs_client(expected)?, &task).await?;
        if let Some(session) = self.file_session.as_mut() {
            session.tasks.remove(task_id);
        }
        Ok(())
    }
    pub fn fs_transfer_context(
        &self,
        expected: &str,
    ) -> SynologyResult<super::file_transfer::FileTransferContext> {
        let client = self.fs_client(expected)?.clone();
        let active = self
            .file_session
            .as_ref()
            .ok_or_else(|| SynologyError::session_expired("File Station session ended"))?
            .active
            .clone();
        let cancelled = self
            .file_session
            .as_ref()
            .ok_or_else(|| SynologyError::session_expired("File Station session ended"))?
            .cancelled
            .clone();
        Ok(super::file_transfer::FileTransferContext {
            client,
            active,
            cancelled,
        })
    }
}

async fn stop_task(client: &SynoClient, task: &FileTask) -> SynologyResult<()> {
    let (api, version) = task.api();
    let params = [("taskid", json!(task.nas_id))];
    let stopped = client.file_call(api, version, "stop", &params).await;
    if task.operation == FileOperation::Search {
        // Clean is attempted even if stop failed; never leave a retained search
        // solely because DSM already considers it finished.
        client.file_call(api, version, "clean", &params).await?;
    }
    stopped.map(|_| ())
}

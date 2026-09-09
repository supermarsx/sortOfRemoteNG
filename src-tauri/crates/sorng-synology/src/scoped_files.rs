//! Receipt-bound File Station API. The renderer never receives a DSM SID or
//! supplies a raw NAS task id. API geometry follows Synology's File Station guide.
use crate::{
    auth::AuthManager,
    client::SynoClient,
    error::{SynologyError, SynologyErrorKind, SynologyResult},
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

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum FileStationLogin {
    Connected {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: String,
    },
    OtpRequired {
        message: String,
    },
    OtpInvalid {
        message: String,
    },
    UnsupportedMfa {
        message: String,
    },
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
fn validate_page(offset: u64, limit: u64) -> SynologyResult<()> {
    if !(1..=500).contains(&limit) || offset > 10_000_000 {
        return Err(SynologyError::parse(
            "File Station page must contain 1–500 entries",
        ));
    }
    Ok(())
}

impl SynologyService {
    pub async fn fs_connect(&mut self, config: SynologyConfig) -> SynologyResult<FileStationLogin> {
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
        let mut client = SynoClient::new(&config)?;
        drop(config);
        client.discover_apis().await?;
        match AuthManager::login_file_station(&mut client).await {
            Ok(()) => {},
            Err(error) => return match error.kind {
                SynologyErrorKind::ApiError(403) => Ok(FileStationLogin::OtpRequired { message: "Enter the current verification code from your authenticator.".into() }),
                SynologyErrorKind::ApiError(404) => Ok(FileStationLogin::OtpInvalid { message: "The verification code was not accepted. Enter a new current code.".into() }),
                SynologyErrorKind::ApiError(406 | 449) => Ok(FileStationLogin::UnsupportedMfa { message: "This NAS requires an authentication setup or approval that this API login cannot complete. Use DSM in your browser; Secure SignIn push and WebAuthn are not supported here.".into() }),
                SynologyErrorKind::ApiError(400) => Err(SynologyError::auth("NAS rejected the username or password")),
                _ => Err(error),
            },
        }
        // Do not replace a usable session with a login that lacks File Station.
        if let Err(error) = client
            .file_call("SYNO.FileStation.Info", 2, "get", &[])
            .await
        {
            let _ = AuthManager::logout(&mut client).await;
            return Err(error);
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
        });
        Ok(FileStationLogin::Connected {
            session_id,
            message: "Connected to Synology File Station".into(),
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
        Ok(super::file_transfer::FileTransferContext { client, active })
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

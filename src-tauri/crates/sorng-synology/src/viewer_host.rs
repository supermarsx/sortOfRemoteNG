//! Receipt-bound broker for the separate, no-Tauri-IPC file viewer.
//!
//! File bytes only cross an anonymous stdin pipe. This broker never decodes an
//! image/PDF, writes a document to disk, or gives the helper NAS credentials.
use crate::{
    error::{SynologyError, SynologyResult},
    file_transfer::FileTransferContext,
    file_viewers::FileViewerKind,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ViewerImageFit {
    Contain,
    Actual,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewerDisplayOptions {
    pub text_wrap: bool,
    pub text_font_size: u8,
    pub image_fit: ViewerImageFit,
}

impl ViewerDisplayOptions {
    pub fn validate(&self) -> SynologyResult<()> {
        if !(10..=24).contains(&self.text_font_size) {
            return Err(invalid("Choose a viewer text size between 10 and 24."));
        }
        Ok(())
    }
}

/// Already bounded/downloaded by the owning FileTransferContext. Only signature
/// checks belong upstream; content decoding belongs in the restricted renderer.
pub struct PreparedPreview {
    pub name: String,
    pub kind: FileViewerKind,
    pub bytes: Vec<u8>,
    pub display: ViewerDisplayOptions,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsolatedViewerHandle {
    pub viewer_id: String,
    pub name: String,
    pub bytes: usize,
    pub isolation: &'static str,
}

fn invalid(message: &'static str) -> SynologyError {
    SynologyError::parse(message)
}

/// `helper_path` is resolved by native packaging, never accepted from the UI.
pub async fn open_preview(
    ctx: &FileTransferContext,
    helper_path: &Path,
    instance_id: &str,
    expected_session_id: &str,
    prepared: PreparedPreview,
) -> SynologyResult<IsolatedViewerHandle> {
    ctx.assert_active()?;
    prepared.display.validate()?;
    #[cfg(windows)]
    {
        platform::open(ctx, helper_path, instance_id, expected_session_id, prepared).await
    }
    #[cfg(not(windows))]
    {
        let _ = (helper_path, instance_id, expected_session_id, prepared);
        Err(invalid("The separate restricted file viewer is currently available on Windows only. No in-app fallback was opened."))
    }
}

/// Cleanup deliberately does not require a *live* NAS session: only the exact
/// original instance/receipt may close its old handle after lock or reconnect.
pub async fn close_preview(
    instance_id: &str,
    expected_session_id: &str,
    viewer_id: &str,
) -> SynologyResult<bool> {
    #[cfg(windows)]
    {
        lifecycle::close(
            lifecycle::registry(),
            instance_id,
            expected_session_id,
            viewer_id,
        )
        .await
    }
    #[cfg(not(windows))]
    {
        let _ = (instance_id, expected_session_id, viewer_id);
        Ok(false)
    }
}

#[cfg(any(windows, test))]
mod lifecycle {
    use super::*;
    #[cfg(windows)]
    use std::sync::OnceLock;
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        time::Duration,
    };
    use tokio::{
        io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
        sync::{oneshot, watch, Notify},
    };

    pub(super) const MAX_BYTES: usize = 16 * 1024 * 1024;
    pub(super) const READY: &[u8] = b"SORNG_VIEWER_READY_V1\n";
    #[cfg(windows)]
    pub(super) const STARTUP_LIMIT: Duration = Duration::from_secs(20);
    #[cfg(windows)]
    pub(super) const LIFETIME_LIMIT: Duration = Duration::from_secs(30 * 60);
    const CLOSE_LIMIT: Duration = Duration::from_secs(5);
    const MAX_VIEWERS: usize = 4;

    pub(super) fn validate_owner(instance: &str, receipt: &str) -> SynologyResult<()> {
        if [instance, receipt]
            .into_iter()
            .any(|s| s.is_empty() || s.len() > 4096 || s.chars().any(char::is_control))
        {
            return Err(invalid("The viewer session reference is invalid."));
        }
        Ok(())
    }

    fn validate_id(id: &str) -> SynologyResult<()> {
        if id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err(invalid("The viewer reference is invalid."));
        }
        Ok(())
    }

    pub(super) fn header(prepared: &PreparedPreview) -> SynologyResult<Vec<u8>> {
        prepared.display.validate()?;
        if prepared.name.is_empty()
            || prepared.name.len() > 255
            || prepared
                .name
                .chars()
                .any(|c| c.is_control() || c == '/' || c == '\\')
            || prepared.bytes.len() > MAX_BYTES
            || (prepared.bytes.is_empty() && prepared.kind != FileViewerKind::Text)
        {
            return Err(invalid(
                "The file metadata or size is outside the viewer limits.",
            ));
        }
        let json = serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "kind": prepared.kind,
            "name": prepared.name,
            "byteLength": prepared.bytes.len(),
            "display": prepared.display,
        }))
        .map_err(|_| invalid("The file viewer request could not be prepared."))?;
        if json.is_empty() || json.len() > 4096 {
            return Err(invalid("The file viewer header exceeds its limit."));
        }
        Ok(json)
    }

    pub(super) async fn handshake(
        input: &mut (impl AsyncWrite + Unpin),
        output: &mut (impl AsyncRead + Unpin),
        header: &[u8],
        bytes: &[u8],
    ) -> SynologyResult<()> {
        async {
            input.write_all(&(header.len() as u32).to_le_bytes()).await?;
            input.write_all(header).await?;
            input.write_all(bytes).await?;
            input.flush().await?;
            let mut ready = [0u8; READY.len()];
            output.read_exact(&mut ready).await?;
            if ready != READY {
                return Err(std::io::Error::other("unexpected viewer acknowledgment"));
            }
            Ok::<_, std::io::Error>(())
        }
        .await
        .map_err(|_| invalid("The restricted file viewer did not acknowledge a valid startup. Nothing was opened in the main app."))
    }

    pub(super) async fn revoked(active: &AtomicBool, cancelled: &Notify) {
        // Register before checking the atomic lease to avoid a lost wakeup.
        let notified = cancelled.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if active.load(Ordering::Acquire) {
            notified.await;
        }
    }

    struct Entry {
        instance: String,
        receipt: String,
        cancel: Option<oneshot::Sender<()>>,
        done: watch::Receiver<bool>,
    }

    #[derive(Default)]
    pub(super) struct Registry(Mutex<HashMap<String, Entry>>);

    #[cfg(windows)]
    pub(super) fn registry() -> Arc<Registry> {
        static REGISTRY: OnceLock<Arc<Registry>> = OnceLock::new();
        REGISTRY
            .get_or_init(|| Arc::new(Registry::default()))
            .clone()
    }

    /// Held until the process tree and profile have been released, so in-flight
    /// cancellation cannot temporarily bypass the four-process admission bound.
    pub(super) struct Slot {
        registry: Arc<Registry>,
        pub(super) id: String,
        done: watch::Sender<bool>,
    }

    impl Drop for Slot {
        fn drop(&mut self) {
            self.registry
                .0
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&self.id);
            let _ = self.done.send(true);
        }
    }

    impl Registry {
        pub(super) fn reserve(
            self: &Arc<Self>,
            instance: &str,
            receipt: &str,
        ) -> SynologyResult<(Slot, oneshot::Receiver<()>)> {
            validate_owner(instance, receipt)?;
            let mut map = self
                .0
                .lock()
                .map_err(|_| invalid("The file viewer manager is unavailable."))?;
            if map.len() >= MAX_VIEWERS {
                return Err(invalid(
                    "Close an existing file preview before opening another (maximum four).",
                ));
            }
            let id = uuid::Uuid::new_v4().to_string();
            let (cancel, receiver) = oneshot::channel();
            let (done, completed) = watch::channel(false);
            map.insert(
                id.clone(),
                Entry {
                    instance: instance.to_owned(),
                    receipt: receipt.to_owned(),
                    cancel: Some(cancel),
                    done: completed,
                },
            );
            Ok((
                Slot {
                    registry: self.clone(),
                    id,
                    done,
                },
                receiver,
            ))
        }

        fn cancel(
            &self,
            instance: &str,
            receipt: &str,
            id: &str,
        ) -> SynologyResult<Option<watch::Receiver<bool>>> {
            let mut map = self
                .0
                .lock()
                .map_err(|_| invalid("The file viewer manager is unavailable."))?;
            let Some(entry) = map
                .get_mut(id)
                .filter(|entry| entry.instance == instance && entry.receipt == receipt)
            else {
                return Ok(None);
            };
            if let Some(cancel) = entry.cancel.take() {
                let _ = cancel.send(());
            }
            Ok(Some(entry.done.clone()))
        }
    }

    pub(super) async fn close(
        registry: Arc<Registry>,
        instance: &str,
        receipt: &str,
        id: &str,
    ) -> SynologyResult<bool> {
        validate_owner(instance, receipt)?;
        validate_id(id)?;
        let Some(mut done) = registry.cancel(instance, receipt, id)? else {
            return Ok(false);
        };
        tokio::time::timeout(CLOSE_LIMIT, async {
            while !*done.borrow_and_update() {
                done.changed()
                    .await
                    .map_err(|_| invalid("The file viewer cleanup could not be confirmed."))?;
            }
            Ok(true)
        })
        .await
        .map_err(|_| invalid("The file viewer is still closing. Retry Close preview shortly."))?
    }

    /// Dropping an in-flight IPC future cannot orphan an unacknowledged viewer.
    pub(super) struct PendingOpen {
        pub(super) registry: Arc<Registry>,
        pub(super) instance: String,
        pub(super) receipt: String,
        pub(super) id: String,
        pub(super) armed: bool,
    }

    impl Drop for PendingOpen {
        fn drop(&mut self) {
            if self.armed {
                let _ = self
                    .registry
                    .cancel(&self.instance, &self.receipt, &self.id);
            }
        }
    }

    pub(super) fn allowed_environment(
        vars: impl IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
    ) -> Vec<(std::ffi::OsString, std::ffi::OsString)> {
        vars.into_iter()
            .filter(|(name, _)| {
                name.to_str().is_some_and(|name| {
                    ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA"]
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(allowed))
                })
            })
            .collect()
    }
}

#[cfg(windows)]
mod platform {
    use super::{lifecycle::*, *};
    use std::{
        os::windows::{
            ffi::OsStrExt,
            fs::MetadataExt,
            io::{AsRawHandle, FromRawHandle, OwnedHandle},
        },
        process::Stdio,
        sync::atomic::Ordering,
        time::Duration,
    };
    use tokio::{
        io::AsyncReadExt,
        process::{Child, Command},
        sync::oneshot,
    };

    #[derive(Default)]
    struct OpenMode {
        #[cfg(test)]
        hidden_smoke: bool,
        #[cfg(test)]
        observation: Option<oneshot::Sender<SynologyResult<SmokeObservation>>>,
    }

    #[cfg(test)]
    struct SmokeObservation {
        profile: std::path::PathBuf,
        processes: Vec<(u32, OwnedHandle)>,
        helper_id: u32,
    }

    struct Job(OwnedHandle);
    impl Job {
        fn new() -> SynologyResult<Self> {
            use windows_sys::Win32::System::JobObjects::{
                CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            };
            let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if raw.is_null() {
                return Err(invalid(
                    "Windows process containment is unavailable. No preview was opened.",
                ));
            }
            let job = Self(unsafe { OwnedHandle::from_raw_handle(raw) });
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if unsafe {
                SetInformationJobObject(
                    job.0.as_raw_handle(),
                    JobObjectExtendedLimitInformation,
                    (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    std::mem::size_of_val(&limits) as u32,
                )
            } == 0
            {
                return Err(invalid(
                    "Windows process containment could not be configured. No preview was opened.",
                ));
            }
            Ok(job)
        }
        fn attach(&self, child: &Child) -> SynologyResult<()> {
            use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
            let handle = child
                .raw_handle()
                .ok_or_else(|| invalid("The file viewer exited before startup."))?;
            if unsafe { AssignProcessToJobObject(self.0.as_raw_handle(), handle) } == 0 {
                return Err(invalid(
                    "Windows refused file viewer process containment. No file content was sent.",
                ));
            }
            Ok(())
        }

        #[cfg(test)]
        fn observe(&self, profile: &Path, helper_id: u32) -> SynologyResult<SmokeObservation> {
            use windows_sys::Win32::System::{
                JobObjects::{
                    JobObjectBasicProcessIdList, QueryInformationJobObject,
                    JOBOBJECT_BASIC_PROCESS_ID_LIST,
                },
                Threading::{OpenProcess, PROCESS_SYNCHRONIZE},
            };
            // Pointer-aligned storage for the variable-length Windows ID list.
            let mut storage = [0usize; 130];
            let list = storage
                .as_mut_ptr()
                .cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>();
            if unsafe {
                QueryInformationJobObject(
                    self.0.as_raw_handle(),
                    JobObjectBasicProcessIdList,
                    list.cast(),
                    std::mem::size_of_val(&storage) as u32,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                return Err(invalid(
                    "The synthetic broker test could not inspect its process Job.",
                ));
            }
            let count = unsafe { (*list).NumberOfProcessIdsInList as usize };
            if count == 0 || count > 128 {
                return Err(invalid(
                    "The synthetic broker process inventory exceeded its bound.",
                ));
            }
            let ids = unsafe {
                std::slice::from_raw_parts(
                    std::ptr::addr_of!((*list).ProcessIdList).cast::<usize>(),
                    count,
                )
            };
            let mut processes = Vec::new();
            for &id in ids {
                let id = u32::try_from(id)
                    .map_err(|_| invalid("The synthetic process ID was invalid."))?;
                let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, id) };
                if !handle.is_null() {
                    processes.push((id, unsafe { OwnedHandle::from_raw_handle(handle) }));
                }
            }
            Ok(SmokeObservation {
                profile: profile.to_owned(),
                processes,
                helper_id,
            })
        }
    }

    fn validate_helper(path: &Path) -> SynologyResult<()> {
        if !path.is_absolute()
            || path.file_name().is_none()
            || path.components().any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir | std::path::Component::CurDir
                )
            })
            || path
                .extension()
                .and_then(|v| v.to_str())
                .is_none_or(|v| !v.eq_ignore_ascii_case("exe"))
        {
            return Err(invalid("The packaged file viewer path is invalid."));
        }
        for (index, ancestor) in path.ancestors().enumerate() {
            let metadata = std::fs::symlink_metadata(ancestor).map_err(|_| {
                invalid(
                    "The packaged file viewer is unavailable. Install a complete desktop build.",
                )
            })?;
            if metadata.file_type().is_symlink()
                || metadata.file_attributes() & 0x400 != 0
                || (index == 0 && !metadata.is_file())
                || (index != 0 && !metadata.is_dir())
            {
                return Err(invalid(
                    "The packaged file viewer path is not a regular trusted file.",
                ));
            }
        }
        Ok(())
    }

    /// A fresh owner/SYSTEM-only inheritable DACL, before starting the helper.
    /// No document is stored here; this is the disposable WebView profile.
    fn private_profile() -> SynologyResult<tempfile::TempDir> {
        use windows_sys::Win32::{
            Foundation::LocalFree,
            Security::{
                Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
            },
        };
        let directory = tempfile::Builder::new()
            .prefix("sorng-viewer-profile-")
            .tempdir()
            .map_err(|_| invalid("A private file viewer profile could not be created."))?;
        let sddl: Vec<u16> = "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;OW)\0"
            .encode_utf16()
            .collect();
        let mut descriptor = std::ptr::null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(invalid(
                "Windows could not protect the private viewer profile.",
            ));
        }
        let path: Vec<u16> = directory
            .path()
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let secured = unsafe {
            SetFileSecurityW(
                path.as_ptr(),
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                descriptor,
            )
        };
        unsafe {
            LocalFree(descriptor);
        }
        if secured == 0 {
            return Err(invalid(
                "Windows refused private viewer profile permissions.",
            ));
        }
        Ok(directory)
    }

    async fn cleanup_profile(profile: tempfile::TempDir) {
        // WebView subprocess handles can outlive process termination briefly.
        // The blocking worker keeps ownership of this exact generated TempDir;
        // no remote path, caller path or wildcard participates in deletion.
        let cleanup = tokio::task::spawn_blocking(move || {
            for delay in [0, 50, 100, 200, 400, 800] {
                if delay != 0 {
                    std::thread::sleep(Duration::from_millis(delay));
                }
                match std::fs::remove_dir_all(profile.path()) {
                    Ok(()) => return,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                    Err(_) => {}
                }
            }
            log::warn!(
                "A stopped file viewer profile could not be removed after bounded cleanup retries."
            );
            // TempDir's drop makes one final best-effort cleanup attempt.
        });
        // Release the admission slot after a short cleanup budget even if the
        // OS filesystem call stalls; the worker still owns only this profile.
        let _ = tokio::time::timeout(Duration::from_secs(2), cleanup).await;
    }

    pub(super) async fn open(
        ctx: &FileTransferContext,
        helper_path: &Path,
        instance: &str,
        receipt: &str,
        prepared: PreparedPreview,
    ) -> SynologyResult<IsolatedViewerHandle> {
        open_with_mode(
            ctx,
            helper_path,
            instance,
            receipt,
            prepared,
            OpenMode::default(),
        )
        .await
    }

    async fn open_with_mode(
        ctx: &FileTransferContext,
        helper_path: &Path,
        instance: &str,
        receipt: &str,
        prepared: PreparedPreview,
        mode: OpenMode,
    ) -> SynologyResult<IsolatedViewerHandle> {
        let json = header(&prepared)?;
        validate_owner(instance, receipt)?;
        validate_helper(helper_path)?;
        let registry = registry();
        let (slot, mut cancel) = registry.reserve(instance, receipt)?;
        let mut pending = PendingOpen {
            registry,
            instance: instance.to_owned(),
            receipt: receipt.to_owned(),
            id: slot.id.clone(),
            armed: true,
        };
        let profile = private_profile()?;
        let job = Job::new()?;
        ctx.assert_active()?;
        let mut command = Command::new(helper_path);
        command
            .arg("--profile-dir")
            .arg(profile.path())
            .current_dir(
                helper_path
                    .parent()
                    .ok_or_else(|| invalid("The packaged viewer directory is unavailable."))?,
            )
            .env_clear()
            .envs(allowed_environment(std::env::vars_os()))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .kill_on_drop(true);
        #[cfg(test)]
        if mode.hidden_smoke {
            // The fixed debug-helper flag cannot be provided by an IPC caller.
            command.arg("--smoke-hold");
        }
        #[cfg(not(test))]
        let _ = mode;
        let mut child = command.spawn().map_err(|_| invalid("The separate file viewer could not start. Check that this desktop build includes its viewer helper."))?;
        // Helper's first action blocks on framed stdin. No untrusted bytes are
        // released until mandatory process-tree containment is in place.
        job.attach(&child)?;
        let mut input = child
            .stdin
            .take()
            .ok_or_else(|| invalid("The viewer input pipe is unavailable."))?;
        let mut output = child
            .stdout
            .take()
            .ok_or_else(|| invalid("The viewer status pipe is unavailable."))?;
        let handle = IsolatedViewerHandle {
            viewer_id: slot.id.clone(),
            name: prepared.name,
            bytes: prepared.bytes.len(),
            isolation: "os-webview-process",
        };
        let active = ctx.active.clone();
        let cancelled = ctx.cancelled.clone();
        let (ready, acknowledged) = oneshot::channel();
        tokio::spawn(async move {
            let lifetime = tokio::time::sleep(LIFETIME_LIMIT);
            tokio::pin!(lifetime);
            let start = tokio::select! {
                biased;
                _ = &mut cancel => Err(invalid("The file preview was cancelled before startup.")),
                _ = revoked(&active, &cancelled) => Err(SynologyError::session_expired("The file viewer session ended before startup.")),
                result = tokio::time::timeout(STARTUP_LIMIT, handshake(&mut input, &mut output, &json, &prepared.bytes)) => result.unwrap_or_else(|_| Err(invalid("The restricted file viewer did not become ready within 20 seconds."))),
            };
            drop(prepared.bytes);
            let started = start.is_ok() && active.load(Ordering::Acquire);
            let start = if started || start.is_err() {
                start
            } else {
                Err(SynologyError::session_expired(
                    "The file viewer session ended during startup.",
                ))
            };
            #[cfg(test)]
            if let Some(observation) = mode.observation {
                let result = if started {
                    job.observe(profile.path(), child.id().unwrap_or(0))
                } else {
                    Err(invalid("The hidden broker smoke did not start."))
                };
                let _ = observation.send(result);
            }
            let delivered = ready.send(start).is_ok();
            if started && delivered {
                let mut extra = [0u8; 1];
                tokio::select! {
                    biased;
                    _ = &mut cancel => {},
                    _ = revoked(&active, &cancelled) => {},
                    _ = &mut lifetime => {},
                    _ = child.wait() => {},
                    // Any extra output or EOF is not part of the fixed protocol.
                    _ = output.read(&mut extra) => {},
                }
            }
            drop(input);
            let _ = child.start_kill();
            drop(job); // kill-on-close also terminates the WebView descendants.
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            drop(child);
            cleanup_profile(profile).await;
            drop(slot);
        });
        acknowledged
            .await
            .map_err(|_| invalid("The file viewer closed before startup could be confirmed."))??;
        ctx.assert_active()?;
        pending.armed = false;
        Ok(handle)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn mandatory_job_and_private_profile_are_available_without_launching_apps() {
            let job = Job::new().unwrap();
            drop(job);
            let profile = private_profile().unwrap();
            assert!(profile.path().is_absolute());
            assert!(std::fs::read_dir(profile.path()).unwrap().next().is_none());
            profile.close().unwrap();
        }
        #[test]
        fn helper_path_never_uses_path_search_or_a_script() {
            assert!(validate_helper(Path::new("viewer.exe")).is_err());
            let temp = tempfile::tempdir().unwrap();
            assert!(validate_helper(&temp.path().join("viewer.ps1")).is_err());
            assert!(validate_helper(&temp.path().join("absent.exe")).is_err());
        }

        #[tokio::test]
        async fn cleanup_removes_only_its_owned_private_profile() {
            let untouched = tempfile::tempdir().unwrap();
            let profile = private_profile().unwrap();
            let exact = profile.path().to_owned();
            std::fs::write(exact.join("synthetic-cache"), b"fixture").unwrap();
            cleanup_profile(profile).await;
            assert!(!exact.exists());
            assert!(untouched.path().exists());
        }

        /// Explicit opt-in; uses only the already-built local helper and tiny
        /// synthetic bytes. Never opens a visible window or contacts a NAS.
        #[tokio::test]
        #[ignore = "requires the debug helper built in .artifacts/cargo-synology"]
        async fn broker_helper_hidden_smoke() {
            use base64::Engine;
            use std::sync::{atomic::AtomicBool, Arc};
            use windows_sys::Win32::{
                Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
                System::Threading::WaitForSingleObject,
            };
            let helper = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../.artifacts/cargo-synology/debug/sorng-file-viewer-host.exe")
                .canonicalize()
                .expect("build the synthetic helper before this explicit smoke");
            let png = base64::engine::general_purpose::STANDARD
                .decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
                .unwrap();
            let stream = "0 0 1 rg 10 10 20 20 re f\n";
            let objects = ["<< /Type /Catalog /Pages 2 0 R >>".to_string(), "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(), "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << >> >>".into(), format!("<< /Length {} >>\nstream\n{stream}endstream", stream.len())];
            let mut pdf = "%PDF-1.4\n".to_string();
            let mut offsets = Vec::new();
            for (i, object) in objects.iter().enumerate() {
                offsets.push(pdf.len());
                pdf.push_str(&format!("{} 0 obj\n{object}\nendobj\n", i + 1));
            }
            let xref = pdf.len();
            pdf.push_str("xref\n0 5\n0000000000 65535 f \n");
            for offset in offsets {
                pdf.push_str(&format!("{offset:010} 00000 n \n"));
            }
            pdf.push_str(&format!(
                "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
            ));
            for (index, (kind, bytes)) in [
                (FileViewerKind::Text, b"<script>inert</script>".to_vec()),
                (FileViewerKind::Text, vec![]),
                (FileViewerKind::Image, png),
                (FileViewerKind::Pdf, pdf.into_bytes()),
            ]
            .into_iter()
            .enumerate()
            {
                let ctx = FileTransferContext {
                    client: crate::client::SynoClient::new(&crate::types::SynologyConfig {
                        host: "127.0.0.1".into(),
                        port: 1,
                        username: String::new(),
                        password: String::new(),
                        use_https: false,
                        insecure: false,
                        timeout_secs: 1,
                        otp_code: None,
                        device_token: None,
                        access_token: None,
                    })
                    .unwrap(),
                    active: Arc::new(AtomicBool::new(true)),
                    cancelled: Arc::new(tokio::sync::Notify::new()),
                };
                let (observation, observed) = oneshot::channel();
                let handle = open_with_mode(
                    &ctx,
                    &helper,
                    "synthetic-instance",
                    "synthetic-receipt",
                    PreparedPreview {
                        name: "Synthetic fixture".into(),
                        kind,
                        bytes,
                        display: ViewerDisplayOptions {
                            text_wrap: true,
                            text_font_size: 14,
                            image_fit: ViewerImageFit::Contain,
                        },
                    },
                    OpenMode {
                        hidden_smoke: true,
                        observation: Some(observation),
                    },
                )
                .await
                .unwrap();
                let observed = observed.await.unwrap().unwrap();
                assert!(observed.profile.is_dir());
                assert!(
                    observed.processes.len() >= 2,
                    "the Job must contain helper and WebView descendants"
                );
                let helper_process = &observed
                    .processes
                    .iter()
                    .find(|(id, _)| *id == observed.helper_id)
                    .expect("helper is in its own Job")
                    .1;
                assert!(
                    !close_preview("other-instance", "synthetic-receipt", &handle.viewer_id)
                        .await
                        .unwrap()
                );
                assert!(
                    !close_preview("synthetic-instance", "new-receipt", &handle.viewer_id)
                        .await
                        .unwrap()
                );
                assert_eq!(
                    unsafe { WaitForSingleObject(helper_process.as_raw_handle(), 0) },
                    WAIT_TIMEOUT
                );
                if index == 3 {
                    // The same lifecycle also closes an already-started helper
                    // on authoritative session revocation without a UI request.
                    ctx.active.store(false, Ordering::Release);
                    ctx.cancelled.notify_waiters();
                } else {
                    assert!(close_preview(
                        "synthetic-instance",
                        "synthetic-receipt",
                        &handle.viewer_id
                    )
                    .await
                    .unwrap());
                }
                tokio::time::timeout(Duration::from_secs(5), async {
                    loop {
                        if !observed.profile.exists() && observed.processes.iter().all(|(_,process)| unsafe { WaitForSingleObject(process.as_raw_handle(), 0) } == WAIT_OBJECT_0) { break; }
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                }).await.expect("all Job processes and private profile must be gone");
                if index == 3 {
                    // Lease cleanup may finish just before slot bookkeeping.
                    // Await that last acknowledgment before testing repeat close.
                    let _ =
                        close_preview("synthetic-instance", "synthetic-receipt", &handle.viewer_id)
                            .await
                            .unwrap();
                }
                assert!(!close_preview(
                    "synthetic-instance",
                    "synthetic-receipt",
                    &handle.viewer_id
                )
                .await
                .unwrap());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{lifecycle::*, *};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        sync::Notify,
    };

    fn prepared() -> PreparedPreview {
        PreparedPreview {
            name: "fixture.txt".into(),
            kind: FileViewerKind::Text,
            bytes: b"<script>not executed</script>".to_vec(),
            display: ViewerDisplayOptions {
                text_wrap: false,
                text_font_size: 16,
                image_fit: ViewerImageFit::Actual,
            },
        }
    }

    #[test]
    fn display_and_header_are_strict_bounded_and_content_free() {
        let p = prepared();
        let value: serde_json::Value = serde_json::from_slice(&header(&p).unwrap()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"version":1,"kind":"text","name":"fixture.txt","byteLength":p.bytes.len(),"display":{"textWrap":false,"textFontSize":16,"imageFit":"actual"}})
        );
        for display in [
            serde_json::json!({"textWrap":"false","textFontSize":16,"imageFit":"actual"}),
            serde_json::json!({"textWrap":false,"textFontSize":16,"imageFit":"actual","script":"x"}),
            serde_json::json!({"textWrap":false,"textFontSize":16,"imageFit":"bad"}),
        ] {
            assert!(serde_json::from_value::<ViewerDisplayOptions>(display).is_err());
        }
        let mut p = prepared();
        p.display.text_font_size = 25;
        assert!(header(&p).is_err());
        let mut p = prepared();
        p.name = "../outside".into();
        assert!(header(&p).is_err());
        let mut p = prepared();
        p.bytes = vec![0; MAX_BYTES + 1];
        assert!(header(&p).is_err());
        p.bytes.clear();
        assert!(header(&p).is_ok());
        p.kind = FileViewerKind::Pdf;
        assert!(header(&p).is_err());
    }

    #[tokio::test]
    async fn pipe_frames_exact_bytes_then_waits_for_fixed_ready_without_closing_stdin() {
        let prepared = prepared();
        let json = header(&prepared).unwrap();
        let (mut parent_input, mut helper_input) = tokio::io::duplex(4096);
        let (mut helper_output, mut parent_output) = tokio::io::duplex(64);
        let expected = prepared.bytes.clone();
        let child = tokio::spawn(async move {
            let len = helper_input.read_u32_le().await.unwrap();
            let mut json = vec![0; len as usize];
            helper_input.read_exact(&mut json).await.unwrap();
            let header: serde_json::Value = serde_json::from_slice(&json).unwrap();
            let mut bytes = vec![0; header["byteLength"].as_u64().unwrap() as usize];
            helper_input.read_exact(&mut bytes).await.unwrap();
            assert_eq!(bytes, expected);
            helper_output.write_all(READY).await.unwrap();
            let mut extra = [0];
            assert_eq!(helper_input.read(&mut extra).await.unwrap(), 0);
        });
        handshake(
            &mut parent_input,
            &mut parent_output,
            &json,
            &prepared.bytes,
        )
        .await
        .unwrap();
        assert!(!child.is_finished());
        drop(parent_input);
        child.await.unwrap();
    }

    #[tokio::test]
    async fn wrong_acknowledgment_and_stalled_reader_fail_without_leaking_output() {
        let (mut input, _reader) = tokio::io::duplex(4096);
        let mut output = b"PRIVATE-UNEXPECTED!!!".as_slice();
        let error = handshake(&mut input, &mut output, b"{}", b"x")
            .await
            .unwrap_err();
        assert!(!error.to_string().contains("PRIVATE"));
        let (mut input, _reader) = tokio::io::duplex(1);
        let mut output = READY;
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(10),
            handshake(&mut input, &mut output, b"{}", b"x")
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn exact_receipt_close_waits_for_cleanup_and_wrong_owner_cannot_cancel() {
        let registry = Arc::new(Registry::default());
        let (slot, mut cancel) = registry.reserve("nas-a", "receipt-a").unwrap();
        let id = slot.id.clone();
        assert!(!close(registry.clone(), "nas-b", "receipt-a", &id)
            .await
            .unwrap());
        assert!(!close(registry.clone(), "nas-a", "new-receipt", &id)
            .await
            .unwrap());
        assert!(matches!(
            cancel.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty)
        ));
        let registry2 = registry.clone();
        let id2 = id.clone();
        let closer =
            tokio::spawn(
                async move { close(registry2, "nas-a", "receipt-a", &id2).await.unwrap() },
            );
        cancel.await.unwrap();
        assert!(!closer.is_finished());
        drop(slot);
        assert!(closer.await.unwrap());
        assert!(!close(registry, "nas-a", "receipt-a", &id).await.unwrap());
    }

    #[test]
    fn maximum_four_includes_starting_and_closing_slots_then_reclaims() {
        let registry = Arc::new(Registry::default());
        let mut slots: Vec<_> = (0..4)
            .map(|_| registry.reserve("nas", "receipt").unwrap())
            .collect();
        assert!(registry.reserve("other", "receipt").is_err());
        slots.pop();
        assert!(registry.reserve("other", "receipt").is_ok());
    }

    #[tokio::test]
    async fn abandoned_open_cancels_only_its_reserved_handle() {
        let registry = Arc::new(Registry::default());
        let (slot, cancel) = registry.reserve("nas", "receipt").unwrap();
        let pending = PendingOpen {
            registry,
            instance: "nas".into(),
            receipt: "receipt".into(),
            id: slot.id.clone(),
            armed: true,
        };
        drop(pending);
        cancel.await.unwrap();
        drop(slot);
    }

    #[tokio::test]
    async fn revoked_lease_is_observed_before_registration_and_during_wait() {
        let active = Arc::new(AtomicBool::new(false));
        let notify = Arc::new(Notify::new());
        notify.notify_waiters();
        tokio::time::timeout(
            std::time::Duration::from_millis(50),
            revoked(&active, &notify),
        )
        .await
        .unwrap();
        active.store(true, Ordering::Release);
        let a = active.clone();
        let n = notify.clone();
        let waiter = tokio::spawn(async move { revoked(&a, &n).await });
        tokio::task::yield_now().await;
        active.store(false, Ordering::Release);
        notify.notify_waiters();
        tokio::time::timeout(std::time::Duration::from_millis(50), waiter)
            .await
            .unwrap()
            .unwrap();
    }

    #[test]
    fn environment_never_inherits_tokens_or_webview_overrides() {
        let env = allowed_environment(
            [
                ("SystemRoot", "system"),
                ("TEMP", "temp"),
                ("LOCALAPPDATA", "local"),
                ("PATH", "host-path"),
                ("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--no-sandbox"),
                ("NAS_PASSWORD", "private"),
            ]
            .map(|(k, v)| (k.into(), v.into())),
        );
        assert_eq!(env.len(), 3);
        assert!(env
            .iter()
            .all(|(_, v)| v != "private" && v != "--no-sandbox" && v != "host-path"));
    }
}

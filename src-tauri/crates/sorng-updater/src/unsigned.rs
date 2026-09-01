//! Guarded transport and installation helpers for explicitly acknowledged
//! unsigned GitHub release artifacts.

use std::{
    fs::File,
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

#[cfg(any(windows, test))]
use std::ffi::OsString;

use memmap2::{Mmap, MmapOptions};
use tauri_plugin_updater::Update;
use tempfile::TempDir;
use tokio::io::AsyncWriteExt;
use updater_reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT},
    redirect::Policy,
    Client, RequestBuilder,
};
use url::Url;

use crate::{error::UpdateError, proxy::ValidatedUpdaterProxy, types::UpdaterInstallMode};

const GITHUB_HOST: &str = "github.com";
const GITHUB_OWNER: &str = "supermarsx";
const GITHUB_REPOSITORY: &str = "sortOfRemoteNG";
const MAX_REDIRECTS: usize = 5;
const MAX_UNSIGNED_UPDATE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const UNSIGNED_DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const UNSIGNED_DOWNLOAD_TOTAL_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);
const UNSIGNED_UPDATE_TEMP_PREFIX: &str = "sortOfRemoteNG-unsigned-update-";
const STALE_UNSIGNED_UPDATE_AGE: Duration = Duration::from_secs(10 * 60);
const MAX_STALE_DIRS_PER_STARTUP: usize = 4;
const USER_AGENT: &str = "sortOfRemoteNG-unsigned-updater";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArtifactFormat {
    AppImage,
    Dmg,
    Msi,
    Nsis,
}

#[derive(Debug, Clone)]
pub(crate) struct ValidatedUnsignedArtifact {
    pub(crate) url: Url,
    file_name: String,
    format: ArtifactFormat,
    target: String,
}

pub(crate) struct DownloadedUnsignedArtifact {
    directory: TempDir,
    path: PathBuf,
    pub(crate) downloaded_bytes: u64,
    pub(crate) total_bytes: Option<u64>,
}

pub(crate) struct MappedUnsignedArtifact {
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    directory: TempDir,
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    path: PathBuf,
    bytes: Mmap,
    format: ArtifactFormat,
    pub(crate) downloaded_bytes: u64,
    pub(crate) total_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnsignedInstallOutcome {
    Installed,
    #[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
    ExternalInstallerLaunched,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    MacOsDmgOpened,
}

impl UnsignedInstallOutcome {
    pub(crate) fn exit_app_after_handoff(self) -> bool {
        matches!(self, Self::ExternalInstallerLaunched | Self::MacOsDmgOpened)
    }
}

pub(crate) fn ensure_unsigned_risk_acknowledged(
    acknowledged_risk: Option<bool>,
) -> Result<(), UpdateError> {
    if acknowledged_risk == Some(true) {
        Ok(())
    } else {
        Err(UpdateError::UnsignedRiskNotAcknowledged)
    }
}

pub(crate) fn require_unsigned_version(version: Option<&str>) -> Result<&str, UpdateError> {
    version
        .filter(|value| !value.trim().is_empty() && value.trim() == *value)
        .ok_or(UpdateError::UnsignedVersionRequired)
}

pub(crate) fn ensure_release_is_unsigned(signature: &str) -> Result<(), UpdateError> {
    if signature.trim().is_empty() {
        Ok(())
    } else {
        Err(UpdateError::SignedUpdateRequiresVerifiedInstall)
    }
}

pub(crate) fn cleanup_stale_unsigned_update_dirs() {
    let removed = cleanup_stale_unsigned_update_dirs_in(
        &std::env::temp_dir(),
        SystemTime::now(),
        STALE_UNSIGNED_UPDATE_AGE,
        MAX_STALE_DIRS_PER_STARTUP,
    );
    if removed > 0 {
        log::debug!("removed {removed} stale unsigned updater temp directories");
    }
}

fn cleanup_stale_unsigned_update_dirs_in(
    temp_root: &Path,
    now: SystemTime,
    stale_after: Duration,
    max_removals: usize,
) -> usize {
    if max_removals == 0 || !temp_root.is_absolute() {
        return 0;
    }
    let Ok(entries) = std::fs::read_dir(temp_root) else {
        return 0;
    };

    let mut removed = 0;
    for entry in entries.flatten() {
        if removed >= max_removals {
            break;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if path.parent() != Some(temp_root) {
            continue;
        }
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Some(random_suffix) = file_name.strip_prefix(UNSIGNED_UPDATE_TEMP_PREFIX) else {
            continue;
        };
        if random_suffix.is_empty()
            || !random_suffix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric())
        {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|metadata| metadata.modified()) else {
            continue;
        };
        let Ok(age) = now.duration_since(modified) else {
            continue;
        };
        if age < stale_after {
            continue;
        }

        if std::fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

pub(crate) fn validate_unsigned_artifact(
    update: &Update,
    install_mode: UpdaterInstallMode,
) -> Result<ValidatedUnsignedArtifact, UpdateError> {
    let target = tauri_plugin_updater::target().ok_or_else(|| {
        UpdateError::IncompatibleUnsignedArtifact(
            "the current operating-system/architecture target is unsupported".to_string(),
        )
    })?;

    validate_github_release_artifact(&update.download_url, &update.version, install_mode, &target)
}

fn validate_github_release_artifact(
    url: &Url,
    version: &str,
    install_mode: UpdaterInstallMode,
    target: &str,
) -> Result<ValidatedUnsignedArtifact, UpdateError> {
    validate_canonical_github_url(url)?;

    let (expected_file_name, format) = expected_artifact(version, install_mode, target)?;
    let segments = url.path_segments().ok_or_else(|| {
        UpdateError::InvalidUnsignedReleaseUrl("the URL has no hierarchical path".to_string())
    })?;
    let segments = segments.collect::<Vec<_>>();

    if segments.len() != 6
        || segments[0] != GITHUB_OWNER
        || segments[1] != GITHUB_REPOSITORY
        || segments[2] != "releases"
        || segments[3] != "download"
        || !is_safe_release_segment(segments[4])
    {
        return Err(UpdateError::InvalidUnsignedReleaseUrl(format!(
            "the URL must identify a {GITHUB_OWNER}/{GITHUB_REPOSITORY} release download"
        )));
    }

    if !release_tag_matches_version(segments[4], version) {
        return Err(UpdateError::InvalidUnsignedReleaseUrl(format!(
            "release tag {} does not match feed version {version}",
            segments[4]
        )));
    }

    if segments[5] != expected_file_name {
        return Err(UpdateError::IncompatibleUnsignedArtifact(format!(
            "expected {expected_file_name} for the current {target} {install_mode:?} install, got {}",
            segments[5]
        )));
    }

    Ok(ValidatedUnsignedArtifact {
        url: url.clone(),
        file_name: expected_file_name,
        format,
        target: target.to_string(),
    })
}

fn validate_canonical_github_url(url: &Url) -> Result<(), UpdateError> {
    if url.scheme() != "https" {
        return Err(UpdateError::InvalidUnsignedReleaseUrl(
            "release artifacts must use HTTPS".to_string(),
        ));
    }
    if url.host_str() != Some(GITHUB_HOST) {
        return Err(UpdateError::InvalidUnsignedReleaseUrl(format!(
            "release artifacts must be hosted on {GITHUB_HOST}"
        )));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(UpdateError::InvalidUnsignedReleaseUrl(
            "credentials are not allowed in a release URL".to_string(),
        ));
    }
    if url.port_or_known_default() != Some(443) {
        return Err(UpdateError::InvalidUnsignedReleaseUrl(
            "release artifacts must use the standard HTTPS port".to_string(),
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(UpdateError::InvalidUnsignedReleaseUrl(
            "release URLs cannot contain a query or fragment".to_string(),
        ));
    }
    Ok(())
}

fn is_safe_release_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}

fn release_tag_matches_version(tag: &str, version: &str) -> bool {
    tag == version || version.strip_suffix(".0") == Some(tag)
}

fn expected_artifact(
    version: &str,
    install_mode: UpdaterInstallMode,
    target: &str,
) -> Result<(String, ArtifactFormat), UpdateError> {
    if version.is_empty()
        || !version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(UpdateError::IncompatibleUnsignedArtifact(
            "the feed version cannot be represented in a release filename".to_string(),
        ));
    }

    let (suffix, format, expected_os) = match install_mode {
        UpdaterInstallMode::AppImage => (".AppImage", ArtifactFormat::AppImage, "linux"),
        UpdaterInstallMode::MacOsApp => (".dmg", ArtifactFormat::Dmg, "darwin"),
        UpdaterInstallMode::Msi => (".msi", ArtifactFormat::Msi, "windows"),
        UpdaterInstallMode::Nsis => ("-setup.exe", ArtifactFormat::Nsis, "windows"),
        mode => {
            return Err(UpdateError::SelfUpdateUnsupported(
                mode.self_update_message()
                    .unwrap_or("This installation type cannot launch an unsigned update.")
                    .to_string(),
            ))
        }
    };

    let Some((target_os, target_arch)) = target.split_once('-') else {
        return Err(UpdateError::IncompatibleUnsignedArtifact(format!(
            "updater target {target} has no architecture"
        )));
    };
    if target_os != expected_os || !matches!(target_arch, "x86_64" | "aarch64") {
        return Err(UpdateError::IncompatibleUnsignedArtifact(format!(
            "install mode {install_mode:?} is not compatible with target {target}"
        )));
    }

    Ok((format!("sortOfRemoteNG_{version}_{target}{suffix}"), format))
}

fn is_allowed_redirect_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(
            url.host_str(),
            Some("github.com")
                | Some("release-assets.githubusercontent.com")
                | Some("objects.githubusercontent.com")
        )
}

fn build_download_client(
    update: &Update,
    proxy: Option<&ValidatedUpdaterProxy>,
) -> Result<Client, UpdateError> {
    let redirect_policy = Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error(io::Error::other(
                "unsigned updater exceeded the redirect limit",
            ));
        }
        if !is_allowed_redirect_url(attempt.url()) {
            return attempt.error(io::Error::other(
                "unsigned updater rejected a non-GitHub HTTPS redirect",
            ));
        }
        attempt.follow()
    });

    let mut builder = Client::builder()
        .redirect(redirect_policy)
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(30));

    if let Some(proxy) = proxy {
        builder = builder.proxy(proxy.to_reqwest_proxy()?);
    } else if update.no_proxy {
        builder = builder.no_proxy();
    } else if let Some(proxy) = update.proxy.as_ref() {
        let proxy = updater_reqwest::Proxy::all(proxy.as_str())
            .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;
        builder = builder.proxy(proxy);
    }
    builder
        .build()
        .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))
}

fn build_artifact_request(client: &Client, url: Url) -> RequestBuilder {
    client.get(url).headers(public_artifact_headers())
}

fn public_artifact_headers() -> HeaderMap {
    // Never forward updater/private-feed headers to the canonical public
    // GitHub artifact host. Only fixed public-safe headers are permitted.
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/octet-stream"));
    headers
}

fn validate_declared_content_length(total_bytes: Option<u64>) -> Result<(), UpdateError> {
    if total_bytes.is_some_and(|length| length > MAX_UNSIGNED_UPDATE_BYTES) {
        Err(UpdateError::UnsignedPayloadTooLarge {
            limit_bytes: MAX_UNSIGNED_UPDATE_BYTES,
        })
    } else {
        Ok(())
    }
}

async fn with_download_idle_timeout<F, T>(
    future: F,
    idle_timeout: Duration,
) -> Result<T, UpdateError>
where
    F: std::future::Future<Output = T>,
{
    tokio::time::timeout(idle_timeout, future)
        .await
        .map_err(|_| {
            UpdateError::UnsignedDownload(format!(
                "GitHub sent no artifact data for {} seconds",
                idle_timeout.as_secs()
            ))
        })
}

async fn with_download_total_timeout<F, T>(
    future: F,
    total_timeout: Duration,
) -> Result<T, UpdateError>
where
    F: std::future::Future<Output = T>,
{
    tokio::time::timeout(total_timeout, future)
        .await
        .map_err(|_| {
            UpdateError::UnsignedDownload(format!(
                "artifact download exceeded the {}-second total deadline",
                total_timeout.as_secs()
            ))
        })
}

pub(crate) async fn download_unsigned_artifact<F>(
    update: &Update,
    artifact: &ValidatedUnsignedArtifact,
    proxy: Option<&ValidatedUpdaterProxy>,
    on_progress: F,
) -> Result<DownloadedUnsignedArtifact, UpdateError>
where
    F: FnMut(u64, Option<u64>),
{
    with_download_total_timeout(
        download_unsigned_artifact_inner(update, artifact, proxy, on_progress),
        UNSIGNED_DOWNLOAD_TOTAL_TIMEOUT,
    )
    .await?
}

async fn download_unsigned_artifact_inner<F>(
    update: &Update,
    artifact: &ValidatedUnsignedArtifact,
    proxy: Option<&ValidatedUpdaterProxy>,
    mut on_progress: F,
) -> Result<DownloadedUnsignedArtifact, UpdateError>
where
    F: FnMut(u64, Option<u64>),
{
    let client = build_download_client(update, proxy)?;

    let mut response = with_download_idle_timeout(
        build_artifact_request(&client, artifact.url.clone()).send(),
        UNSIGNED_DOWNLOAD_IDLE_TIMEOUT,
    )
    .await?
    .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;

    if !is_allowed_redirect_url(response.url()) {
        return Err(UpdateError::InvalidUnsignedReleaseUrl(
            "the final download URL left the GitHub release asset hosts".to_string(),
        ));
    }
    if !response.status().is_success() {
        return Err(UpdateError::UnsignedDownload(format!(
            "GitHub returned HTTP {}",
            response.status()
        )));
    }

    let total_bytes = response.content_length();
    validate_declared_content_length(total_bytes)?;

    let directory = tempfile::Builder::new()
        .prefix(UNSIGNED_UPDATE_TEMP_PREFIX)
        .tempdir()
        .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;
    let path = directory.path().join(&artifact.file_name);
    let partial_path = directory
        .path()
        .join(format!("{}.part", artifact.file_name));
    let mut file = tokio::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&partial_path)
        .await
        .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;

    let mut downloaded_bytes = 0_u64;
    on_progress(downloaded_bytes, total_bytes);
    loop {
        let chunk = with_download_idle_timeout(response.chunk(), UNSIGNED_DOWNLOAD_IDLE_TIMEOUT)
            .await?
            .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;
        let Some(chunk) = chunk else {
            break;
        };
        downloaded_bytes = downloaded_bytes
            .checked_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX))
            .ok_or(UpdateError::UnsignedPayloadTooLarge {
                limit_bytes: MAX_UNSIGNED_UPDATE_BYTES,
            })?;
        if downloaded_bytes > MAX_UNSIGNED_UPDATE_BYTES {
            return Err(UpdateError::UnsignedPayloadTooLarge {
                limit_bytes: MAX_UNSIGNED_UPDATE_BYTES,
            });
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;
        on_progress(downloaded_bytes, total_bytes);
    }

    if downloaded_bytes == 0 {
        return Err(UpdateError::UnsignedDownload(
            "GitHub returned an empty artifact".to_string(),
        ));
    }
    if total_bytes.is_some_and(|expected| expected != downloaded_bytes) {
        return Err(UpdateError::UnsignedDownload(format!(
            "incomplete artifact: expected {total_bytes:?} bytes, received {downloaded_bytes}"
        )));
    }

    file.sync_all()
        .await
        .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;
    drop(file);
    tokio::fs::rename(&partial_path, &path)
        .await
        .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;

    Ok(DownloadedUnsignedArtifact {
        directory,
        path,
        downloaded_bytes,
        total_bytes,
    })
}

pub(crate) fn validate_downloaded_artifact(
    downloaded: DownloadedUnsignedArtifact,
    expected: &ValidatedUnsignedArtifact,
) -> Result<MappedUnsignedArtifact, UpdateError> {
    let file = File::open(&downloaded.path)
        .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;
    let length = file
        .metadata()
        .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?
        .len();
    if length == 0 || length != downloaded.downloaded_bytes {
        return Err(UpdateError::UnsignedDownload(
            "the downloaded artifact changed before validation".to_string(),
        ));
    }

    // SAFETY: the artifact was atomically renamed after its only writer was
    // closed. This read-only mapping and its owning TempDir move together, and
    // no code mutates the mapped file before the mapping is dropped.
    let bytes = unsafe { MmapOptions::new().map(&file) }
        .map_err(|error| UpdateError::UnsignedDownload(error.to_string()))?;
    validate_artifact_magic(expected.format, &bytes, &expected.target)?;

    Ok(MappedUnsignedArtifact {
        directory: downloaded.directory,
        path: downloaded.path,
        bytes,
        format: expected.format,
        downloaded_bytes: downloaded.downloaded_bytes,
        total_bytes: downloaded.total_bytes,
    })
}

fn validate_artifact_magic(
    format: ArtifactFormat,
    bytes: &[u8],
    target: &str,
) -> Result<(), UpdateError> {
    let valid = match format {
        // NSIS payload architecture can differ from its executable stub, so the
        // PE header is validated structurally but its machine is not matched to
        // the release target.
        ArtifactFormat::Nsis => has_structurally_valid_pe_header(bytes),
        // MSI's CFB container does not reliably expose the package architecture.
        // Its architecture boundary remains the exact official feed filename.
        ArtifactFormat::Msi => bytes.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
        // AppImage replaces the executable itself, so its ELF machine must match
        // the feed target in addition to carrying the AppImage marker.
        ArtifactFormat::AppImage => appimage_matches_target(bytes, target),
        ArtifactFormat::Dmg => {
            bytes.len() >= 512 && bytes.get(bytes.len() - 512..bytes.len() - 508) == Some(b"koly")
        }
    };

    if valid {
        Ok(())
    } else {
        Err(UpdateError::IncompatibleUnsignedArtifact(format!(
            "the downloaded payload does not have the expected {format:?} file signature"
        )))
    }
}

fn has_structurally_valid_pe_header(bytes: &[u8]) -> bool {
    if bytes.get(..2) != Some(b"MZ") {
        return false;
    }
    let Some(offset_bytes) = bytes.get(0x3c..0x40) else {
        return false;
    };
    let pe_offset = u32::from_le_bytes(offset_bytes.try_into().expect("four-byte PE offset"));
    let Ok(pe_offset) = usize::try_from(pe_offset) else {
        return false;
    };
    if pe_offset < 0x40 {
        return false;
    }
    let Some(coff_end) = pe_offset.checked_add(24) else {
        return false;
    };
    if coff_end > bytes.len() || bytes.get(pe_offset..pe_offset + 4) != Some(b"PE\0\0") {
        return false;
    }
    let machine = u16::from_le_bytes(
        bytes[pe_offset + 4..pe_offset + 6]
            .try_into()
            .expect("two-byte PE machine"),
    );
    let optional_header_size = usize::from(u16::from_le_bytes(
        bytes[pe_offset + 20..pe_offset + 22]
            .try_into()
            .expect("two-byte optional-header size"),
    ));
    machine != 0
        && coff_end
            .checked_add(optional_header_size)
            .is_some_and(|end| end <= bytes.len())
}

fn appimage_matches_target(bytes: &[u8], target: &str) -> bool {
    if bytes.get(..4) != Some(b"\x7fELF")
        || bytes.get(4) != Some(&2) // ELFCLASS64
        || bytes.get(5) != Some(&1) // ELFDATA2LSB
        || bytes.get(8..10) != Some(b"AI")
        || !matches!(bytes.get(10), Some(1 | 2))
    {
        return false;
    }
    let Some(machine_bytes) = bytes.get(18..20) else {
        return false;
    };
    let machine = u16::from_le_bytes(
        machine_bytes
            .try_into()
            .expect("two-byte ELF machine field"),
    );
    match target {
        "linux-x86_64" => machine == 0x003e,
        "linux-aarch64" => machine == 0x00b7,
        _ => false,
    }
}

pub(crate) fn install_validated_artifact(
    update: &Update,
    artifact: MappedUnsignedArtifact,
) -> Result<UnsignedInstallOutcome, UpdateError> {
    match artifact.format {
        ArtifactFormat::Dmg => open_macos_dmg(artifact),
        ArtifactFormat::Msi | ArtifactFormat::Nsis => launch_windows_installer(artifact),
        ArtifactFormat::AppImage => {
            // `Update::install` is the same installer implementation used by the
            // signed path. Signature verification lives in `Update::download`, so
            // calling install with our already-confirmed and validated bytes keeps
            // the AppImage in-place replacement and rollback semantics intact.
            update
                .install(artifact.bytes.as_ref())
                .map_err(|error| UpdateError::UnsignedLaunch(error.to_string()))?;
            Ok(UnsignedInstallOutcome::Installed)
        }
    }
}

#[cfg(any(windows, test))]
fn windows_installer_parameters(
    format: ArtifactFormat,
    artifact_path: &std::path::Path,
) -> Result<OsString, UpdateError> {
    match format {
        ArtifactFormat::Nsis => Ok(OsString::from("/P /R /UPDATE")),
        ArtifactFormat::Msi => {
            let mut parameters = OsString::from("/i \"");
            parameters.push(artifact_path.as_os_str());
            parameters.push("\" /passive /promptrestart AUTOLAUNCHAPP=True");
            Ok(parameters)
        }
        other => Err(UpdateError::UnsignedLaunch(format!(
            "{other:?} is not a Windows installer"
        ))),
    }
}

#[cfg(any(windows, test))]
fn windows_shell_handoff_succeeded(result: isize) -> bool {
    // ShellExecuteW documents values greater than 32 as a successful handoff.
    result > 32
}

#[cfg(windows)]
fn launch_windows_installer(
    artifact: MappedUnsignedArtifact,
) -> Result<UnsignedInstallOutcome, UpdateError> {
    use std::{
        ffi::{OsStr, OsString},
        iter::once,
        os::windows::ffi::{OsStrExt, OsStringExt},
    };
    use windows_sys::{
        w,
        Win32::{
            System::SystemInformation::GetSystemDirectoryW,
            UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        },
    };

    fn encode_wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(once(0)).collect()
    }

    fn system_msiexec() -> Result<PathBuf, UpdateError> {
        // Windows' maximum extended path is 32,767 UTF-16 code units. A fixed
        // buffer avoids trusting PATH or an environment-provided system root.
        let mut buffer = vec![0_u16; 32_768];
        let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) };
        if length == 0 || usize::try_from(length).unwrap_or(usize::MAX) >= buffer.len() {
            return Err(UpdateError::UnsignedLaunch(
                "Windows could not resolve its system directory".to_string(),
            ));
        }
        let directory = PathBuf::from(OsString::from_wide(&buffer[..length as usize]));
        let executable = directory.join("msiexec.exe");
        if !executable.is_file() {
            return Err(UpdateError::UnsignedLaunch(format!(
                "Windows Installer was not found at {}",
                executable.display()
            )));
        }
        Ok(executable)
    }

    if !artifact.path.is_file() {
        return Err(UpdateError::UnsignedLaunch(
            "the validated installer disappeared before launch".to_string(),
        ));
    }

    let executable = match artifact.format {
        ArtifactFormat::Nsis => artifact.path.clone(),
        ArtifactFormat::Msi => system_msiexec()?,
        other => {
            return Err(UpdateError::UnsignedLaunch(format!(
                "{other:?} is not a Windows installer"
            )))
        }
    };
    let parameters = windows_installer_parameters(artifact.format, &artifact.path)?;
    let executable = encode_wide(executable.as_os_str());
    let parameters = encode_wide(parameters.as_os_str());
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            w!("open"),
            executable.as_ptr(),
            parameters.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;

    if !windows_shell_handoff_succeeded(result) {
        return Err(UpdateError::UnsignedLaunch(format!(
            "Windows rejected the installer handoff (ShellExecuteW code {result})"
        )));
    }

    // The app exits after this confirmed handoff so Windows can replace the
    // running executable. Match Tauri's updater lifecycle by persisting the
    // installer in the OS temp area; this is intentionally best-effort temp
    // retention rather than claiming cleanup while the installer is active.
    let _retained_directory = artifact.directory.keep();
    Ok(UnsignedInstallOutcome::ExternalInstallerLaunched)
}

#[cfg(not(windows))]
fn launch_windows_installer(
    _artifact: MappedUnsignedArtifact,
) -> Result<UnsignedInstallOutcome, UpdateError> {
    Err(UpdateError::UnsignedLaunch(
        "a Windows installer cannot be launched on this operating system".to_string(),
    ))
}

#[cfg(target_os = "macos")]
fn open_macos_dmg(artifact: MappedUnsignedArtifact) -> Result<UnsignedInstallOutcome, UpdateError> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg(&artifact.path)
        .status()
        .map_err(|error| UpdateError::UnsignedLaunch(error.to_string()))?;
    if !status.success() {
        return Err(UpdateError::UnsignedLaunch(format!(
            "macOS open rejected the DMG handoff with status {status}"
        )));
    }

    // LaunchServices mounts the DMG asynchronously and the app exits after the
    // checked handoff. Persist it in OS temp rather than deleting it during exit.
    let _retained_directory = artifact.directory.keep();
    Ok(UnsignedInstallOutcome::MacOsDmgOpened)
}

#[cfg(not(target_os = "macos"))]
fn open_macos_dmg(
    _artifact: MappedUnsignedArtifact,
) -> Result<UnsignedInstallOutcome, UpdateError> {
    Err(UpdateError::UnsignedLaunch(
        "a macOS DMG cannot be opened on this operating system".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn appimage_payload(machine: u16) -> Vec<u8> {
        let mut bytes = vec![0_u8; 64];
        bytes[0..4].copy_from_slice(b"\x7fELF");
        bytes[4] = 2;
        bytes[5] = 1;
        bytes[8..11].copy_from_slice(b"AI\x02");
        bytes[18..20].copy_from_slice(&machine.to_le_bytes());
        bytes
    }

    fn pe_payload(machine: u16) -> Vec<u8> {
        const PE_OFFSET: usize = 0x80;
        const OPTIONAL_HEADER_SIZE: usize = 0xf0;
        let mut bytes = vec![0_u8; PE_OFFSET + 24 + OPTIONAL_HEADER_SIZE];
        bytes[0..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&(PE_OFFSET as u32).to_le_bytes());
        bytes[PE_OFFSET..PE_OFFSET + 4].copy_from_slice(b"PE\0\0");
        bytes[PE_OFFSET + 4..PE_OFFSET + 6].copy_from_slice(&machine.to_le_bytes());
        bytes[PE_OFFSET + 6..PE_OFFSET + 8].copy_from_slice(&1_u16.to_le_bytes());
        bytes[PE_OFFSET + 20..PE_OFFSET + 22]
            .copy_from_slice(&(OPTIONAL_HEADER_SIZE as u16).to_le_bytes());
        bytes
    }

    fn release_url(file_name: &str) -> Url {
        Url::parse(&format!(
            "https://github.com/supermarsx/sortOfRemoteNG/releases/download/26.43/{file_name}"
        ))
        .expect("valid test release URL")
    }

    #[test]
    fn acknowledgement_must_be_explicitly_true() {
        ensure_unsigned_risk_acknowledged(Some(true)).expect("true acknowledgement is accepted");
        for value in [None, Some(false)] {
            assert!(matches!(
                ensure_unsigned_risk_acknowledged(value),
                Err(UpdateError::UnsignedRiskNotAcknowledged)
            ));
        }
    }

    #[test]
    fn unsigned_install_is_bound_to_the_displayed_version() {
        assert_eq!(
            require_unsigned_version(Some("26.43.0")).expect("exact version is accepted"),
            "26.43.0"
        );
        for version in [None, Some(""), Some("  "), Some("26.43.0 ")] {
            assert!(matches!(
                require_unsigned_version(version),
                Err(UpdateError::UnsignedVersionRequired)
            ));
        }
    }

    #[test]
    fn signed_releases_are_redirected_to_the_verified_installer() {
        ensure_release_is_unsigned("").expect("empty signature identifies unsigned feed entry");
        ensure_release_is_unsigned(" \n").expect("whitespace-only signature is unsigned");
        assert!(matches!(
            ensure_release_is_unsigned("minisign-data"),
            Err(UpdateError::SignedUpdateRequiresVerifiedInstall)
        ));
    }

    #[test]
    fn exact_github_release_artifacts_match_each_supported_package() {
        let cases = [
            (
                UpdaterInstallMode::Nsis,
                "windows-x86_64",
                "sortOfRemoteNG_26.43.0_windows-x86_64-setup.exe",
            ),
            (
                UpdaterInstallMode::Msi,
                "windows-aarch64",
                "sortOfRemoteNG_26.43.0_windows-aarch64.msi",
            ),
            (
                UpdaterInstallMode::AppImage,
                "linux-x86_64",
                "sortOfRemoteNG_26.43.0_linux-x86_64.AppImage",
            ),
            (
                UpdaterInstallMode::MacOsApp,
                "darwin-aarch64",
                "sortOfRemoteNG_26.43.0_darwin-aarch64.dmg",
            ),
        ];

        for (mode, target, file_name) in cases {
            let artifact =
                validate_github_release_artifact(&release_url(file_name), "26.43.0", mode, target)
                    .unwrap_or_else(|error| panic!("{mode:?} {target} should validate: {error}"));
            assert_eq!(artifact.file_name, file_name);
            assert_eq!(artifact.target, target);
        }
    }

    #[test]
    fn release_url_rejects_downgrades_other_repositories_and_url_tricks() {
        let expected_file = "sortOfRemoteNG_26.43.0_windows-x86_64-setup.exe";
        let invalid = [
            format!("http://github.com/supermarsx/sortOfRemoteNG/releases/download/26.43/{expected_file}"),
            format!("https://github.com/attacker/sortOfRemoteNG/releases/download/26.43/{expected_file}"),
            format!("https://github.com.evil.test/supermarsx/sortOfRemoteNG/releases/download/26.43/{expected_file}"),
            format!("https://user@github.com/supermarsx/sortOfRemoteNG/releases/download/26.43/{expected_file}"),
            format!("https://github.com/supermarsx/sortOfRemoteNG/releases/download/26.43/{expected_file}?raw=1"),
            format!("https://github.com/supermarsx/sortOfRemoteNG/releases/download/%2e%2e/{expected_file}"),
            format!("https://github.com/supermarsx/sortOfRemoteNG/releases/download/26.42/{expected_file}"),
        ];

        for raw in invalid {
            let url = Url::parse(&raw).expect("test URL parses");
            assert!(
                validate_github_release_artifact(
                    &url,
                    "26.43.0",
                    UpdaterInstallMode::Nsis,
                    "windows-x86_64",
                )
                .is_err(),
                "unsafe URL was accepted: {raw}"
            );
        }
    }

    #[test]
    fn release_tag_must_equal_the_version_or_omit_only_the_trailing_patch_zero() {
        assert!(release_tag_matches_version("26.43.0", "26.43.0"));
        assert!(release_tag_matches_version("26.43", "26.43.0"));
        assert!(!release_tag_matches_version("26.42", "26.43.0"));
        assert!(!release_tag_matches_version("26.43", "26.43.1"));
    }

    #[test]
    fn package_or_architecture_mismatch_is_rejected_before_download() {
        let nsis = release_url("sortOfRemoteNG_26.43.0_windows-x86_64-setup.exe");
        for (mode, target) in [
            (UpdaterInstallMode::Msi, "windows-x86_64"),
            (UpdaterInstallMode::Nsis, "windows-aarch64"),
            (UpdaterInstallMode::AppImage, "linux-x86_64"),
        ] {
            assert!(matches!(
                validate_github_release_artifact(&nsis, "26.43.0", mode, target),
                Err(UpdateError::IncompatibleUnsignedArtifact(_))
            ));
        }
    }

    #[test]
    fn redirects_are_limited_to_known_https_github_asset_hosts() {
        for raw in [
            "https://github.com/supermarsx/sortOfRemoteNG/releases/download/26.43/file.exe",
            "https://release-assets.githubusercontent.com/github-production-release-asset/file?token=x",
            "https://objects.githubusercontent.com/github-production-release-asset/file",
        ] {
            assert!(is_allowed_redirect_url(&Url::parse(raw).unwrap()), "{raw}");
        }

        for raw in [
            "http://release-assets.githubusercontent.com/file",
            "https://githubusercontent.com/file",
            "https://release-assets.githubusercontent.com.evil.test/file",
            "https://user@release-assets.githubusercontent.com/file",
        ] {
            assert!(!is_allowed_redirect_url(&Url::parse(raw).unwrap()), "{raw}");
        }
    }

    #[test]
    fn public_artifact_request_uses_only_fixed_safe_headers() {
        let headers = public_artifact_headers();
        assert_eq!(headers.len(), 1, "no caller/feed headers may cross hosts");
        assert_eq!(
            headers.get(ACCEPT).and_then(|value| value.to_str().ok()),
            Some("application/octet-stream")
        );
        assert!(headers
            .get(updater_reqwest::header::AUTHORIZATION)
            .is_none());
        assert!(headers
            .get(updater_reqwest::header::PROXY_AUTHORIZATION)
            .is_none());
    }

    #[test]
    fn declared_and_streamed_size_limits_share_the_same_two_gib_ceiling() {
        validate_declared_content_length(None).unwrap();
        validate_declared_content_length(Some(MAX_UNSIGNED_UPDATE_BYTES)).unwrap();
        assert!(matches!(
            validate_declared_content_length(Some(MAX_UNSIGNED_UPDATE_BYTES + 1)),
            Err(UpdateError::UnsignedPayloadTooLarge { limit_bytes })
                if limit_bytes == MAX_UNSIGNED_UPDATE_BYTES
        ));
    }

    #[tokio::test]
    async fn stalled_response_body_hits_the_per_chunk_idle_timeout() {
        let result =
            with_download_idle_timeout(std::future::pending::<()>(), Duration::from_millis(1))
                .await;
        let Err(UpdateError::UnsignedDownload(message)) = result else {
            panic!("stalled body must return a typed download failure")
        };
        assert!(message.contains("no artifact data"), "{message}");
    }

    #[tokio::test]
    async fn slow_trickle_cannot_extend_the_total_download_deadline_forever() {
        let result =
            with_download_total_timeout(std::future::pending::<()>(), Duration::from_millis(1))
                .await;
        let Err(UpdateError::UnsignedDownload(message)) = result else {
            panic!("an endless download must return a typed download failure")
        };
        assert!(message.contains("total deadline"), "{message}");
    }

    #[test]
    fn stale_temp_cleanup_is_bounded_and_exactly_scoped_to_direct_prefix_children() {
        let root = tempfile::Builder::new()
            .prefix("sorng-unsigned-cleanup-root-")
            .tempdir()
            .expect("create isolated cleanup root");
        let first = root
            .path()
            .join(format!("{UNSIGNED_UPDATE_TEMP_PREFIX}first123"));
        let second = root
            .path()
            .join(format!("{UNSIGNED_UPDATE_TEMP_PREFIX}second456"));
        let unrelated = root.path().join("unrelated-update-directory");
        let nested_parent = root.path().join("nested");
        let nested = nested_parent.join(format!("{UNSIGNED_UPDATE_TEMP_PREFIX}nested789"));
        let prefix_file = root
            .path()
            .join(format!("{UNSIGNED_UPDATE_TEMP_PREFIX}file123"));
        for directory in [&first, &second, &unrelated, &nested] {
            std::fs::create_dir_all(directory).expect("create cleanup test directory");
        }
        std::fs::write(&prefix_file, b"not a directory").expect("write prefix test file");

        let removed = cleanup_stale_unsigned_update_dirs_in(
            root.path(),
            SystemTime::now() + Duration::from_secs(1),
            Duration::ZERO,
            1,
        );
        assert_eq!(removed, 1, "cleanup must obey its per-startup bound");
        assert_eq!(
            [first.exists(), second.exists()]
                .into_iter()
                .filter(|exists| *exists)
                .count(),
            1,
            "exactly one matching direct child should remain"
        );
        assert!(
            unrelated.exists(),
            "unrelated direct children are out of scope"
        );
        assert!(
            nested.exists(),
            "nested matching directories are out of scope"
        );
        assert!(
            prefix_file.exists(),
            "prefix-matching files are out of scope"
        );
    }

    #[test]
    fn downloaded_payload_magic_must_match_the_selected_package() {
        let appimage = appimage_payload(0x003e);
        validate_artifact_magic(ArtifactFormat::AppImage, &appimage, "linux-x86_64").unwrap();

        let nsis = pe_payload(0x014c);
        validate_artifact_magic(ArtifactFormat::Nsis, &nsis, "windows-aarch64").unwrap();
        validate_artifact_magic(
            ArtifactFormat::Msi,
            &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1],
            "windows-x86_64",
        )
        .unwrap();

        let mut dmg = vec![0_u8; 512];
        dmg[0..4].copy_from_slice(b"koly");
        validate_artifact_magic(ArtifactFormat::Dmg, &dmg, "darwin-aarch64").unwrap();

        for format in [
            ArtifactFormat::AppImage,
            ArtifactFormat::Nsis,
            ArtifactFormat::Msi,
            ArtifactFormat::Dmg,
        ] {
            assert!(matches!(
                validate_artifact_magic(format, b"not an installer", "linux-x86_64"),
                Err(UpdateError::IncompatibleUnsignedArtifact(_))
            ));
        }
    }

    #[test]
    fn appimage_elf_architecture_must_match_the_feed_target() {
        let x64 = appimage_payload(0x003e);
        let arm64 = appimage_payload(0x00b7);
        validate_artifact_magic(ArtifactFormat::AppImage, &x64, "linux-x86_64").unwrap();
        validate_artifact_magic(ArtifactFormat::AppImage, &arm64, "linux-aarch64").unwrap();

        assert!(matches!(
            validate_artifact_magic(ArtifactFormat::AppImage, &x64, "linux-aarch64"),
            Err(UpdateError::IncompatibleUnsignedArtifact(_))
        ));
        assert!(matches!(
            validate_artifact_magic(ArtifactFormat::AppImage, &arm64, "linux-x86_64"),
            Err(UpdateError::IncompatibleUnsignedArtifact(_))
        ));

        let mut elf32 = x64.clone();
        elf32[4] = 1;
        assert!(validate_artifact_magic(ArtifactFormat::AppImage, &elf32, "linux-x86_64").is_err());
        let mut big_endian = x64;
        big_endian[5] = 2;
        assert!(
            validate_artifact_magic(ArtifactFormat::AppImage, &big_endian, "linux-x86_64").is_err()
        );
    }

    #[test]
    fn nsis_requires_a_structural_pe_header_without_matching_stub_architecture() {
        let x86_stub = pe_payload(0x014c);
        validate_artifact_magic(ArtifactFormat::Nsis, &x86_stub, "windows-aarch64")
            .expect("an ARM64 package may legitimately use an x86 NSIS stub");

        let mut missing_signature = x86_stub.clone();
        missing_signature[0x80..0x84].fill(0);
        assert!(validate_artifact_magic(
            ArtifactFormat::Nsis,
            &missing_signature,
            "windows-aarch64"
        )
        .is_err());

        let mut out_of_bounds = x86_stub;
        out_of_bounds[0x3c..0x40].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(
            validate_artifact_magic(ArtifactFormat::Nsis, &out_of_bounds, "windows-aarch64")
                .is_err()
        );
    }

    #[test]
    fn windows_installer_arguments_are_visible_and_bound_to_the_validated_path() {
        let path = std::path::Path::new(r"C:\Temp Folder\sortOfRemoteNG.msi");
        assert_eq!(
            windows_installer_parameters(ArtifactFormat::Nsis, path)
                .unwrap()
                .to_string_lossy(),
            "/P /R /UPDATE"
        );
        assert_eq!(
            windows_installer_parameters(ArtifactFormat::Msi, path)
                .unwrap()
                .to_string_lossy(),
            r#"/i "C:\Temp Folder\sortOfRemoteNG.msi" /passive /promptrestart AUTOLAUNCHAPP=True"#
        );
    }

    #[test]
    fn only_confirmed_external_handoff_requests_app_exit() {
        assert!(!UnsignedInstallOutcome::Installed.exit_app_after_handoff());
        assert!(UnsignedInstallOutcome::ExternalInstallerLaunched.exit_app_after_handoff());
        assert!(UnsignedInstallOutcome::MacOsDmgOpened.exit_app_after_handoff());
    }

    #[test]
    fn windows_shell_handoff_requires_documented_success_code() {
        for result in [isize::MIN, 0, 2, 31, 32] {
            assert!(!windows_shell_handoff_succeeded(result), "code {result}");
        }
        for result in [33, 42, isize::MAX] {
            assert!(windows_shell_handoff_succeeded(result), "code {result}");
        }
    }

    #[test]
    fn unsupported_package_modes_never_get_an_artifact_name() {
        for mode in [
            UpdaterInstallMode::Deb,
            UpdaterInstallMode::Rpm,
            UpdaterInstallMode::Flatpak,
            UpdaterInstallMode::Portable,
            UpdaterInstallMode::Unknown,
        ] {
            assert!(matches!(
                expected_artifact("26.43.0", mode, "linux-x86_64"),
                Err(UpdateError::SelfUpdateUnsupported(_))
            ));
        }
    }

    #[test]
    fn temp_directory_ownership_survives_mapping_until_install_handoff() {
        let directory = tempfile::Builder::new()
            .prefix("sorng-unsigned-lifetime-test-")
            .tempdir()
            .expect("create temp directory");
        let path = directory.path().join("payload.exe");
        let payload = pe_payload(0x014c);
        std::fs::write(&path, &payload).expect("write payload");
        let downloaded = DownloadedUnsignedArtifact {
            directory,
            path: path.clone(),
            downloaded_bytes: payload.len() as u64,
            total_bytes: Some(payload.len() as u64),
        };
        let expected = ValidatedUnsignedArtifact {
            url: release_url("sortOfRemoteNG_26.43.0_windows-x86_64-setup.exe"),
            file_name: "sortOfRemoteNG_26.43.0_windows-x86_64-setup.exe".to_string(),
            format: ArtifactFormat::Nsis,
            target: "windows-x86_64".to_string(),
        };

        let mapped = validate_downloaded_artifact(downloaded, &expected)
            .expect("map and validate downloaded artifact");
        assert!(
            path.exists(),
            "the mapping owner must retain the temp directory"
        );
        assert_eq!(mapped.bytes.as_ref(), payload.as_slice());
        drop(mapped);
        assert!(
            !path.exists(),
            "failed handoffs should clean the temp directory"
        );
    }
}

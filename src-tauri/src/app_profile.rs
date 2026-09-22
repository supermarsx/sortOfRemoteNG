//! Process profile guard (t91).
//!
//! The Tauri identifier compiled into this binary decides every profile
//! location: the Tauri app directories, the WebView2 user data folder and the
//! keychain service namespace. `build.rs` resolves that identifier and this
//! module embeds it in [`PROFILE_MARKER`], which the e2e harness scans for
//! before it launches anything.
//!
//! * [`install_process_profile`] is the first statement of `run()`. It
//!   installs the identity, the keychain namespace and (isolated builds) the
//!   SSH home, enforces the harness inputs and answers
//!   `--sorng-profile-probe`, all before tracing, rustls or `tauri::Builder`
//!   can resolve a profile path.
//! * [`verify_runtime`] is the first statement of `setup` and refuses to
//!   continue if Tauri resolved anything other than the installed profile.
//!
//! A production build installs the production identity and no keychain
//! namespace, so its profile, keychain names and WebView2 folder are exactly
//! what they were before this guard existed. It only refuses the harness-only
//! inputs: `--sorng-profile-probe`, `--sorng-webview2-user-data-folder=` and
//! `SORNG_EXPECT_ISOLATED_PROFILE`.
//!
//! Exit codes: 0 probe written, 70 identity or probe failure, 78 refused.

use std::ffi::{OsStr, OsString};
use std::io::Write;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::OnceLock;

use serde::Serialize;
use sorng_core::app_identity::{self, EXPECT_ISOLATED_PROFILE_ENV, PRODUCTION_IDENTIFIER};
use tauri::Manager;

/// The compiled identity. The e2e harness requires exactly one distinct copy
/// of this byte string in the linked binary, so this is the only place in the
/// app where the complete marker is spelled.
static PROFILE_MARKER: &str = concat!(
    "SORNG_PROFILE_MARKER_V1[identifier=",
    env!("SORNG_BUILD_IDENTIFIER"),
    "]"
);

/// `productName` in `tauri.conf.json`; the autostart plugin's default name.
const PRODUCT_NAME: &str = "sortOfRemoteNG";

const PROBE_FLAG: &str = "--sorng-profile-probe";
const WEBVIEW2_FLAG: &str = "--sorng-webview2-user-data-folder";
const PROBE_OUT_ENV: &str = "SORNG_PROFILE_PROBE_OUT";
const PROBE_SCHEMA: &str = "sorng-profile-probe/v1";

/// Isolated builds keep `.ssh` and `.opk` state in `<app data>/ssh-home`.
const SSH_HOME_DIRNAME: &str = sorng_core::ssh_home::ISOLATED_SSH_HOME_DIRNAME;

/// Microsoft's documented override. WebView2 uses it in place of the
/// `userDataFolder` Tauri passes, for every webview in the process.
const WEBVIEW2_USER_DATA_FOLDER_ENV: &str = "WEBVIEW2_USER_DATA_FOLDER";

const EXIT_PROBE_WRITTEN: i32 = 0;
const EXIT_FAILURE: i32 = 70;
const EXIT_REFUSED: i32 = 78;

const CASE_INSENSITIVE_PATHS: bool = cfg!(any(windows, target_os = "macos"));

static PROCESS_PROFILE: OnceLock<ProcessProfile> = OnceLock::new();

/// The profile this process installed before `tauri::Builder`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProcessProfile {
    identifier: &'static str,
    /// `None` for production, whose WebView2 folder is never managed here.
    webview2: Option<Webview2Folder>,
    /// `<app data>/ssh-home` for isolated builds; `None` for production.
    ssh_home: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Webview2Source {
    Arg,
    Env,
    TauriDefault,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Webview2Folder {
    /// The folder exactly as given; `None` leaves Tauri's identifier folder.
    path: Option<PathBuf>,
    source: Webview2Source,
}

#[derive(Debug, PartialEq, Eq)]
enum StartupError {
    /// The identity could not be installed or the probe not written.
    Failure(String),
    /// A launch input could reach state outside this build's profile.
    Refused(String),
}

impl StartupError {
    fn exit_code(&self) -> i32 {
        match self {
            Self::Failure(_) => EXIT_FAILURE,
            Self::Refused(_) => EXIT_REFUSED,
        }
    }

    fn message(&self) -> &str {
        match self {
            Self::Failure(message) | Self::Refused(message) => message,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum StartupPlan {
    Launch(ProcessProfile),
    /// The probe report to write before exiting.
    Probe(String),
}

/// OS known folders Tauri joins the identifier onto (`tauri` `path/desktop.rs`).
#[derive(Clone, Debug, Default)]
struct KnownFolders {
    data: Option<PathBuf>,
    local_data: Option<PathBuf>,
    config: Option<PathBuf>,
    cache: Option<PathBuf>,
    #[cfg(target_os = "macos")]
    home: Option<PathBuf>,
}

impl KnownFolders {
    fn resolve() -> Self {
        Self {
            data: dirs::data_dir(),
            local_data: dirs::data_local_dir(),
            config: dirs::config_dir(),
            cache: dirs::cache_dir(),
            #[cfg(target_os = "macos")]
            home: dirs::home_dir(),
        }
    }
}

struct LaunchInputs {
    /// Command-line arguments after the program name.
    args: Vec<OsString>,
    expect_isolated: Option<OsString>,
    webview2_env: Option<OsString>,
    known: KnownFolders,
    pid: u32,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ProfileFlags {
    probe: bool,
    webview2: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════
// Startup
// ═══════════════════════════════════════════════════════════════════════

/// Install the compiled profile for this process. Must run before anything
/// else in `run()`. Exits the process for the probe and for every refusal.
pub(crate) fn install_process_profile() -> ProcessProfile {
    match start_process_profile() {
        Ok(StartupPlan::Launch(profile)) => profile,
        Ok(StartupPlan::Probe(report)) => match write_probe(&report) {
            Ok(()) => std::process::exit(EXIT_PROBE_WRITTEN),
            Err(message) => exit_with(&StartupError::Failure(message)),
        },
        Err(error) => exit_with(&error),
    }
}

fn exit_with(error: &StartupError) -> ! {
    let _ = writeln!(
        std::io::stderr(),
        "{PRODUCT_NAME} profile guard: {}",
        error.message()
    );
    std::process::exit(error.exit_code())
}

fn start_process_profile() -> Result<StartupPlan, StartupError> {
    let identifier = compiled_identifier().map_err(StartupError::Failure)?;
    app_identity::install(identifier).map_err(StartupError::Failure)?;
    sorng_vault::keychain::install_service_namespace(app_identity::keychain_namespace_for(
        identifier,
    ))
    .map_err(|error| {
        StartupError::Failure(format!(
            "cannot install the keychain service namespace for {identifier}: {error}"
        ))
    })?;

    // Production never resolves known folders here: it has no SSH home,
    // WebView2 folder or probe dirs to compute.
    let known = if app_identity::is_production(identifier) {
        KnownFolders::default()
    } else {
        KnownFolders::resolve()
    };
    if let Some(ssh_home) = isolated_ssh_home(identifier, &known).map_err(StartupError::Failure)? {
        install_ssh_homes(&ssh_home).map_err(StartupError::Failure)?;
    }

    let inputs = LaunchInputs {
        args: std::env::args_os().skip(1).collect(),
        expect_isolated: std::env::var_os(EXPECT_ISOLATED_PROFILE_ENV),
        webview2_env: std::env::var_os(WEBVIEW2_USER_DATA_FOLDER_ENV),
        known,
        pid: std::process::id(),
    };
    let plan = plan_startup(PROFILE_MARKER, identifier, &inputs)?;

    if let StartupPlan::Launch(profile) = &plan {
        if let Some(Webview2Folder {
            path: Some(folder),
            source: Webview2Source::Arg,
        }) = &profile.webview2
        {
            // Nothing else runs yet. Every webview Tauri creates later reads it.
            std::env::set_var(WEBVIEW2_USER_DATA_FOLDER_ENV, folder);
        }
        if PROCESS_PROFILE.get_or_init(|| profile.clone()) != profile {
            return Err(StartupError::Failure(
                "a different process profile is already installed".to_string(),
            ));
        }
    }
    Ok(plan)
}

/// Point every SSH-state consumer at the isolated SSH home, so an isolated
/// build never reads or writes the user's `~/.ssh` or `~/.opk`.
fn install_ssh_homes(ssh_home: &Path) -> Result<(), String> {
    sorng_core::ssh_home::install_isolated_home(ssh_home.to_path_buf())
        .map_err(|error| format!("cannot install the SSH home: {error}"))?;
    #[cfg(feature = "opkssh")]
    sorng_opkssh::service::install_isolated_home(ssh_home.to_path_buf())
        .map_err(|error| format!("cannot install the opkssh home: {error}"))?;
    Ok(())
}

/// Every SSH-state consumer's installed home, by owner.
fn installed_ssh_homes() -> Vec<(&'static str, Option<&'static Path>)> {
    let ssh = (
        "sorng_core::ssh_home",
        sorng_core::ssh_home::isolated_home(),
    );
    #[cfg(feature = "opkssh")]
    {
        vec![
            ssh,
            (
                "sorng_opkssh::service",
                sorng_opkssh::service::isolated_home(),
            ),
        ]
    }
    #[cfg(not(feature = "opkssh"))]
    {
        vec![ssh]
    }
}

/// `<app data>/<identifier>/ssh-home` (under Tauri's `app_data_dir`) for an
/// isolated build; `None` for production.
fn isolated_ssh_home(identifier: &str, known: &KnownFolders) -> Result<Option<PathBuf>, String> {
    if app_identity::is_production(identifier) {
        return Ok(None);
    }
    known
        .data
        .as_ref()
        .map(|data| Some(data.join(identifier).join(SSH_HOME_DIRNAME)))
        .ok_or_else(|| format!("the app data folder is unknown, so {identifier} has no SSH home"))
}

/// The identifier in [`PROFILE_MARKER`]. Parsing the static (through
/// `black_box`) keeps its bytes linked into the binary for the harness scan.
fn compiled_identifier() -> Result<&'static str, String> {
    app_identity::marker_identifier(std::hint::black_box(PROFILE_MARKER))
}

/// Decide how this launch proceeds. Pure: reads nothing from the process.
fn plan_startup(
    marker: &str,
    identifier: &'static str,
    inputs: &LaunchInputs,
) -> Result<StartupPlan, StartupError> {
    let flags = parse_profile_flags(&inputs.args).map_err(StartupError::Refused)?;

    if app_identity::is_production(identifier) {
        if flags.probe {
            return Err(StartupError::Refused(format!(
                "{PROBE_FLAG} is only available in isolated builds; this binary uses the production identifier {PRODUCTION_IDENTIFIER}"
            )));
        }
        if flags.webview2.is_some() {
            return Err(StartupError::Refused(format!(
                "{WEBVIEW2_FLAG} is only available in isolated builds; it never redirects the production WebView2 profile"
            )));
        }
        expectation_check(identifier, inputs.expect_isolated.as_deref())
            .map_err(StartupError::Refused)?;
        return Ok(StartupPlan::Launch(ProcessProfile {
            identifier,
            webview2: None,
            ssh_home: None,
        }));
    }

    // The expectation is checked before the probe so every refusal (exit 78)
    // also holds for a probe launch with the same inputs.
    expectation_check(identifier, inputs.expect_isolated.as_deref())
        .map_err(StartupError::Refused)?;
    let webview2 = resolve_webview2_folder(
        flags.webview2.as_deref(),
        inputs.webview2_env.as_deref(),
        inputs.expect_isolated.is_some(),
        &inputs.known,
    )
    .map_err(StartupError::Refused)?;
    let ssh_home = isolated_ssh_home(identifier, &inputs.known).map_err(StartupError::Failure)?;

    if flags.probe {
        return probe_report(
            marker,
            identifier,
            &inputs.known,
            &webview2,
            ssh_home.as_deref(),
            inputs.pid,
        )
        .map(StartupPlan::Probe)
        .map_err(StartupError::Failure);
    }
    Ok(StartupPlan::Launch(ProcessProfile {
        identifier,
        webview2: Some(webview2),
        ssh_home,
    }))
}

/// Find the profile flags. Every other argument is left for the app, which
/// ignores unknown flags. Anything that only resembles a profile flag is
/// refused rather than guessed at.
fn parse_profile_flags(args: &[OsString]) -> Result<ProfileFlags, String> {
    let mut flags = ProfileFlags::default();
    for arg in args {
        let bytes = arg.as_encoded_bytes();
        if bytes == PROBE_FLAG.as_bytes() {
            flags.probe = true;
        } else if bytes.starts_with(PROBE_FLAG.as_bytes()) {
            return Err(format!(
                "unrecognised argument {arg:?}; the probe flag is exactly {PROBE_FLAG}"
            ));
        } else if bytes.starts_with(WEBVIEW2_FLAG.as_bytes()) {
            let value = arg
                .to_str()
                .ok_or_else(|| format!("{WEBVIEW2_FLAG} value {arg:?} is not valid Unicode"))?
                .strip_prefix(WEBVIEW2_FLAG)
                .and_then(|rest| rest.strip_prefix('='))
                .ok_or_else(|| {
                    format!("unrecognised argument {arg:?}; use {WEBVIEW2_FLAG}=<absolute path>")
                })?;
            if value.is_empty() {
                return Err(format!("{WEBVIEW2_FLAG}= has no folder"));
            }
            if flags.webview2.is_some() {
                return Err(format!("{WEBVIEW2_FLAG} is given more than once"));
            }
            flags.webview2 = Some(value.to_string());
        }
    }
    Ok(flags)
}

/// [`app_identity::expected_profile_check`] for a raw environment value. A
/// value that is not valid Unicode is set, so it refuses.
fn expectation_check(identifier: &str, expect: Option<&OsStr>) -> Result<(), String> {
    match expect.map(OsStr::to_str) {
        None => Ok(()),
        Some(Some(expected)) => app_identity::expected_profile_check(identifier, Some(expected)),
        Some(None) => Err(format!(
            "{EXPECT_ISOLATED_PROFILE_ENV} is set to a value that is not valid Unicode; refusing to start"
        )),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// WebView2 user data folder (isolated builds)
// ═══════════════════════════════════════════════════════════════════════

/// Choose the WebView2 user data folder for an isolated build.
///
/// The flag wins and must agree with an inherited environment value. Either
/// must be an absolute folder outside the production profile. Harness runs
/// (`SORNG_EXPECT_ISOLATED_PROFILE` set) must name a folder; a manual launch
/// without one keeps Tauri's identifier-isolated default.
fn resolve_webview2_folder(
    flag: Option<&str>,
    inherited_env: Option<&OsStr>,
    harness_mode: bool,
    known: &KnownFolders,
) -> Result<Webview2Folder, String> {
    let env = inherited_env
        .map(|value| {
            value.to_str().ok_or_else(|| {
                format!("{WEBVIEW2_USER_DATA_FOLDER_ENV} is not valid Unicode; refusing to start")
            })
        })
        .transpose()?;

    match (flag, env) {
        (Some(flag), env) => {
            let folder = checked_webview2_folder(WEBVIEW2_FLAG, flag, known)?;
            if let Some(env) = env {
                if !app_identity::paths_equivalent(&folder, Path::new(env)) {
                    return Err(format!(
                        "{WEBVIEW2_FLAG}={flag:?} disagrees with the inherited {WEBVIEW2_USER_DATA_FOLDER_ENV}={env:?}; refusing to start"
                    ));
                }
            }
            Ok(Webview2Folder {
                path: Some(folder),
                source: Webview2Source::Arg,
            })
        }
        (None, Some(env)) => Ok(Webview2Folder {
            path: Some(checked_webview2_folder(
                WEBVIEW2_USER_DATA_FOLDER_ENV,
                env,
                known,
            )?),
            source: Webview2Source::Env,
        }),
        (None, None) if harness_mode => Err(format!(
            "harness runs require a per-run WebView2 folder: {EXPECT_ISOLATED_PROFILE_ENV} is set but neither {WEBVIEW2_FLAG}= nor {WEBVIEW2_USER_DATA_FOLDER_ENV} names one"
        )),
        (None, None) => Ok(Webview2Folder {
            path: None,
            source: Webview2Source::TauriDefault,
        }),
    }
}

/// Prove, from the string alone, that `value` is an absolute folder that
/// cannot be the production WebView2 profile. The folder is never opened.
fn checked_webview2_folder(
    source: &str,
    value: &str,
    known: &KnownFolders,
) -> Result<PathBuf, String> {
    let folder = PathBuf::from(value);
    if value.is_empty() || !folder.is_absolute() {
        return Err(format!("{source} {value:?} is not an absolute path"));
    }
    if cfg!(windows)
        && !matches!(
            folder.components().next(),
            Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_))
        )
    {
        return Err(format!(
            "{source} {value:?} must be a drive path such as C:\\...; verbatim, device and UNC paths are refused"
        ));
    }

    let (Some(local_data), Some(data)) = (&known.local_data, &known.data) else {
        return Err(format!(
            "{source} {value:?} cannot be checked: the local and roaming app data folders are unknown"
        ));
    };
    for production_root in [
        local_data.join(PRODUCTION_IDENTIFIER),
        data.join(PRODUCTION_IDENTIFIER),
    ] {
        if path_is_within(&folder, &production_root) {
            return Err(format!(
                "{source} {value:?} is inside the production profile {}",
                production_root.display()
            ));
        }
    }

    for component in folder.components() {
        match component {
            Component::ParentDir => {
                return Err(format!(
                    "{source} {value:?} contains '..' and could resolve into the production profile"
                ));
            }
            Component::Normal(name) => {
                let name = name.to_str().unwrap_or_default();
                if component_eq(name, PRODUCTION_IDENTIFIER) {
                    return Err(format!(
                        "{source} {value:?} names the production identifier {PRODUCTION_IDENTIFIER}"
                    ));
                }
                if cfg!(windows) {
                    if let Some(reason) = windows_alias_reason(name) {
                        return Err(format!(
                            "{source} {value:?} has the component {name:?}, which {reason}"
                        ));
                    }
                }
            }
            _ => {}
        }
    }
    Ok(folder)
}

/// Why Windows could open a different directory than `name` spells.
fn windows_alias_reason(name: &str) -> Option<&'static str> {
    if name.ends_with(['.', ' ']) {
        Some("Windows strips trailing dots and spaces from")
    } else if name.contains(':') {
        Some("names an NTFS stream")
    } else if name
        .split('~')
        .skip(1)
        .any(|rest| rest.starts_with(|c: char| c.is_ascii_digit()))
    {
        Some("looks like an 8.3 short name that could alias another directory")
    } else {
        None
    }
}

/// Whether `child` is `parent` or lies inside it, component by component.
fn path_is_within(child: &Path, parent: &Path) -> bool {
    let mut child = child.components();
    parent.components().all(|expected| {
        child.next().is_some_and(|actual| {
            match (actual.as_os_str().to_str(), expected.as_os_str().to_str()) {
                (Some(actual), Some(expected)) => component_eq(actual, expected),
                _ => actual == expected,
            }
        })
    })
}

fn component_eq(left: &str, right: &str) -> bool {
    if CASE_INSENSITIVE_PATHS {
        left.to_lowercase() == right.to_lowercase()
    } else {
        left == right
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Probe
// ═══════════════════════════════════════════════════════════════════════

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeReport<'a> {
    schema: &'static str,
    marker: &'a str,
    identifier: &'a str,
    kind: &'static str,
    keychain_namespace: Option<String>,
    autostart_name: String,
    dirs: ProfileDirs,
    production_dirs: ProfileDirs,
    ssh_home: Option<String>,
    webview2: ProbeWebview2,
    pid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileDirs {
    app_data: String,
    app_local_data: String,
    app_config: String,
    app_cache: String,
    app_log: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeWebview2 {
    user_data_folder: Option<String>,
    source: Webview2Source,
    tauri_default: String,
    production_default: String,
}

impl ProfileDirs {
    /// The directories Tauri's `PathResolver` returns for `identifier`,
    /// computed without creating anything.
    fn resolve(identifier: &str, known: &KnownFolders) -> Result<Self, String> {
        let under = |root: &Option<PathBuf>, name: &str| {
            root.as_ref()
                .map(|root| root.join(identifier))
                .ok_or_else(|| format!("the {name} folder is unknown"))
        };
        #[cfg(target_os = "macos")]
        let app_log = known
            .home
            .as_ref()
            .map(|home| home.join("Library/Logs").join(identifier))
            .ok_or_else(|| "the home folder is unknown".to_string());
        #[cfg(not(target_os = "macos"))]
        let app_log = under(&known.local_data, "local app data").map(|dir| dir.join("logs"));
        Ok(Self {
            app_data: path_string(&under(&known.data, "app data")?)?,
            app_local_data: path_string(&under(&known.local_data, "local app data")?)?,
            app_config: path_string(&under(&known.config, "config")?)?,
            app_cache: path_string(&under(&known.cache, "cache")?)?,
            app_log: path_string(&app_log?)?,
        })
    }
}

fn path_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| format!("{} is not valid Unicode", path.display()))
}

fn probe_report(
    marker: &str,
    identifier: &str,
    known: &KnownFolders,
    webview2: &Webview2Folder,
    ssh_home: Option<&Path>,
    pid: u32,
) -> Result<String, String> {
    let local_data = known
        .local_data
        .as_ref()
        .ok_or_else(|| "the local app data folder is unknown".to_string())?;
    let report = ProbeReport {
        schema: PROBE_SCHEMA,
        marker,
        identifier,
        kind: if app_identity::is_production(identifier) {
            "production"
        } else {
            "isolated"
        },
        keychain_namespace: app_identity::keychain_namespace_for(identifier),
        autostart_name: autostart_app_name(identifier).unwrap_or_else(|| PRODUCT_NAME.to_string()),
        dirs: ProfileDirs::resolve(identifier, known)?,
        production_dirs: ProfileDirs::resolve(PRODUCTION_IDENTIFIER, known)?,
        ssh_home: ssh_home.map(path_string).transpose()?,
        webview2: ProbeWebview2 {
            user_data_folder: webview2.path.as_deref().map(path_string).transpose()?,
            source: webview2.source,
            tauri_default: path_string(&local_data.join(identifier))?,
            production_default: path_string(&local_data.join(PRODUCTION_IDENTIFIER))?,
        },
        pid,
    };
    serde_json::to_string(&report).map_err(|error| format!("cannot encode the probe: {error}"))
}

/// Write the probe to `SORNG_PROFILE_PROBE_OUT` (when set) and stdout. The
/// file's directory must already exist; nothing is created but the file.
fn write_probe(report: &str) -> Result<(), String> {
    let out = std::env::var_os(PROBE_OUT_ENV);
    if let Some(path) = &out {
        std::fs::write(path, report).map_err(|error| {
            format!(
                "cannot write the profile probe to {PROBE_OUT_ENV}={}: {error}",
                Path::new(path).display()
            )
        })?;
    }
    let mut stdout = std::io::stdout().lock();
    match writeln!(stdout, "{report}").and_then(|()| stdout.flush()) {
        Err(error) if out.is_none() => {
            Err(format!("cannot write the profile probe to stdout: {error}"))
        }
        _ => Ok(()),
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Tauri wiring
// ═══════════════════════════════════════════════════════════════════════

/// Autostart registration name for an isolated build, so its Run entry can
/// never replace the installed app's. `None` keeps the plugin default.
fn autostart_app_name(identifier: &str) -> Option<String> {
    (!app_identity::is_production(identifier)).then(|| format!("{PRODUCT_NAME} ({identifier})"))
}

pub(crate) fn autostart_plugin<R: tauri::Runtime>(
    profile: &ProcessProfile,
) -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_autostart::MacosLauncher;

    let Some(app_name) = autostart_app_name(profile.identifier) else {
        return tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"]));
    };
    let builder = tauri_plugin_autostart::Builder::new()
        .args(["--autostart"])
        .app_name(app_name);
    #[cfg(target_os = "macos")]
    let builder = builder.macos_launcher(MacosLauncher::LaunchAgent);
    builder.build()
}

/// Refuse to continue unless Tauri resolved the installed profile. Must be
/// the first statement of `setup`.
pub(crate) fn verify_runtime(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let profile = PROCESS_PROFILE
        .get()
        .ok_or("the process profile was not installed before tauri::Builder; refusing to start")?;
    let marker_identifier = compiled_identifier()?;
    verify_identity(
        marker_identifier,
        profile,
        &app.config().identifier,
        app_identity::current_identifier(),
        sorng_vault::keychain::service_namespace(),
    )?;
    if app_identity::is_production(profile.identifier) {
        return Ok(());
    }

    let path = app.path();
    let dirs = [
        ("app data", path.app_data_dir()),
        ("app local data", path.app_local_data_dir()),
        ("app config", path.app_config_dir()),
        ("app cache", path.app_cache_dir()),
        ("app log", path.app_log_dir()),
    ]
    .map(|(name, dir)| (name, dir.map_err(|error| error.to_string())));
    let vault_service = sorng_vault::types::SERVICE_NAME;
    let physical_vault_service = sorng_vault::keychain::physical_service(vault_service);
    let webview2_env = std::env::var_os(WEBVIEW2_USER_DATA_FOLDER_ENV);
    let installed_ssh_homes = installed_ssh_homes();
    verify_isolated_runtime(
        profile,
        &ObservedRuntime {
            dirs: &dirs,
            vault_service: (vault_service, &physical_vault_service),
            webview2_env: webview2_env.as_deref(),
            expected_ssh_home: path
                .app_data_dir()
                .map(|dir| dir.join(SSH_HOME_DIRNAME))
                .map_err(|error| error.to_string()),
            installed_ssh_homes: &installed_ssh_homes,
        },
        &KnownFolders::resolve(),
    )?;
    Ok(())
}

fn verify_identity(
    marker_identifier: &str,
    profile: &ProcessProfile,
    config_identifier: &str,
    installed_identifier: &str,
    keychain_namespace: Option<&str>,
) -> Result<(), String> {
    let refuse = |what: &str, found: &str| -> Result<(), String> {
        Err(format!(
            "{what} is {found:?} but this binary was compiled for {marker_identifier:?}; refusing to start"
        ))
    };
    if config_identifier != marker_identifier {
        return refuse("the Tauri config identifier", config_identifier);
    }
    if profile.identifier != marker_identifier {
        return refuse("the installed process profile", profile.identifier);
    }
    if installed_identifier != marker_identifier {
        return refuse("the installed app identity", installed_identifier);
    }
    let expected_namespace = app_identity::keychain_namespace_for(marker_identifier);
    if keychain_namespace != expected_namespace.as_deref() {
        return refuse(
            "the keychain service namespace",
            keychain_namespace.unwrap_or("<none>"),
        );
    }
    let production = app_identity::is_production(marker_identifier);
    if profile.webview2.is_some() == production || profile.ssh_home.is_some() == production {
        return Err(format!(
            "the WebView2 folder and SSH home policy does not match the {marker_identifier:?} build; refusing to start"
        ));
    }
    Ok(())
}

/// What Tauri and the process report once `setup` runs.
struct ObservedRuntime<'a> {
    dirs: &'a [(&'a str, Result<PathBuf, String>)],
    /// `(logical, physical)` name of the vault keychain service.
    vault_service: (&'a str, &'a str),
    webview2_env: Option<&'a OsStr>,
    /// `app_data_dir()/ssh-home` as Tauri resolves it.
    expected_ssh_home: Result<PathBuf, String>,
    installed_ssh_homes: &'a [(&'a str, Option<&'a Path>)],
}

fn verify_isolated_runtime(
    profile: &ProcessProfile,
    observed: &ObservedRuntime<'_>,
    known: &KnownFolders,
) -> Result<(), String> {
    let identifier = profile.identifier;
    for (name, dir) in observed.dirs {
        let dir = dir
            .as_ref()
            .map_err(|error| format!("cannot resolve the {name} dir: {error}"))?;
        app_identity::verify_isolated_dir(dir, identifier)
            .map_err(|error| format!("the {name} dir is not isolated: {error}"))?;
    }
    let (logical_vault_service, physical_vault_service) = observed.vault_service;
    if physical_vault_service == logical_vault_service {
        return Err(format!(
            "keychain service {logical_vault_service:?} is not namespaced for {identifier:?}; refusing to start"
        ));
    }
    verify_ssh_homes(identifier, profile.ssh_home.as_deref(), observed)?;

    let webview2 = profile.webview2.as_ref().ok_or_else(|| {
        format!("{identifier:?} has no WebView2 folder policy; refusing to start")
    })?;
    match (&webview2.path, observed.webview2_env.map(OsStr::to_str)) {
        (Some(folder), Some(Some(env))) if app_identity::paths_equivalent(folder, Path::new(env)) => {
            let folder = path_string(folder)?;
            checked_webview2_folder("the WebView2 user data folder", &folder, known).map(|_| ())
        }
        (None, None) => Ok(()),
        (folder, env) => Err(format!(
            "{WEBVIEW2_USER_DATA_FOLDER_ENV} is {env:?} but startup selected {folder:?}; refusing to start"
        )),
    }
}

fn verify_ssh_homes(
    identifier: &str,
    recorded: Option<&Path>,
    observed: &ObservedRuntime<'_>,
) -> Result<(), String> {
    let expected = observed
        .expected_ssh_home
        .as_ref()
        .map_err(|error| format!("cannot resolve the SSH home: {error}"))?;
    let recorded = recorded.ok_or_else(|| {
        format!("{identifier:?} has no SSH home; refusing to use the user's home directory")
    })?;
    if !app_identity::paths_equivalent(recorded, expected) {
        return Err(format!(
            "the SSH home {} is not the app data SSH home {}; refusing to start",
            recorded.display(),
            expected.display()
        ));
    }
    app_identity::verify_isolated_dir(recorded, identifier)
        .map_err(|error| format!("the SSH home is not isolated: {error}"))?;
    for (owner, installed) in observed.installed_ssh_homes {
        match installed {
            Some(home) if app_identity::paths_equivalent(home, expected) => {}
            Some(home) => {
                return Err(format!(
                    "{owner} uses the SSH home {} instead of {}; refusing to start",
                    home.display(),
                    expected.display()
                ));
            }
            None => {
                return Err(format!(
                    "{owner} has no SSH home installed and could use the user's home directory; refusing to start"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const E2E: &str = "com.sortofremote.ng.e2e";
    const README_CAPTURE: &str = "com.sortofremote.ng.readme-capture";

    fn os(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[cfg(windows)]
    fn not_unicode() -> OsString {
        use std::os::windows::ffi::OsStringExt;
        OsString::from_wide(&[0xD800])
    }

    #[cfg(unix)]
    fn not_unicode() -> OsString {
        use std::os::unix::ffi::OsStringExt;
        OsString::from_vec(vec![0xFF])
    }

    fn known() -> KnownFolders {
        if cfg!(windows) {
            KnownFolders {
                data: Some(PathBuf::from(r"C:\Users\tester\AppData\Roaming")),
                local_data: Some(PathBuf::from(r"C:\Users\tester\AppData\Local")),
                config: Some(PathBuf::from(r"C:\Users\tester\AppData\Roaming")),
                cache: Some(PathBuf::from(r"C:\Users\tester\AppData\Local")),
                #[cfg(target_os = "macos")]
                home: None,
            }
        } else {
            KnownFolders {
                data: Some(PathBuf::from("/home/tester/.local/share")),
                local_data: Some(PathBuf::from("/home/tester/.local/share")),
                config: Some(PathBuf::from("/home/tester/.config")),
                cache: Some(PathBuf::from("/home/tester/.cache")),
                #[cfg(target_os = "macos")]
                home: Some(PathBuf::from("/home/tester")),
            }
        }
    }

    fn run_folder() -> &'static str {
        if cfg!(windows) {
            r"C:\Users\tester\AppData\Local\sorng-e2e-runs\0123456789ab\webview2"
        } else {
            "/tmp/sorng-e2e-runs/0123456789ab/webview2"
        }
    }

    fn production_local() -> PathBuf {
        known().local_data.unwrap().join(PRODUCTION_IDENTIFIER)
    }

    fn ssh_home_for(identifier: &str) -> PathBuf {
        known().data.unwrap().join(identifier).join("ssh-home")
    }

    fn inputs(args: &[&str]) -> LaunchInputs {
        LaunchInputs {
            args: os(args),
            expect_isolated: None,
            webview2_env: None,
            known: known(),
            pid: 4242,
        }
    }

    fn harness(args: &[&str]) -> LaunchInputs {
        LaunchInputs {
            expect_isolated: Some(OsString::from(E2E)),
            ..inputs(args)
        }
    }

    fn webview2_arg(folder: &str) -> String {
        format!("{WEBVIEW2_FLAG}={folder}")
    }

    fn plan(identifier: &'static str, inputs: &LaunchInputs) -> Result<StartupPlan, StartupError> {
        plan_startup(
            &app_identity::profile_marker(identifier),
            identifier,
            inputs,
        )
    }

    fn refused(result: Result<StartupPlan, StartupError>) -> String {
        match result {
            Err(StartupError::Refused(message)) => message,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    fn launched(result: Result<StartupPlan, StartupError>) -> ProcessProfile {
        match result {
            Ok(StartupPlan::Launch(profile)) => profile,
            other => panic!("expected a launch, got {other:?}"),
        }
    }

    fn probed(result: Result<StartupPlan, StartupError>) -> serde_json::Value {
        match result {
            Ok(StartupPlan::Probe(report)) => serde_json::from_str(&report).unwrap(),
            other => panic!("expected a probe, got {other:?}"),
        }
    }

    // ── compiled identity ───────────────────────────────────────────

    #[test]
    fn marker_carries_the_build_identifier() {
        let identifier = env!("SORNG_BUILD_IDENTIFIER");
        assert_eq!(compiled_identifier(), Ok(identifier));
        assert_eq!(PROFILE_MARKER, app_identity::profile_marker(identifier));
    }

    #[test]
    fn build_identifier_matches_the_tauri_config_inputs() {
        let tauri_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let base = std::fs::read_to_string(tauri_dir.join("tauri.conf.json")).unwrap();
        let platform = if cfg!(windows) {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        };
        let platform =
            std::fs::read_to_string(tauri_dir.join(format!("tauri.{platform}.conf.json"))).ok();
        assert_eq!(
            app_identity::resolve_build_identifier(
                &base,
                platform.as_deref(),
                option_env!("TAURI_CONFIG")
            )
            .as_deref(),
            Ok(env!("SORNG_BUILD_IDENTIFIER"))
        );
    }

    #[test]
    fn overlays_resolve_to_their_identifiers() {
        let tauri_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let read = |name: &str| std::fs::read_to_string(tauri_dir.join(name)).unwrap();
        let base = read("tauri.conf.json");
        let dev_launcher =
            r#"{"build":{"devUrl":"http://localhost:3001"},"app":{"security":{"csp":null}}}"#;
        // `tauri.windows-native.conf.json` is generated by the Windows runtime
        // staging script and intentionally ignored. Keep this test independent
        // of local staging output while exercising the same nested bundle
        // resource merge shape: it must not change the production identity.
        let windows_native_resources = r#"{
            "bundle": {
                "resources": {
                    "resources/native-runtime-licenses/": "native-runtime-licenses/",
                    "resources/native-runtime/libssl-3-x64.dll": "libssl-3-x64.dll"
                }
            }
        }"#;
        for (overlay, expected) in [
            (None, PRODUCTION_IDENTIFIER),
            (Some(dev_launcher.to_string()), PRODUCTION_IDENTIFIER),
            (
                Some(windows_native_resources.to_string()),
                PRODUCTION_IDENTIFIER,
            ),
            (Some(read("tauri.e2e.conf.json")), E2E),
            (
                Some(read("tauri.readme-screenshot.conf.json")),
                README_CAPTURE,
            ),
        ] {
            assert_eq!(
                app_identity::resolve_build_identifier(&base, None, overlay.as_deref()).as_deref(),
                Ok(expected)
            );
        }
    }

    #[test]
    fn e2e_overlay_only_isolates_the_profile() {
        let overlay: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.e2e.conf.json")).unwrap();
        assert_eq!(overlay["identifier"], E2E);
        assert_eq!(
            app_identity::keychain_namespace_for(E2E).as_deref(),
            Some("@com.sortofremote.ng.e2e")
        );
        assert_eq!(overlay["bundle"]["active"], false);
        assert!(overlay.get("app").is_none(), "must not replace app.windows");
        assert!(
            overlay.get("plugins").is_none(),
            "must not override the updater"
        );
    }

    #[test]
    fn the_marker_is_spelled_whole_only_in_its_static() {
        let prefix = format!("{}[{}=", "SORNG_PROFILE_MARKER_V1", "identifier");
        let source = include_str!("app_profile.rs");
        assert_eq!(source.matches(prefix.as_str()).count(), 1);
    }

    // ── flags ───────────────────────────────────────────────────────

    #[test]
    fn flags_are_found_among_ordinary_arguments() {
        assert_eq!(parse_profile_flags(&os(&[])), Ok(ProfileFlags::default()));
        assert_eq!(
            parse_profile_flags(&os(&[
                "--autostart",
                "--collection",
                "c1",
                "--connection=n"
            ])),
            Ok(ProfileFlags::default())
        );
        let folder = run_folder();
        assert_eq!(
            parse_profile_flags(&os(&[
                "--collection",
                "c1",
                &webview2_arg(folder),
                PROBE_FLAG
            ])),
            Ok(ProfileFlags {
                probe: true,
                webview2: Some(folder.to_string()),
            })
        );
    }

    #[test]
    fn malformed_or_repeated_flags_are_refused() {
        let folder = run_folder();
        for args in [
            vec![WEBVIEW2_FLAG.to_string()],
            vec![WEBVIEW2_FLAG.to_string(), folder.to_string()],
            vec![format!("{WEBVIEW2_FLAG}=")],
            vec![format!("{WEBVIEW2_FLAG}:{folder}")],
            vec![format!("{WEBVIEW2_FLAG}s={folder}")],
            vec![webview2_arg(folder), webview2_arg(folder)],
            vec![format!("{PROBE_FLAG}=1")],
            vec![format!("{PROBE_FLAG}s")],
        ] {
            let args: Vec<OsString> = args.into_iter().map(OsString::from).collect();
            assert!(parse_profile_flags(&args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn a_flag_that_is_not_unicode_is_refused() {
        let mut arg = OsString::from(format!("{WEBVIEW2_FLAG}="));
        arg.push(not_unicode());
        assert!(parse_profile_flags(&[arg]).is_err());
        // An unrelated argument that is not Unicode is left for the app.
        assert_eq!(
            parse_profile_flags(&[not_unicode()]),
            Ok(ProfileFlags::default())
        );
    }

    // ── production builds ───────────────────────────────────────────

    #[test]
    fn production_launches_unchanged_without_harness_inputs() {
        let mut inputs = inputs(&["--autostart", "--collection", "c1"]);
        // An inherited WebView2 variable is Microsoft's, not ours to police.
        inputs.webview2_env = Some(OsString::from("relative"));
        inputs.known = KnownFolders::default();
        assert_eq!(
            launched(plan(PRODUCTION_IDENTIFIER, &inputs)),
            ProcessProfile {
                identifier: PRODUCTION_IDENTIFIER,
                webview2: None,
                ssh_home: None,
            }
        );
    }

    #[test]
    fn production_refuses_every_harness_input() {
        let folder = run_folder();
        for args in [
            vec![PROBE_FLAG.to_string()],
            vec![webview2_arg(folder)],
            vec![webview2_arg(folder), PROBE_FLAG.to_string()],
            vec![WEBVIEW2_FLAG.to_string()],
        ] {
            let args: Vec<&str> = args.iter().map(String::as_str).collect();
            refused(plan(PRODUCTION_IDENTIFIER, &inputs(&args)));
        }
        for expected in [
            OsString::from(E2E),
            OsString::from(PRODUCTION_IDENTIFIER),
            OsString::new(),
            not_unicode(),
        ] {
            let mut inputs = inputs(&[]);
            inputs.expect_isolated = Some(expected);
            refused(plan(PRODUCTION_IDENTIFIER, &inputs));
        }
    }

    // ── isolated builds: expectation ────────────────────────────────

    #[test]
    fn isolated_expectation_must_match_exactly() {
        let folder = run_folder();
        let arg = webview2_arg(folder);
        launched(plan(E2E, &harness(&[&arg])));
        for expected in [
            OsString::from("com.sortofremote.ng.e2e-mismatch"),
            OsString::from(README_CAPTURE),
            OsString::from(PRODUCTION_IDENTIFIER),
            OsString::new(),
            not_unicode(),
        ] {
            for args in [vec![arg.as_str()], vec![arg.as_str(), PROBE_FLAG]] {
                let mut inputs = harness(&args);
                inputs.expect_isolated = Some(expected.clone());
                refused(plan(E2E, &inputs));
            }
        }
    }

    // ── isolated builds: WebView2 folder ────────────────────────────

    #[test]
    fn isolated_webview2_folder_sources() {
        let folder = run_folder();
        let arg = webview2_arg(folder);

        let from_arg = launched(plan(E2E, &harness(&[&arg])));
        assert_eq!(
            from_arg.webview2,
            Some(Webview2Folder {
                path: Some(PathBuf::from(folder)),
                source: Webview2Source::Arg,
            })
        );
        assert_eq!(from_arg.ssh_home, Some(ssh_home_for(E2E)));

        let mut agreeing = harness(&[&arg]);
        agreeing.webview2_env = Some(OsString::from(format!(
            "{folder}{}",
            std::path::MAIN_SEPARATOR
        )));
        assert_eq!(launched(plan(E2E, &agreeing)).webview2, from_arg.webview2);

        let mut env_only = harness(&[]);
        env_only.webview2_env = Some(OsString::from(folder));
        assert_eq!(
            launched(plan(E2E, &env_only)).webview2,
            Some(Webview2Folder {
                path: Some(PathBuf::from(folder)),
                source: Webview2Source::Env,
            })
        );

        assert_eq!(
            launched(plan(E2E, &inputs(&[]))).webview2,
            Some(Webview2Folder {
                path: None,
                source: Webview2Source::TauriDefault,
            })
        );
    }

    #[test]
    fn harness_runs_without_a_webview2_folder_are_refused() {
        let message = refused(plan(E2E, &harness(&[])));
        assert!(message.contains("per-run WebView2 folder"), "{message}");
        refused(plan(E2E, &harness(&[PROBE_FLAG])));
    }

    #[test]
    fn unsafe_webview2_folders_are_refused_from_the_flag_and_the_env() {
        let production = production_local();
        let roaming_production = known().data.unwrap().join(PRODUCTION_IDENTIFIER);
        let elsewhere = Path::new(run_folder())
            .parent()
            .unwrap()
            .join(PRODUCTION_IDENTIFIER);
        let mut unsafe_folders = vec![
            "relative\\webview2".to_string(),
            "webview2".to_string(),
            production.display().to_string(),
            production.join("EBWebView").display().to_string(),
            roaming_production.join("webview2").display().to_string(),
            elsewhere.join("webview2").display().to_string(),
            Path::new(run_folder())
                .join("..")
                .join("..")
                .display()
                .to_string(),
        ];
        if cfg!(windows) {
            unsafe_folders.extend(
                [
                    r"C:relative\webview2",
                    r"\Users\tester\webview2",
                    r"\\?\C:\Users\tester\AppData\Local\sorng-e2e-runs\webview2",
                    r"\\.\C:\Users\tester\AppData\Local\sorng-e2e-runs\webview2",
                    r"\\localhost\C$\Users\tester\AppData\Local\sorng-e2e-runs\webview2",
                    r"c:\users\TESTER\appdata\local\COM.SORTOFREMOTE.NG\EBWebView",
                    r"C:/Users/tester/AppData/Local/com.sortofremote.ng/EBWebView",
                    r"C:\Users\tester\AppData\Local\com.sortofremote.ng.\EBWebView",
                    r"C:\Users\tester\AppData\Local\com.sortofremote.ng \EBWebView",
                    r"C:\Users\tester\AppData\Local\COMSOR~1.NG\EBWebView",
                    r"C:\Users\tester\AppData\Local\com.sortofremote.ng::$INDEX_ALLOCATION\x",
                ]
                .map(str::to_string),
            );
        }
        for folder in &unsafe_folders {
            let arg = webview2_arg(folder);
            refused(plan(E2E, &harness(&[&arg])));
            refused(plan(E2E, &inputs(&[&arg, PROBE_FLAG])));
            let mut env = harness(&[]);
            env.webview2_env = Some(OsString::from(folder));
            refused(plan(E2E, &env));
        }
    }

    #[test]
    fn flag_and_env_must_name_the_same_folder() {
        let folder = run_folder();
        let other = Path::new(folder).parent().unwrap().join("other");
        let arg = webview2_arg(folder);
        let mut disagreeing = harness(&[&arg]);
        disagreeing.webview2_env = Some(other.into_os_string());
        let message = refused(plan(E2E, &disagreeing));
        assert!(message.contains("disagrees"), "{message}");

        let mut not_unicode_env = harness(&[&arg]);
        not_unicode_env.webview2_env = Some(not_unicode());
        refused(plan(E2E, &not_unicode_env));
    }

    #[test]
    fn isolated_launch_without_an_app_data_folder_fails_instead_of_using_the_home() {
        let mut unknown = inputs(&[]);
        unknown.known = KnownFolders::default();
        let result = plan(E2E, &unknown);
        assert!(
            matches!(&result, Err(StartupError::Failure(message)) if message.contains("SSH home")),
            "{result:?}"
        );
        assert_eq!(
            isolated_ssh_home(PRODUCTION_IDENTIFIER, &KnownFolders::default()),
            Ok(None)
        );
        if cfg!(windows) {
            assert_eq!(
                isolated_ssh_home(E2E, &known()),
                Ok(Some(PathBuf::from(
                    r"C:\Users\tester\AppData\Roaming\com.sortofremote.ng.e2e\ssh-home"
                )))
            );
        }
    }

    #[test]
    fn a_webview2_folder_cannot_be_checked_without_known_folders() {
        let arg = webview2_arg(run_folder());
        let mut unknown = harness(&[&arg]);
        unknown.known = KnownFolders::default();
        refused(plan(E2E, &unknown));
    }

    #[test]
    fn path_containment_is_component_wise() {
        let root = production_local();
        assert!(path_is_within(&root, &root));
        assert!(path_is_within(&root.join("EBWebView"), &root));
        assert!(!path_is_within(&root.parent().unwrap().join(E2E), &root));
        assert!(!path_is_within(root.parent().unwrap(), &root));
        if cfg!(windows) {
            assert!(path_is_within(
                Path::new(r"c:/USERS/tester/appdata/LOCAL/Com.SortOfRemote.NG/x"),
                &root
            ));
        }
    }

    #[test]
    fn windows_alias_spellings_are_detected() {
        for name in ["name.", "name ", "name::$DATA", "COMSOR~1.NG", "a~9"] {
            assert!(windows_alias_reason(name).is_some(), "{name:?}");
        }
        for name in ["webview2", "sorng-e2e-runs", "0123456789ab", "a~b", "v1.2"] {
            assert_eq!(windows_alias_reason(name), None, "{name:?}");
        }
    }

    // ── probe ───────────────────────────────────────────────────────

    #[test]
    fn probe_reports_the_resolved_profile_without_launching() {
        let folder = run_folder();
        let arg = webview2_arg(folder);
        let probe = probed(plan(E2E, &harness(&[PROBE_FLAG, &arg])));
        let known = known();
        let dirs = |id: &str| {
            let local = known.local_data.clone().unwrap().join(id);
            let log = if cfg!(target_os = "macos") {
                PathBuf::from("/home/tester/Library/Logs").join(id)
            } else {
                local.join("logs")
            };
            serde_json::json!({
                "appData": known.data.clone().unwrap().join(id),
                "appLocalData": local,
                "appConfig": known.config.clone().unwrap().join(id),
                "appCache": known.cache.clone().unwrap().join(id),
                "appLog": log,
            })
        };
        assert_eq!(
            probe,
            serde_json::json!({
                "schema": "sorng-profile-probe/v1",
                "marker": app_identity::profile_marker(E2E),
                "identifier": E2E,
                "kind": "isolated",
                "keychainNamespace": "@com.sortofremote.ng.e2e",
                "autostartName": "sortOfRemoteNG (com.sortofremote.ng.e2e)",
                "dirs": dirs(E2E),
                "productionDirs": dirs(PRODUCTION_IDENTIFIER),
                "sshHome": ssh_home_for(E2E),
                "webview2": {
                    "userDataFolder": folder,
                    "source": "arg",
                    "tauriDefault": known.local_data.clone().unwrap().join(E2E),
                    "productionDefault": production_local(),
                },
                "pid": 4242,
            })
        );
        if cfg!(windows) {
            assert_eq!(
                probe["dirs"]["appData"],
                r"C:\Users\tester\AppData\Roaming\com.sortofremote.ng.e2e"
            );
            assert_eq!(
                probe["dirs"]["appLog"],
                r"C:\Users\tester\AppData\Local\com.sortofremote.ng.e2e\logs"
            );
            assert_eq!(
                probe["webview2"]["productionDefault"],
                r"C:\Users\tester\AppData\Local\com.sortofremote.ng"
            );
            assert_eq!(
                probe["sshHome"],
                r"C:\Users\tester\AppData\Roaming\com.sortofremote.ng.e2e\ssh-home"
            );
        }
    }

    #[test]
    fn probe_reports_each_webview2_source() {
        let folder = run_folder();
        let mut env_only = inputs(&[PROBE_FLAG]);
        env_only.webview2_env = Some(OsString::from(folder));
        let probe = probed(plan(E2E, &env_only));
        assert_eq!(probe["webview2"]["source"], "env");
        assert_eq!(probe["webview2"]["userDataFolder"], folder);

        let probe = probed(plan(README_CAPTURE, &inputs(&[PROBE_FLAG])));
        assert_eq!(probe["webview2"]["source"], "tauri-default");
        assert!(probe["webview2"]["userDataFolder"].is_null());
        assert_eq!(probe["identifier"], README_CAPTURE);
        assert_eq!(
            probe["keychainNamespace"],
            "@com.sortofremote.ng.readme-capture"
        );
        assert_eq!(
            probe["sshHome"],
            serde_json::json!(ssh_home_for(README_CAPTURE))
        );
    }

    #[test]
    fn probe_without_known_folders_fails_instead_of_guessing() {
        let mut unknown = inputs(&[PROBE_FLAG]);
        unknown.known = KnownFolders::default();
        let result = plan(E2E, &unknown);
        assert!(
            matches!(result, Err(StartupError::Failure(_))),
            "{result:?}"
        );
    }

    #[test]
    fn exit_codes_follow_the_probe_contract() {
        assert_eq!(StartupError::Failure(String::new()).exit_code(), 70);
        assert_eq!(StartupError::Refused(String::new()).exit_code(), 78);
        assert_eq!(EXIT_PROBE_WRITTEN, 0);
    }

    // ── runtime verification ────────────────────────────────────────

    fn isolated_profile(folder: Option<&str>, source: Webview2Source) -> ProcessProfile {
        ProcessProfile {
            identifier: E2E,
            webview2: Some(Webview2Folder {
                path: folder.map(PathBuf::from),
                source,
            }),
            ssh_home: Some(ssh_home_for(E2E)),
        }
    }

    #[test]
    fn identity_must_agree_everywhere() {
        let production = ProcessProfile {
            identifier: PRODUCTION_IDENTIFIER,
            webview2: None,
            ssh_home: None,
        };
        let e2e = isolated_profile(None, Webview2Source::TauriDefault);
        let namespace = "@com.sortofremote.ng.e2e";
        let p = PRODUCTION_IDENTIFIER;

        assert_eq!(verify_identity(p, &production, p, p, None), Ok(()));
        assert_eq!(
            verify_identity(E2E, &e2e, E2E, E2E, Some(namespace)),
            Ok(())
        );

        assert!(verify_identity(p, &production, E2E, p, None).is_err());
        assert!(verify_identity(p, &production, p, E2E, None).is_err());
        assert!(verify_identity(p, &production, p, p, Some(namespace)).is_err());
        assert!(verify_identity(p, &e2e, p, p, None).is_err());
        assert!(verify_identity(E2E, &e2e, p, E2E, Some(namespace)).is_err());
        assert!(verify_identity(E2E, &e2e, E2E, p, Some(namespace)).is_err());
        assert!(verify_identity(E2E, &e2e, E2E, E2E, None).is_err());
        assert!(verify_identity(E2E, &e2e, E2E, E2E, Some("@other")).is_err());
        let e2e_without_webview2_policy = ProcessProfile {
            webview2: None,
            ..e2e.clone()
        };
        assert!(
            verify_identity(E2E, &e2e_without_webview2_policy, E2E, E2E, Some(namespace)).is_err()
        );
        let e2e_without_ssh_home = ProcessProfile {
            ssh_home: None,
            ..e2e.clone()
        };
        assert!(verify_identity(E2E, &e2e_without_ssh_home, E2E, E2E, Some(namespace)).is_err());
        let production_with_ssh_home = ProcessProfile {
            ssh_home: Some(ssh_home_for(E2E)),
            ..production.clone()
        };
        assert!(verify_identity(p, &production_with_ssh_home, p, p, None).is_err());
    }

    const VAULT: &str = "com.sortofremoteng.vault";
    const NAMESPACED_VAULT: &str = "com.sortofremoteng.vault@com.sortofremote.ng.e2e";

    fn runtime_dirs(identifier: &str) -> Vec<(&'static str, Result<PathBuf, String>)> {
        let known = known();
        let local = known.local_data.unwrap().join(identifier);
        vec![
            ("app data", Ok(known.data.unwrap().join(identifier))),
            ("app log", Ok(local.join("logs"))),
            ("app local data", Ok(local)),
        ]
    }

    fn observed<'a>(
        dirs: &'a [(&'a str, Result<PathBuf, String>)],
        webview2_env: Option<&'a OsStr>,
        installed_ssh_homes: &'a [(&'a str, Option<&'a Path>)],
    ) -> ObservedRuntime<'a> {
        ObservedRuntime {
            dirs,
            vault_service: (VAULT, NAMESPACED_VAULT),
            webview2_env,
            expected_ssh_home: Ok(ssh_home_for(E2E)),
            installed_ssh_homes,
        }
    }

    fn verify(profile: &ProcessProfile, observed: &ObservedRuntime<'_>) -> Result<(), String> {
        verify_isolated_runtime(profile, observed, &known())
    }

    #[test]
    fn isolated_runtime_requires_isolated_dirs_and_keychain() {
        let folder = run_folder();
        let arg = isolated_profile(Some(folder), Webview2Source::Arg);
        let env = Some(OsStr::new(folder));
        let dirs = runtime_dirs(E2E);
        let home = ssh_home_for(E2E);
        let installed = [
            ("ssh", Some(home.as_path())),
            ("opkssh", Some(home.as_path())),
        ];

        assert_eq!(verify(&arg, &observed(&dirs, env, &installed)), Ok(()));

        let production_dirs = runtime_dirs(PRODUCTION_IDENTIFIER);
        assert!(verify(&arg, &observed(&production_dirs, env, &installed)).is_err());
        let unresolved: [(&str, Result<PathBuf, String>); 1] =
            [("app data", Err("unknown".to_string()))];
        assert!(verify(&arg, &observed(&unresolved, env, &installed)).is_err());
        let mut unnamespaced = observed(&dirs, env, &installed);
        unnamespaced.vault_service = (VAULT, VAULT);
        assert!(verify(&arg, &unnamespaced).is_err());
    }

    #[test]
    fn isolated_runtime_requires_the_selected_webview2_folder() {
        let folder = run_folder();
        let arg = isolated_profile(Some(folder), Webview2Source::Arg);
        let default = isolated_profile(None, Webview2Source::TauriDefault);
        let env = Some(OsStr::new(folder));
        let dirs = runtime_dirs(E2E);

        assert_eq!(verify(&default, &observed(&dirs, None, &[])), Ok(()));
        assert!(verify(&arg, &observed(&dirs, None, &[])).is_err());
        assert!(verify(&default, &observed(&dirs, env, &[])).is_err());
        let moved = Path::new(folder).parent().unwrap().join("other");
        assert!(verify(&arg, &observed(&dirs, Some(moved.as_os_str()), &[])).is_err());
        let invalid = not_unicode();
        assert!(verify(&arg, &observed(&dirs, Some(&invalid), &[])).is_err());
        let production_folder = production_local().join("EBWebView");
        let recorded_production = isolated_profile(production_folder.to_str(), Webview2Source::Arg);
        assert!(verify(
            &recorded_production,
            &observed(&dirs, Some(production_folder.as_os_str()), &[])
        )
        .is_err());
        let no_policy = ProcessProfile {
            webview2: None,
            ..arg.clone()
        };
        assert!(verify(&no_policy, &observed(&dirs, env, &[])).is_err());
    }

    #[test]
    fn isolated_runtime_requires_every_ssh_home_at_app_data() {
        let folder = run_folder();
        let arg = isolated_profile(Some(folder), Webview2Source::Arg);
        let env = Some(OsStr::new(folder));
        let dirs = runtime_dirs(E2E);
        let home = ssh_home_for(E2E);
        let elsewhere = Path::new(folder).parent().unwrap().join("ssh-home");

        let missing = [("ssh", Some(home.as_path())), ("opkssh", None)];
        let message = verify(&arg, &observed(&dirs, env, &missing)).unwrap_err();
        assert!(message.contains("opkssh"), "{message}");
        let moved = [("ssh", Some(elsewhere.as_path()))];
        assert!(verify(&arg, &observed(&dirs, env, &moved)).is_err());

        let mut unresolved = observed(&dirs, env, &[]);
        unresolved.expected_ssh_home = Err("unknown".to_string());
        assert!(verify(&arg, &unresolved).is_err());

        let unrecorded = ProcessProfile {
            ssh_home: None,
            ..arg.clone()
        };
        assert!(verify(&unrecorded, &observed(&dirs, env, &[])).is_err());
        let recorded_elsewhere = ProcessProfile {
            ssh_home: Some(elsewhere.clone()),
            ..arg.clone()
        };
        assert!(verify(&recorded_elsewhere, &observed(&dirs, env, &[])).is_err());

        // Even a consistent SSH home is refused when it is the production one.
        let production_home = ssh_home_for(PRODUCTION_IDENTIFIER);
        let production_installed = [("ssh", Some(production_home.as_path()))];
        let recorded_production = ProcessProfile {
            ssh_home: Some(production_home.clone()),
            ..arg.clone()
        };
        let mut production_observed = observed(&dirs, env, &production_installed);
        production_observed.expected_ssh_home = Ok(production_home.clone());
        assert!(verify(&recorded_production, &production_observed).is_err());
    }

    #[test]
    fn autostart_name_is_namespaced_only_for_isolated_builds() {
        assert_eq!(autostart_app_name(PRODUCTION_IDENTIFIER), None);
        assert_eq!(
            autostart_app_name(E2E).as_deref(),
            Some("sortOfRemoteNG (com.sortofremote.ng.e2e)")
        );
    }

    #[test]
    fn run_installs_the_profile_first_and_setup_verifies_it_first() {
        let lib = include_str!("lib.rs").replace("\r\n", "\n");
        let first_statement = |body: &str| {
            body.lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.starts_with("//"))
                .map(str::to_string)
        };
        let run = lib
            .split("pub fn run() {\n")
            .nth(1)
            .expect("run() in lib.rs");
        assert_eq!(
            first_statement(run).as_deref(),
            Some("let profile = app_profile::install_process_profile();")
        );
        let install = run.find("install_process_profile()").unwrap();
        assert!(install < run.find("init_tracing();").unwrap());
        assert!(install < run.find("tauri::Builder::default()").unwrap());
        let setup = run.split(".setup(|app| {\n").nth(1).expect("setup closure");
        assert_eq!(
            first_statement(setup).as_deref(),
            Some("app_profile::verify_runtime(app)?;")
        );
        assert!(run.contains(".plugin(app_profile::autostart_plugin(&profile))"));
        assert!(!lib.contains("tauri_plugin_autostart::init("));
    }
}

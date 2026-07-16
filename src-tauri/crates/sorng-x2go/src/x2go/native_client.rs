//! Secure native X2Go Client handoff.
//!
//! sortOfRemoteNG does not implement the NX framebuffer/input channel used by
//! X2Go. A real session is therefore launched in the installed `x2goclient`
//! process using its documented portable session-profile interface. Temporary
//! files are exclusively created and use mode `0600` on Unix (the user temp
//! directory ACL on Windows). Secrets are never placed on argv or in the
//! generated profile: password and key-passphrase entry stays in the native
//! client's authentication UI.

use std::ffi::OsString;
use std::io::{self, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::x2go::types::{
    X2goCompression, X2goConfig, X2goDisplayMode, X2goError, X2goSessionType, X2goSshAuth,
};

const X2GO_CLIENT_CANDIDATES: &[&str] = &[
    "/usr/bin/x2goclient",
    "/usr/local/bin/x2goclient",
    "/opt/x2go/bin/x2goclient",
    "/Applications/x2goclient.app/Contents/MacOS/x2goclient",
    "/Applications/X2Go Client.app/Contents/MacOS/x2goclient",
    r"C:\Program Files\x2goclient\x2goclient.exe",
    r"C:\Program Files (x86)\x2goclient\x2goclient.exe",
];

/// Prepared process invocation and the temporary files tied to its lifetime.
pub struct PreparedX2goLaunch {
    pub executable: PathBuf,
    pub args: Vec<OsString>,
    pub temp_paths: Vec<PathBuf>,
}

fn validate_profile_value(name: &str, value: &str) -> Result<(), X2goError> {
    if value.is_empty() && matches!(name, "host" | "username") {
        return Err(X2goError::invalid_config(format!(
            "X2Go {name} is required"
        )));
    }
    if value.contains(['\r', '\n', '\0']) {
        return Err(X2goError::invalid_config(format!(
            "X2Go {name} contains an unsupported control character"
        )));
    }
    Ok(())
}

fn bool_value(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}

fn command_value(config: &X2goConfig) -> Result<String, X2goError> {
    let command = match config.session_type {
        X2goSessionType::Kde => "KDE".into(),
        X2goSessionType::Gnome => "GNOME".into(),
        X2goSessionType::Xfce => "XFCE".into(),
        X2goSessionType::Lxde => "LXDE".into(),
        X2goSessionType::Lxqt => "LXQT".into(),
        X2goSessionType::Mate => "MATE".into(),
        X2goSessionType::Cinnamon => "CINNAMON".into(),
        X2goSessionType::Unity => "UNITY".into(),
        X2goSessionType::Trinity => "TRINITY".into(),
        X2goSessionType::Shadow => "SHADOW".into(),
        X2goSessionType::Rdp => "RDP".into(),
        X2goSessionType::Application => config.command.clone().unwrap_or_else(|| "TERMINAL".into()),
        X2goSessionType::Custom => config.command.clone().ok_or_else(|| {
            X2goError::invalid_config("A command is required for a custom X2Go session")
        })?,
    };
    validate_profile_value("command", &command)?;
    Ok(command)
}

fn speed_value(compression: Option<&X2goCompression>) -> u8 {
    match compression.unwrap_or(&X2goCompression::Adsl) {
        X2goCompression::Modem => 0,
        X2goCompression::Isdn => 1,
        X2goCompression::Adsl => 2,
        X2goCompression::Wan => 3,
        X2goCompression::Lan | X2goCompression::None => 4,
    }
}

fn build_exports(config: &X2goConfig) -> Result<String, X2goError> {
    let mut exports = String::new();
    for folder in &config.shared_folders {
        validate_profile_value("shared folder path", &folder.local_path)?;
        validate_profile_value("shared folder remote name", &folder.remote_name)?;
        if !folder.remote_name.is_empty() {
            return Err(X2goError::invalid_config(
                "Custom remote names for X2Go shared folders cannot be represented by X2Go Client",
            ));
        }
        if folder.local_path.contains([';', '"']) {
            return Err(X2goError::invalid_config(
                "X2Go shared folder paths cannot contain semicolons or quotes",
            ));
        }
        if !folder.local_path.is_empty() {
            exports.push_str(&folder.local_path);
            exports.push(':');
            exports.push(if folder.auto_mount { '1' } else { '0' });
            exports.push(';');
        }
    }
    Ok(exports)
}

/// Build an X2Go sessions-file profile. The returned text deliberately never
/// contains password, passphrase, or inline private-key material.
pub fn build_session_profile(
    config: &X2goConfig,
    profile_name: &str,
    key_path: Option<&Path>,
) -> Result<String, X2goError> {
    validate_profile_value("host", config.host.trim())?;
    validate_profile_value("username", config.username.trim())?;
    validate_profile_value("profile name", profile_name)?;
    validate_profile_value("keyboard layout", &config.keyboard.layout)?;
    validate_profile_value("keyboard model", &config.keyboard.model)?;

    if config
        .keyboard
        .variant
        .as_deref()
        .is_some_and(|v| !v.is_empty())
    {
        return Err(X2goError::invalid_config(
            "X2Go keyboard variants cannot be represented by the native session profile",
        ));
    }
    if !config.ssh.strict_host_key {
        return Err(X2goError::invalid_config(
            "The native X2Go handoff refuses automated SSH host-key bypass; complete trust in X2Go Client",
        ));
    }
    if config.ssh.connect_timeout != 30 {
        return Err(X2goError::invalid_config(
            "A custom X2Go SSH connect timeout is not supported by the native session profile",
        ));
    }
    if config.color_depth.unwrap_or(24) != 24 {
        return Err(X2goError::invalid_config(
            "The native X2Go handoff currently supports 24-bit color profiles only",
        ));
    }
    if matches!(config.compression, Some(X2goCompression::None)) {
        return Err(X2goError::invalid_config(
            "Disabling X2Go compression cannot be represented by the native session profile",
        ));
    }
    if config.audio.port != 0 {
        return Err(X2goError::invalid_config(
            "A fixed X2Go audio port cannot be represented by the native session profile",
        ));
    }
    if config
        .printing
        .cups_server
        .as_deref()
        .is_some_and(|v| !v.is_empty())
        || config
            .printing
            .default_printer
            .as_deref()
            .is_some_and(|v| !v.is_empty())
    {
        return Err(X2goError::invalid_config(
            "Custom X2Go CUPS server/printer selection must be configured in X2Go Client",
        ));
    }
    if config.command.as_deref().is_some_and(|v| !v.is_empty())
        && !matches!(
            config.session_type,
            X2goSessionType::Custom | X2goSessionType::Application
        )
        && !matches!(config.display, X2goDisplayMode::SingleApplication { .. })
    {
        return Err(X2goError::invalid_config(
            "A custom X2Go command is valid only for custom or application sessions",
        ));
    }

    if config.use_broker || config.broker_url.as_deref().is_some_and(|v| !v.is_empty()) {
        return Err(X2goError::invalid_config(
            "X2Go broker routing is not available through the native direct-session handoff",
        ));
    }
    if config
        .ssh
        .proxy_command
        .as_deref()
        .is_some_and(|v| !v.is_empty())
    {
        return Err(X2goError::invalid_config(
            "Arbitrary SSH ProxyCommand routing is not passed to X2Go Client; configure a supported route in the native client",
        ));
    }
    if config
        .ssh
        .ssh_config_file
        .as_deref()
        .is_some_and(|v| !v.is_empty())
    {
        return Err(X2goError::invalid_config(
            "A custom SSH config file cannot be represented safely in the X2Go native profile",
        ));
    }
    if config
        .ssh
        .known_hosts_file
        .as_deref()
        .is_some_and(|v| !v.is_empty())
    {
        return Err(X2goError::invalid_config(
            "A custom known-hosts path cannot be represented by X2Go Client; use its native host-key prompt/store",
        ));
    }
    if config
        .resume_session
        .as_deref()
        .is_some_and(|v| !v.is_empty())
    {
        return Err(X2goError::invalid_config(
            "Selecting a specific X2Go server session is handled in the native client UI",
        ));
    }
    if config
        .session_cookie
        .as_deref()
        .is_some_and(|v| !v.is_empty())
    {
        return Err(X2goError::invalid_config(
            "X2Go session cookies are not exported to the native handoff",
        ));
    }

    let (autologin, krblogin) = match config.ssh.auth {
        X2goSshAuth::Agent => (true, false),
        X2goSshAuth::Gssapi => (false, true),
        X2goSshAuth::Password { .. }
        | X2goSshAuth::PrivateKey { .. }
        | X2goSshAuth::InlinePrivateKey { .. } => (false, false),
    };
    let key = key_path
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    validate_profile_value("private key path", &key)?;
    let command = command_value(config)?;
    let exports = build_exports(config)?;

    let (fullscreen, width, height) = match config.display {
        X2goDisplayMode::Window { width, height } => (false, width, height),
        X2goDisplayMode::Fullscreen => (true, 1024, 768),
        X2goDisplayMode::SingleApplication { .. } => (false, 800, 600),
    };
    let (rootless, command) = match &config.display {
        X2goDisplayMode::SingleApplication { command } => {
            validate_profile_value("single application command", command)?;
            (true, command.clone())
        }
        _ => (config.rootless, command),
    };
    let dpi = config.dpi.unwrap_or(96);
    let audio_enabled = config.audio.enabled;
    let sound_system = config.audio.system.to_x2go_string();

    Ok(format!(
        "[{profile_name}]\n\
name={profile_name}\n\
host={host}\n\
user={user}\n\
sshport={ssh_port}\n\
key={key}\n\
autologin={autologin}\n\
krblogin={krblogin}\n\
autostart=true\n\
command={command}\n\
published={published}\n\
rootless={rootless}\n\
speed={speed}\n\
pack=16m-jpeg\n\
quality=9\n\
fullscreen={fullscreen}\n\
multidisp=false\n\
width={width}\n\
height={height}\n\
dpi={dpi}\n\
setdpi=true\n\
display=1\n\
usekbd=true\n\
layout={layout}\n\
type={keyboard_type}\n\
clipboard={clipboard}\n\
sound={sound}\n\
soundsystem={sound_system}\n\
soundtunnel=true\n\
defsndport=true\n\
print={printing}\n\
fstunnel=true\n\
useexports={use_exports}\n\
export=\"{exports}\"\n\
usesshproxy=false\n",
        host = config.host.trim(),
        user = config.username.trim(),
        ssh_port = config.ssh.port,
        autologin = bool_value(autologin),
        krblogin = bool_value(krblogin),
        published = bool_value(config.published_applications),
        rootless = bool_value(rootless),
        speed = speed_value(config.compression.as_ref()),
        fullscreen = bool_value(fullscreen),
        layout = config.keyboard.layout,
        keyboard_type = config.keyboard.model,
        clipboard = config.clipboard.to_x2go_string(),
        sound = bool_value(audio_enabled),
        printing = bool_value(config.printing.enabled),
        use_exports = bool_value(!config.shared_folders.is_empty()),
    ))
}

pub fn find_x2go_client(custom_path: Option<&str>) -> Result<PathBuf, X2goError> {
    if let Some(custom) = custom_path.filter(|value| !value.trim().is_empty()) {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Ok(path);
        }
        return Err(X2goError::invalid_config(format!(
            "X2Go Client was not found at the configured path: {}",
            path.display()
        )));
    }

    if let Ok(path) = which::which("x2goclient") {
        return Ok(path);
    }
    X2GO_CLIENT_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .ok_or_else(|| {
            X2goError::session_start(
                "X2Go Client is not installed. Install x2goclient or configure its executable path.",
            )
        })
}

pub fn write_secure_temp_file(
    prefix: &str,
    extension: &str,
    contents: &[u8],
) -> Result<PathBuf, X2goError> {
    let path =
        std::env::temp_dir().join(format!("{prefix}-{}.{}", uuid::Uuid::new_v4(), extension));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&path).map_err(|error| {
        X2goError::session_start(format!("Failed to stage X2Go profile: {error}"))
    })?;
    write_all_flush_or_cleanup(file, &path, contents).map_err(|error| {
        X2goError::session_start(format!("Failed to write X2Go profile: {error}"))
    })?;
    Ok(path)
}

fn write_all_flush_or_cleanup<W: Write>(
    mut writer: W,
    path: &Path,
    contents: &[u8],
) -> io::Result<()> {
    let result = writer.write_all(contents).and_then(|_| writer.flush());
    if let Err(error) = result {
        drop(writer);
        zeroize_and_remove(path);
        return Err(error);
    }
    Ok(())
}

/// Best-effort overwrite followed by removal. This is used for both the
/// profile and any staged inline key, including every failure path.
pub fn zeroize_and_remove(path: &Path) {
    if let Ok(mut file) = std::fs::OpenOptions::new().write(true).open(path) {
        if let Ok(metadata) = file.metadata() {
            let mut remaining = metadata.len();
            let zeros = [0_u8; 4096];
            let _ = file.seek(SeekFrom::Start(0));
            while remaining > 0 {
                let count = remaining.min(zeros.len() as u64) as usize;
                if file.write_all(&zeros[..count]).is_err() {
                    break;
                }
                remaining -= count as u64;
            }
            let _ = file.flush();
        }
    }
    let _ = std::fs::remove_file(path);
}

pub fn cleanup_temp_paths(paths: &[PathBuf]) {
    for path in paths {
        zeroize_and_remove(path);
    }
}

pub fn prepare_native_launch(config: &X2goConfig) -> Result<PreparedX2goLaunch, X2goError> {
    let executable = find_x2go_client(config.native_client_path.as_deref())?;
    let profile_name = format!("sortOfRemoteNG-{}", uuid::Uuid::new_v4().simple());
    let mut temp_paths = Vec::new();

    let key_path = match &config.ssh.auth {
        X2goSshAuth::PrivateKey { key_path, .. } => {
            validate_profile_value("private key path", key_path)?;
            let path = PathBuf::from(key_path);
            if !path.is_file() {
                return Err(X2goError::invalid_config(format!(
                    "X2Go private key file was not found: {}",
                    path.display()
                )));
            }
            Some(path)
        }
        X2goSshAuth::InlinePrivateKey { private_key, .. } => {
            if private_key.trim().is_empty() {
                return Err(X2goError::invalid_config(
                    "Inline X2Go private key material is empty",
                ));
            }
            let path = write_secure_temp_file("sorng-x2go-key", "key", private_key.as_bytes())?;
            temp_paths.push(path.clone());
            Some(path)
        }
        _ => None,
    };

    let profile = match build_session_profile(config, &profile_name, key_path.as_deref()) {
        Ok(profile) => profile,
        Err(error) => {
            cleanup_temp_paths(&temp_paths);
            return Err(error);
        }
    };
    let profile_path =
        match write_secure_temp_file("sorng-x2go-session", "conf", profile.as_bytes()) {
            Ok(path) => path,
            Err(error) => {
                cleanup_temp_paths(&temp_paths);
                return Err(error);
            }
        };
    temp_paths.push(profile_path.clone());

    let args = vec![
        OsString::from("--portable"),
        OsString::from(format!("--session-conf={}", profile_path.to_string_lossy())),
        OsString::from(format!("--session={profile_name}")),
        OsString::from("--no-session-edit"),
        OsString::from("--close-disconnect"),
    ];

    Ok(PreparedX2goLaunch {
        executable,
        args,
        temp_paths,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct PartialWriteFailure {
        file: std::fs::File,
        remaining: usize,
    }

    impl Write for PartialWriteFailure {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            if self.remaining == 0 {
                return Err(io::Error::other("injected partial write failure"));
            }
            let count = buffer.len().min(self.remaining);
            let written = self.file.write(&buffer[..count])?;
            self.remaining -= written;
            Ok(written)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.file.flush()
        }
    }

    fn password_config() -> X2goConfig {
        X2goConfig {
            host: "x2go.example.test".into(),
            username: "alice".into(),
            ssh: crate::x2go::types::X2goSshConfig {
                auth: X2goSshAuth::Password {
                    password: "do-not-leak".into(),
                },
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn profile_never_contains_password() {
        let profile = build_session_profile(&password_config(), "profile", None).unwrap();
        assert!(!profile.contains("do-not-leak"));
        assert!(profile.contains("autologin=false"));
        assert!(profile.contains("host=x2go.example.test"));
    }

    #[test]
    fn passphrase_is_not_written_to_profile() {
        let mut config = password_config();
        config.ssh.auth = X2goSshAuth::PrivateKey {
            key_path: "/safe/id_ed25519".into(),
            passphrase: Some("also-do-not-leak".into()),
        };
        let profile =
            build_session_profile(&config, "profile", Some(Path::new("/safe/id_ed25519"))).unwrap();
        assert!(!profile.contains("also-do-not-leak"));
        assert!(profile.contains("key=/safe/id_ed25519"));
    }

    #[test]
    fn profile_rejects_injected_lines() {
        let mut config = password_config();
        config.host = "host\nautologin=true".into();
        let error = build_session_profile(&config, "profile", None).unwrap_err();
        assert_eq!(error.kind, crate::x2go::types::X2goErrorKind::InvalidConfig);
    }

    #[test]
    fn profile_rejects_keyboard_line_injection() {
        let mut config = password_config();
        config.keyboard.layout = "us\nautologin=true".into();
        assert!(build_session_profile(&config, "profile", None).is_err());

        let mut config = password_config();
        config.keyboard.model = "pc105\nkey=/stolen".into();
        assert!(build_session_profile(&config, "profile", None).is_err());
    }

    #[test]
    fn unsupported_route_fails_closed() {
        let mut config = password_config();
        config.ssh.proxy_command = Some("ssh jump".into());
        let error = build_session_profile(&config, "profile", None).unwrap_err();
        assert!(error.message.contains("ProxyCommand"));
    }

    #[test]
    fn every_unrepresented_non_default_option_fails_closed() {
        let mut variants = Vec::new();

        let mut config = password_config();
        config.ssh.strict_host_key = false;
        variants.push(config);

        let mut config = password_config();
        config.ssh.connect_timeout = 9;
        variants.push(config);

        let mut config = password_config();
        config.ssh.known_hosts_file = Some("known_hosts".into());
        variants.push(config);

        let mut config = password_config();
        config.ssh.ssh_config_file = Some("ssh_config".into());
        variants.push(config);

        let mut config = password_config();
        config.color_depth = Some(16);
        variants.push(config);

        let mut config = password_config();
        config.compression = Some(X2goCompression::None);
        variants.push(config);

        let mut config = password_config();
        config.audio.port = 4713;
        variants.push(config);

        let mut config = password_config();
        config.keyboard.variant = Some("dvorak".into());
        variants.push(config);

        let mut config = password_config();
        config.printing.cups_server = Some("cups.example".into());
        variants.push(config);

        let mut config = password_config();
        config
            .shared_folders
            .push(crate::x2go::types::X2goSharedFolder {
                local_path: "/tmp/share".into(),
                remote_name: "custom-name".into(),
                auto_mount: true,
            });
        variants.push(config);

        let mut config = password_config();
        config.resume_session = Some("remote-session".into());
        variants.push(config);

        let mut config = password_config();
        config.session_cookie = Some("cookie".into());
        variants.push(config);

        let mut config = password_config();
        config.use_broker = true;
        variants.push(config);

        let mut config = password_config();
        config.command = Some("ignored-command".into());
        variants.push(config);

        for config in variants {
            assert!(
                build_session_profile(&config, "profile", None).is_err(),
                "non-default option was silently ignored: {config:?}"
            );
        }
    }

    #[test]
    fn secure_temp_file_is_zeroized_and_removed() {
        let path = write_secure_temp_file("sorng-x2go-test", "tmp", b"secret").unwrap();
        assert!(path.is_file());
        zeroize_and_remove(&path);
        assert!(!path.exists());
    }

    #[test]
    fn partial_secure_temp_write_is_zeroized_and_removed() {
        let path = std::env::temp_dir().join(format!(
            "sorng-x2go-partial-write-{}.tmp",
            uuid::Uuid::new_v4()
        ));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        let writer = PartialWriteFailure { file, remaining: 3 };

        let result = write_all_flush_or_cleanup(writer, &path, b"secret material");

        assert!(result.is_err());
        assert!(!path.exists());
    }
}

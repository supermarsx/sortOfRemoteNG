//! Secure native NoMachine (`nxplayer`) handoff.
//!
//! The previous raw-TCP implementation did not perform SSH, parse NX server
//! replies, or expose a framebuffer. This module instead launches the real
//! installed NoMachine player with a short-lived, exclusively created `.nxs`
//! file (mode `0600` on Unix; the user temp-directory ACL on Windows). The file
//! intentionally contains `EMPTY_PASSWORD`; authentication and host trust are
//! completed in NoMachine's own UI.

use std::ffi::OsString;
use std::io::{self, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::nx::types::{
    ImageQuality, KeyboardLayout, LinkSpeed, NxAudioCodec, NxCompression, NxConfig, NxError,
    NxSessionType, NxVersion, PrinterDriver,
};

const NXPLAYER_CANDIDATES: &[&str] = &[
    "/usr/NX/bin/nxplayer",
    "/usr/local/NX/bin/nxplayer",
    "/Applications/NoMachine.app/Contents/MacOS/nxplayer",
    r"C:\Program Files\NoMachine\bin\nxplayer.exe",
    r"C:\Program Files (x86)\NoMachine\bin\nxplayer.exe",
];

pub struct PreparedNxLaunch {
    pub executable: PathBuf,
    pub args: Vec<OsString>,
    pub temp_paths: Vec<PathBuf>,
}

fn validate_value(name: &str, value: &str) -> Result<(), NxError> {
    if value.is_empty() && name == "host" {
        return Err(NxError::config("NoMachine host is required"));
    }
    if value.chars().any(|c| matches!(c, '\r' | '\n' | '\0')) {
        return Err(NxError::config(format!(
            "NoMachine {name} contains an unsupported control character"
        )));
    }
    Ok(())
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn bool_value(value: bool) -> &'static str {
    if value {
        "true"
    } else {
        "false"
    }
}

fn session_options(config: &NxConfig) -> Result<(&'static str, String, String), NxError> {
    let session_type = config
        .session_type
        .as_ref()
        .unwrap_or(&NxSessionType::UnixDesktop);
    let options = match session_type {
        NxSessionType::UnixDesktop => ("unix", "xsession-default".into(), String::new()),
        NxSessionType::UnixGnome => ("unix", "gnome".into(), String::new()),
        NxSessionType::UnixKde => ("unix", "kde".into(), String::new()),
        NxSessionType::UnixXfce => ("unix", "console".into(), "xfce4-session".into()),
        NxSessionType::UnixCustom | NxSessionType::Application => {
            let command = config.custom_command.clone().ok_or_else(|| {
                NxError::config("A command is required for a custom NoMachine session")
            })?;
            validate_value("custom command", &command)?;
            ("unix", "console".into(), command)
        }
        NxSessionType::Console => ("unix", "console".into(), String::new()),
        NxSessionType::Shadow => {
            // An empty desktop asks NoMachine to use the normal physical
            // desktop/session chooser instead of manufacturing a virtual one.
            ("unix", String::new(), String::new())
        }
        NxSessionType::Windows | NxSessionType::Vnc => {
            return Err(NxError::config(
                "NoMachine RDP/VNC proxy sessions require a secondary target that is not configured; use a direct RDP or VNC connection",
            ));
        }
    };
    Ok(options)
}

fn connection_service(config: &NxConfig) -> Result<&'static str, NxError> {
    match config
        .connection_service
        .as_deref()
        .unwrap_or("nx")
        .to_ascii_lowercase()
        .as_str()
    {
        "nx" => Ok("nx"),
        "ssh" => Ok("ssh"),
        _ => Err(NxError::config(
            "NoMachine native handoff supports only NX or SSH transport",
        )),
    }
}

/// Build the minimal documented `.nxs` settings needed for a native launch.
/// Passwords, passphrases, and private-key material are deliberately absent.
pub fn build_nxs_profile(config: &NxConfig, key_path: Option<&Path>) -> Result<String, NxError> {
    let host = config.host.trim();
    validate_value("host", host)?;
    let username = config.username.as_deref().unwrap_or("").trim();
    validate_value("username", username)?;

    if config
        .nxproxy_path
        .as_deref()
        .is_some_and(|value| !value.is_empty())
    {
        return Err(NxError::config(
            "The legacy nxproxy path cannot launch NoMachine Client; configure native_client_path with nxplayer instead",
        ));
    }
    if !matches!(config.version, None | Some(NxVersion::V3)) {
        return Err(NxError::config(
            "Forcing a legacy NX protocol version is not supported by the native NoMachine handoff",
        ));
    }
    if config.color_depth.unwrap_or(24) != 24 {
        return Err(NxError::config(
            "The native NoMachine handoff currently supports the default 24-bit color setting only",
        ));
    }
    if !matches!(config.compression, None | Some(NxCompression::Adaptive))
        || config.compression_level.unwrap_or(6) != 6
        || !matches!(config.link_speed, None | Some(LinkSpeed::Adsl))
    {
        return Err(NxError::config(
            "Custom NX compression, level, or link-speed settings cannot be forced through the native NoMachine profile",
        ));
    }
    if config.connect_timeout.unwrap_or(30) != 30 || config.keepalive_interval.unwrap_or(60) != 60 {
        return Err(NxError::config(
            "Custom NX connect-timeout or keepalive settings must be configured in NoMachine Client",
        ));
    }
    if config.media_forwarding == Some(false) {
        return Err(NxError::config(
            "Disabling NoMachine media forwarding must be configured in the native client",
        ));
    }
    if config.auto_resume == Some(false) {
        return Err(NxError::config(
            "Disabling NoMachine automatic resume must be configured in the native client",
        ));
    }
    if let Some(audio) = &config.audio {
        if audio.codec != NxAudioCodec::Opus
            || audio.sample_rate != 44_100
            || audio.channels != 2
            || audio.bit_depth != 16
        {
            return Err(NxError::config(
                "Custom NoMachine audio codec/format settings must be configured in the native client",
            ));
        }
    }
    if let Some(printing) = &config.printing {
        if printing.driver != PrinterDriver::Cups
            || printing.paper_size != "A4"
            || printing
                .default_printer
                .as_deref()
                .is_some_and(|value| !value.is_empty())
        {
            return Err(NxError::config(
                "Custom NoMachine printer driver, paper, or printer selection must be configured in the native client",
            ));
        }
    }
    if let Some(keyboard) = &config.keyboard {
        let default = KeyboardLayout::default();
        if keyboard.model != default.model
            || keyboard.layout != default.layout
            || keyboard
                .variant
                .as_deref()
                .is_some_and(|value| !value.is_empty())
            || keyboard
                .options
                .as_deref()
                .is_some_and(|value| !value.is_empty())
        {
            return Err(NxError::config(
                "Custom NoMachine keyboard settings must be configured in the native client",
            ));
        }
    }

    if config
        .proxy_host
        .as_deref()
        .is_some_and(|value| !value.is_empty())
        || config.proxy_port.is_some()
    {
        return Err(NxError::config(
            "NoMachine proxy routing is not represented by this native handoff; remove the route or configure it in NoMachine",
        ));
    }
    if config
        .nxproxy_extra_args
        .as_ref()
        .is_some_and(|args| !args.is_empty())
    {
        return Err(NxError::config(
            "Unvalidated nxproxy arguments are not forwarded to the native NoMachine client",
        ));
    }
    if config
        .resume_session_id
        .as_deref()
        .is_some_and(|value| !value.is_empty())
    {
        return Err(NxError::config(
            "Selecting a specific resumable NoMachine session is handled by the native client UI",
        ));
    }
    if config
        .custom_command
        .as_deref()
        .is_some_and(|value| !value.is_empty())
        && !matches!(
            config.session_type,
            Some(NxSessionType::UnixCustom | NxSessionType::Application)
        )
    {
        return Err(NxError::config(
            "A custom command is valid only for custom or application NoMachine sessions",
        ));
    }
    if connection_service(config)? == "nx" && config.ssh_port.unwrap_or(22) != 22 {
        return Err(NxError::config(
            "An SSH port is not used by NX transport; choose SSH transport or restore the default",
        ));
    }
    if config.file_sharing == Some(true) || config.shared_folder.is_some() {
        return Err(NxError::config(
            "NoMachine folder sharing must be selected in the native client because the current connection model cannot represent its permissions safely",
        ));
    }
    if config.clipboard == Some(false) {
        return Err(NxError::config(
            "Disabling NoMachine clipboard sharing must be configured in the native client",
        ));
    }

    let service = connection_service(config)?;
    let (session, desktop, command) = session_options(config)?;
    let port = if service == "ssh" {
        config.ssh_port.unwrap_or(config.port)
    } else {
        config.port
    };
    if port == 0 {
        return Err(NxError::config(
            "NoMachine port must be between 1 and 65535",
        ));
    }
    let key_path = key_path
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    validate_value("private key path", &key_path)?;
    let login_method = if key_path.is_empty() {
        "password"
    } else {
        "privatekey"
    };
    let width = config.resolution_width.unwrap_or(1024).max(320);
    let height = config.resolution_height.unwrap_or(768).max(200);
    let window_state = if config.fullscreen.unwrap_or(false) {
        "fullscreen"
    } else {
        "normal"
    };
    let image_quality = match config.image_quality.unwrap_or(ImageQuality::Medium) {
        ImageQuality::Low => 3,
        ImageQuality::Medium => 5,
        ImageQuality::High => 8,
        ImageQuality::Lossless => 9,
    };
    let audio = config.audio.as_ref().map_or(true, |audio| audio.enabled);
    let printing = config
        .printing
        .as_ref()
        .is_some_and(|printing| printing.enabled);

    Ok(format!(
        "<!DOCTYPE NXClientSettings>\n\
<NXClientSettings application=\"nxplayer\" version=\"2.0\" >\n\
 <group name=\"General\" >\n\
  <option key=\"Server host\" value=\"{host}\" />\n\
  <option key=\"Connection service\" value=\"{service}\" />\n\
  <option key=\"Server port\" value=\"{port}\" />\n\
  <option key=\"NoMachine daemon port\" value=\"{port}\" />\n\
  <option key=\"Session\" value=\"{session}\" />\n\
  <option key=\"Desktop\" value=\"{desktop}\" />\n\
  <option key=\"Custom Unix Desktop\" value=\"{custom_desktop}\" />\n\
  <option key=\"Command line\" value=\"{command}\" />\n\
  <option key=\"Virtual desktop\" value=\"true\" />\n\
  <option key=\"Resolution\" value=\"{width}x{height}\" />\n\
  <option key=\"Resolution width\" value=\"{width}\" />\n\
  <option key=\"Resolution height\" value=\"{height}\" />\n\
  <option key=\"Session window state\" value=\"{window_state}\" />\n\
  <option key=\"Image encoding quality\" value=\"{image_quality}\" />\n\
 </group>\n\
 <group name=\"Login\" >\n\
  <option key=\"User\" value=\"{username}\" />\n\
  <option key=\"Auth\" value=\"EMPTY_PASSWORD\" />\n\
  <option key=\"Remember NoMachine password\" value=\"false\" />\n\
  <option key=\"Remember two-factor authentication password\" value=\"false\" />\n\
  <option key=\"NX login method\" value=\"{login_method}\" />\n\
  <option key=\"System login method\" value=\"{login_method}\" />\n\
  <option key=\"Private key for NX authentication\" value=\"{key_path}\" />\n\
  <option key=\"Private key\" value=\"{key_path}\" />\n\
 </group>\n\
 <group name=\"Services\" >\n\
  <option key=\"Audio\" value=\"{audio}\" />\n\
  <option key=\"IPPPrinting\" value=\"{printing}\" />\n\
  <option key=\"Shares\" value=\"false\" />\n\
 </group>\n\
</NXClientSettings>\n",
        host = xml_escape(host),
        username = xml_escape(username),
        desktop = xml_escape(&desktop),
        custom_desktop = if command.is_empty() {
            "default"
        } else {
            "application"
        },
        command = xml_escape(&command),
        key_path = xml_escape(&key_path),
        audio = bool_value(audio),
        printing = bool_value(printing),
    ))
}

pub fn find_nxplayer(custom_path: Option<&str>) -> Result<PathBuf, NxError> {
    if let Some(custom) = custom_path.filter(|value| !value.trim().is_empty()) {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Ok(path);
        }
        return Err(NxError::config(format!(
            "NoMachine nxplayer was not found at the configured path: {}",
            path.display()
        )));
    }
    if let Ok(path) = which::which("nxplayer") {
        return Ok(path);
    }
    NXPLAYER_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
        .ok_or_else(|| {
            NxError::connection_failed(
                "NoMachine Client is not installed. Install NoMachine or configure its nxplayer path.",
            )
        })
}

pub fn write_secure_temp_file(
    prefix: &str,
    extension: &str,
    contents: &[u8],
) -> Result<PathBuf, NxError> {
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
        NxError::connection_failed(format!("Failed to stage NoMachine profile: {error}"))
    })?;
    write_all_flush_or_cleanup(file, &path, contents).map_err(|error| {
        NxError::connection_failed(format!("Failed to write NoMachine profile: {error}"))
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

pub fn prepare_native_launch(config: &NxConfig) -> Result<PreparedNxLaunch, NxError> {
    if config
        .nxproxy_path
        .as_deref()
        .is_some_and(|value| !value.is_empty())
    {
        return Err(NxError::config(
            "nxproxy is not nxplayer. Set native_client_path to the installed NoMachine Client executable.",
        ));
    }
    let executable = find_nxplayer(config.native_client_path.as_deref())?;
    let mut temp_paths = Vec::new();

    let key_path = if let Some(private_key) = config
        .private_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let possible_path = PathBuf::from(private_key);
        if !private_key.contains("-----BEGIN") && possible_path.is_file() {
            Some(possible_path)
        } else if !private_key.contains("-----BEGIN") {
            return Err(NxError::config(format!(
                "NoMachine private key file was not found: {}",
                possible_path.display()
            )));
        } else {
            let path = write_secure_temp_file("sorng-nx-key", "key", private_key.as_bytes())?;
            temp_paths.push(path.clone());
            Some(path)
        }
    } else {
        None
    };

    let profile = match build_nxs_profile(config, key_path.as_deref()) {
        Ok(profile) => profile,
        Err(error) => {
            cleanup_temp_paths(&temp_paths);
            return Err(error);
        }
    };
    let profile_path = match write_secure_temp_file("sorng-nx-session", "nxs", profile.as_bytes()) {
        Ok(path) => path,
        Err(error) => {
            cleanup_temp_paths(&temp_paths);
            return Err(error);
        }
    };
    temp_paths.push(profile_path.clone());

    Ok(PreparedNxLaunch {
        executable,
        args: vec![OsString::from("--session"), profile_path.into_os_string()],
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

    fn config() -> NxConfig {
        NxConfig {
            host: "nx.example.test".into(),
            username: Some("alice".into()),
            password: Some("do-not-leak".into()),
            ..Default::default()
        }
    }

    #[test]
    fn nxs_never_contains_password() {
        let profile = build_nxs_profile(&config(), None).unwrap();
        assert!(!profile.contains("do-not-leak"));
        assert!(profile.contains("value=\"EMPTY_PASSWORD\""));
        assert!(profile.contains("value=\"nx.example.test\""));
    }

    #[test]
    fn xml_values_are_escaped() {
        let mut config = config();
        config.username = Some("a&b<admin>".into());
        let profile = build_nxs_profile(&config, None).unwrap();
        assert!(profile.contains("a&amp;b&lt;admin&gt;"));
        assert!(!profile.contains("a&b<admin>"));
    }

    #[test]
    fn unsupported_proxy_fails_closed() {
        let mut config = config();
        config.proxy_host = Some("proxy.example".into());
        let error = build_nxs_profile(&config, None).unwrap_err();
        assert_eq!(error.kind, crate::nx::types::NxErrorKind::ConfigError);
    }

    #[test]
    fn every_unrepresented_non_default_option_fails_closed() {
        let mut variants = Vec::new();

        let mut value = config();
        value.nxproxy_path = Some("/usr/bin/nxproxy".into());
        variants.push(value);

        let mut value = config();
        value.nxproxy_extra_args = Some(vec!["-unsafe".into()]);
        variants.push(value);

        let mut value = config();
        value.version = Some(NxVersion::V5);
        variants.push(value);

        let mut value = config();
        value.color_depth = Some(16);
        variants.push(value);

        let mut value = config();
        value.compression = Some(NxCompression::Zlib);
        variants.push(value);

        let mut value = config();
        value.compression_level = Some(9);
        variants.push(value);

        let mut value = config();
        value.link_speed = Some(LinkSpeed::Lan);
        variants.push(value);

        let mut value = config();
        value.connect_timeout = Some(5);
        variants.push(value);

        let mut value = config();
        value.keepalive_interval = Some(5);
        variants.push(value);

        let mut value = config();
        value.media_forwarding = Some(false);
        variants.push(value);

        let mut value = config();
        value.auto_resume = Some(false);
        variants.push(value);

        let mut value = config();
        value.audio.as_mut().unwrap().codec = NxAudioCodec::Mp3;
        variants.push(value);

        let mut value = config();
        value.printing.as_mut().unwrap().paper_size = "Letter".into();
        variants.push(value);

        let mut value = config();
        value.keyboard.as_mut().unwrap().layout = "de".into();
        variants.push(value);

        let mut value = config();
        value.resume_session_id = Some("remote-session".into());
        variants.push(value);

        let mut value = config();
        value.file_sharing = Some(true);
        variants.push(value);

        let mut value = config();
        value.clipboard = Some(false);
        variants.push(value);

        let mut value = config();
        value.custom_command = Some("ignored".into());
        variants.push(value);

        let mut value = config();
        value.ssh_port = Some(2222);
        variants.push(value);

        for value in variants {
            assert!(
                build_nxs_profile(&value, None).is_err(),
                "non-default option was silently ignored: {value:?}"
            );
        }
    }

    #[test]
    fn injected_xml_line_is_rejected() {
        let mut config = config();
        config.host = "host\n<option key=\"Auth\" value=\"secret\" />".into();
        assert!(build_nxs_profile(&config, None).is_err());
    }

    #[test]
    fn custom_and_application_sessions_require_and_preserve_commands() {
        for session_type in [NxSessionType::UnixCustom, NxSessionType::Application] {
            let mut missing = config();
            missing.session_type = Some(session_type.clone());
            missing.custom_command = None;
            assert!(build_nxs_profile(&missing, None).is_err());

            let mut configured = missing;
            configured.custom_command = Some("/usr/bin/xterm --hold".into());
            let profile = build_nxs_profile(&configured, None).unwrap();
            assert!(profile.contains("/usr/bin/xterm --hold"));
            assert!(profile.contains("Custom Unix Desktop\" value=\"application"));
        }
    }

    #[test]
    fn secondary_target_session_types_fail_closed() {
        for session_type in [NxSessionType::Windows, NxSessionType::Vnc] {
            let mut value = config();
            value.session_type = Some(session_type);
            let error = build_nxs_profile(&value, None).unwrap_err();
            assert!(error.message.contains("secondary target"));
        }
    }

    #[test]
    fn secure_temp_file_is_zeroized_and_removed() {
        let path = write_secure_temp_file("sorng-nx-test", "tmp", b"secret").unwrap();
        assert!(path.is_file());
        zeroize_and_remove(&path);
        assert!(!path.exists());
    }

    #[test]
    fn partial_secure_temp_write_is_zeroized_and_removed() {
        let path = std::env::temp_dir().join(format!(
            "sorng-nx-partial-write-{}.tmp",
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

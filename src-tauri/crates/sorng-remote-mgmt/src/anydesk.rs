use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::Zeroize;

pub type AnyDeskServiceState = Arc<Mutex<AnyDeskService>>;

/// Local launcher-process state only. It never claims remote authentication,
/// framebuffer readiness, or an established AnyDesk peer session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnyDeskSession {
    pub id: String,
    pub anydesk_id: String,
    pub process_running: bool,
    pub start_time: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
struct AnyDeskConnection {
    session: AnyDeskSession,
    child: Child,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AnyDeskLaunchSpec {
    program: String,
    args: Vec<String>,
    password_via_stdin: bool,
}

pub struct AnyDeskService {
    connections: HashMap<String, AnyDeskConnection>,
}

fn validate_target(anydesk_id: &str) -> Result<&str, String> {
    let target = anydesk_id.trim();
    if target.is_empty() {
        return Err("An AnyDesk ID or alias is required".to_string());
    }
    if target.chars().any(char::is_control) {
        return Err("The AnyDesk ID or alias contains control characters".to_string());
    }
    if target.starts_with('-') || target.starts_with('/') {
        return Err("The AnyDesk ID or alias cannot be an option-like value".to_string());
    }
    Ok(target)
}

#[cfg(any(target_os = "macos", test))]
fn percent_encode_uri_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(*byte));
        } else {
            use std::fmt::Write as _;
            write!(&mut encoded, "%{byte:02X}").expect("writing to a String cannot fail");
        }
    }
    encoded
}

fn build_launch_spec(anydesk_id: &str, has_password: bool) -> Result<AnyDeskLaunchSpec, String> {
    let target = validate_target(anydesk_id)?;

    #[cfg(target_os = "windows")]
    {
        let mut args = vec![target.to_string()];
        if has_password {
            args.push("--with-password".to_string());
        }
        Ok(AnyDeskLaunchSpec {
            program: "anydesk.exe".to_string(),
            args,
            password_via_stdin: has_password,
        })
    }

    #[cfg(target_os = "linux")]
    {
        let mut args = vec![target.to_string()];
        if has_password {
            args.push("--with-password".to_string());
        }
        Ok(AnyDeskLaunchSpec {
            program: "anydesk".to_string(),
            args,
            password_via_stdin: has_password,
        })
    }

    #[cfg(target_os = "macos")]
    {
        // AnyDesk's macOS CLI documentation does not define remote password
        // initiation. Use the URL handoff and leave authentication to the
        // trusted native prompt; never invent a password command contract.
        Ok(AnyDeskLaunchSpec {
            program: "open".to_string(),
            args: vec![format!(
                "anydesk://{}",
                percent_encode_uri_component(target)
            )],
            password_via_stdin: false,
        })
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = has_password;
        Err("AnyDesk launching is not supported on this platform".to_string())
    }
}

fn spawn_launcher(
    spec: &AnyDeskLaunchSpec,
    password: &mut Option<String>,
) -> Result<Child, String> {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(if spec.password_via_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        });

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            password.zeroize();
            return Err(format!("Failed to launch AnyDesk: {error}"));
        }
    };

    let credential_result = if spec.password_via_stdin {
        match (password.as_deref(), child.stdin.as_mut()) {
            (Some(secret), Some(stdin)) => stdin
                .write_all(secret.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .and_then(|_| stdin.flush())
                .map_err(|error| {
                    format!("Failed to deliver the AnyDesk credential via stdin: {error}")
                }),
            _ => Err("AnyDesk password mode did not expose a writable stdin pipe".to_string()),
        }
    } else {
        Ok(())
    };
    child.stdin.take();
    password.zeroize();

    if let Err(error) = credential_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    Ok(child)
}

fn launcher_is_running(connection: &mut AnyDeskConnection) -> Result<bool, String> {
    match connection.child.try_wait() {
        Ok(None) => Ok(true),
        Ok(Some(_)) => Ok(false),
        Err(error) => Err(format!(
            "Failed to inspect the AnyDesk launcher process: {error}"
        )),
    }
}

impl AnyDeskService {
    pub fn new() -> AnyDeskServiceState {
        Arc::new(Mutex::new(Self {
            connections: HashMap::new(),
        }))
    }

    pub async fn launch_anydesk(
        &mut self,
        anydesk_id: String,
        mut password: Option<String>,
    ) -> Result<String, String> {
        let spec = match build_launch_spec(&anydesk_id, password.is_some()) {
            Ok(spec) => spec,
            Err(error) => {
                password.zeroize();
                return Err(error);
            }
        };
        let child = spawn_launcher(&spec, &mut password)?;
        let session_id = Uuid::new_v4().to_string();
        let session = AnyDeskSession {
            id: session_id.clone(),
            anydesk_id: anydesk_id.trim().to_string(),
            process_running: true,
            start_time: chrono::Utc::now(),
        };
        self.connections
            .insert(session_id.clone(), AnyDeskConnection { session, child });
        Ok(session_id)
    }

    pub async fn disconnect_anydesk(&mut self, session_id: &str) -> Result<(), String> {
        let Some(mut connection) = self.connections.remove(session_id) else {
            return Err("AnyDesk launcher session not found".to_string());
        };

        let disconnect_result = match connection.child.try_wait() {
            Ok(Some(_)) => Ok(()),
            Ok(None) => connection
                .child
                .kill()
                .map_err(|error| format!("Failed to stop the AnyDesk launcher process: {error}"))
                .and_then(|_| {
                    connection.child.wait().map(|_| ()).map_err(|error| {
                        format!("Failed to reap the AnyDesk launcher process: {error}")
                    })
                }),
            Err(error) => Err(format!(
                "Failed to inspect the AnyDesk launcher process: {error}"
            )),
        };

        if let Err(error) = disconnect_result {
            self.connections.insert(session_id.to_string(), connection);
            return Err(error);
        }

        Ok(())
    }

    pub fn get_anydesk_session(
        &mut self,
        session_id: &str,
    ) -> Result<Option<AnyDeskSession>, String> {
        let Some(connection) = self.connections.get_mut(session_id) else {
            return Ok(None);
        };
        if !launcher_is_running(connection)? {
            self.connections.remove(session_id);
            return Ok(None);
        }
        connection.session.process_running = true;
        Ok(Some(connection.session.clone()))
    }

    pub fn get_anydesk_sessions(&mut self) -> Result<Vec<AnyDeskSession>, String> {
        let session_ids: Vec<String> = self.connections.keys().cloned().collect();
        let mut sessions = Vec::with_capacity(session_ids.len());
        for session_id in session_ids {
            if let Some(session) = self.get_anydesk_session(&session_id)? {
                sessions.push(session);
            }
        }
        Ok(sessions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_is_never_present_in_argv_or_serialized_session_metadata() {
        let sentinel = "anydesk-password-sentinel";
        let spec = build_launch_spec("123456789", true).expect("launch spec");
        let argv = format!("{} {:?}", spec.program, spec.args);
        assert!(!argv.contains(sentinel));

        let session = AnyDeskSession {
            id: "session-1".to_string(),
            anydesk_id: "123456789".to_string(),
            process_running: true,
            start_time: chrono::Utc::now(),
        };
        let serialized = serde_json::to_string(&session).expect("serialize session");
        assert!(!serialized.contains(sentinel));

        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            assert!(spec.password_via_stdin);
            assert!(spec.args.iter().any(|arg| arg == "--with-password"));
        }
        #[cfg(target_os = "macos")]
        assert!(!spec.password_via_stdin);
    }

    #[test]
    fn rejects_option_like_and_control_character_targets() {
        for target in ["--with-password", "-target", "/option", "123\n456"] {
            assert!(build_launch_spec(target, false).is_err(), "{target:?}");
        }
    }

    #[test]
    fn native_url_target_is_percent_encoded_as_a_uri_component() {
        assert_eq!(
            percent_encode_uri_component("desk name@ad"),
            "desk%20name%40ad"
        );
        assert_eq!(percent_encode_uri_component("résumé"), "r%C3%A9sum%C3%A9");
    }

    #[test]
    fn spawn_errors_do_not_expose_and_do_zeroize_the_credential() {
        let sentinel = "anydesk-password-sentinel";
        let spec = AnyDeskLaunchSpec {
            program: "sortofremoteng-missing-anydesk-test-binary".to_string(),
            args: vec!["123456789".to_string(), "--with-password".to_string()],
            password_via_stdin: true,
        };
        let mut password = Some(sentinel.to_string());

        let error = spawn_launcher(&spec, &mut password).expect_err("launch must fail");
        let observable = format!("{spec:?} {error}");
        assert!(!observable.contains(sentinel));
        assert!(password.as_deref().unwrap_or_default().is_empty());
    }

    fn long_running_test_child() -> Child {
        #[cfg(target_os = "windows")]
        return Command::new("cmd")
            .args(["/C", "ping 127.0.0.1 -n 30 >NUL"])
            .spawn()
            .expect("spawn test child");

        #[cfg(not(target_os = "windows"))]
        return Command::new("sh")
            .args(["-c", "sleep 30"])
            .spawn()
            .expect("spawn test child");
    }

    #[tokio::test]
    async fn disconnect_terminates_reaps_and_forgets_the_tracked_launcher() {
        let child = long_running_test_child();
        let mut service = AnyDeskService {
            connections: HashMap::new(),
        };
        service.connections.insert(
            "tracked-1".to_string(),
            AnyDeskConnection {
                session: AnyDeskSession {
                    id: "tracked-1".to_string(),
                    anydesk_id: "123456789".to_string(),
                    process_running: true,
                    start_time: chrono::Utc::now(),
                },
                child,
            },
        );

        assert!(
            service
                .get_anydesk_session("tracked-1")
                .expect("inspect launcher")
                .expect("tracked session")
                .process_running
        );
        service
            .disconnect_anydesk("tracked-1")
            .await
            .expect("disconnect launcher");
        assert!(!service.connections.contains_key("tracked-1"));
    }
}

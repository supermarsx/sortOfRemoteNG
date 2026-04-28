use sorng_opkssh::login;
use sorng_opkssh::{OpksshBackendKind, OpksshLoginOptions, OpksshService};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex as AsyncMutex;

const FAKE_CLI_SOURCE: &str = r#"
use std::env;
use std::path::PathBuf;
use std::process;
use std::thread;
use std::time::Duration;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    if args.iter().any(|arg| arg == "--version") {
        println!("opkssh v9.9.9-test");
        return;
    }

    if args.first().map(String::as_str) == Some("login") {
        if let Some(delay_ms) = env::var("OPKSSH_FAKE_DELAY_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
        {
            thread::sleep(Duration::from_millis(delay_ms));
        }

        let key_path = env::var("OPKSSH_FAKE_KEY_PATH").unwrap_or_else(|_| {
            let home = env::var("HOME")
                .or_else(|_| env::var("USERPROFILE"))
                .unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home)
                .join(".ssh")
                .join("id_ecdsa")
                .to_string_lossy()
                .to_string()
        });
        let identity = env::var("OPKSSH_FAKE_IDENTITY")
            .unwrap_or_else(|_| "integration@example.com".to_string());

        println!("key written to {}", key_path);
        println!("authenticated identity {}", identity);
        eprintln!("callback handled by provider");

        let exit_code = env::var("OPKSSH_FAKE_EXIT_CODE")
            .ok()
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0);
        if exit_code != 0 {
            eprintln!("fake login failure");
            process::exit(exit_code);
        }

        return;
    }

    eprintln!("unsupported args: {:?}", args);
    process::exit(1);
}
"#;

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn fake_cli_path() -> PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let dir = unique_temp_dir("sorng-opkssh-fake-cli-callback");
        std::fs::create_dir_all(&dir).expect("create fake cli dir");

        let source_path = dir.join("fake_opkssh.rs");
        std::fs::write(&source_path, FAKE_CLI_SOURCE).expect("write fake cli source");

        let output_path = dir.join(if cfg!(windows) { "opkssh.exe" } else { "opkssh" });
        let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc"));
        let status = Command::new(rustc)
            .arg("--edition=2021")
            .arg(&source_path)
            .arg("-O")
            .arg("-o")
            .arg(&output_path)
            .status()
            .expect("compile fake opkssh helper");

        assert!(status.success(), "failed to compile fake opkssh helper");
        output_path
    })
    .clone()
}

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{}-{stamp}", std::process::id()))
}

struct EnvGuard {
    saved: Vec<(String, Option<OsString>)>,
}

impl EnvGuard {
    fn new() -> Self {
        Self { saved: Vec::new() }
    }

    fn set<K, V>(&mut self, key: K, value: V)
    where
        K: Into<String>,
        V: Into<OsString>,
    {
        let key = key.into();
        if !self.saved.iter().any(|(saved_key, _)| saved_key == &key) {
            self.saved.push((key.clone(), std::env::var_os(&key)));
        }
        std::env::set_var(&key, value.into());
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (key, value) in self.saved.drain(..).rev() {
            if let Some(value) = value {
                std::env::set_var(&key, value);
            } else {
                std::env::remove_var(&key);
            }
        }
    }
}

fn set_home_env(guard: &mut EnvGuard, home: &Path) {
    let home_value = home.as_os_str().to_os_string();
    guard.set("HOME", home_value.clone());
    guard.set("USERPROFILE", home_value.clone());

    #[cfg(windows)]
    {
        let home_text = home.to_string_lossy().replace('/', "\\");
        if home_text.len() >= 2 && home_text.as_bytes()[1] == b':' {
            guard.set("HOMEDRIVE", OsString::from(&home_text[..2]));
            guard.set("HOMEPATH", OsString::from(&home_text[2..]));
        }
    }
}

fn configure_fake_cli_env(home: &Path, key_path: &Path) -> EnvGuard {
    let fake_cli = fake_cli_path();
    let mut guard = EnvGuard::new();

    let mut paths = vec![
        fake_cli
            .parent()
            .expect("fake cli parent")
            .to_path_buf(),
    ];
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    let joined = std::env::join_paths(paths).expect("join PATH entries");
    guard.set("PATH", joined);

    std::fs::create_dir_all(home.join(".ssh")).expect("create test ssh dir");
    set_home_env(&mut guard, home);
    guard.set("SORNG_OPKSSH_BACKEND", OsString::from("cli"));
    guard.set("OPKSSH_FAKE_KEY_PATH", key_path.as_os_str().to_os_string());
    guard.set("OPKSSH_FAKE_IDENTITY", OsString::from("cancel@example.com"));
    guard.set("OPKSSH_FAKE_EXIT_CODE", OsString::from("0"));
    guard.set("OPKSSH_FAKE_DELAY_MS", OsString::from("750"));

    guard
}

#[tokio::test(flavor = "current_thread")]
async fn cancelling_a_login_operation_remains_local_and_keeps_callback_ownership_explicit() {
    let _env_lock = env_lock().lock().expect("env lock");
    let home = unique_temp_dir("sorng-opkssh-login-home-cancel");
    let key_path = home.join(".ssh").join("id_ecdsa-cancel");
    let _env = configure_fake_cli_env(&home, &key_path);

    let service_state = Arc::new(AsyncMutex::new(OpksshService::new()));
    let started = login::start_login_operation(service_state, OpksshLoginOptions::default())
        .await
        .expect("start login operation");

    assert_eq!(started.status, login::OpksshLoginOperationStatus::Running);
    assert!(started.can_cancel);
    assert!(started.browser_url.is_none());
    assert_eq!(started.runtime.active_backend, Some(OpksshBackendKind::Cli));
    assert!(started.runtime.library.provider_owns_callback_listener);
    assert!(started.runtime.library.provider_owns_callback_shutdown);

    tokio::task::yield_now().await;

    let cancelled = login::cancel_login_operation(&started.id)
        .await
        .expect("cancel login operation");
    assert_eq!(cancelled.status, login::OpksshLoginOperationStatus::Cancelled);
    assert!(!cancelled.can_cancel);
    assert!(cancelled.finished_at.is_some());
    assert!(cancelled.result.is_none());
    assert!(cancelled
        .message
        .as_deref()
        .is_some_and(|message| message.contains("provider-owned")));
    assert!(cancelled.browser_url.is_none());

    let cached = login::get_login_operation(&started.id)
        .await
        .expect("get cached login operation")
        .expect("cached login operation present");
    assert_eq!(cached.status, login::OpksshLoginOperationStatus::Cancelled);
    assert!(cached.runtime.library.provider_owns_callback_listener);
    assert!(cached.runtime.library.provider_owns_callback_shutdown);

    let awaited = login::await_login_operation(&started.id)
        .await
        .expect("await cancelled login operation");
    assert_eq!(awaited.status, login::OpksshLoginOperationStatus::Cancelled);
    assert!(awaited.result.is_none());
    assert!(awaited.browser_url.is_none());
}
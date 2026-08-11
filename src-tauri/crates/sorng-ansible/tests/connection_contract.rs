use chrono::Utc;
use sorng_ansible::error::AnsibleErrorKind;
use sorng_ansible::service::AnsibleService;
use sorng_ansible::types::AnsibleConnectionConfig;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

struct FixtureDir {
    path: PathBuf,
}

impl FixtureDir {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("sorng-ansible-contract-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).expect("create fixture directory");
        Self { path }
    }

    fn program(&self, name: &str, body: &str) -> PathBuf {
        #[cfg(windows)]
        let path = self.path.join(format!("{name}.cmd"));
        #[cfg(not(windows))]
        let path = self.path.join(name);

        #[cfg(windows)]
        let contents = format!("@echo off\r\n{body}\r\n");
        #[cfg(not(windows))]
        let contents = format!("#!/bin/sh\n{body}\n");
        std::fs::write(&path, contents).expect("write fixture program");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .expect("make fixture executable");
        }
        path
    }
}

impl Drop for FixtureDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn config(program: &Path, working_directory: &Path, timeout: u64) -> AnsibleConnectionConfig {
    let now = Utc::now();
    let binary = program.to_string_lossy().to_string();
    AnsibleConnectionConfig {
        id: "fixture".into(),
        name: "Fixture Ansible".into(),
        ansible_bin_path: Some(binary.clone()),
        ansible_playbook_bin_path: Some(binary.clone()),
        ansible_vault_bin_path: Some(binary.clone()),
        ansible_galaxy_bin_path: Some(binary),
        working_directory: Some(working_directory.to_string_lossy().to_string()),
        config_path: None,
        default_inventory: None,
        remote_user: None,
        private_key_path: None,
        ssh_common_args: None,
        env_vars: HashMap::new(),
        command_timeout_secs: timeout,
        vault_password_file: None,
        ask_vault_pass: false,
        verbosity: 0,
        created_at: now,
        updated_at: now,
        labels: HashMap::new(),
    }
}

#[tokio::test]
async fn connect_and_info_require_successful_version_process_and_cleanup_map() {
    let fixture = FixtureDir::new();
    let program = fixture.program(
        "ansible-success",
        "echo ansible [core 2.16.3]\necho python version = 3.12.1",
    );
    let mut service = AnsibleService::new();

    let info = service
        .connect("ansible".into(), config(&program, &fixture.path, 2))
        .await
        .expect("connect succeeds");
    assert_eq!(info.version, "2.16.3");
    assert_eq!(info.python_version, "3.12.1");
    assert_eq!(service.list_connections(), vec!["ansible"]);
    let duplicate = service
        .connect("ansible".into(), config(&program, &fixture.path, 2))
        .await
        .expect_err("duplicate id must not replace the live client");
    assert!(duplicate.to_string().contains("already exists"));

    let refreshed = service.get_info("ansible").await.expect("info succeeds");
    assert_eq!(refreshed.version, info.version);
    service
        .disconnect("ansible")
        .expect("disconnect removes client");
    assert!(service.list_connections().is_empty());
}

#[tokio::test]
async fn nonzero_version_probe_fails_without_map_insertion() {
    let fixture = FixtureDir::new();
    #[cfg(windows)]
    let program = fixture.program(
        "ansible-failure",
        "echo ansible [core 2.16.3]\necho version probe failed 1>&2\nexit /b 7",
    );
    #[cfg(not(windows))]
    let program = fixture.program(
        "ansible-failure-unix",
        "echo 'ansible [core 2.16.3]'\necho 'version probe failed' >&2\nexit 7",
    );
    let mut service = AnsibleService::new();

    let error = service
        .connect("ansible".into(), config(&program, &fixture.path, 2))
        .await
        .expect_err("non-zero version probe must fail connect");
    assert_eq!(error.kind, AnsibleErrorKind::ProcessError);
    assert!(error.message.contains("exit code 7"));
    assert!(error.details.is_none());
    assert!(!error.to_string().contains("probe failed"));
    assert!(service.list_connections().is_empty());
}

#[tokio::test]
async fn version_probe_timeout_fails_without_map_insertion() {
    let fixture = FixtureDir::new();
    #[cfg(windows)]
    let program = fixture.program("ansible-timeout", "ping 127.0.0.1 -n 4 >nul");
    #[cfg(not(windows))]
    let program = fixture.program("ansible-timeout", "sleep 3");
    let mut service = AnsibleService::new();

    let error = service
        .connect("ansible".into(), config(&program, &fixture.path, 1))
        .await
        .expect_err("timed out version probe must fail connect");
    assert_eq!(error.kind, AnsibleErrorKind::Timeout);
    assert!(service.list_connections().is_empty());
}

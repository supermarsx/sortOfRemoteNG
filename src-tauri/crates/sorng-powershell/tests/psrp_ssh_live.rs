#![cfg(feature = "psrp-ssh-e2e")]

use std::time::Duration;

use psrp_rs::{Pipeline, PipelineState, PsValue, PsrpError, RunspacePool};
use sorng_powershell::strict_ssh::{
    PsrpEventKind, SshHostKeyPolicy, StrictSshAuth, StrictSshPsrpConfig, StrictSshPsrpTransport,
};
use tokio_util::sync::CancellationToken;

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} must be set by the live fixture"))
}

fn config() -> StrictSshPsrpConfig {
    StrictSshPsrpConfig {
        host: env("PSRP_SSH_TEST_HOST"),
        port: env("PSRP_SSH_TEST_PORT").parse().unwrap(),
        username: env("PSRP_SSH_TEST_USER"),
        auth: StrictSshAuth::Password(env("PSRP_SSH_TEST_PASSWORD")),
        subsystem: "powershell".into(),
        host_key_policy: SshHostKeyPolicy::PinnedSha256(env("PSRP_SSH_TEST_FINGERPRINT")),
        connect_timeout: Duration::from_secs(5),
        request_timeout: Duration::from_secs(5),
        event_capacity: 256,
    }
}

fn output_strings(values: &[PsValue]) -> Vec<&str> {
    values.iter().filter_map(PsValue::as_str).collect()
}

#[tokio::test]
#[ignore = "requires the deterministic PowerShell 7 SSH Docker fixture"]
async fn strict_psrp_ssh_live_contract() {
    let mut wrong_key = config();
    wrong_key.host_key_policy = SshHostKeyPolicy::PinnedSha256("SHA256:not-the-key".into());
    let wrong_key_error = StrictSshPsrpTransport::connect(wrong_key)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        wrong_key_error.contains("host key rejected"),
        "unexpected wrong-key error: {wrong_key_error}"
    );

    let mut wrong_subsystem = config();
    wrong_subsystem.subsystem = "missing-powershell".into();
    let wrong_subsystem_error = StrictSshPsrpTransport::connect(wrong_subsystem)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        wrong_subsystem_error.contains("rejected subsystem"),
        "unexpected wrong-subsystem error: {wrong_subsystem_error}"
    );

    let transport = StrictSshPsrpTransport::connect(config()).await.unwrap();
    let events = transport.event_log();
    let mut pool = tokio::time::timeout(
        Duration::from_secs(10),
        RunspacePool::open_with_transport(transport),
    )
    .await
    .expect("runspace open timed out")
    .expect("runspace open failed");

    let first = pool
        .run_script("$global:SorngState = 'persisted'; Set-Location -LiteralPath /tmp; 'set'")
        .await
        .unwrap();
    assert_eq!(output_strings(&first), vec!["set"]);

    let second = pool
        .run_script("\"$global:SorngState|$((Get-Location).Path)\"")
        .await
        .unwrap();
    assert_eq!(output_strings(&second), vec!["persisted|/tmp"]);

    let streams = Pipeline::new(
        r#"
        $VerbosePreference = 'Continue'
        $DebugPreference = 'Continue'
        $InformationPreference = 'Continue'
        Write-Output 'output-marker'
        Write-Error 'error-marker' -ErrorAction Continue
        Write-Warning 'warning-marker'
        Write-Verbose 'verbose-marker'
        Write-Debug 'debug-marker'
        Write-Information 'information-marker'
        Write-Progress -Activity 'progress-marker' -Status 'running' -PercentComplete 50
        "#,
    )
    .run_all_streams(&mut pool)
    .await
    .unwrap();
    assert_eq!(streams.state, PipelineState::Completed);
    assert!(output_strings(&streams.output).contains(&"output-marker"));
    assert!(!streams.errors.is_empty());
    assert!(!streams.warnings.is_empty());
    assert!(!streams.verbose.is_empty());
    assert!(!streams.debug.is_empty());
    assert!(!streams.information.is_empty());
    assert!(!streams.progress.is_empty());

    let replay = events.replay_after(None);
    assert!(replay.events.len() <= 256);
    assert!(replay
        .events
        .windows(2)
        .all(|pair| pair[0].sequence < pair[1].sequence));
    for kind in [
        PsrpEventKind::Output,
        PsrpEventKind::Error,
        PsrpEventKind::Warning,
        PsrpEventKind::Verbose,
        PsrpEventKind::Debug,
        PsrpEventKind::Information,
        PsrpEventKind::Progress,
        PsrpEventKind::PipelineState,
    ] {
        assert!(
            replay.events.iter().any(|event| event.kind == kind),
            "missing replay event kind {kind:?}"
        );
    }

    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        trigger.cancel();
    });
    let cancelled = tokio::time::timeout(
        Duration::from_secs(8),
        Pipeline::new("while ($true) { Start-Sleep -Milliseconds 100 }")
            .run_all_streams_with_cancel(&mut pool, cancel),
    )
    .await
    .expect("cancelled pipeline did not stop within the bound")
    .unwrap_err();
    assert!(matches!(cancelled, PsrpError::Cancelled));

    let after_cancel = pool.run_script("'after-cancel'").await.unwrap();
    assert_eq!(output_strings(&after_cancel), vec!["after-cancel"]);

    tokio::time::timeout(Duration::from_secs(5), pool.close())
        .await
        .expect("clean close timed out")
        .expect("clean close failed");
}

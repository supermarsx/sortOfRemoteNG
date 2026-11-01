//! Real tracing subscriber -> bounded bridge -> policy-aware filesystem sink.
//! One test owns the process-local bridge; all paths and keys are fixtures.
use sorng_encryption::{
    artifact_policy::{self, ProtectionMode},
    log_adapter, ArtifactKind, EncryptionState, MasterDek,
};
use std::{
    path::Path,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tracing_subscriber::prelude::*;

async fn wait_for(mut predicate: impl FnMut() -> bool) {
    for _ in 0..200 {
        if predicate() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert!(
        predicate(),
        "log bridge did not persist within its bounded flush interval"
    );
}

fn matching_file(root: &Path, suffix: &str) -> Option<std::path::PathBuf> {
    std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .ends_with(suffix)
        })
}

#[tokio::test]
async fn tracing_bridge_persists_redacted_policy_output_and_pauses_without_losing_new_events() {
    let tmp = tempfile::tempdir().unwrap();
    let logs = tmp.path().join("logs");
    std::fs::create_dir(&logs).unwrap();
    let state = Arc::new(EncryptionState::new());
    state.install(MasterDek::generate()).await;
    artifact_policy::initialize(&state, tmp.path()).await;
    let subscriber = tracing_subscriber::registry().with(
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .with_writer(log_adapter::tracing_writer),
    );
    // Match production: initialize tracing before attaching the encrypted
    // writer. try_init must also install the log facade bridge; a scoped
    // Dispatch alone cannot detect a missing tracing-log feature.
    subscriber.try_init().unwrap();
    log_adapter::EncryptedLogAdapter::install_tracing_bridge(
        state.clone(),
        logs.clone(),
        log::LevelFilter::Info,
    )
    .unwrap();
    tracing::info!("bridge fixture Bearer abcdef1234567890");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    // Same closed field vocabulary as the native SSH establishment producer;
    // endpoint/address values are synthetic privacy-safe fixture hashes.
    log::info!(target: "ssh::establishment", "SSH establishment observed: timestampUnixMs={timestamp} attempt=41 caller=native-browser route=direct target=11111111111111111111111111111111 endpoint=11111111111111111111111111111111 policy=auto phase=connect outcome=connected candidate=0 address=22222222222222222222222222222222 family=ipv4 candidates=0 ipv4=0 ipv6=0 elapsedMs=1 overallMs=2 budgetMs=15000");
    log::info!(target: "ssh::establishment", "SSH facade redaction fixture Bearer ssh-fixture-secret");
    wait_for(|| matching_file(&logs, ".log.enc").is_some()).await;
    let encrypted = matching_file(&logs, ".log.enc").unwrap();
    let first = std::fs::read(&encrypted).unwrap();
    let plain = sorng_encryption::artifacts::logs::read(&state, &first)
        .await
        .unwrap();
    let text = String::from_utf8(plain).unwrap();
    assert!(text.contains("bridge fixture"));
    assert!(text.contains("[REDACTED:bearer-token]"));
    assert!(!text.contains("abcdef1234567890"));
    assert!(text.contains("ssh::establishment"));
    assert_eq!(text.matches("SSH establishment observed:").count(), 1);
    assert!(!text.contains("ssh-fixture-secret"));

    log_adapter::pause_for_artifact_preview("old", Duration::from_secs(30));
    log_adapter::pause_for_artifact_preview("current", Duration::from_secs(30));
    log_adapter::release_artifact_preview("old");
    tracing::info!("held during preview");
    tokio::time::sleep(Duration::from_millis(2100)).await;
    assert_eq!(std::fs::read(&encrypted).unwrap(), first);
    log_adapter::release_artifact_preview("current");
    wait_for(|| std::fs::metadata(&encrypted).unwrap().len() > first.len() as u64).await;

    // Native off is authoritative even with an unlocked master key.
    {
        let _guard = sorng_encryption::settings_coordinator::lock().await;
        let policy = state
            .artifact_policy_document()
            .unwrap()
            .with_mode(ArtifactKind::Logs, ProtectionMode::Plaintext)
            .unwrap();
        std::fs::write(
            tmp.path().join(artifact_policy::POLICY_FILENAME),
            artifact_policy::encode(&state, &policy).await.unwrap(),
        )
        .unwrap();
        artifact_policy::refresh(&state).await;
    }
    tracing::info!("plaintext fixture Bearer abcdef1234567890");
    log::info!(target: "ssh::establishment", "SSH plaintext transport fixture password=secret-fixture-password");
    wait_for(|| matching_file(&logs, ".log").is_some()).await;
    let plaintext_path = matching_file(&logs, ".log").unwrap();
    let bytes = std::fs::read(&plaintext_path).unwrap();
    let text = String::from_utf8(bytes.clone()).unwrap();
    assert!(text.contains("plaintext fixture"));
    assert!(!text.contains("abcdef1234567890"));
    assert!(text.contains("SSH plaintext transport fixture"));
    assert!(text.contains("[REDACTED:password]"));
    assert!(!text.contains("secret-fixture-password"));
    state.lock().await;
    tracing::info!("held while locked");
    tokio::time::sleep(Duration::from_millis(2100)).await;
    assert_eq!(std::fs::read(&plaintext_path).unwrap(), bytes);
    log_adapter::release_all_artifact_previews();
}

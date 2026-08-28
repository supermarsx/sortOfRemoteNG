//! Retained key ring — the last N master DEKs, kept behind the current one.
//!
//! # Why this exists
//!
//! Master-key rotation re-encrypts every artifact from the old DEK to the
//! new one. That walk is only as complete as the list of places the
//! orchestrator knows about, and history shows the list can be wrong: the
//! `databases/**` family was missing from it entirely, so a "successful"
//! rotation left every connection database wrapped under a DEK that no
//! longer existed anywhere. The data was intact, the key was gone, and
//! there was no way back.
//!
//! The key ring closes that class of failure structurally rather than by
//! enumeration. On every rotation the *outgoing* DEK is pushed onto a
//! bounded ring which is itself encrypted under the *incoming* DEK. A
//! decrypt that fails under the current key can then retry under each
//! retained key, so an artifact a rotation forgot still opens instead of
//! becoming unreadable ciphertext.
//!
//! ```text
//!   dek-ring.enc = SORNG v2 envelope
//!                  ├ key: HKDF(master_N, "sorng-v1::key-ring")
//!                  └ payload: {"version":1,"keys":[
//!                        {"retiredAtUnix": …, "dek": base64(master_N-1)},
//!                        {"retiredAtUnix": …, "dek": base64(master_N-2)},
//!                        …                        up to KEY_RING_CAPACITY
//!                    ]}
//! ```
//!
//! Newest-first. Retiring a key beyond [`KEY_RING_CAPACITY`] evicts the
//! oldest entry, so the window is strictly bounded and a key older than
//! the window is genuinely unrecoverable — that is the intended limit,
//! not a bug.
//!
//! # Security trade-off (deliberate, user-directed)
//!
//! Retaining old DEKs weakens forward secrecy: an attacker who obtains the
//! *current* master key also obtains the previous five, and can therefore
//! read any old ciphertext they have a copy of (an old backup, a
//! filesystem snapshot) that rotation was supposed to have made
//! unreadable. The window is bounded at five rotations for exactly that
//! reason.
//!
//! The user chose this explicitly, trading a bounded amount of forward
//! secrecy for availability. For a connection manager that is a
//! defensible call: the realistic threat is "I rotated my key and lost my
//! entire connection library", not "an attacker exfiltrated my superseded
//! ciphertext and is waiting for a future key compromise". Both keys live
//! at the same trust level anyway — the ring is encrypted under the
//! current master, which is itself in the OS keychain, so the ring adds no
//! new place for key material to leak from.
//!
//! **The ring is defence in depth, never a licence to skip artifacts.**
//! Rotation must still walk every artifact family. The ring exists to make
//! the *next* omission survivable, not to excuse a known one.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::dek::{ArtifactKind, MasterDek, KEY_LEN};
use crate::envelope::{self, EnvelopeError, EnvelopeHeader, NONCE_LEN};
use crate::state::EncryptionState;

/// File name of the ring, relative to the app data dir.
pub const KEY_RING_FILENAME: &str = "dek-ring.enc";

/// How many superseded DEKs the ring retains. Rotating a sixth time
/// evicts the oldest. Chosen by the user: enough to cover a realistic
/// run of rotations, small enough to keep the forward-secrecy loss
/// bounded.
pub const KEY_RING_CAPACITY: usize = 5;

/// On-disk payload schema version. Bump only for an incompatible change;
/// readers refuse an unknown version rather than guessing.
pub const KEY_RING_FORMAT_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum KeyRingError {
    #[error("encryption is locked; the key ring cannot be read or written")]
    Locked,
    #[error("key ring i/o: {0}")]
    Io(String),
    #[error("key ring envelope: {0}")]
    Envelope(#[from] EnvelopeError),
    #[error("key ring format: {0}")]
    Format(String),
}

// ── On-disk representation ────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct RingFile {
    version: u32,
    keys: Vec<RingEntry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RingEntry {
    /// Seconds since the Unix epoch at which this key was superseded.
    /// Informational only — eviction is by position, never by age.
    retired_at_unix: u64,
    /// Base64 of the 32-byte superseded master DEK.
    dek: String,
}

// ── In-memory representation ──────────────────────────────────────

/// One superseded master DEK. The bytes are zeroized on drop and never
/// appear in `Debug` output.
pub struct RetiredKey {
    retired_at_unix: u64,
    bytes: Zeroizing<[u8; KEY_LEN]>,
}

impl RetiredKey {
    /// When this key was superseded (seconds since the Unix epoch).
    pub fn retired_at_unix(&self) -> u64 {
        self.retired_at_unix
    }

    /// Materialise this entry as a `MasterDek` so sub-keys can be derived
    /// from it. The returned DEK zeroizes on drop.
    pub fn as_master_dek(&self) -> Option<MasterDek> {
        MasterDek::from_bytes(self.bytes.as_ref())
    }
}

impl std::fmt::Debug for RetiredKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RetiredKey")
            .field("retired_at_unix", &self.retired_at_unix)
            .field("dek", &"<redacted>")
            .finish()
    }
}

/// A bounded, newest-first ring of superseded master DEKs.
#[derive(Debug, Default)]
pub struct RetiredKeyRing {
    keys: Vec<RetiredKey>,
}

impl RetiredKeyRing {
    /// A ring holding nothing. What a profile that has never rotated has.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Number of retained keys. Never exceeds [`KEY_RING_CAPACITY`].
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// Newest-first view of the retained keys.
    pub fn keys(&self) -> &[RetiredKey] {
        &self.keys
    }

    /// Push a newly-superseded DEK onto the front and evict past the
    /// capacity.
    ///
    /// Re-retiring a key already in the ring moves it to the front rather
    /// than storing it twice — otherwise a rotate-to-the-same-key sequence
    /// (or a retried rotation) would flush useful keys out of the window
    /// with duplicates.
    pub fn retire(&mut self, dek_bytes: &[u8; KEY_LEN], retired_at_unix: u64) {
        self.keys
            .retain(|existing| existing.bytes.as_ref() != dek_bytes);
        self.keys.insert(
            0,
            RetiredKey {
                retired_at_unix,
                bytes: Zeroizing::new(*dek_bytes),
            },
        );
        self.keys.truncate(KEY_RING_CAPACITY);
    }

    /// Try every retained key, newest first, against an envelope for
    /// `artifact`. Returns the plaintext from the first key that
    /// authenticates, plus that key's position in the ring (0 = the most
    /// recently superseded key).
    pub fn try_open(
        &self,
        artifact: ArtifactKind,
        envelope_bytes: &[u8],
    ) -> Option<(Vec<u8>, usize)> {
        for (position, retired) in self.keys.iter().enumerate() {
            let Some(dek) = retired.as_master_dek() else {
                continue;
            };
            let sub_key = dek.sub_key(artifact);
            if let Ok((_header, plaintext)) = envelope::read_envelope(&sub_key, envelope_bytes) {
                return Some((plaintext, position));
            }
        }
        None
    }
}

/// Wall-clock "now" in seconds since the Unix epoch, saturating at 0 if
/// the host clock is before the epoch. Timestamps here are informational,
/// so a wrong clock must never fail a rotation.
pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `<app_data>/dek-ring.enc`.
pub fn ring_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(KEY_RING_FILENAME)
}

/// Encrypt a ring under `state`'s `KeyRing` sub-key. The result is a bare
/// SORNG v2 envelope, ready to write to [`ring_path`].
///
/// The DEK bytes only ever reach disk inside this envelope; there is no
/// code path that writes a plaintext ring.
pub async fn encode(
    state: &EncryptionState,
    ring: &RetiredKeyRing,
) -> Result<Vec<u8>, KeyRingError> {
    let file = RingFile {
        version: KEY_RING_FORMAT_VERSION,
        keys: ring
            .keys
            .iter()
            .map(|k| RingEntry {
                retired_at_unix: k.retired_at_unix,
                dek: general_purpose::STANDARD.encode(k.bytes.as_ref()),
            })
            .collect(),
    };
    let plain =
        Zeroizing::new(serde_json::to_vec(&file).map_err(|e| KeyRingError::Format(e.to_string()))?);

    let sub_key = state
        .sub_key(ArtifactKind::KeyRing)
        .await
        .ok_or(KeyRingError::Locked)?;
    let mut nonce = [0u8; NONCE_LEN];
    {
        use rand::rngs::OsRng;
        use rand::RngCore;
        OsRng.fill_bytes(&mut nonce);
    }
    let header = EnvelopeHeader::new_vault(nonce);
    Ok(envelope::write_envelope(&sub_key, &header, &plain)?)
}

/// Decrypt a ring produced by [`encode`] under `state`'s `KeyRing`
/// sub-key.
pub async fn decode(state: &EncryptionState, bytes: &[u8]) -> Result<RetiredKeyRing, KeyRingError> {
    let sub_key = state
        .sub_key(ArtifactKind::KeyRing)
        .await
        .ok_or(KeyRingError::Locked)?;
    let (_header, plain) = envelope::read_envelope(&sub_key, bytes)?;
    let plain = Zeroizing::new(plain);
    let file: RingFile =
        serde_json::from_slice(&plain).map_err(|e| KeyRingError::Format(e.to_string()))?;
    if file.version != KEY_RING_FORMAT_VERSION {
        return Err(KeyRingError::Format(format!(
            "unsupported key ring version {} (this build understands {KEY_RING_FORMAT_VERSION})",
            file.version
        )));
    }

    let mut keys = Vec::with_capacity(file.keys.len());
    for entry in file.keys {
        let raw = general_purpose::STANDARD
            .decode(entry.dek.as_bytes())
            .map_err(|e| KeyRingError::Format(format!("retired key base64: {e}")))?;
        let mut raw = Zeroizing::new(raw);
        if raw.len() != KEY_LEN {
            return Err(KeyRingError::Format(format!(
                "retired key is {} bytes, expected {KEY_LEN}",
                raw.len()
            )));
        }
        let mut bytes = Zeroizing::new([0u8; KEY_LEN]);
        bytes.copy_from_slice(&raw);
        raw.iter_mut().for_each(|b| *b = 0);
        keys.push(RetiredKey {
            retired_at_unix: entry.retired_at_unix,
            bytes,
        });
    }
    // Defensive: an on-disk ring longer than the capacity (hand-edited, or
    // written by a future build with a larger window) is truncated to this
    // build's window rather than honoured.
    keys.truncate(KEY_RING_CAPACITY);
    Ok(RetiredKeyRing { keys })
}

/// Read the ring at `path`. A missing file is not an error — a profile
/// that has never rotated simply has no retired keys.
pub async fn load(path: &Path, state: &EncryptionState) -> Result<RetiredKeyRing, KeyRingError> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RetiredKeyRing::empty())
        }
        Err(error) => return Err(KeyRingError::Io(error.to_string())),
    };
    decode(state, &bytes).await
}

// ── Process-wide location, so decrypt seams need no plumbing ──────
//
// Every artifact read path that wants the ring fallback would otherwise
// have to thread an `app_data_dir` down from its Tauri command. Recording
// the directory once at startup keeps the fallback a one-line call at each
// seam. Deliberately *not* a cache of the keys themselves: the ring is
// read from disk only on the (rare) failure path, so superseded plaintext
// DEKs never sit in process memory for the life of the app.

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Record the app data dir once, at startup. Later calls are ignored, so
/// this is safe to call from more than one place.
pub fn set_app_data_dir(dir: PathBuf) {
    let _ = APP_DATA_DIR.set(dir);
}

/// The recorded app data dir, if [`set_app_data_dir`] has run.
pub fn app_data_dir() -> Option<&'static PathBuf> {
    APP_DATA_DIR.get()
}

/// Last-resort decrypt for an artifact the current key cannot open.
///
/// Reads the ring from disk (cheap: a few hundred bytes, and only after a
/// decrypt has already failed) and tries each retained key newest-first.
/// Returns `None` when there is no recorded app data dir, no ring, the
/// state is locked, or no retained key authenticates — every one of which
/// the caller should surface as the original decrypt failure.
///
/// **Convergence:** a file opened this way is not rewritten here. Read
/// paths must stay read-only — rewriting during a read would rotate the
/// SDBF `.bak` ladder underneath a concurrent rotation and could destroy
/// the very generation the ring just rescued. Convergence happens on the
/// next ordinary save instead, which always encrypts under the current
/// key.
pub async fn try_decrypt_retired(
    state: &EncryptionState,
    artifact: ArtifactKind,
    envelope_bytes: &[u8],
) -> Option<Vec<u8>> {
    let dir = app_data_dir()?;
    let ring = load(&ring_path(dir), state).await.ok()?;
    ring.try_open(artifact, envelope_bytes)
        .map(|(plaintext, _position)| plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn dek_of(seed: u8) -> [u8; KEY_LEN] {
        [seed; KEY_LEN]
    }

    async fn state_with(seed: u8) -> EncryptionState {
        let state = EncryptionState::new();
        state
            .install(MasterDek::from_bytes(&dek_of(seed)).unwrap())
            .await;
        state
    }

    #[tokio::test]
    async fn round_trips_through_the_envelope() {
        let state = state_with(1).await;
        let mut ring = RetiredKeyRing::empty();
        ring.retire(&dek_of(2), 1_700_000_000);
        ring.retire(&dek_of(3), 1_700_000_001);

        let blob = encode(&state, &ring).await.unwrap();
        let back = decode(&state, &blob).await.unwrap();

        assert_eq!(back.len(), 2);
        // Newest first.
        assert_eq!(back.keys()[0].retired_at_unix(), 1_700_000_001);
        assert_eq!(back.keys()[1].retired_at_unix(), 1_700_000_000);
    }

    #[tokio::test]
    async fn ring_bytes_on_disk_are_an_envelope_and_never_plaintext_keys() {
        let state = state_with(9).await;
        let mut ring = RetiredKeyRing::empty();
        ring.retire(&dek_of(0xAB), now_unix());
        let blob = encode(&state, &ring).await.unwrap();

        assert_eq!(&blob[..envelope::MAGIC.len()], envelope::MAGIC);
        // The raw key must not appear anywhere in the file, nor its base64.
        let needle = [0xABu8; KEY_LEN];
        assert!(
            !blob.windows(KEY_LEN).any(|w| w == needle),
            "raw retired DEK bytes leaked into the ring file"
        );
        let b64 = general_purpose::STANDARD.encode(needle);
        assert!(
            !String::from_utf8_lossy(&blob).contains(&b64),
            "base64 retired DEK leaked into the ring file"
        );
    }

    #[tokio::test]
    async fn ring_is_bounded_at_capacity_and_evicts_oldest() {
        let mut ring = RetiredKeyRing::empty();
        for seed in 1..=8u8 {
            ring.retire(&dek_of(seed), 1_700_000_000 + seed as u64);
        }
        assert_eq!(ring.len(), KEY_RING_CAPACITY);
        // Seeds 8,7,6,5,4 survive; 1..=3 were evicted.
        let surviving: Vec<u64> = ring.keys().iter().map(|k| k.retired_at_unix()).collect();
        assert_eq!(
            surviving,
            vec![
                1_700_000_008,
                1_700_000_007,
                1_700_000_006,
                1_700_000_005,
                1_700_000_004
            ]
        );
    }

    #[tokio::test]
    async fn retiring_a_key_already_present_moves_it_without_duplicating() {
        let mut ring = RetiredKeyRing::empty();
        ring.retire(&dek_of(1), 1);
        ring.retire(&dek_of(2), 2);
        ring.retire(&dek_of(1), 3);
        assert_eq!(ring.len(), 2);
        assert_eq!(ring.keys()[0].retired_at_unix(), 3);
    }

    #[tokio::test]
    async fn try_open_finds_a_key_inside_the_window_and_refuses_one_outside() {
        // An artifact encrypted under seed 1.
        let old = state_with(1).await;
        let sub_key = old.sub_key(ArtifactKind::Connections).await.unwrap();
        let sealed = envelope::write_envelope(
            &sub_key,
            &EnvelopeHeader::new_vault([7u8; NONCE_LEN]),
            b"payload",
        )
        .unwrap();

        let mut ring = RetiredKeyRing::empty();
        ring.retire(&dek_of(1), 1);
        assert_eq!(
            ring.try_open(ArtifactKind::Connections, &sealed)
                .map(|(p, _)| p),
            Some(b"payload".to_vec())
        );

        // Five more rotations push seed 1 out of the window.
        for seed in 10..15u8 {
            ring.retire(&dek_of(seed), seed as u64);
        }
        assert_eq!(ring.len(), KEY_RING_CAPACITY);
        assert!(
            ring.try_open(ArtifactKind::Connections, &sealed).is_none(),
            "a key older than the retention window must not open the artifact"
        );
    }

    #[tokio::test]
    async fn wrong_artifact_sub_key_does_not_authenticate() {
        let old = state_with(4).await;
        let sub_key = old.sub_key(ArtifactKind::Connections).await.unwrap();
        let sealed =
            envelope::write_envelope(&sub_key, &EnvelopeHeader::new_vault([1u8; NONCE_LEN]), b"x")
                .unwrap();
        let mut ring = RetiredKeyRing::empty();
        ring.retire(&dek_of(4), 1);
        assert!(ring.try_open(ArtifactKind::TrustStore, &sealed).is_none());
    }

    #[tokio::test]
    async fn missing_ring_file_loads_as_empty() {
        let dir = tempdir().unwrap();
        let state = state_with(5).await;
        let ring = load(&ring_path(dir.path()), &state).await.unwrap();
        assert!(ring.is_empty());
    }

    #[tokio::test]
    async fn a_ring_written_under_another_key_does_not_decode() {
        let a = state_with(6).await;
        let b = state_with(7).await;
        let mut ring = RetiredKeyRing::empty();
        ring.retire(&dek_of(1), 1);
        let blob = encode(&a, &ring).await.unwrap();
        assert!(decode(&b, &blob).await.is_err());
    }

    #[tokio::test]
    async fn locked_state_cannot_read_or_write_the_ring() {
        let locked = EncryptionState::new();
        assert!(matches!(
            encode(&locked, &RetiredKeyRing::empty()).await,
            Err(KeyRingError::Locked)
        ));
        assert!(matches!(
            decode(&locked, &[0u8; 64]).await,
            Err(KeyRingError::Locked)
        ));
    }
}

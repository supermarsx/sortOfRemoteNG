//! Phase 2b — chunked AEAD encryption for recording media files
//! (`.webm`, `.mp4`, `.gif`).
//!
//! Media files are usually tens to hundreds of megabytes, and the
//! player needs **random access** (seek to a timestamp, scrub
//! preview, fast-forward). Whole-file AEAD won't work — you'd have to
//! decrypt from byte 0 every time. Instead each file is split into
//! fixed-size **plaintext chunks** (default 64 KiB); each chunk is
//! independently AES-256-GCM-encrypted with a chunk-specific nonce
//! derived from a per-file random prefix plus the chunk index.
//!
//! ## Wire format
//!
//! ```text
//!  offset  size   description
//!  ──────  ────   ──────────────────────────────────────────────────────
//!   0       6     b"SORNG\0"               magic
//!   6       1     version                  u8, currently 2
//!   7       1     kind                     u8 = 2 ("chunked-stream")
//!   8       1     master_key_storage       same discriminant as envelope
//!   9       3     reserved                 zeros
//!  12       4     chunk_size               u32 LE plaintext bytes per chunk
//!  16       8     nonce_prefix             random per-file
//!  24       4     reserved                 zeros
//!  28       4     last_chunk_plain_len     u32 LE — useful for callers that
//!                                          want to know the true plaintext
//!                                          length of the trailing chunk
//!                                          without decrypting it. `0`
//!                                          means "trailing chunk is full
//!                                          chunk_size".
//!  32      ..     chunks                   length = ceil(plain_len / chunk_size)
//!                                          each chunk = chunk_size bytes ct +
//!                                                       16-byte GCM tag
//!                                          (last chunk's ct may be < chunk_size)
//! ```
//!
//! ## Nonce construction
//!
//! Each chunk's AEAD nonce is 12 bytes:
//!
//! ```text
//!  nonce[0..8]  = nonce_prefix   (per-file random; domain-separates files)
//!  nonce[8..12] = chunk_index_be (u32 big-endian; sequential within file)
//! ```
//!
//! Same plaintext written twice produces different ciphertext because
//! the nonce prefix is freshly randomised per write. Files written with
//! the same sub-key are immune to nonce reuse so long as no single file
//! has more than 2^32 chunks (4 billion × 64 KiB = 268 TiB per file —
//! comfortably above any conceivable recording size).
//!
//! ## Authenticated Additional Data
//!
//! Each chunk is AEAD-tagged with `aad = chunk_index_be` so a chunk
//! swap (move chunk 7's ciphertext to position 3) fails GCM
//! verification even though both chunks share the same key.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;

use crate::dek::{ArtifactKind, SubKey};
use crate::envelope::{MasterKeyStorage, MAGIC};
use crate::state::EncryptionState;

/// `kind` discriminant for chunked streams.
const KIND_CHUNKED_STREAM: u8 = 2;
const CURRENT_VERSION: u8 = 2;

/// Total preamble length on disk.
pub const HEADER_LEN: usize = 32;
/// AEAD nonce length (12 bytes = 96 bits per AES-256-GCM).
pub const NONCE_LEN: usize = 12;
/// AES-GCM tag length.
pub const TAG_LEN: usize = 16;
/// Default plaintext bytes per chunk. 64 KiB hits a sweet spot:
///   - small enough that decrypting one chunk is cheap (sub-ms),
///   - large enough that the 16-byte tag overhead is negligible
///     (0.024 % bloat),
///   - aligned with typical mux read sizes so playback doesn't need
///     to span chunk boundaries on most frames.
pub const DEFAULT_CHUNK_SIZE: u32 = 64 * 1024;

/// Errors raised by the chunked-media codec.
#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("encryption state is locked; unlock before reading or writing media")]
    Locked,
    #[error("media file is shorter than the {0}-byte header")]
    TruncatedHeader(usize),
    #[error("missing SORNG magic prefix")]
    MissingMagic,
    #[error("unsupported chunked-stream version: {0}")]
    UnsupportedVersion(u8),
    #[error("wrong kind discriminant {0}: expected chunked-stream (2)")]
    WrongKind(u8),
    #[error("unknown master-key-storage discriminant: {0}")]
    UnknownStorage(u8),
    #[error("chunk_size {0} is invalid (must be > 0 and ≤ 16 MiB)")]
    InvalidChunkSize(u32),
    #[error("chunk index {0} is past the end of the file")]
    OutOfRange(u64),
    #[error("chunk {chunk}: AES-256-GCM authentication failed")]
    AuthenticationFailed { chunk: u64 },
}

/// Header of a chunked media file. Decoded by [`decode_header`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaHeader {
    pub version: u8,
    pub master_key_storage: MasterKeyStorage,
    pub chunk_size: u32,
    pub nonce_prefix: [u8; 8],
    pub last_chunk_plain_len: u32,
}

impl MediaHeader {
    /// Build a fresh header for a write. `chunk_size` clamps to
    /// `DEFAULT_CHUNK_SIZE` if invalid; pass an explicit value only
    /// when you know what you're doing.
    pub fn new(mode: MasterKeyStorage, chunk_size: u32) -> Self {
        let mut prefix = [0u8; 8];
        OsRng.fill_bytes(&mut prefix);
        Self {
            version: CURRENT_VERSION,
            master_key_storage: mode,
            chunk_size: validate_chunk_size(chunk_size).unwrap_or(DEFAULT_CHUNK_SIZE),
            nonce_prefix: prefix,
            last_chunk_plain_len: 0,
        }
    }

    fn encode(&self) -> [u8; HEADER_LEN] {
        let mut out = [0u8; HEADER_LEN];
        out[0..6].copy_from_slice(MAGIC);
        out[6] = self.version;
        out[7] = KIND_CHUNKED_STREAM;
        out[8] = self.master_key_storage as u8;
        // 9..12 reserved
        out[12..16].copy_from_slice(&self.chunk_size.to_le_bytes());
        out[16..24].copy_from_slice(&self.nonce_prefix);
        // 24..28 reserved
        out[28..32].copy_from_slice(&self.last_chunk_plain_len.to_le_bytes());
        out
    }
}

fn validate_chunk_size(cs: u32) -> Result<u32, MediaError> {
    if cs == 0 || cs > 16 * 1024 * 1024 {
        return Err(MediaError::InvalidChunkSize(cs));
    }
    Ok(cs)
}

/// Decode a header from the first [`HEADER_LEN`] bytes. Does not touch
/// the chunked body — callers can then decrypt chunks independently.
pub fn decode_header(buf: &[u8]) -> Result<MediaHeader, MediaError> {
    if buf.len() < HEADER_LEN {
        return Err(MediaError::TruncatedHeader(HEADER_LEN));
    }
    if &buf[0..6] != MAGIC {
        return Err(MediaError::MissingMagic);
    }
    let version = buf[6];
    if version != CURRENT_VERSION {
        return Err(MediaError::UnsupportedVersion(version));
    }
    let kind = buf[7];
    if kind != KIND_CHUNKED_STREAM {
        return Err(MediaError::WrongKind(kind));
    }
    let storage =
        MasterKeyStorage::from_u8(buf[8]).ok_or(MediaError::UnknownStorage(buf[8]))?;
    let chunk_size = u32::from_le_bytes(buf[12..16].try_into().unwrap());
    validate_chunk_size(chunk_size)?;
    let mut nonce_prefix = [0u8; 8];
    nonce_prefix.copy_from_slice(&buf[16..24]);
    let last_chunk_plain_len = u32::from_le_bytes(buf[28..32].try_into().unwrap());
    Ok(MediaHeader {
        version,
        master_key_storage: storage,
        chunk_size,
        nonce_prefix,
        last_chunk_plain_len,
    })
}

/// Encrypt `plaintext` into a freshly-stamped chunked file.
///
/// Returns the full file bytes (header + every chunk). For very large
/// inputs the caller may prefer the streaming writer (Phase 2c, not
/// yet present); for one-shot writes — recordings shorter than a few
/// hundred MiB — this is the right entry point.
pub async fn write_one_shot(
    state: &EncryptionState,
    plaintext: &[u8],
    mode: MasterKeyStorage,
    chunk_size: Option<u32>,
) -> Result<Vec<u8>, MediaError> {
    let sub_key = state
        .sub_key(ArtifactKind::RecordingsMedia)
        .await
        .ok_or(MediaError::Locked)?;
    let chunk_size = validate_chunk_size(chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE))?;

    let mut header = MediaHeader::new(mode, chunk_size);
    // Stash the trailing chunk's plaintext length so readers can
    // recover it without decrypting first.
    let chunk_size_usize = chunk_size as usize;
    header.last_chunk_plain_len = if plaintext.is_empty() {
        0
    } else {
        (plaintext.len() % chunk_size_usize) as u32
    };

    let cipher = Aes256Gcm::new(sub_key.bytes().into());

    let mut out = Vec::with_capacity(
        HEADER_LEN
            + plaintext.len()
            + (plaintext.len().div_ceil(chunk_size_usize)) * TAG_LEN,
    );
    out.extend_from_slice(&header.encode());

    for (idx, chunk) in plaintext.chunks(chunk_size_usize).enumerate() {
        let nonce_bytes = chunk_nonce(&header.nonce_prefix, idx as u32);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let aad = chunk_aad(idx as u32);
        let ct = cipher
            .encrypt(
                nonce,
                Payload {
                    msg: chunk,
                    aad: &aad,
                },
            )
            .map_err(|_| MediaError::AuthenticationFailed { chunk: idx as u64 })?;
        out.extend_from_slice(&ct);
    }
    Ok(out)
}

/// Decrypt and concatenate every chunk. The mirror of [`write_one_shot`]
/// — used by playback paths that load the whole recording into memory
/// (small recordings, GIFs).
pub async fn read_all(
    state: &EncryptionState,
    file_bytes: &[u8],
) -> Result<Vec<u8>, MediaError> {
    let sub_key = state
        .sub_key(ArtifactKind::RecordingsMedia)
        .await
        .ok_or(MediaError::Locked)?;
    let header = decode_header(file_bytes)?;
    let cipher = Aes256Gcm::new(sub_key.bytes().into());

    let mut out = Vec::new();
    let body = &file_bytes[HEADER_LEN..];
    let stride = header.chunk_size as usize + TAG_LEN;
    let mut idx: u32 = 0;
    let mut pos = 0usize;
    while pos < body.len() {
        let end = (pos + stride).min(body.len());
        let nonce_bytes = chunk_nonce(&header.nonce_prefix, idx);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let aad = chunk_aad(idx);
        let pt = cipher
            .decrypt(
                nonce,
                Payload {
                    msg: &body[pos..end],
                    aad: &aad,
                },
            )
            .map_err(|_| MediaError::AuthenticationFailed { chunk: idx as u64 })?;
        out.extend_from_slice(&pt);
        pos = end;
        idx = idx
            .checked_add(1)
            .ok_or(MediaError::OutOfRange(u64::MAX))?;
    }
    Ok(out)
}

/// Decrypt just one chunk. Used by playback seekers — they compute
/// `chunk_index = byte_offset / chunk_size` and ask for that one chunk
/// without decrypting anything else.
pub async fn read_chunk(
    state: &EncryptionState,
    file_bytes: &[u8],
    chunk_index: u32,
) -> Result<Vec<u8>, MediaError> {
    let sub_key = state
        .sub_key(ArtifactKind::RecordingsMedia)
        .await
        .ok_or(MediaError::Locked)?;
    let header = decode_header(file_bytes)?;
    let stride = header.chunk_size as usize + TAG_LEN;
    let body = &file_bytes[HEADER_LEN..];
    let start = (chunk_index as usize) * stride;
    if start >= body.len() {
        return Err(MediaError::OutOfRange(chunk_index as u64));
    }
    let end = (start + stride).min(body.len());
    let cipher = Aes256Gcm::new(sub_key.bytes().into());
    let nonce_bytes = chunk_nonce(&header.nonce_prefix, chunk_index);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let aad = chunk_aad(chunk_index);
    cipher
        .decrypt(
            nonce,
            Payload {
                msg: &body[start..end],
                aad: &aad,
            },
        )
        .map_err(|_| MediaError::AuthenticationFailed {
            chunk: chunk_index as u64,
        })
}

/// Compute the AEAD nonce for chunk `i` of a file with the given prefix.
fn chunk_nonce(prefix: &[u8; 8], i: u32) -> [u8; NONCE_LEN] {
    let mut n = [0u8; NONCE_LEN];
    n[0..8].copy_from_slice(prefix);
    n[8..12].copy_from_slice(&i.to_be_bytes());
    n
}

/// AAD bound to each chunk. Defeats chunk-swap attacks — moving
/// chunk 7's ciphertext to position 3 changes the implicit AAD and
/// GCM verification fails on read.
fn chunk_aad(i: u32) -> [u8; 4] {
    i.to_be_bytes()
}

// Re-export SubKey marker so callers that want to wrap their own
// streaming writer can plug in.
#[allow(dead_code)]
type _SubKey = SubKey;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dek::MasterDek;

    fn pt(n: usize) -> Vec<u8> {
        // Deterministic, non-trivial test payload (not all zeros so a
        // bug like "skipped the encrypt step" surfaces immediately).
        (0..n).map(|i| (i % 251) as u8).collect()
    }

    #[tokio::test]
    async fn header_round_trip() {
        let h = MediaHeader::new(MasterKeyStorage::Vault, DEFAULT_CHUNK_SIZE);
        let bytes = h.encode();
        let parsed = decode_header(&bytes).unwrap();
        assert_eq!(parsed.version, CURRENT_VERSION);
        assert_eq!(parsed.master_key_storage, MasterKeyStorage::Vault);
        assert_eq!(parsed.chunk_size, DEFAULT_CHUNK_SIZE);
        assert_eq!(parsed.nonce_prefix, h.nonce_prefix);
    }

    #[tokio::test]
    async fn round_trip_short_payload() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let data = pt(1024);
        let blob =
            write_one_shot(&state, &data, MasterKeyStorage::Vault, Some(256))
                .await
                .unwrap();
        let recovered = read_all(&state, &blob).await.unwrap();
        assert_eq!(recovered, data);
    }

    #[tokio::test]
    async fn round_trip_exact_chunk_multiple() {
        // 4 chunks of 256 bytes each = 1024 total. No trailing-short
        // chunk; last_chunk_plain_len must be 0 to indicate "full".
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let data = pt(1024);
        let blob =
            write_one_shot(&state, &data, MasterKeyStorage::Vault, Some(256))
                .await
                .unwrap();
        let header = decode_header(&blob).unwrap();
        assert_eq!(header.last_chunk_plain_len, 0);
        let recovered = read_all(&state, &blob).await.unwrap();
        assert_eq!(recovered, data);
    }

    #[tokio::test]
    async fn round_trip_partial_trailing_chunk() {
        // 1025 bytes with 256-byte chunks ⇒ 4 full + 1 partial of 1
        // byte. last_chunk_plain_len must be 1.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let data = pt(1025);
        let blob =
            write_one_shot(&state, &data, MasterKeyStorage::Vault, Some(256))
                .await
                .unwrap();
        let header = decode_header(&blob).unwrap();
        assert_eq!(header.last_chunk_plain_len, 1);
        let recovered = read_all(&state, &blob).await.unwrap();
        assert_eq!(recovered, data);
    }

    #[tokio::test]
    async fn empty_payload_round_trip() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let blob = write_one_shot(&state, &[], MasterKeyStorage::Vault, None)
            .await
            .unwrap();
        // Header only, no chunks.
        assert_eq!(blob.len(), HEADER_LEN);
        let recovered = read_all(&state, &blob).await.unwrap();
        assert!(recovered.is_empty());
    }

    #[tokio::test]
    async fn read_chunk_random_access() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let chunk_size = 64u32;
        let data = pt(64 * 5 + 17); // 5 full chunks + 1 partial of 17 bytes
        let blob = write_one_shot(&state, &data, MasterKeyStorage::Vault, Some(chunk_size))
            .await
            .unwrap();

        // Reading chunk 0 gives bytes 0..64 of plaintext.
        let c0 = read_chunk(&state, &blob, 0).await.unwrap();
        assert_eq!(c0, &data[..64]);

        // Chunk 3 gives bytes 192..256.
        let c3 = read_chunk(&state, &blob, 3).await.unwrap();
        assert_eq!(c3, &data[192..256]);

        // Trailing chunk (index 5) gives the partial 17 bytes.
        let c5 = read_chunk(&state, &blob, 5).await.unwrap();
        assert_eq!(c5, &data[320..]);
        assert_eq!(c5.len(), 17);
    }

    #[tokio::test]
    async fn read_chunk_out_of_range() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let data = pt(100);
        let blob = write_one_shot(&state, &data, MasterKeyStorage::Vault, Some(64))
            .await
            .unwrap();
        // 100 bytes / 64 = 2 chunks. Index 2 is past the end.
        assert!(matches!(
            read_chunk(&state, &blob, 2).await,
            Err(MediaError::OutOfRange(2))
        ));
    }

    #[tokio::test]
    async fn chunk_swap_is_detected_via_aad() {
        // Swap the ciphertext of chunk 1 with chunk 0. The AAD
        // (chunk_index) baked into the GCM tag changes, so decryption
        // fails. Defeats reorder attacks.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let data = pt(256);
        let mut blob =
            write_one_shot(&state, &data, MasterKeyStorage::Vault, Some(64))
                .await
                .unwrap();
        let stride = 64 + TAG_LEN;
        // Swap chunk 0 (HEADER_LEN..HEADER_LEN+stride) with chunk 1.
        let mut buf0 = vec![0u8; stride];
        let mut buf1 = vec![0u8; stride];
        buf0.copy_from_slice(&blob[HEADER_LEN..HEADER_LEN + stride]);
        buf1.copy_from_slice(&blob[HEADER_LEN + stride..HEADER_LEN + 2 * stride]);
        blob[HEADER_LEN..HEADER_LEN + stride].copy_from_slice(&buf1);
        blob[HEADER_LEN + stride..HEADER_LEN + 2 * stride].copy_from_slice(&buf0);

        assert!(matches!(
            read_all(&state, &blob).await,
            Err(MediaError::AuthenticationFailed { chunk: 0 })
        ));
    }

    #[tokio::test]
    async fn body_tamper_is_detected() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let data = pt(200);
        let mut blob =
            write_one_shot(&state, &data, MasterKeyStorage::Vault, Some(64))
                .await
                .unwrap();
        // Flip a byte deep inside the second chunk.
        blob[HEADER_LEN + 64 + TAG_LEN + 5] ^= 0xFF;
        assert!(matches!(
            read_all(&state, &blob).await,
            Err(MediaError::AuthenticationFailed { chunk: 1 })
        ));
    }

    #[tokio::test]
    async fn locked_state_rejects_reads_and_writes() {
        let state = EncryptionState::new();
        let err = write_one_shot(&state, b"x", MasterKeyStorage::Vault, None)
            .await
            .unwrap_err();
        assert!(matches!(err, MediaError::Locked));
    }

    #[tokio::test]
    async fn invalid_chunk_size_rejected() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        assert!(matches!(
            write_one_shot(&state, b"x", MasterKeyStorage::Vault, Some(0)).await,
            Err(MediaError::InvalidChunkSize(0))
        ));
        assert!(matches!(
            write_one_shot(&state, b"x", MasterKeyStorage::Vault, Some(64 * 1024 * 1024))
                .await,
            Err(MediaError::InvalidChunkSize(_))
        ));
    }

    #[tokio::test]
    async fn missing_magic_is_rejected_separately_from_truncation() {
        let mut buf = [0u8; HEADER_LEN];
        assert!(matches!(decode_header(&buf), Err(MediaError::MissingMagic)));
        buf[0..6].copy_from_slice(MAGIC);
        buf[6] = 99;
        assert!(matches!(
            decode_header(&buf),
            Err(MediaError::UnsupportedVersion(99))
        ));
        buf[6] = CURRENT_VERSION;
        buf[7] = 0; // envelope kind, not media
        assert!(matches!(decode_header(&buf), Err(MediaError::WrongKind(0))));
        assert!(matches!(
            decode_header(&[1u8; 5]),
            Err(MediaError::TruncatedHeader(HEADER_LEN))
        ));
    }

    #[tokio::test]
    async fn nonce_prefix_differs_between_writes() {
        // Two writes of the same plaintext must use different nonce
        // prefixes, so their ciphertexts can't be byte-compared by an
        // attacker to learn anything.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let data = pt(512);
        let a = write_one_shot(&state, &data, MasterKeyStorage::Vault, None)
            .await
            .unwrap();
        let b = write_one_shot(&state, &data, MasterKeyStorage::Vault, None)
            .await
            .unwrap();
        assert_ne!(a, b);
        let ha = decode_header(&a).unwrap();
        let hb = decode_header(&b).unwrap();
        assert_ne!(ha.nonce_prefix, hb.nonce_prefix);
    }

    #[tokio::test]
    async fn cross_state_decryption_fails() {
        let s1 = EncryptionState::new();
        let s2 = EncryptionState::new();
        s1.install(MasterDek::generate()).await;
        s2.install(MasterDek::generate()).await;
        let data = pt(200);
        let blob = write_one_shot(&s1, &data, MasterKeyStorage::Vault, Some(64))
            .await
            .unwrap();
        assert!(matches!(
            read_all(&s2, &blob).await,
            Err(MediaError::AuthenticationFailed { .. })
        ));
    }

    #[tokio::test]
    async fn survives_process_restart_via_master_bytes() {
        // Recordings can be many minutes long — the encrypted media
        // file written before a restart must decode after one, given
        // only the persisted master bytes. This is the path a "resume
        // playback after reboot" flow exercises.
        let state_a = EncryptionState::new();
        state_a.install(MasterDek::generate()).await;
        let data = pt(5 * 1024); // multiple chunks at the default size
        let blob = write_one_shot(&state_a, &data, MasterKeyStorage::Vault, Some(1024))
            .await
            .unwrap();

        let saved_bytes = state_a.master_bytes_raw().await.unwrap();
        std::mem::drop(state_a);

        let state_b = EncryptionState::new();
        state_b
            .install(MasterDek::from_bytes(&saved_bytes).unwrap())
            .await;

        let recovered = read_all(&state_b, &blob).await.unwrap();
        assert_eq!(recovered, data);
    }

    #[tokio::test]
    async fn truncated_input_is_clean_error() {
        // Media's header is 32 bytes (not 64), so to actually exercise
        // the truncation branch — rather than the missing-magic branch
        // — we feed 16 bytes. The codec must surface a typed error
        // instead of panicking on the bounds check.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let buf = [0u8; 16];
        assert!(read_all(&state, &buf).await.is_err());
    }

    #[tokio::test]
    async fn valid_magic_garbage_body_fails_gcm_auth() {
        // A well-formed media header followed by random body bytes
        // must trip the AEAD auth-fail path, indexed at chunk 0 — the
        // very first chunk decryption sees the forged ciphertext.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let header = MediaHeader::new(MasterKeyStorage::Vault, DEFAULT_CHUNK_SIZE);
        let mut blob = header.encode().to_vec();
        // 256 bytes of garbage — enough to look like one short chunk
        // (240 bytes ct + 16-byte tag) under the default stride.
        blob.extend((0..256).map(|i| (i as u8).wrapping_mul(41)));
        assert!(matches!(
            read_all(&state, &blob).await,
            Err(MediaError::AuthenticationFailed { chunk: 0 })
        ));
    }

    #[tokio::test]
    async fn realistic_64kib_chunks_round_trip() {
        // The default chunk size. 1 MiB payload ⇒ 16 full chunks.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let data = pt(1024 * 1024);
        let blob = write_one_shot(&state, &data, MasterKeyStorage::Vault, None)
            .await
            .unwrap();
        let header = decode_header(&blob).unwrap();
        assert_eq!(header.chunk_size, DEFAULT_CHUNK_SIZE);
        let recovered = read_all(&state, &blob).await.unwrap();
        assert_eq!(recovered.len(), data.len());
        // Sample a few bytes to keep the assertion message readable.
        assert_eq!(recovered[0], data[0]);
        assert_eq!(recovered[123_456], data[123_456]);
        assert_eq!(recovered[recovered.len() - 1], data[data.len() - 1]);
    }
}

//! SoftEther session cipher setup (SE-4) — server-supplied RC4 key model.
//!
//! After [`auth::parse_auth_response`](super::auth::parse_auth_response)
//! returns an [`AuthResult`](super::auth::AuthResult), the **server has
//! shipped** the data-plane cipher key material. This is the real Cedar
//! model (the t4-e11b correction; the previous local-derivation code was
//! removed here):
//!
//! * `use_encrypt` / `use_fast_rc4` — whether a secondary (above-TLS)
//!   cipher layer is active and, if so, whether it is Fast-RC4
//!   (Cedar `Protocol.c:6010-6014`).
//! * `rc4_key_client_to_server` / `rc4_key_server_to_client` — two
//!   **16-byte random keys the server generated** (`GenerateRC4KeyPair`
//!   = `Rand(16)` per direction, `Protocol.c:8480-8490`) and sent in the
//!   Welcome PACK as DATA fields (`Protocol.c:4127-4128` server write,
//!   `:6086-6092` client read, validated `PackGetDataSize == 16`). These
//!   seed the per-direction RC4 streams **directly** — there is NO
//!   client-side MD5/SHA-0 key derivation.
//!
//! `session_key` (20B) / `session_key_32` (u32) from the Welcome PACK are
//! session **identifiers** only and are never used as cipher inputs.
//!
//! ## Cipher selection ([`build_v1_session_keys`])
//!
//! | Negotiated state | Cipher |
//! |---|---|
//! | `use_encrypt && use_fast_rc4` + 16-byte keys present | [`CipherState::Rc4`] seeded with the server's bytes |
//! | `use_encrypt && !use_fast_rc4` (TLS bulk cipher) | [`CipherState::Null`] — TLS carries confidentiality |
//! | `!use_encrypt` | [`CipherState::Null`] |
//! | Fast-RC4 advertised but keys absent/mis-sized | [`CipherState::Null`] (safe TLS-only fallback) |
//!
//! ## What was removed (and why)
//!
//! The old locally-fabricated derivation — `MD5(tag||server_random||
//! session_key)` RC4 keys, AES-256-CBC main-channel cipher, the
//! `TAG_C2S/S2C` direction tags, and `expand_session_key_32` — was
//! **wrong on the wire** against a `UseFastRC4=1` hub (it invented keys
//! the server never agreed to). Cedar derives nothing client-side; it
//! uses the server's random bytes. All of that fabrication code is gone.
//! There is no AES-CBC main-channel cipher in Cedar (TLS does bulk
//! confidentiality when Fast-RC4 is off), so [`CipherState::AesCbc`] was
//! removed too.
//!
//! ## Live validation (host-gated, P5)
//!
//! The byte-for-byte match of the seeded RC4 keystream against a live
//! hub's Fast-RC4 stream is exercised by the Docker e2e lane
//! (`--features vpn-softether,docker-e2e`), not here. The CI-hermetic
//! tests below pin: server-key → RC4-state mapping, RFC 6229 keystream
//! correctness, and the directional encrypt→decrypt round-trip.
//!
//! The inline ChaCha20-Poly1305 V2 scaffold below is retained, untouched,
//! behind its `DEFERRED(SE-7-V2)` marker — it is NOT part of the V1 fix
//! and its on-wire format is unverified.

use super::auth::{sha0, ServerSuppliedKeys, SHA0_SIZE};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key as ChaChaKey, Nonce as ChaChaNonce};

/// ChaCha20-Poly1305 AEAD key + 96-bit nonce-prefix pair, per direction.
///
/// `key` is the 32-byte AEAD key. `nonce_prefix` is a 4-byte
/// direction-specific salt; combined with an 8-byte monotonically
/// increasing frame counter (`frame_seq`) it forms the 12-byte nonce
/// required by ChaCha20-Poly1305. The counter is advanced on every
/// successful `encrypt_frame` / `decrypt_frame`.
///
/// # DEFERRED(SE-7-V2, 2026-04-21): Cedar V2 spec verification
///
/// The SoftEther Protocol V2 handshake and exact nonce/counter
/// construction for ChaCha20-Poly1305 is not documented outside Cedar's
/// source. This scaffold uses the common AEAD pattern (key || salt ||
/// counter) so the round-trip works internally, but the on-wire format
/// (counter endianness, whether it rides in the frame header, whether
/// the nonce-prefix is derived per-session vs. re-exchanged, AAD
/// inclusion, etc.) needs verification against an actual V2-capable
/// peer. Re-open once the Cedar V2 source or a wire capture is in tree.
#[derive(Debug, Clone)]
pub struct ChaChaKeyPair {
    pub key: [u8; 32],
    pub nonce_prefix: [u8; 4],
    /// Per-direction frame counter (low 8 bytes of the 12-byte nonce).
    pub frame_seq: u64,
}

/// Keyed cipher state — one per direction. RC4 carries its full
/// internal PRGA state; AES carries the key schedule + session IV.
///
/// # Threading note for SE-5
///
/// This enum is `Send` but NOT `Sync`. The data-plane task must `take()`
/// the `SessionKeys` out of the service mutex before entering the
/// packet loop — do NOT hold `&mut SoftEtherService` across data-plane
/// `.await` points.
#[derive(Debug, Clone)]
pub enum CipherState {
    /// No app-layer cipher — frames pass through unchanged. This is the
    /// correct state for the TLS-only paths: `use_encrypt == false`, or
    /// `use_encrypt && !use_fast_rc4` (the TLS bulk cipher carries
    /// confidentiality, Cedar `Protocol.c:4188`), or when Fast-RC4 was
    /// advertised but the server's 16-byte keys were absent/mis-sized.
    /// Most production hubs run TLS-only, so this is the common case.
    Null,
    /// Fast-RC4. The PRGA is seeded **directly** from the server-supplied
    /// 16-byte key for this direction (`rc4_key_*`, Cedar
    /// `Protocol.c:6086-6092`) — never from a locally-derived key. Fully
    /// opaque PRGA state; advances on every byte enciphered.
    Rc4(Box<Rc4>),
    /// ChaCha20-Poly1305 AEAD (SoftEther Protocol V2, t4-e14). Negotiated
    /// when the peer advertises a `ChaCha20-Poly1305`-family cipher in
    /// the Welcome PACK. See `DEFERRED(SE-7-V2, 2026-04-21)` on
    /// [`ChaChaKeyPair`] — the on-wire nonce/counter layout is
    /// scaffolded and awaits Cedar V2 spec verification.
    ChaCha20Poly1305(ChaChaKeyPair),
}

/// Bidirectional cipher pair.
#[derive(Debug, Clone)]
pub struct SessionKeys {
    /// Encrypts outgoing frames (client→server).
    pub client_to_server: CipherState,
    /// Decrypts incoming frames (server→client).
    pub server_to_client: CipherState,
    /// The cipher-family label the server selected, preserved for
    /// diagnostics. Examples: `"RC4-MD5"`, `"AES256-SHA"`.
    pub cipher_name: String,
}

/// Derivation / cipher errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyError {
    /// Server-announced a cipher family we don't yet support.
    UnsupportedCipher(String),
    /// An AEAD/framed ciphertext was too short to carry its required
    /// header (e.g. the V2 frame-seq prefix + Poly1305 tag).
    FrameTooShort(usize),
    /// ChaCha20-Poly1305 AEAD authentication tag failed verification,
    /// or the ciphertext was too short to contain the 16-byte tag.
    AeadAuthFailed,
}

impl std::fmt::Display for KeyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedCipher(name) => {
                write!(f, "unsupported SoftEther cipher: {:?}", name)
            }
            Self::FrameTooShort(n) => {
                write!(f, "AEAD frame too short: {} bytes", n)
            }
            Self::AeadAuthFailed => write!(f, "ChaCha20-Poly1305 AEAD authentication failed"),
        }
    }
}

impl std::error::Error for KeyError {}

// ─── Pure-Rust RC4 (inline, ~30 LOC) ─────────────────────────────────────
//
// The `rc4` crate works but requires the `cipher` trait generics plumbing.
// Inline is simpler, matches the "inline SHA-0" pattern SE-3 used, and
// keeps our dependency footprint minimal.

/// RC4 cipher state. The S-box + `i`/`j` indices are advanced by
/// `apply_keystream`. Encryption and decryption are identical in RC4.
#[derive(Debug, Clone)]
pub struct Rc4 {
    s: [u8; 256],
    i: u8,
    j: u8,
}

impl Rc4 {
    /// Initialize RC4 from a key of any length 1..=256 bytes. Panics
    /// if `key.is_empty()` — not reachable from our call sites, which
    /// always pass a 16-byte SHA-0/MD5 digest.
    pub fn new(key: &[u8]) -> Self {
        assert!(!key.is_empty(), "RC4 key must be non-empty");
        assert!(key.len() <= 256, "RC4 key must be at most 256 bytes");

        let mut s = [0u8; 256];
        for (idx, slot) in s.iter_mut().enumerate() {
            *slot = idx as u8;
        }
        let mut j: u8 = 0;
        for i in 0..256 {
            j = j.wrapping_add(s[i]).wrapping_add(key[i % key.len()]);
            s.swap(i, j as usize);
        }
        Rc4 { s, i: 0, j: 0 }
    }

    /// Advance the PRGA and XOR into `buf` in place.
    pub fn apply_keystream(&mut self, buf: &mut [u8]) {
        for byte in buf.iter_mut() {
            self.i = self.i.wrapping_add(1);
            self.j = self.j.wrapping_add(self.s[self.i as usize]);
            self.s.swap(self.i as usize, self.j as usize);
            let k =
                self.s[(self.s[self.i as usize].wrapping_add(self.s[self.j as usize])) as usize];
            *byte ^= k;
        }
    }
}

// ─── V1 session-key construction (server-supplied RC4 model) ─────────────

/// Build the V1 [`SessionKeys`] from the authentication result.
///
/// This is the real Cedar key model (the t4-e11b correction). It does
/// **no** key derivation — when Fast-RC4 is active it seeds the RC4
/// streams directly from the 16-byte keys the *server* generated and
/// shipped in the Welcome PACK; otherwise it installs a passthrough
/// [`CipherState::Null`] because the TLS layer carries confidentiality.
///
/// Selection (mirrors Cedar `Protocol.c:6010-6093`, `:4188`):
///
/// | `use_encrypt` | `use_fast_rc4` | `keys` | Result |
/// |---|---|---|---|
/// | true | true | `Some` | [`CipherState::Rc4`] per direction, seeded with the server bytes |
/// | true | true | `None` | [`CipherState::Null`] (keys absent/mis-sized → TLS-only fallback) |
/// | true | false | — | [`CipherState::Null`] (TLS bulk cipher) |
/// | false | — | — | [`CipherState::Null`] |
///
/// `keys.client_to_server` seeds the *outbound* (encrypt) stream and
/// `keys.server_to_client` seeds the *inbound* (decrypt) stream, matching
/// Cedar's Fast-RC4 application point.
///
/// `cipher_name` is preserved purely for diagnostics ([`SessionKeys::cipher_name`]).
pub fn build_v1_session_keys(
    keys: Option<&ServerSuppliedKeys>,
    use_encrypt: bool,
    use_fast_rc4: bool,
    cipher_name: &str,
) -> SessionKeys {
    let (client_to_server, server_to_client) = if use_encrypt && use_fast_rc4 {
        match keys {
            Some(k) => (
                CipherState::Rc4(Box::new(Rc4::new(&k.client_to_server))),
                CipherState::Rc4(Box::new(Rc4::new(&k.server_to_client))),
            ),
            None => {
                // Fast-RC4 was negotiated but the server's 16-byte keys
                // were absent or mis-sized (auth.rs already validated
                // and dropped them). Do NOT fabricate keys — fall back
                // to the TLS-only path. The first encrypted frame would
                // otherwise be garbage on the wire.
                log::warn!(
                    "SoftEther negotiated Fast-RC4 but the server did not \
                     supply valid 16-byte rc4 keys; falling back to \
                     TLS-only (no app-layer cipher)."
                );
                (CipherState::Null, CipherState::Null)
            }
        }
    } else {
        // !use_encrypt, or use_encrypt && !use_fast_rc4 (TLS bulk cipher).
        (CipherState::Null, CipherState::Null)
    };

    SessionKeys {
        client_to_server,
        server_to_client,
        cipher_name: cipher_name.to_string(),
    }
}

// ─── V2 (t4-e14) ChaCha20-Poly1305 scaffold — DEFERRED, NOT in V1 path ───
//
// DEFERRED(SE-7-V2, 2026-04-21, pending Cedar V2 spec): the exact
// key-derivation recipe and nonce layout SoftEther Protocol V2 uses for
// ChaCha20-Poly1305 is not documented outside Cedar's source. This
// scaffold is self-contained and is NOT reachable from
// `build_v1_session_keys` — V1 is the only production path. It is kept so
// a future V2 effort has a tested round-trip to build on. It uses two
// local direction tags purely to diverge the two nonce prefixes; the key
// is a caller-supplied 32-byte blob (e.g. a future server-supplied V2
// key). When the Cedar V2 spec lands, replace the derivation with the
// real on-wire one; the round-trip tests below fail-closed and force it.

const V2_TAG_C2S: u8 = 0x43; // 'C' — V2 nonce-prefix domain separation only
const V2_TAG_S2C: u8 = 0x53; // 'S'

fn derive_chacha_key(tag: u8, server_random: &[u8; SHA0_SIZE], key32: &[u8; 32]) -> ChaChaKeyPair {
    let key = *key32;
    let mut preimage = Vec::with_capacity(1 + 32 + SHA0_SIZE);
    preimage.push(tag);
    preimage.extend_from_slice(&key);
    preimage.extend_from_slice(server_random);
    let digest = sha0(&preimage);
    let mut nonce_prefix = [0u8; 4];
    nonce_prefix.copy_from_slice(&digest[..4]);
    ChaChaKeyPair {
        key,
        nonce_prefix,
        frame_seq: 0,
    }
}

/// Derive the per-direction ChaCha20-Poly1305 AEAD key pairs (SE V2
/// scaffold; DEFERRED — not used by the V1 production path).
pub fn derive_chacha_keys(
    server_random: &[u8; SHA0_SIZE],
    key32: &[u8; 32],
) -> (ChaChaKeyPair, ChaChaKeyPair) {
    (
        derive_chacha_key(V2_TAG_C2S, server_random, key32),
        derive_chacha_key(V2_TAG_S2C, server_random, key32),
    )
}

/// Construct a 12-byte ChaCha20-Poly1305 nonce from a 4-byte
/// per-direction salt + an 8-byte big-endian frame counter.
fn chacha_nonce(prefix: &[u8; 4], frame_seq: u64) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[..4].copy_from_slice(prefix);
    n[4..].copy_from_slice(&frame_seq.to_be_bytes());
    n
}

// ─── Encrypt / decrypt per-frame ─────────────────────────────────────────

/// Encrypt one SoftEther data-plane frame.
///
/// * [`CipherState::Null`] — passthrough (TLS-only paths). The frame is
///   returned unchanged; the TLS record layer above provides
///   confidentiality.
/// * [`CipherState::Rc4`] — XOR with the keystream of the server-seeded
///   RC4 stream, advancing the PRGA. This is the Fast-RC4 application
///   point (Cedar applies the per-direction RC4 over the framed bytes).
/// * [`CipherState::ChaCha20Poly1305`] — V2 scaffold (DEFERRED).
///
/// Returns the on-wire bytes; the data-plane framing layer prefixes the
/// 4-byte BE length separately.
pub fn encrypt_frame(state: &mut CipherState, plaintext: &[u8]) -> Vec<u8> {
    match state {
        CipherState::Null => plaintext.to_vec(),
        CipherState::Rc4(rc4) => {
            let mut out = plaintext.to_vec();
            rc4.apply_keystream(&mut out);
            out
        }
        CipherState::ChaCha20Poly1305(ck) => {
            // V2 AEAD. Frame layout: [8-byte BE frame_seq][ct||tag].
            // The seq rides on-wire so a receiver with the same
            // nonce-prefix can reconstruct the full 12-byte nonce even
            // if frames arrive out of order (UDP-accel / loss-tolerant
            // paths). DEFERRED(SE-7-V2): confirm against Cedar.
            let nonce_bytes = chacha_nonce(&ck.nonce_prefix, ck.frame_seq);
            let cipher = ChaCha20Poly1305::new(ChaChaKey::from_slice(&ck.key));
            let ct = cipher
                .encrypt(ChaChaNonce::from_slice(&nonce_bytes), plaintext)
                .expect("ChaCha20-Poly1305 encryption is infallible for in-memory inputs");
            let mut out = Vec::with_capacity(8 + ct.len());
            out.extend_from_slice(&ck.frame_seq.to_be_bytes());
            out.extend_from_slice(&ct);
            ck.frame_seq = ck.frame_seq.wrapping_add(1);
            out
        }
    }
}

/// Decrypt one SoftEther data-plane frame. Complements [`encrypt_frame`].
///
/// [`CipherState::Null`] is passthrough; [`CipherState::Rc4`] runs the
/// server-seeded keystream (RC4 enc/dec are identical); the V2 ChaCha
/// arm is the DEFERRED scaffold.
pub fn decrypt_frame(state: &mut CipherState, ciphertext: &[u8]) -> Result<Vec<u8>, KeyError> {
    match state {
        CipherState::Null => Ok(ciphertext.to_vec()),
        CipherState::Rc4(rc4) => {
            let mut out = ciphertext.to_vec();
            rc4.apply_keystream(&mut out);
            Ok(out)
        }
        CipherState::ChaCha20Poly1305(ck) => {
            // Frame layout: [8-byte BE frame_seq][ct||tag]. Minimum size
            // is 8 (seq) + 16 (Poly1305 tag) = 24.
            if ciphertext.len() < 8 + 16 {
                return Err(KeyError::FrameTooShort(ciphertext.len()));
            }
            let (seq_bytes, ct) = ciphertext.split_at(8);
            let mut seq = [0u8; 8];
            seq.copy_from_slice(seq_bytes);
            let frame_seq = u64::from_be_bytes(seq);
            let nonce_bytes = chacha_nonce(&ck.nonce_prefix, frame_seq);
            let cipher = ChaCha20Poly1305::new(ChaChaKey::from_slice(&ck.key));
            let pt = cipher
                .decrypt(ChaChaNonce::from_slice(&nonce_bytes), ct)
                .map_err(|_| KeyError::AeadAuthFailed)?;
            // Advance receiver counter past this seq so our state stays
            // monotone with the peer. DEFERRED(SE-7-V2): replay-window
            // handling for UDP-accel paths.
            ck.frame_seq = frame_seq.wrapping_add(1);
            Ok(pt)
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SERVER_RANDOM: [u8; 20] = [
        0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF,
        0xB0, 0xB1, 0xB2, 0xB3, 0xB4,
    ];

    // Two distinct 16-byte "server-supplied" keys (as if from a Welcome
    // PACK's rc4_key_* DATA fields).
    const SRV_C2S: [u8; 16] = [
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
        0x10,
    ];
    const SRV_S2C: [u8; 16] = [
        0xF0, 0xE1, 0xD2, 0xC3, 0xB4, 0xA5, 0x96, 0x87, 0x78, 0x69, 0x5A, 0x4B, 0x3C, 0x2D, 0x1E,
        0x0F,
    ];

    fn server_keys() -> ServerSuppliedKeys {
        ServerSuppliedKeys {
            client_to_server: SRV_C2S,
            server_to_client: SRV_S2C,
        }
    }

    // ── RC4 primitive: RFC 6229 known-answer vectors ────────────────────

    /// RFC 6229 §2 RC4 test vector for the ASCII key `"Key"`: the first
    /// keystream bytes are `EB 9F 77 81 B7 34 CA 72 A7 19 ...`. Applying
    /// RC4 to the ASCII plaintext `"Plaintext"` therefore yields
    /// `BB F3 16 E8 D9 40 AF 0A D3` (the canonical RFC 6229 / Wikipedia
    /// worked example). Pins the inlined KSA + PRGA.
    #[test]
    fn rc4_rfc6229_vector_key() {
        let mut rc4 = Rc4::new(b"Key");
        let mut buf = b"Plaintext".to_vec();
        rc4.apply_keystream(&mut buf);
        let expected = [0xBB, 0xF3, 0x16, 0xE8, 0xD9, 0x40, 0xAF, 0x0A, 0xD3];
        assert_eq!(buf, expected, "RC4(\"Key\", \"Plaintext\") mismatch");
    }

    /// RFC 6229 keystream for the 5-byte key `0x0102030405`: the first 16
    /// keystream bytes are
    /// `b2 39 63 05 f0 3d c0 27 cc c3 52 4a 0a 11 18 a8`. We recover the
    /// keystream by enciphering all-zero plaintext.
    #[test]
    fn rc4_rfc6229_keystream_0102030405() {
        let mut rc4 = Rc4::new(&[0x01, 0x02, 0x03, 0x04, 0x05]);
        let mut ks = [0u8; 16];
        rc4.apply_keystream(&mut ks);
        let expected = [
            0xb2, 0x39, 0x63, 0x05, 0xf0, 0x3d, 0xc0, 0x27, 0xcc, 0xc3, 0x52, 0x4a, 0x0a, 0x11,
            0x18, 0xa8,
        ];
        assert_eq!(ks, expected, "RFC 6229 keystream for key 0102030405");
    }

    // ── Server-supplied key → cipher-state mapping ──────────────────────

    /// `build_v1_session_keys` must seed each RC4 stream from the
    /// SERVER's bytes (no derivation). Proof: a stream seeded by
    /// `build_v1_session_keys` produces the SAME keystream as a bare
    /// `Rc4::new(server_key)`.
    #[test]
    fn build_v1_seeds_rc4_directly_from_server_keys() {
        let keys = server_keys();
        let mut sk = build_v1_session_keys(Some(&keys), true, true, "RC4-MD5");

        // Outbound (client_to_server) must equal Rc4::new(SRV_C2S).
        let mut reference_c2s = Rc4::new(&SRV_C2S);
        let mut got = [0u8; 32];
        let mut want = [0u8; 32];
        if let CipherState::Rc4(rc4) = &mut sk.client_to_server {
            rc4.apply_keystream(&mut got);
        } else {
            panic!("expected Rc4 for client_to_server, got {:?}", sk.client_to_server);
        }
        reference_c2s.apply_keystream(&mut want);
        assert_eq!(got, want, "C2S stream must be seeded by the server's bytes");

        // Inbound (server_to_client) must equal Rc4::new(SRV_S2C).
        let mut reference_s2c = Rc4::new(&SRV_S2C);
        let mut got2 = [0u8; 32];
        let mut want2 = [0u8; 32];
        if let CipherState::Rc4(rc4) = &mut sk.server_to_client {
            rc4.apply_keystream(&mut got2);
        } else {
            panic!("expected Rc4 for server_to_client");
        }
        reference_s2c.apply_keystream(&mut want2);
        assert_eq!(got2, want2, "S2C stream must be seeded by the server's bytes");

        // And the two directions must diverge (distinct server keys).
        assert_ne!(got, got2, "C2S and S2C keystreams must differ");
    }

    /// `use_encrypt && !use_fast_rc4` → TLS bulk-cipher path → Null.
    #[test]
    fn build_v1_tls_bulk_cipher_is_null() {
        let keys = server_keys();
        let sk = build_v1_session_keys(Some(&keys), true, false, "AES256-SHA");
        assert!(matches!(sk.client_to_server, CipherState::Null));
        assert!(matches!(sk.server_to_client, CipherState::Null));
    }

    /// `!use_encrypt` → Null regardless of keys.
    #[test]
    fn build_v1_no_encrypt_is_null() {
        let sk = build_v1_session_keys(None, false, false, "");
        assert!(matches!(sk.client_to_server, CipherState::Null));
        assert!(matches!(sk.server_to_client, CipherState::Null));
    }

    /// Fast-RC4 negotiated but keys absent (TLS-only fallback) → Null,
    /// NOT fabricated keys.
    #[test]
    fn build_v1_fast_rc4_without_keys_falls_back_to_null() {
        let sk = build_v1_session_keys(None, true, true, "RC4-MD5");
        assert!(
            matches!(sk.client_to_server, CipherState::Null),
            "missing server keys must NOT fabricate a cipher"
        );
        assert!(matches!(sk.server_to_client, CipherState::Null));
    }

    // ── Directional encrypt → decrypt round-trip (server-keyed RC4) ─────

    /// The proper peering: the client's *outbound* (C2S) stream is keyed
    /// with `client_to_server`; the server decrypts that traffic with a
    /// stream keyed by the SAME `client_to_server` bytes. Verify a
    /// round-trip across two independent `build_v1_session_keys` results
    /// (client side + server side both have the same server-supplied
    /// keys).
    #[test]
    fn rc4_directional_round_trip_via_server_keys() {
        let keys = server_keys();
        let mut client = build_v1_session_keys(Some(&keys), true, true, "RC4-MD5");
        let mut server = build_v1_session_keys(Some(&keys), true, true, "RC4-MD5");

        // C2S direction: client encrypts, server decrypts with its C2S.
        let payload = b"client to server data-plane frame";
        let ct = encrypt_frame(&mut client.client_to_server, payload);
        assert_ne!(&ct[..], &payload[..], "RC4 must transform the bytes");
        let pt = decrypt_frame(&mut server.client_to_server, &ct).expect("decrypt");
        assert_eq!(&pt[..], &payload[..]);

        // S2C direction: server encrypts, client decrypts with its S2C.
        let reply = b"server to client reply frame!";
        let ct2 = encrypt_frame(&mut server.server_to_client, reply);
        let pt2 = decrypt_frame(&mut client.server_to_client, &ct2).expect("decrypt");
        assert_eq!(&pt2[..], &reply[..]);
    }

    // ── Null passthrough ────────────────────────────────────────────────

    #[test]
    fn null_cipher_is_passthrough() {
        let mut s = CipherState::Null;
        let data = b"the TLS layer carries confidentiality";
        let ct = encrypt_frame(&mut s, data);
        assert_eq!(&ct[..], &data[..], "Null must not alter bytes");
        let mut s2 = CipherState::Null;
        let pt = decrypt_frame(&mut s2, &ct).expect("null decrypt");
        assert_eq!(&pt[..], &data[..]);
    }

    // ── t4-e14: V2 ChaCha20-Poly1305 scaffold (DEFERRED — not V1 path) ──
    //
    // Driven by the self-contained `derive_chacha_keys` + a manual
    // SessionKeys; the V1 production builder never selects ChaCha. These
    // pin the round-trip so a future V2 effort has a working baseline.

    fn chacha_session_keys() -> SessionKeys {
        let (c2s, s2c) = derive_chacha_keys(&SERVER_RANDOM, &[0x5A; 32]);
        SessionKeys {
            client_to_server: CipherState::ChaCha20Poly1305(c2s),
            server_to_client: CipherState::ChaCha20Poly1305(s2c),
            cipher_name: "ChaCha20-Poly1305".to_string(),
        }
    }

    #[test]
    fn chacha_round_trip() {
        let mut enc = chacha_session_keys();
        let mut dec = chacha_session_keys();
        let plaintext = b"SoftEther V2 AEAD data-plane frame";
        let ct = encrypt_frame(&mut enc.client_to_server, plaintext);
        assert_eq!(ct.len(), 8 + plaintext.len() + 16);
        let pt = decrypt_frame(&mut dec.client_to_server, &ct).expect("chacha decrypt");
        assert_eq!(&pt[..], &plaintext[..]);
    }

    #[test]
    fn chacha_counter_advances() {
        let mut keys = chacha_session_keys();
        let c1 = encrypt_frame(&mut keys.client_to_server, b"frame-1");
        let c2 = encrypt_frame(&mut keys.client_to_server, b"frame-2");
        assert_ne!(&c1[..8], &c2[..8], "frame_seq must advance");
        assert_eq!(&c1[..8], &0u64.to_be_bytes());
        assert_eq!(&c2[..8], &1u64.to_be_bytes());
    }

    #[test]
    fn chacha_tamper_fails_auth() {
        let mut enc = chacha_session_keys();
        let mut dec = chacha_session_keys();
        let mut ct = encrypt_frame(&mut enc.client_to_server, b"authentic payload");
        let idx = 10.min(ct.len() - 1);
        ct[idx] ^= 0x01;
        let err = decrypt_frame(&mut dec.client_to_server, &ct)
            .expect_err("tampered frame must fail AEAD auth");
        assert!(matches!(err, KeyError::AeadAuthFailed));
    }

    #[test]
    fn chacha_direction_keys_differ() {
        let (c2s, s2c) = derive_chacha_keys(&SERVER_RANDOM, &[0x5A; 32]);
        assert_ne!(
            c2s.nonce_prefix, s2c.nonce_prefix,
            "C2S and S2C nonce prefixes must diverge"
        );
    }
}

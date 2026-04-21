//! SoftEther data-plane framing codec (SE-5a).
//!
//! Implements the block-batch wire format used on a connected SoftEther
//! session. Framing is a direct clean-room port of the Cedar receive FSM
//! at `Cedar/Connection.c` lines ~2129–2316 (the `ts->Mode 0..4` state
//! machine) and the send path at `Cedar/Connection.c` lines ~1287–1320
//! (`while (b = GetNext(q)) { WriteSendFifo(size); WriteSendFifo(body); }`)
//! plus `SendKeepAlive` at `Cedar/Connection.c:959`.
//!
//! # Wire format (verified against Cedar)
//!
//! A batch written into the SendFifo looks like:
//!
//! ```text
//! [u32 BE num_blocks]                         // or KEEP_ALIVE_MAGIC
//! per block:
//!     [u32 BE block_size][block_size bytes]   // raw ethernet frame bytes
//! ```
//!
//! When `num_blocks == KEEP_ALIVE_MAGIC` (0xFFFFFFFF), the layout is
//! instead a single `[u32 BE ka_size][ka_size bytes]` of random padding
//! (Cedar's `SendKeepAlive`, Connection.c:974-1006). The body is discarded
//! by the receiver (mode-4 in Connection.c:2272-2315); only the side-effect
//! of refreshing the comm timestamp matters.
//!
//! # Layering note
//!
//! Cedar writes the framed bytes into `SendFifo` **plain** — encryption
//! happens at the `TcpSockSend` (OpenSSL TLS) layer. SE-4's [`CipherState`]
//! models a secondary cipher layer used by UDP acceleration and some
//! non-TLS bridge variants. For TCP-over-TLS deployments callers may
//! pass an RC4 cipher keyed with a known-nop key, or (as SE-5b will) run
//! the encoder/decoder directly over a rustls stream and skip the cipher
//! entirely by leaving [`CipherState::Rc4`] untouched. The cipher slot
//! is preserved here for forward-compat with UDP acceleration (SE-5b+).
//!
//! # Bounds (match Cedar)
//!
//! Cedar's `MAX_PACKET_SIZE` is 1560 bytes (Ethernet MTU + slack). The
//! receive FSM caps block sizes at `MAX_PACKET_SIZE * 2 = 3120` on the
//! wire and discards any block whose decoded size exceeds
//! `MAX_PACKET_SIZE` (Connection.c:2162-2169, 2205-2209). KeepAlive
//! bodies are capped at `MAX_KEEPALIVE_SIZE = 512` (Connection.c:2253).
//! `MAX_SEND_SOCKET_QUEUE_NUM = 8192` is Cedar's hard upper bound on
//! blocks queued per send round.

use super::session_key::{decrypt_frame, encrypt_frame, CipherState, KeyError};

/// Sentinel value for `num_blocks` indicating a KeepAlive record instead
/// of a normal block batch. Per `Cedar/Connection.c:975` (`num =
/// KEEP_ALIVE_MAGIC`) and the receiver check at `Connection.c:2146`.
pub const KEEP_ALIVE_MAGIC: u32 = 0xFFFF_FFFF;

/// Maximum single-block payload — matches Cedar's `MAX_PACKET_SIZE`
/// (Ethernet MTU + header + slack). Blocks larger than this are dropped
/// by the receiver at `Cedar/Connection.c:2205`.
pub const MAX_BLOCK_SIZE: u32 = 1560;

/// On-wire block-size limit (2× `MAX_BLOCK_SIZE`), per `Cedar/Connection.c:2162`.
/// The receiver tolerates up to this before disconnecting. Decoder
/// rejects anything above as a DoS guard.
pub const MAX_WIRE_BLOCK_SIZE: u32 = MAX_BLOCK_SIZE * 2;

/// Maximum KeepAlive body size — Cedar's `MAX_KEEPALIVE_SIZE`
/// (`Connection.c:2253`).
pub const MAX_KEEPALIVE_SIZE: u32 = 512;

/// Maximum blocks per batch — Cedar's `MAX_SEND_SOCKET_QUEUE_NUM`, used
/// to bound per-round queue drain (`Cedar/Session.c:458`,
/// `Connection.c:2491`). Treated as a DoS guard on decode.
pub const MAX_BLOCKS_PER_BATCH: u32 = 8192;

/// A single decoded data-plane frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataFrame {
    /// Raw layer-2 Ethernet frame (14-byte header + payload, no FCS).
    Ethernet(Vec<u8>),
    /// KeepAlive heartbeat. Contents (random padding on the wire) are
    /// discarded per Cedar's receiver mode-4.
    KeepAlive,
}

/// Data-plane encode/decode errors.
#[derive(Debug)]
pub enum DataplaneError {
    /// Input bytes were shorter than the declared block/batch required.
    Truncated,
    /// A block declared `block_size` larger than [`MAX_WIRE_BLOCK_SIZE`]
    /// (DoS guard). Carries the offending size.
    BlockTooLarge(u32),
    /// `num_blocks` exceeded [`MAX_BLOCKS_PER_BATCH`]. Carries the
    /// offending count.
    TooManyBlocks(u32),
    /// KeepAlive body declared larger than [`MAX_KEEPALIVE_SIZE`].
    KeepAliveTooLarge(u32),
    /// Wrapped cipher error from [`super::session_key`].
    CipherError(KeyError),
}

impl std::fmt::Display for DataplaneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Truncated => write!(f, "truncated data-plane batch"),
            Self::BlockTooLarge(n) => write!(f, "block size {} exceeds MAX_WIRE_BLOCK_SIZE", n),
            Self::TooManyBlocks(n) => {
                write!(f, "num_blocks {} exceeds MAX_BLOCKS_PER_BATCH", n)
            }
            Self::KeepAliveTooLarge(n) => {
                write!(f, "keepalive body {} exceeds MAX_KEEPALIVE_SIZE", n)
            }
            Self::CipherError(e) => write!(f, "cipher error: {}", e),
        }
    }
}

impl std::error::Error for DataplaneError {}

impl From<KeyError> for DataplaneError {
    fn from(e: KeyError) -> Self {
        DataplaneError::CipherError(e)
    }
}

// ─── Batch codec helpers (plain — no cipher) ────────────────────────────

/// Serialize a single batch of [`DataFrame`]s to the Cedar wire format
/// (pre-cipher plaintext). Splits Ethernet frames from KeepAlives —
/// Cedar never mixes the two in one batch (KeepAlive has its own mode-3
/// path). If callers pass both, the encoder emits multiple concatenated
/// records: first the Ethernet batch (if any), then one KeepAlive record
/// per KeepAlive frame (matches `SendKeepAlive` → one record per call).
pub fn encode_plain(frames: &[DataFrame]) -> Result<Vec<u8>, DataplaneError> {
    // Partition in encounter order so the output is deterministic and
    // matches Cedar's sequential `WriteSendFifo` calls.
    let mut out = Vec::new();
    // First pass: collect contiguous ethernet runs and flush on each
    // KeepAlive boundary. This keeps records in the same order callers
    // supplied them (which may matter for L2 ordering invariants).
    let mut run: Vec<&[u8]> = Vec::new();

    fn flush_run(out: &mut Vec<u8>, run: &mut Vec<&[u8]>) -> Result<(), DataplaneError> {
        if run.is_empty() {
            return Ok(());
        }
        if run.len() as u64 > MAX_BLOCKS_PER_BATCH as u64 {
            return Err(DataplaneError::TooManyBlocks(run.len() as u32));
        }
        out.extend_from_slice(&(run.len() as u32).to_be_bytes());
        for b in run.drain(..) {
            if b.len() as u64 > MAX_BLOCK_SIZE as u64 {
                return Err(DataplaneError::BlockTooLarge(b.len() as u32));
            }
            out.extend_from_slice(&(b.len() as u32).to_be_bytes());
            out.extend_from_slice(b);
        }
        Ok(())
    }

    for f in frames {
        match f {
            DataFrame::Ethernet(buf) => run.push(buf),
            DataFrame::KeepAlive => {
                flush_run(&mut out, &mut run)?;
                // KeepAlive record: magic + single size+body (body is
                // empty in our impl — Cedar uses random padding for
                // obfuscation; the receiver discards bytes regardless).
                out.extend_from_slice(&KEEP_ALIVE_MAGIC.to_be_bytes());
                out.extend_from_slice(&0u32.to_be_bytes());
            }
        }
    }
    flush_run(&mut out, &mut run)?;
    Ok(out)
}

/// Decode a Cedar-format plaintext batch (possibly containing one or
/// more concatenated records — e.g. an ethernet batch followed by a
/// keepalive). Consumes the entire input; returns an error if bytes
/// remain unconsumed after the FSM completes.
pub fn decode_plain(mut buf: &[u8]) -> Result<Vec<DataFrame>, DataplaneError> {
    let mut out = Vec::new();
    while !buf.is_empty() {
        // Read num_blocks.
        if buf.len() < 4 {
            return Err(DataplaneError::Truncated);
        }
        let num = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
        buf = &buf[4..];

        if num == KEEP_ALIVE_MAGIC {
            // KeepAlive: one size+body pair.
            if buf.len() < 4 {
                return Err(DataplaneError::Truncated);
            }
            let sz = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
            buf = &buf[4..];
            if sz > MAX_KEEPALIVE_SIZE {
                return Err(DataplaneError::KeepAliveTooLarge(sz));
            }
            if (buf.len() as u64) < sz as u64 {
                return Err(DataplaneError::Truncated);
            }
            // Discard body — matches Connection.c:2272-2315 (receiver
            // reads-through the KA body without producing a packet).
            buf = &buf[sz as usize..];
            out.push(DataFrame::KeepAlive);
            continue;
        }

        if num > MAX_BLOCKS_PER_BATCH {
            return Err(DataplaneError::TooManyBlocks(num));
        }

        for _ in 0..num {
            if buf.len() < 4 {
                return Err(DataplaneError::Truncated);
            }
            let sz = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
            buf = &buf[4..];
            if sz > MAX_WIRE_BLOCK_SIZE {
                return Err(DataplaneError::BlockTooLarge(sz));
            }
            if (buf.len() as u64) < sz as u64 {
                return Err(DataplaneError::Truncated);
            }
            let (body, rest) = buf.split_at(sz as usize);
            out.push(DataFrame::Ethernet(body.to_vec()));
            buf = rest;
        }
    }
    Ok(out)
}

// ─── Stateful encoder / decoder (with optional cipher layer) ───────────

/// Encodes batches of frames and applies the outgoing (client→server)
/// cipher state before returning on-wire bytes. In TLS-only deployments
/// the cipher layer is effectively pass-through (see module docs).
pub struct DataplaneEncoder {
    cipher: CipherState,
}

impl DataplaneEncoder {
    pub fn new(cipher: CipherState) -> Self {
        Self { cipher }
    }

    /// Encode a batch to on-wire bytes (post-cipher). The TLS layer
    /// above handles record framing.
    pub fn encode_batch(&mut self, frames: &[DataFrame]) -> Result<Vec<u8>, DataplaneError> {
        let plain = encode_plain(frames)?;
        Ok(encrypt_frame(&mut self.cipher, &plain))
    }

    /// Borrow the underlying cipher state (diagnostic use).
    pub fn cipher(&self) -> &CipherState {
        &self.cipher
    }
}

/// Decodes on-wire bytes received from the server. Applies the incoming
/// (server→client) cipher state, then runs the Cedar batch FSM.
pub struct DataplaneDecoder {
    cipher: CipherState,
}

impl DataplaneDecoder {
    pub fn new(cipher: CipherState) -> Self {
        Self { cipher }
    }

    /// Decode one record's worth of on-wire bytes into frames.
    pub fn decode_batch(&mut self, wire: &[u8]) -> Result<Vec<DataFrame>, DataplaneError> {
        let plain = decrypt_frame(&mut self.cipher, wire)?;
        decode_plain(&plain)
    }

    pub fn cipher(&self) -> &CipherState {
        &self.cipher
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::softether::session_key::{derive_session_keys, expand_session_key_32};

    const SERVER_RANDOM: [u8; 20] = [0x11; 20];
    const SESSION_KEY: [u8; 20] = [0x22; 20];

    fn key32() -> [u8; 32] {
        expand_session_key_32(&SESSION_KEY, 0xDEAD_BEEF)
    }

    fn eth(bytes: &[u8]) -> DataFrame {
        DataFrame::Ethernet(bytes.to_vec())
    }

    // ── Plain-format round trips ───────────────────────────────────────

    #[test]
    fn plain_round_trip_one_ethernet_frame() {
        let frames = vec![eth(b"hello world ethernet payload bytes")];
        let wire = encode_plain(&frames).expect("encode");
        let got = decode_plain(&wire).expect("decode");
        assert_eq!(got, frames);
    }

    #[test]
    fn plain_round_trip_five_frames_in_batch() {
        let frames: Vec<DataFrame> = (0..5)
            .map(|i| eth(&[i as u8; 64]))
            .collect();
        let wire = encode_plain(&frames).expect("encode");
        // 4 (num) + 5 * (4 + 64) = 344
        assert_eq!(wire.len(), 4 + 5 * (4 + 64));
        let got = decode_plain(&wire).expect("decode");
        assert_eq!(got, frames);
    }

    #[test]
    fn plain_round_trip_mixed_keepalive_and_ethernet() {
        let frames = vec![
            eth(b"first"),
            eth(b"second"),
            DataFrame::KeepAlive,
            eth(b"third-after-ka"),
            DataFrame::KeepAlive,
        ];
        let wire = encode_plain(&frames).expect("encode");
        let got = decode_plain(&wire).expect("decode");
        assert_eq!(got, frames);
    }

    #[test]
    fn plain_round_trip_only_keepalive() {
        let frames = vec![DataFrame::KeepAlive];
        let wire = encode_plain(&frames).expect("encode");
        // [magic u32][size u32 = 0]  → 8 bytes
        assert_eq!(wire.len(), 8);
        let got = decode_plain(&wire).expect("decode");
        assert_eq!(got, frames);
    }

    #[test]
    fn plain_empty_input_round_trip() {
        let wire = encode_plain(&[]).expect("encode empty");
        assert!(wire.is_empty());
        let got = decode_plain(&wire).expect("decode empty");
        assert!(got.is_empty());
    }

    // ── Error paths ────────────────────────────────────────────────────

    #[test]
    fn decode_truncated_num_blocks_errors() {
        let err = decode_plain(&[0, 0, 0]).expect_err("truncated");
        assert!(matches!(err, DataplaneError::Truncated));
    }

    #[test]
    fn decode_truncated_block_size_errors() {
        // num_blocks=1, then only 3 bytes (should be 4 for block size).
        let mut buf = Vec::new();
        buf.extend_from_slice(&1u32.to_be_bytes());
        buf.extend_from_slice(&[0, 0, 0]);
        let err = decode_plain(&buf).expect_err("truncated");
        assert!(matches!(err, DataplaneError::Truncated));
    }

    #[test]
    fn decode_truncated_block_body_errors() {
        // num_blocks=1, block_size=10, only 5 body bytes.
        let mut buf = Vec::new();
        buf.extend_from_slice(&1u32.to_be_bytes());
        buf.extend_from_slice(&10u32.to_be_bytes());
        buf.extend_from_slice(&[0u8; 5]);
        let err = decode_plain(&buf).expect_err("truncated");
        assert!(matches!(err, DataplaneError::Truncated));
    }

    #[test]
    fn decode_too_many_blocks_errors() {
        let mut buf = Vec::new();
        // just over the limit
        buf.extend_from_slice(&(MAX_BLOCKS_PER_BATCH + 1).to_be_bytes());
        let err = decode_plain(&buf).expect_err("too many");
        match err {
            DataplaneError::TooManyBlocks(n) => assert_eq!(n, MAX_BLOCKS_PER_BATCH + 1),
            other => panic!("expected TooManyBlocks, got {:?}", other),
        }
    }

    #[test]
    fn decode_block_too_large_errors() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&1u32.to_be_bytes());
        buf.extend_from_slice(&(MAX_WIRE_BLOCK_SIZE + 1).to_be_bytes());
        let err = decode_plain(&buf).expect_err("too large");
        match err {
            DataplaneError::BlockTooLarge(n) => assert_eq!(n, MAX_WIRE_BLOCK_SIZE + 1),
            other => panic!("expected BlockTooLarge, got {:?}", other),
        }
    }

    #[test]
    fn decode_keepalive_too_large_errors() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&KEEP_ALIVE_MAGIC.to_be_bytes());
        buf.extend_from_slice(&(MAX_KEEPALIVE_SIZE + 1).to_be_bytes());
        let err = decode_plain(&buf).expect_err("ka too large");
        match err {
            DataplaneError::KeepAliveTooLarge(n) => assert_eq!(n, MAX_KEEPALIVE_SIZE + 1),
            other => panic!("expected KeepAliveTooLarge, got {:?}", other),
        }
    }

    #[test]
    fn decode_keepalive_truncated_body_errors() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&KEEP_ALIVE_MAGIC.to_be_bytes());
        buf.extend_from_slice(&10u32.to_be_bytes());
        buf.extend_from_slice(&[0u8; 3]); // short
        let err = decode_plain(&buf).expect_err("truncated ka");
        assert!(matches!(err, DataplaneError::Truncated));
    }

    #[test]
    fn encode_block_too_large_errors() {
        let frames = vec![eth(&vec![0u8; (MAX_BLOCK_SIZE + 1) as usize])];
        let err = encode_plain(&frames).expect_err("too large");
        assert!(matches!(err, DataplaneError::BlockTooLarge(_)));
    }

    // ── Byte-stable fixture (regression anchor) ────────────────────────

    #[test]
    fn byte_stable_fixture_one_frame() {
        // A single 4-byte frame [0xDE, 0xAD, 0xBE, 0xEF].
        let frames = vec![eth(&[0xDE, 0xAD, 0xBE, 0xEF])];
        let wire = encode_plain(&frames).expect("encode");
        let expected: &[u8] = &[
            0x00, 0x00, 0x00, 0x01, // num_blocks = 1
            0x00, 0x00, 0x00, 0x04, // block_size = 4
            0xDE, 0xAD, 0xBE, 0xEF, // body
        ];
        assert_eq!(wire.as_slice(), expected);
    }

    #[test]
    fn byte_stable_fixture_keepalive() {
        let wire = encode_plain(&[DataFrame::KeepAlive]).expect("encode");
        let expected: &[u8] = &[
            0xFF, 0xFF, 0xFF, 0xFF, // KEEP_ALIVE_MAGIC
            0x00, 0x00, 0x00, 0x00, // size = 0
        ];
        assert_eq!(wire.as_slice(), expected);
    }

    #[test]
    fn byte_stable_fixture_two_frames_batch() {
        let frames = vec![eth(&[0xAA, 0xBB]), eth(&[0xCC])];
        let wire = encode_plain(&frames).expect("encode");
        let expected: &[u8] = &[
            0x00, 0x00, 0x00, 0x02, // num_blocks = 2
            0x00, 0x00, 0x00, 0x02, 0xAA, 0xBB, //
            0x00, 0x00, 0x00, 0x01, 0xCC, //
        ];
        assert_eq!(wire.as_slice(), expected);
    }

    // ── Stateful encoder/decoder with RC4 cipher split ─────────────────

    #[test]
    fn encoder_decoder_rc4_round_trip_direction_split() {
        // Build a full key pair and peer the encoder with its matching
        // decoder on the opposite side (the SERVER'S view of C→S is
        // keyed with the same C→S cipher state).
        let client_keys =
            derive_session_keys(&SERVER_RANDOM, &SESSION_KEY, &key32(), "RC4-MD5").unwrap();
        let server_keys =
            derive_session_keys(&SERVER_RANDOM, &SESSION_KEY, &key32(), "RC4-MD5").unwrap();

        let mut client_enc = DataplaneEncoder::new(client_keys.client_to_server);
        // Server decodes C→S traffic using the SERVER's client_to_server
        // cipher (both sides derive the same key for that direction).
        let mut server_dec = DataplaneDecoder::new(server_keys.client_to_server);

        let frames = vec![eth(b"client to server 1"), eth(b"client to server 2")];
        let wire = client_enc.encode_batch(&frames).expect("encode");
        let got = server_dec.decode_batch(&wire).expect("decode");
        assert_eq!(got, frames);
    }

    #[test]
    fn encoder_decoder_rc4_mixed_ka_and_ethernet() {
        let ck = derive_session_keys(&SERVER_RANDOM, &SESSION_KEY, &key32(), "RC4-MD5").unwrap();
        let sk = derive_session_keys(&SERVER_RANDOM, &SESSION_KEY, &key32(), "RC4-MD5").unwrap();
        let mut enc = DataplaneEncoder::new(ck.client_to_server);
        let mut dec = DataplaneDecoder::new(sk.client_to_server);

        let frames = vec![
            eth(b"pkt-A"),
            DataFrame::KeepAlive,
            eth(b"pkt-B-longer-payload-here"),
        ];
        let wire = enc.encode_batch(&frames).expect("encode");
        let got = dec.decode_batch(&wire).expect("decode");
        assert_eq!(got, frames);
    }

    #[test]
    fn encoder_decoder_rc4_two_batches_preserve_keystream() {
        // RC4 advances its state across calls; verify two back-to-back
        // batches still round-trip (regression guard for accidentally
        // re-initialising cipher state per batch).
        let ck = derive_session_keys(&SERVER_RANDOM, &SESSION_KEY, &key32(), "RC4-MD5").unwrap();
        let sk = derive_session_keys(&SERVER_RANDOM, &SESSION_KEY, &key32(), "RC4-MD5").unwrap();
        let mut enc = DataplaneEncoder::new(ck.client_to_server);
        let mut dec = DataplaneDecoder::new(sk.client_to_server);

        let b1 = vec![eth(b"batch-1-frame")];
        let b2 = vec![eth(b"batch-2-frame"), eth(b"batch-2-frame-second")];
        let w1 = enc.encode_batch(&b1).unwrap();
        let w2 = enc.encode_batch(&b2).unwrap();
        assert_eq!(dec.decode_batch(&w1).unwrap(), b1);
        assert_eq!(dec.decode_batch(&w2).unwrap(), b2);
    }

    #[test]
    fn encoder_decoder_aes_round_trip() {
        let ck = derive_session_keys(&SERVER_RANDOM, &SESSION_KEY, &key32(), "AES256-SHA").unwrap();
        let sk = derive_session_keys(&SERVER_RANDOM, &SESSION_KEY, &key32(), "AES256-SHA").unwrap();
        let mut enc = DataplaneEncoder::new(ck.client_to_server);
        let mut dec = DataplaneDecoder::new(sk.client_to_server);

        let frames = vec![eth(b"aes-cbc frame payload here with some bytes")];
        let wire = enc.encode_batch(&frames).expect("encode");
        let got = dec.decode_batch(&wire).expect("decode");
        assert_eq!(got, frames);
    }

    #[test]
    fn max_block_size_at_exact_boundary_round_trips() {
        let frames = vec![eth(&vec![0x5Au8; MAX_BLOCK_SIZE as usize])];
        let wire = encode_plain(&frames).expect("encode");
        let got = decode_plain(&wire).expect("decode");
        assert_eq!(got, frames);
    }
}

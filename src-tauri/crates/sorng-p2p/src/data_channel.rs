//! # Data Channel
//!
//! Encrypted bidirectional byte stream over a P2P connection. Provides
//! a reliable, ordered, encrypted transport for tunneling application
//! protocols (SSH, RDP, VNC, etc.) over the peer-to-peer link.

use chrono::{DateTime, Utc};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

use chacha20poly1305::{aead::{Aead, KeyInit, Payload}, ChaCha20Poly1305, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;

/// Data channel state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DataChannelState {
    /// Channel is opening (key exchange in progress)
    Opening,
    /// Channel is open and ready for data
    Open,
    /// Channel is closing
    Closing,
    /// Channel is closed
    Closed,
    /// Channel encountered an error
    Error,
}

/// Data channel configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataChannelConfig {
    /// Whether to encrypt the channel (should always be true in production)
    pub encrypted: bool,
    /// Cipher suite to use
    pub cipher_suite: CipherSuite,
    /// Maximum segment size (bytes)
    pub max_segment_size: usize,
    /// Send buffer size (bytes)
    pub send_buffer_size: usize,
    /// Receive buffer size (bytes)
    pub recv_buffer_size: usize,
    /// Enable reliability (retransmission)
    pub reliable: bool,
    /// Enable ordering
    pub ordered: bool,
    /// Congestion control algorithm
    pub congestion_control: CongestionControl,
    /// Keepalive interval in seconds (0 = disabled)
    pub keepalive_secs: u32,
}

/// Cipher suite for data channel encryption.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CipherSuite {
    /// ChaCha20-Poly1305 (preferred — fast on all platforms)
    ChaCha20Poly1305,
    /// AES-256-GCM (fast with hardware AES-NI)
    Aes256Gcm,
    /// AES-128-GCM
    Aes128Gcm,
    /// No encryption (testing/LAN only — dangerous)
    None,
}

/// Congestion control algorithm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CongestionControl {
    /// No congestion control (send as fast as possible)
    None,
    /// Simple window-based flow control
    WindowBased,
    /// BBR-like bandwidth probing
    Bbr,
}

impl Default for DataChannelConfig {
    fn default() -> Self {
        Self {
            encrypted: true,
            cipher_suite: CipherSuite::ChaCha20Poly1305,
            max_segment_size: 16384,
            send_buffer_size: 1048576, // 1 MB
            recv_buffer_size: 1048576,
            reliable: true,
            ordered: true,
            congestion_control: CongestionControl::WindowBased,
            keepalive_secs: 30,
        }
    }
}

/// A data channel frame (the unit of data sent over the channel).
#[derive(Debug, Clone)]
pub struct DataFrame {
    /// Sequence number (for ordering and reliability)
    pub seq: u64,
    /// Frame type
    pub frame_type: FrameType,
    /// Payload data
    pub payload: Vec<u8>,
    /// Whether this is a retransmission
    pub retransmission: bool,
}

/// Types of data channel frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameType {
    /// Application data
    Data,
    /// Acknowledgement
    Ack,
    /// Keepalive
    Keepalive,
    /// Key rotation
    KeyRotation,
    /// Channel close
    Close,
    /// Window update (flow control)
    WindowUpdate,
}

/// Encryption context for the data channel.
pub struct EncryptionContext {
    /// Cipher suite in use
    cipher_suite: CipherSuite,
    /// Shared secret (derived from X25519 key exchange)
    shared_secret: Vec<u8>,
    /// Symmetric key derived from shared_secret
    key: Option<chacha20poly1305::Key>,
    /// Send nonce counter
    send_nonce: u64,
    /// Receive nonce counter
    recv_nonce: u64,
    /// Whether key rotation is pending
    key_rotation_pending: bool,
    /// Number of bytes encrypted with current key
    bytes_encrypted: u64,
    /// Threshold for automatic key rotation (bytes)
    rotation_threshold: u64,
}

impl EncryptionContext {
    /// Create a new encryption context with a shared secret.
    pub fn new(cipher_suite: CipherSuite, shared_secret: Vec<u8>) -> Self {
        let key = if cipher_suite == CipherSuite::ChaCha20Poly1305 {
            // Derive a 32-byte key using HKDF-SHA256
            let hk = Hkdf::<Sha256>::new(None, &shared_secret);
            let mut okm = [0u8; 32];
            hk.expand(b"sorng-p2p-datachannel", &mut okm).expect("HKDF expand failed");
            Some(*chacha20poly1305::Key::from_slice(&okm))
        } else {
            None
        };
        Self {
            cipher_suite,
            shared_secret,
            key,
            send_nonce: 0,
            recv_nonce: 0,
            key_rotation_pending: false,
            bytes_encrypted: 0,
            rotation_threshold: 1024 * 1024 * 1024, // 1 GB
        }
    }

    /// Encrypt a plaintext payload.
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        if self.cipher_suite == CipherSuite::None {
            return Ok(plaintext.to_vec());
        }

        if self.cipher_suite != CipherSuite::ChaCha20Poly1305 {
            return Err("Only ChaCha20Poly1305 is implemented".to_string());
        }

        let key = self.key.as_ref().ok_or("Missing encryption key")?;

        // Nonce: 12 bytes, use 4 zero bytes + 8-byte sequence number (big endian)
        let mut nonce_bytes = [0u8; 12];
        nonce_bytes[4..].copy_from_slice(&self.send_nonce.to_be_bytes());
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Associated data: the nonce (or could be a header if available)
        let aad = &self.send_nonce.to_be_bytes();

        let cipher = ChaCha20Poly1305::new(key);
        let ciphertext = cipher.encrypt(nonce, Payload { msg: plaintext, aad })
            .map_err(|e| format!("Encryption failed: {e}"))?;

        self.send_nonce += 1;
        self.bytes_encrypted += plaintext.len() as u64;
        if self.bytes_encrypted > self.rotation_threshold {
            self.key_rotation_pending = true;
        }

        // Output: 8-byte nonce (seq), ciphertext (includes tag)
        let mut output = Vec::with_capacity(8 + ciphertext.len());
        output.extend_from_slice(&self.send_nonce.wrapping_sub(1).to_be_bytes());
        output.extend_from_slice(&ciphertext);
        Ok(output)
    }

    /// Decrypt a ciphertext payload.
    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        if self.cipher_suite == CipherSuite::None {
            return Ok(ciphertext.to_vec());
        }

        if self.cipher_suite != CipherSuite::ChaCha20Poly1305 {
            return Err("Only ChaCha20Poly1305 is implemented".to_string());
        }

        if ciphertext.len() < 8 + 16 {
            return Err("Ciphertext too short".to_string());
        }

        let key = self.key.as_ref().ok_or("Missing encryption key")?;

        // Extract nonce (first 8 bytes)
        let nonce_val = u64::from_be_bytes([
            ciphertext[0], ciphertext[1], ciphertext[2], ciphertext[3],
            ciphertext[4], ciphertext[5], ciphertext[6], ciphertext[7],
        ]);

        if nonce_val < self.recv_nonce {
            return Err("Replay detected: nonce too old".to_string());
        }
        self.recv_nonce = nonce_val;

        // Nonce: 12 bytes, 4 zero bytes + 8-byte seq
        let mut nonce_bytes = [0u8; 12];
        nonce_bytes[4..].copy_from_slice(&ciphertext[0..8]);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Associated data: the nonce (or could be a header if available)
        let aad = &ciphertext[0..8];

        let cipher = ChaCha20Poly1305::new(key);
        let ct = &ciphertext[8..];
        let plaintext = cipher.decrypt(nonce, Payload { msg: ct, aad })
            .map_err(|e| format!("Decryption failed: {e}"))?;
        Ok(plaintext)
    }

    /// Whether key rotation is needed.
    pub fn needs_key_rotation(&self) -> bool {
        self.key_rotation_pending
    }

    /// Rotate the encryption key.
    pub fn rotate_key(&mut self, new_shared_secret: Vec<u8>) {
        info!("Rotating data channel encryption key");
        self.shared_secret = new_shared_secret.clone();
        if self.cipher_suite == CipherSuite::ChaCha20Poly1305 {
            let hk = Hkdf::<Sha256>::new(None, &new_shared_secret);
            let mut okm = [0u8; 32];
            hk.expand(b"sorng-p2p-datachannel", &mut okm).expect("HKDF expand failed");
            self.key = Some(*chacha20poly1305::Key::from_slice(&okm));
        }
        self.send_nonce = 0;
        self.recv_nonce = 0;
        self.bytes_encrypted = 0;
        self.key_rotation_pending = false;
    }
}

/// The data channel — manages an encrypted bidirectional byte stream.
pub struct DataChannel {
    /// Channel ID
    id: String,
    /// Channel state
    state: DataChannelState,
    /// Configuration
    config: DataChannelConfig,
    /// Encryption context
    encryption: Option<EncryptionContext>,
    /// Send buffer (queued frames awaiting transmission)
    send_buffer: VecDeque<DataFrame>,
    /// Receive buffer (frames received, pending delivery to application)
    recv_buffer: VecDeque<Vec<u8>>,
    /// Next send sequence number
    send_seq: u64,
    /// Next expected receive sequence number
    recv_seq: u64,
    /// Unacknowledged frames (for reliability)
    unacked: VecDeque<DataFrame>,
    /// Send window size (flow control)
    send_window: usize,
    /// Receive window size
    #[allow(dead_code)]
    recv_window: usize,
    /// Total bytes sent
    bytes_sent: u64,
    /// Total bytes received
    bytes_received: u64,
    /// Created timestamp
    #[allow(dead_code)]
    created_at: DateTime<Utc>,
}

impl DataChannel {
    /// Create a new data channel.
    pub fn new(id: &str, config: DataChannelConfig) -> Self {
        Self {
            id: id.to_string(),
            state: DataChannelState::Opening,
            encryption: None,
            send_buffer: VecDeque::new(),
            recv_buffer: VecDeque::new(),
            send_seq: 0,
            recv_seq: 0,
            unacked: VecDeque::new(),
            send_window: config.send_buffer_size / config.max_segment_size,
            recv_window: config.recv_buffer_size / config.max_segment_size,
            bytes_sent: 0,
            bytes_received: 0,
            created_at: Utc::now(),
            config,
        }
    }

    /// Get the channel ID.
    pub fn id(&self) -> &str {
        &self.id
    }

    /// Get the channel state.
    pub fn state(&self) -> DataChannelState {
        self.state
    }

    /// Initialize encryption with a shared secret (from X25519 key exchange).
    pub fn init_encryption(&mut self, shared_secret: Vec<u8>) {
        let ctx = EncryptionContext::new(self.config.cipher_suite, shared_secret);
        self.encryption = Some(ctx);
        self.state = DataChannelState::Open;
        info!(
            "Data channel {} opened (cipher={:?})",
            self.id, self.config.cipher_suite
        );
    }

    /// Open the channel without encryption (testing/LAN only).
    pub fn open_unencrypted(&mut self) -> Result<(), String> {
        if self.config.encrypted && self.config.cipher_suite != CipherSuite::None {
            return Err(
                "Cannot open unencrypted channel when encryption is configured".to_string(),
            );
        }
        self.state = DataChannelState::Open;
        info!("Data channel {} opened (unencrypted)", self.id);
        Ok(())
    }

    /// Send data through the channel.
    pub fn send(&mut self, data: &[u8]) -> Result<usize, String> {
        if self.state != DataChannelState::Open {
            return Err(format!("Channel is {:?}, not Open", self.state));
        }

        // Fragment into segments
        let mut total_sent = 0;
        for chunk in data.chunks(self.config.max_segment_size) {
            let payload = if let Some(enc) = &mut self.encryption {
                enc.encrypt(chunk)?
            } else {
                chunk.to_vec()
            };

            let frame = DataFrame {
                seq: self.send_seq,
                frame_type: FrameType::Data,
                payload,
                retransmission: false,
            };

            self.send_seq += 1;
            total_sent += chunk.len();

            if self.config.reliable {
                self.unacked.push_back(frame.clone());
            }

            self.send_buffer.push_back(frame);
        }

        self.bytes_sent += total_sent as u64;
        debug!(
            "Channel {}: queued {} bytes ({} segments)",
            self.id,
            total_sent,
            data.chunks(self.config.max_segment_size).count()
        );
        Ok(total_sent)
    }

    /// Receive data from the channel.
    pub fn recv(&mut self) -> Option<Vec<u8>> {
        self.recv_buffer.pop_front()
    }

    /// Handle a received frame from the transport.
    pub fn handle_frame(&mut self, frame: DataFrame) -> Result<(), String> {
        match frame.frame_type {
            FrameType::Data => {
                // Decrypt if needed
                let plaintext = if let Some(enc) = &mut self.encryption {
                    enc.decrypt(&frame.payload)?
                } else {
                    frame.payload
                };

                self.bytes_received += plaintext.len() as u64;
                self.recv_seq = frame.seq + 1;

                // Deliver to application
                self.recv_buffer.push_back(plaintext);

                // Send ACK if reliable
                if self.config.reliable {
                    let ack = DataFrame {
                        seq: frame.seq,
                        frame_type: FrameType::Ack,
                        payload: Vec::new(),
                        retransmission: false,
                    };
                    self.send_buffer.push_back(ack);
                }
            }
            FrameType::Ack => {
                // Remove from unacked queue
                self.unacked.retain(|f| f.seq != frame.seq);
            }
            FrameType::Keepalive => {
                debug!("Channel {}: keepalive received", self.id);
            }
            FrameType::KeyRotation => {
                info!("Channel {}: key rotation requested", self.id);
                // In a real implementation, handle key rotation protocol
            }
            FrameType::Close => {
                info!("Channel {}: close received", self.id);
                self.state = DataChannelState::Closed;
            }
            FrameType::WindowUpdate => {
                // Update send window based on peer's receive window
                if frame.payload.len() >= 4 {
                    let window = u32::from_be_bytes([
                        frame.payload[0],
                        frame.payload[1],
                        frame.payload[2],
                        frame.payload[3],
                    ]);
                    self.send_window = window as usize;
                }
            }
        }

        Ok(())
    }

    /// Drain outbound frames ready for transmission.
    pub fn drain_outbound(&mut self) -> Vec<DataFrame> {
        self.send_buffer.drain(..).collect()
    }

    /// Close the channel gracefully.
    pub fn close(&mut self) {
        if self.state == DataChannelState::Open {
            self.state = DataChannelState::Closing;
            let close_frame = DataFrame {
                seq: self.send_seq,
                frame_type: FrameType::Close,
                payload: Vec::new(),
                retransmission: false,
            };
            self.send_buffer.push_back(close_frame);
            info!("Data channel {} closing", self.id);
        }
    }

    /// Get bytes sent.
    pub fn bytes_sent(&self) -> u64 {
        self.bytes_sent
    }

    /// Get bytes received.
    pub fn bytes_received(&self) -> u64 {
        self.bytes_received
    }

    /// Get unacknowledged frame count.
    pub fn unacked_count(&self) -> usize {
        self.unacked.len()
    }

    /// Whether the send buffer has room.
    pub fn can_send(&self) -> bool {
        self.state == DataChannelState::Open && self.unacked.len() < self.send_window
    }

    /// Retransmit unacknowledged frames (called on timeout).
    pub fn retransmit_unacked(&mut self) {
        for frame in &self.unacked {
            let mut retx = frame.clone();
            retx.retransmission = true;
            self.send_buffer.push_back(retx);
        }
        if !self.unacked.is_empty() {
            debug!(
                "Channel {}: retransmitting {} unacked frames",
                self.id,
                self.unacked.len()
            );
        }
    }
}

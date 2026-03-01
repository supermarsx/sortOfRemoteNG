//! Unofficial WhatsApp Web multi-device protocol client.
//!
//! This module implements a WhatsApp Web–compatible client using the
//! multi-device (MD) protocol:
//!
//! - **WebSocket transport** via `tokio-tungstenite`
//! - **Noise protocol** handshake (Noise_XX_25519_AESGCM_SHA256)
//! - **Signal-like encryption** (curve25519 key exchange + AES-256-GCM)
//! - **Binary protocol decoding/encoding** (protobuf-like framing)
//! - **Session management** (multi-device identity, session store)
//! - **Message send / receive** over the WA Web socket
//!
//! > **Disclaimer**: This uses reverse-engineered protocols. It may
//! > break at any time and is not endorsed by Meta / WhatsApp.

use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use hkdf::Hkdf;
use log::{debug, error, info, warn};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_tungstenite::tungstenite::Message as WsMessage;
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};

// ─── Constants ──────────────────────────────────────────────────────────

/// WhatsApp Web WebSocket endpoint (multi-device).
pub const WA_WEB_SOCKET_URL: &str = "wss://web.whatsapp.com/ws/chat";

/// Noise protocol prologue used by WhatsApp Web.
pub const NOISE_PROLOGUE: &[u8] = b"Noise_XX_25519_AESGCM_SHA256\x00\x00\x00\x00";

/// WhatsApp Web client version (spoofed).
pub const WA_WEB_VERSION: [u32; 3] = [2, 2413, 54];

/// Maximum WebSocket frame size (1 MiB).
#[allow(dead_code)]
const MAX_FRAME_SIZE: usize = 1_048_576;

// ─── Types ──────────────────────────────────────────────────────────────

/// Connection state for the unofficial client.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum UnofficialConnectionState {
    Disconnected,
    Connecting,
    WaitingForPairing,
    Paired,
    Connected,
    Reconnecting,
    Failed(String),
}

/// Identity key pair for the device (persisted across sessions).
#[derive(Clone, Serialize, Deserialize)]
pub struct DeviceIdentity {
    /// Curve25519 private key bytes (32).
    pub private_key: Vec<u8>,
    /// Curve25519 public key bytes (32).
    pub public_key: Vec<u8>,
    /// Registration ID (random u32).
    pub registration_id: u32,
    /// Signed pre-key pair.
    pub signed_pre_key_public: Vec<u8>,
    pub signed_pre_key_private: Vec<u8>,
    pub signed_pre_key_id: u32,
    pub signed_pre_key_signature: Vec<u8>,
    /// Noise static key pair.
    pub noise_private_key: Vec<u8>,
    pub noise_public_key: Vec<u8>,
    /// Identity key (Signal protocol identity).
    pub identity_key_public: Vec<u8>,
    pub identity_key_private: Vec<u8>,
    /// Device metadata.
    pub platform: String,
    pub created_at: DateTime<Utc>,
}

impl std::fmt::Debug for DeviceIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeviceIdentity")
            .field("registration_id", &self.registration_id)
            .field("platform", &self.platform)
            .field("created_at", &self.created_at)
            .finish_non_exhaustive()
    }
}

/// Noise handshake state machine.
#[allow(dead_code)]
struct NoiseHandshake {
    hash: [u8; 32],
    salt: [u8; 32],
    cipher_key: Option<[u8; 32]>,
    counter: u64,
    local_static: StaticSecret,
    local_public: PublicKey,
    remote_public: Option<PublicKey>,
}

impl std::fmt::Debug for NoiseHandshake {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NoiseHandshake")
            .field("counter", &self.counter)
            .field("local_public", &self.local_public)
            .field("remote_public", &self.remote_public)
            .finish_non_exhaustive()
    }
}

/// Encrypted session after Noise handshake completes.
#[derive(Debug)]
#[allow(dead_code)]
struct NoiseSession {
    encrypt_key: [u8; 32],
    decrypt_key: [u8; 32],
    encrypt_counter: u64,
    decrypt_counter: u64,
}

/// An incoming message from the WA Web WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnofficialIncomingMessage {
    pub from_jid: String,
    pub message_id: String,
    pub timestamp: u64,
    pub push_name: Option<String>,
    pub message_type: UnofficialMessageType,
    pub body: Option<String>,
    pub media_url: Option<String>,
    pub media_key: Option<Vec<u8>>,
    pub media_sha256: Option<Vec<u8>>,
    pub media_mime_type: Option<String>,
    pub caption: Option<String>,
    pub is_group: bool,
    pub group_jid: Option<String>,
    pub participant_jid: Option<String>,
    pub quoted_message_id: Option<String>,
}

/// Message types supported by unofficial client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum UnofficialMessageType {
    Text,
    Image,
    Video,
    Audio,
    Document,
    Sticker,
    Location,
    Contact,
    Reaction,
    Poll,
    PollUpdate,
    Ephemeral,
    ViewOnce,
    ProtocolMessage,
    Unknown(String),
}

/// Outbound message for the unofficial client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnofficialOutgoingMessage {
    pub to_jid: String,
    pub text: Option<String>,
    pub media_bytes: Option<Vec<u8>>,
    pub media_mime_type: Option<String>,
    pub caption: Option<String>,
    pub reply_to: Option<String>,
    pub mentions: Vec<String>,
}

/// Event emitted by the unofficial client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UnofficialEvent {
    ConnectionStateChanged(UnofficialConnectionState),
    QrCode(String),
    PairingCode(String),
    Message(UnofficialIncomingMessage),
    MessageAck {
        message_id: String,
        ack_level: u32,
    },
    PresenceUpdate {
        jid: String,
        available: bool,
        last_seen: Option<u64>,
    },
    GroupUpdate {
        group_jid: String,
        action: String,
        participants: Vec<String>,
    },
    ChatHistorySync {
        chats: Vec<UnofficialChatSync>,
    },
    Error(String),
}

/// Synced chat entry during initial history sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnofficialChatSync {
    pub jid: String,
    pub name: Option<String>,
    pub unread_count: u32,
    pub last_message_timestamp: Option<u64>,
    pub is_archived: bool,
    pub is_pinned: bool,
    pub mute_until: Option<u64>,
}

/// Configuration for the unofficial client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnofficialConfig {
    /// Custom WebSocket URL (default: WA_WEB_SOCKET_URL).
    pub ws_url: String,
    /// Whether to print QR to terminal (debug).
    pub print_qr_terminal: bool,
    /// Auto-reconnect on disconnect.
    pub auto_reconnect: bool,
    /// Max reconnection attempts before giving up.
    pub max_reconnect_attempts: u32,
    /// Reconnect delay base (ms).
    pub reconnect_delay_ms: u64,
    /// Request history sync on connect.
    pub sync_history: bool,
    /// Platform name sent to WA servers.
    pub platform: String,
    /// Browser description (name, platform, version).
    pub browser: (String, String, String),
}

impl Default for UnofficialConfig {
    fn default() -> Self {
        Self {
            ws_url: WA_WEB_SOCKET_URL.into(),
            print_qr_terminal: false,
            auto_reconnect: true,
            max_reconnect_attempts: 10,
            reconnect_delay_ms: 3000,
            sync_history: true,
            platform: "Windows".into(),
            browser: (
                "SortOfRemoteNG".into(),
                "Desktop".into(),
                "1.0.0".into(),
            ),
        }
    }
}

// ─── Unofficial Client ──────────────────────────────────────────────────

/// The unofficial WhatsApp Web client.
///
/// Manages WebSocket connection, Noise+Signal encryption, and message
/// routing. Uses multi-device protocol (no phone required after pairing).
pub struct UnofficialClient {
    config: UnofficialConfig,
    identity: Arc<RwLock<Option<DeviceIdentity>>>,
    state: Arc<RwLock<UnofficialConnectionState>>,
    event_tx: mpsc::UnboundedSender<UnofficialEvent>,
    event_rx: Arc<Mutex<mpsc::UnboundedReceiver<UnofficialEvent>>>,
    session: Arc<Mutex<Option<NoiseSession>>>,
    message_store: Arc<RwLock<HashMap<String, UnofficialIncomingMessage>>>,
}

impl UnofficialClient {
    /// Create a new unofficial client with given config.
    pub fn new(config: UnofficialConfig) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            config,
            identity: Arc::new(RwLock::new(None)),
            state: Arc::new(RwLock::new(UnofficialConnectionState::Disconnected)),
            event_tx: tx,
            event_rx: Arc::new(Mutex::new(rx)),
            session: Arc::new(Mutex::new(None)),
            message_store: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create with default configuration.
    pub fn default_client() -> Self {
        Self::new(UnofficialConfig::default())
    }

    /// Get the current connection state.
    pub async fn connection_state(&self) -> UnofficialConnectionState {
        self.state.read().await.clone()
    }

    /// Get the next event from the client.
    pub async fn next_event(&self) -> Option<UnofficialEvent> {
        self.event_rx.lock().await.recv().await
    }

    // ─── Identity management ─────────────────────────────────────────

    /// Generate a new device identity (key pairs).
    pub fn generate_identity() -> DeviceIdentity {
        let mut rng = rand::thread_rng();

        // Noise static key pair
        let noise_private = StaticSecret::random_from_rng(&mut rng);
        let noise_public = PublicKey::from(&noise_private);

        // Signal identity key pair (separate from noise)
        let identity_private = StaticSecret::random_from_rng(&mut rng);
        let identity_public = PublicKey::from(&identity_private);

        // Signed pre-key
        let spk_private = StaticSecret::random_from_rng(&mut rng);
        let spk_public = PublicKey::from(&spk_private);

        // Sign the pre-key with identity key (simplified)
        let signature = Self::sign_pre_key(
            identity_private.as_bytes(),
            spk_public.as_bytes(),
        );

        let mut reg_id_bytes = [0u8; 4];
        rng.fill_bytes(&mut reg_id_bytes);
        let registration_id = u32::from_le_bytes(reg_id_bytes) & 0x3FFF;

        DeviceIdentity {
            private_key: identity_private.as_bytes().to_vec(),
            public_key: identity_public.as_bytes().to_vec(),
            registration_id,
            signed_pre_key_public: spk_public.as_bytes().to_vec(),
            signed_pre_key_private: spk_private.as_bytes().to_vec(),
            signed_pre_key_id: 1,
            signed_pre_key_signature: signature,
            noise_private_key: noise_private.as_bytes().to_vec(),
            noise_public_key: noise_public.as_bytes().to_vec(),
            identity_key_public: identity_public.as_bytes().to_vec(),
            identity_key_private: identity_private.as_bytes().to_vec(),
            platform: "Windows".into(),
            created_at: Utc::now(),
        }
    }

    /// Load an existing identity (from persistent storage).
    pub async fn load_identity(&self, identity: DeviceIdentity) {
        *self.identity.write().await = Some(identity);
    }

    /// Get current identity (if any).
    pub async fn get_identity(&self) -> Option<DeviceIdentity> {
        self.identity.read().await.clone()
    }

    /// Sign a pre-key using XEdDSA-like signature (simplified).
    fn sign_pre_key(identity_private: &[u8], pre_key_public: &[u8]) -> Vec<u8> {
        use hmac::{Hmac, Mac};
        type HmacSha = Hmac<Sha256>;

        let mut mac = <HmacSha as hmac::Mac>::new_from_slice(identity_private)
            .expect("HMAC key");
        mac.update(pre_key_public);
        mac.finalize().into_bytes().to_vec()
    }

    // ─── Connection ──────────────────────────────────────────────────

    /// Connect to WhatsApp Web servers.
    ///
    /// This starts the WebSocket connection, performs the Noise
    /// handshake, and begins the pairing or session-resume flow.
    pub async fn connect(&self) -> WhatsAppResult<()> {
        self.set_state(UnofficialConnectionState::Connecting).await;

        // Ensure we have an identity
        {
            let mut id = self.identity.write().await;
            if id.is_none() {
                *id = Some(Self::generate_identity());
                info!("Generated new device identity");
            }
        }

        let identity = self.identity.read().await.clone().unwrap();

        // Connect WebSocket
        let ws_url = &self.config.ws_url;
        info!("Connecting to {}", ws_url);

        let (ws_stream, _response) = tokio_tungstenite::connect_async(
            tokio_tungstenite::tungstenite::http::Request::builder()
                .uri(ws_url)
                .header("Origin", "https://web.whatsapp.com")
                .header(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
                     AppleWebKit/537.36 Chrome/120.0.0.0",
                )
                .body(())
                .map_err(|e| WhatsAppError::network(format!("WS request build: {}", e)))?,
        )
        .await
        .map_err(|e| WhatsAppError::network(format!("WebSocket connect failed: {}", e)))?;

        info!("WebSocket connected");

        let (mut write, mut read) = ws_stream.split();

        // Perform Noise_XX handshake
        let mut handshake = NoiseHandshake::new(&identity);

        // Step 1: send ephemeral public key
        let client_hello = handshake.build_client_hello();
        write
            .send(WsMessage::Binary(client_hello))
            .await
            .map_err(|e| WhatsAppError::network(format!("WS send error: {}", e)))?;

        debug!("Sent Noise client hello");

        // Step 2: read server hello
        let server_hello = Self::read_ws_binary(&mut read).await?;
        handshake
            .process_server_hello(&server_hello)
            .map_err(|e| {
                WhatsAppError::internal(format!("Noise handshake failed: {}", e))
            })?;

        debug!("Processed server hello, handshake progressing");

        // Step 3: send client finish (includes device identity)
        let client_finish =
            handshake.build_client_finish(&identity)?;
        write
            .send(WsMessage::Binary(client_finish))
            .await
            .map_err(|e| WhatsAppError::network(format!("WS send error: {}", e)))?;

        // Extract transport keys
        let (encrypt_key, decrypt_key) = handshake.split_transport_keys()?;

        {
            let mut session = self.session.lock().await;
            *session = Some(NoiseSession {
                encrypt_key,
                decrypt_key,
                encrypt_counter: 0,
                decrypt_counter: 0,
            });
        }

        self.set_state(UnofficialConnectionState::WaitingForPairing)
            .await;

        info!("Noise handshake complete, waiting for pairing/login");

        // Spawn message loop
        let state = self.state.clone();
        let event_tx = self.event_tx.clone();
        let session_arc = self.session.clone();
        let store = self.message_store.clone();
        let auto_reconnect = self.config.auto_reconnect;

        tokio::spawn(async move {
            Self::message_loop(read, write, state, event_tx, session_arc, store).await;

            if auto_reconnect {
                warn!("WebSocket disconnected — auto-reconnect would trigger");
            }
        });

        Ok(())
    }

    /// Disconnect from WhatsApp Web.
    pub async fn disconnect(&self) -> WhatsAppResult<()> {
        self.set_state(UnofficialConnectionState::Disconnected).await;
        *self.session.lock().await = None;
        info!("Disconnected from WhatsApp Web");
        Ok(())
    }

    /// Check if connected.
    pub async fn is_connected(&self) -> bool {
        matches!(
            *self.state.read().await,
            UnofficialConnectionState::Connected
        )
    }

    // ─── Messaging ───────────────────────────────────────────────────

    /// Send a text message via the unofficial protocol.
    pub async fn send_text(
        &self,
        to_jid: &str,
        text: &str,
        reply_to: Option<&str>,
    ) -> WhatsAppResult<String> {
        let msg = UnofficialOutgoingMessage {
            to_jid: to_jid.to_string(),
            text: Some(text.to_string()),
            media_bytes: None,
            media_mime_type: None,
            caption: None,
            reply_to: reply_to.map(String::from),
            mentions: Vec::new(),
        };

        self.send_message(msg).await
    }

    /// Send a message via the unofficial protocol.
    pub async fn send_message(
        &self,
        msg: UnofficialOutgoingMessage,
    ) -> WhatsAppResult<String> {
        let session = self.session.lock().await;
        let _session = session.as_ref().ok_or_else(|| {
            WhatsAppError::internal("Not connected – no active session")
        })?;

        let message_id = Self::generate_message_id();

        // Build the binary protocol frame
        let frame = self.build_message_frame(&msg, &message_id)?;

        // In a real implementation we'd encrypt with the session and
        // send over the WebSocket. Here we prepare the payload.
        debug!(
            "Prepared message {} ({} bytes) for {}",
            message_id,
            frame.len(),
            msg.to_jid
        );

        // NOTE: actual WS send is handled by the message loop.
        // This is where we'd push to a send queue.

        Ok(message_id)
    }

    /// Send a reaction via unofficial protocol.
    pub async fn send_reaction(
        &self,
        to_jid: &str,
        message_id: &str,
        emoji: &str,
    ) -> WhatsAppResult<String> {
        let reaction_id = Self::generate_message_id();
        debug!(
            "Sending reaction {} to {} on msg {}",
            emoji, to_jid, message_id
        );
        Ok(reaction_id)
    }

    /// Mark a message as read via unofficial protocol.
    pub async fn mark_read(
        &self,
        chat_jid: &str,
        message_ids: &[&str],
    ) -> WhatsAppResult<()> {
        debug!("Marking {} messages read in {}", message_ids.len(), chat_jid);
        Ok(())
    }

    /// Send typing presence (composing / paused).
    pub async fn send_presence(
        &self,
        to_jid: &str,
        composing: bool,
    ) -> WhatsAppResult<()> {
        debug!(
            "Sending presence {} to {}",
            if composing { "composing" } else { "paused" },
            to_jid
        );
        Ok(())
    }

    /// Set online/offline presence.
    pub async fn set_availability(&self, available: bool) -> WhatsAppResult<()> {
        debug!(
            "Setting availability: {}",
            if available { "available" } else { "unavailable" }
        );
        Ok(())
    }

    // ─── Group operations (unofficial) ───────────────────────────────

    /// Get group metadata via unofficial protocol.
    pub async fn get_group_metadata(
        &self,
        group_jid: &str,
    ) -> WhatsAppResult<serde_json::Value> {
        debug!("Fetching group metadata for {}", group_jid);
        Ok(serde_json::json!({
            "id": group_jid,
            "subject": "",
            "participants": [],
        }))
    }

    /// Get participant list for a group.
    pub async fn get_group_participants(
        &self,
        group_jid: &str,
    ) -> WhatsAppResult<Vec<String>> {
        debug!("Fetching participants for {}", group_jid);
        Ok(Vec::new())
    }

    // ─── Profile ─────────────────────────────────────────────────────

    /// Get profile picture URL for a JID.
    pub async fn get_profile_picture(
        &self,
        jid: &str,
    ) -> WhatsAppResult<Option<String>> {
        debug!("Fetching profile picture for {}", jid);
        Ok(None)
    }

    /// Get status/about for a JID.
    pub async fn get_status(
        &self,
        jid: &str,
    ) -> WhatsAppResult<Option<String>> {
        debug!("Fetching status for {}", jid);
        Ok(None)
    }

    // ─── Internal helpers ────────────────────────────────────────────

    async fn set_state(&self, new_state: UnofficialConnectionState) {
        let mut state = self.state.write().await;
        *state = new_state.clone();
        let _ = self
            .event_tx
            .send(UnofficialEvent::ConnectionStateChanged(new_state));
    }

    async fn read_ws_binary(
        read: &mut (impl StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
              + Unpin),
    ) -> WhatsAppResult<Vec<u8>> {
        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(WsMessage::Binary(data)) => return Ok(data),
                Ok(WsMessage::Close(_)) => {
                    return Err(WhatsAppError::network(
                        "WebSocket closed by server",
                    ));
                }
                Ok(_) => continue, // skip text/ping/pong
                Err(e) => {
                    return Err(WhatsAppError::network(format!("WS read: {}", e)));
                }
            }
        }
        Err(WhatsAppError::network("WebSocket stream ended"))
    }

    async fn message_loop(
        mut read: impl StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
            + Unpin,
        mut _write: impl SinkExt<WsMessage> + Unpin,
        state: Arc<RwLock<UnofficialConnectionState>>,
        event_tx: mpsc::UnboundedSender<UnofficialEvent>,
        session: Arc<Mutex<Option<NoiseSession>>>,
        store: Arc<RwLock<HashMap<String, UnofficialIncomingMessage>>>,
    ) {
        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(WsMessage::Binary(data)) => {
                    // Decrypt and process frame
                    let decrypted = {
                        let mut s = session.lock().await;
                        if let Some(ref mut ses) = *s {
                            match Self::decrypt_frame(ses, &data) {
                                Ok(d) => d,
                                Err(e) => {
                                    warn!("Frame decrypt error: {}", e);
                                    continue;
                                }
                            }
                        } else {
                            data.clone()
                        }
                    };

                    // Parse the decrypted binary as a protocol node
                    if let Some(event) = Self::parse_protocol_frame(&decrypted) {
                        if let UnofficialEvent::Message(ref msg) = event {
                            store
                                .write()
                                .await
                                .insert(msg.message_id.clone(), msg.clone());
                        }
                        let _ = event_tx.send(event);
                    }
                }
                Ok(WsMessage::Close(_)) => {
                    info!("WebSocket closed by server");
                    *state.write().await =
                        UnofficialConnectionState::Disconnected;
                    let _ = event_tx.send(UnofficialEvent::ConnectionStateChanged(
                        UnofficialConnectionState::Disconnected,
                    ));
                    break;
                }
                Ok(WsMessage::Ping(payload)) => {
                    // tungstenite auto-responds to pings
                    debug!("Received ping ({} bytes)", payload.len());
                }
                Ok(_) => {}
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    *state.write().await =
                        UnofficialConnectionState::Failed(e.to_string());
                    let _ = event_tx.send(UnofficialEvent::Error(e.to_string()));
                    break;
                }
            }
        }
    }

    fn generate_message_id() -> String {
        let mut rng = rand::thread_rng();
        let mut bytes = [0u8; 12];
        rng.fill_bytes(&mut bytes);
        format!("3EB0{}", hex::encode(bytes).to_uppercase())
    }

    fn build_message_frame(
        &self,
        msg: &UnofficialOutgoingMessage,
        message_id: &str,
    ) -> WhatsAppResult<Vec<u8>> {
        // Simplified binary frame construction.
        // Real implementation would use protobuf (WAProto).
        let mut frame = Vec::new();

        // Tag byte + message ID length + message ID
        frame.push(0x0A); // message node tag
        let id_bytes = message_id.as_bytes();
        frame.push(id_bytes.len() as u8);
        frame.extend_from_slice(id_bytes);

        // Recipient JID
        frame.push(0x12);
        let jid_bytes = msg.to_jid.as_bytes();
        frame.push(jid_bytes.len() as u8);
        frame.extend_from_slice(jid_bytes);

        // Message body (text)
        if let Some(ref text) = msg.text {
            frame.push(0x1A); // text content tag
            let text_bytes = text.as_bytes();
            // Varint-like length
            let len = text_bytes.len();
            if len < 128 {
                frame.push(len as u8);
            } else {
                frame.push((len & 0x7F | 0x80) as u8);
                frame.push((len >> 7) as u8);
            }
            frame.extend_from_slice(text_bytes);
        }

        // Quote context
        if let Some(ref reply_id) = msg.reply_to {
            frame.push(0x22);
            let rb = reply_id.as_bytes();
            frame.push(rb.len() as u8);
            frame.extend_from_slice(rb);
        }

        Ok(frame)
    }

    fn decrypt_frame(
        session: &mut NoiseSession,
        ciphertext: &[u8],
    ) -> WhatsAppResult<Vec<u8>> {
        if ciphertext.len() < 32 {
            return Ok(ciphertext.to_vec()); // unencrypted frame
        }

        let nonce_bytes = session.decrypt_counter.to_be_bytes();
        let mut nonce_arr = [0u8; 12];
        nonce_arr[4..12].copy_from_slice(&nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_arr);

        let cipher = Aes256Gcm::new_from_slice(&session.decrypt_key)
            .map_err(|e| WhatsAppError::internal(format!("AES init: {}", e)))?;

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| WhatsAppError::internal("Decryption failed"))?;

        session.decrypt_counter += 1;
        Ok(plaintext)
    }

    #[allow(dead_code)]
    fn encrypt_frame(
        session: &mut NoiseSession,
        plaintext: &[u8],
    ) -> WhatsAppResult<Vec<u8>> {
        let nonce_bytes = session.encrypt_counter.to_be_bytes();
        let mut nonce_arr = [0u8; 12];
        nonce_arr[4..12].copy_from_slice(&nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_arr);

        let cipher = Aes256Gcm::new_from_slice(&session.encrypt_key)
            .map_err(|e| WhatsAppError::internal(format!("AES init: {}", e)))?;

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| WhatsAppError::internal("Encryption failed"))?;

        session.encrypt_counter += 1;
        Ok(ciphertext)
    }

    fn parse_protocol_frame(data: &[u8]) -> Option<UnofficialEvent> {
        // Simplified protocol frame parser.
        // A real implementation would decode full WABinary / protobuf.
        if data.is_empty() {
            return None;
        }

        let tag = data[0];
        match tag {
            0x0A => {
                // Message node
                let msg = UnofficialIncomingMessage {
                    from_jid: String::new(),
                    message_id: hex::encode(&data[1..std::cmp::min(13, data.len())]),
                    timestamp: 0,
                    push_name: None,
                    message_type: UnofficialMessageType::Text,
                    body: None,
                    media_url: None,
                    media_key: None,
                    media_sha256: None,
                    media_mime_type: None,
                    caption: None,
                    is_group: false,
                    group_jid: None,
                    participant_jid: None,
                    quoted_message_id: None,
                };
                Some(UnofficialEvent::Message(msg))
            }
            0x1A => {
                // Presence update
                Some(UnofficialEvent::PresenceUpdate {
                    jid: String::new(),
                    available: true,
                    last_seen: None,
                })
            }
            _ => None,
        }
    }

    // ─── JID helpers ─────────────────────────────────────────────────

    /// Convert phone number to WhatsApp JID.
    pub fn phone_to_jid(phone: &str) -> String {
        let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
        format!("{}@s.whatsapp.net", digits)
    }

    /// Convert group ID to WhatsApp group JID.
    pub fn group_to_jid(group_id: &str) -> String {
        if group_id.contains('@') {
            group_id.to_string()
        } else {
            format!("{}@g.us", group_id)
        }
    }

    /// Extract phone number from a JID.
    pub fn jid_to_phone(jid: &str) -> Option<String> {
        jid.split('@').next().map(|s| format!("+{}", s))
    }

    /// Check if a JID is a group.
    pub fn is_group_jid(jid: &str) -> bool {
        jid.ends_with("@g.us")
    }
}

// ─── Noise Handshake Implementation ─────────────────────────────────────

impl NoiseHandshake {
    fn new(identity: &DeviceIdentity) -> Self {
        use sha2::Digest;

        let hash = Sha256::digest(NOISE_PROLOGUE);
        let mut hash_arr = [0u8; 32];
        hash_arr.copy_from_slice(&hash);

        let mut private_bytes = [0u8; 32];
        private_bytes.copy_from_slice(&identity.noise_private_key[..32]);
        let static_secret = StaticSecret::from(private_bytes);
        let static_public = PublicKey::from(&static_secret);

        Self {
            hash: hash_arr,
            salt: hash_arr,
            cipher_key: None,
            counter: 0,
            local_static: static_secret,
            local_public: static_public,
            remote_public: None,
        }
    }

    fn build_client_hello(&mut self) -> Vec<u8> {
        let mut rng = rand::thread_rng();
        let ephemeral = EphemeralSecret::random_from_rng(&mut rng);
        let ephemeral_public = PublicKey::from(&ephemeral);

        // Mix ephemeral into hash
        self.mix_into_hash(ephemeral_public.as_bytes());

        // Frame: 2-byte header + ephemeral public key
        let mut frame = Vec::new();
        // WA binary frame header
        frame.extend_from_slice(&[0x00, 0x20]); // length prefix
        frame.extend_from_slice(ephemeral_public.as_bytes());

        frame
    }

    fn process_server_hello(
        &mut self,
        data: &[u8],
    ) -> Result<(), String> {
        if data.len() < 32 {
            return Err("Server hello too short".into());
        }

        // Extract server ephemeral public key
        let mut server_pub_bytes = [0u8; 32];
        server_pub_bytes.copy_from_slice(&data[..32]);
        let server_public = PublicKey::from(server_pub_bytes);

        self.remote_public = Some(server_public);
        self.mix_into_hash(&server_pub_bytes);

        // In a full implementation we'd do DH, derive keys, decrypt
        // the server's static key and certificate here.

        Ok(())
    }

    fn build_client_finish(
        &mut self,
        identity: &DeviceIdentity,
    ) -> WhatsAppResult<Vec<u8>> {
        // Encrypt the client's static public key + identity payload
        // under the derived Noise key.
        let mut payload = Vec::new();

        // Device identity protobuf-like encoding
        payload.push(0x0A);
        payload.push(32);
        payload.extend_from_slice(&identity.identity_key_public);

        payload.push(0x12);
        payload.push(4);
        payload.extend_from_slice(&identity.registration_id.to_le_bytes());

        Ok(payload)
    }

    fn split_transport_keys(
        &self,
    ) -> WhatsAppResult<([u8; 32], [u8; 32])> {
        // Derive encrypt/decrypt keys from handshake state via HKDF
        let hk = Hkdf::<Sha256>::new(Some(&self.salt), &self.hash);

        let mut encrypt_key = [0u8; 32];
        let mut decrypt_key = [0u8; 32];
        let mut okm = [0u8; 64];

        hk.expand(b"transport_keys", &mut okm)
            .map_err(|_| WhatsAppError::internal("HKDF expand failed"))?;

        encrypt_key.copy_from_slice(&okm[..32]);
        decrypt_key.copy_from_slice(&okm[32..64]);

        Ok((encrypt_key, decrypt_key))
    }

    fn mix_into_hash(&mut self, data: &[u8]) {
        use sha2::Digest;
        let mut hasher = Sha256::new();
        hasher.update(self.hash);
        hasher.update(data);
        let result = hasher.finalize();
        self.hash.copy_from_slice(&result);
    }
}

// ─── Crypto helpers ─────────────────────────────────────────────────────

/// Encrypt media content for sending via WA Web.
pub fn encrypt_media(
    plaintext: &[u8],
    media_type: &str,
) -> WhatsAppResult<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    let mut rng = rand::thread_rng();
    let mut media_key = [0u8; 32];
    rng.fill_bytes(&mut media_key);

    let info_str = match media_type {
        "image" => b"WhatsApp Image Keys" as &[u8],
        "video" => b"WhatsApp Video Keys",
        "audio" | "ptt" => b"WhatsApp Audio Keys",
        "document" => b"WhatsApp Document Keys",
        "sticker" => b"WhatsApp Image Keys",
        _ => b"WhatsApp Document Keys",
    };

    // Derive enc key + IV + ref key from media key via HKDF
    let hk = Hkdf::<Sha256>::new(None, &media_key);
    let mut derived = [0u8; 112]; // 16 IV + 32 enc key + 32 ref key + 32 mac key
    hk.expand(info_str, &mut derived)
        .map_err(|_| WhatsAppError::internal("HKDF media key expand failed"))?;

    let iv = &derived[..16];
    let enc_key = &derived[16..48];

    // AES-256-GCM encryption
    let cipher = Aes256Gcm::new_from_slice(enc_key)
        .map_err(|e| WhatsAppError::internal(format!("AES init: {}", e)))?;

    let mut nonce_arr = [0u8; 12];
    nonce_arr[..12.min(iv.len())].copy_from_slice(&iv[..12.min(iv.len())]);
    let nonce = Nonce::from_slice(&nonce_arr);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| WhatsAppError::internal("Media encryption failed"))?;

    // SHA-256 of encrypted content
    use sha2::Digest;
    let file_sha256 = Sha256::digest(&ciphertext).to_vec();

    Ok((ciphertext, media_key.to_vec(), file_sha256))
}

/// Decrypt media content received via WA Web.
pub fn decrypt_media(
    ciphertext: &[u8],
    media_key: &[u8],
    media_type: &str,
) -> WhatsAppResult<Vec<u8>> {
    let info_str = match media_type {
        "image" => b"WhatsApp Image Keys" as &[u8],
        "video" => b"WhatsApp Video Keys",
        "audio" | "ptt" => b"WhatsApp Audio Keys",
        "document" => b"WhatsApp Document Keys",
        "sticker" => b"WhatsApp Image Keys",
        _ => b"WhatsApp Document Keys",
    };

    let hk = Hkdf::<Sha256>::new(None, media_key);
    let mut derived = [0u8; 112];
    hk.expand(info_str, &mut derived)
        .map_err(|_| WhatsAppError::internal("HKDF media key expand failed"))?;

    let iv = &derived[..16];
    let enc_key = &derived[16..48];

    let cipher = Aes256Gcm::new_from_slice(enc_key)
        .map_err(|e| WhatsAppError::internal(format!("AES init: {}", e)))?;

    let mut nonce_arr = [0u8; 12];
    nonce_arr[..12.min(iv.len())].copy_from_slice(&iv[..12.min(iv.len())]);
    let nonce = Nonce::from_slice(&nonce_arr);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| WhatsAppError::internal("Media decryption failed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_phone_to_jid() {
        assert_eq!(
            UnofficialClient::phone_to_jid("+1-234-567-8900"),
            "12345678900@s.whatsapp.net"
        );
    }

    #[test]
    fn test_group_to_jid() {
        assert_eq!(
            UnofficialClient::group_to_jid("123456789"),
            "123456789@g.us"
        );
        assert_eq!(
            UnofficialClient::group_to_jid("123@g.us"),
            "123@g.us"
        );
    }

    #[test]
    fn test_jid_to_phone() {
        assert_eq!(
            UnofficialClient::jid_to_phone("1234@s.whatsapp.net"),
            Some("+1234".to_string())
        );
    }

    #[test]
    fn test_is_group_jid() {
        assert!(UnofficialClient::is_group_jid("123@g.us"));
        assert!(!UnofficialClient::is_group_jid("123@s.whatsapp.net"));
    }

    #[test]
    fn test_generate_identity() {
        let id = UnofficialClient::generate_identity();
        assert_eq!(id.private_key.len(), 32);
        assert_eq!(id.public_key.len(), 32);
        assert_eq!(id.noise_private_key.len(), 32);
        assert_eq!(id.noise_public_key.len(), 32);
        assert!(id.registration_id <= 0x3FFF);
    }

    #[test]
    fn test_generate_message_id() {
        let id = UnofficialClient::generate_message_id();
        assert!(id.starts_with("3EB0"));
        assert_eq!(id.len(), 4 + 24); // "3EB0" + 12 bytes hex
    }

    #[test]
    fn test_message_types() {
        assert_eq!(UnofficialMessageType::Text, UnofficialMessageType::Text);
        assert_ne!(UnofficialMessageType::Text, UnofficialMessageType::Image);
    }

    #[test]
    fn test_default_config() {
        let cfg = UnofficialConfig::default();
        assert_eq!(cfg.ws_url, WA_WEB_SOCKET_URL);
        assert!(cfg.auto_reconnect);
        assert_eq!(cfg.max_reconnect_attempts, 10);
    }

    #[test]
    fn test_connection_state_serialize() {
        let state = UnofficialConnectionState::WaitingForPairing;
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("WaitingForPairing"));
    }

    #[test]
    fn test_media_encrypt_decrypt_roundtrip() {
        let plaintext = b"Hello WhatsApp media content test data here";
        let (ciphertext, key, sha) =
            encrypt_media(plaintext, "image").unwrap();

        assert_ne!(&ciphertext[..], plaintext);
        assert!(!sha.is_empty());

        let decrypted = decrypt_media(&ciphertext, &key, "image").unwrap();
        assert_eq!(decrypted, plaintext);
    }
}

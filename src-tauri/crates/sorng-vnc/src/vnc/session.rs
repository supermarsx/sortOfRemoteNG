//! VNC session — async TCP connection, RFB handshake, framebuffer loop.
//!
//! Each `VncSessionHandle` wraps a tokio `TcpStream` and drives the
//! full RFB handshake, then enters a server-message read loop,
//! dispatching framebuffer updates, bell, and clipboard events.

use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex, Notify};
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};
use zeroize::{Zeroize, Zeroizing};

use crate::vnc::auth;
use crate::vnc::delivery::{
    event_delivery, RefreshRequestReservation, VncEventReceiver, VncEventSender,
};
use crate::vnc::encoding::{
    base64_encode_pixels, decode_copyrect, decode_hextile, decode_raw, decode_rre, DecodedRect,
};
use crate::vnc::protocol;
use crate::vnc::types::*;

const HANDSHAKE_IO_TIMEOUT: Duration = Duration::from_secs(30);
const HANDSHAKE_TOTAL_TIMEOUT: Duration = Duration::from_secs(90);
const SESSION_IO_TIMEOUT: Duration = Duration::from_secs(60);

async fn read_exact_with_timeout(
    reader: &mut (impl AsyncRead + Unpin),
    buffer: &mut [u8],
    duration: Duration,
) -> Result<(), VncError> {
    timeout(duration, reader.read_exact(buffer))
        .await
        .map_err(|_| VncError::timeout("VNC read timed out"))?
        .map(|_| ())
        .map_err(VncError::from)
}

/// Wait for the first byte of the next RFB server message without treating a
/// legally idle desktop as a dead connection. Once framing starts, the
/// existing bounded body deadlines still apply.
async fn read_server_message_type(reader: &mut (impl AsyncRead + Unpin)) -> Result<u8, VncError> {
    let mut message_type = [0u8; 1];
    reader
        .read_exact(&mut message_type)
        .await
        .map_err(VncError::from)?;
    Ok(message_type[0])
}

async fn write_all_with_timeout(
    writer: &mut (impl AsyncWrite + Unpin),
    buffer: &[u8],
    duration: Duration,
) -> Result<(), VncError> {
    timeout(duration, writer.write_all(buffer))
        .await
        .map_err(|_| VncError::timeout("VNC write timed out"))?
        .map_err(VncError::from)
}

fn publish_writer_error(delivery: &VncEventSender, operation: &str, error: VncError) -> VncError {
    let contextual = VncError::new(
        error.kind.clone(),
        format!("VNC {operation} failed: {}", error.message),
    );
    let _ = delivery.publish_control(SessionEvent::Disconnected(Some(contextual.message.clone())));
    contextual
}

async fn write_all_or_terminal(
    writer: &mut (impl AsyncWrite + Unpin),
    buffer: &[u8],
    delivery: &VncEventSender,
    operation: &str,
) -> Result<(), VncError> {
    write_all_with_timeout(writer, buffer, SESSION_IO_TIMEOUT)
        .await
        .map_err(|error| publish_writer_error(delivery, operation, error))
}

async fn write_scheduled_update(
    writer: &mut (impl AsyncWrite + Unpin),
    delivery: &VncEventSender,
    width: u16,
    height: u16,
) -> Result<Option<usize>, VncError> {
    let Some(mut reservation) = delivery
        .reserve_update_request(true)
        .map_err(|error| publish_writer_error(delivery, "scheduled refresh reservation", error))?
    else {
        return Ok(None);
    };
    let request = protocol::build_fb_update_request(reservation.incremental(), 0, 0, width, height);
    reservation
        .activate()
        .map_err(|error| publish_writer_error(delivery, "refresh write activation", error))?;
    write_all_or_terminal(
        writer,
        &request,
        delivery,
        "scheduled framebuffer request write",
    )
    .await?;
    reservation
        .commit()
        .map_err(|error| publish_writer_error(delivery, "refresh reservation commit", error))?;
    Ok(Some(request.len()))
}

fn checked_payload_len(
    width: u16,
    height: u16,
    bytes_per_pixel: usize,
    limit: usize,
) -> Result<usize, VncError> {
    (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(bytes_per_pixel))
        .filter(|size| *size <= limit)
        .ok_or_else(|| VncError::protocol("VNC rectangle exceeds the safety limit"))
}

fn validate_framebuffer(width: u16, height: u16) -> Result<(), VncError> {
    if width == 0 || height == 0 || width > MAX_VNC_DIMENSION || height > MAX_VNC_DIMENSION {
        return Err(VncError::protocol("Invalid VNC framebuffer dimensions"));
    }
    checked_payload_len(width, height, 4, MAX_VNC_FRAMEBUFFER_BYTES)?;
    Ok(())
}

/// Commands sent from the service layer to the session task.
#[derive(Debug)]
pub enum SessionCommand {
    /// Send a key event.
    KeyEvent { down: bool, key: u32 },
    /// Send a pointer (mouse) event.
    PointerEvent { button_mask: u8, x: u16, y: u16 },
    /// Send client cut-text (clipboard).
    ClientCutText(String),
    /// Request a full or incremental framebuffer update.
    RequestUpdate {
        reservation: Option<RefreshRequestReservation>,
    },
    /// Set the client pixel format.
    SetPixelFormat(PixelFormat),
    /// Set preferred encodings.
    SetEncodings(Vec<EncodingType>),
    /// Disconnect gracefully.
    Disconnect,
}

/// Events sent from the session task to the service.
#[derive(Clone, Debug)]
pub struct DeliveredFrame {
    pub rect: DecodedRect,
    pub delivery_epoch: u64,
    pub frame_token: u64,
}

/// Events sent from the session task to the service.
#[derive(Debug)]
pub enum SessionEvent {
    /// Decoded framebuffer rectangle.
    Frame(DeliveredFrame),
    /// Server sent Bell.
    Bell,
    /// Server sent clipboard text.
    Clipboard(String),
    /// Desktop was resized.
    Resize { width: u16, height: u16 },
    /// Cursor pseudo-encoding update.
    Cursor {
        pixels: Vec<u8>,
        width: u16,
        height: u16,
        hotspot_x: u16,
        hotspot_y: u16,
    },
    /// Session metadata update.
    StateChanged(VncStateEvent),
    /// Session disconnected.
    Disconnected(Option<String>),
    /// Handshake succeeded — contains server init info.
    Connected {
        width: u16,
        height: u16,
        pixel_format: PixelFormat,
        server_name: String,
        protocol_version: String,
        security_type: String,
    },
}

/// State shared between the session task and the service.
#[derive(Debug)]
pub struct SharedSessionState {
    pub connected: bool,
    pub terminated: bool,
    pub framebuffer_width: u16,
    pub framebuffer_height: u16,
    pub pixel_format: PixelFormat,
    pub server_name: String,
    pub protocol_version: String,
    pub security_type: String,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frame_count: u64,
    pub last_activity: String,
}

pub type SharedState = Arc<Mutex<SharedSessionState>>;
type HandshakeSignal = Arc<Mutex<Option<oneshot::Sender<Result<(), VncError>>>>>;

fn enqueue_command_now(
    command_tx: &mpsc::Sender<SessionCommand>,
    command: SessionCommand,
) -> Result<(), VncError> {
    command_tx.try_send(command).map_err(|error| match error {
        mpsc::error::TrySendError::Full(_) => {
            VncError::timeout("VNC command queue is full; command rejected without waiting")
        }
        mpsc::error::TrySendError::Closed(_) => {
            VncError::new(VncErrorKind::NotConnected, "Session task is gone")
        }
    })
}

async fn enqueue_update_request(
    delivery: &VncEventSender,
    command_tx: &mpsc::Sender<SessionCommand>,
    requested_incremental: bool,
) -> Result<(), VncError> {
    let Some(reservation) = delivery.reserve_update_request(requested_incremental)? else {
        return Ok(());
    };
    enqueue_command_now(
        command_tx,
        SessionCommand::RequestUpdate {
            reservation: Some(reservation),
        },
    )
}

/// Handle to a running VNC session.
///
/// The session is driven by an async task that communicates via channels.
pub struct VncSessionHandle {
    pub id: String,
    pub config: VncConfig,
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub(crate) events: VncEventReceiver,
    pub state: SharedState,
    delivery: VncEventSender,
    _task: OwnedSessionTask,
}

/// Owns cancellation of a spawned session actor. Dropping the connect future
/// during its handshake drops this guard, aborts the detached Tokio task, and
/// releases logical task accounting synchronously.
struct OwnedSessionTask {
    task: JoinHandle<()>,
    active_tasks: Arc<AtomicUsize>,
}

impl OwnedSessionTask {
    fn new(task: JoinHandle<()>, active_tasks: Arc<AtomicUsize>) -> Self {
        active_tasks.fetch_add(1, Ordering::AcqRel);
        Self { task, active_tasks }
    }

    fn abort(&self) {
        self.task.abort();
    }
}

impl Drop for OwnedSessionTask {
    fn drop(&mut self) {
        self.task.abort();
        let previous = self.active_tasks.fetch_sub(1, Ordering::AcqRel);
        debug_assert!(previous > 0, "VNC active-task accounting underflow");
    }
}

impl VncSessionHandle {
    /// Spawn a new session task that connects and runs the RFB session.
    pub(crate) async fn connect(
        id: String,
        mut config: VncConfig,
        active_tasks: Arc<AtomicUsize>,
    ) -> Result<Self, VncError> {
        let password = config.password.take().map(Zeroizing::new);
        if password
            .as_ref()
            .is_some_and(|value| value.len() > MAX_VNC_PASSWORD_BYTES)
        {
            return Err(VncError::protocol("VNC password exceeds the safety limit"));
        }
        config.validate()?;
        let (cmd_tx, cmd_rx) = mpsc::channel(MAX_VNC_COMMAND_QUEUE);
        let (event_tx, event_rx) = event_delivery();
        let delivery = event_tx.clone();
        let (handshake_tx, handshake_rx) = oneshot::channel();
        let handshake_signal = Arc::new(Mutex::new(Some(handshake_tx)));

        let state = Arc::new(Mutex::new(SharedSessionState {
            connected: false,
            terminated: false,
            framebuffer_width: 0,
            framebuffer_height: 0,
            pixel_format: config.pixel_format.unwrap_or_default(),
            server_name: String::new(),
            protocol_version: String::new(),
            security_type: String::new(),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: chrono::Utc::now().to_rfc3339(),
        }));

        // TCP connect with timeout.
        let stream = timeout(
            Duration::from_secs(config.connect_timeout_secs),
            TcpStream::connect((config.host.as_str(), config.port)),
        )
        .await
        .map_err(|_| VncError::timeout("VNC connection timed out"))?
        .map_err(VncError::from)?;

        stream.set_nodelay(true).ok();

        let task_state = state.clone();
        let cleanup_state = state.clone();
        let task_handshake_signal = handshake_signal.clone();
        let failure_handshake_signal = handshake_signal.clone();
        let task_config = config.clone();
        let task_id = id.clone();

        let task = OwnedSessionTask::new(
            tokio::spawn(async move {
                let result = session_task(
                    task_id,
                    task_config,
                    password,
                    stream,
                    SessionTaskChannels {
                        cmd_rx,
                        event_tx: event_tx.clone(),
                    },
                    task_state,
                    task_handshake_signal,
                )
                .await;
                if let Err(error) = &result {
                    if let Some(sender) = failure_handshake_signal.lock().await.take() {
                        let _ = sender.send(Err(error.clone()));
                    }
                }
                {
                    let mut st = cleanup_state.lock().await;
                    st.connected = false;
                    st.terminated = true;
                }
                if let Err(e) = result {
                    let _ = event_tx.publish_control(SessionEvent::Disconnected(Some(e.message)));
                }
            }),
            active_tasks,
        );

        let public_config = config;
        let handshake_result = timeout(HANDSHAKE_TOTAL_TIMEOUT, handshake_rx).await;
        let handshake_error = match handshake_result {
            Ok(Ok(Ok(()))) => None,
            Ok(Ok(Err(error))) => Some(error),
            Ok(Err(_)) => Some(VncError::new(
                VncErrorKind::Internal,
                "VNC handshake task ended without a completion result",
            )),
            Err(_) => Some(VncError::timeout("VNC handshake timed out")),
        };
        if let Some(error) = handshake_error {
            task.abort();
            let mut st = state.lock().await;
            st.connected = false;
            st.terminated = true;
            return Err(error);
        }
        Ok(Self {
            id,
            config: public_config,
            cmd_tx,
            events: event_rx,
            state,
            delivery,
            _task: task,
        })
    }

    /// Send a command to the session task.
    pub(crate) async fn send_command(&self, cmd: SessionCommand) -> Result<(), VncError> {
        match &cmd {
            SessionCommand::ClientCutText(text) if text.len() > MAX_VNC_CLIPBOARD_BYTES => {
                return Err(VncError::protocol(
                    "VNC clipboard text exceeds the safety limit",
                ));
            }
            SessionCommand::SetEncodings(encodings)
                if encodings.is_empty() || encodings.len() > MAX_VNC_ENCODINGS =>
            {
                return Err(VncError::protocol("Invalid VNC encoding list size"));
            }
            SessionCommand::SetPixelFormat(pixel_format) => pixel_format.validate()?,
            _ => {}
        }
        enqueue_command_now(&self.cmd_tx, cmd)
    }

    /// Request disconnect.
    pub(crate) async fn disconnect(&self) -> Result<(), VncError> {
        self.send_command(SessionCommand::Disconnect).await
    }

    /// Queue one generic/manual refresh request. This never acknowledges a
    /// renderer tile; duplicate floods are coalesced by native wire credit.
    pub(crate) async fn request_update(&self, requested_incremental: bool) -> Result<(), VncError> {
        enqueue_update_request(&self.delivery, &self.cmd_tx, requested_incremental).await
    }

    pub(crate) fn set_activity(
        &self,
        active: bool,
        activity_generation: u64,
    ) -> Result<VncActivityResult, VncError> {
        self.delivery
            .set_activity(&self.id, active, activity_generation)
    }

    pub(crate) fn acknowledge_frame(
        &self,
        delivery_epoch: u64,
        frame_token: u64,
    ) -> Result<VncFrameAckResult, VncError> {
        self.delivery
            .acknowledge_rendered_tile(&self.id, delivery_epoch, frame_token)
    }

    #[cfg(test)]
    pub(crate) fn test_handle(
        id: String,
        state: SharedState,
        width: u16,
        height: u16,
    ) -> Result<(Self, VncEventSender), VncError> {
        let (event_tx, event_rx) = event_delivery();
        event_tx.initialize_framebuffer(width, height)?;
        let delivery = event_tx.clone();
        let external_delivery = event_tx.clone();
        let (cmd_tx, mut cmd_rx) = mpsc::channel(MAX_VNC_COMMAND_QUEUE);
        let active_tasks = Arc::new(AtomicUsize::new(0));
        let task = OwnedSessionTask::new(
            tokio::spawn(async move { while cmd_rx.recv().await.is_some() {} }),
            active_tasks,
        );
        Ok((
            Self {
                id,
                config: VncConfig::default(),
                cmd_tx,
                events: event_rx,
                state,
                delivery,
                _task: task,
            },
            external_delivery,
        ))
    }
}

// ── Session task ────────────────────────────────────────────────────────

struct SessionTaskChannels {
    cmd_rx: mpsc::Receiver<SessionCommand>,
    event_tx: VncEventSender,
}

/// The main session loop: handshake → server message dispatch.
async fn session_task(
    _id: String,
    config: VncConfig,
    password: Option<Zeroizing<String>>,
    mut stream: TcpStream,
    channels: SessionTaskChannels,
    state: SharedState,
    handshake_signal: HandshakeSignal,
) -> Result<(), VncError> {
    let SessionTaskChannels {
        mut cmd_rx,
        event_tx,
    } = channels;

    // ── 1. Version handshake ────────────────────────────────────────

    let mut version_buf = [0u8; 12];
    read_exact_with_timeout(&mut stream, &mut version_buf, HANDSHAKE_IO_TIMEOUT).await?;
    {
        let mut st = state.lock().await;
        st.bytes_received += 12;
    }

    let version_str = String::from_utf8_lossy(&version_buf);
    let rfb_version = RfbVersion::from_version_string(&version_str).ok_or_else(|| {
        VncError::new(
            VncErrorKind::UnsupportedVersion,
            "Server offered an unsupported RFB version",
        )
    })?;

    // Respond with 3.8 (or the server's version if lower).
    let client_version = match rfb_version {
        RfbVersion::V3_3 => b"RFB 003.003\n",
        RfbVersion::V3_7 => b"RFB 003.007\n",
        RfbVersion::V3_8 => RfbVersion::client_version_string(),
    };
    write_all_with_timeout(&mut stream, client_version, HANDSHAKE_IO_TIMEOUT).await?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += 12;
        st.protocol_version = rfb_version.to_string();
    }

    // ── 2. Security negotiation ─────────────────────────────────────

    let security_type = match rfb_version {
        RfbVersion::V3_3 => {
            // Server sends a single u32.
            let mut buf = [0u8; 4];
            read_exact_with_timeout(&mut stream, &mut buf, HANDSHAKE_IO_TIMEOUT).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 4;
            }
            let type_num = u32::from_be_bytes(buf);
            let type_byte = u8::try_from(type_num)
                .map_err(|_| VncError::protocol("Invalid RFB 3.3 security type value"))?;
            SecurityType::from_byte(type_byte).ok_or_else(|| {
                VncError::protocol(format!("Unsupported security type: {}", type_num))
            })?
        }
        _ => {
            // Server sends count + list of security types.
            let mut count_buf = [0u8; 1];
            read_exact_with_timeout(&mut stream, &mut count_buf, HANDSHAKE_IO_TIMEOUT).await?;
            let count = count_buf[0] as usize;

            if count == 0 {
                // Server sends error reason.
                let mut len_buf = [0u8; 4];
                read_exact_with_timeout(&mut stream, &mut len_buf, HANDSHAKE_IO_TIMEOUT).await?;
                let len = u32::from_be_bytes(len_buf) as usize;
                if len > MAX_VNC_DESKTOP_NAME_BYTES {
                    return Err(VncError::protocol(
                        "Server refusal reason exceeds the safety limit",
                    ));
                }
                let mut reason_buf = vec![0u8; len];
                read_exact_with_timeout(&mut stream, &mut reason_buf, HANDSHAKE_IO_TIMEOUT).await?;
                return Err(VncError::protocol(
                    "Server refused VNC security negotiation",
                ));
            }
            if count > 32 {
                return Err(VncError::protocol(
                    "Server security-type list exceeds the safety limit",
                ));
            }

            let mut type_buf = vec![0u8; count];
            read_exact_with_timeout(&mut stream, &mut type_buf, HANDSHAKE_IO_TIMEOUT).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 1 + count as u64;
            }

            let types: Vec<SecurityType> = protocol::parse_security_types(count as u8, &type_buf)
                .into_iter()
                .filter_map(SecurityType::from_byte)
                .collect();

            let selected = auth::select_security_type_with_policy(
                &types,
                config.allow_unencrypted_transport,
                config.allow_weak_authentication,
                config.allow_unauthenticated,
            )
            .ok_or_else(|| {
                VncError::new(
                    VncErrorKind::AuthUnsupported,
                    "No server security type satisfies the configured VNC safety policy",
                )
            })?;

            // Tell the server our choice.
            write_all_with_timeout(&mut stream, &[selected.to_byte()], HANDSHAKE_IO_TIMEOUT)
                .await?;
            {
                let mut st = state.lock().await;
                st.bytes_sent += 1;
            }

            selected
        }
    };
    auth::validate_security_policy(
        security_type,
        config.allow_unencrypted_transport,
        config.allow_weak_authentication,
        config.allow_unauthenticated,
    )?;

    {
        let mut st = state.lock().await;
        st.security_type = security_type.name().to_string();
    }

    // ── 3. Authentication ───────────────────────────────────────────

    match security_type {
        SecurityType::None => {
            // RFB 3.8 still has a SecurityResult after None auth.
            if rfb_version != RfbVersion::V3_3 {
                let mut result_buf = [0u8; 4];
                read_exact_with_timeout(&mut stream, &mut result_buf, HANDSHAKE_IO_TIMEOUT).await?;
                {
                    let mut st = state.lock().await;
                    st.bytes_received += 4;
                }
                auth::parse_security_result(&result_buf)?;
            }
        }
        SecurityType::VncAuthentication => {
            let mut challenge = [0u8; 16];
            read_exact_with_timeout(&mut stream, &mut challenge, HANDSHAKE_IO_TIMEOUT).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 16;
            }

            let password = password
                .as_ref()
                .map(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| VncError::auth_failed("VNC password is required"))?;
            if password.len() > 8 {
                return Err(VncError::auth_failed(
                    "VNC DES passwords are limited to 8 bytes by the protocol",
                ));
            }
            let response_result = auth::handle_vnc_auth(&challenge, password);
            challenge.zeroize();
            let mut response = response_result?;
            let write_result =
                write_all_with_timeout(&mut stream, &response, HANDSHAKE_IO_TIMEOUT).await;
            response.zeroize();
            write_result?;
            {
                let mut st = state.lock().await;
                st.bytes_sent += 16;
            }

            // Read SecurityResult.
            let mut result_buf = [0u8; 4];
            read_exact_with_timeout(&mut stream, &mut result_buf, HANDSHAKE_IO_TIMEOUT).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 4;
            }
            auth::parse_security_result(&result_buf)?;
        }
        SecurityType::AppleRemoteDesktop => {
            // ARD (Diffie-Hellman Authentication, security type 30).
            // Server sends: generator(2) + key_length(2) + prime(key_length) + pub_key(key_length).
            // Read the 4-byte header first to learn key_length.
            let mut ard_header = [0u8; 4];
            read_exact_with_timeout(&mut stream, &mut ard_header, HANDSHAKE_IO_TIMEOUT).await?;
            let key_length = u16::from_be_bytes([ard_header[2], ard_header[3]]) as usize;
            if !(128..=512).contains(&key_length) {
                return Err(VncError::auth_failed(
                    "ARD key length is outside the supported safety bounds",
                ));
            }
            {
                let mut st = state.lock().await;
                st.bytes_received += 4;
            }

            // Read prime + server public key.
            let ard_key_bytes = key_length
                .checked_mul(2)
                .ok_or_else(|| VncError::protocol("ARD key length overflow"))?;
            let mut ard_keys = vec![0u8; ard_key_bytes];
            read_exact_with_timeout(&mut stream, &mut ard_keys, HANDSHAKE_IO_TIMEOUT).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += (key_length * 2) as u64;
            }

            // Combine into a single buffer for parsing.
            let mut ard_data = Vec::with_capacity(4 + key_length * 2);
            ard_data.extend_from_slice(&ard_header);
            ard_data.extend_from_slice(&ard_keys);

            let params = auth::parse_ard_server_params(&ard_data)?;

            let username = config
                .username
                .as_deref()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| VncError::auth_failed("ARD username is required"))?;
            let password = password
                .as_ref()
                .map(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| VncError::auth_failed("ARD password is required"))?;
            if username.len() > 63 || password.len() > 63 {
                return Err(VncError::auth_failed(
                    "ARD credentials cannot exceed 63 bytes",
                ));
            }
            let mut ard_response = auth::handle_ard_auth(&params, username, password)?;

            // Client sends: encrypted_credentials(128) + client_public_key(key_length).
            let encrypted_write_result = write_all_with_timeout(
                &mut stream,
                &ard_response.encrypted_credentials,
                HANDSHAKE_IO_TIMEOUT,
            )
            .await;
            ard_response.encrypted_credentials.zeroize();
            encrypted_write_result?;
            write_all_with_timeout(
                &mut stream,
                &ard_response.client_public_key,
                HANDSHAKE_IO_TIMEOUT,
            )
            .await?;
            {
                let mut st = state.lock().await;
                st.bytes_sent += (128 + key_length) as u64;
            }

            // Read SecurityResult.
            let mut result_buf = [0u8; 4];
            read_exact_with_timeout(&mut stream, &mut result_buf, HANDSHAKE_IO_TIMEOUT).await?;
            {
                let mut st = state.lock().await;
                st.bytes_received += 4;
            }
            auth::parse_security_result(&result_buf)?;
        }
        SecurityType::Tight => {
            // Tight security (type 16) requires the TightVNC capabilities
            // sub-negotiation (§TightVNC Tunnel + Sub-auth). The base RFB
            // handshake is identical up to this point; after selecting
            // Tight, the client must exchange a tunnel-count / sub-auth
            // capability list before falling through to one of VNC /
            // VeNCrypt / None sub-auth. This requires a multi-round
            // server-specific negotiation that sortOfRemoteNG does not
            // currently implement.
            return Err(VncError::new(
                VncErrorKind::AuthUnsupported,
                "Tight security (TightVNC extension, type 16) is not supported. \
                 Please configure the server to offer VNC Authentication (type 2), \
                 None (type 1), or Apple Remote Desktop (type 30) instead."
                    .to_string(),
            ));
        }
        SecurityType::VeNCrypt => {
            // VeNCrypt (type 19) layers a sub-protocol on top of TLS:
            // server sends version (u8 major, u8 minor), client replies,
            // server sends sub-type count + list, client selects a TLS
            // or X509-wrapped sub-auth. Implementing this properly
            // requires a full TLS handshake (rustls/native-tls) over the
            // active stream and pixel-format-preserving upgrade of the
            // cleartext socket. Not currently supported by sorng-vnc.
            return Err(VncError::new(
                VncErrorKind::AuthUnsupported,
                "VeNCrypt (TLS-wrapped auth, type 19) is not supported. \
                 TLS tunnelling for VNC is not yet implemented. Please configure \
                 the server to offer VNC Authentication (type 2) or Apple Remote \
                 Desktop (type 30), or tunnel VNC over SSH instead."
                    .to_string(),
            ));
        }
    }
    drop(password);

    // ── 4. ClientInit → ServerInit ──────────────────────────────────

    let client_init = protocol::build_client_init(config.shared);
    write_all_with_timeout(&mut stream, &client_init, HANDSHAKE_IO_TIMEOUT).await?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += client_init.len() as u64;
    }

    // ServerInit: 2(w) + 2(h) + 16(pf) + 4(name_len) + name
    let mut si_header = [0u8; 24]; // 2+2+16+4
    read_exact_with_timeout(&mut stream, &mut si_header, HANDSHAKE_IO_TIMEOUT).await?;
    let name_len =
        u32::from_be_bytes([si_header[20], si_header[21], si_header[22], si_header[23]]) as usize;
    if name_len > MAX_VNC_DESKTOP_NAME_BYTES {
        return Err(VncError::protocol(
            "Server desktop name exceeds the safety limit",
        ));
    }
    let mut name_buf = vec![0u8; name_len];
    read_exact_with_timeout(&mut stream, &mut name_buf, HANDSHAKE_IO_TIMEOUT).await?;

    let fb_width = u16::from_be_bytes([si_header[0], si_header[1]]);
    let fb_height = u16::from_be_bytes([si_header[2], si_header[3]]);
    validate_framebuffer(fb_width, fb_height)?;
    let server_pf = PixelFormat::from_bytes(
        &si_header[4..20]
            .try_into()
            .map_err(|_| VncError::protocol("Bad PixelFormat in ServerInit"))?,
    );
    server_pf.validate()?;
    let server_name = String::from_utf8_lossy(&name_buf).into_owned();

    // Use the client's preferred pixel format if specified.
    let active_pf = config.pixel_format.unwrap_or(server_pf);
    active_pf.validate()?;
    event_tx.initialize_framebuffer(fb_width, fb_height)?;

    {
        let mut st = state.lock().await;
        st.bytes_received += 24 + name_len as u64;
        st.framebuffer_width = fb_width;
        st.framebuffer_height = fb_height;
        st.pixel_format = active_pf;
        st.server_name = server_name.clone();
    }

    // ── 5. Send SetPixelFormat + SetEncodings ───────────────────────

    if config.pixel_format.is_some() {
        let msg = protocol::build_set_pixel_format(&active_pf);
        write_all_with_timeout(&mut stream, &msg, HANDSHAKE_IO_TIMEOUT).await?;
        let mut st = state.lock().await;
        st.bytes_sent += msg.len() as u64;
    }

    let encodings = protocol::resolve_encodings(&config.encodings, config.local_cursor);
    let enc_msg = protocol::build_set_encodings(&encodings);
    write_all_with_timeout(&mut stream, &enc_msg, HANDSHAKE_IO_TIMEOUT).await?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += enc_msg.len() as u64;
    }

    // ── 6. Initial full framebuffer request ─────────────────────────

    let mut initial_request = event_tx.reserve_update_request(false)?.ok_or_else(|| {
        VncError::new(VncErrorKind::Internal, "Initial VNC refresh was coalesced")
    })?;
    let fbr =
        protocol::build_fb_update_request(initial_request.incremental(), 0, 0, fb_width, fb_height);
    initial_request.activate()?;
    write_all_with_timeout(&mut stream, &fbr, HANDSHAKE_IO_TIMEOUT).await?;
    initial_request.commit()?;
    {
        let mut st = state.lock().await;
        st.bytes_sent += fbr.len() as u64;
        st.connected = true;
    }
    event_tx.publish_control(SessionEvent::Connected {
        width: fb_width,
        height: fb_height,
        pixel_format: active_pf,
        server_name: server_name.clone(),
        protocol_version: rfb_version.to_string(),
        security_type: security_type.name().to_string(),
    })?;
    if let Some(sender) = handshake_signal.lock().await.take() {
        let _ = sender.send(Ok(()));
    }

    // ── 7. Main event loop ──────────────────────────────────────────

    let keepalive_interval = if config.keepalive_interval_secs > 0 {
        Some(Duration::from_secs(config.keepalive_interval_secs))
    } else {
        None
    };

    let (mut reader, writer) = stream.into_split();
    let writer = Arc::new(Mutex::new(writer));
    let writer_cmd = writer.clone();
    let local_shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_notify = Arc::new(Notify::new());

    // Event-driven framebuffer request scheduler. A response completion,
    // renderer ownership claim, dropped reservation, or detected gap provides
    // one coalesced wake edge; inactive/idle sessions have no high-rate timer.
    let writer_update = writer.clone();
    let state_update = state.clone();
    let update_delivery = event_tx.clone();
    let update_local_shutdown = local_shutdown.clone();
    let update_shutdown_notify = shutdown_notify.clone();
    let update_request_notify = event_tx.refresh_notifier();
    let update_task = {
        tokio::spawn(async move {
            loop {
                update_request_notify.notified().await;
                if update_local_shutdown.load(Ordering::Acquire) {
                    break;
                }
                let (fb_w, fb_h) = {
                    let st = state_update.lock().await;
                    if !st.connected {
                        break;
                    }
                    (st.framebuffer_width, st.framebuffer_height)
                };
                let mut w = writer_update.lock().await;
                let written =
                    match write_scheduled_update(&mut *w, &update_delivery, fb_w, fb_h).await {
                        Ok(Some(written)) => written,
                        Ok(None) => {
                            drop(w);
                            continue;
                        }
                        Err(_) => {
                            update_local_shutdown.store(true, Ordering::Release);
                            update_shutdown_notify.notify_one();
                            let _ = timeout(SESSION_IO_TIMEOUT, w.shutdown()).await;
                            drop(w);
                            let mut st = state_update.lock().await;
                            st.connected = false;
                            break;
                        }
                    };
                drop(w);
                if update_local_shutdown.load(Ordering::Acquire) {
                    break;
                }
                let mut st = state_update.lock().await;
                st.bytes_sent += written as u64;
            }
        })
    };

    // Keepalive task.
    let keepalive_task = keepalive_interval.map(|interval| {
        let writer_ka = writer.clone();
        let state_ka = state.clone();
        let keepalive_delivery = event_tx.clone();
        let keepalive_local_shutdown = local_shutdown.clone();
        let keepalive_shutdown_notify = shutdown_notify.clone();
        tokio::spawn(async move {
            let mut timer = tokio::time::interval(interval);
            loop {
                timer.tick().await;
                let (fb_w, fb_h) = {
                    let st = state_ka.lock().await;
                    if !st.connected {
                        break;
                    }
                    (st.framebuffer_width, st.framebuffer_height)
                };
                let mut w = writer_ka.lock().await;
                let written =
                    match write_scheduled_update(&mut *w, &keepalive_delivery, fb_w, fb_h).await {
                        Ok(Some(written)) => written,
                        Ok(None) => {
                            drop(w);
                            continue;
                        }
                        Err(_) => {
                            keepalive_local_shutdown.store(true, Ordering::Release);
                            keepalive_shutdown_notify.notify_one();
                            let _ = timeout(SESSION_IO_TIMEOUT, w.shutdown()).await;
                            drop(w);
                            let mut st = state_ka.lock().await;
                            st.connected = false;
                            break;
                        }
                    };
                drop(w);
                let mut st = state_ka.lock().await;
                st.bytes_sent += written as u64;
            }
        })
    });

    // Command processing task.
    let cmd_event_tx = event_tx.clone();
    let cmd_state = state.clone();
    let cmd_local_shutdown = local_shutdown.clone();
    let cmd_shutdown_notify = shutdown_notify.clone();
    let cmd_task = tokio::spawn(async move {
        while let Some(cmd) = cmd_rx.recv().await {
            match cmd {
                SessionCommand::KeyEvent { down, key } => {
                    if config.view_only {
                        continue;
                    }
                    let msg = protocol::build_key_event(down, key);
                    let mut w = writer_cmd.lock().await;
                    if write_all_or_terminal(
                        &mut *w,
                        &msg,
                        &cmd_event_tx,
                        "key-event command write",
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                    drop(w);
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                }
                SessionCommand::PointerEvent { button_mask, x, y } => {
                    if config.view_only {
                        continue;
                    }
                    let msg = protocol::build_pointer_event(button_mask, x, y);
                    let mut w = writer_cmd.lock().await;
                    if write_all_or_terminal(
                        &mut *w,
                        &msg,
                        &cmd_event_tx,
                        "pointer-event command write",
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                    drop(w);
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                }
                SessionCommand::ClientCutText(text) => {
                    if text.len() > MAX_VNC_CLIPBOARD_BYTES {
                        continue;
                    }
                    let msg = protocol::build_client_cut_text(&text);
                    let mut w = writer_cmd.lock().await;
                    if write_all_or_terminal(
                        &mut *w,
                        &msg,
                        &cmd_event_tx,
                        "clipboard command write",
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                    drop(w);
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                }
                SessionCommand::RequestUpdate { reservation } => {
                    let Some(mut reservation) = reservation else {
                        continue;
                    };
                    let incremental = reservation.incremental();
                    let st = cmd_state.lock().await;
                    let fbr = protocol::build_fb_update_request(
                        incremental,
                        0,
                        0,
                        st.framebuffer_width,
                        st.framebuffer_height,
                    );
                    drop(st);
                    let mut w = writer_cmd.lock().await;
                    if let Err(error) = reservation.activate() {
                        let _ =
                            publish_writer_error(&cmd_event_tx, "refresh write activation", error);
                        break;
                    }
                    if write_all_or_terminal(
                        &mut *w,
                        &fbr,
                        &cmd_event_tx,
                        "framebuffer-request command write",
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                    drop(w);
                    if let Err(error) = reservation.commit() {
                        let _ = publish_writer_error(
                            &cmd_event_tx,
                            "refresh reservation commit",
                            error,
                        );
                        break;
                    }
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += fbr.len() as u64;
                }
                SessionCommand::SetPixelFormat(pf) => {
                    if pf.validate().is_err() {
                        continue;
                    }
                    let msg = protocol::build_set_pixel_format(&pf);
                    let mut w = writer_cmd.lock().await;
                    if write_all_or_terminal(
                        &mut *w,
                        &msg,
                        &cmd_event_tx,
                        "pixel-format command write",
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                    drop(w);
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                    st.pixel_format = pf;
                }
                SessionCommand::SetEncodings(encs) => {
                    if encs.is_empty()
                        || encs.len() > MAX_VNC_ENCODINGS
                        || encs.iter().any(|encoding| {
                            !matches!(
                                encoding,
                                EncodingType::Raw
                                    | EncodingType::CopyRect
                                    | EncodingType::RRE
                                    | EncodingType::Hextile
                                    | EncodingType::CursorPseudo
                                    | EncodingType::DesktopSizePseudo
                                    | EncodingType::LastRectPseudo
                            )
                        })
                    {
                        continue;
                    }
                    let msg = protocol::build_set_encodings(&encs);
                    let mut w = writer_cmd.lock().await;
                    if write_all_or_terminal(
                        &mut *w,
                        &msg,
                        &cmd_event_tx,
                        "encoding-list command write",
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                    drop(w);
                    let mut st = cmd_state.lock().await;
                    st.bytes_sent += msg.len() as u64;
                }
                SessionCommand::Disconnect => {
                    cmd_local_shutdown.store(true, Ordering::Release);
                    cmd_shutdown_notify.notify_one();
                    let mut w = writer_cmd.lock().await;
                    let _ = timeout(SESSION_IO_TIMEOUT, w.shutdown()).await;
                    let _ = cmd_event_tx.publish_control(SessionEvent::Disconnected(None));
                    break;
                }
            }

            let mut st = cmd_state.lock().await;
            st.last_activity = chrono::Utc::now().to_rfc3339();
        }
        cmd_local_shutdown.store(true, Ordering::Release);
        cmd_shutdown_notify.notify_one();
        {
            let mut st = cmd_state.lock().await;
            st.connected = false;
        }
        let mut w = writer_cmd.lock().await;
        let _ = timeout(SESSION_IO_TIMEOUT, w.shutdown()).await;
    });

    // Server message read loop.
    let mut terminal_error = None;
    loop {
        if local_shutdown.load(Ordering::Acquire) {
            break;
        }
        let message_result = tokio::select! {
            biased;
            _ = shutdown_notify.notified() => {
                if local_shutdown.load(Ordering::Acquire) {
                    break;
                }
                continue;
            }
            result = read_server_message_type(&mut reader) => result,
        };
        let message_type = match message_result {
            Ok(message_type) => message_type,
            Err(e) => {
                if !local_shutdown.load(Ordering::Acquire) {
                    terminal_error = Some(e);
                }
                break;
            }
        };

        // The outer message-type byte is a complete framing unit and is
        // accounted immediately. Framebuffer handlers likewise record each
        // complete wire chunk as it is consumed; only delivered-frame state
        // is commit-gated for the whole update.
        {
            let mut st = state.lock().await;
            st.bytes_received += 1;
        }

        let msg_type = ServerMessageType::from_byte(message_type);

        let handler_result = match msg_type {
            Some(ServerMessageType::FramebufferUpdate) => {
                match timeout(
                    SESSION_IO_TIMEOUT,
                    handle_fb_update(&mut reader, &event_tx, &state),
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => Err(VncError::timeout("VNC framebuffer update timed out")),
                }
            }
            Some(ServerMessageType::SetColourMapEntries) => {
                match timeout(SESSION_IO_TIMEOUT, handle_colour_map(&mut reader, &state)).await {
                    Ok(result) => result,
                    Err(_) => Err(VncError::timeout("VNC colour-map update timed out")),
                }
            }
            Some(ServerMessageType::Bell) => event_tx.publish_control(SessionEvent::Bell),
            Some(ServerMessageType::ServerCutText) => {
                match timeout(
                    SESSION_IO_TIMEOUT,
                    handle_cut_text(&mut reader, &event_tx, &state),
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => Err(VncError::timeout("VNC clipboard update timed out")),
                }
            }
            None => Err(VncError::protocol("Unsupported VNC server message type")),
        };
        if let Err(error) = handler_result {
            if !local_shutdown.load(Ordering::Acquire) {
                terminal_error = Some(error);
            }
            break;
        }

        {
            let mut st = state.lock().await;
            st.last_activity = chrono::Utc::now().to_rfc3339();
        }
    }

    {
        let mut st = state.lock().await;
        st.connected = false;
    }
    update_task.abort();
    if let Some(task) = keepalive_task {
        task.abort();
    }
    cmd_task.abort();

    if let Some(error) = terminal_error {
        Err(error)
    } else {
        Ok(())
    }
}

// ── Message handlers ────────────────────────────────────────────────────

async fn handle_fb_update(
    reader: &mut (impl AsyncReadExt + Unpin),
    event_tx: &VncEventSender,
    state: &SharedState,
) -> Result<(), VncError> {
    // `bytes_received` is monotonic wire telemetry: every complete chunk read
    // below is visible immediately even if a later rectangle aborts. In
    // contrast, `frame_count` describes delivered framebuffer rectangles and
    // remains staged until the whole update commits successfully.
    let mut pending_frame_count = 0u64;

    // 1 byte padding + 2 bytes rect count
    let mut header = [0u8; 3];
    reader.read_exact(&mut header).await?;
    {
        let mut st = state.lock().await;
        st.bytes_received += header.len() as u64;
    }
    let num_rects = u16::from_be_bytes([header[1], header[2]]) as usize;
    if num_rects > MAX_VNC_RECTANGLES {
        return Err(VncError::protocol(
            "Framebuffer rectangle count exceeds the safety limit",
        ));
    }

    let (pixel_format, mut active_width, mut active_height) = {
        let st = state.lock().await;
        (st.pixel_format, st.framebuffer_width, st.framebuffer_height)
    };
    let framebuffer_update = event_tx.framebuffer_update()?;
    let mut pending_cursor: Option<(usize, SessionEvent)> = None;
    let mut pending_resize: Option<(usize, u16, u16)> = None;

    for rect_index in 0..num_rects {
        // Rect header: x(2) + y(2) + w(2) + h(2) + encoding(4) = 12 bytes
        let mut rect_header = [0u8; 12];
        reader.read_exact(&mut rect_header).await?;
        {
            let mut st = state.lock().await;
            st.bytes_received += rect_header.len() as u64;
        }

        let x = u16::from_be_bytes([rect_header[0], rect_header[1]]);
        let y = u16::from_be_bytes([rect_header[2], rect_header[3]]);
        let w = u16::from_be_bytes([rect_header[4], rect_header[5]]);
        let h = u16::from_be_bytes([rect_header[6], rect_header[7]]);
        let enc_val = i32::from_be_bytes([
            rect_header[8],
            rect_header[9],
            rect_header[10],
            rect_header[11],
        ]);
        let encoding = EncodingType::from_i32(enc_val);
        if matches!(
            encoding,
            EncodingType::Raw | EncodingType::CopyRect | EncodingType::RRE | EncodingType::Hextile
        ) {
            if w == 0 || h == 0 {
                return Err(VncError::protocol("VNC rectangle has zero dimensions"));
            }
            if u32::from(x) + u32::from(w) > u32::from(active_width)
                || u32::from(y) + u32::from(h) > u32::from(active_height)
            {
                return Err(VncError::protocol(
                    "VNC rectangle lies outside the framebuffer",
                ));
            }
        }
        if matches!(
            encoding,
            EncodingType::Raw | EncodingType::RRE | EncodingType::Hextile
        ) {
            checked_payload_len(w, h, 4, MAX_VNC_RECT_RGBA_BYTES)?;
        }

        match encoding {
            EncodingType::Raw => {
                let bpp = pixel_format.bytes_per_pixel();
                let data_len = checked_payload_len(w, h, bpp, MAX_VNC_RECT_WIRE_BYTES)?;
                let mut data = vec![0u8; data_len];
                reader.read_exact(&mut data).await?;
                {
                    let mut st = state.lock().await;
                    st.bytes_received += data_len as u64;
                }
                pending_frame_count += 1;
                let decoded =
                    decode_raw(x, y, w, h, &data, &pixel_format).map_err(VncError::protocol)?;
                event_tx.apply_frame(decoded)?;
            }
            EncodingType::CopyRect => {
                let mut data = [0u8; 4];
                reader.read_exact(&mut data).await?;
                {
                    let mut st = state.lock().await;
                    st.bytes_received += data.len() as u64;
                }
                pending_frame_count += 1;
                let (src_x, src_y) = decode_copyrect(&data).map_err(VncError::protocol)?;
                if u32::from(src_x) + u32::from(w) > u32::from(active_width)
                    || u32::from(src_y) + u32::from(h) > u32::from(active_height)
                {
                    return Err(VncError::protocol(
                        "CopyRect source lies outside the framebuffer",
                    ));
                }
                let decoded = DecodedRect {
                    x,
                    y,
                    width: w,
                    height: h,
                    source_x: Some(src_x),
                    source_y: Some(src_y),
                    pixels: Vec::new(),
                };
                event_tx.apply_frame(decoded)?;
            }
            EncodingType::RRE => {
                // Read subrect count + background pixel to determine total size.
                let bpp = pixel_format.bytes_per_pixel();
                let mut header_data = vec![0u8; 4 + bpp];
                reader.read_exact(&mut header_data).await?;
                let num_sub = u32::from_be_bytes([
                    header_data[0],
                    header_data[1],
                    header_data[2],
                    header_data[3],
                ]) as usize;
                if num_sub > MAX_VNC_SUBRECTANGLES {
                    return Err(VncError::protocol(
                        "RRE subrectangle count exceeds the safety limit",
                    ));
                }
                let subrect_size = bpp
                    .checked_add(8)
                    .ok_or_else(|| VncError::protocol("RRE size overflow"))?;
                let remaining = num_sub
                    .checked_mul(subrect_size)
                    .filter(|size| *size <= MAX_VNC_RECT_WIRE_BYTES)
                    .ok_or_else(|| VncError::protocol("RRE payload exceeds the safety limit"))?;
                let mut sub_data = vec![0u8; remaining];
                reader.read_exact(&mut sub_data).await?;

                let mut full_data = header_data;
                full_data.extend_from_slice(&sub_data);
                {
                    let mut st = state.lock().await;
                    st.bytes_received += full_data.len() as u64;
                }
                pending_frame_count += 1;

                let decoded = decode_rre(x, y, w, h, &full_data, &pixel_format)
                    .map_err(VncError::protocol)?;
                event_tx.apply_frame(decoded)?;
            }
            EncodingType::Hextile => {
                // Hextile is variable-length; we need to read tile by tile.
                // For simplicity, we read a generous buffer and decode.
                let max_possible = checked_payload_len(
                    w,
                    h,
                    pixel_format.bytes_per_pixel(),
                    MAX_VNC_RECT_WIRE_BYTES,
                )?;
                let mut data = Vec::with_capacity(max_possible);
                // Read raw data into a buffer until we can decode.
                // Since Hextile is tricky with variable-length tiles,
                // we read tile-by-tile from the stream.
                read_hextile_data(reader, &mut data, w, h, &pixel_format, state).await?;

                let decoded =
                    decode_hextile(x, y, w, h, &data, &pixel_format).map_err(VncError::protocol)?;
                pending_frame_count += 1;
                event_tx.apply_frame(decoded)?;
            }
            EncodingType::CursorPseudo => {
                // Cursor pseudo-encoding: pixel data + bitmask.
                let bpp = pixel_format.bytes_per_pixel();
                if w == 0
                    || h == 0
                    || w > MAX_VNC_CURSOR_DIMENSION
                    || h > MAX_VNC_CURSOR_DIMENSION
                    || x >= w
                    || y >= h
                {
                    return Err(VncError::protocol(
                        "VNC cursor exceeds the dimension safety limit",
                    ));
                }
                let pixel_len = checked_payload_len(w, h, bpp, MAX_VNC_RECT_WIRE_BYTES)?;
                let mask_len = (w as usize)
                    .div_ceil(8)
                    .checked_mul(h as usize)
                    .ok_or_else(|| VncError::protocol("Cursor mask length overflow"))?;
                let total = pixel_len
                    .checked_add(mask_len)
                    .filter(|size| *size <= MAX_VNC_RECT_WIRE_BYTES)
                    .ok_or_else(|| VncError::protocol("Cursor payload exceeds the safety limit"))?;
                let mut data = vec![0u8; total];
                reader.read_exact(&mut data).await?;
                {
                    let mut st = state.lock().await;
                    st.bytes_received += total as u64;
                }

                // Convert cursor pixels to RGBA.
                let pixels =
                    crate::vnc::encoding::convert_to_rgba(&data[..pixel_len], &pixel_format)
                        .map_err(VncError::protocol)?;
                pending_cursor = Some((
                    rect_index,
                    SessionEvent::Cursor {
                        pixels,
                        width: w,
                        height: h,
                        hotspot_x: x,
                        hotspot_y: y,
                    },
                ));
            }
            EncodingType::DesktopSizePseudo => {
                // No data to read — just means the framebuffer was resized.
                validate_framebuffer(w, h)?;
                event_tx.resize_framebuffer(w, h)?;
                active_width = w;
                active_height = h;
                pending_resize = Some((rect_index, w, h));
            }
            EncodingType::LastRectPseudo => {
                // This indicates the last rectangle in the update.
                break;
            }
            _ => return Err(VncError::protocol("Unsupported VNC rectangle encoding")),
        }
    }

    {
        // State-to-delivery is the service-wide lock order. Holding state here
        // keeps dimensions and the delivered-frame counter invisible until
        // the framebuffer transaction commits. Wire-byte telemetry remains
        // independently monotonic while the update is read.
        let mut st = state.lock().await;
        framebuffer_update.finish()?;
        if let Some((_, width, height)) = pending_resize {
            st.framebuffer_width = width;
            st.framebuffer_height = height;
        }
        st.frame_count = st.frame_count.saturating_add(pending_frame_count);
    }

    let mut pseudo_events = Vec::with_capacity(2);
    if let Some((sequence, event)) = pending_cursor {
        pseudo_events.push((sequence, event));
    }
    if let Some((sequence, width, height)) = pending_resize {
        pseudo_events.push((sequence, SessionEvent::Resize { width, height }));
    }
    pseudo_events.sort_by_key(|(sequence, _)| *sequence);
    for (_, event) in pseudo_events {
        event_tx.publish_control(event)?;
    }
    Ok(())
}

/// Read Hextile-encoded data from the stream tile by tile.
async fn read_hextile_data(
    reader: &mut (impl AsyncReadExt + Unpin),
    data: &mut Vec<u8>,
    width: u16,
    height: u16,
    pixel_format: &PixelFormat,
    state: &SharedState,
) -> Result<(), VncError> {
    let bpp = pixel_format.bytes_per_pixel();
    let w = width as usize;
    let h = height as usize;
    let tiles_x = w.div_ceil(16);
    let tiles_y = h.div_ceil(16);

    const RAW: u8 = 1;
    const BG_SPECIFIED: u8 = 2;
    const FG_SPECIFIED: u8 = 4;
    const ANY_SUBRECTS: u8 = 8;
    const SUBRECTS_COLOURED: u8 = 16;

    for _ty in 0..tiles_y {
        for _tx in 0..tiles_x {
            let tile_w = std::cmp::min(16, w - _tx * 16);
            let tile_h = std::cmp::min(16, h - _ty * 16);

            // Read sub-encoding byte.
            let mut flag_buf = [0u8; 1];
            reader.read_exact(&mut flag_buf).await?;
            data.push(flag_buf[0]);
            let flags = flag_buf[0];
            if flags & !0x1f != 0 || (flags & RAW != 0 && flags != RAW) {
                return Err(VncError::protocol("Invalid Hextile sub-encoding flags"));
            }

            let mut tile_bytes = 0u64;

            if flags & RAW != 0 {
                let raw_size = tile_w * tile_h * bpp;
                let start = data.len();
                let new_len = start
                    .checked_add(raw_size)
                    .filter(|size| *size <= MAX_VNC_RECT_WIRE_BYTES)
                    .ok_or_else(|| {
                        VncError::protocol("Hextile payload exceeds the safety limit")
                    })?;
                data.resize(new_len, 0);
                reader.read_exact(&mut data[start..]).await?;
                tile_bytes += raw_size as u64;
            } else {
                if flags & BG_SPECIFIED != 0 {
                    let start = data.len();
                    let new_len = start
                        .checked_add(bpp)
                        .filter(|size| *size <= MAX_VNC_RECT_WIRE_BYTES)
                        .ok_or_else(|| {
                            VncError::protocol("Hextile payload exceeds the safety limit")
                        })?;
                    data.resize(new_len, 0);
                    reader.read_exact(&mut data[start..]).await?;
                    tile_bytes += bpp as u64;
                }
                if flags & FG_SPECIFIED != 0 {
                    let start = data.len();
                    let new_len = start
                        .checked_add(bpp)
                        .filter(|size| *size <= MAX_VNC_RECT_WIRE_BYTES)
                        .ok_or_else(|| {
                            VncError::protocol("Hextile payload exceeds the safety limit")
                        })?;
                    data.resize(new_len, 0);
                    reader.read_exact(&mut data[start..]).await?;
                    tile_bytes += bpp as u64;
                }
                if flags & ANY_SUBRECTS != 0 {
                    let mut count_buf = [0u8; 1];
                    reader.read_exact(&mut count_buf).await?;
                    data.push(count_buf[0]);
                    tile_bytes += 1;

                    let num_subrects = count_buf[0] as usize;
                    for _ in 0..num_subrects {
                        if flags & SUBRECTS_COLOURED != 0 {
                            let start = data.len();
                            let new_len = start
                                .checked_add(bpp)
                                .filter(|size| *size <= MAX_VNC_RECT_WIRE_BYTES)
                                .ok_or_else(|| {
                                    VncError::protocol("Hextile payload exceeds the safety limit")
                                })?;
                            data.resize(new_len, 0);
                            reader.read_exact(&mut data[start..]).await?;
                            tile_bytes += bpp as u64;
                        }
                        // xy + wh (2 bytes).
                        let start = data.len();
                        let new_len = start
                            .checked_add(2)
                            .filter(|size| *size <= MAX_VNC_RECT_WIRE_BYTES)
                            .ok_or_else(|| {
                                VncError::protocol("Hextile payload exceeds the safety limit")
                            })?;
                        data.resize(new_len, 0);
                        reader.read_exact(&mut data[start..]).await?;
                        tile_bytes += 2;
                    }
                }
            }

            {
                let mut st = state.lock().await;
                st.bytes_received += 1 + tile_bytes;
            }
        }
    }

    Ok(())
}

async fn handle_colour_map(
    reader: &mut (impl AsyncReadExt + Unpin),
    state: &SharedState,
) -> Result<(), VncError> {
    // Header: 1 byte padding + 2 bytes first_colour + 2 bytes num_colours
    let mut header = [0u8; 5];
    reader.read_exact(&mut header).await?;
    let num_colours = u16::from_be_bytes([header[3], header[4]]) as usize;
    if num_colours > 256 {
        return Err(VncError::protocol(
            "VNC colour-map update exceeds the safety limit",
        ));
    }
    // Each colour entry is 6 bytes (R, G, B each 2 bytes).
    let data_len = num_colours * 6;
    let mut data = vec![0u8; data_len];
    reader.read_exact(&mut data).await?;
    {
        let mut st = state.lock().await;
        st.bytes_received += 5 + data_len as u64;
    }
    Ok(())
}

async fn handle_cut_text(
    reader: &mut (impl AsyncReadExt + Unpin),
    event_tx: &VncEventSender,
    state: &SharedState,
) -> Result<(), VncError> {
    // 3 bytes padding + 4 bytes length.
    let mut header = [0u8; 7];
    reader.read_exact(&mut header).await?;
    let text_len = u32::from_be_bytes([header[3], header[4], header[5], header[6]]) as usize;
    if text_len > MAX_VNC_CLIPBOARD_BYTES {
        return Err(VncError::protocol(
            "VNC clipboard update exceeds the safety limit",
        ));
    }
    let mut text_buf = vec![0u8; text_len];
    reader.read_exact(&mut text_buf).await?;
    {
        let mut st = state.lock().await;
        st.bytes_received += 7 + text_len as u64;
    }
    let text = String::from_utf8_lossy(&text_buf).into_owned();
    event_tx.publish_control(SessionEvent::Clipboard(text))
}

// ── Utility function for event payload construction ─────────────────────

/// Build a `VncFrameEvent` from a decoded rect for Tauri event emission.
pub fn frame_to_event(
    session_id: &str,
    delivered: DeliveredFrame,
) -> Result<VncFrameEvent, VncError> {
    let data = base64_encode_pixels(&delivered.rect.pixels).map_err(VncError::protocol)?;
    Ok(VncFrameEvent {
        session_id: session_id.to_string(),
        delivery_epoch: delivered.delivery_epoch,
        frame_token: delivered.frame_token,
        data,
        x: delivered.rect.x,
        y: delivered.rect.y,
        width: delivered.rect.width,
        height: delivered.rect.height,
        source_x: delivered.rect.source_x,
        source_y: delivered.rect.source_y,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn legal_idle_longer_than_sixty_seconds_keeps_message_read_alive() {
        let (mut reader, mut writer) = tokio::io::duplex(8);
        let read = tokio::spawn(async move { read_server_message_type(&mut reader).await });

        tokio::time::advance(Duration::from_secs(61)).await;
        tokio::task::yield_now().await;
        assert!(!read.is_finished());

        writer
            .write_all(&[ServerMessageType::Bell as u8])
            .await
            .unwrap();
        assert_eq!(read.await.unwrap().unwrap(), ServerMessageType::Bell as u8);
    }

    #[tokio::test(start_paused = true)]
    async fn started_message_body_still_has_a_bounded_deadline() {
        let (mut reader, _writer) = tokio::io::duplex(8);
        let read = tokio::spawn(async move {
            let mut body = [0u8; 4];
            read_exact_with_timeout(&mut reader, &mut body, Duration::from_secs(5)).await
        });

        tokio::time::advance(Duration::from_secs(6)).await;
        let error = read.await.unwrap().unwrap_err();
        assert_eq!(error.kind, VncErrorKind::Timeout);
    }

    fn test_shared_state(width: u16, height: u16) -> SharedState {
        Arc::new(Mutex::new(SharedSessionState {
            connected: true,
            terminated: false,
            framebuffer_width: width,
            framebuffer_height: height,
            pixel_format: PixelFormat::rgba32(),
            server_name: "test".into(),
            protocol_version: "3.8".into(),
            security_type: "None".into(),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: String::new(),
        }))
    }

    fn rectangle_header(
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        encoding: EncodingType,
    ) -> Vec<u8> {
        let mut header = Vec::with_capacity(12);
        header.extend_from_slice(&x.to_be_bytes());
        header.extend_from_slice(&y.to_be_bytes());
        header.extend_from_slice(&width.to_be_bytes());
        header.extend_from_slice(&height.to_be_bytes());
        header.extend_from_slice(&encoding.to_i32().to_be_bytes());
        header
    }

    fn resize_cursor_then_raw_prefix() -> Vec<u8> {
        let mut update = vec![0, 0, 3];
        update.extend_from_slice(&rectangle_header(
            0,
            0,
            2,
            1,
            EncodingType::DesktopSizePseudo,
        ));
        update.extend_from_slice(&rectangle_header(0, 0, 1, 1, EncodingType::CursorPseudo));
        update.extend_from_slice(&[0, 0, 0, 255, 0x80]);
        update.extend_from_slice(&rectangle_header(1, 0, 1, 1, EncodingType::Raw));
        update
    }

    async fn wait_for_transaction_to_reach_raw_payload(state: &SharedState) {
        for _ in 0..100 {
            if state.lock().await.bytes_received >= 44 {
                return;
            }
            tokio::task::yield_now().await;
        }
        panic!("framebuffer handler did not reach the withheld raw payload");
    }

    fn prepare_forced_refresh(sender: &VncEventSender, receiver: &mut VncEventReceiver) {
        sender.initialize_framebuffer(1, 1).unwrap();
        for value in [1, 2] {
            sender.begin_framebuffer_update().unwrap();
            sender
                .apply_frame(DecodedRect {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                    source_x: None,
                    source_y: None,
                    pixels: vec![value, value, value, 255],
                })
                .unwrap();
            sender.finish_framebuffer_update().unwrap();
        }
        assert!(receiver
            .drain(2)
            .unwrap()
            .iter()
            .any(|event| matches!(event, SessionEvent::Frame(_))));
    }

    #[tokio::test]
    async fn renderer_queue_failure_restores_forced_refresh_reservation() {
        let (sender, mut receiver) = event_delivery();
        prepare_forced_refresh(&sender, &mut receiver);
        let (command_tx, command_rx) = mpsc::channel(1);
        drop(command_rx);

        assert!(enqueue_update_request(&sender, &command_tx, true)
            .await
            .is_err());
        let mut retry = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!retry.incremental());
        retry.activate().unwrap();
        retry.commit().unwrap();
    }

    #[tokio::test]
    async fn dropped_queued_renderer_command_restores_forced_refresh_reservation() {
        let (sender, mut receiver) = event_delivery();
        prepare_forced_refresh(&sender, &mut receiver);
        let (command_tx, command_rx) = mpsc::channel(1);

        enqueue_update_request(&sender, &command_tx, true)
            .await
            .unwrap();
        drop(command_rx);
        let mut retry = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!retry.incremental());
        retry.activate().unwrap();
        retry.commit().unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn command_saturation_is_fail_fast_and_payload_bounded_at_100_500_1000() {
        let payload = "x".repeat(MAX_VNC_CLIPBOARD_BYTES);
        for attempts in [100usize, 500, 1_000] {
            let (command_tx, mut command_rx) = mpsc::channel(MAX_VNC_COMMAND_QUEUE);
            let started = tokio::time::Instant::now();
            let mut accepted = 0usize;
            let mut rejected = 0usize;
            for _ in 0..attempts {
                match enqueue_command_now(
                    &command_tx,
                    SessionCommand::ClientCutText(payload.clone()),
                ) {
                    Ok(()) => accepted += 1,
                    Err(error) => {
                        assert_eq!(error.kind, VncErrorKind::Timeout);
                        rejected += 1;
                    }
                }
            }
            assert_eq!(started.elapsed(), Duration::ZERO);
            assert_eq!(accepted, MAX_VNC_COMMAND_QUEUE);
            assert_eq!(rejected, attempts - MAX_VNC_COMMAND_QUEUE);

            let mut retained_commands = 0usize;
            let mut retained_payload_bytes = 0usize;
            while let Ok(command) = command_rx.try_recv() {
                let SessionCommand::ClientCutText(text) = command else {
                    panic!("clipboard saturation retained a different command")
                };
                retained_commands += 1;
                retained_payload_bytes += text.len();
            }
            assert_eq!(retained_commands, MAX_VNC_COMMAND_QUEUE);
            assert_eq!(
                retained_payload_bytes,
                MAX_VNC_COMMAND_QUEUE * MAX_VNC_CLIPBOARD_BYTES
            );
            assert!(retained_payload_bytes <= VNC_SESSION_RESOURCE_RESERVATION_BYTES);
        }
    }

    #[test]
    fn key_pointer_and_disconnect_share_fail_fast_command_admission() {
        let (command_tx, _command_rx) = mpsc::channel(1);
        enqueue_command_now(
            &command_tx,
            SessionCommand::KeyEvent {
                down: true,
                key: keysym::RETURN,
            },
        )
        .unwrap();
        for command in [
            SessionCommand::PointerEvent {
                button_mask: mouse_button::LEFT,
                x: 1,
                y: 1,
            },
            SessionCommand::Disconnect,
        ] {
            let error = enqueue_command_now(&command_tx, command).unwrap_err();
            assert_eq!(error.kind, VncErrorKind::Timeout);
        }
    }

    #[tokio::test]
    async fn scheduled_write_failure_restores_force_and_publishes_terminal() {
        let (sender, mut receiver) = event_delivery();
        prepare_forced_refresh(&sender, &mut receiver);
        let (mut writer, peer) = tokio::io::duplex(16);
        drop(peer);

        assert!(write_scheduled_update(&mut writer, &sender, 1, 1)
            .await
            .is_err());
        assert!(sender.reserve_update_request(true).unwrap().is_none());
        assert!(matches!(
            receiver.drain(2).unwrap().as_slice(),
            [SessionEvent::Disconnected(Some(reason))]
                if reason.contains("scheduled framebuffer request write")
        ));
    }

    #[tokio::test]
    async fn scheduled_reservation_failure_publishes_diagnostic_terminal() {
        let (sender, receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        let transaction = sender.framebuffer_update().unwrap();
        drop(transaction);
        let (mut writer, _peer) = tokio::io::duplex(16);

        let error = write_scheduled_update(&mut writer, &sender, 1, 1)
            .await
            .expect_err("a suspended delivery must reject refresh reservation");
        assert!(error.message.contains("scheduled refresh reservation"));
        assert!(matches!(
            receiver.drain(2).unwrap().as_slice(),
            [SessionEvent::Disconnected(Some(reason))]
                if reason.contains("scheduled refresh reservation")
                    && reason.contains("delivery is suspended")
        ));
    }

    #[tokio::test]
    async fn command_writer_failure_publishes_diagnostic_terminal() {
        let (sender, receiver) = event_delivery();
        let (mut writer, peer) = tokio::io::duplex(16);
        drop(peer);

        assert!(write_all_or_terminal(
            &mut writer,
            &[1, 2, 3],
            &sender,
            "framebuffer-request command write",
        )
        .await
        .is_err());
        assert!(matches!(
            receiver.drain(2).unwrap().as_slice(),
            [SessionEvent::Disconnected(Some(reason))]
                if reason.contains("framebuffer-request command write")
        ));
    }

    #[tokio::test]
    async fn framebuffer_pseudos_and_stats_stay_hidden_until_commit() {
        let state = test_shared_state(1, 1);
        let (sender, receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        let (mut writer, mut reader) = tokio::io::duplex(256);
        let task_sender = sender.clone();
        let task_state = Arc::clone(&state);
        let task =
            tokio::spawn(
                async move { handle_fb_update(&mut reader, &task_sender, &task_state).await },
            );

        writer
            .write_all(&resize_cursor_then_raw_prefix())
            .await
            .unwrap();
        wait_for_transaction_to_reach_raw_payload(&state).await;
        {
            let snapshot = state.lock().await;
            assert_eq!(
                (snapshot.framebuffer_width, snapshot.framebuffer_height),
                (1, 1)
            );
            assert_eq!(snapshot.bytes_received, 44);
            assert_eq!(snapshot.frame_count, 0);
        }
        assert!(receiver.drain(MAX_VNC_DRAIN_EVENTS).unwrap().is_empty());

        writer.write_all(&[9, 8, 7, 255]).await.unwrap();
        timeout(Duration::from_secs(1), task)
            .await
            .expect("framebuffer handler timed out")
            .expect("framebuffer handler panicked")
            .expect("framebuffer handler rejected the completed update");
        {
            let snapshot = state.lock().await;
            assert_eq!(
                (snapshot.framebuffer_width, snapshot.framebuffer_height),
                (2, 1)
            );
            assert_eq!(snapshot.bytes_received, 48);
            assert_eq!(snapshot.frame_count, 1);
        }
        assert_eq!(sender.test_framebuffer_dimensions().unwrap(), (2, 1));
        let events = receiver.drain(MAX_VNC_DRAIN_EVENTS).unwrap();
        assert!(matches!(
            events.first(),
            Some(SessionEvent::Resize {
                width: 2,
                height: 1
            })
        ));
        assert!(events
            .iter()
            .any(|event| matches!(event, SessionEvent::Cursor { .. })));
        assert!(events
            .iter()
            .any(|event| matches!(event, SessionEvent::Frame(_))));
    }

    #[tokio::test]
    async fn abort_after_pseudos_discards_resize_cursor_and_partial_pixels() {
        let state = test_shared_state(1, 1);
        let (sender, receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        let (mut writer, mut reader) = tokio::io::duplex(256);
        let task_sender = sender.clone();
        let task_state = Arc::clone(&state);
        let task =
            tokio::spawn(
                async move { handle_fb_update(&mut reader, &task_sender, &task_state).await },
            );

        writer
            .write_all(&resize_cursor_then_raw_prefix())
            .await
            .unwrap();
        wait_for_transaction_to_reach_raw_payload(&state).await;
        drop(writer);
        assert!(timeout(Duration::from_secs(1), task)
            .await
            .expect("framebuffer handler timed out")
            .expect("framebuffer handler panicked")
            .is_err());

        {
            let snapshot = state.lock().await;
            assert_eq!(
                (snapshot.framebuffer_width, snapshot.framebuffer_height),
                (1, 1)
            );
            // Wire telemetry records the complete header/pseudo payload bytes
            // consumed before the missing raw payload aborted the transaction.
            assert_eq!(snapshot.bytes_received, 44);
            assert_eq!(snapshot.frame_count, 0);
        }
        assert_eq!(sender.test_framebuffer_dimensions().unwrap(), (1, 1));
        assert!(receiver.drain(MAX_VNC_DRAIN_EVENTS).unwrap().is_empty());
        sender
            .publish_control(SessionEvent::Disconnected(Some("decode aborted".into())))
            .unwrap();
        assert!(matches!(
            receiver.drain(2).unwrap().as_slice(),
            [SessionEvent::Disconnected(Some(reason))] if reason == "decode aborted"
        ));
    }

    // ── SessionCommand ──────────────────────────────────────────────

    #[test]
    fn session_command_disconnect_variant() {
        let cmd = SessionCommand::Disconnect;
        assert!(matches!(cmd, SessionCommand::Disconnect));
    }

    #[test]
    fn session_command_key_event() {
        let cmd = SessionCommand::KeyEvent {
            down: true,
            key: keysym::RETURN,
        };
        assert!(matches!(cmd, SessionCommand::KeyEvent { down: true, .. }));
    }

    #[test]
    fn session_command_pointer_event() {
        let cmd = SessionCommand::PointerEvent {
            button_mask: mouse_button::LEFT,
            x: 100,
            y: 200,
        };
        assert!(matches!(cmd, SessionCommand::PointerEvent { .. }));
    }

    #[test]
    fn session_command_cut_text() {
        let cmd = SessionCommand::ClientCutText("hello".into());
        assert!(matches!(cmd, SessionCommand::ClientCutText(_)));
    }

    #[test]
    fn session_command_request_update() {
        let cmd = SessionCommand::RequestUpdate { reservation: None };
        assert!(matches!(
            cmd,
            SessionCommand::RequestUpdate { reservation: None }
        ));
    }

    #[test]
    fn session_command_set_pixel_format() {
        let cmd = SessionCommand::SetPixelFormat(PixelFormat::rgba32());
        assert!(matches!(cmd, SessionCommand::SetPixelFormat(_)));
    }

    #[test]
    fn session_command_set_encodings() {
        let cmd = SessionCommand::SetEncodings(vec![EncodingType::Raw]);
        assert!(matches!(cmd, SessionCommand::SetEncodings(_)));
    }

    // ── SessionEvent ────────────────────────────────────────────────

    #[test]
    fn session_event_bell() {
        let ev = SessionEvent::Bell;
        assert!(matches!(ev, SessionEvent::Bell));
    }

    #[test]
    fn session_event_clipboard() {
        let ev = SessionEvent::Clipboard("test".into());
        assert!(matches!(ev, SessionEvent::Clipboard(_)));
    }

    #[test]
    fn session_event_resize() {
        let ev = SessionEvent::Resize {
            width: 1920,
            height: 1080,
        };
        assert!(matches!(ev, SessionEvent::Resize { width: 1920, .. }));
    }

    #[test]
    fn session_event_disconnected() {
        let ev = SessionEvent::Disconnected(Some("error".into()));
        assert!(matches!(ev, SessionEvent::Disconnected(Some(_))));
    }

    #[test]
    fn session_event_connected() {
        let ev = SessionEvent::Connected {
            width: 1024,
            height: 768,
            pixel_format: PixelFormat::rgba32(),
            server_name: "Desktop".into(),
            protocol_version: "3.8".into(),
            security_type: "None".into(),
        };
        assert!(matches!(ev, SessionEvent::Connected { width: 1024, .. }));
    }

    #[test]
    fn session_event_cursor() {
        let ev = SessionEvent::Cursor {
            pixels: vec![255; 16],
            width: 2,
            height: 2,
            hotspot_x: 0,
            hotspot_y: 0,
        };
        assert!(matches!(ev, SessionEvent::Cursor { .. }));
    }

    // ── SharedSessionState ──────────────────────────────────────────

    #[test]
    fn shared_state_defaults() {
        let st = SharedSessionState {
            connected: false,
            terminated: false,
            framebuffer_width: 0,
            framebuffer_height: 0,
            pixel_format: PixelFormat::rgba32(),
            server_name: String::new(),
            protocol_version: String::new(),
            security_type: String::new(),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: String::new(),
        };
        assert!(!st.connected);
        assert_eq!(st.framebuffer_width, 0);
    }

    // ── frame_to_event ──────────────────────────────────────────────

    #[test]
    fn frame_to_event_basic() {
        let rect = DecodedRect {
            x: 10,
            y: 20,
            width: 2,
            height: 2,
            source_x: None,
            source_y: None,
            pixels: vec![
                0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255,
            ],
        };
        let ev = frame_to_event(
            "sess1",
            DeliveredFrame {
                rect,
                delivery_epoch: 7,
                frame_token: 11,
            },
        )
        .unwrap();
        assert_eq!(ev.session_id, "sess1");
        assert_eq!(ev.x, 10);
        assert_eq!(ev.y, 20);
        assert_eq!(ev.width, 2);
        assert_eq!(ev.height, 2);
        assert_eq!(ev.source_x, None);
        assert_eq!(ev.delivery_epoch, 7);
        assert_eq!(ev.frame_token, 11);
        assert!(!ev.data.is_empty());
    }

    #[test]
    fn frame_to_event_empty_pixels() {
        let rect = DecodedRect {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            source_x: Some(4),
            source_y: Some(5),
            pixels: Vec::new(),
        };
        let ev = frame_to_event(
            "s2",
            DeliveredFrame {
                rect,
                delivery_epoch: 3,
                frame_token: 1,
            },
        )
        .unwrap();
        assert_eq!(ev.data, "");
        assert_eq!(ev.source_x, Some(4));
        assert_eq!(ev.source_y, Some(5));
    }
}

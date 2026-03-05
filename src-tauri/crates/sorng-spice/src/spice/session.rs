//! SPICE session — async TCP connection, link handshake, auth, channel open, event loop.

use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use crate::spice::channels::ChannelMux;
use crate::spice::clipboard::ClipboardManager;
use crate::spice::display::DisplayManager;
use crate::spice::input::{KeyEvent, MouseMode, PointerEvent};
use crate::spice::streaming::StreamingManager;
use crate::spice::types::*;
use crate::spice::usb::UsbRedirectManager;

// ── Commands & Events ───────────────────────────────────────────────────────

/// Commands sent from the service layer to the session task.
#[derive(Debug)]
pub enum SessionCommand {
    /// Send a key event (press or release).
    KeyEvent { scancode: u32, down: bool },
    /// Send a pointer / mouse event.
    PointerEvent { x: i32, y: i32, button_mask: u8 },
    /// Send clipboard text to the guest.
    SendClipboard(String),
    /// Request a full display update.
    RequestUpdate,
    /// Set display resolution.
    SetResolution { width: u32, height: u32 },
    /// Redirect a USB device.
    RedirectUsb { vendor_id: u16, product_id: u16 },
    /// Un-redirect a USB device.
    UnredirectUsb { vendor_id: u16, product_id: u16 },
    /// Disconnect gracefully.
    Disconnect,
}

/// Events emitted from the session task to the service.
#[derive(Debug)]
pub enum SessionEvent {
    /// A display frame is available.
    Frame(SpiceFrameEvent),
    /// Cursor has changed.
    Cursor(SpiceCursorEvent),
    /// Guest clipboard data.
    Clipboard(SpiceClipboardEvent),
    /// Connection state changed.
    StateChanged(SpiceStateEvent),
    /// A surface was created or resized.
    Surface(SpiceSurfaceEvent),
    /// Display was resized.
    Resize(SpiceResizeEvent),
    /// USB device event.
    Usb(SpiceUsbEvent),
    /// Audio stream data.
    Audio(SpiceAudioEvent),
    /// Video stream event.
    Stream(SpiceStreamEvent),
    /// Handshake succeeded.
    Connected {
        width: u32,
        height: u32,
        channels: Vec<SpiceChannelType>,
        server_name: String,
    },
    /// Session disconnected.
    Disconnected(Option<String>),
}

// ── Shared State ────────────────────────────────────────────────────────────

/// Shared mutable state between the session task and the service layer.
#[derive(Debug)]
pub struct SharedSessionState {
    pub connected: bool,
    pub display_width: u32,
    pub display_height: u32,
    pub server_name: String,
    pub channels_open: Vec<SpiceChannelType>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub frame_count: u64,
    pub last_activity: String,
    pub mouse_mode: String,
}

pub type SharedState = Arc<Mutex<SharedSessionState>>;

// ── Session Handle ──────────────────────────────────────────────────────────

/// Handle to a running SPICE session.
///
/// The actual session logic runs in a spawned tokio task, communicating
/// with this handle through mpsc channels.
pub struct SpiceSessionHandle {
    pub id: String,
    pub config: SpiceConfig,
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub event_rx: mpsc::Receiver<SessionEvent>,
    pub state: SharedState,
}

impl SpiceSessionHandle {
    /// Spawn and connect a SPICE session.
    pub async fn connect(id: String, config: SpiceConfig) -> Result<Self, SpiceError> {
        let (cmd_tx, cmd_rx) = mpsc::channel(256);
        let (event_tx, event_rx) = mpsc::channel(512);

        let state = Arc::new(Mutex::new(SharedSessionState {
            connected: false,
            display_width: config.preferred_width.unwrap_or(1024),
            display_height: config.preferred_height.unwrap_or(768),
            server_name: String::new(),
            channels_open: Vec::new(),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: chrono::Utc::now().to_rfc3339(),
            mouse_mode: "server".into(),
        }));

        let shared = state.clone();
        let session_config = config.clone();

        tokio::spawn(async move {
            let result = session_task(session_config, cmd_rx, event_tx.clone(), shared).await;
            if let Err(e) = result {
                let _ = event_tx
                    .send(SessionEvent::Disconnected(Some(e.message)))
                    .await;
            }
        });

        Ok(Self {
            id,
            config,
            cmd_tx,
            event_rx,
            state,
        })
    }

    /// Send a command to the session task.
    pub async fn send_command(&self, cmd: SessionCommand) -> Result<(), SpiceError> {
        self.cmd_tx
            .send(cmd)
            .await
            .map_err(|_| SpiceError::disconnected("session task is gone"))
    }

    /// Request disconnect.
    pub async fn disconnect(&self) -> Result<(), SpiceError> {
        self.send_command(SessionCommand::Disconnect).await
    }
}

// ── Session Task ────────────────────────────────────────────────────────────

/// The main session task that runs the SPICE protocol state machine.
async fn session_task(
    config: SpiceConfig,
    mut cmd_rx: mpsc::Receiver<SessionCommand>,
    event_tx: mpsc::Sender<SessionEvent>,
    state: SharedState,
) -> Result<(), SpiceError> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let connect_timeout = Duration::from_secs(config.connect_timeout_secs);

    // 1. TCP connect
    let addr = format!("{}:{}", config.host, config.port);
    let stream = timeout(connect_timeout, TcpStream::connect(&addr))
        .await
        .map_err(|_| SpiceError::timeout("connection timed out"))?
        .map_err(SpiceError::from)?;

    let (mut reader, mut writer) = tokio::io::split(stream);

    // 2. Link handshake
    // Send SpiceLinkMess
    use crate::spice::protocol::{SpiceLinkHeader, SpiceLinkMess};
    use bytes::{BufMut, BytesMut};

    let link_mess = SpiceLinkMess::new(SpiceChannelType::Main, 0);
    let mut header_buf = BytesMut::new();
    let mut link_header = SpiceLinkHeader::new(SpiceVersion::V2);
    link_header.size = link_mess.size() as u32;
    link_header.encode(&mut header_buf);

    let mut mess_buf = BytesMut::new();
    mess_buf.put_u32_le(link_mess.connection_id);
    mess_buf.put_u8(link_mess.channel_type as u8);
    mess_buf.put_u8(link_mess.channel_id);
    mess_buf.put_u32_le(link_mess.num_common_caps);
    mess_buf.put_u32_le(link_mess.num_channel_caps);
    mess_buf.put_u32_le(link_mess.caps_offset);

    writer.write_all(&header_buf).await.map_err(SpiceError::from)?;
    writer.write_all(&mess_buf).await.map_err(SpiceError::from)?;

    // 3. Read server link reply
    let mut reply_buf = [0u8; 16];
    reader.read_exact(&mut reply_buf).await.map_err(SpiceError::from)?;
    let mut reply_bytes = BytesMut::from(&reply_buf[..]);
    let _server_header = SpiceLinkHeader::decode(&mut reply_bytes)?;

    {
        let mut st = state.lock().await;
        st.bytes_received += 16;
    }

    // Read the rest of the reply (simplified — accept any size)
    let mut reply_rest = vec![0u8; 128];
    let n = reader.read(&mut reply_rest).await.map_err(SpiceError::from)?;
    {
        let mut st = state.lock().await;
        st.bytes_received += n as u64;
    }

    // 4. Ticket auth
    if let Some(ref password) = config.password {
        let ticket = crate::spice::protocol::encode_ticket(password);
        writer.write_all(&ticket).await.map_err(SpiceError::from)?;
        let mut st = state.lock().await;
        st.bytes_sent += ticket.len() as u64;

        // Read auth result (4 bytes)
        let mut auth_result = [0u8; 4];
        reader.read_exact(&mut auth_result).await.map_err(SpiceError::from)?;
        st.bytes_received += 4;
        let result_code = u32::from_le_bytes(auth_result);
        if result_code != 0 {
            return Err(SpiceError::auth("authentication failed"));
        }
    }

    // 5. Open channels
    let mut channel_mux = ChannelMux::new(0);
    channel_mux.open_from_config(&config);
    let channels_open: Vec<SpiceChannelType> = channel_mux
        .list()
        .into_iter()
        .map(|c| c.channel_type)
        .collect();

    // 6. Initialize sub-managers
    let _display_mgr = DisplayManager::new();
    let _clipboard_mgr = ClipboardManager::new(config.share_clipboard);
    let _usb_mgr = UsbRedirectManager::new(
        config.usb_redirection,
        config.usb_auto_redirect,
    );
    let _streaming_mgr = StreamingManager::new(
        config.video_codec.clone().unwrap_or(VideoCodec::Mjpeg),
    );

    // 7. Mark connected
    {
        let mut st = state.lock().await;
        st.connected = true;
        st.channels_open = channels_open.clone();
        st.last_activity = chrono::Utc::now().to_rfc3339();
    }

    let _ = event_tx
        .send(SessionEvent::Connected {
            width: config.preferred_width.unwrap_or(1024),
            height: config.preferred_height.unwrap_or(768),
            channels: channels_open,
            server_name: String::new(),
        })
        .await;

    // 8. Main event loop
    let mut read_buf = vec![0u8; 65536];
    loop {
        tokio::select! {
            // Read from network
            result = reader.read(&mut read_buf) => {
                match result {
                    Ok(0) => {
                        // EOF
                        let mut st = state.lock().await;
                        st.connected = false;
                        let _ = event_tx.send(SessionEvent::Disconnected(None)).await;
                        break;
                    }
                    Ok(n) => {
                        let mut st = state.lock().await;
                        st.bytes_received += n as u64;
                        st.frame_count += 1;
                        st.last_activity = chrono::Utc::now().to_rfc3339();
                        // Real implementation would parse SPICE protocol messages here
                    }
                    Err(e) => {
                        let mut st = state.lock().await;
                        st.connected = false;
                        let _ = event_tx.send(SessionEvent::Disconnected(Some(e.to_string()))).await;
                        break;
                    }
                }
            }

            // Process commands
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Disconnect) | None => {
                        let mut st = state.lock().await;
                        st.connected = false;
                        let _ = event_tx.send(SessionEvent::Disconnected(None)).await;
                        break;
                    }
                    Some(SessionCommand::KeyEvent { scancode, down }) => {
                        let ke = if down { KeyEvent::press(scancode) } else { KeyEvent::release(scancode) };
                        let mut buf = BytesMut::new();
                        ke.encode(&mut buf);
                        if writer.write_all(&buf).await.is_ok() {
                            let mut st = state.lock().await;
                            st.bytes_sent += buf.len() as u64;
                        }
                    }
                    Some(SessionCommand::PointerEvent { x, y, button_mask }) => {
                        let pe = PointerEvent::button_press(x, y, button_mask, MouseMode::Server);
                        let mut buf = BytesMut::new();
                        pe.encode(&mut buf);
                        if writer.write_all(&buf).await.is_ok() {
                            let mut st = state.lock().await;
                            st.bytes_sent += buf.len() as u64;
                        }
                    }
                    Some(SessionCommand::SendClipboard(text)) => {
                        let data = text.as_bytes();
                        if writer.write_all(data).await.is_ok() {
                            let mut st = state.lock().await;
                            st.bytes_sent += data.len() as u64;
                        }
                    }
                    Some(SessionCommand::RequestUpdate) => {
                        // Send display update request
                        let msg = [0u8; 4]; // placeholder
                        if writer.write_all(&msg).await.is_ok() {
                            let mut st = state.lock().await;
                            st.bytes_sent += 4;
                        }
                    }
                    Some(SessionCommand::SetResolution { width, height }) => {
                        let mut st = state.lock().await;
                        st.display_width = width;
                        st.display_height = height;
                    }
                    Some(SessionCommand::RedirectUsb { .. }) => {
                        // USB redirect via usbredir channel
                    }
                    Some(SessionCommand::UnredirectUsb { .. }) => {
                        // USB unredirect
                    }
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_command_variants() {
        let _ = SessionCommand::KeyEvent {
            scancode: 0x1E,
            down: true,
        };
        let _ = SessionCommand::PointerEvent {
            x: 100,
            y: 200,
            button_mask: 1,
        };
        let _ = SessionCommand::SendClipboard("hello".into());
        let _ = SessionCommand::RequestUpdate;
        let _ = SessionCommand::SetResolution {
            width: 1920,
            height: 1080,
        };
        let _ = SessionCommand::RedirectUsb {
            vendor_id: 0x1234,
            product_id: 0x5678,
        };
        let _ = SessionCommand::Disconnect;
    }

    #[test]
    fn session_event_variants() {
        let _ = SessionEvent::Connected {
            width: 1024,
            height: 768,
            channels: vec![SpiceChannelType::Main, SpiceChannelType::Display],
            server_name: "test".into(),
        };
        let _ = SessionEvent::Disconnected(None);
        let _ = SessionEvent::Disconnected(Some("error".into()));
    }

    #[test]
    fn shared_state_default() {
        let state = SharedSessionState {
            connected: false,
            display_width: 1024,
            display_height: 768,
            server_name: String::new(),
            channels_open: Vec::new(),
            bytes_sent: 0,
            bytes_received: 0,
            frame_count: 0,
            last_activity: String::new(),
            mouse_mode: "server".into(),
        };
        assert!(!state.connected);
        assert_eq!(state.display_width, 1024);
    }
}

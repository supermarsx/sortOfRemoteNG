//! SSH3 session channels — interactive shell (PTY) and one-shot exec.
//!
//! Channels map to QUIC bidirectional streams opened off the session's live
//! `quinn::Connection` (the `proxy.rs` pattern: `connection.open_bi()`).
//!
//! ## What's real (t23-e3)
//! [`Ssh3Service::execute_command`] performs a REAL one-shot exec over the
//! authenticated SSH3 session (replacing the e1 honest-not-implemented stub):
//! it clones the live h3 `SendRequest` off the session's [`super::Ssh3Transport`],
//! opens its own HTTP/3 request stream (== a fresh QUIC bidi stream) carrying the
//! command, finishes the send side, then pumps `recv_data()` to EOF collecting
//! the combined stdout+stderr. The whole exchange runs inside a `tokio::spawn`ed
//! task wrapped in `tokio::time::timeout` so the command thread never blocks and
//! `timeout` is honoured. Output framing + error mapping live in
//! [`run_exec_stream`] / [`map_exec_status`] and are unit-tested without a server.
//!
//! ## Seams for later executors
//! - `t23-e4` fills [`Ssh3Service::start_shell`] / [`Ssh3Service::send_shell_input`]
//!   / [`Ssh3Service::resize_shell`] / [`Ssh3Service::close_channel`] (PTY alloc
//!   \+ bidi read/write loop on a tokio task, emitting `Ssh3ShellOutput` /
//!   `Ssh3ShellError` / `Ssh3ShellClosed` through the real `DynEventEmitter`).
//!   The exec path below is kept cohesive and self-contained so e4's interactive
//!   shell can be added alongside without disturbing it.
//!
//! Foundation (e1) keeps the bookkeeping (channel records, mpsc plumbing) that
//! is legitimately correct, but the bodies that still require the live protocol
//! (shell/PTY, e4) return explicit not-implemented errors so the commands never
//! fake success.

use std::time::Duration;

use bytes::{Buf, Bytes};
use chrono::Utc;
use http::Method;
use sorng_core::events::DynEventEmitter;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::auth::{maybe_attach_ssh3_protocol, DEFAULT_SSH3_URL_PATH};
use super::transport::Ssh3SendRequest;
use super::{
    Ssh3Channel, Ssh3ChannelType, Ssh3ConnectionConfig, Ssh3ConnectionState, Ssh3Service,
    Ssh3ShellClosed, Ssh3ShellCommand, Ssh3ShellError, Ssh3ShellHandle, Ssh3ShellOutput,
};

/// JS event names the SSH3 terminal UI subscribes to.
///
/// Mirror the classic SSH terminal convention (`ssh-output` / `ssh-error` /
/// `ssh-shell-closed`) but namespaced `ssh3-*` so the SSH3 terminal hook can
/// subscribe independently of the classic SSH session events. The payloads are
/// [`Ssh3ShellOutput`] / [`Ssh3ShellError`] / [`Ssh3ShellClosed`] (which carry
/// both `session_id` and `channel_id`, unlike the classic single-`session_id`
/// payloads).
pub(crate) const SSH3_SHELL_OUTPUT_EVENT: &str = "ssh3-output";
pub(crate) const SSH3_SHELL_ERROR_EVENT: &str = "ssh3-error";
pub(crate) const SSH3_SHELL_CLOSED_EVENT: &str = "ssh3-shell-closed";

/// Header SSH3 carries the requested PTY allocation on the shell request.
pub(crate) const SSH3_PTY_HEADER: &str = "x-ssh3-pty";

/// Upper bound on a single shell output chunk we emit, to avoid pathological
/// single-emit payloads from a hostile server. Output beyond this in one
/// `recv_data` is split across emits.
const MAX_SHELL_EMIT_BYTES: usize = 64 * 1024;

/// Header SSH3 carries the command to execute on the exec request.
///
/// Upstream `ssh3` conveys the requested command over the HTTP layer of the
/// conversation rather than a classic SSH `exec` channel-request packet. We
/// expose it as a dedicated header so the request construction is explicit and
/// unit-testable. (The exact upstream header name can only be pinned against a
/// live server; this is documented in the golden-path test and is the single
/// knob to adjust if a real server expects a different name.)
pub(crate) const SSH3_COMMAND_HEADER: &str = "x-ssh3-command";

/// Upper bound on captured exec output, to avoid unbounded memory growth on a
/// runaway/hostile server. 16 MiB is generous for command output; beyond it we
/// stop reading and return what we have plus a truncation marker.
const MAX_EXEC_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

/// Result of pumping an exec request stream to EOF.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ExecOutcome {
    /// Combined stdout+stderr captured from the response body.
    pub output: String,
    /// HTTP status the server returned for the exec conversation.
    pub status: http::StatusCode,
    /// Whether the captured output hit [`MAX_EXEC_OUTPUT_BYTES`] and was cut off.
    pub truncated: bool,
}

impl Ssh3Service {
    /// Start an interactive shell session over the authenticated SSH3 session.
    ///
    /// Real PTY + bidirectional terminal pump (t23-e4):
    /// 1. Validate the session is `Connected` and holds a live transport;
    ///    short-circuit to the existing shell id if one is already open
    ///    (matching the classic SSH path).
    /// 2. Open a fresh SSH3 shell request stream off the live h3 `SendRequest`
    ///    (a request carrying the PTY allocation header). Read the response
    ///    status to confirm the server accepted the shell.
    /// 3. `split()` the bidi stream into a send half (client→server input) and a
    ///    recv half (server→client output).
    /// 4. Spawn ONE pump task that `select!`s between (a) input/resize/close
    ///    commands arriving on an mpsc and (b) `recv_data()` output from the
    ///    recv half. Output is emitted as `ssh3-output` through the real
    ///    `DynEventEmitter`; a fatal stream error emits `ssh3-error`; clean EOF
    ///    or close emits `ssh3-shell-closed`. The task runs on the tokio runtime
    ///    so the Tauri command thread is never blocked.
    ///
    /// Returns the channel id (also carried in every emitted event payload so
    /// the terminal UI can route output to the right pane).
    pub async fn start_shell(
        &mut self,
        session_id: &str,
        event_emitter: DynEventEmitter,
    ) -> Result<String, String> {
        // One shell per session: if a pump is already running, hand back its id.
        if let Some(existing) = self.shells.get(session_id) {
            return Ok(existing.id.clone());
        }

        // Pull the per-shell handles out under the borrow, then drop it so the
        // network round-trip below holds no lock on the service map.
        let (mut send_request, config) = {
            let session = self
                .sessions
                .get_mut(session_id)
                .ok_or("Session not found")?;

            if session.connection_state != Ssh3ConnectionState::Connected {
                return Err("Session not connected".to_string());
            }

            let transport = session
                .transport
                .as_ref()
                .ok_or("Session has no live transport")?;

            session.last_activity = Utc::now();
            (transport.request_sender(), session.config.clone())
        };

        // Open the shell stream (PTY request) and confirm the server accepted it.
        let request = build_shell_request(&config)?;
        let stream = send_request
            .send_request(request)
            .await
            .map_err(|e| format!("SSH3: failed to open shell stream: {e}"))?;
        // Split into independent send / recv halves so input and output can be
        // pumped concurrently without one blocking the other.
        let (mut send_half, mut recv_half) = stream.split();

        // Read the response status before pumping: a non-2xx means the server
        // rejected the shell (auth/path/PTY) and we must not hand back a fake id.
        let response = recv_half
            .recv_response()
            .await
            .map_err(|e| format!("SSH3: failed to receive shell response: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "SSH3: server rejected interactive shell (HTTP {})",
                response.status().as_u16()
            ));
        }

        let channel_id = Uuid::new_v4().to_string();
        let (tx, mut rx) = mpsc::unbounded_channel::<Ssh3ShellCommand>();

        // Record the channel for `close_channel` / bookkeeping parity.
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.channels.insert(
                channel_id.clone(),
                Ssh3Channel {
                    id: channel_id.clone(),
                    channel_type: Ssh3ChannelType::Session,
                    stream_id: 0,
                    // The input sender stored on the channel is the byte-only
                    // mirror; the command sender lives on the shell handle.
                    created_at: Utc::now(),
                    sender: mpsc::unbounded_channel::<Vec<u8>>().0,
                },
            );
            session.last_activity = Utc::now();
        }

        let session_id_owned = session_id.to_string();
        let channel_id_owned = channel_id.clone();

        // The single pump task: input/resize/close in, output out. Owns both
        // stream halves so nothing else touches the shell stream concurrently.
        let pump = tokio::spawn(async move {
            let mut closed_cleanly = false;
            loop {
                tokio::select! {
                    // Client → server: input / resize / close.
                    cmd = rx.recv() => {
                        match cmd {
                            Some(Ssh3ShellCommand::Input(bytes)) => {
                                if let Err(e) = send_half
                                    .send_data(Bytes::from(bytes))
                                    .await
                                {
                                    emit_shell_error(
                                        &event_emitter,
                                        &session_id_owned,
                                        &channel_id_owned,
                                        &format!("input write failed: {e}"),
                                    );
                                    break;
                                }
                            }
                            Some(Ssh3ShellCommand::Resize(cols, rows)) => {
                                // Window-change: SSH3 has no separate control
                                // channel over a plain CONNECT, so we send a
                                // small framed control message inline on the
                                // shell stream. Isolated + testable; the exact
                                // wire detail is the single knob to pin against
                                // a live server (host-gated, like exec/forward).
                                let frame = shell_resize_frame(cols, rows);
                                if let Err(e) = send_half
                                    .send_data(Bytes::from(frame))
                                    .await
                                {
                                    emit_shell_error(
                                        &event_emitter,
                                        &session_id_owned,
                                        &channel_id_owned,
                                        &format!("resize failed: {e}"),
                                    );
                                    break;
                                }
                            }
                            Some(Ssh3ShellCommand::Close) | None => {
                                let _ = send_half.finish().await;
                                closed_cleanly = true;
                                break;
                            }
                        }
                    }
                    // Server → client: terminal output.
                    out = recv_half.recv_data() => {
                        match out {
                            Ok(Some(mut chunk)) => {
                                while chunk.has_remaining() {
                                    let take = std::cmp::min(chunk.remaining(), MAX_SHELL_EMIT_BYTES);
                                    let slice = chunk.chunk();
                                    let n = std::cmp::min(take, slice.len());
                                    let data = String::from_utf8_lossy(&slice[..n]).into_owned();
                                    chunk.advance(n);
                                    emit_shell_output(
                                        &event_emitter,
                                        &session_id_owned,
                                        &channel_id_owned,
                                        data,
                                    );
                                }
                            }
                            Ok(None) => {
                                // Clean EOF from the server side.
                                closed_cleanly = true;
                                break;
                            }
                            Err(e) => {
                                emit_shell_error(
                                    &event_emitter,
                                    &session_id_owned,
                                    &channel_id_owned,
                                    &format!("read error: {e}"),
                                );
                                break;
                            }
                        }
                    }
                }
            }

            let _ = closed_cleanly;
            emit_shell_closed(&event_emitter, &session_id_owned, &channel_id_owned);
        });

        self.shells.insert(
            session_id.to_string(),
            Ssh3ShellHandle {
                id: channel_id.clone(),
                sender: tx,
                pump,
            },
        );

        Ok(channel_id)
    }

    /// Send input to the interactive shell.
    ///
    /// Routes the bytes to the running pump task over the shell command mpsc
    /// (the pump owns the QUIC send half, so input is serialized there and never
    /// races output). `channel_id` is validated against the active shell so a
    /// stale id surfaces a real error rather than silently writing to the wrong
    /// stream.
    pub async fn send_shell_input(
        &mut self,
        session_id: &str,
        channel_id: &str,
        data: String,
    ) -> Result<(), String> {
        let shell = self
            .shells
            .get(session_id)
            .ok_or("SSH3: no interactive shell open for this session")?;
        if shell.id != channel_id {
            return Err("SSH3: channel id does not match the open shell".to_string());
        }
        shell
            .sender
            .send(Ssh3ShellCommand::Input(data.into_bytes()))
            .map_err(|_| "SSH3: shell pump is gone; input not delivered".to_string())?;

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.last_activity = Utc::now();
        }
        Ok(())
    }

    /// Resize the shell PTY (window-change).
    ///
    /// Sends a `Resize` command to the pump task, which writes a framed
    /// window-change control message on the shell stream.
    pub async fn resize_shell(
        &mut self,
        session_id: &str,
        channel_id: &str,
        cols: u32,
        rows: u32,
    ) -> Result<(), String> {
        let shell = self
            .shells
            .get(session_id)
            .ok_or("SSH3: no interactive shell open for this session")?;
        if shell.id != channel_id {
            return Err("SSH3: channel id does not match the open shell".to_string());
        }
        shell
            .sender
            .send(Ssh3ShellCommand::Resize(cols, rows))
            .map_err(|_| "SSH3: shell pump is gone; resize not delivered".to_string())?;

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.last_activity = Utc::now();
        }
        log::debug!("SSH3: resize shell {cols}x{rows}");
        Ok(())
    }

    /// Execute a command and return its combined output.
    ///
    /// Real one-shot exec over the authenticated SSH3 session (t23-e3):
    /// 1. Validate the session is `Connected` and holds a live transport.
    /// 2. Clone the h3 `SendRequest` + config out of the session **before**
    ///    awaiting the I/O, so we never hold the service's `&mut` borrow across
    ///    an await (and never block the Tauri command thread — the heavy lifting
    ///    runs on a spawned tokio task bounded by `timeout`).
    /// 3. Open a fresh SSH3 request stream carrying the command, finish the send
    ///    side, read the response status + body to EOF, and return the combined
    ///    stdout+stderr. The HTTP status maps to success / a non-zero-exit-style
    ///    error via [`map_exec_status`].
    ///
    /// `timeout` is in **seconds** (matching the command contract /
    /// `Ssh3ConnectionConfig::connect_timeout`); `None` defaults to 30s.
    pub async fn execute_command(
        &mut self,
        session_id: &str,
        command: String,
        timeout: Option<u64>,
    ) -> Result<String, String> {
        // Pull the per-exec handles out under the borrow, then drop it so the
        // network round-trip below holds no lock on the service map.
        let (mut send_request, config) = {
            let session = self
                .sessions
                .get_mut(session_id)
                .ok_or("Session not found")?;

            if session.connection_state != Ssh3ConnectionState::Connected {
                return Err("Session not connected".to_string());
            }

            let transport = session
                .transport
                .as_ref()
                .ok_or("Session has no live transport")?;

            session.last_activity = Utc::now();
            (transport.request_sender(), session.config.clone())
        };

        let timeout_duration = Duration::from_secs(timeout.unwrap_or(30));
        log::debug!("SSH3: execute_command requested ({} bytes)", command.len());

        // Run the exec exchange on a spawned task bounded by the timeout so the
        // command thread never blocks and a hung server can't wedge us forever.
        let exec = tokio::spawn(async move {
            run_exec_stream(&mut send_request, &config, &command).await
        });

        let outcome = match tokio::time::timeout(timeout_duration, exec).await {
            Ok(join) => join.map_err(|e| format!("SSH3: exec task failed: {e}"))??,
            Err(_) => {
                return Err(format!(
                    "SSH3: command timed out after {}s",
                    timeout_duration.as_secs()
                ));
            }
        };

        // Refresh activity now that the exchange completed.
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.last_activity = Utc::now();
        }

        if outcome.truncated {
            log::warn!(
                "SSH3: exec output truncated at {} bytes",
                MAX_EXEC_OUTPUT_BYTES
            );
        }

        // Map status → result. Success returns the captured output; a non-2xx
        // status returns an error carrying the status and any captured body so
        // the caller sees a real failure rather than fabricated success.
        map_exec_status(outcome.status, outcome.output)
    }

    /// Close a channel.
    ///
    /// If the channel is the active interactive shell, signal the pump to finish
    /// its send side, abort the task, and drop the handle (so the QUIC stream is
    /// torn down). Then drop the channel record.
    pub async fn close_channel(
        &mut self,
        session_id: &str,
        channel_id: &str,
    ) -> Result<(), String> {
        // Tear down the shell pump if this is the shell channel.
        if let Some(shell) = self.shells.get(session_id) {
            if shell.id == channel_id {
                let shell = self.shells.remove(session_id).expect("just checked present");
                let _ = shell.sender.send(Ssh3ShellCommand::Close);
                shell.pump.abort();
                log::debug!("SSH3: closed shell channel {channel_id}");
            }
        }

        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or("Session not found")?;

        if session.channels.remove(channel_id).is_some() {
            log::debug!("SSH3: closed channel {channel_id}");
        }
        session.last_activity = Utc::now();
        Ok(())
    }
}

// ── exec request construction / framing / status mapping ───────────────────
//
// Kept as free functions (not methods) so they're pure and unit-testable
// without a live `Ssh3Service` / server, and so e4's interactive shell code can
// sit alongside without entangling with the one-shot exec path.

/// Build the SSH3 exec request: an HTTP/3 CONNECT to the conversation URL path
/// carrying the command in [`SSH3_COMMAND_HEADER`].
///
/// Mirrors `auth::build_connect_request`'s authority/URL conventions (which is
/// `auth`-private, so we construct the parallel exec request here rather than
/// reach across the e6-owned auth module). The `:authority` omits the default
/// HTTPS port and includes any non-standard port, matching the auth path.
///
/// t23-e7: like the auth request, this now carries the `:protocol = ssh3`
/// extended-CONNECT pseudo-header (via the patched h3 `Protocol`, see
/// `auth::maybe_attach_ssh3_protocol`). A plain CONNECT must carry an empty
/// `:path` and so could never reach a real `ssh3` server's path-routed handler;
/// the extended CONNECT lets the non-empty URL path through. The command still
/// rides the request via [`SSH3_COMMAND_HEADER`].
pub(crate) fn build_exec_request(
    config: &Ssh3ConnectionConfig,
    command: &str,
) -> Result<http::Request<()>, String> {
    let authority = if config.port == 443 {
        config.host.clone()
    } else {
        format!("{}:{}", config.host, config.port)
    };
    let uri = format!("https://{authority}{DEFAULT_SSH3_URL_PATH}");

    let mut request = http::Request::builder()
        .method(Method::CONNECT)
        .uri(&uri)
        .header(http::header::HOST, &authority)
        .header("user-agent", "sortOfRemoteNG-ssh3")
        .header(SSH3_COMMAND_HEADER, command)
        .body(())
        .map_err(|e| format!("SSH3: failed to build exec request: {e}"))?;
    // Extended CONNECT: attach `:protocol = ssh3` so the server routes the exec
    // conversation (shared seam with the connect/auth + shell requests).
    maybe_attach_ssh3_protocol(&mut request);
    Ok(request)
}

/// Drive one exec request stream to completion: open the stream, send the
/// command (header + body), finish the send side, read the response status,
/// then pump the body to EOF collecting combined output.
///
/// The command is also written to the request body (as UTF-8) in addition to
/// the header, so a server that reads the command from the stream body still
/// receives it. Servers that key off the header simply ignore the body.
pub(crate) async fn run_exec_stream(
    send_request: &mut Ssh3SendRequest,
    config: &Ssh3ConnectionConfig,
    command: &str,
) -> Result<ExecOutcome, String> {
    let request = build_exec_request(config, command)?;

    let mut stream = send_request
        .send_request(request)
        .await
        .map_err(|e| format!("SSH3: failed to open exec stream: {e}"))?;

    // Send the command in the request body too (belt-and-braces with the
    // header), then close the send side so the server can run it and reply.
    stream
        .send_data(Bytes::from(command.as_bytes().to_vec()))
        .await
        .map_err(|e| format!("SSH3: failed to send exec command: {e}"))?;
    stream
        .finish()
        .await
        .map_err(|e| format!("SSH3: failed to finish exec request: {e}"))?;

    let response = stream
        .recv_response()
        .await
        .map_err(|e| format!("SSH3: failed to receive exec response: {e}"))?;
    let status = response.status();

    // Pump the response body to EOF, capturing combined stdout+stderr (SSH3
    // carries them interleaved over the single conversation stream).
    let mut buf: Vec<u8> = Vec::new();
    let mut truncated = false;
    loop {
        match stream.recv_data().await {
            Ok(Some(mut chunk)) => {
                while chunk.has_remaining() {
                    if buf.len() >= MAX_EXEC_OUTPUT_BYTES {
                        truncated = true;
                        break;
                    }
                    let take = std::cmp::min(
                        chunk.remaining(),
                        MAX_EXEC_OUTPUT_BYTES - buf.len(),
                    );
                    let slice = chunk.chunk();
                    let n = std::cmp::min(take, slice.len());
                    buf.extend_from_slice(&slice[..n]);
                    chunk.advance(n);
                }
                if truncated {
                    break;
                }
            }
            Ok(None) => break, // clean EOF
            Err(e) => return Err(format!("SSH3: error reading exec output: {e}")),
        }
    }

    let output = String::from_utf8_lossy(&buf).into_owned();
    Ok(ExecOutcome {
        output,
        status,
        truncated,
    })
}

/// Map the exec response status + captured body to the command result.
///
/// `2xx` → success, return the combined output. Any other status is a real
/// failure: surface the status and include any captured body so the caller sees
/// what the server said rather than a fabricated success string.
pub(crate) fn map_exec_status(
    status: http::StatusCode,
    output: String,
) -> Result<String, String> {
    if status.is_success() {
        Ok(output)
    } else if status == http::StatusCode::UNAUTHORIZED
        || status == http::StatusCode::FORBIDDEN
    {
        Err(format!(
            "SSH3: exec rejected (HTTP {}): not authorized for this session",
            status.as_u16()
        ))
    } else {
        let trimmed = output.trim();
        if trimmed.is_empty() {
            Err(format!("SSH3: command failed (HTTP {})", status.as_u16()))
        } else {
            Err(format!(
                "SSH3: command failed (HTTP {}): {}",
                status.as_u16(),
                trimmed
            ))
        }
    }
}

// ── interactive shell request / framing / emit helpers ─────────────────────
//
// Kept as free functions so they're pure and unit-testable without a live
// `Ssh3Service` / server, and sit alongside the exec path without entangling.

/// Build the SSH3 interactive-shell request: an HTTP/3 CONNECT to the
/// conversation URL path carrying a PTY-allocation header.
///
/// Mirrors [`build_exec_request`]'s authority/URL conventions. Like exec, this
/// now carries the `:protocol = ssh3` extended-CONNECT pseudo-header (t23-e7,
/// via the patched h3 `Protocol`). The PTY request rides the request via
/// [`SSH3_PTY_HEADER`], which is the load-bearing part for shell allocation.
pub(crate) fn build_shell_request(
    config: &Ssh3ConnectionConfig,
) -> Result<http::Request<()>, String> {
    let authority = if config.port == 443 {
        config.host.clone()
    } else {
        format!("{}:{}", config.host, config.port)
    };
    let uri = format!("https://{authority}{DEFAULT_SSH3_URL_PATH}");

    let mut request = http::Request::builder()
        .method(Method::CONNECT)
        .uri(&uri)
        .header(http::header::HOST, &authority)
        .header("user-agent", "sortOfRemoteNG-ssh3")
        // Request a PTY of the default terminal type. SSH3 allocates the shell
        // PTY server-side; the type/initial size ride this header.
        .header(SSH3_PTY_HEADER, "xterm-256color")
        .body(())
        .map_err(|e| format!("SSH3: failed to build shell request: {e}"))?;
    // Extended CONNECT: attach `:protocol = ssh3` (shared seam with connect/exec).
    maybe_attach_ssh3_protocol(&mut request);
    Ok(request)
}

/// Encode a window-change (resize) control message written inline on the shell
/// stream. Host-independent + pure so it can be unit-tested without a server.
///
/// Format: `\x1b]ssh3-resize;<cols>;<rows>\x07` — an OSC-style escape so it is
/// unambiguously distinguishable from raw terminal input bytes. The exact wire
/// detail a live upstream server expects can only be confirmed against a real
/// server (host-gated); the framing is isolated here so it is the single place
/// to adjust once a live server is available.
pub(crate) fn shell_resize_frame(cols: u32, rows: u32) -> Vec<u8> {
    format!("\x1b]ssh3-resize;{cols};{rows}\x07").into_bytes()
}

/// Emit an `ssh3-output` event carrying terminal output for the UI.
fn emit_shell_output(
    emitter: &DynEventEmitter,
    session_id: &str,
    channel_id: &str,
    data: String,
) {
    let payload = Ssh3ShellOutput {
        session_id: session_id.to_string(),
        channel_id: channel_id.to_string(),
        data,
    };
    let _ = emitter.emit_event(
        SSH3_SHELL_OUTPUT_EVENT,
        serde_json::to_value(&payload).unwrap_or_default(),
    );
}

/// Emit an `ssh3-error` event for a fatal shell-stream error.
fn emit_shell_error(
    emitter: &DynEventEmitter,
    session_id: &str,
    channel_id: &str,
    message: &str,
) {
    let payload = Ssh3ShellError {
        session_id: session_id.to_string(),
        channel_id: channel_id.to_string(),
        message: message.to_string(),
    };
    let _ = emitter.emit_event(
        SSH3_SHELL_ERROR_EVENT,
        serde_json::to_value(&payload).unwrap_or_default(),
    );
}

/// Emit an `ssh3-shell-closed` event when the shell stream ends.
fn emit_shell_closed(emitter: &DynEventEmitter, session_id: &str, channel_id: &str) {
    let payload = Ssh3ShellClosed {
        session_id: session_id.to_string(),
        channel_id: channel_id.to_string(),
    };
    let _ = emitter.emit_event(
        SSH3_SHELL_CLOSED_EVENT,
        serde_json::to_value(&payload).unwrap_or_default(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(host: &str, port: u16) -> Ssh3ConnectionConfig {
        Ssh3ConnectionConfig {
            host: host.to_string(),
            port,
            ..Default::default()
        }
    }

    #[test]
    fn exec_request_targets_url_path_and_carries_command() {
        let c = cfg("example.com", 443);
        let req = build_exec_request(&c, "echo hi").expect("request builds");
        assert_eq!(req.method(), Method::CONNECT);
        assert_eq!(req.uri().path(), DEFAULT_SSH3_URL_PATH);
        assert_eq!(req.uri().host(), Some("example.com"));
        let cmd = req
            .headers()
            .get(SSH3_COMMAND_HEADER)
            .expect("command header present");
        assert_eq!(cmd.to_str().unwrap(), "echo hi");
    }

    #[test]
    fn exec_request_attaches_ssh3_extended_connect_protocol() {
        // t23-e7: exec must use the extended CONNECT (`:protocol = ssh3`) too,
        // or a real ssh3 server can't route it (plain CONNECT needs empty path).
        let c = cfg("example.com", 443);
        let req = build_exec_request(&c, "echo hi").expect("request builds");
        let proto = req
            .extensions()
            .get::<h3::ext::Protocol>()
            .expect(":protocol extension must be attached on exec");
        assert_eq!(proto.as_str(), "ssh3");
    }

    #[test]
    fn exec_request_default_port_omitted_from_authority() {
        let c = cfg("host.example", 443);
        let req = build_exec_request(&c, "ls").expect("request builds");
        assert_eq!(req.uri().authority().map(|a| a.as_str()), Some("host.example"));
    }

    #[test]
    fn exec_request_nonstandard_port_in_authority() {
        let c = cfg("host.example", 8443);
        let req = build_exec_request(&c, "ls").expect("request builds");
        assert_eq!(
            req.uri().authority().map(|a| a.as_str()),
            Some("host.example:8443")
        );
    }

    #[test]
    fn exec_request_no_authorization_header() {
        // The exec request itself must not carry credentials — auth is done on
        // the connection (auth.rs); exec rides the already-authenticated H3.
        let c = cfg("example.com", 443);
        let req = build_exec_request(&c, "whoami").expect("request builds");
        assert!(req.headers().get(http::header::AUTHORIZATION).is_none());
    }

    #[test]
    fn exec_request_rejects_control_chars_in_command_via_http() {
        // A command with an embedded newline is an invalid HTTP header value;
        // building the request must error rather than smuggle a header.
        let c = cfg("example.com", 443);
        let err = build_exec_request(&c, "echo hi\r\nInjected: x").unwrap_err();
        assert!(err.contains("failed to build exec request"), "got: {err}");
    }

    #[test]
    fn map_exec_status_2xx_returns_output() {
        let out = map_exec_status(http::StatusCode::OK, "hello\n".to_string()).unwrap();
        assert_eq!(out, "hello\n");
    }

    #[test]
    fn map_exec_status_200_empty_output_ok() {
        let out = map_exec_status(http::StatusCode::OK, String::new()).unwrap();
        assert_eq!(out, "");
    }

    #[test]
    fn map_exec_status_401_is_authorization_error() {
        let err = map_exec_status(http::StatusCode::UNAUTHORIZED, String::new()).unwrap_err();
        assert!(err.contains("not authorized"), "got: {err}");
        assert!(err.contains("401"));
    }

    #[test]
    fn map_exec_status_500_includes_body() {
        let err = map_exec_status(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            "boom details".to_string(),
        )
        .unwrap_err();
        assert!(err.contains("500"));
        assert!(err.contains("boom details"));
    }

    #[test]
    fn map_exec_status_500_empty_body_still_errors() {
        let err = map_exec_status(
            http::StatusCode::INTERNAL_SERVER_ERROR,
            String::new(),
        )
        .unwrap_err();
        assert!(err.contains("command failed"));
        assert!(err.contains("500"));
    }

    #[tokio::test]
    async fn execute_command_on_missing_session_errors() {
        let mut svc = Ssh3Service::new();
        let err = svc
            .execute_command("no-such-session", "echo hi".to_string(), Some(5))
            .await
            .unwrap_err();
        assert_eq!(err, "Session not found");
    }

    #[tokio::test]
    async fn execute_command_requires_live_transport() {
        // A session record that is not Connected (no live transport) must NOT
        // run a fake exec — it errors honestly instead of returning placeholder
        // output (the old hardcoded-string behaviour this replaces).
        let mut svc = Ssh3Service::new();
        let session = super::super::Ssh3Session {
            id: "s1".to_string(),
            config: cfg("example.com", 443),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            connection_state: Ssh3ConnectionState::Connecting,
            channels: std::collections::HashMap::new(),
            keep_alive_handle: None,
            transport: None,
        };
        svc.sessions.insert("s1".to_string(), session);
        let err = svc
            .execute_command("s1", "echo hi".to_string(), Some(5))
            .await
            .unwrap_err();
        assert_eq!(err, "Session not connected");
    }

    #[tokio::test]
    async fn execute_command_connected_but_no_transport_errors() {
        // Defensive: a session marked Connected but somehow lacking a transport
        // must surface a real error, never fabricate output.
        let mut svc = Ssh3Service::new();
        let session = super::super::Ssh3Session {
            id: "s2".to_string(),
            config: cfg("example.com", 443),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            connection_state: Ssh3ConnectionState::Connected,
            channels: std::collections::HashMap::new(),
            keep_alive_handle: None,
            transport: None,
        };
        svc.sessions.insert("s2".to_string(), session);
        let err = svc
            .execute_command("s2", "echo hi".to_string(), Some(5))
            .await
            .unwrap_err();
        assert_eq!(err, "Session has no live transport");
    }

    // ── interactive shell (t23-e4) ─────────────────────────────────────────

    #[test]
    fn shell_request_targets_url_path_and_requests_pty() {
        let c = cfg("example.com", 443);
        let req = build_shell_request(&c).expect("request builds");
        assert_eq!(req.method(), Method::CONNECT);
        assert_eq!(req.uri().path(), DEFAULT_SSH3_URL_PATH);
        assert_eq!(req.uri().host(), Some("example.com"));
        let pty = req
            .headers()
            .get(SSH3_PTY_HEADER)
            .expect("pty header present");
        assert_eq!(pty.to_str().unwrap(), "xterm-256color");
    }

    #[test]
    fn shell_request_attaches_ssh3_extended_connect_protocol() {
        // t23-e7: the interactive shell request likewise rides the extended
        // CONNECT so the server routes it.
        let c = cfg("example.com", 443);
        let req = build_shell_request(&c).expect("request builds");
        let proto = req
            .extensions()
            .get::<h3::ext::Protocol>()
            .expect(":protocol extension must be attached on shell");
        assert_eq!(proto.as_str(), "ssh3");
    }

    #[test]
    fn shell_request_default_port_omitted_from_authority() {
        let c = cfg("host.example", 443);
        let req = build_shell_request(&c).expect("request builds");
        assert_eq!(
            req.uri().authority().map(|a| a.as_str()),
            Some("host.example")
        );
    }

    #[test]
    fn shell_request_nonstandard_port_in_authority() {
        let c = cfg("host.example", 8443);
        let req = build_shell_request(&c).expect("request builds");
        assert_eq!(
            req.uri().authority().map(|a| a.as_str()),
            Some("host.example:8443")
        );
    }

    #[test]
    fn shell_request_carries_no_authorization_header() {
        // The shell request rides the already-authenticated H3 connection; it
        // must not carry credentials of its own.
        let c = cfg("example.com", 443);
        let req = build_shell_request(&c).expect("request builds");
        assert!(req.headers().get(http::header::AUTHORIZATION).is_none());
    }

    #[test]
    fn resize_frame_encodes_cols_and_rows() {
        let frame = shell_resize_frame(120, 40);
        let s = String::from_utf8(frame).expect("frame is utf8");
        assert!(s.starts_with('\x1b'), "starts with ESC: {s:?}");
        assert!(s.contains("ssh3-resize;120;40"), "got: {s:?}");
        assert!(s.ends_with('\x07'), "ends with BEL: {s:?}");
    }

    #[test]
    fn resize_frame_distinct_per_size() {
        assert_ne!(shell_resize_frame(80, 24), shell_resize_frame(80, 25));
        assert_ne!(shell_resize_frame(80, 24), shell_resize_frame(81, 24));
    }

    #[tokio::test]
    async fn start_shell_on_missing_session_errors() {
        let mut svc = Ssh3Service::new();
        let emitter: DynEventEmitter =
            std::sync::Arc::new(sorng_core::events::NoopEventEmitter);
        let err = svc
            .start_shell("no-such-session", emitter)
            .await
            .unwrap_err();
        assert_eq!(err, "Session not found");
    }

    #[tokio::test]
    async fn start_shell_requires_connected_state() {
        let mut svc = Ssh3Service::new();
        let session = super::super::Ssh3Session {
            id: "s1".to_string(),
            config: cfg("example.com", 443),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            connection_state: Ssh3ConnectionState::Connecting,
            channels: std::collections::HashMap::new(),
            keep_alive_handle: None,
            transport: None,
        };
        svc.sessions.insert("s1".to_string(), session);
        let emitter: DynEventEmitter =
            std::sync::Arc::new(sorng_core::events::NoopEventEmitter);
        let err = svc.start_shell("s1", emitter).await.unwrap_err();
        assert_eq!(err, "Session not connected");
    }

    #[tokio::test]
    async fn start_shell_connected_but_no_transport_errors() {
        let mut svc = Ssh3Service::new();
        let session = super::super::Ssh3Session {
            id: "s2".to_string(),
            config: cfg("example.com", 443),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            connection_state: Ssh3ConnectionState::Connected,
            channels: std::collections::HashMap::new(),
            keep_alive_handle: None,
            transport: None,
        };
        svc.sessions.insert("s2".to_string(), session);
        let emitter: DynEventEmitter =
            std::sync::Arc::new(sorng_core::events::NoopEventEmitter);
        let err = svc.start_shell("s2", emitter).await.unwrap_err();
        assert_eq!(err, "Session has no live transport");
    }

    #[tokio::test]
    async fn send_input_without_open_shell_errors() {
        let mut svc = Ssh3Service::new();
        let err = svc
            .send_shell_input("s1", "chan", "ls\n".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("no interactive shell open"), "got: {err}");
    }

    #[tokio::test]
    async fn resize_without_open_shell_errors() {
        let mut svc = Ssh3Service::new();
        let err = svc
            .resize_shell("s1", "chan", 80, 24)
            .await
            .unwrap_err();
        assert!(err.contains("no interactive shell open"), "got: {err}");
    }

    #[tokio::test]
    async fn send_input_channel_mismatch_errors() {
        // A live shell handle whose id does not match the supplied channel id
        // must reject the input rather than write to the wrong stream.
        let mut svc = Ssh3Service::new();
        let (tx, _rx) = mpsc::unbounded_channel::<Ssh3ShellCommand>();
        let pump = tokio::spawn(async {});
        svc.shells.insert(
            "s1".to_string(),
            Ssh3ShellHandle {
                id: "real-chan".to_string(),
                sender: tx,
                pump,
            },
        );
        let err = svc
            .send_shell_input("s1", "wrong-chan", "x".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("does not match"), "got: {err}");
    }

    #[tokio::test]
    async fn close_channel_tears_down_shell_pump() {
        let mut svc = Ssh3Service::new();
        let (tx, mut rx) = mpsc::unbounded_channel::<Ssh3ShellCommand>();
        // A pump that blocks until close, so we can prove abort() takes effect.
        let pump = tokio::spawn(async move {
            let _ = rx.recv().await;
            futures_for_test().await;
        });
        svc.shells.insert(
            "s1".to_string(),
            Ssh3ShellHandle {
                id: "chan".to_string(),
                sender: tx,
                pump,
            },
        );
        // Need a session record so close_channel reaches the session arm too.
        svc.sessions.insert(
            "s1".to_string(),
            super::super::Ssh3Session {
                id: "s1".to_string(),
                config: cfg("example.com", 443),
                connected_at: Utc::now(),
                last_activity: Utc::now(),
                connection_state: Ssh3ConnectionState::Connected,
                channels: std::collections::HashMap::new(),
                keep_alive_handle: None,
                transport: None,
            },
        );
        svc.close_channel("s1", "chan").await.expect("close ok");
        assert!(
            !svc.shells.contains_key("s1"),
            "shell handle removed on close"
        );
    }

    // A never-resolving future, used only to keep a test pump task alive so the
    // abort path is what ends it.
    async fn futures_for_test() {
        std::future::pending::<()>().await
    }
}

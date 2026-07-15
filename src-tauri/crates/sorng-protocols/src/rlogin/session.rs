use super::codec::{encode_handshake, encode_window_update, read_server_ack};
use super::io::RloginByteStream;
use super::protocol::InputProcessor;
use super::replay::{OutputFrame, ReplayBuffer, ReplaySnapshot};
use super::types::{
    LocalFlowAction, RloginConfig, RloginError, RloginLifecycle, RloginStats, WindowSize,
};
use super::urgent::{UrgentAction, UrgentState, UrgentUpdate};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OutputDisposition {
    Display { frame: OutputFrame },
    Buffered { sequence: u64, byte_length: usize },
    EndOfStream,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InputOutcome {
    pub bytes_written: usize,
    pub local_flow_actions: Vec<LocalFlowAction>,
    pub resumed_output: Option<ReplaySnapshot>,
    pub disconnect_requested: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResizeOutcome {
    Deferred,
    Sent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UrgentOutcome {
    pub update: UrgentUpdate,
    pub resize: Option<ResizeOutcome>,
}

/// Cloneable cancellation handle used by a session actor to interrupt a
/// pending idle read before it acquires the engine for orderly cleanup.
#[derive(Debug, Clone)]
pub struct RloginCancellation {
    sender: watch::Sender<bool>,
}

impl RloginCancellation {
    pub fn cancel(&self) {
        self.sender.send_replace(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.sender.borrow()
    }
}

/// A single established RLogin protocol session.  Platform transports must
/// feed urgent/OOB bytes to `handle_urgent_control`; normal reads stay fully
/// transparent and never scan the data stream for control-looking bytes.
pub struct RloginEngine<S: RloginByteStream> {
    stream: S,
    config: RloginConfig,
    lifecycle: RloginLifecycle,
    urgent_state: UrgentState,
    input_processor: InputProcessor,
    replay: ReplayBuffer,
    stats: RloginStats,
    cached_window: WindowSize,
    paused_after_sequence: Option<u64>,
    cancellation: RloginCancellation,
    cancellation_receiver: watch::Receiver<bool>,
    cleanup_complete: bool,
}

impl<S: RloginByteStream> RloginEngine<S> {
    /// Complete the RFC 1282 handshake over an already-connected stream.
    pub async fn establish(mut stream: S, config: RloginConfig) -> Result<Self, RloginError> {
        let handshake = encode_handshake(&config)?;
        let handshake_timeout_ms = config.handshake_timeout_ms;

        let result = timeout(config.handshake_timeout(), async {
            stream.write_all_bytes(&handshake).await?;
            stream.flush_bytes().await?;
            read_server_ack(&mut stream).await
        })
        .await;

        match result {
            Ok(Ok(())) => {
                let (cancellation_sender, cancellation_receiver) = watch::channel(false);
                Ok(Self {
                    input_processor: InputProcessor::new(
                        config.escape_enabled,
                        config.escape_byte,
                        config.local_flow_control,
                    ),
                    replay: ReplayBuffer::new(config.replay_capacity_bytes),
                    stats: RloginStats {
                        handshake_bytes_sent: handshake.len() as u64,
                        ..RloginStats::default()
                    },
                    cached_window: config.initial_window,
                    stream,
                    config,
                    lifecycle: RloginLifecycle::Connected,
                    urgent_state: UrgentState::default(),
                    paused_after_sequence: None,
                    cancellation: RloginCancellation {
                        sender: cancellation_sender,
                    },
                    cancellation_receiver,
                    cleanup_complete: false,
                })
            }
            Ok(Err(error)) => {
                let _ = stream.shutdown_bytes().await;
                Err(error)
            }
            Err(_) => {
                let _ = stream.shutdown_bytes().await;
                Err(RloginError::HandshakeTimeout {
                    timeout_ms: handshake_timeout_ms,
                })
            }
        }
    }

    pub fn config(&self) -> &RloginConfig {
        &self.config
    }

    pub fn lifecycle(&self) -> RloginLifecycle {
        self.lifecycle
    }

    pub fn is_connected(&self) -> bool {
        self.lifecycle == RloginLifecycle::Connected
    }

    pub fn urgent_state(&self) -> UrgentState {
        self.urgent_state
    }

    pub fn stats(&self) -> &RloginStats {
        &self.stats
    }

    pub fn output_snapshot_after(&self, after_sequence: u64) -> ReplaySnapshot {
        self.replay.snapshot_after(after_sequence)
    }

    pub fn cancellation_handle(&self) -> RloginCancellation {
        self.cancellation.clone()
    }

    pub async fn write_input(&mut self, input: &[u8]) -> Result<InputOutcome, RloginError> {
        self.ensure_connected()?;

        let processed = self
            .input_processor
            .process(input, self.urgent_state.terminal_mode);
        if !processed.wire_bytes.is_empty() {
            self.write_with_policy(&processed.wire_bytes, "terminal write")
                .await?;
            self.stats.terminal_bytes_sent = self
                .stats
                .terminal_bytes_sent
                .saturating_add(processed.wire_bytes.len() as u64);
        }

        let mut resumed_output = None;
        for action in &processed.local_flow_actions {
            match action {
                LocalFlowAction::PauseOutput => {
                    if self.paused_after_sequence.is_none() {
                        self.paused_after_sequence = Some(self.replay.last_sequence());
                    }
                }
                LocalFlowAction::ResumeOutput => {
                    if let Some(after_sequence) = self.paused_after_sequence.take() {
                        resumed_output = Some(self.replay.snapshot_after(after_sequence));
                    }
                }
            }
        }

        let outcome = InputOutcome {
            bytes_written: processed.wire_bytes.len(),
            local_flow_actions: processed.local_flow_actions,
            resumed_output,
            disconnect_requested: processed.disconnect_requested,
        };

        if outcome.disconnect_requested {
            self.close().await?;
        }
        Ok(outcome)
    }

    /// Read ordinary terminal bytes.  Urgent bytes are deliberately excluded
    /// and must be supplied separately by the transport adapter.
    pub async fn read_output(
        &mut self,
        buffer: &mut [u8],
    ) -> Result<OutputDisposition, RloginError> {
        self.ensure_connected()?;
        if buffer.is_empty() {
            return Err(RloginError::invalid(
                "readBuffer",
                "must have a non-zero length",
            ));
        }

        let mut cancellation = self.cancellation_receiver.clone();
        let reading = timeout(self.config.idle_timeout(), self.stream.read_bytes(buffer));
        let count = match tokio::select! {
            biased;
            _ = wait_for_cancellation(&mut cancellation) => Err(RloginError::Cancelled),
            result = reading => match result {
                Ok(result) => result,
                Err(_) => Err(RloginError::OperationTimeout {
                    operation: "idle read",
                    timeout_ms: self.config.idle_timeout_ms,
                }),
            }
        } {
            Ok(count) => count,
            Err(RloginError::Cancelled) => {
                self.lifecycle = RloginLifecycle::Closing;
                return Err(RloginError::Cancelled);
            }
            Err(error) => {
                self.lifecycle = RloginLifecycle::Error;
                return Err(error);
            }
        };
        if count == 0 {
            self.close().await?;
            return Ok(OutputDisposition::EndOfStream);
        }

        self.stats.terminal_bytes_received = self
            .stats
            .terminal_bytes_received
            .saturating_add(count as u64);
        let frame = self
            .replay
            .push(&buffer[..count])
            .expect("a non-empty read always creates a replay frame");
        if self.paused_after_sequence.is_some() {
            Ok(OutputDisposition::Buffered {
                sequence: frame.sequence,
                byte_length: frame.data.len(),
            })
        } else {
            Ok(OutputDisposition::Display { frame })
        }
    }

    pub async fn resize(&mut self, size: WindowSize) -> Result<ResizeOutcome, RloginError> {
        self.ensure_connected()?;
        self.cached_window = size;
        if !self.urgent_state.window_updates_enabled {
            return Ok(ResizeOutcome::Deferred);
        }
        self.send_window_update().await?;
        Ok(ResizeOutcome::Sent)
    }

    /// Apply one out-of-band control byte supplied by the platform transport.
    pub async fn handle_urgent_control(
        &mut self,
        control: u8,
    ) -> Result<UrgentOutcome, RloginError> {
        self.ensure_connected()?;
        self.stats.urgent_controls_received = self.stats.urgent_controls_received.saturating_add(1);
        let update = self.urgent_state.apply(control);
        let mut resize = None;

        for action in &update.actions {
            match action {
                UrgentAction::DiscardOutput => {
                    let discarded = self.replay.discard();
                    self.stats.discarded_output_bytes = self
                        .stats
                        .discarded_output_bytes
                        .saturating_add(discarded as u64);
                    if self.paused_after_sequence.is_some() {
                        self.paused_after_sequence = Some(self.replay.last_sequence());
                    }
                }
                UrgentAction::SendWindowUpdate => {
                    self.send_window_update().await?;
                    resize = Some(ResizeOutcome::Sent);
                }
                UrgentAction::EnterRawMode | UrgentAction::EnterCookedMode => {}
            }
        }

        Ok(UrgentOutcome { update, resize })
    }

    pub async fn close(&mut self) -> Result<(), RloginError> {
        if self.cleanup_complete {
            return Ok(());
        }
        self.lifecycle = RloginLifecycle::Closing;
        self.cancellation.cancel();
        let result = match timeout(self.config.write_timeout(), self.stream.shutdown_bytes()).await
        {
            Ok(result) => result,
            Err(_) => Err(RloginError::OperationTimeout {
                operation: "shutdown",
                timeout_ms: self.config.write_timeout_ms,
            }),
        };
        self.cleanup_complete = true;
        self.lifecycle = RloginLifecycle::Closed;
        result
    }

    fn ensure_connected(&self) -> Result<(), RloginError> {
        if self.is_connected() {
            Ok(())
        } else {
            Err(RloginError::NotConnected)
        }
    }

    async fn send_window_update(&mut self) -> Result<(), RloginError> {
        let frame = encode_window_update(self.cached_window);
        self.write_with_policy(&frame, "window update").await?;
        self.stats.protocol_bytes_sent = self
            .stats
            .protocol_bytes_sent
            .saturating_add(frame.len() as u64);
        self.stats.resize_frames_sent = self.stats.resize_frames_sent.saturating_add(1);
        Ok(())
    }

    async fn write_with_policy(
        &mut self,
        bytes: &[u8],
        operation: &'static str,
    ) -> Result<(), RloginError> {
        let mut cancellation = self.cancellation_receiver.clone();
        let writing = timeout(self.config.write_timeout(), async {
            self.stream.write_all_bytes(bytes).await?;
            self.stream.flush_bytes().await
        });
        let result = tokio::select! {
            biased;
            _ = wait_for_cancellation(&mut cancellation) => Err(RloginError::Cancelled),
            result = writing => match result {
                Ok(result) => result,
                Err(_) => Err(RloginError::OperationTimeout {
                    operation,
                    timeout_ms: self.config.write_timeout_ms,
                }),
            }
        };
        if let Err(error) = result {
            self.lifecycle = if error == RloginError::Cancelled {
                RloginLifecycle::Closing
            } else {
                RloginLifecycle::Error
            };
            return Err(error);
        }
        Ok(())
    }
}

async fn wait_for_cancellation(receiver: &mut watch::Receiver<bool>) {
    if *receiver.borrow() {
        return;
    }
    while receiver.changed().await.is_ok() {
        if *receiver.borrow() {
            return;
        }
    }
}

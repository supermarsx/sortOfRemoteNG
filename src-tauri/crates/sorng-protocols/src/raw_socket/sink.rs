use super::{RawSocketEvent, RawSocketFrame, RawSocketFrameMetadata};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawSocketSinkError;

/// Framework-neutral delivery sink.  Each call to `send_frame` represents one
/// TCP receive chunk or one complete UDP datagram; implementations must not
/// concatenate separate calls.
pub trait RawSocketSink: Send + Sync + 'static {
    fn send_frame(
        &self,
        session_id: &str,
        frame: &RawSocketFrame,
        replayed: bool,
    ) -> Result<(), RawSocketSinkError>;

    fn send_event(&self, event: &RawSocketEvent) -> Result<(), RawSocketSinkError>;
}

pub type DynRawSocketSink = Arc<dyn RawSocketSink>;

#[derive(Debug, Default)]
pub struct NoopRawSocketSink;

impl RawSocketSink for NoopRawSocketSink {
    fn send_frame(
        &self,
        _session_id: &str,
        _frame: &RawSocketFrame,
        _replayed: bool,
    ) -> Result<(), RawSocketSinkError> {
        Ok(())
    }

    fn send_event(&self, _event: &RawSocketEvent) -> Result<(), RawSocketSinkError> {
        Ok(())
    }
}

pub fn frame_metadata(
    session_id: &str,
    frame: &RawSocketFrame,
    replayed: bool,
) -> RawSocketFrameMetadata {
    RawSocketFrameMetadata {
        session_id: session_id.to_owned(),
        sequence: frame.sequence,
        timestamp_ms: frame.timestamp_ms,
        direction: frame.direction,
        datagram: frame.datagram,
        byte_length: frame.data.len(),
        replayed,
    }
}

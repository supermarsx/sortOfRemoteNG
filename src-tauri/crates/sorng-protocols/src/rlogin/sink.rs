use super::{OutputFrame, RloginEvent, RloginOutputMetadata};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RloginSinkError;

/// Framework-neutral, binary-safe output delivery. Normal TCP bytes are sent
/// separately from their typed sequence metadata so the IPC bridge never
/// converts terminal output through UTF-8.
pub trait RloginSink: Send + Sync + 'static {
    fn send_frame(
        &self,
        session_id: &str,
        frame: &OutputFrame,
        replayed: bool,
    ) -> Result<(), RloginSinkError>;

    fn send_event(&self, event: &RloginEvent) -> Result<(), RloginSinkError>;
}

pub type DynRloginSink = Arc<dyn RloginSink>;

#[derive(Debug, Default)]
pub struct NoopRloginSink;

impl RloginSink for NoopRloginSink {
    fn send_frame(
        &self,
        _session_id: &str,
        _frame: &OutputFrame,
        _replayed: bool,
    ) -> Result<(), RloginSinkError> {
        Ok(())
    }

    fn send_event(&self, _event: &RloginEvent) -> Result<(), RloginSinkError> {
        Ok(())
    }
}

pub fn output_metadata(
    session_id: &str,
    frame: &OutputFrame,
    replayed: bool,
) -> RloginOutputMetadata {
    RloginOutputMetadata {
        session_id: session_id.to_owned(),
        sequence: frame.sequence,
        byte_length: frame.data.len(),
        prefix_truncated: frame.prefix_truncated,
        replayed,
    }
}

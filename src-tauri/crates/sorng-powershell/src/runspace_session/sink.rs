use std::sync::Arc;

use super::PowerShellEventEnvelope;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PowerShellSinkError;

pub trait PowerShellSessionSink: Send + Sync + 'static {
    fn send(&self, envelope: &PowerShellEventEnvelope) -> Result<(), PowerShellSinkError>;
}

pub type DynPowerShellSessionSink = Arc<dyn PowerShellSessionSink>;

#[derive(Debug, Default)]
pub struct NoopPowerShellSessionSink;

impl PowerShellSessionSink for NoopPowerShellSessionSink {
    fn send(&self, _envelope: &PowerShellEventEnvelope) -> Result<(), PowerShellSinkError> {
        Ok(())
    }
}

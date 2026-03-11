//! Framework-agnostic frame delivery channel.

use std::sync::Arc;

/// Trait for sending raw frame data to the frontend.
///
/// Implementations must be `Send + Sync + 'static` so they can be shared
/// across threads. In the Tauri app layer this wraps
/// `Channel<InvokeResponseBody>`.
pub trait FrameChannel: Send + Sync + 'static {
    /// Send a raw binary frame payload.
    fn send_raw(&self, data: Vec<u8>) -> Result<(), String>;
}

/// Type alias for a shared, boxed frame channel.
pub type DynFrameChannel = Arc<dyn FrameChannel>;

/// A no-op frame channel that discards all data.
pub struct NoopFrameChannel;

impl FrameChannel for NoopFrameChannel {
    fn send_raw(&self, _data: Vec<u8>) -> Result<(), String> {
        Ok(())
    }
}

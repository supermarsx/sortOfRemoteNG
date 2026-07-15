//! RFC 1282 RLogin protocol engine.
//!
//! The engine deliberately accepts an already-connected asynchronous byte
//! stream.  Dialling, proxy traversal, VPN setup, SSH jumps, and platform
//! specific urgent-data extraction belong to the transport adapter.  This
//! module owns only RLogin framing, state, byte flow, and replay semantics.

mod codec;
mod io;
mod protocol;
mod replay;
mod service;
mod session;
mod sink;
mod types;
mod urgent;

pub use codec::{encode_handshake, encode_window_update, read_server_ack};
pub use io::{BoxedRloginStream, RloginByteStream, RloginIoFuture};
pub use protocol::{InputProcessor, ProcessedInput};
pub use replay::{OutputFrame, ReplayBuffer, ReplaySnapshot};
pub use service::{
    RloginEvent, RloginOutputMetadata, RloginService, RloginServiceState, RloginSession,
    RloginTerminalReason,
};
pub use session::{
    InputOutcome, OutputDisposition, ResizeOutcome, RloginCancellation, RloginEngine, UrgentOutcome,
};
pub use sink::{output_metadata, DynRloginSink, NoopRloginSink, RloginSink, RloginSinkError};
pub use types::{
    LocalFlowAction, RloginCapabilities, RloginConfig, RloginConnectOptions, RloginDiagnosis,
    RloginError, RloginLifecycle, RloginSourcePortMode, RloginStats, TerminalMode, WindowSize,
    DEFAULT_REPLAY_CAPACITY_BYTES, DEFAULT_RLOGIN_PORT, MAX_ACTIVE_RLOGIN_SESSIONS,
    MAX_RLOGIN_INPUT_BYTES,
};
pub use urgent::{
    UrgentAction, UrgentState, UrgentUpdate, URGENT_COOKED_MODE, URGENT_DISCARD_OUTPUT,
    URGENT_RAW_MODE, URGENT_WINDOW_UPDATE,
};

#[cfg(test)]
mod tests;

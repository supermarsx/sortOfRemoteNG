//! Binary-safe application-payload TCP and UDP sessions.
//!
//! "Raw socket" in this module means an unopinionated byte-stream or datagram
//! client, similar to netcat.  It never opens privileged IP-layer raw sockets
//! and never pretends that ordinary TCP/UDP sockets are privileged raw ones.

mod replay;
mod service;
mod sink;
mod types;

pub use service::{RawSocketService, RawSocketServiceState};
pub use sink::{
    frame_metadata, DynRawSocketSink, NoopRawSocketSink, RawSocketSink, RawSocketSinkError,
};
pub use types::*;

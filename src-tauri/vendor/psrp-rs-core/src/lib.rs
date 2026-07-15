//! Transport-agnostic async [MS-PSRP] protocol core for Rust.
//!
//! This local fork provides the PSRP fragment, CLIXML, runspace, and pipeline
//! layers on top of an application-supplied [`PsrpTransport`]. It delivers:
//!
//! - typed PowerShell objects on the `Output` stream;
//! - isolated `Error`, `Warning`, `Verbose`, `Debug`, `Information` and
//!   `Progress` streams;
//! - a persistent [`RunspacePool`] that keeps a `powershell.exe` process
//!   alive across many pipelines;
//! - a builder-style [`Pipeline`] API.
//!
//! [MS-PSRP]: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-psrp/
//!
//! # Scope
//!
//! The core covers fragment/CLIXML primitives, opening a pool, running a
//! script, collecting every standard stream, and per-stream processing via
//! the [`Pipeline`] builder. `<Ref>`-based CLIXML round-tripping, pipeline
//! input streaming, and reconnect/disconnect remain limited.

#![forbid(unsafe_code)]
#![warn(missing_debug_implementations)]

pub mod clixml;
pub mod crypto;
pub mod error;
pub mod fragment;
pub mod host;
pub mod message;
pub mod metadata;
pub mod pipeline;
pub mod records;
pub mod runspace;
pub mod shared;
pub mod transport;

pub use clixml::{PsObject, PsValue, RefIdAllocator, parse_clixml, to_clixml};
pub use crypto::{ClientSessionKey, SessionKey};
pub use error::{PsrpError, Result};
pub use host::{BufferedHost, HostCallKind, HostMethodId, NoInteractionHost, PsHost};
pub use metadata::{CommandMetadata, CommandType, ParameterMetadata};
pub use pipeline::{Argument, Command, Pipeline, PipelineHandle, PipelineResult, PipelineState};
pub use records::{
    ErrorCategoryInfo, ErrorRecord, ExceptionInfo, FromPsObject, InformationRecord, InvocationInfo,
    ProgressRecord, TraceRecord, WarningRecord,
};
pub use runspace::{
    DisconnectedPool, PROTOCOL_VERSION, RunspacePool, RunspacePoolState, RunspacePoolStateMachine,
};
pub use shared::SharedRunspacePool;
pub use transport::PsrpTransport;

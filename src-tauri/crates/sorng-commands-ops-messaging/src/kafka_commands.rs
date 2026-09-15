//! Kafka command adapter (t5-e5).
//!
//! Mirrors the rabbitmq_commands adapter pattern used elsewhere in this
//! crate. The wrappers in `inner.rs` (moved from `sorng-kafka`) are compiled
//! here rather than in `sorng-kafka` because the `#[tauri::command]`
//! proc-macro needs a real `State<'_, T>` parameter resolvable in the
//! *parent* module. This file stubs the `super::{error,service,types}`
//! re-exports that the wrappers expect to resolve.

mod error {
    pub use crate::kafka::error::*;
}

mod service {
    pub use crate::kafka::service::*;
}

mod types {
    pub use crate::kafka::types::*;
}

#[allow(dead_code)]
mod inner;

pub(crate) use inner::*;

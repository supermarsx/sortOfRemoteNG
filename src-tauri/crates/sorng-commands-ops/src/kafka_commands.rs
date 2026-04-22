//! Kafka command shim (t5-e5).
//!
//! Mirrors the rabbitmq_commands / mysql_admin_commands shim pattern used
//! elsewhere in this crate. The `sorng-kafka` crate's `commands.rs` file is
//! written to be included (rather than compiled standalone) because the
//! `#[tauri::command]` proc-macro needs a real `State<'_, T>` parameter
//! resolvable in the *parent* module. We pull it in with `include!` and
//! stub the `super::{error,service,types}` re-exports that the commands
//! file expects to resolve.
//!
//! Canonical shim location: this crate-level file (mirrors rabbitmq). The
//! older top-level `src-tauri/src/kafka_commands.rs` is orphaned and kept
//! only for historical reference; nothing `mod`'s it.

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
mod inner {
    include!("../../sorng-kafka/src/commands.rs");
}

pub(crate) use inner::*;

mod service {
    pub use crate::recording::service::*;
}

mod types {
    pub use crate::recording::types::*;
}

// Phase 2a (commit 75027514) — the path-included `commands.rs`
// references `super::storage::MigrationProgress` + `MigrationStage`
// for the migration progress reporter. `super` resolves to *this*
// file once the include lands inside `inner`, so we need a sibling
// `storage` alias that proxies through to the real module.
mod storage {
    pub use crate::recording::storage::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-recording/src/commands.rs");
}

pub(crate) use inner::*;

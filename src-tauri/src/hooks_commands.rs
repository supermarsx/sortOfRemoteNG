mod pipeline {
    pub use crate::hooks::pipeline::*;
}

mod error {
    pub use crate::hooks::error::*;
}

mod service {
    pub use crate::hooks::service::*;
}

mod types {
    pub use crate::hooks::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-hooks/src/commands.rs");
}

pub(crate) use inner::*;

mod api {
    pub use crate::extensions::api::*;
}

mod hooks {
    pub use crate::extensions::hooks::*;
}

mod service {
    pub use crate::extensions::service::*;
}

mod types {
    pub use crate::extensions::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-extensions/src/commands.rs");
}

pub(crate) use inner::*;

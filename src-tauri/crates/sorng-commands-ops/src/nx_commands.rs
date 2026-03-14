mod service {
    pub use crate::nx::service::*;
}

mod types {
    pub use crate::nx::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-nx/src/nx/commands.rs");
}


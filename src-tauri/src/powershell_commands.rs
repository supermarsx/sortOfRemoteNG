mod configuration {
    pub use crate::powershell::configuration::*;
}

mod diagnostics {
    pub use crate::powershell::diagnostics::*;
}

mod direct {
    pub use crate::powershell::direct::*;
}

mod service {
    pub use crate::powershell::service::*;
}

mod types {
    pub use crate::powershell::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-powershell/src/commands.rs");
}

pub(crate) use inner::*;


mod service {
    pub use crate::hashicorp_vault::service::*;
}

mod types {
    pub use crate::hashicorp_vault::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-hashicorp-vault/src/commands.rs");
}

pub(crate) use inner::*;

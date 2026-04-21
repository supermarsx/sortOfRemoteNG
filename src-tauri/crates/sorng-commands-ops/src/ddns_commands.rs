mod types {
    pub use crate::ddns::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-ddns/src/commands.rs");
}

pub(crate) use inner::*;

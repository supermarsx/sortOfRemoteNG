mod service {
    pub use crate::voip_phone::service::*;
}

mod types {
    pub use crate::voip_phone::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-voip-phone/src/commands.rs");
}

pub(crate) use inner::*;

mod service {
    pub use crate::lenovo::service::*;
}

mod types {
    pub use crate::lenovo::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-lenovo/src/commands.rs");
}

pub(crate) use inner::*;

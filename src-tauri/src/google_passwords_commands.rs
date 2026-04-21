mod service {
    pub use crate::google_passwords::service::*;
}

mod types {
    pub use crate::google_passwords::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-google-passwords/src/google_passwords/commands.rs");
}

pub(crate) use inner::*;

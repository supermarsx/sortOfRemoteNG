mod service {
    pub use crate::onepassword::service::*;
}

mod vaults {
    pub use crate::onepassword::vaults::*;
}

mod password_gen {
    pub use crate::onepassword::password_gen::*;
}

mod categories {
    pub use crate::onepassword::categories::*;
}

mod types {
    pub use crate::onepassword::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-1password/src/onepassword/commands.rs");
}

pub(crate) use inner::*;

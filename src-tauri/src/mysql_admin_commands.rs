mod service {
    pub use crate::mysql_admin::service::*;
}

mod types {
    pub use crate::mysql_admin::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-mysql-admin/src/commands.rs");
}

pub(crate) use inner::*;

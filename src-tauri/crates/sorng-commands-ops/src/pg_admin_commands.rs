mod service {
    pub use crate::pg_admin::service::*;
}

mod types {
    pub use crate::pg_admin::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-postgres-admin/src/commands.rs");
}

pub(crate) use inner::*;

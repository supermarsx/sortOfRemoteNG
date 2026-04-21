mod service {
    pub use crate::backup_verify::service::*;
}

mod types {
    pub use crate::backup_verify::types::*;
}

mod dr_testing {
    pub use crate::backup_verify::dr_testing::*;
}

mod replication {
    pub use crate::backup_verify::replication::*;
}

mod retention {
    pub use crate::backup_verify::retention::*;
}

mod notifications {
    pub use crate::backup_verify::notifications::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-backup-verify/src/commands.rs");
}

pub(crate) use inner::*;

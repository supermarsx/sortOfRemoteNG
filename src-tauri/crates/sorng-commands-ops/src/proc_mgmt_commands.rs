mod files {
    pub use crate::proc_mgmt::files::*;
}

mod list {
    pub use crate::proc_mgmt::list::*;
}

mod proc_fs {
    pub use crate::proc_mgmt::proc_fs::*;
}

mod service {
    pub use crate::proc_mgmt::service::*;
}

mod signals {
    pub use crate::proc_mgmt::signals::*;
}

mod system {
    pub use crate::proc_mgmt::system::*;
}

mod types {
    pub use crate::proc_mgmt::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-proc/src/commands.rs");
}

pub(crate) use inner::*;

mod backup {
    pub use crate::winmgmt::backup::*;
}

mod eventlog {
    pub use crate::winmgmt::eventlog::*;
}

mod perfmon {
    pub use crate::winmgmt::perfmon::*;
}

mod processes {
    pub use crate::winmgmt::processes::*;
}

mod registry {
    pub use crate::winmgmt::registry::*;
}

mod scheduled_tasks {
    pub use crate::winmgmt::scheduled_tasks::*;
}

mod service {
    pub use crate::winmgmt::service::*;
}

mod services {
    pub use crate::winmgmt::services::*;
}

mod system_info {
    pub use crate::winmgmt::system_info::*;
}

mod types {
    pub use crate::winmgmt::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-winmgmt/src/commands.rs");
}


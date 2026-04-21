mod backup {
    pub use sorng_winmgmt::backup::*;
}

mod eventlog {
    pub use sorng_winmgmt::eventlog::*;
}

mod perfmon {
    pub use sorng_winmgmt::perfmon::*;
}

mod processes {
    pub use sorng_winmgmt::processes::*;
}

mod registry {
    pub use sorng_winmgmt::registry::*;
}

mod scheduled_tasks {
    pub use sorng_winmgmt::scheduled_tasks::*;
}

mod service {
    pub use sorng_winmgmt::service::*;
}

mod services {
    pub use sorng_winmgmt::services::*;
}

mod system_info {
    pub use sorng_winmgmt::system_info::*;
}

mod types {
    pub use sorng_winmgmt::types::*;
}

mod diagnostics {
    pub use sorng_winmgmt::diagnostics::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-winmgmt/src/commands.rs");
}

pub(crate) use inner::*;

mod chrony {
    pub use crate::time_ntp::chrony::*;
}

mod detect {
    pub use crate::time_ntp::detect::*;
}

mod hwclock {
    pub use crate::time_ntp::hwclock::*;
}

mod ntpd {
    pub use crate::time_ntp::ntpd::*;
}

mod service {
    pub use crate::time_ntp::service::*;
}

mod timedatectl {
    pub use crate::time_ntp::timedatectl::*;
}

mod types {
    pub use crate::time_ntp::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-time-ntp/src/commands.rs");
}

pub(crate) use inner::*;

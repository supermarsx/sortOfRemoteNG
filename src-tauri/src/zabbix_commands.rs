mod service {
    pub use crate::zabbix::service::*;
}

mod types {
    pub use crate::zabbix::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-zabbix/src/commands.rs");
}


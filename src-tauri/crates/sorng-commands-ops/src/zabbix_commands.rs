mod service {
    pub use crate::zabbix::service::*;
}

mod types {
    pub use crate::zabbix::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-zabbix/src/commands.rs");
}

pub(crate) use inner::*;

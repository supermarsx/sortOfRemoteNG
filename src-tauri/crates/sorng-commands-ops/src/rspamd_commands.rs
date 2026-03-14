mod service {
    pub use crate::rspamd::service::*;
}

mod types {
    pub use crate::rspamd::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-rspamd/src/commands.rs");
}

pub(crate) use inner::*;

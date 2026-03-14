mod service {
    pub use crate::smtp::service::{SmtpServiceState, SmtpStats};
}

mod diagnostics {
    pub use crate::smtp::diagnostics::reverse_lookup;
}

mod message {
    pub use crate::smtp::message::build_message;
}

mod types {
    pub use crate::smtp::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-smtp/src/commands.rs");
}

pub(crate) use inner::*;

mod files {
    pub use crate::telegram::files::*;
}

mod monitoring {
    pub use crate::telegram::monitoring::*;
}

mod service {
    pub use crate::telegram::service::*;
}

mod templates {
    pub use crate::telegram::templates::*;
}

mod types {
    pub use crate::telegram::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-telegram/src/commands.rs");
}

pub(crate) use inner::*;

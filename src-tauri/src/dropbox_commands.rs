mod account {
    pub use crate::dropbox::account::*;
}

mod auth {
    pub use crate::dropbox::auth::*;
}

mod client {
    pub use crate::dropbox::client::*;
}

mod files {
    pub use crate::dropbox::files::*;
}

mod folders {
    pub use crate::dropbox::folders::*;
}

mod paper {
    pub use crate::dropbox::paper::*;
}

mod service {
    pub use crate::dropbox::service::*;
}

mod sharing {
    pub use crate::dropbox::sharing::*;
}

mod team {
    pub use crate::dropbox::team::*;
}

mod types {
    pub use crate::dropbox::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-dropbox/src/commands.rs");
}

pub(crate) use inner::*;

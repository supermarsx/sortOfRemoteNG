mod activity {
    pub use crate::nextcloud::activity::*;
}

mod auth {
    pub use crate::nextcloud::auth::*;
}

mod backup {
    pub use crate::nextcloud::backup::*;
}

mod client {
    pub use crate::nextcloud::client::*;
}

mod files {
    pub use crate::nextcloud::files::*;
}

mod folders {
    pub use crate::nextcloud::folders::*;
}

mod service {
    pub use crate::nextcloud::service::*;
}

mod sharing {
    pub use crate::nextcloud::sharing::*;
}

mod sync {
    pub use crate::nextcloud::sync::*;
}

mod types {
    pub use crate::nextcloud::types::*;
}

mod users {
    pub use crate::nextcloud::users::*;
}

mod watcher {
    pub use crate::nextcloud::watcher::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-nextcloud/src/commands.rs");
}

pub(crate) use inner::*;

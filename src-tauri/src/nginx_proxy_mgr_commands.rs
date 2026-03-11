mod service {
    pub use crate::nginx_proxy_mgr::service::*;
}

mod types {
    pub use crate::nginx_proxy_mgr::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-nginx-proxy-mgr/src/commands.rs");
}

pub(crate) use inner::*;

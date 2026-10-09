//! # SortOfRemote NG – Protocols
//!
//! Additional connectivity protocols: Serial, Rlogin, Raw Socket,
//! FTP/SFTP, MySQL database, and HTTP services.

mod browser_dns;
pub mod db;
pub mod http;
pub mod origin_browser;
pub mod origin_browser_diagnostics;
pub mod private_forward_proxy;
pub mod private_forward_route;
pub mod webview_origins;
pub mod autologin_asset;
pub mod raw_socket;
pub mod rlogin;
pub mod theme_tokens;
pub mod themed_auth;
pub mod themed_autologin;
pub mod themed_errors;
pub mod themed_status;

//! Arista EOS fan-speed collector (eAPI, `show system environment cooling`).

pub mod eapi;
pub mod parse;
pub mod types;

pub use eapi::fetch_cooling;
pub use parse::parse_cooling_json;
pub use types::{AristaConfig, AristaCoolingReport, AristaFan};

//! Compile the production command source without building the whole desktop app.
//! The command's live diagnostics remain ignored and require their explicit opt-in.
pub use sorng_protocols::*;

#[allow(dead_code)]
#[path = "../src/http_cmds.rs"]
mod http_cmds;

// The adapter is std-only, so this regression can also run directly with
// rustc --test without initializing CEF or linking the full application.
#[path = "../src/native_darkreader.rs"]
mod native_darkreader;

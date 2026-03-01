// ── sorng-keepass / keepass module ─────────────────────────────────────────────
//
// Comprehensive KeePass KDBX integration providing:
//   • Database lifecycle management (create, open, close, save, lock/unlock)
//   • Entry CRUD with full field support (title, username, password, URL, notes, custom fields)
//   • Group/folder tree management with recycle-bin support
//   • Password generation with character sets, patterns, and profiles
//   • Key file creation and composite key management
//   • Attachment (binary) management with deduplication
//   • Auto-type sequence parsing and window matching
//   • Advanced search (field matching, regex, tags, expiry filters)
//   • Import/export (CSV, XML, JSON, 1Password, LastPass, Bitwarden, Chrome)
//   • Database merge/synchronization
//   • Entry history tracking and comparison
//   • OTP (TOTP/HOTP) integration
//   • Tauri command bindings for the frontend

pub mod types;
pub mod service;
pub mod database;
pub mod entries;
pub mod groups;
pub mod crypto;
pub mod import_export;
pub mod search;
pub mod autotype;
pub mod attachments;
pub mod commands;

pub use types::*;
pub use service::KeePassService;
pub use commands::*;

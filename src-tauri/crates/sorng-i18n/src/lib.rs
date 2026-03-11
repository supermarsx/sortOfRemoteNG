//! # sorng-i18n
//!
//! Backend internationalisation engine for SortOfRemote NG.
//!
//! ## Features
//!
//! - **Hot-reload** — watches locale JSON files on disk via `notify` and
//!   atomically swaps the translation map (lock-free reads with `arc-swap`).
//! - **SSR helpers** — pre-renders translation bundles, injects `lang`
//!   attributes, and produces hydration-ready JSON for the frontend.
//! - **ICU-style pluralisation** — `one` / `few` / `many` / `other` with
//!   `{{count}}` interpolation.
//! - **Variable interpolation** — `{{var}}` placeholders resolved at runtime.
//! - **Locale negotiation** — BCP 47 parsing, OS locale detection via
//!   `sys-locale`, and configurable fallback chains.
//! - **Namespace support** — translations can be scoped per feature / crate.
//! - **Thread-safe & zero-copy reads** — `DashMap` + `ArcSwap` means
//!   translation lookups never block writers.

pub mod command_types;
pub mod engine;
pub mod error;
pub mod interpolation;
pub mod loader;
pub mod locale;
pub mod ssr;
pub mod watcher;

// Re-exports for convenience
pub use command_types::I18nServiceState;
pub use engine::{I18nEngine, TranslationBundle};
pub use error::I18nError;
pub use locale::Locale;

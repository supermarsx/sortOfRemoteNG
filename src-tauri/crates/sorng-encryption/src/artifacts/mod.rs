//! Per-artifact encryption codecs.
//!
//! Each module here owns one artifact kind and three operations:
//! `read`, `write`, and `migrate` (v0 plaintext → v2 envelope). They
//! all consume an [`EncryptionState`](crate::EncryptionState) for the
//! sub-key and otherwise stay pure — they don't touch the vault,
//! `dek.enc`, or the unlock UX.

pub mod recording_meta;
pub mod recording_media;
pub mod settings;

//! # SortOfRemote NG – RDP
//!
//! RDP connectivity, graphics pipeline (GFX), and H.264 video decoding.

// ── Vendor dylib re-exports ─────────────────────────────────────────
// These make the dynamically-linked vendor deps available as crate-level
// names so all child modules can `use crate::ironrdp::...` etc.
pub(crate) use sorng_rdp_vendor::ironrdp;
pub(crate) use sorng_rdp_vendor::ironrdp_blocking;
pub(crate) use sorng_rdp_vendor::ironrdp_cliprdr;
#[allow(unused_imports)]
pub(crate) use sorng_rdp_vendor::ironrdp_cliprdr_native;
pub(crate) use sorng_rdp_vendor::ironrdp_core;
pub(crate) use sorng_rdp_vendor::ironrdp_dvc;
#[allow(unused_imports)]
pub(crate) use sorng_rdp_vendor::ironrdp_svc;

#[cfg(feature = "software-decode")]
pub(crate) use sorng_rdp_vendor::openh264;

pub mod gfx;
pub mod h264;
pub mod rdp;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Per-session framebuffer slot.
#[allow(dead_code)]
pub(crate) struct FrameSlot {
    pub(crate) data: Vec<u8>,
    pub(crate) width: u16,
    pub(crate) height: u16,
}

/// Thread-safe store of framebuffers for all active RDP sessions.
pub struct SharedFrameStore {
    pub(crate) slots: RwLock<HashMap<String, FrameSlot>>,
}

pub type SharedFrameStoreState = Arc<SharedFrameStore>;

impl SharedFrameStore {
    pub fn new() -> SharedFrameStoreState {
        Arc::new(SharedFrameStore {
            slots: RwLock::new(HashMap::new()),
        })
    }

    /// Create or reset a slot for the given session.
    pub(crate) fn init(&self, session_id: &str, width: u16, height: u16) {
        let size = width as usize * height as usize * 4;
        let mut slots = self.slots.write().unwrap();
        slots.insert(
            session_id.to_string(),
            FrameSlot {
                data: vec![0u8; size],
                width,
                height,
            },
        );
    }

    /// Copy a dirty region from the IronRDP DecodedImage framebuffer into
    /// the shared slot.  This is a fast row-by-row memcpy -- much cheaper
    /// than the old base64 encoding path.
    pub(crate) fn update_region(
        &self,
        session_id: &str,
        source: &[u8],
        fb_width: u16,
        region: &ironrdp::pdu::geometry::InclusiveRectangle,
    ) {
        let mut slots = self.slots.write().unwrap();
        if let Some(slot) = slots.get_mut(session_id) {
            let bpp = 4usize;
            let stride = fb_width as usize * bpp;
            let left = region.left as usize;
            let right = region.right as usize;
            let top = region.top as usize;
            let bottom = region.bottom as usize;
            let row_bytes = (right - left + 1) * bpp;

            for row in top..=bottom {
                let offset = row * stride + left * bpp;
                let end = offset + row_bytes;
                if end <= source.len() && end <= slot.data.len() {
                    slot.data[offset..end].copy_from_slice(&source[offset..end]);
                }
            }
        }
    }

    /// Extract a rectangular region as a contiguous RGBA byte vec.
    /// Called by the `rdp_get_frame_data` command.
    pub(crate) fn extract_region(
        &self,
        session_id: &str,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
    ) -> Option<Vec<u8>> {
        let slots = self.slots.read().unwrap();
        let slot = slots.get(session_id)?;
        let bpp = 4usize;
        let stride = slot.width as usize * bpp;
        let mut rgba = Vec::with_capacity(w as usize * h as usize * bpp);

        for row in y as usize..(y + h) as usize {
            let start = row * stride + x as usize * bpp;
            let end = start + w as usize * bpp;
            if end <= slot.data.len() {
                rgba.extend_from_slice(&slot.data[start..end]);
            }
        }
        Some(rgba)
    }

    /// Reset slot dimensions (e.g. after reactivation at a new desktop size).
    pub(crate) fn reinit(&self, session_id: &str, width: u16, height: u16) {
        self.init(session_id, width, height);
    }

    /// Remove the slot when the session ends.
    pub(crate) fn remove(&self, session_id: &str) {
        let mut slots = self.slots.write().unwrap();
        slots.remove(session_id);
    }
}

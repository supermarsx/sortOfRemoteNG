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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_store_has_no_slots() {
        let store = SharedFrameStore::new();
        let slots = store.slots.read().unwrap();
        assert!(slots.is_empty());
    }

    #[test]
    fn init_creates_slot() {
        let store = SharedFrameStore::new();
        store.init("s1", 100, 50);
        let slots = store.slots.read().unwrap();
        let slot = slots.get("s1").unwrap();
        assert_eq!(slot.width, 100);
        assert_eq!(slot.height, 50);
        assert_eq!(slot.data.len(), 100 * 50 * 4);
    }

    #[test]
    fn init_zeroes_framebuffer() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        let slots = store.slots.read().unwrap();
        let slot = slots.get("s1").unwrap();
        assert!(slot.data.iter().all(|&b| b == 0));
    }

    #[test]
    fn init_zero_dimensions() {
        let store = SharedFrameStore::new();
        store.init("s1", 0, 0);
        let slots = store.slots.read().unwrap();
        let slot = slots.get("s1").unwrap();
        assert!(slot.data.is_empty());
    }

    #[test]
    fn extract_region_simple() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        // Fill the framebuffer with a pattern
        {
            let mut slots = store.slots.write().unwrap();
            let slot = slots.get_mut("s1").unwrap();
            for (i, byte) in slot.data.iter_mut().enumerate() {
                *byte = (i % 256) as u8;
            }
        }
        // Extract the full 4x4 region
        let data = store.extract_region("s1", 0, 0, 4, 4).unwrap();
        assert_eq!(data.len(), 4 * 4 * 4);
        // First pixel should match our pattern
        assert_eq!(data[0], 0);
        assert_eq!(data[1], 1);
    }

    #[test]
    fn extract_region_partial() {
        let store = SharedFrameStore::new();
        store.init("s1", 8, 8);
        {
            let mut slots = store.slots.write().unwrap();
            let slot = slots.get_mut("s1").unwrap();
            // Fill with 0xFF
            for byte in slot.data.iter_mut() {
                *byte = 0xFF;
            }
        }
        // Extract a 2x2 region from (1,1)
        let data = store.extract_region("s1", 1, 1, 2, 2).unwrap();
        assert_eq!(data.len(), 2 * 2 * 4);
        assert!(data.iter().all(|&b| b == 0xFF));
    }

    #[test]
    fn extract_region_nonexistent_session() {
        let store = SharedFrameStore::new();
        assert!(store.extract_region("nonexistent", 0, 0, 1, 1).is_none());
    }

    #[test]
    fn reinit_replaces_slot() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        {
            let mut slots = store.slots.write().unwrap();
            let slot = slots.get_mut("s1").unwrap();
            slot.data[0] = 0xAA;
        }
        // Reinit with different dimensions
        store.reinit("s1", 8, 8);
        let slots = store.slots.read().unwrap();
        let slot = slots.get("s1").unwrap();
        assert_eq!(slot.width, 8);
        assert_eq!(slot.height, 8);
        assert_eq!(slot.data.len(), 8 * 8 * 4);
        // Data should be zeroed
        assert_eq!(slot.data[0], 0);
    }

    #[test]
    fn remove_deletes_slot() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        store.remove("s1");
        let slots = store.slots.read().unwrap();
        assert!(slots.get("s1").is_none());
    }

    #[test]
    fn remove_nonexistent_is_noop() {
        let store = SharedFrameStore::new();
        store.remove("nonexistent"); // should not panic
    }

    #[test]
    fn multiple_sessions_independent() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        store.init("s2", 8, 8);
        {
            let mut slots = store.slots.write().unwrap();
            let slot = slots.get_mut("s1").unwrap();
            slot.data[0] = 0xBB;
        }
        // s2 should be untouched
        let slots = store.slots.read().unwrap();
        assert_eq!(slots.get("s2").unwrap().data[0], 0);
        assert_eq!(slots.get("s1").unwrap().data[0], 0xBB);
    }

    #[test]
    fn extract_region_zero_size() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        let data = store.extract_region("s1", 0, 0, 0, 0).unwrap();
        assert!(data.is_empty());
    }

    #[test]
    fn init_replaces_existing() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        store.init("s1", 2, 2);
        let slots = store.slots.read().unwrap();
        let slot = slots.get("s1").unwrap();
        assert_eq!(slot.width, 2);
        assert_eq!(slot.data.len(), 2 * 2 * 4);
    }
}

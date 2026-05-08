use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

const BYTES_PER_PIXEL: usize = 4;
pub const DEFAULT_MAX_REGION_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FrameStoreAccountingSnapshot {
    pub update_attempts: u64,
    pub updated_regions: u64,
    pub skipped_regions: u64,
    pub bytes_written: u64,
    pub snapshot_reads: u64,
    pub snapshot_bytes: u64,
}

#[derive(Debug, Default)]
struct FrameStoreAccounting {
    update_attempts: AtomicU64,
    updated_regions: AtomicU64,
    skipped_regions: AtomicU64,
    bytes_written: AtomicU64,
    snapshot_reads: AtomicU64,
    snapshot_bytes: AtomicU64,
}

impl FrameStoreAccounting {
    fn record_update(&self, bytes_written: usize) {
        self.update_attempts.fetch_add(1, Ordering::Relaxed);
        if bytes_written == 0 {
            self.skipped_regions.fetch_add(1, Ordering::Relaxed);
        } else {
            self.updated_regions.fetch_add(1, Ordering::Relaxed);
            self.bytes_written
                .fetch_add(bytes_written as u64, Ordering::Relaxed);
        }
    }

    fn record_snapshot_read(&self, bytes_read: usize) {
        self.snapshot_reads.fetch_add(1, Ordering::Relaxed);
        self.snapshot_bytes
            .fetch_add(bytes_read as u64, Ordering::Relaxed);
    }

    fn snapshot(&self) -> FrameStoreAccountingSnapshot {
        FrameStoreAccountingSnapshot {
            update_attempts: self.update_attempts.load(Ordering::Relaxed),
            updated_regions: self.updated_regions.load(Ordering::Relaxed),
            skipped_regions: self.skipped_regions.load(Ordering::Relaxed),
            bytes_written: self.bytes_written.load(Ordering::Relaxed),
            snapshot_reads: self.snapshot_reads.load(Ordering::Relaxed),
            snapshot_bytes: self.snapshot_bytes.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameStoreSessionSnapshot {
    pub width: u16,
    pub height: u16,
    pub byte_len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedFrameRegionSnapshot {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub rgba: Vec<u8>,
}

/// Per-session framebuffer slot with its own lock for per-session
/// concurrency — update_region only blocks the target session.
pub struct FrameSlot {
    pub inner: RwLock<FrameSlotInner>,
}

#[allow(dead_code)]
pub struct FrameSlotInner {
    pub data: Vec<u8>,
    pub width: u16,
    pub height: u16,
}

/// Thread-safe store of framebuffers for all active RDP sessions.
/// Uses a two-level locking scheme: a top-level RwLock<HashMap> for
/// session add/remove (rare), and per-slot RwLock for pixel updates
/// (frequent) so sessions never contend with each other.
pub struct SharedFrameStore {
    pub slots: RwLock<HashMap<String, Arc<FrameSlot>>>,
    accounting: FrameStoreAccounting,
}

pub type SharedFrameStoreState = Arc<SharedFrameStore>;

impl SharedFrameStore {
    pub fn new() -> SharedFrameStoreState {
        Arc::new(SharedFrameStore {
            slots: RwLock::new(HashMap::new()),
            accounting: FrameStoreAccounting::default(),
        })
    }

    pub fn accounting_snapshot(&self) -> FrameStoreAccountingSnapshot {
        self.accounting.snapshot()
    }

    pub fn session_snapshot(&self, session_id: &str) -> Option<FrameStoreSessionSnapshot> {
        let slots = self.slots.read().expect("lock poisoned");
        let slot_arc = slots.get(session_id)?;
        let slot = slot_arc.inner.read().expect("lock poisoned");
        Some(FrameStoreSessionSnapshot {
            width: slot.width,
            height: slot.height,
            byte_len: slot.data.len(),
        })
    }

    /// Create or reset a slot for the given session.
    pub fn init(&self, session_id: &str, width: u16, height: u16) {
        let size = width as usize * height as usize * 4;
        let slot = Arc::new(FrameSlot {
            inner: RwLock::new(FrameSlotInner {
                data: vec![0u8; size],
                width,
                height,
            }),
        });
        let mut slots = self.slots.write().expect("lock poisoned");
        slots.insert(session_id.to_string(), slot);
    }

    /// Copy a dirty region from the IronRDP DecodedImage framebuffer into
    /// the shared slot.  Only takes a read-lock on the top-level map, then
    /// a write-lock on the individual session slot, so other sessions are
    /// never blocked.
    pub fn update_region(
        &self,
        session_id: &str,
        source: &[u8],
        fb_width: u16,
        region: &crate::ironrdp::pdu::geometry::InclusiveRectangle,
    ) {
        let mut bytes_written = 0usize;
        let slots = self.slots.read().expect("lock poisoned");
        if let Some(slot_arc) = slots.get(session_id) {
            let mut slot = slot_arc.inner.write().expect("lock poisoned");
            let source_stride = fb_width as usize * BYTES_PER_PIXEL;
            let destination_stride = slot.width as usize * BYTES_PER_PIXEL;
            let left = region.left as usize;
            let right = region.right as usize;
            let top = region.top as usize;
            let bottom = region.bottom as usize;

            if fb_width == 0
                || slot.width == 0
                || slot.height == 0
                || source_stride == 0
                || right < left
                || bottom < top
                || left >= fb_width as usize
                || left >= slot.width as usize
                || top >= slot.height as usize
            {
                self.accounting.record_update(0);
                return;
            }

            let source_rows = source.len() / source_stride;
            if top >= source_rows {
                self.accounting.record_update(0);
                return;
            }

            let requested_width = right - left + 1;
            let requested_height = bottom - top + 1;
            let copy_width = requested_width
                .min(fb_width as usize - left)
                .min(slot.width as usize - left);
            let copy_height = requested_height
                .min(source_rows - top)
                .min(slot.height as usize - top);
            let row_bytes = copy_width * BYTES_PER_PIXEL;

            for row in top..top + copy_height {
                let source_offset = row * source_stride + left * BYTES_PER_PIXEL;
                let source_end = source_offset + row_bytes;
                let destination_offset = row * destination_stride + left * BYTES_PER_PIXEL;
                let destination_end = destination_offset + row_bytes;
                if source_end <= source.len() && destination_end <= slot.data.len() {
                    slot.data[destination_offset..destination_end]
                        .copy_from_slice(&source[source_offset..source_end]);
                    bytes_written = bytes_written.saturating_add(row_bytes);
                }
            }
        }
        self.accounting.record_update(bytes_written);
    }

    pub fn extract_region_bounded(
        &self,
        session_id: &str,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
        max_bytes: usize,
    ) -> Option<BoundedFrameRegionSnapshot> {
        let slots = self.slots.read().expect("lock poisoned");
        let slot_arc = slots.get(session_id)?;
        let slot = slot_arc.inner.read().expect("lock poisoned");
        let (bounded_x, bounded_y, bounded_width, bounded_height) = bounded_region(
            slot.width,
            slot.height,
            x,
            y,
            w,
            h,
            max_bytes,
        );
        let rgba = extract_bounded_region_rgba(
            &slot.data,
            slot.width,
            bounded_x,
            bounded_y,
            bounded_width,
            bounded_height,
        );
        self.accounting.record_snapshot_read(rgba.len());
        Some(BoundedFrameRegionSnapshot {
            x: bounded_x,
            y: bounded_y,
            width: bounded_width,
            height: bounded_height,
            rgba,
        })
    }

    /// Extract a rectangular region as a contiguous RGBA byte vec.
    /// Called by the `rdp_get_frame_data` command.
    pub fn extract_region(
        &self,
        session_id: &str,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
    ) -> Option<Vec<u8>> {
        self.extract_region_bounded(
            session_id,
            x,
            y,
            w,
            h,
            DEFAULT_MAX_REGION_SNAPSHOT_BYTES,
        )
        .map(|snapshot| snapshot.rgba)
    }

    /// Reset slot dimensions (e.g. after reactivation at a new desktop size).
    pub fn reinit(&self, session_id: &str, width: u16, height: u16) {
        self.init(session_id, width, height);
    }

    /// Remove the slot when the session ends.
    pub fn remove(&self, session_id: &str) {
        let mut slots = self.slots.write().expect("lock poisoned");
        slots.remove(session_id);
    }
}

fn bounded_region(
    framebuffer_width: u16,
    framebuffer_height: u16,
    x: u16,
    y: u16,
    requested_width: u16,
    requested_height: u16,
    max_bytes: usize,
) -> (u16, u16, u16, u16) {
    if requested_width == 0
        || requested_height == 0
        || framebuffer_width == 0
        || framebuffer_height == 0
        || x >= framebuffer_width
        || y >= framebuffer_height
        || max_bytes < BYTES_PER_PIXEL
    {
        return (x, y, 0, 0);
    }

    let mut bounded_width = requested_width.min(framebuffer_width - x);
    let mut bounded_height = requested_height.min(framebuffer_height - y);
    let max_pixels = max_bytes / BYTES_PER_PIXEL;
    let requested_pixels = bounded_width as usize * bounded_height as usize;

    if requested_pixels > max_pixels {
        let rows_at_full_width = max_pixels / bounded_width as usize;
        if rows_at_full_width > 0 {
            bounded_height = bounded_height.min(rows_at_full_width as u16);
        } else {
            bounded_width = bounded_width.min(max_pixels as u16);
            bounded_height = 1;
        }
    }

    (x, y, bounded_width, bounded_height)
}

fn extract_bounded_region_rgba(
    framebuffer: &[u8],
    framebuffer_width: u16,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
) -> Vec<u8> {
    if width == 0 || height == 0 || framebuffer_width == 0 {
        return Vec::new();
    }

    let stride = framebuffer_width as usize * BYTES_PER_PIXEL;
    let row_bytes = width as usize * BYTES_PER_PIXEL;
    let mut rgba = Vec::with_capacity(width as usize * height as usize * BYTES_PER_PIXEL);

    for row in y as usize..y as usize + height as usize {
        let start = row * stride + x as usize * BYTES_PER_PIXEL;
        let end = start + row_bytes;
        if end <= framebuffer.len() {
            rgba.extend_from_slice(&framebuffer[start..end]);
        }
    }

    rgba
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_store_has_no_slots() {
        let store = SharedFrameStore::new();
        let slots = store.slots.read().expect("lock poisoned");
        assert!(slots.is_empty());
    }

    #[test]
    fn init_creates_slot() {
        let store = SharedFrameStore::new();
        store.init("s1", 100, 50);
        let slots = store.slots.read().expect("lock poisoned");
        let slot_arc = slots.get("s1").unwrap();
        let slot = slot_arc.inner.read().expect("lock poisoned");
        assert_eq!(slot.width, 100);
        assert_eq!(slot.height, 50);
        assert_eq!(slot.data.len(), 100 * 50 * 4);
    }

    #[test]
    fn init_zeroes_framebuffer() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        let slots = store.slots.read().expect("lock poisoned");
        let slot = slots
            .get("s1")
            .unwrap()
            .inner
            .read()
            .expect("lock poisoned");
        assert!(slot.data.iter().all(|&b| b == 0));
    }

    #[test]
    fn init_zero_dimensions() {
        let store = SharedFrameStore::new();
        store.init("s1", 0, 0);
        let slots = store.slots.read().expect("lock poisoned");
        let slot = slots
            .get("s1")
            .unwrap()
            .inner
            .read()
            .expect("lock poisoned");
        assert!(slot.data.is_empty());
    }

    #[test]
    fn extract_region_simple() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        // Fill the framebuffer with a pattern
        {
            let slots = store.slots.read().expect("lock poisoned");
            let mut slot = slots
                .get("s1")
                .unwrap()
                .inner
                .write()
                .expect("lock poisoned");
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
            let slots = store.slots.read().expect("lock poisoned");
            let mut slot = slots
                .get("s1")
                .unwrap()
                .inner
                .write()
                .expect("lock poisoned");
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
    fn extract_region_clamps_to_framebuffer_bounds() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        {
            let slots = store.slots.read().expect("lock poisoned");
            let mut slot = slots
                .get("s1")
                .unwrap()
                .inner
                .write()
                .expect("lock poisoned");
            for (index, byte) in slot.data.iter_mut().enumerate() {
                *byte = index as u8;
            }
        }

        let snapshot = store
            .extract_region_bounded("s1", 3, 3, 8, 8, DEFAULT_MAX_REGION_SNAPSHOT_BYTES)
            .unwrap();

        assert_eq!(snapshot.x, 3);
        assert_eq!(snapshot.y, 3);
        assert_eq!(snapshot.width, 1);
        assert_eq!(snapshot.height, 1);
        assert_eq!(snapshot.rgba.len(), 4);
        assert_eq!(snapshot.rgba, vec![60, 61, 62, 63]);
    }

    #[test]
    fn extract_region_respects_snapshot_byte_cap() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        let snapshot = store.extract_region_bounded("s1", 0, 0, 4, 4, 16).unwrap();

        assert_eq!(snapshot.width, 4);
        assert_eq!(snapshot.height, 1);
        assert_eq!(snapshot.rgba.len(), 16);
    }

    #[test]
    fn update_region_clamps_to_source_and_slot_bounds() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        let source = vec![0xCC; 4 * 4 * 4];
        let region = crate::ironrdp::pdu::geometry::InclusiveRectangle {
            left: 3,
            top: 3,
            right: 9,
            bottom: 9,
        };

        store.update_region("s1", &source, 4, &region);

        let snapshot = store.extract_region_bounded("s1", 3, 3, 1, 1, 4).unwrap();
        assert_eq!(snapshot.rgba, vec![0xCC; 4]);
        let accounting = store.accounting_snapshot();
        assert_eq!(accounting.update_attempts, 1);
        assert_eq!(accounting.updated_regions, 1);
        assert_eq!(accounting.bytes_written, 4);
    }

    #[test]
    fn reinit_replaces_slot() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        {
            let slots = store.slots.read().expect("lock poisoned");
            let mut slot = slots
                .get("s1")
                .unwrap()
                .inner
                .write()
                .expect("lock poisoned");
            slot.data[0] = 0xAA;
        }
        // Reinit with different dimensions
        store.reinit("s1", 8, 8);
        let slots = store.slots.read().expect("lock poisoned");
        let slot = slots
            .get("s1")
            .unwrap()
            .inner
            .read()
            .expect("lock poisoned");
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
        let slots = store.slots.read().expect("lock poisoned");
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
            let slots = store.slots.read().expect("lock poisoned");
            let mut slot = slots
                .get("s1")
                .unwrap()
                .inner
                .write()
                .expect("lock poisoned");
            slot.data[0] = 0xBB;
        }
        // s2 should be untouched
        let slots = store.slots.read().expect("lock poisoned");
        assert_eq!(
            slots
                .get("s2")
                .unwrap()
                .inner
                .read()
                .expect("lock poisoned")
                .data[0],
            0
        );
        assert_eq!(
            slots
                .get("s1")
                .unwrap()
                .inner
                .read()
                .expect("lock poisoned")
                .data[0],
            0xBB
        );
    }

    #[test]
    fn extract_region_zero_size() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        let data = store.extract_region("s1", 0, 0, 0, 0).unwrap();
        assert!(data.is_empty());
    }

    #[test]
    fn session_snapshot_reports_dimensions_without_pixels() {
        let store = SharedFrameStore::new();
        store.init("s1", 8, 6);
        let snapshot = store.session_snapshot("s1").unwrap();

        assert_eq!(snapshot.width, 8);
        assert_eq!(snapshot.height, 6);
        assert_eq!(snapshot.byte_len, 8 * 6 * 4);
    }

    #[test]
    fn init_replaces_existing() {
        let store = SharedFrameStore::new();
        store.init("s1", 4, 4);
        store.init("s1", 2, 2);
        let slots = store.slots.read().expect("lock poisoned");
        let slot = slots
            .get("s1")
            .unwrap()
            .inner
            .read()
            .expect("lock poisoned");
        assert_eq!(slot.width, 2);
        assert_eq!(slot.data.len(), 2 * 2 * 4);
    }
}

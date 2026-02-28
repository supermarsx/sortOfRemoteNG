//! RDPGFX surface manager.
//!
//! Tracks surfaces created by the server and their mappings to the output display.

use std::collections::HashMap;

pub struct GfxSurface {
    pub surface_id: u16,
    pub width: u16,
    pub height: u16,
    /// RGBA32 framebuffer for this surface (width * height * 4 bytes).
    pub rgba: Vec<u8>,
    /// Where this surface maps on the output screen (None = unmapped).
    pub output_origin: Option<(u32, u32)>,
}

pub struct SurfaceManager {
    surfaces: HashMap<u16, GfxSurface>,
}

impl SurfaceManager {
    pub fn new() -> Self {
        Self {
            surfaces: HashMap::new(),
        }
    }

    pub fn create_surface(&mut self, surface_id: u16, width: u16, height: u16) {
        let size = width as usize * height as usize * 4;
        self.surfaces.insert(
            surface_id,
            GfxSurface {
                surface_id,
                width,
                height,
                rgba: vec![0u8; size],
                output_origin: None,
            },
        );
        log::debug!("GFX: created surface {surface_id} ({width}x{height})");
    }

    pub fn delete_surface(&mut self, surface_id: u16) {
        self.surfaces.remove(&surface_id);
        log::debug!("GFX: deleted surface {surface_id}");
    }

    pub fn map_surface_to_output(&mut self, surface_id: u16, x: u32, y: u32) {
        if let Some(surface) = self.surfaces.get_mut(&surface_id) {
            surface.output_origin = Some((x, y));
            log::debug!("GFX: mapped surface {surface_id} to output ({x}, {y})");
        }
    }

    pub fn get_surface(&self, surface_id: u16) -> Option<&GfxSurface> {
        self.surfaces.get(&surface_id)
    }

    /// Blit decoded RGBA data into a surface at the given dest rect.
    ///
    /// `src_data` is contiguous RGBA with stride = `src_width * 4`.
    pub fn blit_to_surface(
        &mut self,
        surface_id: u16,
        src_data: &[u8],
        src_width: u32,
        dest_left: u16,
        dest_top: u16,
        dest_width: u16,
        dest_height: u16,
    ) -> bool {
        let surface = match self.surfaces.get_mut(&surface_id) {
            Some(s) => s,
            None => return false,
        };

        let bpp = 4usize;
        let src_stride = src_width as usize * bpp;
        let dst_stride = surface.width as usize * bpp;

        // Clamp to fit within surface bounds.
        let cw = (dest_width as usize).min(surface.width.saturating_sub(dest_left) as usize);
        let ch = (dest_height as usize).min(surface.height.saturating_sub(dest_top) as usize);
        let copy_len = cw * bpp;

        for row in 0..ch {
            let src_offset = row * src_stride;
            let dst_offset =
                (dest_top as usize + row) * dst_stride + dest_left as usize * bpp;

            if src_offset + copy_len > src_data.len() {
                break;
            }
            surface.rgba[dst_offset..dst_offset + copy_len]
                .copy_from_slice(&src_data[src_offset..src_offset + copy_len]);
        }
        true
    }

    /// Reset all surfaces (e.g. on RDPGFX_RESET_GRAPHICS).
    pub fn reset(&mut self) {
        self.surfaces.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_manager_has_no_surfaces() {
        let mgr = SurfaceManager::new();
        assert!(mgr.get_surface(0).is_none());
    }

    #[test]
    fn create_and_get_surface() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 100, 50);
        let s = mgr.get_surface(1).unwrap();
        assert_eq!(s.surface_id, 1);
        assert_eq!(s.width, 100);
        assert_eq!(s.height, 50);
        assert_eq!(s.rgba.len(), 100 * 50 * 4);
        assert!(s.output_origin.is_none());
    }

    #[test]
    fn create_surface_initialises_to_zero() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(2, 4, 4);
        let s = mgr.get_surface(2).unwrap();
        assert!(s.rgba.iter().all(|&b| b == 0));
    }

    #[test]
    fn create_surface_zero_dimensions() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(3, 0, 0);
        let s = mgr.get_surface(3).unwrap();
        assert!(s.rgba.is_empty());
    }

    #[test]
    fn delete_surface_removes_it() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 10, 10);
        mgr.delete_surface(1);
        assert!(mgr.get_surface(1).is_none());
    }

    #[test]
    fn delete_nonexistent_surface_is_noop() {
        let mut mgr = SurfaceManager::new();
        mgr.delete_surface(99); // should not panic
    }

    #[test]
    fn map_surface_to_output_sets_origin() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 10, 10);
        mgr.map_surface_to_output(1, 100, 200);
        let s = mgr.get_surface(1).unwrap();
        assert_eq!(s.output_origin, Some((100, 200)));
    }

    #[test]
    fn map_nonexistent_surface_is_noop() {
        let mut mgr = SurfaceManager::new();
        mgr.map_surface_to_output(99, 0, 0); // should not panic
    }

    #[test]
    fn map_surface_overwrites_previous_origin() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 4, 4);
        mgr.map_surface_to_output(1, 10, 20);
        mgr.map_surface_to_output(1, 30, 40);
        assert_eq!(mgr.get_surface(1).unwrap().output_origin, Some((30, 40)));
    }

    #[test]
    fn blit_to_surface_simple() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 4, 4);
        // red pixel data for a 2x2 patch
        let src = vec![
            255, 0, 0, 255,  255, 0, 0, 255,
            255, 0, 0, 255,  255, 0, 0, 255,
        ];
        let ok = mgr.blit_to_surface(1, &src, 2, 0, 0, 2, 2);
        assert!(ok);
        let s = mgr.get_surface(1).unwrap();
        // First pixel of surface should be red
        assert_eq!(&s.rgba[0..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn blit_to_nonexistent_surface_returns_false() {
        let mut mgr = SurfaceManager::new();
        assert!(!mgr.blit_to_surface(99, &[0; 16], 2, 0, 0, 2, 2));
    }

    #[test]
    fn blit_clamps_to_surface_bounds() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 4, 4);
        // Source is 4x4 = 64 bytes, dest starts at (3,3), so only 1x1 pixel should be written
        let src = vec![0xAA; 4 * 4 * 4];
        let ok = mgr.blit_to_surface(1, &src, 4, 3, 3, 4, 4);
        assert!(ok);
        let s = mgr.get_surface(1).unwrap();
        // Pixel at (3,3) should be written
        let offset = (3 * 4 + 3) * 4;
        assert_eq!(&s.rgba[offset..offset + 4], &[0xAA; 4]);
        // Pixel at (0,0) should still be zero (not overwritten)
        assert_eq!(&s.rgba[0..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn blit_with_offset() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 8, 8);
        let src = vec![0xFF; 2 * 2 * 4]; // 2x2 white
        mgr.blit_to_surface(1, &src, 2, 3, 3, 2, 2);
        let s = mgr.get_surface(1).unwrap();
        // Pixel at (3,3) offset = (3*8 + 3)*4 = 108
        assert_eq!(&s.rgba[108..112], &[0xFF; 4]);
        // Pixel at (4,4) offset = (4*8 + 4)*4 = 144
        assert_eq!(&s.rgba[144..148], &[0xFF; 4]);
        // Pixel at (2,2) should be untouched
        let off22 = (2 * 8 + 2) * 4;
        assert_eq!(&s.rgba[off22..off22 + 4], &[0; 4]);
    }

    #[test]
    fn blit_short_src_data_breaks_early() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 4, 4);
        // Only provide 1 row of data (16 bytes) but request 2 rows
        let src = vec![0xBB; 4 * 4];
        let ok = mgr.blit_to_surface(1, &src, 4, 0, 0, 4, 2);
        assert!(ok);
        let s = mgr.get_surface(1).unwrap();
        // First row should be written
        assert_eq!(s.rgba[0], 0xBB);
        // Second row may or may not be written depending on src_data bounds
    }

    #[test]
    fn reset_clears_all_surfaces() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 4, 4);
        mgr.create_surface(2, 8, 8);
        mgr.reset();
        assert!(mgr.get_surface(1).is_none());
        assert!(mgr.get_surface(2).is_none());
    }

    #[test]
    fn reset_then_create_works() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 4, 4);
        mgr.reset();
        mgr.create_surface(1, 8, 8);
        let s = mgr.get_surface(1).unwrap();
        assert_eq!(s.width, 8);
    }

    #[test]
    fn create_surface_replaces_existing() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 4, 4);
        mgr.map_surface_to_output(1, 10, 20);
        // Re-create with same ID but different dimensions
        mgr.create_surface(1, 8, 8);
        let s = mgr.get_surface(1).unwrap();
        assert_eq!(s.width, 8);
        assert_eq!(s.height, 8);
        assert_eq!(s.rgba.len(), 8 * 8 * 4);
        // Origin should be reset since it's a new surface
        assert!(s.output_origin.is_none());
    }

    #[test]
    fn multiple_surfaces_independent() {
        let mut mgr = SurfaceManager::new();
        mgr.create_surface(1, 2, 2);
        mgr.create_surface(2, 4, 4);
        let src1 = vec![0xAA; 2 * 2 * 4];
        mgr.blit_to_surface(1, &src1, 2, 0, 0, 2, 2);
        // Surface 2 should be untouched
        let s2 = mgr.get_surface(2).unwrap();
        assert!(s2.rgba.iter().all(|&b| b == 0));
        // Surface 1 should have data
        let s1 = mgr.get_surface(1).unwrap();
        assert_eq!(s1.rgba[0], 0xAA);
    }
}

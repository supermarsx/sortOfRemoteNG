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

        for row in 0..dest_height as usize {
            let src_offset = row * src_stride;
            let dst_offset =
                (dest_top as usize + row) * dst_stride + dest_left as usize * bpp;
            let copy_len = dest_width as usize * bpp;

            if src_offset + copy_len <= src_data.len()
                && dst_offset + copy_len <= surface.rgba.len()
            {
                surface.rgba[dst_offset..dst_offset + copy_len]
                    .copy_from_slice(&src_data[src_offset..src_offset + copy_len]);
            }
        }
        true
    }

    /// Reset all surfaces (e.g. on RDPGFX_RESET_GRAPHICS).
    pub fn reset(&mut self) {
        self.surfaces.clear();
    }
}

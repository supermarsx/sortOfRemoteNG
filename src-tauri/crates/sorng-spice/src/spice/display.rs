//! SPICE display channel: surface management, draw command decoding,
//! image decompression dispatch, streaming region management.

use crate::spice::types::*;
use std::collections::HashMap;

/// Manages display surfaces and rendering state for a session.
pub struct DisplayManager {
    surfaces: HashMap<u32, SpiceSurface>,
    streams: HashMap<u32, VideoStream>,
    primary_surface_id: Option<u32>,
    frame_count: u64,
}

impl Default for DisplayManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DisplayManager {
    pub fn new() -> Self {
        Self {
            surfaces: HashMap::new(),
            streams: HashMap::new(),
            primary_surface_id: None,
            frame_count: 0,
        }
    }

    // ── Surface management ──────────────────────────────────────────────

    /// Create a new surface.
    pub fn create_surface(&mut self, surface: SpiceSurface) {
        if surface.is_primary {
            self.primary_surface_id = Some(surface.surface_id);
        }
        self.surfaces.insert(surface.surface_id, surface);
    }

    /// Destroy a surface.
    pub fn destroy_surface(&mut self, surface_id: u32) -> Option<SpiceSurface> {
        if self.primary_surface_id == Some(surface_id) {
            self.primary_surface_id = None;
        }
        self.surfaces.remove(&surface_id)
    }

    /// Get the primary surface.
    pub fn primary_surface(&self) -> Option<&SpiceSurface> {
        self.primary_surface_id
            .and_then(|id| self.surfaces.get(&id))
    }

    /// Get display resolution from primary surface.
    pub fn resolution(&self) -> (u32, u32) {
        self.primary_surface()
            .map(|s| (s.width, s.height))
            .unwrap_or((0, 0))
    }

    /// List all surfaces.
    pub fn surfaces(&self) -> Vec<&SpiceSurface> {
        self.surfaces.values().collect()
    }

    // ── Draw command processing ─────────────────────────────────────────

    /// Process an incoming draw command — returns an event to emit.
    pub fn process_draw(&mut self, cmd: &DrawCommand) -> Option<SpiceFrameEvent> {
        self.frame_count += 1;
        match cmd {
            DrawCommand::Fill {
                surface_id,
                x,
                y,
                width,
                height,
                color,
            } => {
                // Generate a solid-colour rectangle fill.
                let pixel_count = (*width * *height) as usize;
                let r = ((*color >> 16) & 0xFF) as u8;
                let g = ((*color >> 8) & 0xFF) as u8;
                let b = (*color & 0xFF) as u8;
                let a = 255u8;
                let mut pixels = Vec::with_capacity(pixel_count * 4);
                for _ in 0..pixel_count {
                    pixels.extend_from_slice(&[r, g, b, a]);
                }
                Some(SpiceFrameEvent {
                    session_id: String::new(), // filled in by caller
                    surface_id: *surface_id,
                    data: base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        &pixels,
                    ),
                    x: *x,
                    y: *y,
                    width: *width,
                    height: *height,
                    compression: "none".to_string(),
                })
            }
            DrawCommand::Opaque {
                surface_id,
                x,
                y,
                width,
                height,
                data,
                compression,
            } => Some(SpiceFrameEvent {
                session_id: String::new(),
                surface_id: *surface_id,
                data: data.clone(),
                x: *x,
                y: *y,
                width: *width,
                height: *height,
                compression: compression.to_string(),
            }),
            DrawCommand::Copy { .. } => {
                // CopyRect — client-side operation, return None (handle locally).
                None
            }
            DrawCommand::Inval { .. } => {
                // Invalidation — request full update for region.
                None
            }
        }
    }

    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }

    // ── Streaming ───────────────────────────────────────────────────────

    /// Register a new video stream.
    pub fn create_stream(&mut self, stream: VideoStream) {
        self.streams.insert(stream.stream_id, stream);
    }

    /// Destroy a video stream.
    pub fn destroy_stream(&mut self, stream_id: u32) -> Option<VideoStream> {
        self.streams.remove(&stream_id)
    }

    /// List active streams.
    pub fn streams(&self) -> Vec<&VideoStream> {
        self.streams.values().collect()
    }

    /// Reset all display state.
    pub fn reset(&mut self) {
        self.surfaces.clear();
        self.streams.clear();
        self.primary_surface_id = None;
        self.frame_count = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surface_lifecycle() {
        let mut dm = DisplayManager::new();
        let surface = SpiceSurface {
            surface_id: 1,
            width: 1920,
            height: 1080,
            format: SpicePixelFormat::bgra32(),
            flags: 0,
            is_primary: true,
        };
        dm.create_surface(surface);
        assert_eq!(dm.resolution(), (1920, 1080));
        assert!(dm.primary_surface().is_some());
        dm.destroy_surface(1);
        assert!(dm.primary_surface().is_none());
    }

    #[test]
    fn stream_lifecycle() {
        let mut dm = DisplayManager::new();
        dm.create_stream(VideoStream {
            stream_id: 0,
            surface_id: 1,
            codec: VideoCodec::H264,
            x: 0,
            y: 0,
            width: 640,
            height: 480,
            fps: 30,
            flags: 0,
        });
        assert_eq!(dm.streams().len(), 1);
        dm.destroy_stream(0);
        assert_eq!(dm.streams().len(), 0);
    }
}

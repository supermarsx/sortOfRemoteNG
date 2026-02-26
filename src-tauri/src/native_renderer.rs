//! Frame compositors for RDP display.
//!
//! All backends output through the Tauri Channel → JS canvas pipeline.
//! Compositors provide server-side frame accumulation and batching:
//!
//! - **Softbuffer** — CPU shadow buffer at desktop resolution.  Dirty regions
//!   are accumulated and flushed as composed RGBA data through the Channel.
//!
//! - **Wgpu** — GPU-accelerated compositor (currently delegates to the CPU
//!   compositor; reserved for future GPU readback / scaling support).
//!
//! The **Webview** backend bypasses compositing entirely — each dirty region
//! streams immediately via the Channel.

// ─── Render Backend Enum ─────────────────────────────────────────────

/// Which frame-display pipeline to use.
#[derive(Debug, Clone, PartialEq)]
pub enum RenderBackend {
    /// Direct pass-through: each dirty region streams immediately
    /// through the Tauri Channel to the JS canvas.
    Webview,
    /// CPU shadow buffer: accumulates dirty regions and outputs
    /// composed RGBA frames at the session loop's batch interval.
    Softbuffer,
    /// GPU compositor (currently CPU fallback).
    Wgpu,
    /// Auto-select: softbuffer (CPU compositor).
    Auto,
}

impl RenderBackend {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "softbuffer" => Self::Softbuffer,
            "wgpu" | "gpu" => Self::Wgpu,
            "auto" => Self::Auto,
            _ => Self::Webview,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Webview => "webview",
            Self::Softbuffer => "softbuffer",
            Self::Wgpu => "wgpu",
            Self::Auto => "auto",
        }
    }

    /// Returns ``true`` when the backend uses server-side frame compositing
    /// (as opposed to direct per-region streaming).
    pub fn is_composited(&self) -> bool {
        matches!(self, Self::Softbuffer | Self::Wgpu | Self::Auto)
    }

    /// Backward-compatible alias for ``is_composited()``.
    pub fn is_native(&self) -> bool {
        self.is_composited()
    }
}

// ─── Compositor Output ──────────────────────────────────────────────

/// A composed frame region ready for Channel transmission.
pub struct CompositorFrame {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    /// Raw RGBA pixel data (width * height * 4 bytes).
    pub rgba: Vec<u8>,
}

// ─── FrameCompositor Trait ──────────────────────────────────────────

/// Server-side frame compositor that accumulates dirty regions into
/// a shadow buffer and produces composed frame output for the Channel.
pub trait FrameCompositor: Send {
    /// Copy a dirty rectangle from the IronRDP decoded image into
    /// the compositor's internal buffer.
    fn update_region(
        &mut self,
        image_data: &[u8],
        fb_width: u16,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
    );

    /// The remote desktop was resized — reallocate internal buffers.
    fn resize_desktop(&mut self, width: u16, height: u16);

    /// Human-readable name (for logging / status).
    fn name(&self) -> &'static str;

    /// Whether any region has been updated since the last flush.
    fn is_dirty(&self) -> bool;

    /// Extract the composed dirty region as RGBA data and reset
    /// the dirty state.  Returns ``None`` if nothing is dirty.
    fn flush(&mut self) -> Option<CompositorFrame>;
}

// ═════════════════════════════════════════════════════════════════════
// Softbuffer Compositor (CPU shadow buffer)
// ═════════════════════════════════════════════════════════════════════

pub struct SoftbufferCompositor {
    /// RGBA shadow buffer at desktop resolution (desk_w * desk_h * 4).
    shadow: Vec<u8>,
    desk_w: u16,
    desk_h: u16,
    dirty: bool,
    /// Bounding rectangle of all accumulated dirty regions.
    dirty_left: u16,
    dirty_top: u16,
    dirty_right: u16,
    dirty_bottom: u16,
    /// Reusable buffer for flush output (avoids per-flush allocation).
    flush_buffer: Vec<u8>,
}

impl SoftbufferCompositor {
    pub fn new(width: u16, height: u16) -> Self {
        let size = width as usize * height as usize * 4;
        log::info!(
            "SoftbufferCompositor: created {width}x{height} shadow buffer ({} KB)",
            size / 1024
        );
        Self {
            shadow: vec![0u8; size],
            desk_w: width,
            desk_h: height,
            dirty: false,
            dirty_left: width,
            dirty_top: height,
            dirty_right: 0,
            dirty_bottom: 0,
            flush_buffer: Vec::new(),
        }
    }
}

impl FrameCompositor for SoftbufferCompositor {
    fn update_region(
        &mut self,
        image_data: &[u8],
        fb_width: u16,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
    ) {
        if w == 0 || h == 0 {
            return;
        }

        let bpp = 4usize;
        let src_stride = fb_width as usize * bpp;
        let dst_stride = self.desk_w as usize * bpp;

        // Clamp region to fit within both source and shadow buffer.
        let max_w = (self.desk_w.saturating_sub(x)) as usize;
        let max_h = (self.desk_h.saturating_sub(y)) as usize;
        let cw = (w as usize).min(max_w);
        let ch = (h as usize).min(max_h);
        let len = cw * bpp;

        for row in 0..ch {
            let src_y = y as usize + row;
            let dst_y = y as usize + row;
            let src_start = src_y * src_stride + x as usize * bpp;
            let dst_start = dst_y * dst_stride + x as usize * bpp;

            if src_start + len > image_data.len() {
                break;
            }
            self.shadow[dst_start..dst_start + len]
                .copy_from_slice(&image_data[src_start..src_start + len]);
        }

        // Expand bounding dirty rect
        self.dirty_left = self.dirty_left.min(x);
        self.dirty_top = self.dirty_top.min(y);
        self.dirty_right = self.dirty_right.max(x.saturating_add(w));
        self.dirty_bottom = self.dirty_bottom.max(y.saturating_add(h));
        self.dirty = true;
    }

    fn resize_desktop(&mut self, width: u16, height: u16) {
        let size = width as usize * height as usize * 4;
        self.shadow.resize(size, 0);
        self.shadow.fill(0);
        self.desk_w = width;
        self.desk_h = height;
        self.dirty = false;
        self.dirty_left = width;
        self.dirty_top = height;
        self.dirty_right = 0;
        self.dirty_bottom = 0;
        log::info!("SoftbufferCompositor: resized to {width}x{height}");
    }

    fn name(&self) -> &'static str {
        "softbuffer"
    }

    fn is_dirty(&self) -> bool {
        self.dirty
    }

    fn flush(&mut self) -> Option<CompositorFrame> {
        if !self.dirty || self.dirty_right <= self.dirty_left || self.dirty_bottom <= self.dirty_top
        {
            return None;
        }

        let x = self.dirty_left;
        let y = self.dirty_top;
        let w = self.dirty_right - self.dirty_left;
        let h = self.dirty_bottom - self.dirty_top;

        let bpp = 4usize;
        let stride = self.desk_w as usize * bpp;
        let row_bytes = w as usize * bpp;
        let total = row_bytes * h as usize;

        // Reuse the flush buffer to avoid per-flush allocation.
        self.flush_buffer.clear();
        self.flush_buffer.reserve(total);

        for row in 0..h as usize {
            let src_y = y as usize + row;
            let start = src_y * stride + x as usize * bpp;
            self.flush_buffer.extend_from_slice(&self.shadow[start..start + row_bytes]);
        }

        // Swap out the buffer contents — next flush reuses the same allocation.
        let rgba = std::mem::take(&mut self.flush_buffer);

        // Reset dirty state
        self.dirty = false;
        self.dirty_left = self.desk_w;
        self.dirty_top = self.desk_h;
        self.dirty_right = 0;
        self.dirty_bottom = 0;

        Some(CompositorFrame {
            x,
            y,
            width: w,
            height: h,
            rgba,
        })
    }
}

// ═════════════════════════════════════════════════════════════════════
// Wgpu Compositor (CPU fallback — reserves the name for future GPU use)
// ═════════════════════════════════════════════════════════════════════

pub struct WgpuCompositor {
    inner: SoftbufferCompositor,
}

impl WgpuCompositor {
    pub fn new(width: u16, height: u16) -> Self {
        log::info!("WgpuCompositor: using CPU fallback (GPU readback planned)");
        Self {
            inner: SoftbufferCompositor::new(width, height),
        }
    }
}

impl FrameCompositor for WgpuCompositor {
    fn update_region(
        &mut self,
        image_data: &[u8],
        fb_width: u16,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
    ) {
        self.inner
            .update_region(image_data, fb_width, x, y, w, h);
    }

    fn resize_desktop(&mut self, width: u16, height: u16) {
        self.inner.resize_desktop(width, height);
    }

    fn name(&self) -> &'static str {
        "wgpu"
    }

    fn is_dirty(&self) -> bool {
        self.inner.is_dirty()
    }

    fn flush(&mut self) -> Option<CompositorFrame> {
        self.inner.flush()
    }
}

// ═════════════════════════════════════════════════════════════════════
// Factory
// ═════════════════════════════════════════════════════════════════════

/// Create a frame compositor for the given backend.
///
/// Returns ``None`` for ``Webview`` (direct streaming, no compositor needed).
pub fn create_compositor(
    backend: &RenderBackend,
    desktop_width: u16,
    desktop_height: u16,
) -> Option<(Box<dyn FrameCompositor>, String)> {
    match backend {
        RenderBackend::Webview => None,
        RenderBackend::Softbuffer => {
            let c = SoftbufferCompositor::new(desktop_width, desktop_height);
            Some((Box::new(c), "softbuffer".to_string()))
        }
        RenderBackend::Wgpu => {
            let c = WgpuCompositor::new(desktop_width, desktop_height);
            Some((Box::new(c), "wgpu".to_string()))
        }
        RenderBackend::Auto => {
            // Auto-select softbuffer (CPU compositor) — reliable everywhere
            let c = SoftbufferCompositor::new(desktop_width, desktop_height);
            Some((Box::new(c), "softbuffer".to_string()))
        }
    }
}

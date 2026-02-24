//! Native rendering backends for RDP frame display.
//!
//! Instead of streaming frame data through the Tauri Channel to a JS canvas,
//! native renderers create a Win32 child window and blit pixels directly —
//! eliminating all JS / IPC / base64 overhead.
//!
//! Two concrete backends are provided:
//!
//! - **Softbuffer** — CPU-only: copies RGBA pixels into a platform-native
//!   surface buffer (GDI DIB on Windows) and presents via `StretchBlt`.
//!   Zero GPU dependency, lowest latency for small desktops.
//!
//! - **Wgpu** — GPU-accelerated: uploads dirty regions to a GPU texture and
//!   renders a full-screen textured quad each frame.  Leverages DX12/Vulkan
//!   on Windows for maximum throughput, especially at high resolutions or
//!   with HiDPI scaling.

use std::num::NonZeroU32;
use std::sync::Once;

// ─── Render Backend Enum ─────────────────────────────────────────────

/// Which frame-display pipeline to use.
#[derive(Debug, Clone, PartialEq)]
pub enum RenderBackend {
    /// Default: stream frames via Tauri Channel → JS canvas.
    Webview,
    /// CPU blit to a native Win32 child window (softbuffer crate).
    Softbuffer,
    /// GPU texture upload + present to a native child window (wgpu crate).
    Wgpu,
    /// Auto-select: try wgpu → softbuffer → webview.
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

    pub fn is_native(&self) -> bool {
        matches!(self, Self::Softbuffer | Self::Wgpu | Self::Auto)
    }
}

// ─── NativeRenderer trait ────────────────────────────────────────────

/// Trait implemented by every native (non-webview) rendering backend.
///
/// The lifecycle is:
/// 1. `new()` — create the Win32 child window + rendering resources
/// 2. `update_region()` — copy dirty pixels from the IronRDP framebuffer
/// 3. `present()` — flip / display the accumulated changes
/// 4. `reposition()` / `resize_desktop()` — handle geometry changes
/// 5. `destroy()` — tear down the window and resources
pub trait NativeRenderer: Send {
    /// Copy a rectangular region of RGBA pixel data from the IronRDP decoded
    /// image into the internal buffer / texture.
    ///
    /// `image_data` is the full decoded image (`DecodedImage::data()`),
    /// `fb_width` is the desktop width, and `(x, y, w, h)` is the dirty rect.
    fn update_region(
        &mut self,
        image_data: &[u8],
        fb_width: u16,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
    );

    /// Display the current state of the internal buffer / texture.
    fn present(&mut self) -> Result<(), String>;

    /// The remote desktop was resized — recreate internal buffers.
    fn resize_desktop(&mut self, width: u16, height: u16) -> Result<(), String>;

    /// Move / resize the overlay window.  Coordinates are in physical
    /// pixels relative to the **owner** window's client area — the
    /// implementation converts to screen coordinates internally.
    fn reposition(&mut self, x: i32, y: i32, width: u32, height: u32);

    /// Make the child window visible.
    fn show(&mut self);

    /// Hide the child window.
    fn hide(&mut self);

    /// Destroy the child window and release all resources.
    fn destroy(&mut self);

    /// Human-readable name of this backend (for logging / status events).
    fn name(&self) -> &'static str;

    /// Return the raw HWND (as isize) of the overlay window.
    fn hwnd(&self) -> isize;
}

// ─── Win32 helpers (Windows-only) ────────────────────────────────────

#[cfg(target_os = "windows")]
pub mod platform {
    use super::*;
    use raw_window_handle::{
        DisplayHandle, HandleError, HasDisplayHandle, HasWindowHandle, RawDisplayHandle,
        RawWindowHandle, Win32WindowHandle, WindowHandle, WindowsDisplayHandle,
    };
    use std::num::NonZeroIsize;
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Gdi::HBRUSH;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::core::PCWSTR;

    /// Window-class name for native renderer child windows.
    const CLASS_NAME: &str = "SortOfRemoteNG_NativeRender";

    static REGISTER_CLASS_ONCE: Once = Once::new();

    /// Register the shared window class (idempotent).
    fn ensure_class_registered() {
        REGISTER_CLASS_ONCE.call_once(|| unsafe {
            let class_wide: Vec<u16> =
                CLASS_NAME.encode_utf16().chain(std::iter::once(0)).collect();
            let hinstance = GetModuleHandleW(PCWSTR::null()).unwrap_or_default();
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(child_wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: PCWSTR(class_wide.as_ptr()),
                hbrBackground: HBRUSH(std::ptr::null_mut()),
                ..Default::default()
            };
            let _atom = RegisterClassExW(&wc);
        });
    }

    /// Minimal WndProc: returns HTTRANSPARENT for hit-tests so mouse events
    /// pass through to the webview underneath.  Everything else is default.
    unsafe extern "system" fn child_wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_NCHITTEST {
            return LRESULT(HTTRANSPARENT as isize);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    // ── NativeWindowHandle: raw-window-handle wrapper ────────────────

    /// Lightweight handle that implements `HasWindowHandle` + `HasDisplayHandle`
    /// so it can be passed to `softbuffer` and `wgpu`.
    #[derive(Clone, Copy)]
    pub struct NativeWindowHandle {
        pub hwnd_isize: isize,
    }

    // SAFETY: The HWND is a raw Win32 handle that can be sent across threads.
    unsafe impl Send for NativeWindowHandle {}
    unsafe impl Sync for NativeWindowHandle {}

    impl HasWindowHandle for NativeWindowHandle {
        fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
            let mut wh = Win32WindowHandle::new(
                NonZeroIsize::new(self.hwnd_isize)
                    .expect("HWND must be non-null"),
            );
            // hinstance is not strictly required but some backends prefer it
            let hinstance = unsafe { GetModuleHandleW(PCWSTR::null()).unwrap_or_default() };
            wh.hinstance = NonZeroIsize::new(hinstance.0 as isize);
            let raw = RawWindowHandle::Win32(wh);
            // SAFETY: the HWND is valid for the lifetime of this handle.
            Ok(unsafe { WindowHandle::borrow_raw(raw) })
        }
    }

    impl HasDisplayHandle for NativeWindowHandle {
        fn display_handle(&self) -> Result<DisplayHandle<'_>, HandleError> {
            let raw = RawDisplayHandle::Windows(WindowsDisplayHandle::new());
            // SAFETY: Windows display handle is always valid.
            Ok(unsafe { DisplayHandle::borrow_raw(raw) })
        }
    }

    // ── Public helpers ───────────────────────────────────────────────

    /// Convert client-area coordinates of `owner_hwnd` to screen
    /// coordinates.  Used because overlay windows (WS_POPUP) need
    /// screen-space positioning.
    pub fn client_to_screen(owner_hwnd: isize, x: i32, y: i32) -> (i32, i32) {
        unsafe {
            // Get the owner window's position on screen, then offset.
            // We use GetWindowRect on the owner and add the client-area
            // offset (accounting for title bar / borders via the difference
            // between window rect and client rect origin).
            let mut window_rect: RECT = std::mem::zeroed();
            let mut client_origin = POINT { x: 0, y: 0 };
            let _ = GetWindowRect(HWND(owner_hwnd as *mut _), &mut window_rect);
            // MapWindowPoints maps (0,0) in client area to screen coords.
            // Fallback: we compute client origin = window_rect.left + border.
            // Simplest approach: ScreenToClient is available, but we can
            // use the Windows `MapWindowPoints` trick — or just compute
            // from the difference between window rect and client rect.
            // Actually the simplest is to get client rect and compute offset.
            let mut client_rect: RECT = std::mem::zeroed();
            let _ = GetClientRect(HWND(owner_hwnd as *mut _), &mut client_rect);
            // The client area starts at (window_left + border_width, window_top + title_height).
            // border_width = (window_width - client_width) / 2  (symmetric)
            // title_height = window_height - client_height - border_width
            let ww = window_rect.right - window_rect.left;
            let wh = window_rect.bottom - window_rect.top;
            let cw = client_rect.right; // client_rect.left is always 0
            let ch = client_rect.bottom;
            let border_x = (ww - cw) / 2;
            let border_top = wh - ch - border_x; // title bar + top border
            client_origin.x = window_rect.left + border_x;
            client_origin.y = window_rect.top + border_top;
            (client_origin.x + x, client_origin.y + y)
        }
    }

    /// Create a `WS_POPUP` overlay window **owned** by `owner_hwnd`.
    ///
    /// Unlike `WS_CHILD`, a popup window lives on its own thread with
    /// no parent–child message dependency — this eliminates the
    /// cross-thread `SendMessage` deadlock that occurs when the UI
    /// thread sends messages to a child window whose owning thread
    /// is blocked on a TCP read.
    ///
    /// `(x, y)` are in client-area coordinates of the owner; they are
    /// converted to screen coordinates internally.
    ///
    /// Returns the overlay HWND as `isize`.
    pub fn create_overlay_window(
        owner_hwnd: isize,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<isize, String> {
        ensure_class_registered();
        unsafe {
            let class_wide: Vec<u16> =
                CLASS_NAME.encode_utf16().chain(std::iter::once(0)).collect();
            let hinstance = GetModuleHandleW(PCWSTR::null())
                .map_err(|e| format!("GetModuleHandle: {e}"))?;

            // Convert from owner's client-area coords to screen coords.
            let (sx, sy) = client_to_screen(owner_hwnd, x, y);

            let hwnd = CreateWindowExW(
                // WS_EX_TOOLWINDOW  – no taskbar entry
                // WS_EX_NOACTIVATE  – never steal focus from the main window
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                PCWSTR(class_wide.as_ptr()),
                PCWSTR::null(),
                WS_POPUP | WS_CLIPSIBLINGS, // start hidden; show() makes it visible
                sx,
                sy,
                width,
                height,
                Some(HWND(owner_hwnd as *mut _)), // owner (keeps popup above)
                None,
                Some(hinstance.into()),
                None,
            )
            .map_err(|e| format!("CreateWindowExW: {e}"))?;
            Ok(hwnd.0 as isize)
        }
    }

    pub fn show_window(hwnd: isize) {
        unsafe {
            let _ = ShowWindow(HWND(hwnd as *mut _), SW_SHOWNA);
        }
    }

    pub fn hide_window(hwnd: isize) {
        unsafe {
            let _ = ShowWindow(HWND(hwnd as *mut _), SW_HIDE);
        }
    }

    /// Move a popup overlay.  `(x, y)` are in client-area coords of
    /// `owner_hwnd`; converted to screen coords internally.
    pub fn move_window(hwnd: isize, owner_hwnd: isize, x: i32, y: i32, w: u32, h: u32) {
        unsafe {
            let (sx, sy) = client_to_screen(owner_hwnd, x, y);
            let _ = MoveWindow(HWND(hwnd as *mut _), sx, sy, w as i32, h as i32, true);
        }
    }

    /// Move a popup overlay using **screen** coordinates directly.
    pub fn move_window_screen(hwnd: isize, x: i32, y: i32, w: u32, h: u32) {
        unsafe {
            let _ = MoveWindow(HWND(hwnd as *mut _), x, y, w as i32, h as i32, true);
        }
    }

    pub fn destroy_window(hwnd: isize) {
        unsafe {
            let _ = DestroyWindow(HWND(hwnd as *mut _));
        }
    }

    /// Bring the child window to the top of the Z-order among siblings.
    pub fn bring_to_top(hwnd: isize) {
        unsafe {
            let _ = SetWindowPos(
                HWND(hwnd as *mut _),
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    /// Drain all pending Win32 messages for the current thread.
    ///
    /// This **must** be called periodically on the thread that owns native
    /// renderer child windows.  Without it, swap-chain presentation in
    /// wgpu (Vulkan / DX12) deadlocks because the OS never processes the
    /// internal messages the driver posts to the window.
    ///
    /// Softbuffer is less affected (GDI path), but pumping keeps the
    /// window responsive to `WM_PAINT`, `WM_SIZE`, etc.
    pub fn pump_messages() {
        unsafe {
            let mut msg = std::mem::zeroed::<MSG>();
            // PM_REMOVE = 0x0001 — remove each message from the queue
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}

// ═════════════════════════════════════════════════════════════════════
// Softbuffer Renderer
// ═════════════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
pub struct SoftbufferRenderer {
    hwnd: isize,
    owner_hwnd: isize,
    _context: softbuffer::Context<platform::NativeWindowHandle>,
    surface: softbuffer::Surface<platform::NativeWindowHandle, platform::NativeWindowHandle>,
    /// Shadow buffer at desktop resolution (each u32 = 0x00RRGGBB).
    shadow: Vec<u32>,
    desk_w: u32,
    desk_h: u32,
    dirty: bool,
}

#[cfg(target_os = "windows")]
impl SoftbufferRenderer {
    pub fn new(
        parent_hwnd: isize,
        x: i32,
        y: i32,
        desktop_width: u16,
        desktop_height: u16,
    ) -> Result<Self, String> {
        let w = desktop_width as u32;
        let h = desktop_height as u32;

        let overlay_hwnd =
            platform::create_overlay_window(parent_hwnd, x, y, w as i32, h as i32)?;

        let display_handle = platform::NativeWindowHandle { hwnd_isize: overlay_hwnd };
        let window_handle = platform::NativeWindowHandle { hwnd_isize: overlay_hwnd };

        let context = softbuffer::Context::new(display_handle)
            .map_err(|e| format!("softbuffer::Context: {e}"))?;
        let mut surface = softbuffer::Surface::new(&context, window_handle)
            .map_err(|e| format!("softbuffer::Surface: {e}"))?;

        surface
            .resize(
                NonZeroU32::new(w).ok_or("width must be > 0")?,
                NonZeroU32::new(h).ok_or("height must be > 0")?,
            )
            .map_err(|e| format!("softbuffer resize: {e}"))?;

        let shadow = vec![0u32; (w * h) as usize];

        log::info!(
            "SoftbufferRenderer: created {w}×{h} overlay window (owner=0x{parent_hwnd:X})"
        );

        Ok(Self {
            hwnd: overlay_hwnd,
            owner_hwnd: parent_hwnd,
            _context: context,
            surface,
            shadow,
            desk_w: w,
            desk_h: h,
            dirty: false,
        })
    }
}

#[cfg(target_os = "windows")]
impl NativeRenderer for SoftbufferRenderer {
    fn update_region(
        &mut self,
        image_data: &[u8],
        fb_width: u16,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
    ) {
        let bpp = 4usize;
        let src_stride = fb_width as usize * bpp;
        let dst_stride = self.desk_w as usize;

        for row in 0..h as usize {
            let src_y = y as usize + row;
            let src_row_start = src_y * src_stride + x as usize * bpp;

            let dst_y = y as usize + row;
            let dst_row_start = dst_y * dst_stride + x as usize;

            for col in 0..w as usize {
                let si = src_row_start + col * bpp;
                if si + 3 < image_data.len() {
                    let r = image_data[si] as u32;
                    let g = image_data[si + 1] as u32;
                    let b = image_data[si + 2] as u32;
                    // softbuffer on Windows: 0x00RRGGBB
                    let di = dst_row_start + col;
                    if di < self.shadow.len() {
                        self.shadow[di] = (r << 16) | (g << 8) | b;
                    }
                }
            }
        }
        self.dirty = true;
    }

    fn present(&mut self) -> Result<(), String> {
        if !self.dirty {
            return Ok(());
        }
        self.dirty = false;

        // Pump Win32 messages to keep the child window responsive.
        platform::pump_messages();

        let mut buffer = self
            .surface
            .buffer_mut()
            .map_err(|e| format!("softbuffer buffer_mut: {e}"))?;

        // Copy shadow → surface buffer
        buffer.copy_from_slice(&self.shadow);

        buffer
            .present()
            .map_err(|e| format!("softbuffer present: {e}"))?;

        Ok(())
    }

    fn resize_desktop(&mut self, width: u16, height: u16) -> Result<(), String> {
        let w = width as u32;
        let h = height as u32;

        self.surface
            .resize(
                NonZeroU32::new(w).ok_or("width must be > 0")?,
                NonZeroU32::new(h).ok_or("height must be > 0")?,
            )
            .map_err(|e| format!("softbuffer resize: {e}"))?;

        self.shadow.resize((w * h) as usize, 0);
        self.shadow.fill(0);
        self.desk_w = w;
        self.desk_h = h;

        platform::move_window(self.hwnd, self.owner_hwnd, 0, 0, w, h);

        log::info!("SoftbufferRenderer: resized to {w}×{h}");
        Ok(())
    }

    fn reposition(&mut self, x: i32, y: i32, width: u32, height: u32) {
        platform::move_window(self.hwnd, self.owner_hwnd, x, y, width, height);
        platform::bring_to_top(self.hwnd);
    }

    fn show(&mut self) {
        platform::show_window(self.hwnd);
        platform::bring_to_top(self.hwnd);
    }

    fn hide(&mut self) {
        platform::hide_window(self.hwnd);
    }

    fn destroy(&mut self) {
        platform::hide_window(self.hwnd);
        platform::destroy_window(self.hwnd);
    }

    fn name(&self) -> &'static str {
        "softbuffer"
    }

    fn hwnd(&self) -> isize {
        self.hwnd
    }
}

// ═════════════════════════════════════════════════════════════════════
// Wgpu Renderer
// ═════════════════════════════════════════════════════════════════════

#[cfg(target_os = "windows")]
pub struct WgpuRenderer {
    hwnd: isize,
    owner_hwnd: isize,
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    surface_config: wgpu::SurfaceConfiguration,
    desktop_texture: wgpu::Texture,
    bind_group: wgpu::BindGroup,
    render_pipeline: wgpu::RenderPipeline,
    desk_w: u32,
    desk_h: u32,
    dirty: bool,
}

#[cfg(target_os = "windows")]
impl WgpuRenderer {
    pub fn new(
        parent_hwnd: isize,
        x: i32,
        y: i32,
        desktop_width: u16,
        desktop_height: u16,
    ) -> Result<Self, String> {
        let w = desktop_width as u32;
        let h = desktop_height as u32;

        let overlay_hwnd =
            platform::create_overlay_window(parent_hwnd, x, y, w as i32, h as i32)?;

        // ── Create wgpu instance + surface (unsafe: we guarantee HWND lifetime) ──
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::DX12 | wgpu::Backends::VULKAN,
            ..Default::default()
        });

        let raw_display = raw_window_handle::RawDisplayHandle::Windows(
            raw_window_handle::WindowsDisplayHandle::new(),
        );
        let raw_window = {
            let mut wh = raw_window_handle::Win32WindowHandle::new(
                std::num::NonZeroIsize::new(overlay_hwnd).expect("HWND must be non-null"),
            );
            let hinstance = unsafe {
                windows::Win32::System::LibraryLoader::GetModuleHandleW(
                    windows::core::PCWSTR::null(),
                )
                .unwrap_or_default()
            };
            wh.hinstance = std::num::NonZeroIsize::new(hinstance.0 as isize);
            raw_window_handle::RawWindowHandle::Win32(wh)
        };

        // SAFETY: the HWND lives as long as this struct.
        let surface = unsafe {
            instance
                .create_surface_unsafe(wgpu::SurfaceTargetUnsafe::RawHandle {
                    raw_display_handle: raw_display,
                    raw_window_handle: raw_window,
                })
                .map_err(|e| format!("wgpu create_surface: {e}"))?
        };

        // Pump messages after surface creation — the Vulkan/DX12 loader
        // may post messages to the window during setup.
        platform::pump_messages();

        // ── Adapter + Device ─────────────────────────────────────────
        let adapter = futures::executor::block_on(instance.request_adapter(
            &wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            },
        ))
        .ok_or("No suitable GPU adapter found for wgpu")?;

        let (device, queue) = futures::executor::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("SortOfRemoteNG RDP"),
                ..Default::default()
            },
            None,
        ))
        .map_err(|e| format!("wgpu request_device: {e}"))?;

        // ── Surface config ───────────────────────────────────────────
        let caps = surface.get_capabilities(&adapter);
        let surface_format = caps
            .formats
            .iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or(caps.formats[0]);

        let present_mode = if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) {
            wgpu::PresentMode::Mailbox
        } else if caps.present_modes.contains(&wgpu::PresentMode::Immediate) {
            wgpu::PresentMode::Immediate
        } else {
            wgpu::PresentMode::Fifo
        };

        let surface_config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: w,
            height: h,
            present_mode,
            desired_maximum_frame_latency: 1,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &surface_config);

        // ── Desktop texture (RGBA8, updated per dirty region) ────────
        let desktop_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("RDP Desktop"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // ── Sampler ──────────────────────────────────────────────────
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("RDP Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // ── Shader ───────────────────────────────────────────────────
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("RDP Fullscreen Shader"),
            source: wgpu::ShaderSource::Wgsl(std::borrow::Cow::Borrowed(FULLSCREEN_WGSL)),
        });

        // ── Bind group layout + bind group ───────────────────────────
        let bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("RDP BGL"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });

        let texture_view = desktop_texture.create_view(&Default::default());

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("RDP BG"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&texture_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });

        // ── Render pipeline ──────────────────────────────────────────
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("RDP PL"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("RDP Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
                unclipped_depth: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        log::info!(
            "WgpuRenderer: created {w}×{h} overlay window, adapter={}, format={surface_format:?}, present={present_mode:?}",
            adapter.get_info().name
        );

        Ok(Self {
            hwnd: overlay_hwnd,
            owner_hwnd: parent_hwnd,
            device,
            queue,
            surface,
            surface_config,
            desktop_texture,
            bind_group,
            render_pipeline,
            desk_w: w,
            desk_h: h,
            dirty: false,
        })
    }

    /// Rebuild the bind group after recreating the desktop texture.
    fn rebuild_bind_group(&mut self) {
        let texture_view = self.desktop_texture.create_view(&Default::default());
        let sampler = self.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("RDP Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let bind_group_layout = self.render_pipeline.get_bind_group_layout(0);
        self.bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("RDP BG"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&texture_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });
    }
}

#[cfg(target_os = "windows")]
impl NativeRenderer for WgpuRenderer {
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
        let region_row_bytes = w as usize * bpp;

        // Build a contiguous RGBA buffer for the dirty region
        let mut region_data = Vec::with_capacity(region_row_bytes * h as usize);
        for row in 0..h as usize {
            let src_y = y as usize + row;
            let src_start = src_y * src_stride + x as usize * bpp;
            let src_end = src_start + region_row_bytes;
            if src_end <= image_data.len() {
                region_data.extend_from_slice(&image_data[src_start..src_end]);
            } else {
                // Pad with zeros if out of bounds
                region_data.resize(region_data.len() + region_row_bytes, 0);
            }
        }

        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.desktop_texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: x as u32,
                    y: y as u32,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &region_data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(region_row_bytes as u32),
                rows_per_image: Some(h as u32),
            },
            wgpu::Extent3d {
                width: w as u32,
                height: h as u32,
                depth_or_array_layers: 1,
            },
        );

        self.dirty = true;
    }

    fn present(&mut self) -> Result<(), String> {
        if !self.dirty {
            return Ok(());
        }
        self.dirty = false;

        // Pump Win32 messages so the swap chain / Vulkan / DX12 surface can
        // process internal driver messages.  Without this the presentation
        // deadlocks because the child window never handles its messages.
        platform::pump_messages();

        let frame = self
            .surface
            .get_current_texture()
            .map_err(|e| format!("wgpu get_current_texture: {e}"))?;
        let view = frame.texture.create_view(&Default::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("RDP Encoder"),
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("RDP Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                ..Default::default()
            });
            render_pass.set_pipeline(&self.render_pipeline);
            render_pass.set_bind_group(0, &self.bind_group, &[]);
            render_pass.draw(0..3, 0..1); // full-screen triangle
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        frame.present();

        Ok(())
    }

    fn resize_desktop(&mut self, width: u16, height: u16) -> Result<(), String> {
        let w = width as u32;
        let h = height as u32;

        // Resize surface
        self.surface_config.width = w;
        self.surface_config.height = h;
        self.surface.configure(&self.device, &self.surface_config);

        // Recreate desktop texture
        self.desktop_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("RDP Desktop"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        self.rebuild_bind_group();

        self.desk_w = w;
        self.desk_h = h;

        platform::move_window(self.hwnd, self.owner_hwnd, 0, 0, w, h);

        log::info!("WgpuRenderer: resized to {w}×{h}");
        Ok(())
    }

    fn reposition(&mut self, x: i32, y: i32, width: u32, height: u32) {
        platform::move_window(self.hwnd, self.owner_hwnd, x, y, width, height);
        platform::bring_to_top(self.hwnd);

        // If window size changed, reconfigure the surface
        if width != self.surface_config.width || height != self.surface_config.height {
            self.surface_config.width = width.max(1);
            self.surface_config.height = height.max(1);
            self.surface.configure(&self.device, &self.surface_config);
            // Mark dirty to force a re-render at the new size
            self.dirty = true;
        }
    }

    fn show(&mut self) {
        platform::show_window(self.hwnd);
        platform::bring_to_top(self.hwnd);
    }

    fn hide(&mut self) {
        platform::hide_window(self.hwnd);
    }

    fn destroy(&mut self) {
        platform::hide_window(self.hwnd);
        platform::destroy_window(self.hwnd);
    }

    fn name(&self) -> &'static str {
        "wgpu"
    }

    fn hwnd(&self) -> isize {
        self.hwnd
    }
}

// ═════════════════════════════════════════════════════════════════════
// WGSL Shader
// ═════════════════════════════════════════════════════════════════════

/// Full-screen triangle shader that samples the RDP desktop texture.
const FULLSCREEN_WGSL: &str = r#"
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0)       uv:       vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    // Full-screen triangle: 3 vertices that cover clip-space [-1, 1].
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),   // bottom-left
        vec2<f32>( 3.0, -1.0),   // far right
        vec2<f32>(-1.0,  3.0),   // far top
    );
    // UV mapping: (0,0)=top-left, (1,1)=bottom-right (Y flipped).
    var uvs = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0),
    );

    var out: VertexOutput;
    out.position = vec4<f32>(positions[idx], 0.0, 1.0);
    out.uv       = uvs[idx];
    return out;
}

@group(0) @binding(0) var desktop_tex:     texture_2d<f32>;
@group(0) @binding(1) var desktop_sampler: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(desktop_tex, desktop_sampler, in.uv);
}
"#;

// ═════════════════════════════════════════════════════════════════════
// Factory
// ═════════════════════════════════════════════════════════════════════

/// Create a native renderer for the given backend.
///
/// The child window is created at `(x, y)` relative to the parent Tauri
/// window with dimensions matching the RDP desktop.
///
/// Returns `Err` for `Webview` (which doesn't use a native renderer).
#[cfg(target_os = "windows")]
pub fn create_renderer(
    backend: &RenderBackend,
    parent_hwnd: isize,
    x: i32,
    y: i32,
    desktop_width: u16,
    desktop_height: u16,
) -> Result<(Box<dyn NativeRenderer>, String), String> {
    match backend {
        RenderBackend::Softbuffer => {
            let r = SoftbufferRenderer::new(parent_hwnd, x, y, desktop_width, desktop_height)?;
            Ok((Box::new(r), "softbuffer".to_string()))
        }
        RenderBackend::Wgpu => {
            let r = WgpuRenderer::new(parent_hwnd, x, y, desktop_width, desktop_height)?;
            Ok((Box::new(r), "wgpu".to_string()))
        }
        RenderBackend::Auto => {
            // Try wgpu first, fall back to softbuffer
            match WgpuRenderer::new(parent_hwnd, x, y, desktop_width, desktop_height) {
                Ok(r) => {
                    log::info!("Auto-selected wgpu renderer");
                    Ok((Box::new(r), "wgpu".to_string()))
                }
                Err(e) => {
                    log::warn!("wgpu renderer init failed ({e}), falling back to softbuffer");
                    let r = SoftbufferRenderer::new(
                        parent_hwnd,
                        x,
                        y,
                        desktop_width,
                        desktop_height,
                    )?;
                    Ok((Box::new(r), "softbuffer".to_string()))
                }
            }
        }
        RenderBackend::Webview => {
            Err("Webview backend does not use a native renderer".to_string())
        }
    }
}

/// Stub for non-Windows platforms.
#[cfg(not(target_os = "windows"))]
pub fn create_renderer(
    _backend: &RenderBackend,
    _parent_hwnd: isize,
    _x: i32,
    _y: i32,
    _desktop_width: u16,
    _desktop_height: u16,
) -> Result<(Box<dyn NativeRenderer>, String), String> {
    Err("Native rendering is only supported on Windows".to_string())
}

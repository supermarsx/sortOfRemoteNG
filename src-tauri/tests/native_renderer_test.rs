//! Integration tests for the native renderer module.
//!
//! These tests verify:
//!   - RenderBackend enum parsing, serialisation, and trait classification
//!   - Win32 overlay window creation / destruction (requires a desktop session)
//!   - SoftbufferRenderer pixel update + present round-trip
//!   - coordinate-conversion sanity check

use app_lib::native_renderer::RenderBackend;

// ═══════════════════════════════════════════════════════════════════════
// RenderBackend unit tests
// ═══════════════════════════════════════════════════════════════════════

#[test]
fn render_backend_from_str_known_values() {
    assert_eq!(RenderBackend::from_str("webview"), RenderBackend::Webview);
    assert_eq!(RenderBackend::from_str("softbuffer"), RenderBackend::Softbuffer);
    assert_eq!(RenderBackend::from_str("wgpu"), RenderBackend::Wgpu);
    assert_eq!(RenderBackend::from_str("gpu"), RenderBackend::Wgpu);
    assert_eq!(RenderBackend::from_str("auto"), RenderBackend::Auto);
}

#[test]
fn render_backend_from_str_case_insensitive() {
    assert_eq!(RenderBackend::from_str("Softbuffer"), RenderBackend::Softbuffer);
    assert_eq!(RenderBackend::from_str("WGPU"), RenderBackend::Wgpu);
    assert_eq!(RenderBackend::from_str("AUTO"), RenderBackend::Auto);
    assert_eq!(RenderBackend::from_str("WebView"), RenderBackend::Webview);
}

#[test]
fn render_backend_from_str_unknown_defaults_to_webview() {
    assert_eq!(RenderBackend::from_str(""), RenderBackend::Webview);
    assert_eq!(RenderBackend::from_str("opengl"), RenderBackend::Webview);
    assert_eq!(RenderBackend::from_str("vulkan"), RenderBackend::Webview);
    assert_eq!(RenderBackend::from_str("  "), RenderBackend::Webview);
}

#[test]
fn render_backend_as_str_round_trips() {
    for &(input, expected) in &[
        ("webview", "webview"),
        ("softbuffer", "softbuffer"),
        ("wgpu", "wgpu"),
        ("auto", "auto"),
    ] {
        let backend = RenderBackend::from_str(input);
        assert_eq!(backend.as_str(), expected);
    }
}

#[test]
fn render_backend_is_native_classification() {
    assert!(!RenderBackend::Webview.is_native(), "webview should not be native");
    assert!(RenderBackend::Softbuffer.is_native(), "softbuffer should be native");
    assert!(RenderBackend::Wgpu.is_native(), "wgpu should be native");
    assert!(RenderBackend::Auto.is_native(), "auto should be native");
}

// ═══════════════════════════════════════════════════════════════════════
// Win32 overlay window integration tests
// ═══════════════════════════════════════════════════════════════════════

/// These tests create real Win32 windows and therefore require a desktop
/// session.  They are skipped in headless CI (no HWND available).

#[cfg(target_os = "windows")]
mod win32_tests {
    use app_lib::native_renderer::platform;

    /// Helper: create a top-level hidden owner window so tests have a
    /// valid parent HWND without depending on a Tauri window.
    fn create_test_owner() -> isize {
        use windows::Win32::UI::WindowsAndMessaging::*;
        use windows::core::PCWSTR;

        unsafe {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                PCWSTR(class.as_ptr()),
                PCWSTR::null(),
                WS_OVERLAPPEDWINDOW,
                100, 100, 800, 600,
                None,
                None,
                None,
                None,
            )
            .expect("failed to create test owner window");
            hwnd.0 as isize
        }
    }

    fn destroy_test_owner(hwnd: isize) {
        use windows::Win32::UI::WindowsAndMessaging::DestroyWindow;
        unsafe {
            let _ = DestroyWindow(windows::Win32::Foundation::HWND(hwnd as *mut _));
        }
    }

    #[test]
    fn overlay_window_create_and_destroy() {
        let owner = create_test_owner();
        assert_ne!(owner, 0, "owner HWND should be valid");

        let overlay = platform::create_overlay_window(owner, 10, 20, 320, 240)
            .expect("create_overlay_window should succeed");
        assert_ne!(overlay, 0, "overlay HWND should be valid");

        // Show, hide, bring to top — should not panic
        platform::show_window(overlay);
        platform::pump_messages();
        platform::bring_to_top(overlay);
        platform::pump_messages();
        platform::hide_window(overlay);
        platform::pump_messages();

        // Destroy
        platform::destroy_window(overlay);
        destroy_test_owner(owner);
    }

    #[test]
    fn overlay_window_move_converts_coords() {
        let owner = create_test_owner();
        let overlay = platform::create_overlay_window(owner, 0, 0, 200, 150)
            .expect("create_overlay_window should succeed");

        // Moving with client coords — should not panic
        platform::move_window(overlay, owner, 50, 50, 300, 200);
        platform::pump_messages();

        // Verify the window is at a valid screen position
        use windows::Win32::Foundation::{HWND, RECT};
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
        unsafe {
            let mut rect: RECT = std::mem::zeroed();
            let _ = GetWindowRect(HWND(overlay as *mut _), &mut rect);
            // The window should be somewhere on screen (coordinates >= 0 after offset)
            // We can't assert exact values because they depend on the owner's position,
            // but the window should have non-zero dimensions.
            let w = rect.right - rect.left;
            let h = rect.bottom - rect.top;
            assert_eq!(w, 300, "overlay width should be 300");
            assert_eq!(h, 200, "overlay height should be 200");
        }

        platform::destroy_window(overlay);
        destroy_test_owner(owner);
    }

    #[test]
    fn client_to_screen_returns_valid_coords() {
        let owner = create_test_owner();

        // For a hidden non-moved window at (100, 100), client (0,0) should
        // map to somewhere near the window's screen position (accounting
        // for borders/title bar).
        let (sx, sy) = platform::client_to_screen(owner, 0, 0);
        // Should be >= the window rect position (100 + borders)
        assert!(sx >= 100, "screen x should be >= 100, got {sx}");
        assert!(sy >= 100, "screen y should be >= 100, got {sy}");

        // A point at (10, 20) in client coords should be further right/down
        let (sx2, sy2) = platform::client_to_screen(owner, 10, 20);
        assert_eq!(sx2, sx + 10, "offset x should be additive");
        assert_eq!(sy2, sy + 20, "offset y should be additive");

        destroy_test_owner(owner);
    }

    #[test]
    fn softbuffer_renderer_create_update_present() {
        use app_lib::native_renderer::{NativeRenderer, SoftbufferRenderer};

        let owner = create_test_owner();

        let mut renderer = SoftbufferRenderer::new(owner, 0, 0, 64, 48)
            .expect("SoftbufferRenderer::new should succeed");

        assert_eq!(renderer.name(), "softbuffer");

        // Create a 64×48 RGBA image (solid red)
        let mut image_data = vec![0u8; 64 * 48 * 4];
        for pixel in image_data.chunks_exact_mut(4) {
            pixel[0] = 255; // R
            pixel[1] = 0;   // G
            pixel[2] = 0;   // B
            pixel[3] = 255; // A
        }

        // Update full region
        renderer.update_region(&image_data, 64, 0, 0, 64, 48);

        // Present should succeed
        renderer.present().expect("present should succeed");

        // Update a sub-region (10x10 green patch at (5,5))
        for y in 5..15u16 {
            for x in 5..15u16 {
                let idx = (y as usize * 64 + x as usize) * 4;
                image_data[idx] = 0;
                image_data[idx + 1] = 255;
                image_data[idx + 2] = 0;
            }
        }
        renderer.update_region(&image_data, 64, 5, 5, 10, 10);
        renderer.present().expect("present after sub-region should succeed");

        // Show / reposition / hide lifecycle
        renderer.show();
        platform::pump_messages();
        renderer.reposition(10, 10, 128, 96);
        platform::pump_messages();
        renderer.hide();
        platform::pump_messages();

        // Resize desktop
        renderer.resize_desktop(128, 96).expect("resize should succeed");

        // Destroy
        renderer.destroy();
        destroy_test_owner(owner);
    }

    #[test]
    fn pump_messages_does_not_panic_with_no_messages() {
        // Pumping on a thread with no pending messages should be a no-op
        platform::pump_messages();
        platform::pump_messages();
    }

    #[test]
    fn create_renderer_factory_softbuffer() {
        use app_lib::native_renderer::{self, RenderBackend};

        let owner = create_test_owner();

        let result = native_renderer::create_renderer(
            &RenderBackend::Softbuffer,
            owner,
            0, 0,
            320, 240,
        );
        assert!(result.is_ok(), "softbuffer renderer should be created");

        let (mut renderer, name) = result.unwrap();
        assert_eq!(name, "softbuffer");
        assert_eq!(renderer.name(), "softbuffer");

        renderer.destroy();
        destroy_test_owner(owner);
    }

    #[test]
    fn create_renderer_factory_webview_returns_error() {
        use app_lib::native_renderer::{self, RenderBackend};

        let owner = create_test_owner();

        let result = native_renderer::create_renderer(
            &RenderBackend::Webview,
            owner,
            0, 0,
            320, 240,
        );
        assert!(result.is_err(), "webview should return Err (no native window)");

        destroy_test_owner(owner);
    }
}

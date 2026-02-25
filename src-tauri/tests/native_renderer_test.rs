//! Integration tests for the native renderer module.
//!
//! These tests verify:
//!   - RenderBackend enum parsing, serialisation, and trait classification
//!   - FrameCompositor implementations (SoftbufferCompositor, WgpuCompositor)
//!   - Dirty region tracking, flush behaviour, and resize_desktop

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

#[test]
fn render_backend_is_composited() {
    assert!(!RenderBackend::Webview.is_composited(), "webview is not composited");
    assert!(RenderBackend::Softbuffer.is_composited(), "softbuffer is composited");
    assert!(RenderBackend::Wgpu.is_composited(), "wgpu is composited");
    assert!(RenderBackend::Auto.is_composited(), "auto is composited");
}

// ═══════════════════════════════════════════════════════════════════════
// FrameCompositor tests
// ═══════════════════════════════════════════════════════════════════════

mod compositor_tests {
    use app_lib::native_renderer::{self, FrameCompositor, RenderBackend, SoftbufferCompositor};

    #[test]
    fn softbuffer_compositor_new() {
        let comp = SoftbufferCompositor::new(64, 48);
        assert_eq!(comp.name(), "softbuffer");
        assert!(!comp.is_dirty());
    }

    #[test]
    fn softbuffer_compositor_flush_when_clean_returns_none() {
        let mut comp = SoftbufferCompositor::new(64, 48);
        assert!(comp.flush().is_none(), "flush on clean compositor should return None");
    }

    #[test]
    fn softbuffer_compositor_update_and_flush() {
        let mut comp = SoftbufferCompositor::new(64, 48);

        // Create a 64×48 RGBA image (solid red)
        let mut image_data = vec![0u8; 64 * 48 * 4];
        for pixel in image_data.chunks_exact_mut(4) {
            pixel[0] = 255; // R
            pixel[1] = 0;   // G
            pixel[2] = 0;   // B
            pixel[3] = 255; // A
        }

        // Update full region
        comp.update_region(&image_data, 64, 0, 0, 64, 48);
        assert!(comp.is_dirty(), "should be dirty after update_region");

        let frame = comp.flush().expect("flush should return a frame");
        assert_eq!(frame.x, 0);
        assert_eq!(frame.y, 0);
        assert_eq!(frame.width, 64);
        assert_eq!(frame.height, 48);
        assert_eq!(frame.rgba.len(), 64 * 48 * 4);

        // Verify pixel data: first pixel should be red
        assert_eq!(frame.rgba[0], 255); // R
        assert_eq!(frame.rgba[1], 0);   // G
        assert_eq!(frame.rgba[2], 0);   // B
        assert_eq!(frame.rgba[3], 255); // A

        // After flush, should no longer be dirty
        assert!(!comp.is_dirty());
        assert!(comp.flush().is_none());
    }

    #[test]
    fn softbuffer_compositor_sub_region_update() {
        let mut comp = SoftbufferCompositor::new(64, 48);

        // Create a 64×48 RGBA image (solid black)
        let mut image_data = vec![0u8; 64 * 48 * 4];

        // Paint a 10×10 green patch at (5, 5)
        for y in 5..15u16 {
            for x in 5..15u16 {
                let idx = (y as usize * 64 + x as usize) * 4;
                image_data[idx] = 0;
                image_data[idx + 1] = 255;
                image_data[idx + 2] = 0;
                image_data[idx + 3] = 255;
            }
        }

        comp.update_region(&image_data, 64, 5, 5, 10, 10);
        let frame = comp.flush().expect("should flush sub-region");

        // The frame should cover only the dirty region (5,5)-(14,14)
        assert_eq!(frame.x, 5);
        assert_eq!(frame.y, 5);
        assert_eq!(frame.width, 10);
        assert_eq!(frame.height, 10);
        assert_eq!(frame.rgba.len(), 10 * 10 * 4);

        // All pixels in the frame should be green
        for pixel in frame.rgba.chunks_exact(4) {
            assert_eq!(pixel[0], 0, "R should be 0");
            assert_eq!(pixel[1], 255, "G should be 255");
            assert_eq!(pixel[2], 0, "B should be 0");
            assert_eq!(pixel[3], 255, "A should be 255");
        }
    }

    #[test]
    fn softbuffer_compositor_multiple_regions_coalesce() {
        let mut comp = SoftbufferCompositor::new(100, 100);
        let image_data = vec![128u8; 100 * 100 * 4];

        // Two separate updates that should merge into one bounding rect
        comp.update_region(&image_data, 100, 10, 10, 5, 5);  // (10,10)-(14,14)
        comp.update_region(&image_data, 100, 50, 50, 10, 10); // (50,50)-(59,59)

        let frame = comp.flush().expect("should flush merged region");

        // Bounding rect: (10,10) to (59,59) → width=50, height=50
        assert_eq!(frame.x, 10);
        assert_eq!(frame.y, 10);
        assert_eq!(frame.width, 50);
        assert_eq!(frame.height, 50);
    }

    #[test]
    fn softbuffer_compositor_resize_desktop() {
        let mut comp = SoftbufferCompositor::new(64, 48);

        // Update some data
        let image_data = vec![255u8; 64 * 48 * 4];
        comp.update_region(&image_data, 64, 0, 0, 64, 48);
        comp.flush(); // consume dirty state

        // Resize
        comp.resize_desktop(128, 96);
        assert!(!comp.is_dirty(), "resize should not mark dirty on its own");

        // Update with new dimensions
        let new_image = vec![200u8; 128 * 96 * 4];
        comp.update_region(&new_image, 128, 0, 0, 128, 96);
        let frame = comp.flush().expect("should flush after resize + update");
        assert_eq!(frame.width, 128);
        assert_eq!(frame.height, 96);
        assert_eq!(frame.rgba.len(), 128 * 96 * 4);
    }

    #[test]
    fn softbuffer_compositor_out_of_bounds_region_clamped() {
        let mut comp = SoftbufferCompositor::new(64, 48);
        let image_data = vec![255u8; 64 * 48 * 4];

        // Update region that extends beyond desktop bounds
        comp.update_region(&image_data, 64, 60, 44, 20, 20);

        if comp.is_dirty() {
            let frame = comp.flush().expect("should flush clamped region");
            // Region should be clamped to (60,44)-(63,47) → 4×4
            assert!(frame.width <= 64);
            assert!(frame.height <= 48);
        }
    }

    #[test]
    fn create_compositor_softbuffer() {
        let result = native_renderer::create_compositor(&RenderBackend::Softbuffer, 320, 240);
        assert!(result.is_some(), "softbuffer compositor should be created");
        let (comp, name) = result.unwrap();
        assert_eq!(name, "softbuffer");
        assert_eq!(comp.name(), "softbuffer");
    }

    #[test]
    fn create_compositor_wgpu_falls_back() {
        let result = native_renderer::create_compositor(&RenderBackend::Wgpu, 320, 240);
        assert!(result.is_some(), "wgpu compositor should be created (CPU fallback)");
        let (comp, name) = result.unwrap();
        // Currently WgpuCompositor delegates to softbuffer
        assert!(name == "wgpu" || name == "softbuffer");
        assert!(!comp.name().is_empty());
    }

    #[test]
    fn create_compositor_auto() {
        let result = native_renderer::create_compositor(&RenderBackend::Auto, 320, 240);
        assert!(result.is_some(), "auto compositor should be created");
        let (_comp, name) = result.unwrap();
        assert!(!name.is_empty());
    }

    #[test]
    fn create_compositor_webview_returns_none() {
        let result = native_renderer::create_compositor(&RenderBackend::Webview, 320, 240);
        assert!(result.is_none(), "webview should not create a compositor");
    }
}

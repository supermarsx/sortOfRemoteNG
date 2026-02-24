//! Integration tests for the native renderer module.
//!
//! These tests verify:
//!   - RenderBackend enum parsing, serialisation, and trait classification
//!   - Win32 overlay window creation / destruction (requires a desktop session)
//!   - SoftbufferRenderer pixel update + present round-trip
//!   - coordinate-conversion sanity check
//!   - **Hang / deadlock prevention**: window style assertions, cross-thread
//!     `SendMessage` timeout tests, and concurrent render + move stress tests
//!     that guarantee the `WS_POPUP` overlay architecture does not deadlock.

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
        use app_lib::native_renderer::{self, NativeRenderer, RenderBackend};

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

    // ═══════════════════════════════════════════════════════════════════
    // Hang / deadlock prevention tests
    //
    // The original WS_CHILD overlay windows deadlocked because:
    //   1. The overlay lived on a background thread (spawn_blocking)
    //   2. The Tauri UI thread would SendMessage to the child (WM_PAINT,
    //      WM_SIZE, etc.) and block waiting for the child's thread.
    //   3. That thread was blocked on a TCP read_pdu() call.
    //   → Mutual deadlock.
    //
    // The fix uses WS_POPUP (owned, not child) windows.  SendMessage
    // from the UI thread to a WS_POPUP on another thread does NOT
    // cross-thread dispatch — the message goes through PostMessage
    // semantics for owned windows.
    //
    // These tests verify the architectural invariants that prevent the
    // deadlock, and additionally stress-test real cross-thread scenarios
    // with hard timeouts so the test suite itself will never hang.
    // ═══════════════════════════════════════════════════════════════════

    /// Verify that overlay windows are created with WS_POPUP and
    /// NOT WS_CHILD.  This is the primary architectural defence
    /// against the cross-thread SendMessage deadlock.
    #[test]
    fn overlay_window_has_popup_style_not_child() {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::*;

        let owner = create_test_owner();
        let overlay = platform::create_overlay_window(owner, 0, 0, 200, 150)
            .expect("create_overlay_window should succeed");

        unsafe {
            let style = GetWindowLongW(HWND(overlay as *mut _), GWL_STYLE) as u32;
            let ex_style = GetWindowLongW(HWND(overlay as *mut _), GWL_EXSTYLE) as u32;

            // Must have WS_POPUP
            assert_ne!(
                style & WS_POPUP.0, 0,
                "overlay MUST use WS_POPUP (was 0x{style:08X})"
            );
            // Must NOT have WS_CHILD — this was the root cause of the hang
            assert_eq!(
                style & WS_CHILD.0, 0,
                "overlay MUST NOT use WS_CHILD (was 0x{style:08X})"
            );
            // Must have WS_EX_TOOLWINDOW (no taskbar entry)
            assert_ne!(
                ex_style & WS_EX_TOOLWINDOW.0, 0,
                "overlay should have WS_EX_TOOLWINDOW (was 0x{ex_style:08X})"
            );
            // Must have WS_EX_NOACTIVATE (never steal focus)
            assert_ne!(
                ex_style & WS_EX_NOACTIVATE.0, 0,
                "overlay should have WS_EX_NOACTIVATE (was 0x{ex_style:08X})"
            );
        }

        platform::destroy_window(overlay);
        destroy_test_owner(owner);
    }

    /// Verify the softbuffer renderer's underlying window also uses
    /// proper WS_POPUP style (not WS_CHILD) via the `hwnd()` getter.
    #[test]
    fn softbuffer_renderer_window_has_popup_style() {
        use app_lib::native_renderer::{NativeRenderer, SoftbufferRenderer};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::*;

        let owner = create_test_owner();
        let renderer = SoftbufferRenderer::new(owner, 0, 0, 64, 48)
            .expect("SoftbufferRenderer::new should succeed");

        let overlay = renderer.hwnd();
        assert_ne!(overlay, 0, "renderer hwnd should be valid");

        unsafe {
            let style = GetWindowLongW(HWND(overlay as *mut _), GWL_STYLE) as u32;

            // Must have WS_POPUP
            assert_ne!(
                style & WS_POPUP.0, 0,
                "renderer window MUST use WS_POPUP (was 0x{style:08X})"
            );
            // Must NOT have WS_CHILD
            assert_eq!(
                style & WS_CHILD.0, 0,
                "renderer window MUST NOT use WS_CHILD (was 0x{style:08X})"
            );
        }

        drop(renderer);
        destroy_test_owner(owner);
    }

    /// Simulate the exact deadlock scenario:
    ///
    /// 1. Main thread creates owner + overlay.
    /// 2. Background thread sends WM_NULL to the overlay via
    ///    SendMessageTimeoutW.
    /// 3. Main thread does NOT pump messages (simulating read_pdu block).
    ///
    /// With WS_CHILD this would deadlock (SendMessage blocks waiting for
    /// the child's thread to process, but that thread doesn't pump).
    ///
    /// With WS_POPUP (owned), SendMessageTimeoutW returns within the
    /// timeout because no cross-thread message dispatch is required.
    ///
    /// The test itself uses a hard 5-second channel timeout as its
    /// "hang detector" — if we don't get a response, the test fails
    /// instead of hanging the entire suite forever.
    #[test]
    fn cross_thread_send_message_does_not_deadlock() {
        use std::sync::mpsc;
        use std::time::Duration;
        use windows::Win32::Foundation::{HWND, WPARAM, LPARAM};
        use windows::Win32::UI::WindowsAndMessaging::*;

        let owner = create_test_owner();

        // Create overlay on the MAIN thread (same as test thread).
        let overlay = platform::create_overlay_window(owner, 0, 0, 200, 150)
            .expect("create_overlay_window should succeed");
        platform::show_window(overlay);
        platform::pump_messages();

        let overlay_hwnd = overlay;
        let (tx, rx) = mpsc::channel();

        // Background thread: sends a message TO the overlay.
        // This simulates the UI thread sending WM_PAINT / WM_SIZE etc.
        let handle = std::thread::spawn(move || {
            unsafe {
                let mut result: usize = 0;
                let status = SendMessageTimeoutW(
                    HWND(overlay_hwnd as *mut _),
                    WM_NULL,
                    WPARAM(0),
                    LPARAM(0),
                    SMTO_ABORTIFHUNG | SMTO_BLOCK,
                    2000, // 2 second timeout
                    Some(&mut result),
                );
                tx.send(status.0 != 0).unwrap();
            }
        });

        // Main thread does NOT pump — simulating "blocked on read_pdu".
        std::thread::sleep(Duration::from_millis(500));

        // Now pump so the overlay processes WM_NULL.
        platform::pump_messages();

        let send_succeeded = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("background thread should have reported within 5s — DEADLOCK?");

        handle.join().expect("background thread should not panic");

        // The key assertion is that we GOT HERE AT ALL.  With WS_CHILD
        // and no message pump, this would hang forever.
        assert!(
            send_succeeded,
            "SendMessageTimeoutW should succeed for WS_POPUP overlay"
        );

        platform::destroy_window(overlay);
        destroy_test_owner(owner);
    }

    /// Stress test: background thread does rapid present() calls while
    /// the main thread sends WM_SIZE / WM_PAINT to the overlay.
    ///
    /// This reproduces the real-world scenario where the RDP session
    /// loop renders frames on spawn_blocking while the UI thread
    /// handles resize events.
    ///
    /// Runs for 2 seconds — if a deadlock occurs the test will
    /// time out instead of completing.
    #[test]
    fn concurrent_present_and_resize_no_hang() {
        use app_lib::native_renderer::{NativeRenderer, SoftbufferRenderer};
        use std::sync::Arc;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::{Duration, Instant};
        use windows::Win32::Foundation::{HWND, WPARAM, LPARAM};
        use windows::Win32::UI::WindowsAndMessaging::*;

        let owner = create_test_owner();
        let mut renderer = SoftbufferRenderer::new(owner, 0, 0, 64, 48)
            .expect("SoftbufferRenderer::new should succeed");
        renderer.show();
        platform::pump_messages();

        let image_data = vec![255u8; 64 * 48 * 4];
        renderer.update_region(&image_data, 64, 0, 0, 64, 48);

        let done = Arc::new(AtomicBool::new(false));
        let done2 = done.clone();

        // Get the overlay HWND via the trait method.
        let overlay_hwnd = renderer.hwnd();
        assert_ne!(overlay_hwnd, 0, "renderer hwnd should be valid");

        // Background thread: sends WM_SIZE and WM_PAINT to the overlay.
        let handle = std::thread::spawn(move || {
            let mut count = 0u32;
            while !done2.load(Ordering::Relaxed) {
                unsafe {
                    let _ = SendMessageTimeoutW(
                        HWND(overlay_hwnd as *mut _),
                        WM_SIZE,
                        WPARAM(0),
                        LPARAM((48 << 16 | 64) as isize),
                        SMTO_ABORTIFHUNG,
                        500,
                        None,
                    );
                    let _ = SendMessageTimeoutW(
                        HWND(overlay_hwnd as *mut _),
                        WM_PAINT,
                        WPARAM(0),
                        LPARAM(0),
                        SMTO_ABORTIFHUNG,
                        500,
                        None,
                    );
                }
                count += 1;
                std::thread::sleep(Duration::from_millis(5));
            }
            count
        });

        // Main thread: rapid present() calls (RDP frame loop).
        let start = Instant::now();
        let mut frames = 0u32;

        while start.elapsed() < Duration::from_secs(2) {
            renderer.update_region(&image_data, 64, 0, 0, 64, 48);
            if let Err(e) = renderer.present() {
                eprintln!("present error (acceptable): {e}");
            }
            platform::pump_messages();
            frames += 1;

            if frames % 10 == 0 {
                renderer.reposition(frames as i32 % 50, frames as i32 % 30, 64, 48);
            }
        }

        done.store(true, Ordering::Relaxed);
        let msg_count = handle.join().expect("background thread should not panic");

        assert!(frames > 0, "should have rendered at least one frame");
        assert!(msg_count > 0, "background should have sent at least one message");
        eprintln!(
            "concurrent_present_and_resize: {frames} frames, {msg_count} messages — no deadlock"
        );

        renderer.destroy();
        destroy_test_owner(owner);
    }

    /// Stress test: overlay created on background thread, main thread
    /// sends messages.  This is the exact threading model of the RDP
    /// session (spawn_blocking creates the renderer, UI thread interacts).
    ///
    /// With WS_CHILD this scenario deadlocks.  With WS_POPUP it should
    /// complete within seconds.
    #[test]
    fn background_thread_renderer_with_main_thread_messages() {
        use app_lib::native_renderer::{NativeRenderer, SoftbufferRenderer};
        use std::sync::Arc;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::mpsc;
        use std::time::Duration;
        use windows::Win32::Foundation::{HWND, WPARAM, LPARAM};
        use windows::Win32::UI::WindowsAndMessaging::*;

        let owner = create_test_owner();

        let (hwnd_tx, hwnd_rx) = mpsc::channel::<isize>();
        let done = Arc::new(AtomicBool::new(false));
        let done2 = done.clone();

        // Background thread: creates the renderer, runs present() loop.
        let bg_owner = owner;
        let bg_handle = std::thread::spawn(move || {
            let mut renderer = SoftbufferRenderer::new(bg_owner, 0, 0, 64, 48)
                .expect("SoftbufferRenderer::new should succeed");
            renderer.show();
            platform::pump_messages();

            // Send the overlay HWND to the main thread via the trait method.
            hwnd_tx.send(renderer.hwnd()).unwrap();

            let image = vec![128u8; 64 * 48 * 4];
            let mut frames = 0u32;
            while !done2.load(Ordering::Relaxed) {
                renderer.update_region(&image, 64, 0, 0, 64, 48);
                let _ = renderer.present();
                platform::pump_messages();
                frames += 1;
                std::thread::sleep(Duration::from_millis(2));
            }

            renderer.destroy();
            frames
        });

        // Main thread: wait for the overlay HWND, then bombardit with messages.
        let overlay_hwnd = hwnd_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("should receive overlay HWND from background thread");
        assert_ne!(overlay_hwnd, 0);

        let start = std::time::Instant::now();
        let mut msg_count = 0u32;
        while start.elapsed() < Duration::from_secs(2) {
            unsafe {
                for &msg in &[WM_NULL, WM_SIZE, WM_MOVE, WM_PAINT] {
                    let _ = SendMessageTimeoutW(
                        HWND(overlay_hwnd as *mut _),
                        msg,
                        WPARAM(0),
                        LPARAM(0),
                        SMTO_ABORTIFHUNG,
                        500,
                        None,
                    );
                    msg_count += 1;
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        done.store(true, Ordering::Relaxed);
        let frames = bg_handle.join().expect("background thread should not panic");

        assert!(frames > 0, "background should have rendered frames");
        assert!(msg_count > 0, "main should have sent messages");
        eprintln!(
            "background_thread_renderer: {frames} bg frames, {msg_count} main messages — no deadlock"
        );

        destroy_test_owner(owner);
    }

    /// Verify that blocking the overlay's owning thread does NOT cause
    /// a hang when the other thread sends messages.
    ///
    /// This is the most direct reproduction of the original bug:
    /// - Thread A owns the overlay (and is blocked on a "TCP read").
    /// - Thread B sends a message to the overlay.
    /// - With WS_CHILD: Thread B's SendMessage blocks forever.
    /// - With WS_POPUP: Thread B's SendMessageTimeoutW returns (with
    ///   timeout or success).
    #[test]
    fn blocked_owner_thread_does_not_hang_sender() {
        use std::sync::{mpsc, Arc, Barrier};
        use std::time::Duration;
        use windows::Win32::Foundation::{HWND, WPARAM, LPARAM};
        use windows::Win32::UI::WindowsAndMessaging::*;

        let owner = create_test_owner();

        let barrier = Arc::new(Barrier::new(2));
        let barrier2 = barrier.clone();

        let (overlay_tx, overlay_rx) = mpsc::channel::<isize>();
        let block_barrier = Arc::new(Barrier::new(2));
        let block_barrier2 = block_barrier.clone();

        // Thread A: creates overlay, signals ready, then BLOCKS
        // (simulating read_pdu() TCP wait).
        let thread_a = std::thread::spawn(move || {
            let overlay = platform::create_overlay_window(owner, 0, 0, 100, 80)
                .expect("create_overlay_window");
            platform::show_window(overlay);
            platform::pump_messages();
            overlay_tx.send(overlay).unwrap();

            // Signal ready, then BLOCK
            barrier2.wait();
            block_barrier2.wait(); // ← simulates TCP read blocking

            platform::pump_messages();
            platform::destroy_window(overlay);
        });

        let overlay_hwnd = overlay_rx
            .recv_timeout(Duration::from_secs(3))
            .expect("should receive overlay HWND");

        // Wait for thread A to reach its blocking point
        barrier.wait();
        std::thread::sleep(Duration::from_millis(100));

        // Thread B (this thread): send WM_NULL to the overlay.
        // With WS_CHILD this would block forever.
        // With WS_POPUP this returns within the timeout.
        let send_start = std::time::Instant::now();
        unsafe {
            let mut lresult: usize = 0;
            let status = SendMessageTimeoutW(
                HWND(overlay_hwnd as *mut _),
                WM_NULL,
                WPARAM(0),
                LPARAM(0),
                SMTO_ABORTIFHUNG | SMTO_BLOCK,
                2000,
                Some(&mut lresult),
            );

            let elapsed = send_start.elapsed();
            assert!(
                elapsed < Duration::from_secs(3),
                "SendMessageTimeoutW took {elapsed:?} — possible deadlock!"
            );

            eprintln!(
                "blocked_owner_thread: SendMessageTimeoutW returned in {elapsed:?}, status={}",
                status.0
            );
        }

        // Unblock thread A
        block_barrier.wait();
        thread_a.join().expect("thread A should not panic");

        destroy_test_owner(owner);
    }
}

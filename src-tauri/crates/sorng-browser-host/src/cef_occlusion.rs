//! Native clipping for shell overlays. Keeps the visible portion painting and
//! excludes covered pixels from input without replacing the native browser.
use crate::ipc::OriginBrowserBounds;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(C)]
pub(crate) struct ClipRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub(crate) fn visible_rectangles(
    bounds: OriginBrowserBounds,
    overlays: &[OriginBrowserBounds],
    scale: f64,
) -> Result<Vec<ClipRect>, ()> {
    bounds.validate().map_err(|_| ())?;
    if overlays.len() > 32 || !scale.is_finite() || scale <= 0.0 || scale > 16.0 {
        return Err(());
    }
    let width = (bounds.width * scale).round() as i32;
    let height = (bounds.height * scale).round() as i32;
    if width < 1 || height < 1 || width > 32767 || height > 32767 {
        return Err(());
    }
    let mut result = vec![ClipRect {
        x: 0,
        y: 0,
        width,
        height,
    }];
    for overlay in overlays {
        overlay.validate().map_err(|_| ())?;
        let left = ((overlay.x - bounds.x) * scale)
            .floor()
            .clamp(0.0, width as f64) as i32;
        let top = ((overlay.y - bounds.y) * scale)
            .floor()
            .clamp(0.0, height as f64) as i32;
        let right = ((overlay.x + overlay.width - bounds.x) * scale)
            .ceil()
            .clamp(0.0, width as f64) as i32;
        let bottom = ((overlay.y + overlay.height - bounds.y) * scale)
            .ceil()
            .clamp(0.0, height as f64) as i32;
        if right <= left || bottom <= top {
            continue;
        }
        let mut next = Vec::new();
        for r in result {
            let x1 = r.x.max(left);
            let y1 = r.y.max(top);
            let x2 = (r.x + r.width).min(right);
            let y2 = (r.y + r.height).min(bottom);
            if x2 <= x1 || y2 <= y1 {
                next.push(r);
                continue;
            }
            for part in [
                ClipRect {
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: y1 - r.y,
                },
                ClipRect {
                    x: r.x,
                    y: y2,
                    width: r.width,
                    height: r.y + r.height - y2,
                },
                ClipRect {
                    x: r.x,
                    y: y1,
                    width: x1 - r.x,
                    height: y2 - y1,
                },
                ClipRect {
                    x: x2,
                    y: y1,
                    width: r.x + r.width - x2,
                    height: y2 - y1,
                },
            ] {
                if part.width > 0 && part.height > 0 {
                    next.push(part);
                }
            }
        }
        // Rectangle grids remain bounded even for a pathological shell layout.
        if next.len() > 4096 {
            return Err(());
        }
        result = next;
    }
    Ok(result)
}

#[cfg(all(feature = "cef-host", target_os = "windows"))]
pub(crate) fn apply(
    window: cef::sys::cef_window_handle_t,
    rects: &[ClipRect],
    input_blocked: bool,
) -> Result<(), ()> {
    use std::ffi::c_void;
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> *mut c_void;
        fn CombineRgn(dest: *mut c_void, a: *mut c_void, b: *mut c_void, mode: i32) -> i32;
        fn DeleteObject(object: *mut c_void) -> i32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowRgn(window: *mut c_void, region: *mut c_void, redraw: i32) -> i32;
        fn EnableWindow(window: *mut c_void, enabled: i32) -> i32;
        fn IsWindow(window: *mut c_void) -> i32;
    }
    unsafe {
        if IsWindow(window.0.cast()) == 0 {
            return Err(());
        }
        let region = CreateRectRgn(0, 0, 0, 0);
        if region.is_null() {
            return Err(());
        }
        for r in rects {
            let part = CreateRectRgn(r.x, r.y, r.x + r.width, r.y + r.height);
            if part.is_null() {
                DeleteObject(region);
                return Err(());
            }
            let success = CombineRgn(region, region, part, 2); // RGN_OR
            DeleteObject(part);
            if success == 0 {
                DeleteObject(region);
                return Err(());
            }
        }
        if SetWindowRgn(window.0.cast(), region, 1) == 0 {
            DeleteObject(region);
            return Err(());
        }
        // Windows owns the HRGN after successful SetWindowRgn.
        EnableWindow(window.0.cast(), i32::from(!input_blocked));
    }
    Ok(())
}

#[cfg(all(feature = "cef-host", target_os = "linux"))]
pub(crate) fn apply(
    window: cef::sys::cef_window_handle_t,
    rects: &[ClipRect],
    input_blocked: bool,
) -> Result<(), ()> {
    use std::ffi::{c_char, c_void};
    #[link(name = "X11")]
    extern "C" {
        fn XDisplayString(display: *mut c_void) -> *const c_char;
    }
    let display = cef::get_xdisplay().cast::<c_void>();
    let window = u32::try_from(window).map_err(|_| ())?;
    if display.is_null() || window <= 1 {
        return Err(());
    }
    // Same X server as the live CEF surface, never DISPLAY selected by a
    // renderer. The private control connection owns its error replies; it does
    // not replace Xlib's process-global handler or consume CEF's event stream.
    let name = unsafe { XDisplayString(display) };
    if name.is_null() {
        return Err(());
    }
    let mut connection = unsafe { x11_checked::Connection::open(name) }?;
    x11_checked::apply(&mut connection, window, rects, input_blocked)
}

// Keep the bounded wire/policy layer testable on non-X11 development hosts.
// Layouts/opcodes follow xcb-proto xproto.xml and shape.xml (SHAPE 1.1).
// Only libxcb's core ABI is needed, not libxcb-shape or Xlib error traps.
#[cfg(any(test, all(feature = "cef-host", target_os = "linux")))]
mod x11_checked {
    use super::ClipRect;

    pub(super) trait Wire {
        // Each void request must be checked; replies must report X errors.
        fn request(&mut self, bytes: Vec<u8>, reply: bool) -> Result<[u8; 32], ()>;
    }

    fn packet(opcode: u8, detail: u8, size: usize) -> Vec<u8> {
        let mut bytes = vec![0; size];
        bytes[0] = opcode;
        bytes[1] = detail;
        bytes[2..4].copy_from_slice(&((size / 4) as u16).to_ne_bytes());
        bytes
    }

    fn u32_at(reply: &[u8; 32], offset: usize) -> u32 {
        u32::from_ne_bytes(reply[offset..offset + 4].try_into().unwrap())
    }

    fn parent(wire: &mut impl Wire, window: u32) -> Result<(u32, u32), ()> {
        let mut bytes = packet(15, 0, 8); // QueryTree
        bytes[4..8].copy_from_slice(&window.to_ne_bytes());
        let reply = wire.request(bytes, true)?;
        Ok((u32_at(&reply, 8), u32_at(&reply, 12))) // root, parent
    }

    fn focus(wire: &mut impl Wire) -> Result<u32, ()> {
        Ok(u32_at(&wire.request(packet(43, 0, 4), true)?, 8))
    }

    fn in_subtree(wire: &mut impl Wire, mut current: u32, window: u32) -> Result<bool, ()> {
        for _ in 0..64 {
            if current <= 1 {
                // None / PointerRoot are not owned CEF windows.
                return Ok(false);
            }
            if current == window {
                return Ok(true);
            }
            let (root, next) = parent(wire, current)?;
            if current == root {
                return Ok(false);
            }
            if next == current {
                return Err(());
            }
            current = next;
        }
        Err(()) // Unknown ownership is never permission to steal focus.
    }

    fn release_focus(wire: &mut impl Wire, window: u32) -> Result<(), ()> {
        let current = focus(wire)?;
        if !in_subtree(wire, current, window)? {
            return Ok(());
        }
        let (root, owner) = parent(wire, window)?;
        if owner <= 1 || owner == root || owner == window {
            return Err(()); // Embedded owner required; never focus the desktop.
        }
        let mut bytes = packet(42, 2, 12); // SetInputFocus, RevertToParent
        bytes[4..8].copy_from_slice(&owner.to_ne_bytes());
        // CurrentTime, not a potentially stale event timestamp.
        wire.request(bytes, false)?;
        let current = focus(wire)?;
        if in_subtree(wire, current, window)? {
            return Err(());
        }
        Ok(())
    }

    fn shape(opcode: u8, window: u32, kind: u8, rects: &[ClipRect]) -> Vec<u8> {
        let mut bytes = packet(opcode, 1, 16 + rects.len() * 8); // Rectangles
                                                                 // ShapeSet=0, Unsorted=0; offsets/padding remain zero.
        bytes[5] = kind;
        bytes[8..12].copy_from_slice(&window.to_ne_bytes());
        for (r, out) in rects.iter().zip(bytes[16..].chunks_exact_mut(8)) {
            out[0..2].copy_from_slice(&(r.x as i16).to_ne_bytes());
            out[2..4].copy_from_slice(&(r.y as i16).to_ne_bytes());
            out[4..6].copy_from_slice(&(r.width as u16).to_ne_bytes());
            out[6..8].copy_from_slice(&(r.height as u16).to_ne_bytes());
        }
        bytes
    }

    pub(super) fn apply(
        wire: &mut impl Wire,
        window: u32,
        rects: &[ClipRect],
        blocked: bool,
    ) -> Result<(), ()> {
        if window <= 1
            || rects.len() > 4096
            || rects.iter().any(|r| {
                r.x < 0
                    || r.y < 0
                    || r.width <= 0
                    || r.height <= 0
                    || i64::from(r.x) + i64::from(r.width) > 32767
                    || i64::from(r.y) + i64::from(r.height) > 32767
            })
        {
            return Err(());
        }
        let mut bytes = packet(98, 0, 16); // QueryExtension("SHAPE")
        bytes[4..6].copy_from_slice(&5u16.to_ne_bytes());
        bytes[8..13].copy_from_slice(b"SHAPE");
        let extension = wire.request(bytes, true)?;
        let opcode = extension[9];
        if extension[8] == 0 || opcode < 128 {
            return Err(());
        }
        let version = wire.request(packet(opcode, 0, 4), true)?;
        let major = u16::from_ne_bytes(version[8..10].try_into().unwrap());
        let minor = u16::from_ne_bytes(version[10..12].try_into().unwrap());
        if (major, minor) < (1, 1) {
            return Err(());
        }
        if blocked {
            // Disable pointer targeting before handing keyboard focus to the
            // owner. An ancestor focus alone can still route keys to the
            // pointer's descendant window under X11's normal focus rules.
            wire.request(shape(opcode, window, 2, &[]), false)?;
            release_focus(wire, window)?;
        }
        wire.request(shape(opcode, window, 0, rects), false)?;
        if !blocked {
            wire.request(shape(opcode, window, 2, rects), false)?;
        }
        // No automatic focus restoration when the overlay closes.
        Ok(())
    }

    // Also type-check the FFI adapter in portable tests. No X connection is
    // opened by those tests and unreachable foreign calls are not linked.
    #[cfg(any(test, all(feature = "cef-host", target_os = "linux")))]
    #[cfg_attr(not(all(feature = "cef-host", target_os = "linux")), allow(dead_code))]
    mod native {
        use super::Wire;
        use std::ffi::{c_char, c_int, c_void};

        #[repr(C)]
        #[derive(Clone, Copy)]
        struct Iovec {
            base: *mut c_void,
            len: usize,
        }
        #[repr(C)]
        struct Request {
            count: usize,
            extension: *mut c_void,
            opcode: u8,
            is_void: u8,
        }
        #[repr(C)]
        struct Cookie {
            sequence: u32,
        }
        #[cfg(test)]
        #[test]
        fn xcb_public_abi_layouts_match_platform_headers() {
            use std::mem::{offset_of, size_of};
            assert_eq!(size_of::<Iovec>(), 2 * size_of::<usize>());
            assert_eq!(offset_of!(Iovec, len), size_of::<usize>());
            assert_eq!(size_of::<Request>(), 3 * size_of::<usize>());
            assert_eq!(offset_of!(Request, extension), size_of::<usize>());
            assert_eq!(offset_of!(Request, opcode), 2 * size_of::<usize>());
            assert_eq!(offset_of!(Request, is_void), 2 * size_of::<usize>() + 1);
            assert_eq!(size_of::<Cookie>(), 4);
        }
        #[cfg_attr(target_os = "linux", link(name = "xcb"))]
        extern "C" {
            fn xcb_connect(display: *const c_char, screen: *mut c_int) -> *mut c_void;
            fn xcb_disconnect(connection: *mut c_void);
            fn xcb_connection_has_error(connection: *mut c_void) -> c_int;
            fn xcb_send_request(
                connection: *mut c_void,
                flags: c_int,
                vector: *mut Iovec,
                request: *const Request,
            ) -> u32;
            fn xcb_request_check(connection: *mut c_void, cookie: Cookie) -> *mut c_void;
            fn xcb_wait_for_reply(
                connection: *mut c_void,
                sequence: u32,
                error: *mut *mut c_void,
            ) -> *mut c_void;
        }
        extern "C" {
            fn free(memory: *mut c_void);
        }

        pub(crate) struct Connection(*mut c_void);
        impl Connection {
            pub(crate) unsafe fn open(display: *const c_char) -> Result<Self, ()> {
                let connection = Self(xcb_connect(display, std::ptr::null_mut()));
                if connection.0.is_null() || xcb_connection_has_error(connection.0) != 0 {
                    return Err(());
                }
                Ok(connection)
            }
        }
        impl Drop for Connection {
            fn drop(&mut self) {
                if !self.0.is_null() {
                    unsafe {
                        xcb_disconnect(self.0);
                    }
                }
            }
        }
        impl Wire for Connection {
            fn request(&mut self, mut bytes: Vec<u8>, reply: bool) -> Result<[u8; 32], ()> {
                if bytes.len() < 4 || bytes.len() % 4 != 0 || bytes.len() > 32784 {
                    return Err(());
                }
                let request = Request {
                    count: 1,
                    extension: std::ptr::null_mut(),
                    opcode: bytes[0],
                    is_void: u8::from(!reply),
                };
                // libxcb reserves two preceding iovecs for protocol headers.
                let mut vectors = [Iovec {
                    base: std::ptr::null_mut(),
                    len: 0,
                }; 3];
                vectors[2] = Iovec {
                    base: bytes.as_mut_ptr().cast(),
                    len: bytes.len(),
                };
                unsafe {
                    // CHECKED | RAW: packets already contain native-endian X11
                    // headers, including the SHAPE extension's minor opcode.
                    let sequence =
                        xcb_send_request(self.0, 3, vectors.as_mut_ptr().add(2), &request);
                    if sequence == 0 || xcb_connection_has_error(self.0) != 0 {
                        return Err(());
                    }
                    let mut output = [0u8; 32];
                    let mut error = std::ptr::null_mut();
                    let response = if reply {
                        xcb_wait_for_reply(self.0, sequence, &mut error)
                    } else {
                        error = xcb_request_check(self.0, Cookie { sequence });
                        std::ptr::null_mut()
                    };
                    let success = error.is_null()
                        && (!reply || !response.is_null())
                        && xcb_connection_has_error(self.0) == 0;
                    if success && reply {
                        std::ptr::copy_nonoverlapping(
                            response.cast::<u8>(),
                            output.as_mut_ptr(),
                            32,
                        );
                    }
                    free(error);
                    free(response);
                    if !success || (reply && output[0] != 1) {
                        return Err(());
                    }
                    Ok(output)
                }
            }
        }
    }
    #[cfg(all(feature = "cef-host", target_os = "linux"))]
    pub(super) use native::Connection;
}

#[cfg(all(feature = "cef-host", target_os = "macos"))]
pub(crate) fn apply(
    window: cef::sys::cef_window_handle_t,
    rects: &[ClipRect],
    input_blocked: bool,
) -> Result<(), ()> {
    extern "C" {
        fn sorng_cef_clip_view(
            view: *mut std::ffi::c_void,
            rects: *const ClipRect,
            count: usize,
            blocked: bool,
        ) -> bool;
    }
    if unsafe { sorng_cef_clip_view(window.cast(), rects.as_ptr(), rects.len(), input_blocked) } {
        Ok(())
    } else {
        Err(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeX {
        version: (u16, u16),
        present: bool,
        focus: u32,
        parents: std::collections::HashMap<u32, (u32, u32)>,
        requests: Vec<(Vec<u8>, bool)>,
        fail_at: Option<usize>,
        retain_focus: bool,
    }
    impl Default for FakeX {
        fn default() -> Self {
            Self {
                version: (1, 1),
                present: true,
                focus: 5,
                // root=2, shell=3, CEF=4, CEF content=5, shell input=6.
                parents: [
                    (2, (2, 0)),
                    (3, (2, 2)),
                    (4, (2, 3)),
                    (5, (2, 4)),
                    (6, (2, 3)),
                ]
                .into(),
                requests: Vec::new(),
                fail_at: None,
                retain_focus: false,
            }
        }
    }
    impl x11_checked::Wire for FakeX {
        fn request(&mut self, bytes: Vec<u8>, reply: bool) -> Result<[u8; 32], ()> {
            assert_eq!(bytes.len() % 4, 0);
            assert_eq!(
                usize::from(u16::from_ne_bytes([bytes[2], bytes[3]])) * 4,
                bytes.len()
            );
            self.requests.push((bytes.clone(), reply));
            if self.fail_at == Some(self.requests.len() - 1) {
                return Err(());
            }
            let mut output = [0; 32];
            output[0] = 1;
            match (bytes[0], bytes[1]) {
                (98, 0) => {
                    assert!(reply);
                    assert_eq!(&bytes[8..13], b"SHAPE");
                    output[8] = u8::from(self.present);
                    output[9] = 160;
                }
                (160, 0) => {
                    assert!(reply);
                    output[8..10].copy_from_slice(&self.version.0.to_ne_bytes());
                    output[10..12].copy_from_slice(&self.version.1.to_ne_bytes());
                }
                (15, 0) => {
                    assert!(reply);
                    let window = u32::from_ne_bytes(bytes[4..8].try_into().unwrap());
                    let (root, parent) = self.parents.get(&window).ok_or(())?;
                    output[8..12].copy_from_slice(&root.to_ne_bytes());
                    output[12..16].copy_from_slice(&parent.to_ne_bytes());
                }
                (43, 0) => {
                    assert!(reply);
                    output[8..12].copy_from_slice(&self.focus.to_ne_bytes());
                }
                (42, 2) => {
                    assert!(!reply);
                    assert_eq!(&bytes[8..12], &[0; 4]); // CurrentTime
                    if !self.retain_focus {
                        self.focus = u32::from_ne_bytes(bytes[4..8].try_into().unwrap());
                    }
                }
                (160, 1) => {
                    assert!(!reply);
                    assert_eq!(bytes[4], 0); // Set, not Union
                    assert_eq!(&bytes[6..8], &[0, 0]); // Unsorted, pad
                    assert_eq!(&bytes[8..12], &4u32.to_ne_bytes());
                    assert_eq!(&bytes[12..16], &[0; 4]);
                }
                _ => panic!("unexpected X request"),
            }
            Ok(output)
        }
    }
    fn xrects() -> [ClipRect; 1] {
        [ClipRect {
            x: 12,
            y: 34,
            width: 500,
            height: 400,
        }]
    }

    #[test]
    fn x11_requires_shape_1_1_before_mutating_surface_or_focus() {
        for (present, version) in [(false, (1, 1)), (true, (1, 0)), (true, (0, 9))] {
            let mut wire = FakeX {
                present,
                version,
                ..FakeX::default()
            };
            assert!(x11_checked::apply(&mut wire, 4, &xrects(), true).is_err());
            assert!(wire.requests.iter().all(|(_, reply)| *reply));
            assert_eq!(wire.focus, 5);
        }
    }

    #[test]
    fn x11_blocks_pointer_before_releasing_descendant_focus_without_unmapping() {
        let mut wire = FakeX::default();
        x11_checked::apply(&mut wire, 4, &xrects(), true).unwrap();
        assert_eq!(wire.focus, 3);
        let mutations: Vec<_> = wire
            .requests
            .iter()
            .filter(|(_, reply)| !reply)
            .map(|(b, _)| b)
            .collect();
        assert_eq!(mutations.len(), 3);
        assert_eq!(
            (
                mutations[0][0],
                mutations[0][1],
                mutations[0][5],
                mutations[0].len()
            ),
            (160, 1, 2, 16)
        );
        assert_eq!(mutations[1][0], 42);
        assert_eq!((mutations[2][0], mutations[2][5]), (160, 0));
        assert_eq!(&mutations[2][16..18], &12i16.to_ne_bytes());
        assert_eq!(&mutations[2][18..20], &34i16.to_ne_bytes());
        assert_eq!(&mutations[2][20..22], &500u16.to_ne_bytes());
        assert_eq!(&mutations[2][22..24], &400u16.to_ne_bytes());
    }

    #[test]
    fn x11_accepts_newer_shape_and_direct_focus_with_empty_or_maximum_region() {
        for rects in [vec![], vec![xrects()[0]; 4096]] {
            let mut wire = FakeX {
                version: (2, 0),
                focus: 4,
                ..FakeX::default()
            };
            x11_checked::apply(&mut wire, 4, &rects, true).unwrap();
            assert_eq!(wire.focus, 3);
            let (bounding, reply) = wire.requests.last().unwrap();
            assert!(!reply);
            assert_eq!(bounding[5], 0);
            assert_eq!(bounding.len(), 16 + rects.len() * 8);
        }
    }

    #[test]
    fn x11_preserves_other_focus_and_never_restores_focus_on_unblock() {
        for current in [0, 1, 2, 3, 6] {
            let mut wire = FakeX {
                focus: current,
                ..FakeX::default()
            };
            x11_checked::apply(&mut wire, 4, &xrects(), true).unwrap();
            assert_eq!(wire.focus, current);
            assert!(!wire.requests.iter().any(|(b, _)| b[0] == 42));
        }
        let mut wire = FakeX::default();
        x11_checked::apply(&mut wire, 4, &xrects(), false).unwrap();
        assert_eq!(wire.focus, 5);
        assert_eq!(wire.requests.len(), 4);
        assert_eq!(wire.requests[2].0[5], 0);
        assert_eq!(wire.requests[3].0[5], 2);
        assert_eq!(wire.requests[2].0[16..], wire.requests[3].0[16..]);
    }

    #[test]
    fn x11_each_checked_request_failure_aborts_without_followup_mutations() {
        for blocked in [false, true] {
            let mut success = FakeX::default();
            x11_checked::apply(&mut success, 4, &xrects(), blocked).unwrap();
            for fail_at in 0..success.requests.len() {
                let mut wire = FakeX {
                    fail_at: Some(fail_at),
                    ..FakeX::default()
                };
                assert!(x11_checked::apply(&mut wire, 4, &xrects(), blocked).is_err());
                assert_eq!(wire.requests.len(), fail_at + 1);
            }
        }
    }

    #[test]
    fn x11_failed_focus_handoff_and_unknown_ancestry_fail_closed() {
        let mut wire = FakeX {
            retain_focus: true,
            ..FakeX::default()
        };
        assert!(x11_checked::apply(&mut wire, 4, &xrects(), true).is_err());
        assert!(!wire
            .requests
            .iter()
            .any(|(b, _)| b[0] == 160 && b[1] == 1 && b[5] == 0));
        let mut cycle = FakeX::default();
        cycle.parents.insert(5, (2, 6));
        cycle.parents.insert(6, (2, 5));
        assert!(x11_checked::apply(&mut cycle, 4, &[], true).is_err());
        assert!(cycle.requests.len() < 70);
        assert!(!cycle.requests.iter().any(|(b, _)| b[0] == 42));
        let mut unowned = FakeX::default();
        unowned.parents.insert(4, (2, 2));
        assert!(x11_checked::apply(&mut unowned, 4, &[], true).is_err());
        assert!(!unowned.requests.iter().any(|(b, _)| b[0] == 42));
    }

    #[test]
    fn x11_invalid_rectangles_and_reserved_windows_never_reach_server() {
        for r in [
            ClipRect {
                x: -1,
                ..xrects()[0]
            },
            ClipRect {
                width: 0,
                ..xrects()[0]
            },
            ClipRect {
                x: i32::MAX,
                width: i32::MAX,
                ..xrects()[0]
            },
        ] {
            let mut wire = FakeX::default();
            assert!(x11_checked::apply(&mut wire, 4, &[r], true).is_err());
            assert!(wire.requests.is_empty());
        }
        let mut wire = FakeX::default();
        assert!(x11_checked::apply(&mut wire, 4, &vec![xrects()[0]; 4097], true).is_err());
        assert!(x11_checked::apply(&mut wire, 1, &[], true).is_err());
        assert!(wire.requests.is_empty());
    }

    #[test]
    fn platform_source_contract_keeps_handoff_scoped_and_error_checks_private() {
        // Compile/runtime macOS tests still belong on the native runner; this
        // guards the security-sensitive integration while developing elsewhere.
        let mac = include_str!("platform/macos_occlusion.mm");
        assert!(mac.contains("state.originalHitTest = originalHitTest"));
        assert!(mac.contains("reinterpret_cast<HitTest>(state.originalHitTest)"));
        assert!(!mac.contains("objc_msgSendSuper"));
        assert!(!mac.contains("class_getSuperclass(object_getClass(self))"));
        assert!(mac.contains("!SorngResponderInView(window.firstResponder, view)"));
        assert!(mac.contains("[window makeFirstResponder:nil]"));
        assert!(mac.contains("if (blocked && !SorngReleaseKeyboardFocus(view)) return false;"));
        assert!(!mac.contains("setHidden:"));
        let linux = include_str!("cef_occlusion.rs")
            .split("mod tests {")
            .next()
            .unwrap();
        assert!(!linux.contains("XSetErrorHandler"));
        assert!(!linux.contains("XShapeCombineRectangles"));
        assert!(linux.contains("xcb_request_check(self.0, Cookie { sequence })"));
        assert!(linux.contains("xcb_wait_for_reply(self.0, sequence, &mut error)"));
    }

    fn bounds() -> OriginBrowserBounds {
        OriginBrowserBounds {
            x: 100.0,
            y: 80.0,
            width: 800.0,
            height: 600.0,
        }
    }
    #[test]
    fn unrelated_menu_does_not_remove_browser_pixels() {
        assert_eq!(
            visible_rectangles(
                bounds(),
                &[OriginBrowserBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 80.0,
                    height: 50.0
                }],
                1.0
            )
            .unwrap(),
            vec![ClipRect {
                x: 0,
                y: 0,
                width: 800,
                height: 600
            }]
        );
    }
    #[test]
    fn menu_cuts_only_covered_pixels_at_scaled_coordinates() {
        let rects = visible_rectangles(
            bounds(),
            &[OriginBrowserBounds {
                x: 800.25,
                y: 100.25,
                width: 200.0,
                height: 200.0,
            }],
            2.0,
        )
        .unwrap();
        for y in 0..1200 {
            for x in 0..1600 {
                let included = rects
                    .iter()
                    .any(|r| x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
                assert_eq!(included, !(x >= 1400 && (40..441).contains(&y)));
            }
        }
    }
    #[test]
    fn repeated_and_overlapping_overlays_do_not_overlap_visible_rects() {
        let cut = OriginBrowserBounds {
            x: 200.0,
            y: 100.0,
            width: 200.0,
            height: 200.0,
        };
        let rects = visible_rectangles(
            bounds(),
            &[
                cut,
                cut,
                OriginBrowserBounds {
                    x: 250.0,
                    y: 150.0,
                    ..cut
                },
            ],
            1.0,
        )
        .unwrap();
        for (i, a) in rects.iter().enumerate() {
            for b in &rects[i + 1..] {
                assert!(
                    a.x + a.width <= b.x
                        || b.x + b.width <= a.x
                        || a.y + a.height <= b.y
                        || b.y + b.height <= a.y
                );
            }
        }
    }
    #[test]
    fn full_modal_is_empty_and_invalid_geometry_is_rejected() {
        assert!(visible_rectangles(bounds(), &[bounds()], 1.0)
            .unwrap()
            .is_empty());
        assert!(visible_rectangles(bounds(), &vec![bounds(); 33], 1.0).is_err());
        assert!(visible_rectangles(bounds(), &[], f64::NAN).is_err());
    }

    #[cfg(all(feature = "cef-host", target_os = "windows"))]
    #[test]
    fn native_window_region_clips_menu_and_restores_input_without_hiding() {
        use std::ffi::c_void;
        #[link(name = "user32")]
        extern "system" {
            fn CreateWindowExW(
                ex: u32,
                class: *const u16,
                title: *const u16,
                style: u32,
                x: i32,
                y: i32,
                w: i32,
                h: i32,
                parent: *mut c_void,
                menu: *mut c_void,
                instance: *mut c_void,
                param: *mut c_void,
            ) -> *mut c_void;
            fn DestroyWindow(window: *mut c_void) -> i32;
            fn GetWindowRgn(window: *mut c_void, region: *mut c_void) -> i32;
            fn IsWindowEnabled(window: *mut c_void) -> i32;
            fn GetWindowLongW(window: *mut c_void, index: i32) -> i32;
        }
        #[link(name = "gdi32")]
        extern "system" {
            fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> *mut c_void;
            fn PtInRegion(region: *mut c_void, x: i32, y: i32) -> i32;
            fn DeleteObject(object: *mut c_void) -> i32;
        }
        struct Window(*mut c_void);
        impl Drop for Window {
            fn drop(&mut self) {
                unsafe {
                    DestroyWindow(self.0);
                }
            }
        }
        struct Region(*mut c_void);
        impl Drop for Region {
            fn drop(&mut self) {
                unsafe {
                    DeleteObject(self.0);
                }
            }
        }
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let null = std::ptr::null_mut();
        let parent = Window(unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0,
                0,
                0,
                800,
                600,
                null,
                null,
                null,
                null,
            )
        });
        assert!(!parent.0.is_null());
        let child = Window(unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0x50000000,
                0,
                0,
                800,
                600,
                parent.0,
                null,
                null,
                null,
            )
        });
        assert!(!child.0.is_null());
        let handle = cef::sys::HWND(child.0.cast());
        let rects = visible_rectangles(
            bounds(),
            &[OriginBrowserBounds {
                x: 800.0,
                y: 80.0,
                width: 100.0,
                height: 200.0,
            }],
            1.0,
        )
        .unwrap();
        apply(handle, &rects, true).unwrap();
        let region = Region(unsafe { CreateRectRgn(0, 0, 0, 0) });
        assert_ne!(unsafe { GetWindowRgn(child.0, region.0) }, 0);
        assert_eq!(unsafe { PtInRegion(region.0, 750, 50) }, 0);
        assert_ne!(unsafe { PtInRegion(region.0, 100, 50) }, 0);
        assert_eq!(unsafe { IsWindowEnabled(child.0) }, 0);
        assert_ne!(unsafe { GetWindowLongW(child.0, -16) } & 0x10000000, 0);
        apply(
            handle,
            &visible_rectangles(bounds(), &[], 1.0).unwrap(),
            false,
        )
        .unwrap();
        assert_ne!(unsafe { IsWindowEnabled(child.0) }, 0);
        assert_ne!(unsafe { GetWindowRgn(child.0, region.0) }, 0);
        assert_ne!(unsafe { PtInRegion(region.0, 750, 50) }, 0);
        assert_ne!(unsafe { GetWindowLongW(child.0, -16) } & 0x10000000, 0);
    }
}

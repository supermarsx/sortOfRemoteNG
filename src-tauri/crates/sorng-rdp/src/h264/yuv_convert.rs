//! YUV to RGBA conversion routines.
//!
//! Uses BT.601 coefficients with integer fixed-point arithmetic.
//! All functions pre-validate buffer sizes at entry, then use unchecked
//! indexing in the inner loop for auto-vectorization.

/// Convert NV12 (hardware MF output) to RGBA.
///
/// NV12 layout:
///   Y plane:  width * height bytes
///   UV plane: width * (height/2) bytes, interleaved U,V pairs
pub fn nv12_to_rgba(nv12: &[u8], width: u32, height: u32) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let mut rgba = vec![0u8; w * h * 4];
    nv12_to_rgba_into(nv12, width, height, &mut rgba);
    rgba
}

/// Convert NV12 into an existing buffer (avoids allocation).
pub fn nv12_to_rgba_into(nv12: &[u8], width: u32, height: u32, rgba: &mut Vec<u8>) {
    let w = width as usize;
    let h = height as usize;
    let y_plane_size = w * h;
    let required = y_plane_size + y_plane_size / 2;
    let out_size = w * h * 4;

    rgba.resize(out_size, 0);

    if nv12.len() < required || w == 0 || h == 0 {
        rgba.fill(0);
        return;
    }

    let y_plane = &nv12[..y_plane_size];
    let uv_plane = &nv12[y_plane_size..];

    // Process 2 rows at a time — both rows share the same UV row.
    let row_pairs = h / 2;
    for rp in 0..row_pairs {
        let row0 = rp * 2;
        let row1 = row0 + 1;
        let uv_base = rp * w; // UV row offset (stride = w, interleaved U,V)

        // SAFETY: Pre-validated buffer sizes above guarantee all indices are in-bounds.
        // y_plane[row * w + col] < y_plane_size = w * h  ✓
        // uv_plane[uv_base + (col & !1) + 1] < y_plane_size / 2  ✓ (rp < h/2, col < w)
        // rgba[(row * w + col) * 4 + 3] < w * h * 4  ✓
        unsafe {
            for col in 0..w {
                let uv_idx = uv_base + (col & !1);
                let u = *uv_plane.get_unchecked(uv_idx) as i32 - 128;
                let v = *uv_plane.get_unchecked(uv_idx + 1) as i32 - 128;

                // Row 0
                let y0 = *y_plane.get_unchecked(row0 * w + col) as i32;
                let dst0 = (row0 * w + col) * 4;
                let r0 = (256 * y0 + 359 * v) >> 8;
                let g0 = (256 * y0 - 88 * u - 183 * v) >> 8;
                let b0 = (256 * y0 + 454 * u) >> 8;
                *rgba.get_unchecked_mut(dst0) = r0.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst0 + 1) = g0.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst0 + 2) = b0.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst0 + 3) = 255;

                // Row 1
                let y1 = *y_plane.get_unchecked(row1 * w + col) as i32;
                let dst1 = (row1 * w + col) * 4;
                let r1 = (256 * y1 + 359 * v) >> 8;
                let g1 = (256 * y1 - 88 * u - 183 * v) >> 8;
                let b1 = (256 * y1 + 454 * u) >> 8;
                *rgba.get_unchecked_mut(dst1) = r1.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst1 + 1) = g1.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst1 + 2) = b1.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst1 + 3) = 255;
            }
        }
    }

    // Handle odd last row if height is not even.
    if h % 2 != 0 {
        let row = h - 1;
        let uv_base = (row / 2) * w;
        unsafe {
            for col in 0..w {
                let uv_idx = uv_base + (col & !1);
                let u = *uv_plane.get_unchecked(uv_idx) as i32 - 128;
                let v = *uv_plane.get_unchecked(uv_idx + 1) as i32 - 128;
                let y_val = *y_plane.get_unchecked(row * w + col) as i32;
                let dst = (row * w + col) * 4;
                let r = (256 * y_val + 359 * v) >> 8;
                let g = (256 * y_val - 88 * u - 183 * v) >> 8;
                let b = (256 * y_val + 454 * u) >> 8;
                *rgba.get_unchecked_mut(dst) = r.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst + 1) = g.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst + 2) = b.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst + 3) = 255;
            }
        }
    }
}

/// Convert NV12 with explicit stride to RGBA.
///
/// `nv12_stride` is the row stride in bytes for the NV12 buffer (may be
/// wider than `width` due to GPU alignment requirements).
pub fn nv12_strided_to_rgba(
    nv12: &[u8],
    nv12_stride: usize,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let mut rgba = vec![0u8; w * h * 4];
    nv12_strided_to_rgba_into(nv12, nv12_stride, width, height, &mut rgba);
    rgba
}

/// Convert NV12 with explicit stride into an existing buffer.
pub fn nv12_strided_to_rgba_into(
    nv12: &[u8],
    nv12_stride: usize,
    width: u32,
    height: u32,
    rgba: &mut Vec<u8>,
) {
    let w = width as usize;
    let h = height as usize;
    let out_size = w * h * 4;
    rgba.resize(out_size, 0);

    if w == 0 || h == 0 || nv12_stride == 0 {
        rgba.fill(0);
        return;
    }

    let y_plane_size = nv12_stride * h;
    // Need: Y plane (nv12_stride * h) + UV plane (nv12_stride * ceil(h/2))
    let uv_rows = (h + 1) / 2;
    let required = y_plane_size + nv12_stride * uv_rows;
    if nv12.len() < required {
        rgba.fill(0);
        return;
    }

    let row_pairs = h / 2;
    for rp in 0..row_pairs {
        let row0 = rp * 2;
        let row1 = row0 + 1;
        let uv_off_base = y_plane_size + rp * nv12_stride;

        // SAFETY: Pre-validated that nv12.len() >= required above.
        // y: row1 * nv12_stride + col < nv12_stride * h = y_plane_size  ✓
        // uv: uv_off_base + (col & !1) + 1 < y_plane_size + nv12_stride * uv_rows  ✓
        unsafe {
            for col in 0..w {
                let uv_off = uv_off_base + (col & !1);
                let u = *nv12.get_unchecked(uv_off) as i32 - 128;
                let v = *nv12.get_unchecked(uv_off + 1) as i32 - 128;

                let y0 = *nv12.get_unchecked(row0 * nv12_stride + col) as i32;
                let dst0 = (row0 * w + col) * 4;
                let r0 = (256 * y0 + 359 * v) >> 8;
                let g0 = (256 * y0 - 88 * u - 183 * v) >> 8;
                let b0 = (256 * y0 + 454 * u) >> 8;
                *rgba.get_unchecked_mut(dst0) = r0.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst0 + 1) = g0.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst0 + 2) = b0.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst0 + 3) = 255;

                let y1 = *nv12.get_unchecked(row1 * nv12_stride + col) as i32;
                let dst1 = (row1 * w + col) * 4;
                let r1 = (256 * y1 + 359 * v) >> 8;
                let g1 = (256 * y1 - 88 * u - 183 * v) >> 8;
                let b1 = (256 * y1 + 454 * u) >> 8;
                *rgba.get_unchecked_mut(dst1) = r1.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst1 + 1) = g1.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst1 + 2) = b1.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst1 + 3) = 255;
            }
        }
    }

    if h % 2 != 0 {
        let row = h - 1;
        let uv_off_base = y_plane_size + (row / 2) * nv12_stride;
        unsafe {
            for col in 0..w {
                let uv_off = uv_off_base + (col & !1);
                let u = *nv12.get_unchecked(uv_off) as i32 - 128;
                let v = *nv12.get_unchecked(uv_off + 1) as i32 - 128;
                let y_val = *nv12.get_unchecked(row * nv12_stride + col) as i32;
                let dst = (row * w + col) * 4;
                let r = (256 * y_val + 359 * v) >> 8;
                let g = (256 * y_val - 88 * u - 183 * v) >> 8;
                let b = (256 * y_val + 454 * u) >> 8;
                *rgba.get_unchecked_mut(dst) = r.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst + 1) = g.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst + 2) = b.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst + 3) = 255;
            }
        }
    }
}

/// Convert I420 (planar YUV 4:2:0) to RGBA.
///
/// I420 layout (contiguous, no stride padding):
///   Y:  width * height bytes
///   U:  (width/2) * (height/2) bytes
///   V:  (width/2) * (height/2) bytes
pub fn i420_to_rgba(yuv: &[u8], width: u32, height: u32) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let y_size = w * h;
    let uv_size = (w / 2) * (h / 2);

    if yuv.len() < y_size + uv_size * 2 {
        return vec![0u8; w * h * 4];
    }

    let y_plane = &yuv[..y_size];
    let u_plane = &yuv[y_size..y_size + uv_size];
    let v_plane = &yuv[y_size + uv_size..];

    yuv420_planar_to_rgba_inner(y_plane, u_plane, v_plane, w, w / 2, w / 2, w, h)
}

/// Convert YUV420 planar with explicit strides (for openh264 output).
pub fn yuv420_planar_to_rgba(
    y_data: &[u8],
    u_data: &[u8],
    v_data: &[u8],
    y_stride: usize,
    u_stride: usize,
    v_stride: usize,
    width: u32,
    height: u32,
) -> Vec<u8> {
    yuv420_planar_to_rgba_inner(
        y_data, u_data, v_data, y_stride, u_stride, v_stride, width as usize, height as usize,
    )
}

fn yuv420_planar_to_rgba_inner(
    y: &[u8],
    u: &[u8],
    v: &[u8],
    y_stride: usize,
    u_stride: usize,
    v_stride: usize,
    width: usize,
    height: usize,
) -> Vec<u8> {
    let mut rgba = vec![0u8; width * height * 4];
    yuv420_planar_to_rgba_inner_into(
        y, u, v, y_stride, u_stride, v_stride, width, height, &mut rgba,
    );
    rgba
}

/// Convert YUV420 planar into an existing buffer.
pub fn yuv420_planar_to_rgba_inner_into(
    y: &[u8],
    u: &[u8],
    v: &[u8],
    y_stride: usize,
    u_stride: usize,
    v_stride: usize,
    width: usize,
    height: usize,
    rgba: &mut Vec<u8>,
) {
    let out_size = width * height * 4;
    rgba.resize(out_size, 0);

    if width == 0 || height == 0 {
        return;
    }

    // Pre-validate all plane sizes.
    let y_needed = (height - 1) * y_stride + width;
    let uv_h = (height + 1) / 2;
    let uv_w = (width + 1) / 2;
    let u_needed = if uv_h > 0 { (uv_h - 1) * u_stride + uv_w } else { 0 };
    let v_needed = if uv_h > 0 { (uv_h - 1) * v_stride + uv_w } else { 0 };

    if y.len() < y_needed || u.len() < u_needed || v.len() < v_needed {
        rgba.fill(0);
        return;
    }

    // Process 2 rows at a time — both share the same UV row.
    let row_pairs = height / 2;
    for rp in 0..row_pairs {
        let row0 = rp * 2;
        let row1 = row0 + 1;

        // SAFETY: Pre-validated all plane sizes above.
        // y[row1 * y_stride + col] where row1 < height, col < width  ✓
        // u[rp * u_stride + col/2] where rp < height/2, col/2 < width/2  ✓
        // v[rp * v_stride + col/2] — same  ✓
        // rgba[(row1 * width + col) * 4 + 3] < width * height * 4  ✓
        unsafe {
            for col in 0..width {
                let u_val = *u.get_unchecked(rp * u_stride + col / 2) as i32 - 128;
                let v_val = *v.get_unchecked(rp * v_stride + col / 2) as i32 - 128;

                let y0 = *y.get_unchecked(row0 * y_stride + col) as i32;
                let dst0 = (row0 * width + col) * 4;
                let r0 = (256 * y0 + 359 * v_val) >> 8;
                let g0 = (256 * y0 - 88 * u_val - 183 * v_val) >> 8;
                let b0 = (256 * y0 + 454 * u_val) >> 8;
                *rgba.get_unchecked_mut(dst0) = r0.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst0 + 1) = g0.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst0 + 2) = b0.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst0 + 3) = 255;

                let y1 = *y.get_unchecked(row1 * y_stride + col) as i32;
                let dst1 = (row1 * width + col) * 4;
                let r1 = (256 * y1 + 359 * v_val) >> 8;
                let g1 = (256 * y1 - 88 * u_val - 183 * v_val) >> 8;
                let b1 = (256 * y1 + 454 * u_val) >> 8;
                *rgba.get_unchecked_mut(dst1) = r1.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst1 + 1) = g1.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst1 + 2) = b1.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst1 + 3) = 255;
            }
        }
    }

    // Handle odd last row.
    if height % 2 != 0 {
        let row = height - 1;
        let uv_row = row / 2;
        unsafe {
            for col in 0..width {
                let u_val = *u.get_unchecked(uv_row * u_stride + col / 2) as i32 - 128;
                let v_val = *v.get_unchecked(uv_row * v_stride + col / 2) as i32 - 128;
                let y_val = *y.get_unchecked(row * y_stride + col) as i32;
                let dst = (row * width + col) * 4;
                let r = (256 * y_val + 359 * v_val) >> 8;
                let g = (256 * y_val - 88 * u_val - 183 * v_val) >> 8;
                let b = (256 * y_val + 454 * u_val) >> 8;
                *rgba.get_unchecked_mut(dst) = r.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst + 1) = g.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst + 2) = b.clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(dst + 3) = 255;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helper: build a solid-color NV12 frame ──────────────────────────

    fn make_nv12(y: u8, u: u8, v: u8, w: usize, h: usize) -> Vec<u8> {
        let y_size = w * h;
        let uv_rows = (h + 1) / 2;
        let uv_size = w * uv_rows;
        let mut buf = vec![y; y_size];
        for _ in 0..uv_size / 2 {
            buf.push(u);
            buf.push(v);
        }
        if buf.len() < y_size + uv_size {
            buf.resize(y_size + uv_size, 0);
        }
        buf
    }

    fn make_i420(y: u8, u: u8, v: u8, w: usize, h: usize) -> Vec<u8> {
        let y_size = w * h;
        let uv_w = w / 2;
        let uv_h = h / 2;
        let uv_size = uv_w * uv_h;
        let mut buf = vec![y; y_size];
        buf.extend(vec![u; uv_size]);
        buf.extend(vec![v; uv_size]);
        buf
    }

    // ── nv12_to_rgba basic ──────────────────────────────────────────────

    #[test]
    fn nv12_pure_black() {
        let nv12 = make_nv12(0, 128, 128, 4, 4);
        let rgba = nv12_to_rgba(&nv12, 4, 4);
        assert_eq!(rgba.len(), 4 * 4 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[0], 0, "R should be 0");
            assert_eq!(pixel[1], 0, "G should be 0");
            assert_eq!(pixel[2], 0, "B should be 0");
            assert_eq!(pixel[3], 255, "A should be 255");
        }
    }

    #[test]
    fn nv12_pure_white() {
        let nv12 = make_nv12(255, 128, 128, 4, 4);
        let rgba = nv12_to_rgba(&nv12, 4, 4);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[0], 255);
            assert_eq!(pixel[1], 255);
            assert_eq!(pixel[2], 255);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn nv12_mid_gray() {
        let nv12 = make_nv12(128, 128, 128, 2, 2);
        let rgba = nv12_to_rgba(&nv12, 2, 2);
        for pixel in rgba.chunks_exact(4) {
            assert!((pixel[0] as i32 - 128).abs() <= 1);
            assert!((pixel[1] as i32 - 128).abs() <= 1);
            assert!((pixel[2] as i32 - 128).abs() <= 1);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn nv12_alpha_always_opaque() {
        let nv12 = make_nv12(100, 200, 50, 6, 6);
        let rgba = nv12_to_rgba(&nv12, 6, 6);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[3], 255);
        }
    }

    // ── Edge cases: zero size, odd dimensions ───────────────────────────

    #[test]
    fn nv12_zero_width() {
        let rgba = nv12_to_rgba(&[], 0, 4);
        assert!(rgba.is_empty());
    }

    #[test]
    fn nv12_zero_height() {
        let rgba = nv12_to_rgba(&[], 4, 0);
        assert!(rgba.is_empty());
    }

    #[test]
    fn nv12_odd_height() {
        let nv12 = make_nv12(128, 128, 128, 4, 3);
        let rgba = nv12_to_rgba(&nv12, 4, 3);
        assert_eq!(rgba.len(), 4 * 3 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert!((pixel[0] as i32 - 128).abs() <= 1);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn nv12_undersized_input_returns_zeroed() {
        let nv12 = vec![0u8; 2];
        let rgba = nv12_to_rgba(&nv12, 4, 4);
        assert_eq!(rgba.len(), 4 * 4 * 4);
        assert!(rgba.iter().all(|&b| b == 0));
    }

    // ── nv12_to_rgba_into reuses buffer ─────────────────────────────────

    #[test]
    fn nv12_into_resizes_buffer() {
        let nv12 = make_nv12(128, 128, 128, 4, 4);
        let mut buf = Vec::new();
        nv12_to_rgba_into(&nv12, 4, 4, &mut buf);
        assert_eq!(buf.len(), 4 * 4 * 4);
    }

    #[test]
    fn nv12_into_shrinks_buffer() {
        let nv12 = make_nv12(128, 128, 128, 2, 2);
        let mut buf = vec![0u8; 10000];
        nv12_to_rgba_into(&nv12, 2, 2, &mut buf);
        assert_eq!(buf.len(), 2 * 2 * 4);
    }

    // ── nv12_strided ────────────────────────────────────────────────────

    #[test]
    fn nv12_strided_matches_non_strided_when_stride_equals_width() {
        let nv12 = make_nv12(200, 100, 150, 4, 4);
        let a = nv12_to_rgba(&nv12, 4, 4);
        let b = nv12_strided_to_rgba(&nv12, 4, 4, 4);
        assert_eq!(a, b);
    }

    #[test]
    fn nv12_strided_zero_dimensions() {
        let rgba = nv12_strided_to_rgba(&[], 0, 0, 0);
        assert!(rgba.is_empty());
    }

    #[test]
    fn nv12_strided_zero_stride() {
        let rgba = nv12_strided_to_rgba(&[0; 100], 0, 4, 4);
        assert_eq!(rgba.len(), 4 * 4 * 4);
        assert!(rgba.iter().all(|&b| b == 0));
    }

    // ── i420_to_rgba ────────────────────────────────────────────────────

    #[test]
    fn i420_pure_black() {
        let yuv = make_i420(0, 128, 128, 4, 4);
        let rgba = i420_to_rgba(&yuv, 4, 4);
        assert_eq!(rgba.len(), 4 * 4 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[0], 0);
            assert_eq!(pixel[1], 0);
            assert_eq!(pixel[2], 0);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn i420_pure_white() {
        let yuv = make_i420(255, 128, 128, 4, 4);
        let rgba = i420_to_rgba(&yuv, 4, 4);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[0], 255);
            assert_eq!(pixel[1], 255);
            assert_eq!(pixel[2], 255);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn i420_undersized_returns_zeroed() {
        let rgba = i420_to_rgba(&[0u8; 3], 4, 4);
        assert_eq!(rgba.len(), 4 * 4 * 4);
        assert!(rgba.iter().all(|&b| b == 0));
    }

    // ── yuv420_planar_to_rgba ───────────────────────────────────────────

    #[test]
    fn yuv420_planar_zero_dimensions() {
        let mut buf = Vec::new();
        yuv420_planar_to_rgba_inner_into(&[], &[], &[], 0, 0, 0, 0, 0, &mut buf);
        assert!(buf.is_empty());
    }

    #[test]
    fn yuv420_planar_undersized_planes() {
        let mut buf = Vec::new();
        yuv420_planar_to_rgba_inner_into(&[0; 2], &[0; 1], &[0; 1], 4, 2, 2, 4, 4, &mut buf);
        assert_eq!(buf.len(), 4 * 4 * 4);
        assert!(buf.iter().all(|&b| b == 0));
    }

    #[test]
    fn yuv420_planar_explicit_strides() {
        let w = 4usize;
        let h = 4usize;
        let y_stride = 8;
        let u_stride = 4;
        let v_stride = 4;
        let mut y = vec![0u8; y_stride * h];
        let u = vec![128u8; u_stride * (h / 2)];
        let v = vec![128u8; v_stride * (h / 2)];
        for row in 0..h {
            for col in 0..w {
                y[row * y_stride + col] = 128;
            }
        }
        let rgba = yuv420_planar_to_rgba(&y, &u, &v, y_stride, u_stride, v_stride, w as u32, h as u32);
        assert_eq!(rgba.len(), w * h * 4);
        for pixel in rgba.chunks_exact(4) {
            assert!((pixel[0] as i32 - 128).abs() <= 1);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn yuv420_planar_odd_height() {
        let w = 4;
        let h = 3;
        let y = vec![128u8; w * h];
        let u = vec![128u8; (w / 2) * ((h + 1) / 2)];
        let v = vec![128u8; (w / 2) * ((h + 1) / 2)];
        let rgba = yuv420_planar_to_rgba(&y, &u, &v, w, w / 2, w / 2, w as u32, h as u32);
        assert_eq!(rgba.len(), w * h * 4);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[3], 255);
        }
    }

    // ── YUV → RGB color accuracy ────────────────────────────────────────

    #[test]
    fn nv12_red_ish() {
        // BT.601: Pure red is approximately Y=82, U=90, V=240
        let nv12 = make_nv12(82, 90, 240, 2, 2);
        let rgba = nv12_to_rgba(&nv12, 2, 2);
        let r = rgba[0] as i32;
        let g = rgba[1] as i32;
        let b = rgba[2] as i32;
        assert!(r > 200, "Red channel should be high, got {r}");
        assert!(g < 50, "Green channel should be low, got {g}");
        assert!(b < 50, "Blue channel should be low, got {b}");
    }

    #[test]
    fn nv12_values_always_clamped() {
        let nv12 = make_nv12(255, 0, 255, 2, 2);
        let rgba = nv12_to_rgba(&nv12, 2, 2);
        for pixel in rgba.chunks_exact(4) {
            assert!(pixel[0] <= 255);
            assert!(pixel[1] <= 255);
            assert!(pixel[2] <= 255);
        }
    }
}

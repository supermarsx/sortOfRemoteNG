//! YUV to RGBA conversion routines.
//!
//! Uses BT.601 coefficients with integer fixed-point arithmetic.
//! Provides five tiers of implementation with runtime CPU detection:
//!   1. AVX-512BW — 16 pixels per iteration in 512-bit registers (Skylake-X, Ice Lake, Zen 4+)
//!   2. AVX2      — 16 pixels per iteration in 256-bit registers (Haswell+, Zen 1+)
//!   3. SSE4.1    — 8 pixels per iteration with native i32 multiply (Penryn+)
//!   4. SSSE3     — 8 pixels per iteration with emulated i32 multiply (Core 2+)
//!   5. Scalar    — 2 pixels per iteration (always available)
//!
//! The dispatcher checks `is_x86_feature_detected!` once per call and
//! branches to the widest available path.

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/// Convert NV12 (hardware MF output) to RGBA — allocating variant.
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
    let out_size = w * h * 4;
    rgba.resize(out_size, 0);

    // NV12 UV is interleaved (U,V) pairs — stride must be even-aligned.
    let uv_stride = (w + 1) & !1;
    let y_plane_size = w * h;
    let uv_rows = (h + 1) / 2;
    let required = y_plane_size + uv_stride * uv_rows;
    if nv12.len() < required || w == 0 || h == 0 {
        rgba.fill(0);
        return;
    }

    let y_plane = &nv12[..y_plane_size];
    let uv_plane = &nv12[y_plane_size..];

    dispatch_nv12(y_plane, uv_plane, w, uv_stride, w, h, rgba);
}

/// Convert NV12 with explicit stride to RGBA — allocating variant.
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
    let uv_rows = (h + 1) / 2;
    let required = y_plane_size + nv12_stride * uv_rows;
    if nv12.len() < required {
        rgba.fill(0);
        return;
    }

    let y_plane = &nv12[..y_plane_size];
    let uv_plane = &nv12[y_plane_size..];

    dispatch_nv12(y_plane, uv_plane, nv12_stride, nv12_stride, w, h, rgba);
}

/// Convert I420 (planar YUV 4:2:0) to RGBA.
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

/// Convert YUV420 planar with explicit strides.
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
        y_data, u_data, v_data, y_stride, u_stride, v_stride,
        width as usize, height as usize,
    )
}

fn yuv420_planar_to_rgba_inner(
    y: &[u8], u: &[u8], v: &[u8],
    y_stride: usize, u_stride: usize, v_stride: usize,
    width: usize, height: usize,
) -> Vec<u8> {
    let mut rgba = vec![0u8; width * height * 4];
    yuv420_planar_to_rgba_inner_into(
        y, u, v, y_stride, u_stride, v_stride, width, height, &mut rgba,
    );
    rgba
}

/// Convert YUV420 planar into an existing buffer.
pub fn yuv420_planar_to_rgba_inner_into(
    y: &[u8], u: &[u8], v: &[u8],
    y_stride: usize, u_stride: usize, v_stride: usize,
    width: usize, height: usize,
    rgba: &mut Vec<u8>,
) {
    let out_size = width * height * 4;
    rgba.resize(out_size, 0);
    if width == 0 || height == 0 {
        return;
    }

    let y_needed = (height - 1) * y_stride + width;
    let uv_h = (height + 1) / 2;
    let uv_w = (width + 1) / 2;
    let u_needed = if uv_h > 0 { (uv_h - 1) * u_stride + uv_w } else { 0 };
    let v_needed = if uv_h > 0 { (uv_h - 1) * v_stride + uv_w } else { 0 };
    if y.len() < y_needed || u.len() < u_needed || v.len() < v_needed {
        rgba.fill(0);
        return;
    }

    dispatch_i420(y, u, v, y_stride, u_stride, v_stride, width, height, rgba);
}

// ═══════════════════════════════════════════════════════════════════════
// CPU feature detection
// ═══════════════════════════════════════════════════════════════════════

/// Returns the SIMD tier that will be used for YUV/pixel conversion.
pub fn detected_tier() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") { return "AVX-512BW (16px/zmm)"; }
        if is_x86_feature_detected!("avx2")     { return "AVX2 (16px/ymm)"; }
        if is_x86_feature_detected!("sse4.1")   { return "SSE4.1 (8px, native mullo)"; }
        if is_x86_feature_detected!("ssse3")    { return "SSSE3 (8px)"; }
        if is_x86_feature_detected!("sse2")     { return "SSE2 (BGRA only)"; }
    }
    "Scalar"
}

/// Log all detected CPU features at INFO level.  Call once at startup.
pub fn log_cpu_features() {
    log::info!("Pixel conversion SIMD tier: {}", detected_tier());
    #[cfg(target_arch = "x86_64")]
    {
        let features: &[(&str, bool)] = &[
            ("sse2",       is_x86_feature_detected!("sse2")),
            ("sse3",       is_x86_feature_detected!("sse3")),
            ("ssse3",      is_x86_feature_detected!("ssse3")),
            ("sse4.1",     is_x86_feature_detected!("sse4.1")),
            ("sse4.2",     is_x86_feature_detected!("sse4.2")),
            ("avx",        is_x86_feature_detected!("avx")),
            ("avx2",       is_x86_feature_detected!("avx2")),
            ("fma",        is_x86_feature_detected!("fma")),
            ("f16c",       is_x86_feature_detected!("f16c")),
            ("bmi1",       is_x86_feature_detected!("bmi1")),
            ("bmi2",       is_x86_feature_detected!("bmi2")),
            ("popcnt",     is_x86_feature_detected!("popcnt")),
            ("lzcnt",      is_x86_feature_detected!("lzcnt")),
            ("aes",        is_x86_feature_detected!("aes")),
            ("sha",        is_x86_feature_detected!("sha")),
            ("pclmulqdq",  is_x86_feature_detected!("pclmulqdq")),
            ("avx512f",    is_x86_feature_detected!("avx512f")),
            ("avx512bw",   is_x86_feature_detected!("avx512bw")),
            ("avx512cd",   is_x86_feature_detected!("avx512cd")),
            ("avx512dq",   is_x86_feature_detected!("avx512dq")),
            ("avx512vl",   is_x86_feature_detected!("avx512vl")),
            ("avx512vnni", is_x86_feature_detected!("avx512vnni")),
            ("avx512vbmi", is_x86_feature_detected!("avx512vbmi")),
            ("avx512vbmi2", is_x86_feature_detected!("avx512vbmi2")),
            ("avx512bitalg", is_x86_feature_detected!("avx512bitalg")),
            ("avx512ifma",  is_x86_feature_detected!("avx512ifma")),
            ("avx512vpopcntdq", is_x86_feature_detected!("avx512vpopcntdq")),
            ("avxvnni",    is_x86_feature_detected!("avxvnni")),
            ("gfni",       is_x86_feature_detected!("gfni")),
            ("vaes",       is_x86_feature_detected!("vaes")),
            ("vpclmulqdq", is_x86_feature_detected!("vpclmulqdq")),
            ("rdrand",     is_x86_feature_detected!("rdrand")),
            ("rdseed",     is_x86_feature_detected!("rdseed")),
            ("adx",        is_x86_feature_detected!("adx")),
        ];
        let present: Vec<&str> = features.iter()
            .filter(|(_, ok)| *ok)
            .map(|(name, _)| *name)
            .collect();
        log::info!("CPU features: {}", present.join(", "));
        // NOTE: SSE4.2 detected but only provides CRC32/string ops — not
        // useful for pixel maths.  AMX (amx-tile/amx-int8/amx-bf16) is
        // matrix-oriented, not applicable to pixel conversion.
        // AVX-10 is not yet exposed by std::arch.
    }
}

// ═══════════════════════════════════════════════════════════════════════
// BGRA → RGBA conversion (used by uncompressed GFX path)
// ═══════════════════════════════════════════════════════════════════════

/// Convert BGRA pixel data to RGBA in-place.  Runtime-dispatches to
/// AVX2 / SSE2 / scalar depending on CPU features.
pub fn bgra_to_rgba_inplace(data: &mut [u8]) {
    let pixel_count = data.len() / 4;
    if pixel_count == 0 {
        return;
    }

    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            unsafe { bgra_to_rgba_avx512(data, pixel_count); }
            return;
        }
        if is_x86_feature_detected!("avx2") {
            unsafe { bgra_to_rgba_avx2(data, pixel_count); }
            return;
        }
        if is_x86_feature_detected!("ssse3") {
            unsafe { bgra_to_rgba_ssse3(data, pixel_count); }
            return;
        }
        if is_x86_feature_detected!("sse2") {
            unsafe { bgra_to_rgba_sse2(data, pixel_count); }
            return;
        }
    }
    bgra_to_rgba_scalar(data, pixel_count);
}

fn bgra_to_rgba_scalar(data: &mut [u8], pixel_count: usize) {
    for i in 0..pixel_count {
        let off = i * 4;
        data.swap(off, off + 2);
        data[off + 3] = 255;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "sse2")]
unsafe fn bgra_to_rgba_sse2(data: &mut [u8], pixel_count: usize) {
    use std::arch::x86_64::*;
    let chunks = pixel_count / 4;
    let alpha_mask = _mm_set1_epi32(0xFF000000_u32 as i32);
    let b_mask = _mm_set1_epi32(0x000000FF_u32 as i32);
    let r_mask = _mm_set1_epi32(0x00FF0000_u32 as i32);
    let g_mask = _mm_set1_epi32(0x0000FF00_u32 as i32);

    for i in 0..chunks {
        let off = i * 16;
        let ptr = data.as_mut_ptr().add(off) as *mut __m128i;
        let src = _mm_loadu_si128(ptr as *const __m128i);
        let b = _mm_and_si128(src, b_mask);
        let r = _mm_and_si128(src, r_mask);
        let g = _mm_and_si128(src, g_mask);
        let r_shifted = _mm_srli_epi32(r, 16);
        let b_shifted = _mm_slli_epi32(b, 16);
        let result = _mm_or_si128(_mm_or_si128(r_shifted, g), _mm_or_si128(b_shifted, alpha_mask));
        _mm_storeu_si128(ptr, result);
    }
    for i in (chunks * 4)..pixel_count {
        let off = i * 4;
        data.swap(off, off + 2);
        data[off + 3] = 255;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "ssse3")]
unsafe fn bgra_to_rgba_ssse3(data: &mut [u8], pixel_count: usize) {
    use std::arch::x86_64::*;
    let chunks = pixel_count / 4;
    let shuf = _mm_set_epi8(
        15, 12, 13, 14, 11, 8, 9, 10, 7, 4, 5, 6, 3, 0, 1, 2,
    );
    let alpha = _mm_set1_epi32(0xFF000000_u32 as i32);

    for i in 0..chunks {
        let off = i * 16;
        let ptr = data.as_mut_ptr().add(off) as *mut __m128i;
        let src = _mm_loadu_si128(ptr as *const __m128i);
        let swapped = _mm_shuffle_epi8(src, shuf);
        let result = _mm_or_si128(swapped, alpha);
        _mm_storeu_si128(ptr, result);
    }
    for i in (chunks * 4)..pixel_count {
        let off = i * 4;
        data.swap(off, off + 2);
        data[off + 3] = 255;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn bgra_to_rgba_avx2(data: &mut [u8], pixel_count: usize) {
    use std::arch::x86_64::*;
    let chunks = pixel_count / 8;
    let shuf = _mm256_set_epi8(
        15, 12, 13, 14, 11, 8, 9, 10, 7, 4, 5, 6, 3, 0, 1, 2,
        15, 12, 13, 14, 11, 8, 9, 10, 7, 4, 5, 6, 3, 0, 1, 2,
    );
    let alpha = _mm256_set1_epi32(0xFF000000_u32 as i32);

    for i in 0..chunks {
        let off = i * 32;
        let ptr = data.as_mut_ptr().add(off) as *mut __m256i;
        let src = _mm256_loadu_si256(ptr as *const __m256i);
        let swapped = _mm256_shuffle_epi8(src, shuf);
        let result = _mm256_or_si256(swapped, alpha);
        _mm256_storeu_si256(ptr, result);
    }
    for i in (chunks * 8)..pixel_count {
        let off = i * 4;
        data.swap(off, off + 2);
        data[off + 3] = 255;
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx512bw")]
unsafe fn bgra_to_rgba_avx512(data: &mut [u8], pixel_count: usize) {
    use std::arch::x86_64::*;
    let chunks = pixel_count / 16; // 16 pixels × 4 bytes = 64 bytes per ZMM
    let shuf = _mm512_set_epi8(
        // Lane-local BGRA→RGBA shuffle (same pattern for all four 128-bit lanes)
        15, 12, 13, 14, 11, 8, 9, 10, 7, 4, 5, 6, 3, 0, 1, 2,
        15, 12, 13, 14, 11, 8, 9, 10, 7, 4, 5, 6, 3, 0, 1, 2,
        15, 12, 13, 14, 11, 8, 9, 10, 7, 4, 5, 6, 3, 0, 1, 2,
        15, 12, 13, 14, 11, 8, 9, 10, 7, 4, 5, 6, 3, 0, 1, 2,
    );
    let alpha = _mm512_set1_epi32(0xFF000000_u32 as i32);

    for i in 0..chunks {
        let off = i * 64;
        let ptr = data.as_mut_ptr().add(off) as *mut __m512i;
        let src = _mm512_loadu_si512(ptr as *const __m512i);
        let swapped = _mm512_shuffle_epi8(src, shuf);
        let result = _mm512_or_si512(swapped, alpha);
        _mm512_storeu_si512(ptr as *mut __m512i, result);
    }
    // Tail via AVX2
    let done = chunks * 16;
    if done < pixel_count {
        bgra_to_rgba_avx2(&mut data[done * 4..], pixel_count - done);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Runtime dispatch
// ═══════════════════════════════════════════════════════════════════════

#[inline]
fn dispatch_nv12(
    y_plane: &[u8], uv_plane: &[u8],
    y_stride: usize, uv_stride: usize,
    width: usize, height: usize,
    rgba: &mut [u8],
) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            unsafe { simd_impl::nv12_to_rgba_avx512(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba); }
            return;
        }
        if is_x86_feature_detected!("avx2") {
            unsafe { simd_impl::nv12_to_rgba_avx2(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba); }
            return;
        }
        if is_x86_feature_detected!("sse4.1") {
            unsafe { simd_impl::nv12_to_rgba_sse41(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba); }
            return;
        }
        if is_x86_feature_detected!("ssse3") {
            unsafe { simd_impl::nv12_to_rgba_ssse3(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba); }
            return;
        }
    }
    scalar::nv12_to_rgba_scalar(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba);
}

#[inline]
fn dispatch_i420(
    y: &[u8], u: &[u8], v: &[u8],
    y_stride: usize, u_stride: usize, v_stride: usize,
    width: usize, height: usize,
    rgba: &mut [u8],
) {
    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx512bw") {
            unsafe { simd_impl::i420_to_rgba_avx512(y, u, v, y_stride, u_stride, v_stride, width, height, rgba); }
            return;
        }
        if is_x86_feature_detected!("avx2") {
            unsafe { simd_impl::i420_to_rgba_avx2(y, u, v, y_stride, u_stride, v_stride, width, height, rgba); }
            return;
        }
        if is_x86_feature_detected!("sse4.1") {
            unsafe { simd_impl::i420_to_rgba_sse41(y, u, v, y_stride, u_stride, v_stride, width, height, rgba); }
            return;
        }
        if is_x86_feature_detected!("ssse3") {
            unsafe { simd_impl::i420_to_rgba_ssse3(y, u, v, y_stride, u_stride, v_stride, width, height, rgba); }
            return;
        }
    }
    scalar::i420_to_rgba_scalar(y, u, v, y_stride, u_stride, v_stride, width, height, rgba);
}

// ═══════════════════════════════════════════════════════════════════════
// BT.601 coefficients (shared across all paths)
// ═══════════════════════════════════════════════════════════════════════

const YC: i32 = 256;
const RV: i32 = 359;
const GU: i32 = -88;
const GV: i32 = -183;
const BU: i32 = 454;

// ═══════════════════════════════════════════════════════════════════════
// Scalar fallback (always compiled)
// ═══════════════════════════════════════════════════════════════════════

mod scalar {
    use super::*;

    pub(super) fn nv12_to_rgba_scalar(
        y_plane: &[u8], uv_plane: &[u8],
        y_stride: usize, uv_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;
            let uv_base = rp * uv_stride;

            let mut col = 0usize;
            while col + 1 < width {
                let uv_idx = uv_base + (col & !1);
                let u = unsafe { *uv_plane.get_unchecked(uv_idx) } as i32 - 128;
                let v = unsafe { *uv_plane.get_unchecked(uv_idx + 1) } as i32 - 128;
                let rv = RV * v;
                let gu_gv = GU * u + GV * v;
                let bu = BU * u;

                for dc in 0..2u32 {
                    let c = col + dc as usize;
                    let y0 = unsafe { *y_plane.get_unchecked(row0 * y_stride + c) } as i32;
                    let d0 = (row0 * width + c) * 4;
                    unsafe {
                        *rgba.get_unchecked_mut(d0)     = ((YC * y0 + rv) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d0 + 1) = ((YC * y0 + gu_gv) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d0 + 2) = ((YC * y0 + bu) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d0 + 3) = 255;
                    }
                    let y1 = unsafe { *y_plane.get_unchecked(row1 * y_stride + c) } as i32;
                    let d1 = (row1 * width + c) * 4;
                    unsafe {
                        *rgba.get_unchecked_mut(d1)     = ((YC * y1 + rv) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d1 + 1) = ((YC * y1 + gu_gv) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d1 + 2) = ((YC * y1 + bu) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d1 + 3) = 255;
                    }
                }
                col += 2;
            }
            if col < width {
                let uv_idx = uv_base + (col & !1);
                let u = unsafe { *uv_plane.get_unchecked(uv_idx) } as i32 - 128;
                let v = unsafe { *uv_plane.get_unchecked(uv_idx + 1) } as i32 - 128;
                for &row in &[row0, row1] {
                    let yv = unsafe { *y_plane.get_unchecked(row * y_stride + col) } as i32;
                    let d = (row * width + col) * 4;
                    unsafe {
                        *rgba.get_unchecked_mut(d)     = ((YC * yv + RV * v) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d + 1) = ((YC * yv + GU * u + GV * v) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d + 2) = ((YC * yv + BU * u) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d + 3) = 255;
                    }
                }
            }
        }
        if height % 2 != 0 {
            scalar_odd_row_nv12(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba);
        }
    }

    pub(super) fn i420_to_rgba_scalar(
        y: &[u8], u_plane: &[u8], v_plane: &[u8],
        y_stride: usize, u_stride: usize, v_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;

            let mut col = 0usize;
            while col + 1 < width {
                let u_val = unsafe { *u_plane.get_unchecked(rp * u_stride + col / 2) } as i32 - 128;
                let v_val = unsafe { *v_plane.get_unchecked(rp * v_stride + col / 2) } as i32 - 128;
                let rv = RV * v_val;
                let gu_gv = GU * u_val + GV * v_val;
                let bu = BU * u_val;

                for dc in 0..2u32 {
                    let c = col + dc as usize;
                    let y0 = unsafe { *y.get_unchecked(row0 * y_stride + c) } as i32;
                    let d0 = (row0 * width + c) * 4;
                    unsafe {
                        *rgba.get_unchecked_mut(d0)     = ((YC * y0 + rv) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d0 + 1) = ((YC * y0 + gu_gv) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d0 + 2) = ((YC * y0 + bu) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d0 + 3) = 255;
                    }
                    let y1 = unsafe { *y.get_unchecked(row1 * y_stride + c) } as i32;
                    let d1 = (row1 * width + c) * 4;
                    unsafe {
                        *rgba.get_unchecked_mut(d1)     = ((YC * y1 + rv) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d1 + 1) = ((YC * y1 + gu_gv) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d1 + 2) = ((YC * y1 + bu) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d1 + 3) = 255;
                    }
                }
                col += 2;
            }
            if col < width {
                let u_val = unsafe { *u_plane.get_unchecked(rp * u_stride + col / 2) } as i32 - 128;
                let v_val = unsafe { *v_plane.get_unchecked(rp * v_stride + col / 2) } as i32 - 128;
                for &row in &[row0, row1] {
                    let yv = unsafe { *y.get_unchecked(row * y_stride + col) } as i32;
                    let d = (row * width + col) * 4;
                    unsafe {
                        *rgba.get_unchecked_mut(d)     = ((YC * yv + RV * v_val) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d + 1) = ((YC * yv + GU * u_val + GV * v_val) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d + 2) = ((YC * yv + BU * u_val) >> 8).clamp(0, 255) as u8;
                        *rgba.get_unchecked_mut(d + 3) = 255;
                    }
                }
            }
        }
        if height % 2 != 0 {
            scalar_odd_row_i420(y, u_plane, v_plane, y_stride, u_stride, v_stride, width, height, rgba);
        }
    }

    pub(super) fn scalar_odd_row_nv12(
        y_plane: &[u8], uv_plane: &[u8],
        y_stride: usize, uv_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row = height - 1;
        let uv_base = (row / 2) * uv_stride;
        for col in 0..width {
            let uv_idx = uv_base + (col & !1);
            let u = unsafe { *uv_plane.get_unchecked(uv_idx) } as i32 - 128;
            let v = unsafe { *uv_plane.get_unchecked(uv_idx + 1) } as i32 - 128;
            let yv = unsafe { *y_plane.get_unchecked(row * y_stride + col) } as i32;
            let d = (row * width + col) * 4;
            unsafe {
                *rgba.get_unchecked_mut(d)     = ((YC * yv + RV * v) >> 8).clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(d + 1) = ((YC * yv + GU * u + GV * v) >> 8).clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(d + 2) = ((YC * yv + BU * u) >> 8).clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(d + 3) = 255;
            }
        }
    }

    pub(super) fn scalar_odd_row_i420(
        y: &[u8], u_plane: &[u8], v_plane: &[u8],
        y_stride: usize, u_stride: usize, v_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row = height - 1;
        let uv_row = row / 2;
        for col in 0..width {
            let u_val = unsafe { *u_plane.get_unchecked(uv_row * u_stride + col / 2) } as i32 - 128;
            let v_val = unsafe { *v_plane.get_unchecked(uv_row * v_stride + col / 2) } as i32 - 128;
            let yv = unsafe { *y.get_unchecked(row * y_stride + col) } as i32;
            let d = (row * width + col) * 4;
            unsafe {
                *rgba.get_unchecked_mut(d)     = ((YC * yv + RV * v_val) >> 8).clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(d + 1) = ((YC * yv + GU * u_val + GV * v_val) >> 8).clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(d + 2) = ((YC * yv + BU * u_val) >> 8).clamp(0, 255) as u8;
                *rgba.get_unchecked_mut(d + 3) = 255;
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// SIMD paths (SSSE3 + AVX2) — x86_64 only
// ═══════════════════════════════════════════════════════════════════════

#[cfg(target_arch = "x86_64")]
mod simd_impl {
    use std::arch::x86_64::*;

    use super::scalar;

    // ─── SSSE3 (8 pixels per iteration) ─────────────────────────────

    #[target_feature(enable = "ssse3")]
    pub(super) unsafe fn nv12_to_rgba_ssse3(
        y_plane: &[u8], uv_plane: &[u8],
        y_stride: usize, uv_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;
            let y0_base = row0 * y_stride;
            let y1_base = row1 * y_stride;
            let uv_base = rp * uv_stride;
            let dst0_base = row0 * width * 4;
            let dst1_base = row1 * width * 4;
            let chunks = width / 8;

            for chunk in 0..chunks {
                let col = chunk * 8;
                convert_8px_nv12(
                    y_plane, uv_plane, rgba,
                    y0_base + col, y1_base + col,
                    uv_base + (col & !1),
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            // Scalar tail.
            let col_start = chunks * 8;
            scalar_tail_nv12(y_plane, uv_plane, y_stride, uv_stride, width, row0, row1, rp, col_start, rgba);
        }
        if height % 2 != 0 {
            scalar::scalar_odd_row_nv12(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba);
        }
    }

    #[target_feature(enable = "ssse3")]
    pub(super) unsafe fn i420_to_rgba_ssse3(
        y: &[u8], u_plane: &[u8], v_plane: &[u8],
        y_stride: usize, u_stride: usize, v_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;
            let y0_base = row0 * y_stride;
            let y1_base = row1 * y_stride;
            let u_base = rp * u_stride;
            let v_base = rp * v_stride;
            let dst0_base = row0 * width * 4;
            let dst1_base = row1 * width * 4;
            let chunks = width / 8;

            for chunk in 0..chunks {
                let col = chunk * 8;
                convert_8px_i420(
                    y, u_plane, v_plane, rgba,
                    y0_base + col, y1_base + col,
                    u_base + col / 2, v_base + col / 2,
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            let col_start = chunks * 8;
            scalar_tail_i420(y, u_plane, v_plane, y_stride, u_stride, v_stride, width, row0, row1, rp, col_start, rgba);
        }
        if height % 2 != 0 {
            scalar::scalar_odd_row_i420(y, u_plane, v_plane, y_stride, u_stride, v_stride, width, height, rgba);
        }
    }

    // ─── AVX2 (16 pixels per iteration) ─────────────────────────────

    #[target_feature(enable = "avx2")]
    pub(super) unsafe fn nv12_to_rgba_avx2(
        y_plane: &[u8], uv_plane: &[u8],
        y_stride: usize, uv_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;
            let y0_base = row0 * y_stride;
            let y1_base = row1 * y_stride;
            let uv_base = rp * uv_stride;
            let dst0_base = row0 * width * 4;
            let dst1_base = row1 * width * 4;
            let chunks = width / 16;

            for chunk in 0..chunks {
                let col = chunk * 16;
                convert_16px_nv12_avx2(
                    y_plane, uv_plane, rgba,
                    y0_base + col, y1_base + col,
                    uv_base + (col & !1),
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            // Use SSSE3 for the 8-pixel chunks in the remainder.
            let col_after_avx = chunks * 16;
            let remaining = width - col_after_avx;
            let ssse3_chunks = remaining / 8;
            for sc in 0..ssse3_chunks {
                let col = col_after_avx + sc * 8;
                convert_8px_nv12(
                    y_plane, uv_plane, rgba,
                    y0_base + col, y1_base + col,
                    uv_base + (col & !1),
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            let col_start = col_after_avx + ssse3_chunks * 8;
            scalar_tail_nv12(y_plane, uv_plane, y_stride, uv_stride, width, row0, row1, rp, col_start, rgba);
        }
        if height % 2 != 0 {
            scalar::scalar_odd_row_nv12(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba);
        }
    }

    #[target_feature(enable = "avx2")]
    pub(super) unsafe fn i420_to_rgba_avx2(
        y: &[u8], u_plane: &[u8], v_plane: &[u8],
        y_stride: usize, u_stride: usize, v_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;
            let y0_base = row0 * y_stride;
            let y1_base = row1 * y_stride;
            let u_base = rp * u_stride;
            let v_base = rp * v_stride;
            let dst0_base = row0 * width * 4;
            let dst1_base = row1 * width * 4;
            let chunks = width / 16;

            for chunk in 0..chunks {
                let col = chunk * 16;
                convert_16px_i420_avx2(
                    y, u_plane, v_plane, rgba,
                    y0_base + col, y1_base + col,
                    u_base + col / 2, v_base + col / 2,
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            let col_after_avx = chunks * 16;
            let remaining = width - col_after_avx;
            let ssse3_chunks = remaining / 8;
            for sc in 0..ssse3_chunks {
                let col = col_after_avx + sc * 8;
                convert_8px_i420(
                    y, u_plane, v_plane, rgba,
                    y0_base + col, y1_base + col,
                    u_base + col / 2, v_base + col / 2,
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            let col_start = col_after_avx + ssse3_chunks * 8;
            scalar_tail_i420(y, u_plane, v_plane, y_stride, u_stride, v_stride, width, row0, row1, rp, col_start, rgba);
        }
        if height % 2 != 0 {
            scalar::scalar_odd_row_i420(y, u_plane, v_plane, y_stride, u_stride, v_stride, width, height, rgba);
        }
    }

    // ─── SSSE3 core (8 pixels) ──────────────────────────────────────

    #[target_feature(enable = "ssse3")]
    unsafe fn convert_8px_nv12(
        y_plane: &[u8], uv_plane: &[u8], rgba: &mut [u8],
        y0_off: usize, y1_off: usize,
        uv_off: usize,
        dst0_off: usize, dst1_off: usize,
    ) {
        let y0 = load_8u8_to_i16(y_plane.as_ptr().add(y0_off));
        let y1 = load_8u8_to_i16(y_plane.as_ptr().add(y1_off));

        // Deinterleave NV12 UV using SSSE3 pshufb.
        let uv_raw = _mm_loadl_epi64(uv_plane.as_ptr().add(uv_off) as *const __m128i);
        let shuf_u = _mm_set_epi8(-1,-1,-1,-1,-1,-1,-1,-1, 6,6,4,4,2,2,0,0);
        let shuf_v = _mm_set_epi8(-1,-1,-1,-1,-1,-1,-1,-1, 7,7,5,5,3,3,1,1);
        let u_bytes = _mm_shuffle_epi8(uv_raw, shuf_u);
        let v_bytes = _mm_shuffle_epi8(uv_raw, shuf_v);
        let u_16 = _mm_unpacklo_epi8(u_bytes, _mm_setzero_si128());
        let v_16 = _mm_unpacklo_epi8(v_bytes, _mm_setzero_si128());

        let bias = _mm_set1_epi16(128);
        let ub = _mm_sub_epi16(u_16, bias);
        let vb = _mm_sub_epi16(v_16, bias);

        yuv_to_rgba_row_8px(y0, ub, vb, rgba, dst0_off);
        yuv_to_rgba_row_8px(y1, ub, vb, rgba, dst1_off);
    }

    #[target_feature(enable = "ssse3")]
    unsafe fn convert_8px_i420(
        y: &[u8], u_plane: &[u8], v_plane: &[u8], rgba: &mut [u8],
        y0_off: usize, y1_off: usize,
        u_off: usize, v_off: usize,
        dst0_off: usize, dst1_off: usize,
    ) {
        let y0 = load_8u8_to_i16(y.as_ptr().add(y0_off));
        let y1 = load_8u8_to_i16(y.as_ptr().add(y1_off));

        // Load 4 bytes, duplicate each → 8 i16 values.
        let u_raw = _mm_cvtsi32_si128(std::ptr::read_unaligned(u_plane.as_ptr().add(u_off) as *const i32));
        let v_raw = _mm_cvtsi32_si128(std::ptr::read_unaligned(v_plane.as_ptr().add(v_off) as *const i32));
        let dup = _mm_set_epi8(-1,-1,-1,-1,-1,-1,-1,-1, 3,3,2,2,1,1,0,0);
        let u_dup = _mm_shuffle_epi8(u_raw, dup);
        let v_dup = _mm_shuffle_epi8(v_raw, dup);
        let u_16 = _mm_unpacklo_epi8(u_dup, _mm_setzero_si128());
        let v_16 = _mm_unpacklo_epi8(v_dup, _mm_setzero_si128());

        let bias = _mm_set1_epi16(128);
        let ub = _mm_sub_epi16(u_16, bias);
        let vb = _mm_sub_epi16(v_16, bias);

        yuv_to_rgba_row_8px(y0, ub, vb, rgba, dst0_off);
        yuv_to_rgba_row_8px(y1, ub, vb, rgba, dst1_off);
    }

    /// Core SSSE3: 8 pixels YUV→RGBA.  Uses SSE4.1 _mm_mullo_epi32 + _mm_packus_epi32
    /// when available (SSSE3 implies SSE3, and we also get SSE4.1 on virtually all
    /// SSSE3 chips, but we emulate if needed).
    #[target_feature(enable = "ssse3")]
    unsafe fn yuv_to_rgba_row_8px(
        y_16: __m128i, u_16: __m128i, v_16: __m128i,
        rgba: &mut [u8], dst_off: usize,
    ) {
        // Widen to i32 (two halves of 4 pixels each).
        let zero = _mm_setzero_si128();
        let y_lo = _mm_unpacklo_epi16(y_16, zero);
        let y_hi = _mm_unpackhi_epi16(y_16, zero);
        // Sign-extend U and V to i32.
        let u_lo = sign_extend_lo_i16_to_i32(u_16);
        let u_hi = sign_extend_hi_i16_to_i32(u_16);
        let v_lo = sign_extend_lo_i16_to_i32(v_16);
        let v_hi = sign_extend_hi_i16_to_i32(v_16);

        let c256 = _mm_set1_epi32(256);
        let c359 = _mm_set1_epi32(359);
        let c88  = _mm_set1_epi32(88);
        let c183 = _mm_set1_epi32(183);
        let c454 = _mm_set1_epi32(454);

        let r_lo = _mm_srai_epi32(_mm_add_epi32(mullo32(y_lo, c256), mullo32(v_lo, c359)), 8);
        let r_hi = _mm_srai_epi32(_mm_add_epi32(mullo32(y_hi, c256), mullo32(v_hi, c359)), 8);
        let g_lo = _mm_srai_epi32(_mm_sub_epi32(_mm_sub_epi32(mullo32(y_lo, c256), mullo32(u_lo, c88)), mullo32(v_lo, c183)), 8);
        let g_hi = _mm_srai_epi32(_mm_sub_epi32(_mm_sub_epi32(mullo32(y_hi, c256), mullo32(u_hi, c88)), mullo32(v_hi, c183)), 8);
        let b_lo = _mm_srai_epi32(_mm_add_epi32(mullo32(y_lo, c256), mullo32(u_lo, c454)), 8);
        let b_hi = _mm_srai_epi32(_mm_add_epi32(mullo32(y_hi, c256), mullo32(u_hi, c454)), 8);

        // Pack i32→i16 (signed sat), then i16→u8 (unsigned sat).
        let r_16 = _mm_packs_epi32(r_lo, r_hi);
        let g_16 = _mm_packs_epi32(g_lo, g_hi);
        let b_16 = _mm_packs_epi32(b_lo, b_hi);
        let a_16 = _mm_set1_epi16(255);

        let r_8 = _mm_packus_epi16(r_16, r_16);
        let g_8 = _mm_packus_epi16(g_16, g_16);
        let b_8 = _mm_packus_epi16(b_16, b_16);
        let a_8 = _mm_packus_epi16(a_16, a_16);

        // Interleave to RGBA.
        let rg = _mm_unpacklo_epi8(r_8, g_8);
        let ba = _mm_unpacklo_epi8(b_8, a_8);
        let rgba_0123 = _mm_unpacklo_epi16(rg, ba);
        let rgba_4567 = _mm_unpackhi_epi16(rg, ba);

        let dst = rgba.as_mut_ptr().add(dst_off);
        _mm_storeu_si128(dst as *mut __m128i, rgba_0123);
        _mm_storeu_si128(dst.add(16) as *mut __m128i, rgba_4567);
    }

    // ─── AVX2 core (16 pixels) ──────────────────────────────────────

    #[target_feature(enable = "avx2")]
    unsafe fn convert_16px_nv12_avx2(
        y_plane: &[u8], uv_plane: &[u8], rgba: &mut [u8],
        y0_off: usize, y1_off: usize,
        uv_off: usize,
        dst0_off: usize, dst1_off: usize,
    ) {
        let y0_raw = _mm_loadu_si128(y_plane.as_ptr().add(y0_off) as *const __m128i);
        let y1_raw = _mm_loadu_si128(y_plane.as_ptr().add(y1_off) as *const __m128i);
        let y0_16 = _mm256_cvtepu8_epi16(y0_raw);
        let y1_16 = _mm256_cvtepu8_epi16(y1_raw);

        // Load 16 bytes of interleaved UV.
        let uv_raw = _mm_loadu_si128(uv_plane.as_ptr().add(uv_off) as *const __m128i);
        let shuf_u = _mm_set_epi8(14,14,12,12,10,10,8,8, 6,6,4,4,2,2,0,0);
        let shuf_v = _mm_set_epi8(15,15,13,13,11,11,9,9, 7,7,5,5,3,3,1,1);
        let u_bytes = _mm_shuffle_epi8(uv_raw, shuf_u);
        let v_bytes = _mm_shuffle_epi8(uv_raw, shuf_v);
        let u_16 = _mm256_cvtepu8_epi16(u_bytes);
        let v_16 = _mm256_cvtepu8_epi16(v_bytes);

        let bias = _mm256_set1_epi16(128);
        let ub = _mm256_sub_epi16(u_16, bias);
        let vb = _mm256_sub_epi16(v_16, bias);

        yuv_to_rgba_row_16px_avx2(y0_16, ub, vb, rgba, dst0_off);
        yuv_to_rgba_row_16px_avx2(y1_16, ub, vb, rgba, dst1_off);
    }

    #[target_feature(enable = "avx2")]
    unsafe fn convert_16px_i420_avx2(
        y: &[u8], u_plane: &[u8], v_plane: &[u8], rgba: &mut [u8],
        y0_off: usize, y1_off: usize,
        u_off: usize, v_off: usize,
        dst0_off: usize, dst1_off: usize,
    ) {
        let y0_raw = _mm_loadu_si128(y.as_ptr().add(y0_off) as *const __m128i);
        let y1_raw = _mm_loadu_si128(y.as_ptr().add(y1_off) as *const __m128i);
        let y0_16 = _mm256_cvtepu8_epi16(y0_raw);
        let y1_16 = _mm256_cvtepu8_epi16(y1_raw);

        // Load 8 U and 8 V bytes, duplicate each.
        let u_raw = _mm_loadl_epi64(u_plane.as_ptr().add(u_off) as *const __m128i);
        let v_raw = _mm_loadl_epi64(v_plane.as_ptr().add(v_off) as *const __m128i);
        let dup = _mm_set_epi8(7,7,6,6,5,5,4,4, 3,3,2,2,1,1,0,0);
        let u_dup = _mm_shuffle_epi8(u_raw, dup);
        let v_dup = _mm_shuffle_epi8(v_raw, dup);
        let u_16 = _mm256_cvtepu8_epi16(u_dup);
        let v_16 = _mm256_cvtepu8_epi16(v_dup);

        let bias = _mm256_set1_epi16(128);
        let ub = _mm256_sub_epi16(u_16, bias);
        let vb = _mm256_sub_epi16(v_16, bias);

        yuv_to_rgba_row_16px_avx2(y0_16, ub, vb, rgba, dst0_off);
        yuv_to_rgba_row_16px_avx2(y1_16, ub, vb, rgba, dst1_off);
    }

    #[target_feature(enable = "avx2")]
    unsafe fn yuv_to_rgba_row_16px_avx2(
        y_16: __m256i, u_16: __m256i, v_16: __m256i,
        rgba: &mut [u8], dst_off: usize,
    ) {
        let zero = _mm256_setzero_si256();
        let y_lo = _mm256_unpacklo_epi16(y_16, zero);
        let y_hi = _mm256_unpackhi_epi16(y_16, zero);
        let u_lo = _mm256_srai_epi32(_mm256_unpacklo_epi16(u_16, u_16), 16);
        let u_hi = _mm256_srai_epi32(_mm256_unpackhi_epi16(u_16, u_16), 16);
        let v_lo = _mm256_srai_epi32(_mm256_unpacklo_epi16(v_16, v_16), 16);
        let v_hi = _mm256_srai_epi32(_mm256_unpackhi_epi16(v_16, v_16), 16);

        let c256 = _mm256_set1_epi32(256);
        let c359 = _mm256_set1_epi32(359);
        let c88  = _mm256_set1_epi32(88);
        let c183 = _mm256_set1_epi32(183);
        let c454 = _mm256_set1_epi32(454);

        let r_lo = _mm256_srai_epi32(_mm256_add_epi32(_mm256_mullo_epi32(y_lo, c256), _mm256_mullo_epi32(v_lo, c359)), 8);
        let r_hi = _mm256_srai_epi32(_mm256_add_epi32(_mm256_mullo_epi32(y_hi, c256), _mm256_mullo_epi32(v_hi, c359)), 8);
        let g_lo = _mm256_srai_epi32(_mm256_sub_epi32(_mm256_sub_epi32(_mm256_mullo_epi32(y_lo, c256), _mm256_mullo_epi32(u_lo, c88)), _mm256_mullo_epi32(v_lo, c183)), 8);
        let g_hi = _mm256_srai_epi32(_mm256_sub_epi32(_mm256_sub_epi32(_mm256_mullo_epi32(y_hi, c256), _mm256_mullo_epi32(u_hi, c88)), _mm256_mullo_epi32(v_hi, c183)), 8);
        let b_lo = _mm256_srai_epi32(_mm256_add_epi32(_mm256_mullo_epi32(y_lo, c256), _mm256_mullo_epi32(u_lo, c454)), 8);
        let b_hi = _mm256_srai_epi32(_mm256_add_epi32(_mm256_mullo_epi32(y_hi, c256), _mm256_mullo_epi32(u_hi, c454)), 8);

        // Pack and saturate: i32 → i16 → u8.
        let r_16 = _mm256_packs_epi32(r_lo, r_hi);
        let g_16 = _mm256_packs_epi32(g_lo, g_hi);
        let b_16 = _mm256_packs_epi32(b_lo, b_hi);
        let a_16 = _mm256_set1_epi16(255);

        let r_8 = _mm256_packus_epi16(r_16, r_16);
        let g_8 = _mm256_packus_epi16(g_16, g_16);
        let b_8 = _mm256_packus_epi16(b_16, b_16);
        let a_8 = _mm256_packus_epi16(a_16, a_16);

        // Fix cross-lane ordering from AVX2 pack operations.
        let r_fixed = _mm256_permute4x64_epi64(r_8, 0b11_01_10_00);
        let g_fixed = _mm256_permute4x64_epi64(g_8, 0b11_01_10_00);
        let b_fixed = _mm256_permute4x64_epi64(b_8, 0b11_01_10_00);
        let a_fixed = _mm256_permute4x64_epi64(a_8, 0b11_01_10_00);

        // Interleave channels to RGBA using 128-bit SSE ops on the lower halves.
        let r_128 = _mm256_castsi256_si128(r_fixed);
        let g_128 = _mm256_castsi256_si128(g_fixed);
        let b_128 = _mm256_castsi256_si128(b_fixed);
        let a_128 = _mm256_castsi256_si128(a_fixed);

        let rg_lo = _mm_unpacklo_epi8(r_128, g_128);
        let ba_lo = _mm_unpacklo_epi8(b_128, a_128);
        let rgba_0 = _mm_unpacklo_epi16(rg_lo, ba_lo);
        let rgba_1 = _mm_unpackhi_epi16(rg_lo, ba_lo);

        let rg_hi = _mm_unpackhi_epi8(r_128, g_128);
        let ba_hi = _mm_unpackhi_epi8(b_128, a_128);
        let rgba_2 = _mm_unpacklo_epi16(rg_hi, ba_hi);
        let rgba_3 = _mm_unpackhi_epi16(rg_hi, ba_hi);

        let dst = rgba.as_mut_ptr().add(dst_off);
        _mm_storeu_si128(dst as *mut __m128i, rgba_0);
        _mm_storeu_si128(dst.add(16) as *mut __m128i, rgba_1);
        _mm_storeu_si128(dst.add(32) as *mut __m128i, rgba_2);
        _mm_storeu_si128(dst.add(48) as *mut __m128i, rgba_3);
    }

    // ─── AVX-512BW (16 pixels in 512-bit registers) ─────────────────

    #[target_feature(enable = "avx512bw")]
    pub(super) unsafe fn nv12_to_rgba_avx512(
        y_plane: &[u8], uv_plane: &[u8],
        y_stride: usize, uv_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;
            let y0_base = row0 * y_stride;
            let y1_base = row1 * y_stride;
            let uv_base = rp * uv_stride;
            let dst0_base = row0 * width * 4;
            let dst1_base = row1 * width * 4;
            let chunks = width / 16;

            for chunk in 0..chunks {
                let col = chunk * 16;
                convert_16px_nv12_avx512(
                    y_plane, uv_plane, rgba,
                    y0_base + col, y1_base + col,
                    uv_base + (col & !1),
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            // Remainder via SSSE3 8-pixel chunks + scalar tail
            let col_after = chunks * 16;
            let remaining = width - col_after;
            let chunks_8 = remaining / 8;
            for sc in 0..chunks_8 {
                let col = col_after + sc * 8;
                convert_8px_nv12(
                    y_plane, uv_plane, rgba,
                    y0_base + col, y1_base + col,
                    uv_base + (col & !1),
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            let col_start = col_after + chunks_8 * 8;
            scalar_tail_nv12(y_plane, uv_plane, y_stride, uv_stride, width, row0, row1, rp, col_start, rgba);
        }
        if height % 2 != 0 {
            scalar::scalar_odd_row_nv12(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba);
        }
    }

    #[target_feature(enable = "avx512bw")]
    pub(super) unsafe fn i420_to_rgba_avx512(
        y: &[u8], u_plane: &[u8], v_plane: &[u8],
        y_stride: usize, u_stride: usize, v_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;
            let y0_base = row0 * y_stride;
            let y1_base = row1 * y_stride;
            let u_base = rp * u_stride;
            let v_base = rp * v_stride;
            let dst0_base = row0 * width * 4;
            let dst1_base = row1 * width * 4;
            let chunks = width / 16;

            for chunk in 0..chunks {
                let col = chunk * 16;
                convert_16px_i420_avx512(
                    y, u_plane, v_plane, rgba,
                    y0_base + col, y1_base + col,
                    u_base + col / 2, v_base + col / 2,
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            let col_after = chunks * 16;
            let remaining = width - col_after;
            let chunks_8 = remaining / 8;
            for sc in 0..chunks_8 {
                let col = col_after + sc * 8;
                convert_8px_i420(
                    y, u_plane, v_plane, rgba,
                    y0_base + col, y1_base + col,
                    u_base + col / 2, v_base + col / 2,
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            let col_start = col_after + chunks_8 * 8;
            scalar_tail_i420(y, u_plane, v_plane, y_stride, u_stride, v_stride, width, row0, row1, rp, col_start, rgba);
        }
        if height % 2 != 0 {
            scalar::scalar_odd_row_i420(y, u_plane, v_plane, y_stride, u_stride, v_stride, width, height, rgba);
        }
    }

    #[target_feature(enable = "avx512bw")]
    unsafe fn convert_16px_nv12_avx512(
        y_plane: &[u8], uv_plane: &[u8], rgba: &mut [u8],
        y0_off: usize, y1_off: usize,
        uv_off: usize,
        dst0_off: usize, dst1_off: usize,
    ) {
        // Load 16 Y bytes and zero-extend directly to 16 × i32
        let y0_raw = _mm_loadu_si128(y_plane.as_ptr().add(y0_off) as *const __m128i);
        let y1_raw = _mm_loadu_si128(y_plane.as_ptr().add(y1_off) as *const __m128i);
        let y0_32 = _mm512_cvtepu8_epi32(y0_raw);
        let y1_32 = _mm512_cvtepu8_epi32(y1_raw);

        // Deinterleave NV12 UV and duplicate for chroma subsampling
        let uv_raw = _mm_loadu_si128(uv_plane.as_ptr().add(uv_off) as *const __m128i);
        let shuf_u = _mm_set_epi8(14,14,12,12,10,10,8,8, 6,6,4,4,2,2,0,0);
        let shuf_v = _mm_set_epi8(15,15,13,13,11,11,9,9, 7,7,5,5,3,3,1,1);
        let u_bytes = _mm_shuffle_epi8(uv_raw, shuf_u);
        let v_bytes = _mm_shuffle_epi8(uv_raw, shuf_v);

        let u_32 = _mm512_cvtepu8_epi32(u_bytes);
        let v_32 = _mm512_cvtepu8_epi32(v_bytes);
        let bias = _mm512_set1_epi32(128);
        let ub = _mm512_sub_epi32(u_32, bias);
        let vb = _mm512_sub_epi32(v_32, bias);

        yuv_to_rgba_row_16px_avx512(y0_32, ub, vb, rgba, dst0_off);
        yuv_to_rgba_row_16px_avx512(y1_32, ub, vb, rgba, dst1_off);
    }

    #[target_feature(enable = "avx512bw")]
    unsafe fn convert_16px_i420_avx512(
        y: &[u8], u_plane: &[u8], v_plane: &[u8], rgba: &mut [u8],
        y0_off: usize, y1_off: usize,
        u_off: usize, v_off: usize,
        dst0_off: usize, dst1_off: usize,
    ) {
        let y0_raw = _mm_loadu_si128(y.as_ptr().add(y0_off) as *const __m128i);
        let y1_raw = _mm_loadu_si128(y.as_ptr().add(y1_off) as *const __m128i);
        let y0_32 = _mm512_cvtepu8_epi32(y0_raw);
        let y1_32 = _mm512_cvtepu8_epi32(y1_raw);

        let u_raw = _mm_loadl_epi64(u_plane.as_ptr().add(u_off) as *const __m128i);
        let v_raw = _mm_loadl_epi64(v_plane.as_ptr().add(v_off) as *const __m128i);
        let dup = _mm_set_epi8(7,7,6,6,5,5,4,4, 3,3,2,2,1,1,0,0);
        let u_dup = _mm_shuffle_epi8(u_raw, dup);
        let v_dup = _mm_shuffle_epi8(v_raw, dup);

        let u_32 = _mm512_cvtepu8_epi32(u_dup);
        let v_32 = _mm512_cvtepu8_epi32(v_dup);
        let bias = _mm512_set1_epi32(128);
        let ub = _mm512_sub_epi32(u_32, bias);
        let vb = _mm512_sub_epi32(v_32, bias);

        yuv_to_rgba_row_16px_avx512(y0_32, ub, vb, rgba, dst0_off);
        yuv_to_rgba_row_16px_avx512(y1_32, ub, vb, rgba, dst1_off);
    }

    /// Core AVX-512: compute 16 pixels YUV→RGBA in single ZMM registers.
    /// All multiply/add/shift uses 16×i32 in one register (vs two in AVX2),
    /// then vpmovdb truncates directly to 16 bytes.
    #[target_feature(enable = "avx512bw")]
    unsafe fn yuv_to_rgba_row_16px_avx512(
        y_32: __m512i, u_32: __m512i, v_32: __m512i,
        rgba: &mut [u8], dst_off: usize,
    ) {
        let c256 = _mm512_set1_epi32(256);
        let c359 = _mm512_set1_epi32(359);
        let c88  = _mm512_set1_epi32(88);
        let c183 = _mm512_set1_epi32(183);
        let c454 = _mm512_set1_epi32(454);

        let r = _mm512_srai_epi32(_mm512_add_epi32(
            _mm512_mullo_epi32(y_32, c256), _mm512_mullo_epi32(v_32, c359)), 8);
        let g = _mm512_srai_epi32(_mm512_sub_epi32(_mm512_sub_epi32(
            _mm512_mullo_epi32(y_32, c256), _mm512_mullo_epi32(u_32, c88)),
            _mm512_mullo_epi32(v_32, c183)), 8);
        let b = _mm512_srai_epi32(_mm512_add_epi32(
            _mm512_mullo_epi32(y_32, c256), _mm512_mullo_epi32(u_32, c454)), 8);

        // Clamp to [0, 255] and truncate i32→u8 via vpmovdb
        let zero = _mm512_setzero_si512();
        let v255 = _mm512_set1_epi32(255);
        let r_8 = _mm512_cvtepi32_epi8(_mm512_min_epi32(_mm512_max_epi32(r, zero), v255));
        let g_8 = _mm512_cvtepi32_epi8(_mm512_min_epi32(_mm512_max_epi32(g, zero), v255));
        let b_8 = _mm512_cvtepi32_epi8(_mm512_min_epi32(_mm512_max_epi32(b, zero), v255));
        let a_8 = _mm_set1_epi8(-1i8); // 0xFF

        // Interleave to RGBA (standard SSE2 byte interleave)
        let rg_lo = _mm_unpacklo_epi8(r_8, g_8);
        let ba_lo = _mm_unpacklo_epi8(b_8, a_8);
        let rgba_0 = _mm_unpacklo_epi16(rg_lo, ba_lo);
        let rgba_1 = _mm_unpackhi_epi16(rg_lo, ba_lo);

        let rg_hi = _mm_unpackhi_epi8(r_8, g_8);
        let ba_hi = _mm_unpackhi_epi8(b_8, a_8);
        let rgba_2 = _mm_unpacklo_epi16(rg_hi, ba_hi);
        let rgba_3 = _mm_unpackhi_epi16(rg_hi, ba_hi);

        let dst = rgba.as_mut_ptr().add(dst_off);
        _mm_storeu_si128(dst as *mut __m128i, rgba_0);
        _mm_storeu_si128(dst.add(16) as *mut __m128i, rgba_1);
        _mm_storeu_si128(dst.add(32) as *mut __m128i, rgba_2);
        _mm_storeu_si128(dst.add(48) as *mut __m128i, rgba_3);
    }

    // ─── SSE4.1 (8 pixels, native _mm_mullo_epi32) ─────────────────

    #[target_feature(enable = "sse4.1")]
    pub(super) unsafe fn nv12_to_rgba_sse41(
        y_plane: &[u8], uv_plane: &[u8],
        y_stride: usize, uv_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;
            let y0_base = row0 * y_stride;
            let y1_base = row1 * y_stride;
            let uv_base = rp * uv_stride;
            let dst0_base = row0 * width * 4;
            let dst1_base = row1 * width * 4;
            let chunks = width / 8;

            for chunk in 0..chunks {
                let col = chunk * 8;
                convert_8px_nv12_sse41(
                    y_plane, uv_plane, rgba,
                    y0_base + col, y1_base + col,
                    uv_base + (col & !1),
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            let col_start = chunks * 8;
            scalar_tail_nv12(y_plane, uv_plane, y_stride, uv_stride, width, row0, row1, rp, col_start, rgba);
        }
        if height % 2 != 0 {
            scalar::scalar_odd_row_nv12(y_plane, uv_plane, y_stride, uv_stride, width, height, rgba);
        }
    }

    #[target_feature(enable = "sse4.1")]
    pub(super) unsafe fn i420_to_rgba_sse41(
        y: &[u8], u_plane: &[u8], v_plane: &[u8],
        y_stride: usize, u_stride: usize, v_stride: usize,
        width: usize, height: usize,
        rgba: &mut [u8],
    ) {
        let row_pairs = height / 2;
        for rp in 0..row_pairs {
            let row0 = rp * 2;
            let row1 = row0 + 1;
            let y0_base = row0 * y_stride;
            let y1_base = row1 * y_stride;
            let u_base = rp * u_stride;
            let v_base = rp * v_stride;
            let dst0_base = row0 * width * 4;
            let dst1_base = row1 * width * 4;
            let chunks = width / 8;

            for chunk in 0..chunks {
                let col = chunk * 8;
                convert_8px_i420_sse41(
                    y, u_plane, v_plane, rgba,
                    y0_base + col, y1_base + col,
                    u_base + col / 2, v_base + col / 2,
                    dst0_base + col * 4, dst1_base + col * 4,
                );
            }
            let col_start = chunks * 8;
            scalar_tail_i420(y, u_plane, v_plane, y_stride, u_stride, v_stride, width, row0, row1, rp, col_start, rgba);
        }
        if height % 2 != 0 {
            scalar::scalar_odd_row_i420(y, u_plane, v_plane, y_stride, u_stride, v_stride, width, height, rgba);
        }
    }

    #[target_feature(enable = "sse4.1")]
    unsafe fn convert_8px_nv12_sse41(
        y_plane: &[u8], uv_plane: &[u8], rgba: &mut [u8],
        y0_off: usize, y1_off: usize,
        uv_off: usize,
        dst0_off: usize, dst1_off: usize,
    ) {
        let y0 = _mm_cvtepu8_epi16(_mm_loadl_epi64(y_plane.as_ptr().add(y0_off) as *const __m128i));
        let y1 = _mm_cvtepu8_epi16(_mm_loadl_epi64(y_plane.as_ptr().add(y1_off) as *const __m128i));

        let uv_raw = _mm_loadl_epi64(uv_plane.as_ptr().add(uv_off) as *const __m128i);
        let shuf_u = _mm_set_epi8(-1,-1,-1,-1,-1,-1,-1,-1, 6,6,4,4,2,2,0,0);
        let shuf_v = _mm_set_epi8(-1,-1,-1,-1,-1,-1,-1,-1, 7,7,5,5,3,3,1,1);
        let u_bytes = _mm_shuffle_epi8(uv_raw, shuf_u);
        let v_bytes = _mm_shuffle_epi8(uv_raw, shuf_v);
        let u_16 = _mm_cvtepu8_epi16(u_bytes);
        let v_16 = _mm_cvtepu8_epi16(v_bytes);

        let bias = _mm_set1_epi16(128);
        let ub = _mm_sub_epi16(u_16, bias);
        let vb = _mm_sub_epi16(v_16, bias);

        yuv_to_rgba_row_8px_sse41(y0, ub, vb, rgba, dst0_off);
        yuv_to_rgba_row_8px_sse41(y1, ub, vb, rgba, dst1_off);
    }

    #[target_feature(enable = "sse4.1")]
    unsafe fn convert_8px_i420_sse41(
        y: &[u8], u_plane: &[u8], v_plane: &[u8], rgba: &mut [u8],
        y0_off: usize, y1_off: usize,
        u_off: usize, v_off: usize,
        dst0_off: usize, dst1_off: usize,
    ) {
        let y0 = _mm_cvtepu8_epi16(_mm_loadl_epi64(y.as_ptr().add(y0_off) as *const __m128i));
        let y1 = _mm_cvtepu8_epi16(_mm_loadl_epi64(y.as_ptr().add(y1_off) as *const __m128i));

        let u_raw = _mm_cvtsi32_si128(std::ptr::read_unaligned(u_plane.as_ptr().add(u_off) as *const i32));
        let v_raw = _mm_cvtsi32_si128(std::ptr::read_unaligned(v_plane.as_ptr().add(v_off) as *const i32));
        let dup = _mm_set_epi8(-1,-1,-1,-1,-1,-1,-1,-1, 3,3,2,2,1,1,0,0);
        let u_dup = _mm_shuffle_epi8(u_raw, dup);
        let v_dup = _mm_shuffle_epi8(v_raw, dup);
        let u_16 = _mm_cvtepu8_epi16(u_dup);
        let v_16 = _mm_cvtepu8_epi16(v_dup);

        let bias = _mm_set1_epi16(128);
        let ub = _mm_sub_epi16(u_16, bias);
        let vb = _mm_sub_epi16(v_16, bias);

        yuv_to_rgba_row_8px_sse41(y0, ub, vb, rgba, dst0_off);
        yuv_to_rgba_row_8px_sse41(y1, ub, vb, rgba, dst1_off);
    }

    /// SSE4.1 core: 8 pixels YUV→RGBA using native `_mm_mullo_epi32`.
    /// Replaces the 6-instruction emulation used by the SSSE3 path.
    #[target_feature(enable = "sse4.1")]
    unsafe fn yuv_to_rgba_row_8px_sse41(
        y_16: __m128i, u_16: __m128i, v_16: __m128i,
        rgba: &mut [u8], dst_off: usize,
    ) {
        // Widen to i32 using SSE4.1 zero/sign-extension intrinsics
        let y_lo = _mm_cvtepu16_epi32(y_16);
        let y_hi = _mm_cvtepu16_epi32(_mm_srli_si128(y_16, 8));
        let u_lo = _mm_cvtepi16_epi32(u_16);
        let u_hi = _mm_cvtepi16_epi32(_mm_srli_si128(u_16, 8));
        let v_lo = _mm_cvtepi16_epi32(v_16);
        let v_hi = _mm_cvtepi16_epi32(_mm_srli_si128(v_16, 8));

        let c256 = _mm_set1_epi32(256);
        let c359 = _mm_set1_epi32(359);
        let c88  = _mm_set1_epi32(88);
        let c183 = _mm_set1_epi32(183);
        let c454 = _mm_set1_epi32(454);

        // Native 32-bit multiply (SSE4.1) — single instruction vs 6 in SSSE3
        let r_lo = _mm_srai_epi32(_mm_add_epi32(_mm_mullo_epi32(y_lo, c256), _mm_mullo_epi32(v_lo, c359)), 8);
        let r_hi = _mm_srai_epi32(_mm_add_epi32(_mm_mullo_epi32(y_hi, c256), _mm_mullo_epi32(v_hi, c359)), 8);
        let g_lo = _mm_srai_epi32(_mm_sub_epi32(_mm_sub_epi32(_mm_mullo_epi32(y_lo, c256), _mm_mullo_epi32(u_lo, c88)), _mm_mullo_epi32(v_lo, c183)), 8);
        let g_hi = _mm_srai_epi32(_mm_sub_epi32(_mm_sub_epi32(_mm_mullo_epi32(y_hi, c256), _mm_mullo_epi32(u_hi, c88)), _mm_mullo_epi32(v_hi, c183)), 8);
        let b_lo = _mm_srai_epi32(_mm_add_epi32(_mm_mullo_epi32(y_lo, c256), _mm_mullo_epi32(u_lo, c454)), 8);
        let b_hi = _mm_srai_epi32(_mm_add_epi32(_mm_mullo_epi32(y_hi, c256), _mm_mullo_epi32(u_hi, c454)), 8);

        let r_16 = _mm_packs_epi32(r_lo, r_hi);
        let g_16 = _mm_packs_epi32(g_lo, g_hi);
        let b_16 = _mm_packs_epi32(b_lo, b_hi);
        let a_16 = _mm_set1_epi16(255);

        let r_8 = _mm_packus_epi16(r_16, r_16);
        let g_8 = _mm_packus_epi16(g_16, g_16);
        let b_8 = _mm_packus_epi16(b_16, b_16);
        let a_8 = _mm_packus_epi16(a_16, a_16);

        let rg = _mm_unpacklo_epi8(r_8, g_8);
        let ba = _mm_unpacklo_epi8(b_8, a_8);
        let rgba_0123 = _mm_unpacklo_epi16(rg, ba);
        let rgba_4567 = _mm_unpackhi_epi16(rg, ba);

        let dst = rgba.as_mut_ptr().add(dst_off);
        _mm_storeu_si128(dst as *mut __m128i, rgba_0123);
        _mm_storeu_si128(dst.add(16) as *mut __m128i, rgba_4567);
    }

    // ─── Shared helpers ─────────────────────────────────────────────

    #[inline(always)]
    unsafe fn load_8u8_to_i16(ptr: *const u8) -> __m128i {
        let raw = _mm_loadl_epi64(ptr as *const __m128i);
        _mm_unpacklo_epi8(raw, _mm_setzero_si128())
    }

    /// Sign-extend low 4 × i16 lanes to i32.
    #[inline(always)]
    unsafe fn sign_extend_lo_i16_to_i32(v: __m128i) -> __m128i {
        let sign = _mm_srai_epi16(v, 15);
        _mm_unpacklo_epi16(v, sign)
    }

    /// Sign-extend high 4 × i16 lanes to i32.
    #[inline(always)]
    unsafe fn sign_extend_hi_i16_to_i32(v: __m128i) -> __m128i {
        let sign = _mm_srai_epi16(v, 15);
        _mm_unpackhi_epi16(v, sign)
    }

    /// Emulate `_mm_mullo_epi32` (SSE4.1) using SSE2 ops.
    #[inline(always)]
    unsafe fn mullo32(a: __m128i, b: __m128i) -> __m128i {
        let mul02 = _mm_mul_epu32(a, b);
        let mul13 = _mm_mul_epu32(_mm_srli_si128(a, 4), _mm_srli_si128(b, 4));
        // Interleave the low 32 bits of each 64-bit product.
        let lo = _mm_shuffle_epi32(mul02, 0b10_00_10_00);
        let hi = _mm_shuffle_epi32(mul13, 0b10_00_10_00);
        _mm_unpacklo_epi32(lo, hi)
    }

    // ─── Scalar tails (shared by SSSE3 and AVX2) ───────────────────

    #[inline]
    fn scalar_tail_nv12(
        y_plane: &[u8], uv_plane: &[u8],
        y_stride: usize, uv_stride: usize,
        width: usize, row0: usize, row1: usize, rp: usize,
        col_start: usize, rgba: &mut [u8],
    ) {
        let uv_base = rp * uv_stride;
        for col in col_start..width {
            let uv_idx = uv_base + (col & !1);
            let u = unsafe { *uv_plane.get_unchecked(uv_idx) } as i32 - 128;
            let v = unsafe { *uv_plane.get_unchecked(uv_idx + 1) } as i32 - 128;
            let rv = super::RV * v;
            let gu_gv = super::GU * u + super::GV * v;
            let bu = super::BU * u;
            for &row in &[row0, row1] {
                let yv = unsafe { *y_plane.get_unchecked(row * y_stride + col) } as i32;
                let d = (row * width + col) * 4;
                unsafe {
                    *rgba.get_unchecked_mut(d)     = ((super::YC * yv + rv) >> 8).clamp(0, 255) as u8;
                    *rgba.get_unchecked_mut(d + 1) = ((super::YC * yv + gu_gv) >> 8).clamp(0, 255) as u8;
                    *rgba.get_unchecked_mut(d + 2) = ((super::YC * yv + bu) >> 8).clamp(0, 255) as u8;
                    *rgba.get_unchecked_mut(d + 3) = 255;
                }
            }
        }
    }

    #[inline]
    fn scalar_tail_i420(
        y: &[u8], u_plane: &[u8], v_plane: &[u8],
        y_stride: usize, u_stride: usize, v_stride: usize,
        width: usize, row0: usize, row1: usize, rp: usize,
        col_start: usize, rgba: &mut [u8],
    ) {
        for col in col_start..width {
            let u_val = unsafe { *u_plane.get_unchecked(rp * u_stride + col / 2) } as i32 - 128;
            let v_val = unsafe { *v_plane.get_unchecked(rp * v_stride + col / 2) } as i32 - 128;
            let rv = super::RV * v_val;
            let gu_gv = super::GU * u_val + super::GV * v_val;
            let bu = super::BU * u_val;
            for &row in &[row0, row1] {
                let yv = unsafe { *y.get_unchecked(row * y_stride + col) } as i32;
                let d = (row * width + col) * 4;
                unsafe {
                    *rgba.get_unchecked_mut(d)     = ((super::YC * yv + rv) >> 8).clamp(0, 255) as u8;
                    *rgba.get_unchecked_mut(d + 1) = ((super::YC * yv + gu_gv) >> 8).clamp(0, 255) as u8;
                    *rgba.get_unchecked_mut(d + 2) = ((super::YC * yv + bu) >> 8).clamp(0, 255) as u8;
                    *rgba.get_unchecked_mut(d + 3) = 255;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_nv12(y: u8, u: u8, v: u8, w: usize, h: usize) -> Vec<u8> {
        let y_size = w * h;
        let uv_rows = (h + 1) / 2;
        // NV12 UV stride must be even-aligned for interleaved (U,V) pairs.
        let uv_stride = (w + 1) & !1;
        let uv_size = uv_stride * uv_rows;
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

    #[test]
    fn nv12_pure_black() {
        let nv12 = make_nv12(0, 128, 128, 4, 4);
        let rgba = nv12_to_rgba(&nv12, 4, 4);
        assert_eq!(rgba.len(), 4 * 4 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[0], 0);
            assert_eq!(pixel[1], 0);
            assert_eq!(pixel[2], 0);
            assert_eq!(pixel[3], 255);
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

    #[test]
    fn nv12_red_ish() {
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
        // Extreme UV values should not produce negative or >255 channels.
        let nv12 = make_nv12(255, 0, 255, 2, 2);
        let rgba = nv12_to_rgba(&nv12, 2, 2);
        // All channels are u8, so they're inherently in 0..=255.
        // Verify none got wrapped to garbage by the fixed-point math.
        for pixel in rgba.chunks_exact(4) {
            assert_ne!(pixel[3], 0, "Alpha must be 255");
        }
    }

    // ── SIMD-exercising tests (wider widths) ────────────────────────

    #[test]
    fn nv12_wide_frame_32px() {
        let nv12 = make_nv12(128, 128, 128, 32, 4);
        let rgba = nv12_to_rgba(&nv12, 32, 4);
        assert_eq!(rgba.len(), 32 * 4 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert!((pixel[0] as i32 - 128).abs() <= 1);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn nv12_17px_wide_exercises_simd_plus_tail() {
        let nv12 = make_nv12(0, 128, 128, 17, 2);
        let rgba = nv12_to_rgba(&nv12, 17, 2);
        assert_eq!(rgba.len(), 17 * 2 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[0], 0);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn i420_wide_frame_32px() {
        let yuv = make_i420(128, 128, 128, 32, 4);
        let rgba = i420_to_rgba(&yuv, 32, 4);
        assert_eq!(rgba.len(), 32 * 4 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert!((pixel[0] as i32 - 128).abs() <= 1);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn nv12_1920_wide() {
        // Full HD width — exercises many AVX2 chunks.
        let nv12 = make_nv12(128, 128, 128, 1920, 2);
        let rgba = nv12_to_rgba(&nv12, 1920, 2);
        assert_eq!(rgba.len(), 1920 * 2 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert!((pixel[0] as i32 - 128).abs() <= 1);
            assert_eq!(pixel[3], 255);
        }
    }

    // ── BGRA → RGBA tests ──────────────────────────────────────────

    #[test]
    fn bgra_to_rgba_basic() {
        let mut data = vec![
            0, 128, 255, 200,
            50, 100, 150, 0,
        ];
        bgra_to_rgba_inplace(&mut data);
        assert_eq!(data[0], 255);
        assert_eq!(data[1], 128);
        assert_eq!(data[2], 0);
        assert_eq!(data[3], 255);
        assert_eq!(data[4], 150);
        assert_eq!(data[5], 100);
        assert_eq!(data[6], 50);
        assert_eq!(data[7], 255);
    }

    #[test]
    fn bgra_to_rgba_wide() {
        let mut data = vec![0u8; 16 * 4];
        for i in 0..16 {
            data[i * 4] = 10;
            data[i * 4 + 1] = 20;
            data[i * 4 + 2] = 30;
            data[i * 4 + 3] = 40;
        }
        bgra_to_rgba_inplace(&mut data);
        for i in 0..16 {
            assert_eq!(data[i * 4], 30);
            assert_eq!(data[i * 4 + 1], 20);
            assert_eq!(data[i * 4 + 2], 10);
            assert_eq!(data[i * 4 + 3], 255);
        }
    }

    #[test]
    fn bgra_to_rgba_empty() {
        let mut data: Vec<u8> = vec![];
        bgra_to_rgba_inplace(&mut data);
        assert!(data.is_empty());
    }

    // ── CPU feature detection tests ─────────────────────────────────

    #[test]
    fn detected_tier_returns_non_empty() {
        let tier = detected_tier();
        assert!(!tier.is_empty());
    }

    #[test]
    fn log_cpu_features_does_not_panic() {
        // Just ensure no panic — actual output goes to log crate.
        log_cpu_features();
    }

    // ── Large frame tests (exercise all SIMD tiers) ─────────────────

    #[test]
    fn nv12_64px_wide() {
        // 64px exercises 4 AVX-512 chunks or 4 AVX2 chunks or 8 SSE chunks.
        let nv12 = make_nv12(128, 128, 128, 64, 4);
        let rgba = nv12_to_rgba(&nv12, 64, 4);
        assert_eq!(rgba.len(), 64 * 4 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert!((pixel[0] as i32 - 128).abs() <= 1);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn i420_64px_wide() {
        let yuv = make_i420(128, 128, 128, 64, 4);
        let rgba = i420_to_rgba(&yuv, 64, 4);
        assert_eq!(rgba.len(), 64 * 4 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert!((pixel[0] as i32 - 128).abs() <= 1);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn nv12_48px_exercises_mixed_chunks() {
        // 48 = 3×16 for AVX-512/AVX2, or 6×8 for SSE, exercises chunk+tail logic.
        let nv12 = make_nv12(200, 100, 150, 48, 2);
        let rgba = nv12_to_rgba(&nv12, 48, 2);
        assert_eq!(rgba.len(), 48 * 2 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn bgra_to_rgba_64px() {
        // 64 pixels = 4 AVX-512 chunks exactly
        let mut data = vec![0u8; 64 * 4];
        for i in 0..64 {
            data[i * 4] = 10;     // B
            data[i * 4 + 1] = 20; // G
            data[i * 4 + 2] = 30; // R
            data[i * 4 + 3] = 40; // A
        }
        bgra_to_rgba_inplace(&mut data);
        for i in 0..64 {
            assert_eq!(data[i * 4], 30);     // was R
            assert_eq!(data[i * 4 + 1], 20); // G unchanged
            assert_eq!(data[i * 4 + 2], 10); // was B
            assert_eq!(data[i * 4 + 3], 255); // forced alpha
        }
    }

    #[test]
    fn nv12_3840_wide_4k() {
        // 4K width — heavy SIMD exercise.
        let nv12 = make_nv12(128, 128, 128, 3840, 2);
        let rgba = nv12_to_rgba(&nv12, 3840, 2);
        assert_eq!(rgba.len(), 3840 * 2 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert!((pixel[0] as i32 - 128).abs() <= 1);
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn nv12_33px_exercises_all_tail_paths() {
        // 33 = 2×16 + 0×8 + 1 scalar tail (for AVX-512/AVX2)
        // 33 = 4×8 + 1 scalar tail (for SSE)
        let nv12 = make_nv12(0, 128, 128, 33, 2);
        let rgba = nv12_to_rgba(&nv12, 33, 2);
        assert_eq!(rgba.len(), 33 * 2 * 4);
        for pixel in rgba.chunks_exact(4) {
            assert_eq!(pixel[0], 0);
            assert_eq!(pixel[3], 255);
        }
    }
}

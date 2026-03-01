//! Framebuffer encoding decoders.
//!
//! Decodes pixel data received in FramebufferUpdate rectangles into a
//! uniform RGBA pixel buffer.

use crate::vnc::types::PixelFormat;

/// A decoded framebuffer rectangle.
#[derive(Debug, Clone)]
pub struct DecodedRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    /// RGBA pixel data (4 bytes per pixel).
    pub pixels: Vec<u8>,
}

/// Decode a Raw-encoded rectangle.
///
/// `data` contains `width * height * bpp` bytes of pixel data in the
/// server's pixel format.
pub fn decode_raw(
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    data: &[u8],
    pixel_format: &PixelFormat,
) -> Result<DecodedRect, String> {
    let bpp = pixel_format.bytes_per_pixel();
    let expected = width as usize * height as usize * bpp;
    if data.len() < expected {
        return Err(format!(
            "Raw data too short: expected {} bytes, got {}",
            expected,
            data.len()
        ));
    }

    let pixels = convert_to_rgba(&data[..expected], pixel_format);

    Ok(DecodedRect {
        x,
        y,
        width,
        height,
        pixels,
    })
}

/// Decode a CopyRect-encoded rectangle.
///
/// CopyRect is 4 bytes: src_x (u16 BE) + src_y (u16 BE).
/// The actual copying is done by the caller using the framebuffer.
pub fn decode_copyrect(data: &[u8]) -> Result<(u16, u16), String> {
    if data.len() < 4 {
        return Err("CopyRect data too short".into());
    }
    let src_x = u16::from_be_bytes([data[0], data[1]]);
    let src_y = u16::from_be_bytes([data[2], data[3]]);
    Ok((src_x, src_y))
}

/// Decode an RRE-encoded rectangle.
///
/// Format: 4-byte subrect count (BE) + background pixel + subrects.
/// Each subrect: pixel + x,y,w,h (each u16 BE).
pub fn decode_rre(
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    data: &[u8],
    pixel_format: &PixelFormat,
) -> Result<DecodedRect, String> {
    let bpp = pixel_format.bytes_per_pixel();
    if data.len() < 4 + bpp {
        return Err("RRE data too short for header".into());
    }

    let num_subrects = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
    let bg_pixel = &data[4..4 + bpp];
    let bg_rgba = pixel_to_rgba(bg_pixel, pixel_format);

    let pixel_count = width as usize * height as usize;
    let mut pixels = Vec::with_capacity(pixel_count * 4);

    // Fill with background colour.
    for _ in 0..pixel_count {
        pixels.extend_from_slice(&bg_rgba);
    }

    // Apply subrects.
    let mut offset = 4 + bpp;
    let subrect_size = bpp + 8; // pixel + 4x u16
    for _ in 0..num_subrects {
        if offset + subrect_size > data.len() {
            break;
        }
        let sr_rgba = pixel_to_rgba(&data[offset..offset + bpp], pixel_format);
        let off2 = offset + bpp;
        let sx = u16::from_be_bytes([data[off2], data[off2 + 1]]) as usize;
        let sy = u16::from_be_bytes([data[off2 + 2], data[off2 + 3]]) as usize;
        let sw = u16::from_be_bytes([data[off2 + 4], data[off2 + 5]]) as usize;
        let sh = u16::from_be_bytes([data[off2 + 6], data[off2 + 7]]) as usize;

        let w = width as usize;
        for row in sy..std::cmp::min(sy + sh, height as usize) {
            for col in sx..std::cmp::min(sx + sw, w) {
                let idx = (row * w + col) * 4;
                if idx + 4 <= pixels.len() {
                    pixels[idx..idx + 4].copy_from_slice(&sr_rgba);
                }
            }
        }
        offset += subrect_size;
    }

    Ok(DecodedRect { x, y, width, height, pixels })
}

/// Decode Hextile-encoded rectangle.
///
/// Hextile divides the rectangle into 16×16 tiles with sub-encoding flags.
pub fn decode_hextile(
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    data: &[u8],
    pixel_format: &PixelFormat,
) -> Result<DecodedRect, String> {
    let bpp = pixel_format.bytes_per_pixel();
    let w = width as usize;
    let h = height as usize;
    let pixel_count = w * h;
    let mut pixels = vec![0u8; pixel_count * 4];

    // Hextile sub-encoding flags.
    const RAW: u8 = 1;
    const BG_SPECIFIED: u8 = 2;
    const FG_SPECIFIED: u8 = 4;
    const ANY_SUBRECTS: u8 = 8;
    const SUBRECTS_COLOURED: u8 = 16;

    let mut bg_rgba = [0u8; 4];
    let mut fg_rgba = [0u8; 4];
    let mut offset = 0;

    let tiles_x = (w + 15) / 16;
    let tiles_y = (h + 15) / 16;

    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let tile_x = tx * 16;
            let tile_y = ty * 16;
            let tile_w = std::cmp::min(16, w - tile_x);
            let tile_h = std::cmp::min(16, h - tile_y);

            if offset >= data.len() {
                return Err("Hextile data truncated at sub-encoding byte".into());
            }
            let flags = data[offset];
            offset += 1;

            if flags & RAW != 0 {
                // Raw tile.
                let raw_size = tile_w * tile_h * bpp;
                if offset + raw_size > data.len() {
                    return Err("Hextile raw tile data truncated".into());
                }
                let tile_rgba = convert_to_rgba(&data[offset..offset + raw_size], pixel_format);
                blit_tile(&mut pixels, w, tile_x, tile_y, tile_w, tile_h, &tile_rgba);
                offset += raw_size;
                continue;
            }

            if flags & BG_SPECIFIED != 0 {
                if offset + bpp > data.len() {
                    return Err("Hextile bg pixel truncated".into());
                }
                bg_rgba = pixel_to_rgba(&data[offset..offset + bpp], pixel_format);
                offset += bpp;
            }

            // Fill tile with background.
            for row in tile_y..tile_y + tile_h {
                for col in tile_x..tile_x + tile_w {
                    let idx = (row * w + col) * 4;
                    if idx + 4 <= pixels.len() {
                        pixels[idx..idx + 4].copy_from_slice(&bg_rgba);
                    }
                }
            }

            if flags & FG_SPECIFIED != 0 {
                if offset + bpp > data.len() {
                    return Err("Hextile fg pixel truncated".into());
                }
                fg_rgba = pixel_to_rgba(&data[offset..offset + bpp], pixel_format);
                offset += bpp;
            }

            if flags & ANY_SUBRECTS != 0 {
                if offset >= data.len() {
                    return Err("Hextile subrect count truncated".into());
                }
                let num_subrects = data[offset] as usize;
                offset += 1;

                for _ in 0..num_subrects {
                    let sr_rgba = if flags & SUBRECTS_COLOURED != 0 {
                        if offset + bpp > data.len() {
                            return Err("Hextile subrect pixel truncated".into());
                        }
                        let c = pixel_to_rgba(&data[offset..offset + bpp], pixel_format);
                        offset += bpp;
                        c
                    } else {
                        fg_rgba
                    };

                    if offset + 2 > data.len() {
                        return Err("Hextile subrect coords truncated".into());
                    }
                    let xy = data[offset];
                    let wh = data[offset + 1];
                    offset += 2;

                    let sx = (xy >> 4) as usize;
                    let sy = (xy & 0x0F) as usize;
                    let sw = ((wh >> 4) + 1) as usize;
                    let sh = ((wh & 0x0F) + 1) as usize;

                    for row in (tile_y + sy)..std::cmp::min(tile_y + sy + sh, tile_y + tile_h) {
                        for col in (tile_x + sx)..std::cmp::min(tile_x + sx + sw, tile_x + tile_w) {
                            let idx = (row * w + col) * 4;
                            if idx + 4 <= pixels.len() {
                                pixels[idx..idx + 4].copy_from_slice(&sr_rgba);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(DecodedRect { x, y, width, height, pixels })
}

/// Calculate the expected raw data size for a rectangle.
pub fn raw_data_size(width: u16, height: u16, pixel_format: &PixelFormat) -> usize {
    width as usize * height as usize * pixel_format.bytes_per_pixel()
}

// ── Pixel conversion helpers ────────────────────────────────────────────

/// Convert a single pixel from the server's format to RGBA.
pub fn pixel_to_rgba(data: &[u8], pf: &PixelFormat) -> [u8; 4] {
    if !pf.true_colour {
        // Indexed colour — return grayscale approximation.
        let v = if !data.is_empty() { data[0] } else { 0 };
        return [v, v, v, 255];
    }

    let raw_value = match pf.bytes_per_pixel() {
        1 => data[0] as u32,
        2 => {
            if pf.big_endian {
                (data[0] as u32) << 8 | data[1] as u32
            } else {
                (data[1] as u32) << 8 | data[0] as u32
            }
        }
        4 => {
            if pf.big_endian {
                (data[0] as u32) << 24
                    | (data[1] as u32) << 16
                    | (data[2] as u32) << 8
                    | data[3] as u32
            } else {
                (data[3] as u32) << 24
                    | (data[2] as u32) << 16
                    | (data[1] as u32) << 8
                    | data[0] as u32
            }
        }
        _ => 0,
    };

    let r = if pf.red_max > 0 {
        (((raw_value >> pf.red_shift) & pf.red_max as u32) * 255 / pf.red_max as u32) as u8
    } else {
        0
    };
    let g = if pf.green_max > 0 {
        (((raw_value >> pf.green_shift) & pf.green_max as u32) * 255 / pf.green_max as u32) as u8
    } else {
        0
    };
    let b = if pf.blue_max > 0 {
        (((raw_value >> pf.blue_shift) & pf.blue_max as u32) * 255 / pf.blue_max as u32) as u8
    } else {
        0
    };

    [r, g, b, 255]
}

/// Convert a block of pixels from the server's format to RGBA.
pub fn convert_to_rgba(data: &[u8], pf: &PixelFormat) -> Vec<u8> {
    let bpp = pf.bytes_per_pixel();
    let pixel_count = data.len() / bpp;
    let mut out = Vec::with_capacity(pixel_count * 4);
    for i in 0..pixel_count {
        let offset = i * bpp;
        let rgba = pixel_to_rgba(&data[offset..offset + bpp], pf);
        out.extend_from_slice(&rgba);
    }
    out
}

/// Blit a tile of RGBA pixels into a larger pixel buffer.
fn blit_tile(
    dst: &mut [u8],
    dst_width: usize,
    tile_x: usize,
    tile_y: usize,
    tile_w: usize,
    tile_h: usize,
    tile_pixels: &[u8],
) {
    for row in 0..tile_h {
        let src_start = row * tile_w * 4;
        let dst_start = ((tile_y + row) * dst_width + tile_x) * 4;
        let len = tile_w * 4;
        if src_start + len <= tile_pixels.len() && dst_start + len <= dst.len() {
            dst[dst_start..dst_start + len]
                .copy_from_slice(&tile_pixels[src_start..src_start + len]);
        }
    }
}

/// Simple base64 encoding for sending pixel data over events.
pub fn base64_encode_pixels(data: &[u8]) -> String {
    // Simple base64 implementation for pixel data.
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((n >> 18) & 63) as usize] as char);
        result.push(CHARS[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((n >> 6) & 63) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(n & 63) as usize] as char);
        } else {
            result.push('=');
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba32() -> PixelFormat {
        PixelFormat::rgba32()
    }

    fn rgb565() -> PixelFormat {
        PixelFormat::rgb565()
    }

    // ── pixel_to_rgba ───────────────────────────────────────────────

    #[test]
    fn pixel_to_rgba_32bit_red() {
        let pf = rgba32();
        // Red pixel in BGRA little-endian: B=0, G=0, R=255, A=0
        let data = [0x00, 0x00, 0xFF, 0x00]; // LE: byte[0]=low, byte[3]=high
        let rgba = pixel_to_rgba(&data, &pf);
        assert_eq!(rgba[0], 255); // R
        assert_eq!(rgba[1], 0);   // G
        assert_eq!(rgba[2], 0);   // B
        assert_eq!(rgba[3], 255); // A always 255
    }

    #[test]
    fn pixel_to_rgba_32bit_green() {
        let pf = rgba32();
        let data = [0x00, 0xFF, 0x00, 0x00];
        let rgba = pixel_to_rgba(&data, &pf);
        assert_eq!(rgba[0], 0);
        assert_eq!(rgba[1], 255);
        assert_eq!(rgba[2], 0);
    }

    #[test]
    fn pixel_to_rgba_32bit_blue() {
        let pf = rgba32();
        let data = [0xFF, 0x00, 0x00, 0x00];
        let rgba = pixel_to_rgba(&data, &pf);
        assert_eq!(rgba[0], 0);
        assert_eq!(rgba[1], 0);
        assert_eq!(rgba[2], 255);
    }

    #[test]
    fn pixel_to_rgba_16bit_white() {
        let pf = rgb565();
        // All bits set = white: 0b11111_111111_11111 = 0xFFFF
        // LE: low byte first
        let data = [0xFF, 0xFF];
        let rgba = pixel_to_rgba(&data, &pf);
        assert_eq!(rgba[0], 255); // R
        assert_eq!(rgba[1], 255); // G
        assert_eq!(rgba[2], 255); // B
    }

    #[test]
    fn pixel_to_rgba_indexed() {
        let pf = PixelFormat::indexed8();
        let rgba = pixel_to_rgba(&[128], &pf);
        assert_eq!(rgba, [128, 128, 128, 255]);
    }

    // ── convert_to_rgba ─────────────────────────────────────────────

    #[test]
    fn convert_to_rgba_multiple_pixels() {
        let pf = rgba32();
        let mut data = Vec::new();
        // Two black pixels.
        data.extend_from_slice(&[0, 0, 0, 0]);
        data.extend_from_slice(&[0, 0, 0, 0]);
        let result = convert_to_rgba(&data, &pf);
        assert_eq!(result.len(), 8); // 2 pixels × 4 bytes
        assert_eq!(result, vec![0, 0, 0, 255, 0, 0, 0, 255]);
    }

    // ── decode_raw ──────────────────────────────────────────────────

    #[test]
    fn decode_raw_2x2() {
        let pf = rgba32();
        let data = vec![0u8; 2 * 2 * 4]; // 4 black pixels
        let rect = decode_raw(0, 0, 2, 2, &data, &pf).unwrap();
        assert_eq!(rect.width, 2);
        assert_eq!(rect.height, 2);
        assert_eq!(rect.pixels.len(), 2 * 2 * 4);
    }

    #[test]
    fn decode_raw_too_short() {
        let pf = rgba32();
        let data = vec![0u8; 10];
        assert!(decode_raw(0, 0, 10, 10, &data, &pf).is_err());
    }

    // ── decode_copyrect ─────────────────────────────────────────────

    #[test]
    fn decode_copyrect_basic() {
        let data = [0, 100, 0, 200]; // src_x=100, src_y=200
        let (sx, sy) = decode_copyrect(&data).unwrap();
        assert_eq!(sx, 100);
        assert_eq!(sy, 200);
    }

    #[test]
    fn decode_copyrect_too_short() {
        assert!(decode_copyrect(&[0, 1]).is_err());
    }

    // ── decode_rre ──────────────────────────────────────────────────

    #[test]
    fn decode_rre_no_subrects() {
        let pf = rgba32();
        let mut data = Vec::new();
        data.extend_from_slice(&0u32.to_be_bytes()); // 0 subrects
        data.extend_from_slice(&[0xFF, 0x00, 0x00, 0x00]); // blue bg pixel LE
        let rect = decode_rre(0, 0, 2, 2, &data, &pf).unwrap();
        assert_eq!(rect.pixels.len(), 2 * 2 * 4);
        // All pixels should be the background.
        assert_eq!(rect.pixels[0], 0);   // R
        assert_eq!(rect.pixels[2], 255); // B
    }

    #[test]
    fn decode_rre_with_subrect() {
        let pf = rgba32();
        let mut data = Vec::new();
        data.extend_from_slice(&1u32.to_be_bytes()); // 1 subrect
        data.extend_from_slice(&[0, 0, 0, 0]); // black bg
        // Subrect: white pixel, x=0 y=0, w=1 h=1
        data.extend_from_slice(&[0xFF, 0xFF, 0xFF, 0x00]); // white pixel
        data.extend_from_slice(&0u16.to_be_bytes()); // x
        data.extend_from_slice(&0u16.to_be_bytes()); // y
        data.extend_from_slice(&1u16.to_be_bytes()); // w
        data.extend_from_slice(&1u16.to_be_bytes()); // h
        let rect = decode_rre(0, 0, 2, 2, &data, &pf).unwrap();
        // First pixel should be white.
        assert_eq!(rect.pixels[0], 255); // R
        assert_eq!(rect.pixels[1], 255); // G
        assert_eq!(rect.pixels[2], 255); // B
        // Second pixel should be black bg.
        assert_eq!(rect.pixels[4], 0);
    }

    #[test]
    fn decode_rre_too_short() {
        let pf = rgba32();
        assert!(decode_rre(0, 0, 1, 1, &[0; 3], &pf).is_err());
    }

    // ── raw_data_size ───────────────────────────────────────────────

    #[test]
    fn raw_data_size_32bit() {
        assert_eq!(raw_data_size(100, 100, &rgba32()), 100 * 100 * 4);
    }

    #[test]
    fn raw_data_size_16bit() {
        assert_eq!(raw_data_size(80, 60, &rgb565()), 80 * 60 * 2);
    }

    // ── base64 encoding ─────────────────────────────────────────────

    #[test]
    fn base64_encode_empty() {
        assert_eq!(base64_encode_pixels(&[]), "");
    }

    #[test]
    fn base64_encode_hello() {
        let encoded = base64_encode_pixels(b"Hello");
        assert_eq!(encoded, "SGVsbG8=");
    }

    #[test]
    fn base64_encode_3_bytes() {
        let encoded = base64_encode_pixels(&[0, 0, 0]);
        assert_eq!(encoded, "AAAA");
    }

    // ── blit_tile ───────────────────────────────────────────────────

    #[test]
    fn blit_tile_basic() {
        let mut dst = vec![0u8; 4 * 4 * 4]; // 4×4 RGBA
        let tile = vec![255u8; 2 * 2 * 4]; // 2×2 white
        blit_tile(&mut dst, 4, 1, 1, 2, 2, &tile);
        // Check pixel at (1,1) is white.
        let idx = (1 * 4 + 1) * 4;
        assert_eq!(dst[idx], 255);
        // Check pixel at (0,0) is still black.
        assert_eq!(dst[0], 0);
    }

    // ── Hextile ─────────────────────────────────────────────────────

    #[test]
    fn decode_hextile_raw_tile() {
        let pf = rgba32();
        // 2×2 rect, single raw tile
        let mut data = Vec::new();
        data.push(1); // RAW flag
        data.extend_from_slice(&vec![0u8; 2 * 2 * 4]); // raw pixel data
        let rect = decode_hextile(0, 0, 2, 2, &data, &pf).unwrap();
        assert_eq!(rect.pixels.len(), 2 * 2 * 4);
    }

    #[test]
    fn decode_hextile_bg_only() {
        let pf = rgba32();
        let mut data = Vec::new();
        data.push(2); // BG_SPECIFIED flag
        data.extend_from_slice(&[0xFF, 0x00, 0x00, 0x00]); // blue bg
        let rect = decode_hextile(0, 0, 2, 2, &data, &pf).unwrap();
        assert_eq!(rect.pixels.len(), 2 * 2 * 4);
        // All pixels should be blue.
        assert_eq!(rect.pixels[2], 255); // B
    }
}

//! RFB encoding decoders for framebuffer updates.
//!
//! Supports the standard encodings (Raw, CopyRect, RRE, Hextile, ZRLE)
//! plus Apple-specific JPEG encoding used by ARD servers.

use flate2::read::ZlibDecoder;
use std::io::Read;

use super::errors::ArdError;
use super::pixel_format::PixelFormat;
use super::rfb::{self, RectHeader};

/// A decoded rectangle ready to be composited onto the framebuffer.
#[derive(Debug, Clone)]
pub struct DecodedRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    /// RGBA8 pixel data (4 bytes per pixel, row-major).
    pub pixels: Vec<u8>,
}

/// Stateful decoder for framebuffer-update rectangles.
pub struct EncodingDecoder {
    /// Persistent zlib decompressor state.
    zlib_state: Option<Vec<u8>>,
    /// Current pixel format.
    pixel_format: PixelFormat,
}

impl EncodingDecoder {
    pub fn new(pixel_format: PixelFormat) -> Self {
        Self {
            zlib_state: None,
            pixel_format,
        }
    }

    pub fn set_pixel_format(&mut self, pf: PixelFormat) {
        self.pixel_format = pf;
    }

    /// Decode a single framebuffer rectangle from the connection.
    pub fn decode_rect(
        &mut self,
        conn: &mut super::rfb::RfbConnection,
        header: &RectHeader,
    ) -> Result<DecodedRect, ArdError> {
        match header.encoding {
            rfb::encoding::RAW => self.decode_raw(conn, header),
            rfb::encoding::COPY_RECT => self.decode_copy_rect(conn, header),
            rfb::encoding::RRE => self.decode_rre(conn, header),
            rfb::encoding::HEXTILE => self.decode_hextile(conn, header),
            rfb::encoding::ZRLE => self.decode_zrle(conn, header),
            rfb::encoding::ZLIB => self.decode_zlib(conn, header),
            rfb::encoding::APPLE_JPEG => self.decode_apple_jpeg(conn, header),
            rfb::encoding::DESKTOP_SIZE => self.handle_desktop_size(header),
            rfb::encoding::CURSOR => self.handle_cursor(conn, header),
            other => Err(ArdError::UnsupportedEncoding(other)),
        }
    }

    // ── Raw encoding (type 0) ────────────────────────────────────────────

    fn decode_raw(
        &self,
        conn: &mut super::rfb::RfbConnection,
        header: &RectHeader,
    ) -> Result<DecodedRect, ArdError> {
        let bpp = self.pixel_format.bytes_per_pixel();
        let pixel_count = header.width as usize * header.height as usize;
        let byte_count = pixel_count * bpp;

        let mut raw = vec![0u8; byte_count];
        conn.read_exact(&mut raw)?;

        let pixels = self.pixel_format.convert_to_rgba(&raw, pixel_count);
        Ok(DecodedRect {
            x: header.x,
            y: header.y,
            width: header.width,
            height: header.height,
            pixels,
        })
    }

    // ── CopyRect encoding (type 1) ──────────────────────────────────────

    fn decode_copy_rect(
        &self,
        conn: &mut super::rfb::RfbConnection,
        header: &RectHeader,
    ) -> Result<DecodedRect, ArdError> {
        let src_x = conn.read_u16()?;
        let src_y = conn.read_u16()?;

        Ok(DecodedRect {
            x: header.x,
            y: header.y,
            width: header.width,
            height: header.height,
            pixels: vec![
                (src_x >> 8) as u8,
                (src_x & 0xFF) as u8,
                (src_y >> 8) as u8,
                (src_y & 0xFF) as u8,
            ],
        })
    }

    // ── RRE encoding (type 2) ───────────────────────────────────────────

    fn decode_rre(
        &self,
        conn: &mut super::rfb::RfbConnection,
        header: &RectHeader,
    ) -> Result<DecodedRect, ArdError> {
        let bpp = self.pixel_format.bytes_per_pixel();
        let num_subrects = conn.read_u32()?;

        let mut bg_raw = vec![0u8; bpp];
        conn.read_exact(&mut bg_raw)?;
        let bg = self.read_pixel_value(&bg_raw);

        let w = header.width as usize;
        let h = header.height as usize;
        let mut pixels = vec![0u8; w * h * 4];

        let [r, g, b, a] = self.pixel_format.pixel_to_rgba(bg);
        for i in 0..w * h {
            pixels[i * 4] = r;
            pixels[i * 4 + 1] = g;
            pixels[i * 4 + 2] = b;
            pixels[i * 4 + 3] = a;
        }

        for _ in 0..num_subrects {
            let mut sr_raw = vec![0u8; bpp];
            conn.read_exact(&mut sr_raw)?;
            let color = self.read_pixel_value(&sr_raw);
            let [r, g, b, a] = self.pixel_format.pixel_to_rgba(color);

            let sx = conn.read_u16()? as usize;
            let sy = conn.read_u16()? as usize;
            let sw = conn.read_u16()? as usize;
            let sh = conn.read_u16()? as usize;

            for row in sy..sy.saturating_add(sh).min(h) {
                for col in sx..sx.saturating_add(sw).min(w) {
                    let idx = (row * w + col) * 4;
                    if idx + 3 < pixels.len() {
                        pixels[idx] = r;
                        pixels[idx + 1] = g;
                        pixels[idx + 2] = b;
                        pixels[idx + 3] = a;
                    }
                }
            }
        }

        Ok(DecodedRect {
            x: header.x,
            y: header.y,
            width: header.width,
            height: header.height,
            pixels,
        })
    }

    // ── Hextile encoding (type 5) ───────────────────────────────────────

    fn decode_hextile(
        &self,
        conn: &mut super::rfb::RfbConnection,
        header: &RectHeader,
    ) -> Result<DecodedRect, ArdError> {
        let bpp = self.pixel_format.bytes_per_pixel();
        let w = header.width as usize;
        let h = header.height as usize;
        let mut pixels = vec![0u8; w * h * 4];

        let mut bg: u32 = 0;
        let mut fg: u32 = 0;

        const RAW_FLAG: u8 = 1;
        const BG_SPECIFIED: u8 = 2;
        const FG_SPECIFIED: u8 = 4;
        const ANY_SUBRECTS: u8 = 8;
        const SUBRECTS_COLOURED: u8 = 16;

        let mut ty = 0usize;
        while ty < h {
            let tile_h = (h - ty).min(16);
            let mut tx = 0usize;
            while tx < w {
                let tile_w = (w - tx).min(16);
                let flags = conn.read_u8()?;

                if flags & RAW_FLAG != 0 {
                    let tile_pixels = tile_w * tile_h;
                    let mut raw = vec![0u8; tile_pixels * bpp];
                    conn.read_exact(&mut raw)?;
                    let rgba = self.pixel_format.convert_to_rgba(&raw, tile_pixels);

                    for row in 0..tile_h {
                        for col in 0..tile_w {
                            let src_idx = (row * tile_w + col) * 4;
                            let dst_idx = ((ty + row) * w + tx + col) * 4;
                            if dst_idx + 3 < pixels.len() && src_idx + 3 < rgba.len() {
                                pixels[dst_idx..dst_idx + 4]
                                    .copy_from_slice(&rgba[src_idx..src_idx + 4]);
                            }
                        }
                    }
                } else {
                    if flags & BG_SPECIFIED != 0 {
                        let mut buf = vec![0u8; bpp];
                        conn.read_exact(&mut buf)?;
                        bg = self.read_pixel_value(&buf);
                    }
                    if flags & FG_SPECIFIED != 0 {
                        let mut buf = vec![0u8; bpp];
                        conn.read_exact(&mut buf)?;
                        fg = self.read_pixel_value(&buf);
                    }

                    let [r, g, b, a] = self.pixel_format.pixel_to_rgba(bg);
                    for row in 0..tile_h {
                        for col in 0..tile_w {
                            let idx = ((ty + row) * w + tx + col) * 4;
                            if idx + 3 < pixels.len() {
                                pixels[idx] = r;
                                pixels[idx + 1] = g;
                                pixels[idx + 2] = b;
                                pixels[idx + 3] = a;
                            }
                        }
                    }

                    if flags & ANY_SUBRECTS != 0 {
                        let n_subrects = conn.read_u8()? as usize;
                        for _ in 0..n_subrects {
                            let sr_fg = if flags & SUBRECTS_COLOURED != 0 {
                                let mut buf = vec![0u8; bpp];
                                conn.read_exact(&mut buf)?;
                                self.read_pixel_value(&buf)
                            } else {
                                fg
                            };
                            let xy = conn.read_u8()?;
                            let wh = conn.read_u8()?;
                            let sx = (xy >> 4) as usize;
                            let sy = (xy & 0x0F) as usize;
                            let sw = ((wh >> 4) + 1) as usize;
                            let sh = ((wh & 0x0F) + 1) as usize;

                            let [r, g, b, a] = self.pixel_format.pixel_to_rgba(sr_fg);
                            for row in sy..sy.saturating_add(sh).min(tile_h) {
                                for col in sx..sx.saturating_add(sw).min(tile_w) {
                                    let idx = ((ty + row) * w + tx + col) * 4;
                                    if idx + 3 < pixels.len() {
                                        pixels[idx] = r;
                                        pixels[idx + 1] = g;
                                        pixels[idx + 2] = b;
                                        pixels[idx + 3] = a;
                                    }
                                }
                            }
                        }
                    }
                }

                tx += 16;
            }
            ty += 16;
        }

        Ok(DecodedRect {
            x: header.x,
            y: header.y,
            width: header.width,
            height: header.height,
            pixels,
        })
    }

    // ── ZRLE encoding (type 16) ─────────────────────────────────────────

    fn decode_zrle(
        &self,
        conn: &mut super::rfb::RfbConnection,
        header: &RectHeader,
    ) -> Result<DecodedRect, ArdError> {
        let compressed_len = conn.read_u32()? as usize;
        let mut compressed = vec![0u8; compressed_len];
        conn.read_exact(&mut compressed)?;

        let zlib_data = self.zlib_state.as_ref().map_or_else(
            || compressed.clone(),
            |existing| {
                let mut combined = existing.clone();
                combined.extend_from_slice(&compressed);
                combined
            },
        );

        let mut decoder = ZlibDecoder::new(&zlib_data[..]);
        let w = header.width as usize;
        let h = header.height as usize;
        let cpix_len = if self.pixel_format.bits_per_pixel == 32
            && self.pixel_format.depth <= 24
            && self.pixel_format.true_colour
        {
            3
        } else {
            self.pixel_format.bytes_per_pixel()
        };

        let mut pixels = vec![0u8; w * h * 4];
        let mut ty = 0usize;

        while ty < h {
            let tile_h = (h - ty).min(64);
            let mut tx = 0usize;
            while tx < w {
                let tile_w = (w - tx).min(64);

                let subencoding = read_u8_from(&mut decoder)?;

                if subencoding == 0 {
                    for row in 0..tile_h {
                        for col in 0..tile_w {
                            let color = read_cpixel(&mut decoder, cpix_len, &self.pixel_format)?;
                            let idx = ((ty + row) * w + tx + col) * 4;
                            if idx + 3 < pixels.len() {
                                pixels[idx..idx + 4].copy_from_slice(&color);
                            }
                        }
                    }
                } else if subencoding == 1 {
                    let color = read_cpixel(&mut decoder, cpix_len, &self.pixel_format)?;
                    for row in 0..tile_h {
                        for col in 0..tile_w {
                            let idx = ((ty + row) * w + tx + col) * 4;
                            if idx + 3 < pixels.len() {
                                pixels[idx..idx + 4].copy_from_slice(&color);
                            }
                        }
                    }
                } else if subencoding >= 2 && subencoding <= 16 {
                    let palette_size = subencoding as usize;
                    let mut palette = Vec::with_capacity(palette_size);
                    for _ in 0..palette_size {
                        palette.push(read_cpixel(&mut decoder, cpix_len, &self.pixel_format)?);
                    }

                    if palette_size == 2 {
                        let mut bit_pos;
                        let mut current_byte = 0u8;
                        for row in 0..tile_h {
                            bit_pos = 0;
                            for col in 0..tile_w {
                                if bit_pos % 8 == 0 {
                                    current_byte = read_u8_from(&mut decoder)?;
                                    bit_pos = 0;
                                }
                                let idx_val = (current_byte >> (7 - bit_pos)) & 1;
                                bit_pos += 1;
                                let color = &palette[idx_val as usize];
                                let idx = ((ty + row) * w + tx + col) * 4;
                                if idx + 3 < pixels.len() {
                                    pixels[idx..idx + 4].copy_from_slice(color);
                                }
                            }
                        }
                    } else {
                        let bits: u8 = if palette_size <= 4 { 2 } else { 4 };
                        let mut bit_pos: u8;
                        let mut current_byte = 0u8;
                        for row in 0..tile_h {
                            bit_pos = 8;
                            for col in 0..tile_w {
                                if bit_pos >= 8 {
                                    current_byte = read_u8_from(&mut decoder)?;
                                    bit_pos = 0;
                                }
                                let shift = 8 - bits - bit_pos;
                                let mask = (1u8 << bits) - 1;
                                let idx_val = (current_byte >> shift) & mask;
                                bit_pos += bits;
                                let pal_idx = (idx_val as usize).min(palette.len() - 1);
                                let color = &palette[pal_idx];
                                let idx = ((ty + row) * w + tx + col) * 4;
                                if idx + 3 < pixels.len() {
                                    pixels[idx..idx + 4].copy_from_slice(color);
                                }
                            }
                        }
                    }
                } else if subencoding == 128 {
                    let total = tile_w * tile_h;
                    let mut count = 0;
                    while count < total {
                        let color = read_cpixel(&mut decoder, cpix_len, &self.pixel_format)?;
                        let run_len = read_rle_length(&mut decoder)? + 1;
                        for _ in 0..run_len {
                            let row = count / tile_w;
                            let col = count % tile_w;
                            let idx = ((ty + row) * w + tx + col) * 4;
                            if idx + 3 < pixels.len() {
                                pixels[idx..idx + 4].copy_from_slice(&color);
                            }
                            count += 1;
                            if count >= total {
                                break;
                            }
                        }
                    }
                } else if subencoding >= 130 {
                    let palette_size = (subencoding - 128) as usize;
                    let mut palette = Vec::with_capacity(palette_size);
                    for _ in 0..palette_size {
                        palette.push(read_cpixel(&mut decoder, cpix_len, &self.pixel_format)?);
                    }

                    let total = tile_w * tile_h;
                    let mut count = 0;
                    while count < total {
                        let pal_idx_byte = read_u8_from(&mut decoder)?;
                        let run = pal_idx_byte & 0x80 != 0;
                        let pal_idx = (pal_idx_byte & 0x7F) as usize;
                        let color = palette
                            .get(pal_idx)
                            .cloned()
                            .unwrap_or([0, 0, 0, 255]);

                        let run_len = if run {
                            read_rle_length(&mut decoder)? + 1
                        } else {
                            1
                        };

                        for _ in 0..run_len {
                            let row = count / tile_w;
                            let col = count % tile_w;
                            let idx = ((ty + row) * w + tx + col) * 4;
                            if idx + 3 < pixels.len() {
                                pixels[idx..idx + 4].copy_from_slice(&color);
                            }
                            count += 1;
                            if count >= total {
                                break;
                            }
                        }
                    }
                }

                tx += 64;
            }
            ty += 64;
        }

        Ok(DecodedRect {
            x: header.x,
            y: header.y,
            width: header.width,
            height: header.height,
            pixels,
        })
    }

    // ── Zlib encoding (type 6) ──────────────────────────────────────────

    fn decode_zlib(
        &mut self,
        conn: &mut super::rfb::RfbConnection,
        header: &RectHeader,
    ) -> Result<DecodedRect, ArdError> {
        let compressed_len = conn.read_u32()? as usize;
        let mut compressed = vec![0u8; compressed_len];
        conn.read_exact(&mut compressed)?;

        let mut decoder = ZlibDecoder::new(&compressed[..]);
        let bpp = self.pixel_format.bytes_per_pixel();
        let pixel_count = header.width as usize * header.height as usize;
        let mut raw = vec![0u8; pixel_count * bpp];
        decoder
            .read_exact(&mut raw)
            .map_err(|e| ArdError::Decoding(format!("zlib decode: {e}")))?;

        let pixels = self.pixel_format.convert_to_rgba(&raw, pixel_count);

        Ok(DecodedRect {
            x: header.x,
            y: header.y,
            width: header.width,
            height: header.height,
            pixels,
        })
    }

    // ── Apple JPEG encoding ─────────────────────────────────────────────

    fn decode_apple_jpeg(
        &self,
        conn: &mut super::rfb::RfbConnection,
        header: &RectHeader,
    ) -> Result<DecodedRect, ArdError> {
        let jpeg_len = conn.read_u32()? as usize;
        let mut jpeg_data = vec![0u8; jpeg_len];
        conn.read_exact(&mut jpeg_data)?;

        let img = image::load_from_memory_with_format(&jpeg_data, image::ImageFormat::Jpeg)
            .map_err(|e| ArdError::Decoding(format!("Apple JPEG decode: {e}")))?;

        let rgba = img.to_rgba8();
        let (iw, ih) = (rgba.width() as u16, rgba.height() as u16);

        let pixels = if iw == header.width && ih == header.height {
            rgba.into_raw()
        } else {
            let resized = image::imageops::resize(
                &rgba,
                header.width as u32,
                header.height as u32,
                image::imageops::FilterType::Nearest,
            );
            resized.into_raw()
        };

        Ok(DecodedRect {
            x: header.x,
            y: header.y,
            width: header.width,
            height: header.height,
            pixels,
        })
    }

    // ── Pseudo-encodings ────────────────────────────────────────────────

    fn handle_desktop_size(&self, header: &RectHeader) -> Result<DecodedRect, ArdError> {
        log::info!("Desktop resize → {}x{}", header.width, header.height);
        Ok(DecodedRect {
            x: 0,
            y: 0,
            width: header.width,
            height: header.height,
            pixels: Vec::new(),
        })
    }

    fn handle_cursor(
        &self,
        conn: &mut super::rfb::RfbConnection,
        header: &RectHeader,
    ) -> Result<DecodedRect, ArdError> {
        let bpp = self.pixel_format.bytes_per_pixel();
        let w = header.width as usize;
        let h = header.height as usize;

        let pixel_count = w * h;
        let mut cursor_data = vec![0u8; pixel_count * bpp];
        conn.read_exact(&mut cursor_data)?;

        let mask_row_bytes = (w + 7) / 8;
        let mut mask = vec![0u8; mask_row_bytes * h];
        conn.read_exact(&mut mask)?;

        let mut pixels = self.pixel_format.convert_to_rgba(&cursor_data, pixel_count);

        for row in 0..h {
            for col in 0..w {
                let mask_byte = mask[row * mask_row_bytes + col / 8];
                let mask_bit = (mask_byte >> (7 - (col % 8))) & 1;
                let idx = (row * w + col) * 4;
                if idx + 3 < pixels.len() {
                    pixels[idx + 3] = if mask_bit == 1 { 255 } else { 0 };
                }
            }
        }

        Ok(DecodedRect {
            x: header.x,
            y: header.y,
            width: header.width,
            height: header.height,
            pixels,
        })
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    fn read_pixel_value(&self, raw: &[u8]) -> u32 {
        let bpp = self.pixel_format.bytes_per_pixel();
        match bpp {
            1 => raw[0] as u32,
            2 => {
                if self.pixel_format.big_endian {
                    u16::from_be_bytes([raw[0], raw[1]]) as u32
                } else {
                    u16::from_le_bytes([raw[0], raw[1]]) as u32
                }
            }
            4 => {
                if self.pixel_format.big_endian {
                    u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]])
                } else {
                    u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]])
                }
            }
            _ => 0,
        }
    }
}

// ── ZRLE helpers ─────────────────────────────────────────────────────────

fn read_u8_from<R: Read>(r: &mut R) -> Result<u8, ArdError> {
    let mut buf = [0u8; 1];
    r.read_exact(&mut buf)
        .map_err(|e| ArdError::Decoding(format!("ZRLE read: {e}")))?;
    Ok(buf[0])
}

fn read_cpixel<R: Read>(
    r: &mut R,
    cpix_len: usize,
    pf: &PixelFormat,
) -> Result<[u8; 4], ArdError> {
    let mut buf = [0u8; 4];
    r.read_exact(&mut buf[..cpix_len])
        .map_err(|e| ArdError::Decoding(format!("CPIXEL read: {e}")))?;

    if cpix_len == 3 {
        Ok([buf[2], buf[1], buf[0], 255])
    } else {
        let raw = match cpix_len {
            1 => buf[0] as u32,
            2 => {
                if pf.big_endian {
                    u16::from_be_bytes([buf[0], buf[1]]) as u32
                } else {
                    u16::from_le_bytes([buf[0], buf[1]]) as u32
                }
            }
            4 => {
                if pf.big_endian {
                    u32::from_be_bytes(buf)
                } else {
                    u32::from_le_bytes(buf)
                }
            }
            _ => 0,
        };
        Ok(pf.pixel_to_rgba(raw))
    }
}

fn read_rle_length<R: Read>(r: &mut R) -> Result<usize, ArdError> {
    let mut length = 0usize;
    loop {
        let b = read_u8_from(r)?;
        length += b as usize;
        if b != 255 {
            break;
        }
    }
    Ok(length)
}

/// List of encodings to request from the server, in preference order.
pub fn preferred_encodings() -> Vec<i32> {
    vec![
        rfb::encoding::ZRLE,
        rfb::encoding::HEXTILE,
        rfb::encoding::ZLIB,
        rfb::encoding::RRE,
        rfb::encoding::COPY_RECT,
        rfb::encoding::RAW,
        rfb::encoding::APPLE_JPEG,
        rfb::encoding::CURSOR,
        rfb::encoding::DESKTOP_SIZE,
        rfb::encoding::APPLE_CLIPBOARD,
        rfb::encoding::APPLE_FILE_TRANSFER,
        rfb::encoding::APPLE_CURTAIN,
        rfb::encoding::APPLE_RETINA,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferred_encodings_is_nonempty() {
        let encs = preferred_encodings();
        assert!(!encs.is_empty());
        assert!(encs.contains(&rfb::encoding::ZRLE));
        assert!(encs.contains(&rfb::encoding::RAW));
        assert!(encs.contains(&rfb::encoding::APPLE_JPEG));
    }

    #[test]
    fn decoded_rect_creation() {
        let rect = DecodedRect {
            x: 10,
            y: 20,
            width: 100,
            height: 50,
            pixels: vec![0; 100 * 50 * 4],
        };
        assert_eq!(rect.pixels.len(), 20_000);
    }
}

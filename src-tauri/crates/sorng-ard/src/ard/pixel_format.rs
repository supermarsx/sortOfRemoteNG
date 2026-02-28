//! Pixel format negotiation and conversion for the RFB protocol layer.
//!
//! The RFB spec encodes pixel format as a fixed 16-byte structure.  Apple
//! Remote Desktop servers typically default to 32-bit ARGB but may also
//! advertise 16-bit formats.  This module handles parsing, building, and
//! converting between pixel formats.

use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read, Write};

use super::errors::ArdError;

/// RFB pixel format (16 bytes on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PixelFormat {
    pub bits_per_pixel: u8,
    pub depth: u8,
    pub big_endian: bool,
    pub true_colour: bool,
    pub red_max: u16,
    pub green_max: u16,
    pub blue_max: u16,
    pub red_shift: u8,
    pub green_shift: u8,
    pub blue_shift: u8,
}

impl PixelFormat {
    // ── Well-known formats ───────────────────────────────────────────────

    /// 32-bit ARGB (Apple default).
    pub const ARGB8888: Self = Self {
        bits_per_pixel: 32,
        depth: 24,
        big_endian: true,
        true_colour: true,
        red_max: 255,
        green_max: 255,
        blue_max: 255,
        red_shift: 16,
        green_shift: 8,
        blue_shift: 0,
    };

    /// 32-bit BGRA (Windows-friendly).
    pub const BGRA8888: Self = Self {
        bits_per_pixel: 32,
        depth: 24,
        big_endian: false,
        true_colour: true,
        red_max: 255,
        green_max: 255,
        blue_max: 255,
        red_shift: 16,
        green_shift: 8,
        blue_shift: 0,
    };

    /// 16-bit RGB565.
    pub const RGB565: Self = Self {
        bits_per_pixel: 16,
        depth: 16,
        big_endian: true,
        true_colour: true,
        red_max: 31,
        green_max: 63,
        blue_max: 31,
        red_shift: 11,
        green_shift: 5,
        blue_shift: 0,
    };

    // ── Wire format ──────────────────────────────────────────────────────

    /// Decode a 16-byte RFB pixel-format from a reader.
    pub fn read_from<R: Read>(r: &mut R) -> Result<Self, ArdError> {
        let bits_per_pixel = r.read_u8().map_err(ArdError::Io)?;
        let depth = r.read_u8().map_err(ArdError::Io)?;
        let big_endian = r.read_u8().map_err(ArdError::Io)? != 0;
        let true_colour = r.read_u8().map_err(ArdError::Io)? != 0;
        let red_max = r.read_u16::<BigEndian>().map_err(ArdError::Io)?;
        let green_max = r.read_u16::<BigEndian>().map_err(ArdError::Io)?;
        let blue_max = r.read_u16::<BigEndian>().map_err(ArdError::Io)?;
        let red_shift = r.read_u8().map_err(ArdError::Io)?;
        let green_shift = r.read_u8().map_err(ArdError::Io)?;
        let blue_shift = r.read_u8().map_err(ArdError::Io)?;

        // 3 bytes of padding
        let mut pad = [0u8; 3];
        r.read_exact(&mut pad).map_err(ArdError::Io)?;

        Ok(Self {
            bits_per_pixel,
            depth,
            big_endian,
            true_colour,
            red_max,
            green_max,
            blue_max,
            red_shift,
            green_shift,
            blue_shift,
        })
    }

    /// Encode as 16 bytes suitable for the wire.
    pub fn write_to<W: Write>(&self, w: &mut W) -> Result<(), ArdError> {
        w.write_u8(self.bits_per_pixel).map_err(ArdError::Io)?;
        w.write_u8(self.depth).map_err(ArdError::Io)?;
        w.write_u8(u8::from(self.big_endian)).map_err(ArdError::Io)?;
        w.write_u8(u8::from(self.true_colour)).map_err(ArdError::Io)?;
        w.write_u16::<BigEndian>(self.red_max).map_err(ArdError::Io)?;
        w.write_u16::<BigEndian>(self.green_max).map_err(ArdError::Io)?;
        w.write_u16::<BigEndian>(self.blue_max).map_err(ArdError::Io)?;
        w.write_u8(self.red_shift).map_err(ArdError::Io)?;
        w.write_u8(self.green_shift).map_err(ArdError::Io)?;
        w.write_u8(self.blue_shift).map_err(ArdError::Io)?;
        w.write_all(&[0u8; 3]).map_err(ArdError::Io)?; // padding
        Ok(())
    }

    /// Bytes per pixel.
    pub const fn bytes_per_pixel(&self) -> usize {
        (self.bits_per_pixel as usize + 7) / 8
    }

    /// Human-readable label.
    pub fn label(&self) -> String {
        if self.bits_per_pixel == 32 && self.big_endian {
            "ARGB8888".into()
        } else if self.bits_per_pixel == 32 {
            "BGRA8888".into()
        } else if self.bits_per_pixel == 16 {
            "RGB565".into()
        } else {
            format!("{}bpp", self.bits_per_pixel)
        }
    }

    // ── Pixel conversion ─────────────────────────────────────────────────

    /// Convert a single pixel from this format to RGBA8 (R, G, B, A).
    pub fn pixel_to_rgba(&self, raw: u32) -> [u8; 4] {
        let r = ((raw >> self.red_shift) & (self.red_max as u32)) as u16;
        let g = ((raw >> self.green_shift) & (self.green_max as u32)) as u16;
        let b = ((raw >> self.blue_shift) & (self.blue_max as u32)) as u16;

        // Scale up to 0..255 (if max < 255).
        let r8 = if self.red_max > 0 {
            (r as u32 * 255 / self.red_max as u32) as u8
        } else {
            0
        };
        let g8 = if self.green_max > 0 {
            (g as u32 * 255 / self.green_max as u32) as u8
        } else {
            0
        };
        let b8 = if self.blue_max > 0 {
            (b as u32 * 255 / self.blue_max as u32) as u8
        } else {
            0
        };

        [r8, g8, b8, 255]
    }

    /// Convert a buffer of raw pixels in this format to a Vec of RGBA8.
    pub fn convert_to_rgba(&self, src: &[u8], pixel_count: usize) -> Vec<u8> {
        let bpp = self.bytes_per_pixel();
        let mut out = Vec::with_capacity(pixel_count * 4);

        for i in 0..pixel_count {
            let offset = i * bpp;
            if offset + bpp > src.len() {
                break;
            }

            let raw = match bpp {
                1 => src[offset] as u32,
                2 => {
                    if self.big_endian {
                        u16::from_be_bytes([src[offset], src[offset + 1]]) as u32
                    } else {
                        u16::from_le_bytes([src[offset], src[offset + 1]]) as u32
                    }
                }
                4 => {
                    if self.big_endian {
                        u32::from_be_bytes([
                            src[offset],
                            src[offset + 1],
                            src[offset + 2],
                            src[offset + 3],
                        ])
                    } else {
                        u32::from_le_bytes([
                            src[offset],
                            src[offset + 1],
                            src[offset + 2],
                            src[offset + 3],
                        ])
                    }
                }
                _ => 0,
            };

            let [r, g, b, a] = self.pixel_to_rgba(raw);
            out.push(r);
            out.push(g);
            out.push(b);
            out.push(a);
        }

        out
    }
}

impl Default for PixelFormat {
    fn default() -> Self {
        Self::ARGB8888
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_wire_format() {
        let fmt = PixelFormat::ARGB8888;
        let mut buf = Vec::new();
        fmt.write_to(&mut buf).unwrap();
        assert_eq!(buf.len(), 16);

        let decoded = PixelFormat::read_from(&mut Cursor::new(&buf)).unwrap();
        assert_eq!(decoded, fmt);
    }

    #[test]
    fn pixel_conversion_argb() {
        let fmt = PixelFormat::ARGB8888;
        // Raw ARGB: A=0xFF, R=0x80, G=0x40, B=0x20 → big-endian 0xFF804020
        let raw = 0xFF80_4020u32;
        let [r, g, b, a] = fmt.pixel_to_rgba(raw);
        assert_eq!(r, 0x80);
        assert_eq!(g, 0x40);
        assert_eq!(b, 0x20);
        assert_eq!(a, 255);
    }

    #[test]
    fn pixel_conversion_rgb565() {
        let fmt = PixelFormat::RGB565;
        // R=31(max), G=0, B=0 → 0b11111_000000_00000 = 0xF800
        let raw = 0xF800u32;
        let [r, _g, _b, _a] = fmt.pixel_to_rgba(raw);
        assert_eq!(r, 255); // 31 * 255 / 31
    }

    #[test]
    fn bytes_per_pixel() {
        assert_eq!(PixelFormat::ARGB8888.bytes_per_pixel(), 4);
        assert_eq!(PixelFormat::RGB565.bytes_per_pixel(), 2);
    }

    #[test]
    fn convert_buffer_to_rgba() {
        let fmt = PixelFormat::BGRA8888;
        // BGRA little-endian: B=0x10, G=0x20, R=0x30, A=0xFF
        let src = [0x10, 0x20, 0x30, 0xFF];
        let rgba = fmt.convert_to_rgba(&src, 1);
        assert_eq!(rgba.len(), 4);
        // With BGRA8888 (little-endian, shifts R=16,G=8,B=0):
        // raw = u32::from_le_bytes = 0xFF302010
        // R = (0xFF302010 >> 16) & 255 = 0x30 = 48
        assert_eq!(rgba[0], 0x30);
    }
}

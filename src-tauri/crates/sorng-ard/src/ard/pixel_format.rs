//! RFB pixel format handling.
//!
//! The PixelFormat describes how pixel data is encoded on the wire in
//! the RFB / VNC protocol (and by extension ARD).

use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

/// RFB PIXEL_FORMAT structure (16 bytes on the wire).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// 32-bit ARGB (macOS native).
    pub const ARGB8888: PixelFormat = PixelFormat {
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

    /// 32-bit BGRA (Windows native).
    pub const BGRA8888: PixelFormat = PixelFormat {
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
    pub const RGB565: PixelFormat = PixelFormat {
        bits_per_pixel: 16,
        depth: 16,
        big_endian: false,
        true_colour: true,
        red_max: 31,
        green_max: 63,
        blue_max: 31,
        red_shift: 11,
        green_shift: 5,
        blue_shift: 0,
    };

    /// Bytes per pixel derived from bits_per_pixel.
    pub fn bytes_per_pixel(&self) -> usize {
        (self.bits_per_pixel as usize + 7) / 8
    }

    /// Human-readable label.
    pub fn label(&self) -> String {
        format!(
            "{}bpp depth={} {}",
            self.bits_per_pixel,
            self.depth,
            if self.big_endian { "BE" } else { "LE" }
        )
    }

    /// Read a 16-byte PIXEL_FORMAT from a stream.
    pub fn read_from<R: Read>(r: &mut R) -> io::Result<Self> {
        let mut buf = [0u8; 16];
        r.read_exact(&mut buf)?;
        Ok(Self {
            bits_per_pixel: buf[0],
            depth: buf[1],
            big_endian: buf[2] != 0,
            true_colour: buf[3] != 0,
            red_max: u16::from_be_bytes([buf[4], buf[5]]),
            green_max: u16::from_be_bytes([buf[6], buf[7]]),
            blue_max: u16::from_be_bytes([buf[8], buf[9]]),
            red_shift: buf[10],
            green_shift: buf[11],
            blue_shift: buf[12],
            // buf[13..16] = padding
        })
    }

    /// Write the 16-byte PIXEL_FORMAT to a stream.
    pub fn write_to<W: Write>(&self, w: &mut W) -> io::Result<()> {
        let mut buf = [0u8; 16];
        buf[0] = self.bits_per_pixel;
        buf[1] = self.depth;
        buf[2] = self.big_endian as u8;
        buf[3] = self.true_colour as u8;
        buf[4..6].copy_from_slice(&self.red_max.to_be_bytes());
        buf[6..8].copy_from_slice(&self.green_max.to_be_bytes());
        buf[8..10].copy_from_slice(&self.blue_max.to_be_bytes());
        buf[10] = self.red_shift;
        buf[11] = self.green_shift;
        buf[12] = self.blue_shift;
        w.write_all(&buf)
    }

    /// Convert a raw pixel value to [R, G, B, A].
    pub fn pixel_to_rgba(&self, raw: u32) -> [u8; 4] {
        if !self.true_colour {
            return [0, 0, 0, 255];
        }
        let r = ((raw >> self.red_shift) & self.red_max as u32) * 255
            / self.red_max.max(1) as u32;
        let g = ((raw >> self.green_shift) & self.green_max as u32) * 255
            / self.green_max.max(1) as u32;
        let b = ((raw >> self.blue_shift) & self.blue_max as u32) * 255
            / self.blue_max.max(1) as u32;
        [r as u8, g as u8, b as u8, 255]
    }

    /// Convert a buffer of raw pixels to RGBA8 format.
    pub fn convert_to_rgba(&self, data: &[u8], pixel_count: usize) -> Vec<u8> {
        let bpp = self.bytes_per_pixel();
        let mut rgba = Vec::with_capacity(pixel_count * 4);

        for i in 0..pixel_count {
            let offset = i * bpp;
            if offset + bpp > data.len() {
                rgba.extend_from_slice(&[0, 0, 0, 255]);
                continue;
            }

            let raw = match bpp {
                1 => data[offset] as u32,
                2 => {
                    if self.big_endian {
                        u16::from_be_bytes([data[offset], data[offset + 1]]) as u32
                    } else {
                        u16::from_le_bytes([data[offset], data[offset + 1]]) as u32
                    }
                }
                4 => {
                    if self.big_endian {
                        u32::from_be_bytes([
                            data[offset],
                            data[offset + 1],
                            data[offset + 2],
                            data[offset + 3],
                        ])
                    } else {
                        u32::from_le_bytes([
                            data[offset],
                            data[offset + 1],
                            data[offset + 2],
                            data[offset + 3],
                        ])
                    }
                }
                3 => {
                    if self.big_endian {
                        ((data[offset] as u32) << 16)
                            | ((data[offset + 1] as u32) << 8)
                            | (data[offset + 2] as u32)
                    } else {
                        (data[offset] as u32)
                            | ((data[offset + 1] as u32) << 8)
                            | ((data[offset + 2] as u32) << 16)
                    }
                }
                _ => 0,
            };

            let [r, g, b, a] = self.pixel_to_rgba(raw);
            rgba.push(r);
            rgba.push(g);
            rgba.push(b);
            rgba.push(a);
        }

        rgba
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argb8888_properties() {
        let pf = PixelFormat::ARGB8888;
        assert_eq!(pf.bytes_per_pixel(), 4);
        assert!(pf.label().contains("32bpp"));
    }

    #[test]
    fn pixel_to_rgba_argb() {
        let pf = PixelFormat::ARGB8888;
        let [r, g, b, a] = pf.pixel_to_rgba(0x00FF8040);
        assert_eq!(r, 255);
        assert_eq!(g, 128);
        assert_eq!(b, 64);
        assert_eq!(a, 255);
    }

    #[test]
    fn wire_roundtrip() {
        let pf = PixelFormat::ARGB8888;
        let mut buf = Vec::new();
        pf.write_to(&mut buf).unwrap();
        assert_eq!(buf.len(), 16);

        let pf2 = PixelFormat::read_from(&mut &buf[..]).unwrap();
        assert_eq!(pf2.bits_per_pixel, 32);
        assert_eq!(pf2.red_shift, 16);
    }

    #[test]
    fn convert_to_rgba_simple() {
        let pf = PixelFormat::ARGB8888;
        let raw = 0x00FF0000u32.to_be_bytes();
        let rgba = pf.convert_to_rgba(&raw, 1);
        assert_eq!(rgba.len(), 4);
        assert_eq!(rgba[0], 255); // R
        assert_eq!(rgba[1], 0);   // G
        assert_eq!(rgba[2], 0);   // B
    }

    #[test]
    fn rgb565_conversion() {
        let pf = PixelFormat::RGB565;
        assert_eq!(pf.bytes_per_pixel(), 2);
        // 0xF800 = full red in RGB565
        let [r, _g, _b, _a] = pf.pixel_to_rgba(0xF800);
        assert_eq!(r, 255);
    }
}

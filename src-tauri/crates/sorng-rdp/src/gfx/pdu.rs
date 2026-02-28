//! RDPGFX PDU types per MS-RDPEGFX specification.
//!
//! All wire formats are little-endian.

use ironrdp_core::{Encode, EncodeResult, WriteCursor};
use ironrdp_dvc::DvcEncode;

// ─── RDPGFX Header ─────────────────────────────────────────────────────

pub const RDPGFX_HEADER_SIZE: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum GfxCmdId {
    WireToSurface1 = 0x0001,
    WireToSurface2 = 0x0002,
    DeleteEncodingCtx = 0x0003,
    SolidFill = 0x0004,
    SurfaceToSurface = 0x0005,
    SurfaceToCache = 0x0006,
    CacheToSurface = 0x0007,
    EvictCacheEntry = 0x0008,
    CreateSurface = 0x0009,
    DeleteSurface = 0x000A,
    StartFrame = 0x000B,
    EndFrame = 0x000C,
    FrameAcknowledge = 0x000D,
    ResetGraphics = 0x000E,
    MapSurfaceToOutput = 0x0015,
    CapsAdvertise = 0x0012,
    CapsConfirm = 0x0013,
    MapSurfaceToScaled = 0x0077,
}

#[derive(Debug)]
pub struct GfxHeader {
    pub cmd_id: u16,
    pub flags: u16,
    pub pdu_length: u32,
}

impl GfxHeader {
    pub fn parse(data: &[u8]) -> Result<Self, GfxParseError> {
        if data.len() < RDPGFX_HEADER_SIZE {
            return Err(GfxParseError("GFX header too short"));
        }
        Ok(GfxHeader {
            cmd_id: u16::from_le_bytes([data[0], data[1]]),
            flags: u16::from_le_bytes([data[2], data[3]]),
            pdu_length: u32::from_le_bytes([data[4], data[5], data[6], data[7]]),
        })
    }
}

// ─── Capability Versions ────────────────────────────────────────────────

pub const CAPVERSION_8: u32 = 0x00080004;
pub const CAPVERSION_81: u32 = 0x00080105;
pub const CAPVERSION_10: u32 = 0x000A0002; // AVC420
pub const CAPVERSION_101: u32 = 0x000A0100; // AVC444
pub const CAPVERSION_102: u32 = 0x000A0200;
pub const CAPVERSION_103: u32 = 0x000A0301;
pub const CAPVERSION_104: u32 = 0x000A0400;

// ─── Codec IDs ──────────────────────────────────────────────────────────

pub const CODEC_UNCOMPRESSED: u16 = 0x0000;
pub const CODEC_PLANAR: u16 = 0x0001;
pub const CODEC_CAVIDEO: u16 = 0x0003; // AVC420
pub const CODEC_CLEARCODEC: u16 = 0x0008;
pub const CODEC_ALPHA: u16 = 0x000C;
pub const CODEC_AVC444: u16 = 0x000E;
pub const CODEC_AVC444V2: u16 = 0x000F;

// ─── Rect ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct GfxRect16 {
    pub left: u16,
    pub top: u16,
    pub right: u16,
    pub bottom: u16,
}

impl GfxRect16 {
    pub fn parse(data: &[u8]) -> Result<Self, GfxParseError> {
        if data.len() < 8 {
            return Err(GfxParseError("GfxRect16 too short"));
        }
        Ok(GfxRect16 {
            left: u16::from_le_bytes([data[0], data[1]]),
            top: u16::from_le_bytes([data[2], data[3]]),
            right: u16::from_le_bytes([data[4], data[5]]),
            bottom: u16::from_le_bytes([data[6], data[7]]),
        })
    }
}

// ─── Server -> Client PDUs ──────────────────────────────────────────────

#[derive(Debug)]
pub struct CapsConfirm {
    pub version: u32,
    pub flags: u32,
}

impl CapsConfirm {
    pub fn parse(body: &[u8]) -> Result<Self, GfxParseError> {
        // capSet: version(u32) + capsDataLength(u32) [+ flags(u32) if capsDataLength >= 4]
        if body.len() < 8 {
            return Err(GfxParseError("CapsConfirm too short"));
        }
        let version = u32::from_le_bytes([body[0], body[1], body[2], body[3]]);
        let cap_data_len = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
        let flags = if cap_data_len >= 4 && body.len() >= 12 {
            u32::from_le_bytes([body[8], body[9], body[10], body[11]])
        } else {
            0
        };
        Ok(CapsConfirm { version, flags })
    }
}

#[derive(Debug)]
pub struct CreateSurface {
    pub surface_id: u16,
    pub width: u16,
    pub height: u16,
    pub pixel_format: u8,
}

impl CreateSurface {
    pub fn parse(body: &[u8]) -> Result<Self, GfxParseError> {
        if body.len() < 7 {
            return Err(GfxParseError("CreateSurface too short"));
        }
        Ok(CreateSurface {
            surface_id: u16::from_le_bytes([body[0], body[1]]),
            width: u16::from_le_bytes([body[2], body[3]]),
            height: u16::from_le_bytes([body[4], body[5]]),
            pixel_format: body[6],
        })
    }
}

#[derive(Debug)]
pub struct DeleteSurface {
    pub surface_id: u16,
}

impl DeleteSurface {
    pub fn parse(body: &[u8]) -> Result<Self, GfxParseError> {
        if body.len() < 2 {
            return Err(GfxParseError("DeleteSurface too short"));
        }
        Ok(DeleteSurface {
            surface_id: u16::from_le_bytes([body[0], body[1]]),
        })
    }
}

#[derive(Debug)]
pub struct MapSurfaceToOutput {
    pub surface_id: u16,
    pub reserved: u16,
    pub output_origin_x: u32,
    pub output_origin_y: u32,
}

impl MapSurfaceToOutput {
    pub fn parse(body: &[u8]) -> Result<Self, GfxParseError> {
        if body.len() < 12 {
            return Err(GfxParseError("MapSurfaceToOutput too short"));
        }
        Ok(MapSurfaceToOutput {
            surface_id: u16::from_le_bytes([body[0], body[1]]),
            reserved: u16::from_le_bytes([body[2], body[3]]),
            output_origin_x: u32::from_le_bytes([body[4], body[5], body[6], body[7]]),
            output_origin_y: u32::from_le_bytes([body[8], body[9], body[10], body[11]]),
        })
    }
}

#[derive(Debug)]
pub struct StartFrame {
    pub timestamp: u32,
    pub frame_id: u32,
}

impl StartFrame {
    pub fn parse(body: &[u8]) -> Result<Self, GfxParseError> {
        if body.len() < 8 {
            return Err(GfxParseError("StartFrame too short"));
        }
        Ok(StartFrame {
            timestamp: u32::from_le_bytes([body[0], body[1], body[2], body[3]]),
            frame_id: u32::from_le_bytes([body[4], body[5], body[6], body[7]]),
        })
    }
}

#[derive(Debug)]
pub struct EndFrame {
    pub frame_id: u32,
}

impl EndFrame {
    pub fn parse(body: &[u8]) -> Result<Self, GfxParseError> {
        if body.len() < 4 {
            return Err(GfxParseError("EndFrame too short"));
        }
        Ok(EndFrame {
            frame_id: u32::from_le_bytes([body[0], body[1], body[2], body[3]]),
        })
    }
}

#[derive(Debug)]
pub struct ResetGraphics {
    pub width: u32,
    pub height: u32,
    pub monitor_count: u32,
}

impl ResetGraphics {
    pub fn parse(body: &[u8]) -> Result<Self, GfxParseError> {
        if body.len() < 12 {
            return Err(GfxParseError("ResetGraphics too short"));
        }
        Ok(ResetGraphics {
            width: u32::from_le_bytes([body[0], body[1], body[2], body[3]]),
            height: u32::from_le_bytes([body[4], body[5], body[6], body[7]]),
            monitor_count: u32::from_le_bytes([body[8], body[9], body[10], body[11]]),
        })
    }
}

#[derive(Debug)]
pub struct WireToSurface1 {
    pub surface_id: u16,
    pub codec_id: u16,
    pub pixel_format: u8,
    pub dest_rect: GfxRect16,
    pub bitmap_data: Vec<u8>,
}

impl WireToSurface1 {
    pub fn parse(body: &[u8]) -> Result<Self, GfxParseError> {
        // surfaceId(2) + codecId(2) + pixelFormat(1) + destRect(8) = 13 bytes header
        if body.len() < 13 {
            return Err(GfxParseError("WireToSurface1 too short"));
        }
        let surface_id = u16::from_le_bytes([body[0], body[1]]);
        let codec_id = u16::from_le_bytes([body[2], body[3]]);
        let pixel_format = body[4];
        let dest_rect = GfxRect16::parse(&body[5..13])?;
        let bitmap_data = body[13..].to_vec();
        Ok(WireToSurface1 {
            surface_id,
            codec_id,
            pixel_format,
            dest_rect,
            bitmap_data,
        })
    }
}

// ─── AVC420 Bitmap Stream ───────────────────────────────────────────────

#[derive(Debug)]
pub struct Avc420QuantQuality {
    pub quality_val: u8,
    pub progressive_val: u8,
}

#[derive(Debug)]
pub struct Avc420BitmapStream {
    pub region_rects: Vec<GfxRect16>,
    pub quant_qual_vals: Vec<Avc420QuantQuality>,
    pub h264_data: Vec<u8>,
}

impl Avc420BitmapStream {
    pub fn parse(data: &[u8]) -> Result<Self, GfxParseError> {
        if data.len() < 4 {
            return Err(GfxParseError("Avc420BitmapStream too short"));
        }

        let num_regions = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let mut offset = 4;

        // Parse region rects (8 bytes each)
        let mut region_rects = Vec::with_capacity(num_regions);
        for _ in 0..num_regions {
            if offset + 8 > data.len() {
                return Err(GfxParseError("Avc420 region rects truncated"));
            }
            region_rects.push(GfxRect16::parse(&data[offset..offset + 8])?);
            offset += 8;
        }

        // Parse quant/quality values (2 bytes each)
        let mut quant_qual_vals = Vec::with_capacity(num_regions);
        for _ in 0..num_regions {
            if offset + 2 > data.len() {
                return Err(GfxParseError("Avc420 quant vals truncated"));
            }
            quant_qual_vals.push(Avc420QuantQuality {
                quality_val: data[offset],
                progressive_val: data[offset + 1],
            });
            offset += 2;
        }

        // Remaining bytes are the H.264 bitstream
        let h264_data = data[offset..].to_vec();

        Ok(Avc420BitmapStream {
            region_rects,
            quant_qual_vals,
            h264_data,
        })
    }
}

// ─── Client -> Server PDUs (implement Encode + DvcEncode) ───────────────

/// RDPGFX_CAPS_ADVERTISE_PDU sent by client on channel start.
pub struct CapsAdvertisePdu {
    data: Vec<u8>,
}

impl CapsAdvertisePdu {
    /// Build a CAPS_ADVERTISE advertising CAPVERSION_8 and CAPVERSION_10 (AVC420).
    pub fn new_avc420() -> Self {
        let mut data = Vec::new();

        // capsSetCount: u16
        data.extend_from_slice(&2u16.to_le_bytes());

        // CapSet 1: CAPVERSION_8 (basic GFX, required baseline)
        data.extend_from_slice(&CAPVERSION_8.to_le_bytes()); // version
        data.extend_from_slice(&4u32.to_le_bytes()); // capsDataLength
        data.extend_from_slice(&0u32.to_le_bytes()); // flags

        // CapSet 2: CAPVERSION_10 (AVC420)
        data.extend_from_slice(&CAPVERSION_10.to_le_bytes()); // version
        data.extend_from_slice(&4u32.to_le_bytes()); // capsDataLength
        data.extend_from_slice(&0u32.to_le_bytes()); // flags

        Self { data }
    }
}

impl Encode for CapsAdvertisePdu {
    fn encode(&self, dst: &mut WriteCursor<'_>) -> EncodeResult<()> {
        // RDPGFX_HEADER
        dst.write_u16(GfxCmdId::CapsAdvertise as u16);
        dst.write_u16(0); // flags
        dst.write_u32((RDPGFX_HEADER_SIZE + self.data.len()) as u32);
        // Body
        dst.write_slice(&self.data);
        Ok(())
    }

    fn name(&self) -> &'static str {
        "RDPGFX_CAPS_ADVERTISE"
    }

    fn size(&self) -> usize {
        RDPGFX_HEADER_SIZE + self.data.len()
    }
}

impl DvcEncode for CapsAdvertisePdu {}

/// RDPGFX_FRAME_ACKNOWLEDGE_PDU sent after each EndFrame.
pub struct FrameAcknowledgePdu {
    pub queue_depth: u32,
    pub frame_id: u32,
    pub total_frames_decoded: u32,
}

impl Encode for FrameAcknowledgePdu {
    fn encode(&self, dst: &mut WriteCursor<'_>) -> EncodeResult<()> {
        // RDPGFX_HEADER
        dst.write_u16(GfxCmdId::FrameAcknowledge as u16);
        dst.write_u16(0); // flags
        dst.write_u32((RDPGFX_HEADER_SIZE + 12) as u32); // 12 bytes body
        // Body
        dst.write_u32(self.queue_depth);
        dst.write_u32(self.frame_id);
        dst.write_u32(self.total_frames_decoded);
        Ok(())
    }

    fn name(&self) -> &'static str {
        "RDPGFX_FRAME_ACKNOWLEDGE"
    }

    fn size(&self) -> usize {
        RDPGFX_HEADER_SIZE + 12
    }
}

impl DvcEncode for FrameAcknowledgePdu {}

// ─── Error Type ─────────────────────────────────────────────────────────

#[derive(Debug)]
pub struct GfxParseError(pub &'static str);

impl std::fmt::Display for GfxParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "GFX parse error: {}", self.0)
    }
}

impl std::error::Error for GfxParseError {}

#[cfg(test)]
mod tests {
    use super::*;

    // ── GfxHeader ───────────────────────────────────────────────────────

    #[test]
    fn gfx_header_parse_valid() {
        let data = [
            0x09, 0x00, // cmdId = CreateSurface (0x0009)
            0x00, 0x00, // flags = 0
            0x0F, 0x00, 0x00, 0x00, // pduLength = 15
        ];
        let hdr = GfxHeader::parse(&data).unwrap();
        assert_eq!(hdr.cmd_id, GfxCmdId::CreateSurface as u16);
        assert_eq!(hdr.flags, 0);
        assert_eq!(hdr.pdu_length, 15);
    }

    #[test]
    fn gfx_header_parse_too_short() {
        let data = [0x09, 0x00, 0x00]; // Only 3 bytes
        assert!(GfxHeader::parse(&data).is_err());
    }

    #[test]
    fn gfx_header_parse_exact_minimum() {
        let data = [0x01, 0x00, 0x03, 0x00, 0x08, 0x00, 0x00, 0x00];
        let hdr = GfxHeader::parse(&data).unwrap();
        assert_eq!(hdr.cmd_id, GfxCmdId::WireToSurface1 as u16);
        assert_eq!(hdr.flags, 3);
        assert_eq!(hdr.pdu_length, RDPGFX_HEADER_SIZE as u32);
    }

    #[test]
    fn gfx_header_parse_extra_data_ignored() {
        let mut data = vec![0x0B, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00];
        data.extend_from_slice(&[0xFF; 8]); // Extra bytes
        let hdr = GfxHeader::parse(&data).unwrap();
        assert_eq!(hdr.cmd_id, GfxCmdId::StartFrame as u16);
    }

    // ── GfxRect16 ───────────────────────────────────────────────────────

    #[test]
    fn gfx_rect16_parse_valid() {
        let data: [u8; 8] = [10, 0, 20, 0, 110, 0, 120, 0];
        let r = GfxRect16::parse(&data).unwrap();
        assert_eq!(r.left, 10);
        assert_eq!(r.top, 20);
        assert_eq!(r.right, 110);
        assert_eq!(r.bottom, 120);
    }

    #[test]
    fn gfx_rect16_parse_too_short() {
        assert!(GfxRect16::parse(&[0; 7]).is_err());
    }

    #[test]
    fn gfx_rect16_zero_rect() {
        let r = GfxRect16::parse(&[0u8; 8]).unwrap();
        assert_eq!(r.left, 0);
        assert_eq!(r.top, 0);
        assert_eq!(r.right, 0);
        assert_eq!(r.bottom, 0);
    }

    #[test]
    fn gfx_rect16_max_values() {
        let data = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
        let r = GfxRect16::parse(&data).unwrap();
        assert_eq!(r.left, u16::MAX);
        assert_eq!(r.right, u16::MAX);
    }

    // ── CreateSurface ───────────────────────────────────────────────────

    #[test]
    fn create_surface_parse_valid() {
        let body = [
            0x01, 0x00, // surface_id = 1
            0x00, 0x04, // width = 1024
            0x00, 0x03, // height = 768
            0x20,       // pixel_format = 32 (XRGB)
        ];
        let cs = CreateSurface::parse(&body).unwrap();
        assert_eq!(cs.surface_id, 1);
        assert_eq!(cs.width, 1024);
        assert_eq!(cs.height, 768);
        assert_eq!(cs.pixel_format, 0x20);
    }

    #[test]
    fn create_surface_parse_too_short() {
        assert!(CreateSurface::parse(&[0; 6]).is_err());
    }

    // ── DeleteSurface ───────────────────────────────────────────────────

    #[test]
    fn delete_surface_parse_valid() {
        let body = [0x05, 0x00];
        let ds = DeleteSurface::parse(&body).unwrap();
        assert_eq!(ds.surface_id, 5);
    }

    #[test]
    fn delete_surface_parse_too_short() {
        assert!(DeleteSurface::parse(&[0x05]).is_err());
    }

    // ── MapSurfaceToOutput ──────────────────────────────────────────────

    #[test]
    fn map_surface_to_output_parse_valid() {
        let body = [
            0x01, 0x00, // surface_id = 1
            0x00, 0x00, // reserved
            0x64, 0x00, 0x00, 0x00, // x = 100
            0xC8, 0x00, 0x00, 0x00, // y = 200
        ];
        let m = MapSurfaceToOutput::parse(&body).unwrap();
        assert_eq!(m.surface_id, 1);
        assert_eq!(m.output_origin_x, 100);
        assert_eq!(m.output_origin_y, 200);
    }

    #[test]
    fn map_surface_to_output_parse_too_short() {
        assert!(MapSurfaceToOutput::parse(&[0; 11]).is_err());
    }

    // ── StartFrame / EndFrame ───────────────────────────────────────────

    #[test]
    fn start_frame_parse_valid() {
        let body = [
            0x00, 0x10, 0x00, 0x00, // timestamp = 4096
            0x42, 0x00, 0x00, 0x00, // frame_id = 66
        ];
        let sf = StartFrame::parse(&body).unwrap();
        assert_eq!(sf.timestamp, 4096);
        assert_eq!(sf.frame_id, 66);
    }

    #[test]
    fn start_frame_parse_too_short() {
        assert!(StartFrame::parse(&[0; 7]).is_err());
    }

    #[test]
    fn end_frame_parse_valid() {
        let body = [0x42, 0x00, 0x00, 0x00];
        let ef = EndFrame::parse(&body).unwrap();
        assert_eq!(ef.frame_id, 66);
    }

    #[test]
    fn end_frame_parse_too_short() {
        assert!(EndFrame::parse(&[0; 3]).is_err());
    }

    // ── ResetGraphics ───────────────────────────────────────────────────

    #[test]
    fn reset_graphics_parse_valid() {
        let body = [
            0x00, 0x04, 0x00, 0x00, // width = 1024
            0x00, 0x03, 0x00, 0x00, // height = 768
            0x01, 0x00, 0x00, 0x00, // monitor_count = 1
        ];
        let rg = ResetGraphics::parse(&body).unwrap();
        assert_eq!(rg.width, 1024);
        assert_eq!(rg.height, 768);
        assert_eq!(rg.monitor_count, 1);
    }

    #[test]
    fn reset_graphics_parse_too_short() {
        assert!(ResetGraphics::parse(&[0; 11]).is_err());
    }

    // ── CapsConfirm ─────────────────────────────────────────────────────

    #[test]
    fn caps_confirm_parse_with_flags() {
        let body = [
            0x04, 0x00, 0x08, 0x00, // version = CAPVERSION_8
            0x04, 0x00, 0x00, 0x00, // capsDataLength = 4
            0x01, 0x00, 0x00, 0x00, // flags = 1
        ];
        let cc = CapsConfirm::parse(&body).unwrap();
        assert_eq!(cc.version, CAPVERSION_8);
        assert_eq!(cc.flags, 1);
    }

    #[test]
    fn caps_confirm_parse_without_flags() {
        let body = [
            0x02, 0x00, 0x0A, 0x00, // version = CAPVERSION_10
            0x00, 0x00, 0x00, 0x00, // capsDataLength = 0
        ];
        let cc = CapsConfirm::parse(&body).unwrap();
        assert_eq!(cc.version, CAPVERSION_10);
        assert_eq!(cc.flags, 0);
    }

    #[test]
    fn caps_confirm_parse_too_short() {
        assert!(CapsConfirm::parse(&[0; 7]).is_err());
    }

    // ── WireToSurface1 ─────────────────────────────────────────────────

    #[test]
    fn wire_to_surface1_parse_with_bitmap_data() {
        let mut body = vec![
            0x01, 0x00, // surface_id = 1
            0x03, 0x00, // codec_id = CODEC_CAVIDEO
            0x20,       // pixel_format
            // dest_rect (8 bytes)
            0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x30, 0x00,
        ];
        body.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]); // bitmap data
        let wts = WireToSurface1::parse(&body).unwrap();
        assert_eq!(wts.surface_id, 1);
        assert_eq!(wts.codec_id, CODEC_CAVIDEO);
        assert_eq!(wts.pixel_format, 0x20);
        assert_eq!(wts.bitmap_data, vec![0xDE, 0xAD, 0xBE, 0xEF]);
    }

    #[test]
    fn wire_to_surface1_parse_empty_bitmap() {
        let body = [
            0x01, 0x00, 0x00, 0x00, 0x20,
            0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x10, 0x00,
        ];
        let wts = WireToSurface1::parse(&body).unwrap();
        assert!(wts.bitmap_data.is_empty());
    }

    #[test]
    fn wire_to_surface1_parse_too_short() {
        assert!(WireToSurface1::parse(&[0; 12]).is_err());
    }

    // ── Avc420BitmapStream ──────────────────────────────────────────────

    #[test]
    fn avc420_parse_zero_regions() {
        let body = [0x00, 0x00, 0x00, 0x00]; // numRegions = 0
        let stream = Avc420BitmapStream::parse(&body).unwrap();
        assert!(stream.region_rects.is_empty());
        assert!(stream.quant_qual_vals.is_empty());
        assert!(stream.h264_data.is_empty());
    }

    #[test]
    fn avc420_parse_one_region() {
        let mut body = Vec::new();
        body.extend_from_slice(&1u32.to_le_bytes()); // numRegions = 1
        // region rect (8 bytes)
        body.extend_from_slice(&[0, 0, 0, 0, 64, 0, 48, 0]);
        // quant/quality (2 bytes)
        body.push(85);  // quality
        body.push(1);   // progressive
        // h264 data
        body.extend_from_slice(b"h264");
        let stream = Avc420BitmapStream::parse(&body).unwrap();
        assert_eq!(stream.region_rects.len(), 1);
        assert_eq!(stream.quant_qual_vals.len(), 1);
        assert_eq!(stream.quant_qual_vals[0].quality_val, 85);
        assert_eq!(stream.quant_qual_vals[0].progressive_val, 1);
        assert_eq!(stream.h264_data, b"h264");
    }

    #[test]
    fn avc420_parse_too_short() {
        assert!(Avc420BitmapStream::parse(&[0; 3]).is_err());
    }

    #[test]
    fn avc420_parse_truncated_rects() {
        let mut body = Vec::new();
        body.extend_from_slice(&2u32.to_le_bytes()); // numRegions = 2
        body.extend_from_slice(&[0; 8]); // Only 1 rect, not 2
        assert!(Avc420BitmapStream::parse(&body).is_err());
    }

    #[test]
    fn avc420_parse_truncated_quant() {
        let mut body = Vec::new();
        body.extend_from_slice(&1u32.to_le_bytes());
        body.extend_from_slice(&[0; 8]); // 1 rect
        // Missing quant/quality bytes
        assert!(Avc420BitmapStream::parse(&body).is_err());
    }

    // ── Constants ───────────────────────────────────────────────────────

    #[test]
    fn header_size_is_8() {
        assert_eq!(RDPGFX_HEADER_SIZE, 8);
    }

    #[test]
    fn codec_ids_are_distinct() {
        let ids = [CODEC_UNCOMPRESSED, CODEC_PLANAR, CODEC_CAVIDEO, CODEC_CLEARCODEC, CODEC_ALPHA, CODEC_AVC444, CODEC_AVC444V2];
        for (i, a) in ids.iter().enumerate() {
            for (j, b) in ids.iter().enumerate() {
                if i != j {
                    assert_ne!(a, b, "Codec IDs at positions {i} and {j} collide");
                }
            }
        }
    }

    // ── GfxParseError ───────────────────────────────────────────────────

    #[test]
    fn gfx_parse_error_display() {
        let err = GfxParseError("test error");
        assert_eq!(format!("{err}"), "GFX parse error: test error");
    }

    #[test]
    fn gfx_parse_error_is_error() {
        let err = GfxParseError("something");
        let _: &dyn std::error::Error = &err; // Compiles = implements Error
    }

    // ── CapsAdvertisePdu ────────────────────────────────────────────────

    #[test]
    fn caps_advertise_pdu_size() {
        let pdu = CapsAdvertisePdu::new_avc420();
        // Header(8) + capsSetCount(2) + 2 × capSet(version(4) + capsDataLength(4) + flags(4)) = 8 + 2 + 24 = 34
        assert_eq!(pdu.size(), RDPGFX_HEADER_SIZE + 2 + 24);
    }

    #[test]
    fn frame_acknowledge_pdu_size() {
        let pdu = FrameAcknowledgePdu {
            queue_depth: 1,
            frame_id: 42,
            total_frames_decoded: 100,
        };
        assert_eq!(pdu.size(), RDPGFX_HEADER_SIZE + 12);
    }
}

//! RDPGFX DVC processor — core state machine implementing the Graphics Pipeline Extension.

use std::sync::mpsc;

use ironrdp_core::impl_as_any;
use ironrdp_dvc::{DvcClientProcessor, DvcMessage, DvcProcessor};
use ironrdp_dvc::ironrdp_pdu::PduResult;

use crate::h264::{self, DecodedFrame, H264Decoder, H264DecoderPreference};

use super::pdu::*;
use super::surfaces::SurfaceManager;

/// Channel name for RDPGFX (MS-RDPEGFX).
pub const GFX_CHANNEL_NAME: &str = "Microsoft::Windows::RDS::Graphics";

/// A decoded GFX frame ready for display.
pub struct GfxFrame {
    /// Screen X coordinate (from surface mapping).
    pub screen_x: u16,
    /// Screen Y coordinate.
    pub screen_y: u16,
    /// Width of the update region.
    pub width: u16,
    /// Height of the update region.
    pub height: u16,
    /// RGBA32 pixel data.
    pub rgba: Vec<u8>,
}

/// GFX processor state.
pub struct GfxProcessor {
    surfaces: SurfaceManager,
    h264_decoder: Option<Box<dyn H264Decoder>>,
    decoder_preference: H264DecoderPreference,
    /// Negotiated capability version.
    cap_version: Option<u32>,
    /// Channel for sending decoded frames to the session loop.
    frame_tx: mpsc::Sender<GfxFrame>,
    /// Frame acknowledge tracking.
    total_frames_decoded: u32,
    current_frame_id: Option<u32>,
}

impl GfxProcessor {
    pub fn new(
        decoder_preference: H264DecoderPreference,
        frame_tx: mpsc::Sender<GfxFrame>,
    ) -> Self {
        Self {
            surfaces: SurfaceManager::new(),
            h264_decoder: None,
            decoder_preference,
            cap_version: None,
            frame_tx,
            total_frames_decoded: 0,
            current_frame_id: None,
        }
    }

    fn ensure_decoder(&mut self) {
        if self.h264_decoder.is_none() {
            match h264::create_decoder(self.decoder_preference) {
                Ok((dec, name)) => {
                    log::info!("GFX: H.264 decoder initialized: {name}");
                    self.h264_decoder = Some(dec);
                }
                Err(e) => {
                    log::error!("GFX: H.264 decoder init failed: {e}");
                }
            }
        }
    }

    fn handle_caps_confirm(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match CapsConfirm::parse(body) {
            Ok(caps) => {
                self.cap_version = Some(caps.version);
                log::info!(
                    "GFX: server confirmed capability version 0x{:08X} (flags=0x{:X})",
                    caps.version,
                    caps.flags
                );
            }
            Err(e) => log::warn!("GFX: CapsConfirm parse error: {e}"),
        }
        Vec::new()
    }

    fn handle_create_surface(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match CreateSurface::parse(body) {
            Ok(cs) => self.surfaces.create_surface(cs.surface_id, cs.width, cs.height),
            Err(e) => log::warn!("GFX: CreateSurface parse error: {e}"),
        }
        Vec::new()
    }

    fn handle_delete_surface(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match DeleteSurface::parse(body) {
            Ok(ds) => self.surfaces.delete_surface(ds.surface_id),
            Err(e) => log::warn!("GFX: DeleteSurface parse error: {e}"),
        }
        Vec::new()
    }

    fn handle_map_surface_to_output(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match MapSurfaceToOutput::parse(body) {
            Ok(ms) => self.surfaces.map_surface_to_output(
                ms.surface_id,
                ms.output_origin_x,
                ms.output_origin_y,
            ),
            Err(e) => log::warn!("GFX: MapSurfaceToOutput parse error: {e}"),
        }
        Vec::new()
    }

    fn handle_start_frame(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match StartFrame::parse(body) {
            Ok(sf) => {
                self.current_frame_id = Some(sf.frame_id);
            }
            Err(e) => log::warn!("GFX: StartFrame parse error: {e}"),
        }
        Vec::new()
    }

    fn handle_end_frame(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match EndFrame::parse(body) {
            Ok(_ef) => {
                if let Some(frame_id) = self.current_frame_id.take() {
                    self.total_frames_decoded += 1;

                    let ack = FrameAcknowledgePdu {
                        queue_depth: 0xFFFFFFFF, // QUEUE_DEPTH_AVAILABLE
                        frame_id,
                        total_frames_decoded: self.total_frames_decoded,
                    };
                    return vec![Box::new(ack) as DvcMessage];
                }
            }
            Err(e) => log::warn!("GFX: EndFrame parse error: {e}"),
        }
        Vec::new()
    }

    fn handle_reset_graphics(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        match ResetGraphics::parse(body) {
            Ok(rg) => {
                log::info!(
                    "GFX: ResetGraphics {}x{} monitors={}",
                    rg.width,
                    rg.height,
                    rg.monitor_count
                );
                self.surfaces.reset();
                self.h264_decoder = None;
            }
            Err(e) => log::warn!("GFX: ResetGraphics parse error: {e}"),
        }
        Vec::new()
    }

    fn handle_wire_to_surface_1(&mut self, body: &[u8]) -> Vec<DvcMessage> {
        let wts = match WireToSurface1::parse(body) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("GFX: WireToSurface1 parse error: {e}");
                return Vec::new();
            }
        };

        match wts.codec_id {
            CODEC_CAVIDEO => self.decode_avc420(&wts),
            CODEC_UNCOMPRESSED => self.handle_uncompressed(&wts),
            other => {
                log::debug!("GFX: unsupported codec_id 0x{other:04X} in WireToSurface1");
            }
        }

        Vec::new()
    }

    fn decode_avc420(&mut self, wts: &WireToSurface1) {
        let avc = match Avc420BitmapStream::parse(&wts.bitmap_data) {
            Ok(a) => a,
            Err(e) => {
                log::warn!("GFX: Avc420BitmapStream parse error: {e}");
                return;
            }
        };

        if avc.h264_data.is_empty() {
            return;
        }

        self.ensure_decoder();
        let decoder = match self.h264_decoder.as_mut() {
            Some(d) => d,
            None => return,
        };

        let frames: Vec<DecodedFrame> = match decoder.decode(&avc.h264_data) {
            Ok(f) => f,
            Err(e) => {
                log::warn!("GFX: H.264 decode error: {e}");
                return;
            }
        };

        for frame in frames {
            let dest_w = wts.dest_rect.right.saturating_sub(wts.dest_rect.left);
            let dest_h = wts.dest_rect.bottom.saturating_sub(wts.dest_rect.top);

            // Blit decoded RGBA into the target surface
            self.surfaces.blit_to_surface(
                wts.surface_id,
                &frame.rgba,
                frame.width,
                wts.dest_rect.left,
                wts.dest_rect.top,
                dest_w,
                dest_h,
            );

            // If this surface is mapped to the output, send the frame
            if let Some(surface) = self.surfaces.get_surface(wts.surface_id) {
                if let Some((ox, oy)) = surface.output_origin {
                    let screen_x = ox as u16 + wts.dest_rect.left;
                    let screen_y = oy as u16 + wts.dest_rect.top;
                    let _ = self.frame_tx.send(GfxFrame {
                        screen_x,
                        screen_y,
                        width: dest_w,
                        height: dest_h,
                        rgba: frame.rgba,
                    });
                }
            }
        }
    }

    fn handle_uncompressed(&mut self, wts: &WireToSurface1) {
        let dest_w = wts.dest_rect.right.saturating_sub(wts.dest_rect.left);
        let dest_h = wts.dest_rect.bottom.saturating_sub(wts.dest_rect.top);

        // Uncompressed data is raw pixels in the surface's pixel format.
        // For XRGB/ARGB 8888, it's 4 bytes per pixel in BGRA order.
        // Convert to RGBA for our pipeline.
        let pixel_count = dest_w as usize * dest_h as usize;
        let expected_len = pixel_count * 4;

        if wts.bitmap_data.len() < expected_len {
            return;
        }

        // Convert BGRX/BGRA -> RGBA
        let mut rgba = vec![0u8; expected_len];
        for i in 0..pixel_count {
            let src = i * 4;
            let dst = i * 4;
            rgba[dst] = wts.bitmap_data[src + 2]; // R
            rgba[dst + 1] = wts.bitmap_data[src + 1]; // G
            rgba[dst + 2] = wts.bitmap_data[src]; // B
            rgba[dst + 3] = 255; // A
        }

        self.surfaces.blit_to_surface(
            wts.surface_id,
            &rgba,
            dest_w as u32,
            wts.dest_rect.left,
            wts.dest_rect.top,
            dest_w,
            dest_h,
        );

        if let Some(surface) = self.surfaces.get_surface(wts.surface_id) {
            if let Some((ox, oy)) = surface.output_origin {
                let screen_x = ox as u16 + wts.dest_rect.left;
                let screen_y = oy as u16 + wts.dest_rect.top;
                let _ = self.frame_tx.send(GfxFrame {
                    screen_x,
                    screen_y,
                    width: dest_w,
                    height: dest_h,
                    rgba,
                });
            }
        }
    }
}

impl_as_any!(GfxProcessor);

impl DvcProcessor for GfxProcessor {
    fn channel_name(&self) -> &str {
        GFX_CHANNEL_NAME
    }

    fn start(&mut self, channel_id: u32) -> PduResult<Vec<DvcMessage>> {
        log::info!("GFX: DVC channel opened (id={channel_id}), sending CAPS_ADVERTISE");
        let caps = CapsAdvertisePdu::new_avc420();
        Ok(vec![Box::new(caps) as DvcMessage])
    }

    fn process(&mut self, _channel_id: u32, payload: &[u8]) -> PduResult<Vec<DvcMessage>> {
        let mut offset = 0;
        let mut all_responses = Vec::new();

        while offset + RDPGFX_HEADER_SIZE <= payload.len() {
            let header = match GfxHeader::parse(&payload[offset..]) {
                Ok(h) => h,
                Err(e) => {
                    log::warn!("GFX: header parse error at offset {offset}: {e}");
                    break;
                }
            };

            let pdu_len = header.pdu_length as usize;
            if pdu_len < RDPGFX_HEADER_SIZE || offset + pdu_len > payload.len() {
                log::warn!("GFX: truncated PDU at offset {offset} (pdu_len={pdu_len})");
                break;
            }

            let body = &payload[offset + RDPGFX_HEADER_SIZE..offset + pdu_len];

            let responses = match header.cmd_id {
                x if x == GfxCmdId::CapsConfirm as u16 => self.handle_caps_confirm(body),
                x if x == GfxCmdId::CreateSurface as u16 => self.handle_create_surface(body),
                x if x == GfxCmdId::DeleteSurface as u16 => self.handle_delete_surface(body),
                x if x == GfxCmdId::MapSurfaceToOutput as u16 => {
                    self.handle_map_surface_to_output(body)
                }
                x if x == GfxCmdId::StartFrame as u16 => self.handle_start_frame(body),
                x if x == GfxCmdId::EndFrame as u16 => self.handle_end_frame(body),
                x if x == GfxCmdId::WireToSurface1 as u16 => {
                    self.handle_wire_to_surface_1(body)
                }
                x if x == GfxCmdId::ResetGraphics as u16 => self.handle_reset_graphics(body),
                other => {
                    log::debug!("GFX: unhandled cmd_id 0x{other:04X}");
                    Vec::new()
                }
            };

            all_responses.extend(responses);
            offset += pdu_len;
        }

        Ok(all_responses)
    }

    fn close(&mut self, channel_id: u32) {
        log::info!("GFX: DVC channel closed (id={channel_id})");
        self.surfaces.reset();
        self.h264_decoder = None;
    }
}

impl DvcClientProcessor for GfxProcessor {}

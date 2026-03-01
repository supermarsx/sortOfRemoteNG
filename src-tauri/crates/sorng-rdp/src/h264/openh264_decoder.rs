//! Software H.264 decoder using Cisco's openh264 (BSD-licensed).

use openh264::decoder::Decoder;
use openh264::formats::YUVSource;
use super::{DecodedFrame, FrameBufferPool, H264Decoder, H264Error};

pub struct OpenH264SoftDecoder {
    decoder: Decoder,
    pool: FrameBufferPool,
}

impl OpenH264SoftDecoder {
    pub fn new() -> Result<Self, H264Error> {
        let decoder = Decoder::new()
            .map_err(|e| H264Error::InitFailed(format!("openh264: {e}")))?;
        Ok(Self { decoder, pool: FrameBufferPool::new(4) })
    }
}

impl H264Decoder for OpenH264SoftDecoder {
    fn decode(&mut self, nal_data: &[u8]) -> Result<Vec<DecodedFrame>, H264Error> {
        match self.decoder.decode(nal_data) {
            Ok(Some(yuv)) => {
                let (w, h) = yuv.dimensions();
                let width = w as u32;
                let height = h as u32;
                let out_size = w * h * 4;

                let mut rgba = self.pool.acquire(out_size);
                rgba.resize(out_size, 0);
                yuv.write_rgba8(&mut rgba);

                Ok(vec![DecodedFrame { width, height, rgba }])
            }
            Ok(None) => Ok(Vec::new()),
            Err(e) => Err(H264Error::DecodeFailed(format!("openh264: {e}"))),
        }
    }

    fn name(&self) -> &'static str {
        "openh264"
    }
}

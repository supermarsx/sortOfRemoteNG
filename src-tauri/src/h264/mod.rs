//! H.264 decoder abstraction with hardware (Media Foundation) and software (openh264) backends.

pub mod mf_decoder;
pub mod openh264_decoder;
pub mod yuv_convert;

use std::fmt;

/// A single decoded video frame.
pub struct DecodedFrame {
    pub width: u32,
    pub height: u32,
    /// RGBA32 pixel data, length = width * height * 4.
    pub rgba: Vec<u8>,
}

/// Errors from the H.264 decoder.
#[derive(Debug)]
pub enum H264Error {
    InitFailed(String),
    DecodeFailed(String),
    ConversionFailed(String),
}

impl fmt::Display for H264Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            H264Error::InitFailed(s) => write!(f, "H264 init failed: {s}"),
            H264Error::DecodeFailed(s) => write!(f, "H264 decode failed: {s}"),
            H264Error::ConversionFailed(s) => write!(f, "YUV conversion failed: {s}"),
        }
    }
}

impl std::error::Error for H264Error {}

/// Trait for H.264 decoders.
/// Implementations must be `Send` (they run on the RDP session thread).
pub trait H264Decoder: Send {
    /// Feed one or more NAL units (Annex B format with start codes).
    /// Returns zero or more decoded frames.  H.264 decoders may buffer
    /// frames, so the output count may differ from the input count.
    fn decode(&mut self, nal_data: &[u8]) -> Result<Vec<DecodedFrame>, H264Error>;

    /// Flush any buffered frames (e.g. at end of stream).
    fn flush(&mut self) -> Result<Vec<DecodedFrame>, H264Error> {
        Ok(Vec::new())
    }

    /// Human-readable name for logging.
    fn name(&self) -> &'static str;
}

/// Decoder selection preference.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum H264DecoderPreference {
    /// Try MF hardware first, fall back to openh264.
    Auto,
    /// Force Media Foundation (DXVA2 hardware).
    MediaFoundation,
    /// Force openh264 (software).
    OpenH264,
}

/// Create an H.264 decoder based on preference.
pub fn create_decoder(
    preference: H264DecoderPreference,
) -> Result<(Box<dyn H264Decoder>, &'static str), H264Error> {
    match preference {
        H264DecoderPreference::MediaFoundation => {
            let dec = mf_decoder::MfH264Decoder::new()?;
            Ok((Box::new(dec), "media-foundation"))
        }
        H264DecoderPreference::OpenH264 => {
            let dec = openh264_decoder::OpenH264SoftDecoder::new()?;
            Ok((Box::new(dec), "openh264"))
        }
        H264DecoderPreference::Auto => match mf_decoder::MfH264Decoder::new() {
            Ok(dec) => Ok((Box::new(dec), "media-foundation")),
            Err(e) => {
                log::warn!("MF H264 decoder init failed ({e}), falling back to openh264");
                let dec = openh264_decoder::OpenH264SoftDecoder::new()?;
                Ok((Box::new(dec), "openh264"))
            }
        },
    }
}

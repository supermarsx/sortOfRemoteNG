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

/// Reusable buffer pool to avoid per-frame Vec allocations.
///
/// At 1080p 30fps, RGBA output = ~8 MB/frame = ~249 MB/s heap churn.
/// This pool recycles up to `max_buffers` Vecs, using size-bucketed
/// bins so that a 720p buffer isn't returned for a 1080p request.
///
/// Buckets (by capacity):
///   - Small:  ≤ 2 MB  (up to ~720×700)
///   - Medium: ≤ 8 MB  (up to 1080p)
///   - Large:  > 8 MB  (4K and above)
pub struct FrameBufferPool {
    small: Vec<Vec<u8>>,
    medium: Vec<Vec<u8>>,
    large: Vec<Vec<u8>>,
    max_per_bucket: usize,
}

const SMALL_THRESHOLD: usize = 2 * 1024 * 1024;
const MEDIUM_THRESHOLD: usize = 8 * 1024 * 1024;

impl FrameBufferPool {
    pub fn new(max_per_bucket: usize) -> Self {
        Self {
            small: Vec::with_capacity(max_per_bucket),
            medium: Vec::with_capacity(max_per_bucket),
            large: Vec::with_capacity(max_per_bucket),
            max_per_bucket,
        }
    }

    /// Acquire a buffer with at least `min_size` bytes capacity.
    /// Reuses a pooled buffer from the matching bucket if available.
    pub fn acquire(&mut self, min_size: usize) -> Vec<u8> {
        let bucket = self.bucket_for(min_size);
        if let Some(mut buf) = bucket.pop() {
            if buf.capacity() >= min_size {
                buf.clear();
                return buf;
            }
            // Buffer too small (rare edge case after resolution change)
            // — drop it and allocate fresh.
        }
        Vec::with_capacity(min_size)
    }

    /// Return a buffer to the pool for reuse.
    pub fn release(&mut self, buf: Vec<u8>) {
        let cap = buf.capacity();
        let max = self.max_per_bucket;
        let bucket = self.bucket_for(cap);
        if bucket.len() < max {
            bucket.push(buf);
        }
        // Otherwise drop it — bucket is full.
    }

    fn bucket_for(&mut self, size: usize) -> &mut Vec<Vec<u8>> {
        if size <= SMALL_THRESHOLD {
            &mut self.small
        } else if size <= MEDIUM_THRESHOLD {
            &mut self.medium
        } else {
            &mut self.large
        }
    }
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

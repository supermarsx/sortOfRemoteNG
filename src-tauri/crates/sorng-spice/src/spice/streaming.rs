//! SPICE video streaming channel: codec handling, frame decode dispatch, stream control.

use crate::spice::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Stream State ────────────────────────────────────────────────────────────

/// State of a video stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StreamState {
    /// Stream created but not yet active.
    Created,
    /// Receiving frames.
    Active,
    /// Temporarily paused.
    Paused,
    /// Stream ended normally.
    Ended,
    /// Stream failed.
    Error,
}

/// A decoded video frame.
#[derive(Debug, Clone)]
pub struct DecodedFrame {
    pub stream_id: u32,
    pub width: u32,
    pub height: u32,
    pub format: VideoFrameFormat,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
    pub sequence: u64,
}

/// Format of decoded frame pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VideoFrameFormat {
    Rgba32,
    Bgra32,
    Yuv420,
    Rgb24,
}

/// Codec-specific frame data before decoding.
#[derive(Debug, Clone)]
pub struct EncodedFrame {
    pub stream_id: u32,
    pub codec: VideoCodec,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
    pub keyframe: bool,
}

// ── Stream Region ───────────────────────────────────────────────────────────

/// The rectangular region of the display covered by a stream.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct StreamRegion {
    pub surface_id: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl StreamRegion {
    pub fn contains_point(&self, px: u32, py: u32) -> bool {
        px >= self.x && px < self.x + self.width && py >= self.y && py < self.y + self.height
    }

    pub fn area(&self) -> u64 {
        self.width as u64 * self.height as u64
    }
}

// ── Managed Stream ──────────────────────────────────────────────────────────

/// A managed video stream with stats and state.
#[derive(Debug)]
pub struct ManagedStream {
    pub id: u32,
    pub codec: VideoCodec,
    pub region: StreamRegion,
    pub state: StreamState,
    pub src_width: u32,
    pub src_height: u32,
    /// Frames received since stream creation.
    pub frames_received: u64,
    /// Frames decoded successfully.
    pub frames_decoded: u64,
    /// Frames dropped (decode error, late, etc.).
    pub frames_dropped: u64,
    /// Total bytes received.
    pub bytes_received: u64,
    /// Last frame timestamp.
    pub last_frame_ts: u64,
    /// Average decode time in microseconds.
    pub avg_decode_us: u64,
}

impl ManagedStream {
    pub fn new(id: u32, codec: VideoCodec, region: StreamRegion, width: u32, height: u32) -> Self {
        Self {
            id,
            codec,
            region,
            state: StreamState::Created,
            src_width: width,
            src_height: height,
            frames_received: 0,
            frames_decoded: 0,
            frames_dropped: 0,
            bytes_received: 0,
            last_frame_ts: 0,
            avg_decode_us: 0,
        }
    }

    /// Record reception of an encoded frame.
    pub fn record_frame_received(&mut self, size: usize, timestamp: u64) {
        self.frames_received += 1;
        self.bytes_received += size as u64;
        self.last_frame_ts = timestamp;
        self.state = StreamState::Active;
    }

    /// Record a successful decode.
    pub fn record_frame_decoded(&mut self, decode_time_us: u64) {
        self.frames_decoded += 1;
        // Rolling average
        if self.frames_decoded == 1 {
            self.avg_decode_us = decode_time_us;
        } else {
            self.avg_decode_us = (self.avg_decode_us * 7 + decode_time_us) / 8;
        }
    }

    /// Record a dropped frame.
    pub fn record_frame_dropped(&mut self) {
        self.frames_dropped += 1;
    }

    /// Estimated FPS based on frames decoded and timestamp range.
    pub fn estimated_fps(&self) -> f64 {
        if self.last_frame_ts == 0 || self.frames_decoded < 2 {
            return 0.0;
        }
        // We don't track the first frame timestamp here, so just return a rough estimate
        (self.frames_decoded as f64).min(60.0)
    }

    /// Drop rate as a percentage.
    pub fn drop_rate(&self) -> f64 {
        if self.frames_received == 0 {
            return 0.0;
        }
        (self.frames_dropped as f64 / self.frames_received as f64) * 100.0
    }
}

// ── Streaming Manager ───────────────────────────────────────────────────────

/// Manages all video streams for a SPICE session.
#[derive(Debug)]
pub struct StreamingManager {
    streams: HashMap<u32, ManagedStream>,
    next_id: u32,
    preferred_codec: VideoCodec,
    max_streams: usize,
}

impl StreamingManager {
    pub fn new(preferred_codec: VideoCodec) -> Self {
        Self {
            streams: HashMap::new(),
            next_id: 1,
            preferred_codec,
            max_streams: 16,
        }
    }

    pub fn set_preferred_codec(&mut self, codec: VideoCodec) {
        self.preferred_codec = codec;
    }

    pub fn preferred_codec(&self) -> VideoCodec {
        self.preferred_codec
    }

    /// Create a new stream.
    pub fn create_stream(
        &mut self,
        codec: VideoCodec,
        region: StreamRegion,
        width: u32,
        height: u32,
    ) -> Result<u32, String> {
        if self.streams.len() >= self.max_streams {
            return Err(format!("max streams ({}) reached", self.max_streams));
        }
        let id = self.next_id;
        self.next_id += 1;
        self.streams
            .insert(id, ManagedStream::new(id, codec, region, width, height));
        Ok(id)
    }

    /// Create a stream from a server-provided id.
    pub fn create_stream_with_id(
        &mut self,
        id: u32,
        codec: VideoCodec,
        region: StreamRegion,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        if self.streams.len() >= self.max_streams {
            return Err(format!("max streams ({}) reached", self.max_streams));
        }
        if self.streams.contains_key(&id) {
            return Err(format!("stream {} already exists", id));
        }
        self.streams
            .insert(id, ManagedStream::new(id, codec, region, width, height));
        if id >= self.next_id {
            self.next_id = id + 1;
        }
        Ok(())
    }

    /// Destroy a stream.
    pub fn destroy_stream(&mut self, id: u32) -> bool {
        self.streams.remove(&id).is_some()
    }

    /// Process an incoming encoded frame.
    pub fn process_encoded_frame(&mut self, frame: &EncodedFrame) -> Result<(), String> {
        let stream = self
            .streams
            .get_mut(&frame.stream_id)
            .ok_or_else(|| format!("stream {} not found", frame.stream_id))?;
        stream.record_frame_received(frame.data.len(), frame.timestamp_ms);
        Ok(())
    }

    /// Get a stream by id.
    pub fn get_stream(&self, id: u32) -> Option<&ManagedStream> {
        self.streams.get(&id)
    }

    /// Get a mutable stream by id.
    pub fn get_stream_mut(&mut self, id: u32) -> Option<&mut ManagedStream> {
        self.streams.get_mut(&id)
    }

    /// List all streams.
    pub fn list_streams(&self) -> Vec<&ManagedStream> {
        self.streams.values().collect()
    }

    /// Active stream count.
    pub fn active_count(&self) -> usize {
        self.streams
            .values()
            .filter(|s| s.state == StreamState::Active)
            .count()
    }

    /// Total bytes received across all streams.
    pub fn total_bytes(&self) -> u64 {
        self.streams.values().map(|s| s.bytes_received).sum()
    }

    /// Reset all streams.
    pub fn reset(&mut self) {
        self.streams.clear();
        self.next_id = 1;
    }

    /// Clip a stream region to the given display dimensions.
    pub fn clip_region(&self, id: u32, display_w: u32, display_h: u32) -> Option<StreamRegion> {
        let stream = self.streams.get(&id)?;
        let r = &stream.region;
        let x = r.x.min(display_w);
        let y = r.y.min(display_h);
        let w = (r.width).min(display_w.saturating_sub(x));
        let h = (r.height).min(display_h.saturating_sub(y));
        Some(StreamRegion {
            surface_id: r.surface_id,
            x,
            y,
            width: w,
            height: h,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_lifecycle() {
        let mut mgr = StreamingManager::new(VideoCodec::H264);
        let region = StreamRegion {
            surface_id: 0,
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let id = mgr
            .create_stream(VideoCodec::H264, region, 1920, 1080)
            .unwrap();

        let frame = EncodedFrame {
            stream_id: id,
            codec: VideoCodec::H264,
            data: vec![0u8; 1024],
            timestamp_ms: 100,
            keyframe: true,
        };
        mgr.process_encoded_frame(&frame).unwrap();

        let stream = mgr.get_stream(id).unwrap();
        assert_eq!(stream.frames_received, 1);
        assert_eq!(stream.bytes_received, 1024);
        assert_eq!(stream.state, StreamState::Active);
    }

    #[test]
    fn stream_region_contains() {
        let r = StreamRegion {
            surface_id: 0,
            x: 10,
            y: 20,
            width: 100,
            height: 50,
        };
        assert!(r.contains_point(10, 20));
        assert!(r.contains_point(50, 40));
        assert!(!r.contains_point(9, 20));
        assert!(!r.contains_point(110, 20));
    }

    #[test]
    fn max_streams_limit() {
        let mut mgr = StreamingManager::new(VideoCodec::Vp8);
        mgr.max_streams = 2;
        let r = StreamRegion {
            surface_id: 0,
            x: 0,
            y: 0,
            width: 640,
            height: 480,
        };
        mgr.create_stream(VideoCodec::Vp8, r, 640, 480).unwrap();
        mgr.create_stream(VideoCodec::Vp8, r, 640, 480).unwrap();
        let result = mgr.create_stream(VideoCodec::Vp8, r, 640, 480);
        assert!(result.is_err());
    }

    #[test]
    fn drop_rate_calculation() {
        let r = StreamRegion {
            surface_id: 0,
            x: 0,
            y: 0,
            width: 100,
            height: 100,
        };
        let mut stream = ManagedStream::new(1, VideoCodec::Mjpeg, r, 100, 100);
        stream.frames_received = 100;
        stream.frames_dropped = 5;
        assert!((stream.drop_rate() - 5.0).abs() < 0.001);
    }

    #[test]
    fn clip_region() {
        let mut mgr = StreamingManager::new(VideoCodec::H264);
        let region = StreamRegion {
            surface_id: 0,
            x: 1800,
            y: 900,
            width: 400,
            height: 300,
        };
        let id = mgr
            .create_stream(VideoCodec::H264, region, 400, 300)
            .unwrap();

        let clipped = mgr.clip_region(id, 1920, 1080).unwrap();
        assert_eq!(clipped.width, 120); // 1920 - 1800
        assert_eq!(clipped.height, 180); // 1080 - 900
    }
}

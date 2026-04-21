//! NX media forwarding — audio and video stream management.

use crate::nx::types::*;
use serde::{Deserialize, Serialize};

/// State of the audio subsystem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AudioState {
    Disabled,
    Initializing,
    Active,
    Muted,
    Error,
}

/// Audio stream direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AudioDirection {
    /// Server → Client (playback).
    Playback,
    /// Client → Server (recording).
    Recording,
}

/// A managed audio stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxAudioStream {
    pub id: String,
    pub direction: AudioDirection,
    pub codec: NxAudioCodec,
    pub sample_rate: u32,
    pub channels: u8,
    pub bit_depth: u8,
    pub state: AudioState,
    pub bytes_transferred: u64,
    pub latency_ms: u32,
}

/// Audio manager for an NX session.
#[derive(Debug)]
pub struct AudioManager {
    playback: Option<NxAudioStream>,
    recording: Option<NxAudioStream>,
    config: NxAudioConfig,
}

impl AudioManager {
    pub fn new(config: NxAudioConfig) -> Self {
        Self {
            playback: None,
            recording: None,
            config,
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    /// Start playback stream.
    pub fn start_playback(&mut self) -> Result<(), String> {
        if !self.config.enabled {
            return Err("audio is disabled".into());
        }
        self.playback = Some(NxAudioStream {
            id: uuid::Uuid::new_v4().to_string(),
            direction: AudioDirection::Playback,
            codec: self.config.codec,
            sample_rate: self.config.sample_rate,
            channels: self.config.channels,
            bit_depth: self.config.bit_depth,
            state: AudioState::Active,
            bytes_transferred: 0,
            latency_ms: 0,
        });
        Ok(())
    }

    /// Start recording stream.
    pub fn start_recording(&mut self) -> Result<(), String> {
        if !self.config.enabled {
            return Err("audio is disabled".into());
        }
        self.recording = Some(NxAudioStream {
            id: uuid::Uuid::new_v4().to_string(),
            direction: AudioDirection::Recording,
            codec: self.config.codec,
            sample_rate: self.config.sample_rate,
            channels: self.config.channels,
            bit_depth: self.config.bit_depth,
            state: AudioState::Active,
            bytes_transferred: 0,
            latency_ms: 0,
        });
        Ok(())
    }

    /// Stop playback.
    pub fn stop_playback(&mut self) {
        self.playback = None;
    }

    /// Stop recording.
    pub fn stop_recording(&mut self) {
        self.recording = None;
    }

    /// Mute/unmute playback.
    pub fn set_muted(&mut self, muted: bool) {
        if let Some(ref mut stream) = self.playback {
            stream.state = if muted {
                AudioState::Muted
            } else {
                AudioState::Active
            };
        }
    }

    pub fn playback_stream(&self) -> Option<&NxAudioStream> {
        self.playback.as_ref()
    }

    pub fn recording_stream(&self) -> Option<&NxAudioStream> {
        self.recording.as_ref()
    }

    /// Record bytes transferred on playback stream.
    pub fn record_playback_bytes(&mut self, bytes: u64) {
        if let Some(ref mut s) = self.playback {
            s.bytes_transferred += bytes;
        }
    }

    /// Stop all streams.
    pub fn stop_all(&mut self) {
        self.playback = None;
        self.recording = None;
    }
}

/// Video/multimedia forwarding state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MediaForwardState {
    Disabled,
    Active,
    Paused,
}

/// Media forwarding manager.
#[derive(Debug)]
pub struct MediaForwardManager {
    state: MediaForwardState,
    bandwidth_limit_kbps: Option<u32>,
    bytes_forwarded: u64,
}

impl MediaForwardManager {
    pub fn new(enabled: bool) -> Self {
        Self {
            state: if enabled {
                MediaForwardState::Active
            } else {
                MediaForwardState::Disabled
            },
            bandwidth_limit_kbps: None,
            bytes_forwarded: 0,
        }
    }

    pub fn is_active(&self) -> bool {
        self.state == MediaForwardState::Active
    }

    pub fn set_bandwidth_limit(&mut self, kbps: Option<u32>) {
        self.bandwidth_limit_kbps = kbps;
    }

    pub fn record_bytes(&mut self, bytes: u64) {
        self.bytes_forwarded += bytes;
    }

    pub fn bytes_forwarded(&self) -> u64 {
        self.bytes_forwarded
    }

    pub fn pause(&mut self) {
        if self.state == MediaForwardState::Active {
            self.state = MediaForwardState::Paused;
        }
    }

    pub fn resume(&mut self) {
        if self.state == MediaForwardState::Paused {
            self.state = MediaForwardState::Active;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_lifecycle() {
        let config = NxAudioConfig::default();
        let mut mgr = AudioManager::new(config);
        assert!(mgr.is_enabled());

        mgr.start_playback().unwrap();
        assert!(mgr.playback_stream().is_some());

        mgr.set_muted(true);
        assert_eq!(mgr.playback_stream().unwrap().state, AudioState::Muted);

        mgr.set_muted(false);
        assert_eq!(mgr.playback_stream().unwrap().state, AudioState::Active);

        mgr.stop_playback();
        assert!(mgr.playback_stream().is_none());
    }

    #[test]
    fn audio_disabled() {
        let config = NxAudioConfig {
            enabled: false,
            ..NxAudioConfig::default()
        };
        let mut mgr = AudioManager::new(config);
        assert!(mgr.start_playback().is_err());
    }

    #[test]
    fn media_forward() {
        let mut mgr = MediaForwardManager::new(true);
        assert!(mgr.is_active());

        mgr.record_bytes(1024);
        assert_eq!(mgr.bytes_forwarded(), 1024);

        mgr.pause();
        assert!(!mgr.is_active());

        mgr.resume();
        assert!(mgr.is_active());
    }
}

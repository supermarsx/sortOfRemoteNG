//! # Recording Bridge
//!
//! Bridge to the sorng-recording crate for gateway-level session capture.
//! The gateway can record sessions passing through it for compliance and audit.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Status of a recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecordingStatus {
    /// Recording is active
    Active,
    /// Recording is paused
    Paused,
    /// Recording is complete
    Complete,
    /// Recording failed
    Failed,
}

/// Metadata for a gateway recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayRecording {
    /// Unique recording ID
    pub id: String,
    /// Associated session ID
    pub session_id: String,
    /// Recording status
    pub status: RecordingStatus,
    /// When the recording started
    pub started_at: chrono::DateTime<chrono::Utc>,
    /// When the recording ended
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Recorded bytes so far
    pub bytes_recorded: u64,
    /// Storage path for the recording file
    pub storage_path: Option<String>,
}

/// Bridges gateway session recording to the sorng-recording engine.
pub struct RecordingBridge {
    /// Whether recording is globally enabled
    enabled: bool,
    /// Active recordings indexed by session ID
    recordings: HashMap<String, GatewayRecording>,
}

impl RecordingBridge {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            recordings: HashMap::new(),
        }
    }

    /// Check if recording is enabled.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Enable or disable recording globally.
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    /// Start recording for a session.
    pub fn start_recording(&mut self, session_id: &str) -> Result<GatewayRecording, String> {
        if !self.enabled {
            return Err("Recording is globally disabled".to_string());
        }

        if self.recordings.contains_key(session_id) {
            return Err("Recording already active for this session".to_string());
        }

        let recording = GatewayRecording {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            status: RecordingStatus::Active,
            started_at: chrono::Utc::now(),
            ended_at: None,
            bytes_recorded: 0,
            storage_path: None,
        };

        self.recordings
            .insert(session_id.to_string(), recording.clone());
        log::info!(
            "[RECORDING] Started recording for session {}",
            session_id
        );
        Ok(recording)
    }

    /// Stop recording for a session.
    pub fn stop_recording(&mut self, session_id: &str) -> Result<GatewayRecording, String> {
        let recording = self
            .recordings
            .get_mut(session_id)
            .ok_or("No recording found for this session")?;

        recording.status = RecordingStatus::Complete;
        recording.ended_at = Some(chrono::Utc::now());
        let result = recording.clone();

        log::info!(
            "[RECORDING] Stopped recording for session {} ({} bytes)",
            session_id,
            result.bytes_recorded
        );
        Ok(result)
    }

    /// Record data passing through a session.
    pub fn record_data(&mut self, session_id: &str, bytes: u64) -> Result<(), String> {
        let recording = self
            .recordings
            .get_mut(session_id)
            .ok_or("No recording found for this session")?;

        if recording.status != RecordingStatus::Active {
            return Err("Recording is not active".to_string());
        }

        recording.bytes_recorded += bytes;
        // In production, this would pipe data to the sorng-recording engine
        Ok(())
    }

    /// Pause a recording.
    pub fn pause_recording(&mut self, session_id: &str) -> Result<(), String> {
        let recording = self
            .recordings
            .get_mut(session_id)
            .ok_or("No recording found")?;
        recording.status = RecordingStatus::Paused;
        Ok(())
    }

    /// Resume a paused recording.
    pub fn resume_recording(&mut self, session_id: &str) -> Result<(), String> {
        let recording = self
            .recordings
            .get_mut(session_id)
            .ok_or("No recording found")?;
        if recording.status != RecordingStatus::Paused {
            return Err("Recording is not paused".to_string());
        }
        recording.status = RecordingStatus::Active;
        Ok(())
    }

    /// Get recording info for a session.
    pub fn get_recording(&self, session_id: &str) -> Option<&GatewayRecording> {
        self.recordings.get(session_id)
    }

    /// List all active recordings.
    pub fn list_active(&self) -> Vec<&GatewayRecording> {
        self.recordings
            .values()
            .filter(|r| r.status == RecordingStatus::Active)
            .collect()
    }

    /// Get count of active recordings.
    pub fn active_count(&self) -> usize {
        self.list_active().len()
    }

    /// Clean up completed recordings from memory.
    pub fn cleanup_completed(&mut self) {
        self.recordings.retain(|_, r| {
            matches!(r.status, RecordingStatus::Active | RecordingStatus::Paused)
        });
    }
}

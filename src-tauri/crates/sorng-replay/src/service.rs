// sorng-replay – Service facade
//
// Thin orchestration layer that owns the player, annotation manager,
// and config.  All Tauri commands go through ReplayServiceState.

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::annotations::AnnotationManager;
use crate::error::{ReplayError, ReplayResult};
use crate::player::ReplayPlayer;
use crate::types::*;

/// High-level replay service.
#[derive(Debug, Clone)]
pub struct ReplayService {
    pub player: Option<ReplayPlayer>,
    pub annotation_mgr: AnnotationManager,
    pub config: ReplayConfig,
}

/// Tauri-managed state type.
pub type ReplayServiceState = Arc<Mutex<ReplayService>>;

impl ReplayService {
    pub fn new() -> Self {
        Self {
            player: None,
            annotation_mgr: AnnotationManager::new(),
            config: ReplayConfig::default(),
        }
    }

    /// Load a terminal recording into the player.
    pub fn load_terminal(&mut self, frames: Vec<TerminalFrame>) {
        let mut p = ReplayPlayer::new_terminal(frames, self.config.clone());
        // Carry over existing annotations/bookmarks
        p.session.annotations = self.annotation_mgr.annotations.clone();
        p.session.bookmarks = self.annotation_mgr.bookmarks.clone();
        self.player = Some(p);
    }

    /// Load a video recording into the player.
    pub fn load_video(&mut self, frames: Vec<VideoFrame>) {
        let mut p = ReplayPlayer::new_video(frames, self.config.clone());
        p.session.annotations = self.annotation_mgr.annotations.clone();
        p.session.bookmarks = self.annotation_mgr.bookmarks.clone();
        self.player = Some(p);
    }

    /// Load an HTTP HAR recording into the player.
    pub fn load_har(&mut self, entries: Vec<HarEntry>) {
        let mut p = ReplayPlayer::new_har(entries, self.config.clone());
        p.session.annotations = self.annotation_mgr.annotations.clone();
        p.session.bookmarks = self.annotation_mgr.bookmarks.clone();
        self.player = Some(p);
    }

    /// Return a mutable reference to the player, or an error if nothing is loaded.
    pub fn player_mut(&mut self) -> ReplayResult<&mut ReplayPlayer> {
        self.player
            .as_mut()
            .ok_or_else(|| ReplayError::InvalidState("no recording loaded".into()))
    }

    /// Return an immutable reference to the player.
    pub fn player_ref(&self) -> ReplayResult<&ReplayPlayer> {
        self.player
            .as_ref()
            .ok_or_else(|| ReplayError::InvalidState("no recording loaded".into()))
    }

    /// Synchronise annotation manager → player session.
    pub fn sync_annotations_to_player(&mut self) {
        if let Some(ref mut p) = self.player {
            p.session.annotations = self.annotation_mgr.annotations.clone();
            p.session.bookmarks = self.annotation_mgr.bookmarks.clone();
        }
    }
}

impl Default for ReplayService {
    fn default() -> Self {
        Self::new()
    }
}

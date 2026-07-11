use serde::{Deserialize, Serialize};

use super::session_state::FrameFlowSummary;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FramePressureState {
    Healthy,
    Backpressured,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameDisposition {
    Deliver,
    Coalesce,
    DropSuperseded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameFlowBudget {
    pub high_watermark_frames: u16,
    pub low_watermark_frames: u16,
}

impl FrameFlowBudget {
    pub fn new(high_watermark_frames: u16, low_watermark_frames: u16) -> Self {
        assert!(high_watermark_frames > 0, "high watermark must be positive");
        assert!(
            low_watermark_frames <= high_watermark_frames,
            "low watermark must not exceed high watermark"
        );
        Self {
            high_watermark_frames,
            low_watermark_frames,
        }
    }
}

impl Default for FrameFlowBudget {
    fn default() -> Self {
        Self::new(6, 2)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameFlowSnapshot {
    pub pressure_state: FramePressureState,
    pub queued_frames: u16,
    pub delivered_frames: u64,
    pub dropped_frames: u64,
    pub coalesced_frames: u64,
}

impl FrameFlowSnapshot {
    pub fn summary(&self) -> FrameFlowSummary {
        FrameFlowSummary {
            queued_frames: self.queued_frames,
            delivered_frames: self.delivered_frames,
            dropped_frames: self.dropped_frames,
            coalesced_frames: self.coalesced_frames,
            average_render_ms: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FrameFlowController {
    budget: FrameFlowBudget,
    pressure_state: FramePressureState,
    queued_frames: u16,
    delivered_frames: u64,
    dropped_frames: u64,
    coalesced_frames: u64,
}

impl FrameFlowController {
    pub fn new(budget: FrameFlowBudget) -> Self {
        Self {
            budget,
            pressure_state: FramePressureState::Healthy,
            queued_frames: 0,
            delivered_frames: 0,
            dropped_frames: 0,
            coalesced_frames: 0,
        }
    }

    pub fn pressure_state(&self) -> FramePressureState {
        self.pressure_state
    }

    pub fn observe_queue_depth(&mut self, queued_frames: u16) -> FramePressureState {
        self.queued_frames = queued_frames;
        match self.pressure_state {
            FramePressureState::Healthy if queued_frames >= self.budget.high_watermark_frames => {
                self.pressure_state = FramePressureState::Backpressured;
            }
            FramePressureState::Backpressured
                if queued_frames <= self.budget.low_watermark_frames =>
            {
                self.pressure_state = FramePressureState::Healthy;
            }
            _ => {}
        }
        self.pressure_state
    }

    pub fn disposition_for_supersedable_frame(&self) -> FrameDisposition {
        match self.pressure_state {
            FramePressureState::Healthy => FrameDisposition::Deliver,
            FramePressureState::Backpressured => FrameDisposition::Coalesce,
        }
    }

    pub fn record_delivered(&mut self) {
        self.delivered_frames = self.delivered_frames.saturating_add(1);
    }

    pub fn record_dropped(&mut self) {
        self.dropped_frames = self.dropped_frames.saturating_add(1);
    }

    pub fn record_coalesced(&mut self) {
        self.coalesced_frames = self.coalesced_frames.saturating_add(1);
    }

    /// Account for one graphics update arriving on the batched RGBA path.
    ///
    /// `pending_before` is the batch backlog depth *before* this update is
    /// enqueued. The controller observes the queue depth (driving the
    /// high/low-watermark pressure state) and classifies the update:
    /// - a fresh batch (`pending_before == 0`) is `Deliver` — it will be sent
    ///   when the batch flushes;
    /// - an update landing on a non-empty backlog is `Coalesce` — it merges
    ///   into the pending batch and supersedes an individual send, so it is
    ///   counted as a coalesced frame.
    ///
    /// This is the exact per-update decision the active session loop makes, so
    /// the controller logic exercised in tests is the logic the runner runs.
    pub fn account_batched_update(&mut self, pending_before: u16) -> FrameDisposition {
        self.observe_queue_depth(pending_before);
        if pending_before > 0 {
            self.record_coalesced();
            FrameDisposition::Coalesce
        } else {
            FrameDisposition::Deliver
        }
    }

    pub fn snapshot(&self) -> FrameFlowSnapshot {
        FrameFlowSnapshot {
            pressure_state: self.pressure_state,
            queued_frames: self.queued_frames,
            delivered_frames: self.delivered_frames,
            dropped_frames: self.dropped_frames,
            coalesced_frames: self.coalesced_frames,
        }
    }
}

impl Default for FrameFlowController {
    fn default() -> Self {
        Self::new(FrameFlowBudget::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pressure_has_hysteresis() {
        let mut controller = FrameFlowController::new(FrameFlowBudget::new(4, 1));

        assert_eq!(
            controller.observe_queue_depth(3),
            FramePressureState::Healthy
        );
        assert_eq!(
            controller.observe_queue_depth(4),
            FramePressureState::Backpressured
        );
        assert_eq!(
            controller.observe_queue_depth(2),
            FramePressureState::Backpressured
        );
        assert_eq!(
            controller.observe_queue_depth(1),
            FramePressureState::Healthy
        );
    }

    #[test]
    fn supersedable_frames_coalesce_under_pressure() {
        let mut controller = FrameFlowController::new(FrameFlowBudget::new(2, 0));

        assert_eq!(
            controller.disposition_for_supersedable_frame(),
            FrameDisposition::Deliver
        );

        controller.observe_queue_depth(2);

        assert_eq!(
            controller.disposition_for_supersedable_frame(),
            FrameDisposition::Coalesce
        );
    }

    #[test]
    fn snapshot_projects_lifecycle_summary() {
        let mut controller = FrameFlowController::default();
        controller.observe_queue_depth(3);
        controller.record_delivered();
        controller.record_dropped();
        controller.record_coalesced();

        let snapshot = controller.snapshot();
        let summary = snapshot.summary();

        assert_eq!(summary.queued_frames, 3);
        assert_eq!(summary.delivered_frames, 1);
        assert_eq!(summary.dropped_frames, 1);
        assert_eq!(snapshot.coalesced_frames, 1);
    }
}

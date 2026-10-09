//! Bounded, process-local correlation without database IDs, URLs or page data.
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

static NEXT_SAMPLE: AtomicU32 = AtomicU32::new(0);

pub(crate) struct ObservationGate {
    sample: u32,
    features: AtomicU64,
    resources: AtomicU32,
}

impl Default for ObservationGate {
    fn default() -> Self {
        Self {
            sample: NEXT_SAMPLE
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                    (n < 128).then_some(n + 1)
                })
                .map_or(0, |n| n + 1),
            features: AtomicU64::new(0),
            resources: AtomicU32::new(0),
        }
    }
}

impl ObservationGate {
    // A fixed native checkpoint is recorded once per attempt, not per frame.
    pub(crate) fn feature(&self, checkpoint: u32) -> Option<u32> {
        let bit = 1u64.checked_shl(checkpoint)?;
        (self.sample != 0 && self.features.fetch_or(bit, Ordering::Relaxed) & bit == 0)
            .then_some(self.sample)
    }

    pub(crate) fn resource(&self) -> Option<u32> {
        if self.sample == 0 {
            return None;
        }
        self.resources
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                (n < 8).then_some(n + 1)
            })
            .ok()
            .map(|_| self.sample)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_page_events_cannot_flood_or_exhaust_feature_evidence() {
        let gate = ObservationGate::default();
        let first = gate.feature(0).unwrap();
        for _ in 0..10_000 {
            assert!(gate.feature(0).is_none());
        }
        assert_eq!(gate.feature(1), Some(first));
        assert!(gate.feature(64).is_none());
        assert_eq!(
            (0..10_000)
                .filter_map(|_| gate.resource())
                .collect::<Vec<_>>(),
            vec![first; 8]
        );
        assert_eq!(gate.feature(2), Some(first));
        assert_ne!(ObservationGate::default().feature(0), Some(first));
    }

    #[test]
    fn budget_is_atomic_for_concurrent_callbacks() {
        let gate = std::sync::Arc::new(ObservationGate::default());
        let threads: Vec<_> = (0..16)
            .map(|_| {
                let gate = gate.clone();
                std::thread::spawn(move || (gate.feature(3).is_some(), gate.resource().is_some()))
            })
            .collect();
        let result: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(result.iter().filter(|(feature, _)| *feature).count(), 1);
        assert_eq!(result.iter().filter(|(_, resource)| *resource).count(), 8);
    }
}

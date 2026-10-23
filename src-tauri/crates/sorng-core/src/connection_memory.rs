//! Conservative OS-memory admission, not a guarantee of actual process usage.
//! Reservations follow real worker lifetime and never terminate active workers.

use serde::Serialize;
use std::fmt;
use std::sync::{Arc, Mutex};
use sysinfo::{MemoryRefreshKind, RefreshKind, System};

pub const MIB: u64 = 1024 * 1024;
const MIN_HEADROOM: u64 = 1024 * MIB;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct SystemMemoryInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
}

impl SystemMemoryInfo {
    fn budget(self) -> Result<u64, MemoryAdmissionError> {
        if self.total_bytes == 0
            || self.available_bytes > self.total_bytes
            || self.used_bytes > self.total_bytes
        {
            return Err(MemoryAdmissionError::Unavailable);
        }
        let reserve = MIN_HEADROOM.max(self.total_bytes.div_ceil(10));
        Ok(self.available_bytes.saturating_sub(reserve))
    }
}

pub fn system_memory_info() -> Result<SystemMemoryInfo, MemoryAdmissionError> {
    let system = System::new_with_specifics(
        RefreshKind::nothing().with_memory(MemoryRefreshKind::nothing().with_ram()),
    );
    let info = SystemMemoryInfo {
        total_bytes: system.total_memory(),
        used_bytes: system
            .total_memory()
            .saturating_sub(system.available_memory()),
        available_bytes: system.available_memory(),
    };
    info.budget()?;
    Ok(info)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemoryAdmissionError {
    Unavailable,
    Pressure,
}
impl fmt::Display for MemoryAdmissionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "Available system memory could not be checked. Retry before opening another connection.",
            Self::Pressure => "Not enough available system memory to start another connection. Existing connections remain open.",
        })
    }
}
impl std::error::Error for MemoryAdmissionError {}

type Probe = dyn Fn() -> Result<SystemMemoryInfo, MemoryAdmissionError> + Send + Sync;

/// Simultaneous users share one reservation ledger while each admission reads
/// fresh OS memory. Held estimates add headroom to measured availability.
pub struct MemoryAdmission {
    estimate: u64,
    reserved: Mutex<u64>,
    probe: Arc<Probe>,
}

impl MemoryAdmission {
    pub fn system(estimate: u64) -> Arc<Self> {
        Self::with_probe(estimate, system_memory_info)
    }

    /// Native-only injection seam for resource-policy tests and callers with an
    /// existing authoritative OS sampler; never exposed as an IPC argument.
    pub fn with_probe(
        estimate: u64,
        probe: impl Fn() -> Result<SystemMemoryInfo, MemoryAdmissionError> + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            estimate,
            reserved: Mutex::new(0),
            probe: Arc::new(probe),
        })
    }

    pub fn try_acquire_owned(self: Arc<Self>) -> Result<MemoryReservation, MemoryAdmissionError> {
        if self.estimate == 0 {
            return Err(MemoryAdmissionError::Unavailable);
        }
        let budget = (self.probe)()?.budget()?;
        {
            let mut reserved = self
                .reserved
                .lock()
                .map_err(|_| MemoryAdmissionError::Unavailable)?;
            let next = reserved
                .checked_add(self.estimate)
                .ok_or(MemoryAdmissionError::Pressure)?;
            if next > budget {
                return Err(MemoryAdmissionError::Pressure);
            }
            *reserved = next;
        }
        Ok(MemoryReservation { admission: self })
    }

    /// Estimated remaining worker reservations, not a fixed connection ceiling.
    pub fn available_permits(&self) -> usize {
        let Ok(sample) = (self.probe)() else {
            return 0;
        };
        let Ok(budget) = sample.budget() else {
            return 0;
        };
        let Ok(reserved) = self.reserved.lock() else {
            return 0;
        };
        if self.estimate == 0 {
            return 0;
        }
        usize::try_from(budget.saturating_sub(*reserved) / self.estimate).unwrap_or(usize::MAX)
    }
}

pub struct MemoryReservation {
    admission: Arc<MemoryAdmission>,
}
impl Drop for MemoryReservation {
    fn drop(&mut self) {
        let mut reserved = self
            .admission
            .reserved
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *reserved = reserved.saturating_sub(self.admission.estimate);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> SystemMemoryInfo {
        SystemMemoryInfo {
            total_bytes: 32 * 1024 * MIB,
            used_bytes: 8 * 1024 * MIB,
            available_bytes: 24 * 1024 * MIB,
        }
    }

    #[test]
    fn ample_memory_admits_more_than_sixteen_and_drop_restores_budget() {
        let admission = MemoryAdmission::with_probe(256 * MIB, || Ok(sample()));
        let initial = admission.available_permits();
        let held: Vec<_> = (0..24)
            .map(|_| admission.clone().try_acquire_owned().unwrap())
            .collect();
        assert_eq!(admission.available_permits(), initial - 24);
        drop(held);
        assert_eq!(admission.available_permits(), initial);
    }

    #[test]
    fn low_memory_and_invalid_probes_fail_without_consuming_reservations() {
        for info in [
            SystemMemoryInfo {
                available_bytes: 0,
                ..sample()
            },
            SystemMemoryInfo {
                total_bytes: 0,
                ..sample()
            },
        ] {
            let admission = MemoryAdmission::with_probe(256 * MIB, move || Ok(info));
            assert!(admission.clone().try_acquire_owned().is_err());
            assert_eq!(admission.available_permits(), 0);
        }
    }

    #[test]
    fn parallel_admission_cannot_spend_one_sample_multiple_times() {
        let admission = MemoryAdmission::with_probe(256 * MIB, || {
            Ok(SystemMemoryInfo {
                total_bytes: 4 * 1024 * MIB,
                available_bytes: 1024 * MIB + 512 * MIB,
                used_bytes: 0,
            })
        });
        let barrier = Arc::new(std::sync::Barrier::new(17));
        let threads: Vec<_> = (0..16)
            .map(|_| {
                let (admission, barrier) = (admission.clone(), barrier.clone());
                std::thread::spawn(move || {
                    let permit = admission.try_acquire_owned();
                    barrier.wait();
                    permit
                })
            })
            .collect();
        barrier.wait();
        let permits: Vec<_> = threads
            .into_iter()
            .filter_map(|thread| thread.join().unwrap().ok())
            .collect();
        assert_eq!(permits.len(), 2);
        assert_eq!(admission.available_permits(), 0);
        drop(permits);
        assert_eq!(admission.available_permits(), 2);
    }
}

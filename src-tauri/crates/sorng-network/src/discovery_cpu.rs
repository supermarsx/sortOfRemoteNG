//! Passive CPU telemetry. Utilization is a system-wide 0..100 percentage,
//! never a per-process percentage divided by the number of physical cores.
use std::time::{Duration, Instant};
use sysinfo::System;

pub(super) const CPU_INTERVAL: Duration = Duration::from_secs(1);
const MAX_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Clone, Debug)]
pub(super) struct CpuObservation {
    pub available: usize,
    pub total: Option<usize>,
    pub physical: Option<usize>,
    pub percent: Option<f64>,
    pub interval_ms: Option<u64>,
    pub at: Instant,
}

fn valid_percent(value: f64) -> Option<f64> {
    (value.is_finite() && (0.0..=100.0).contains(&value)).then_some(value)
}

fn sample_interval(
    previous: Option<Instant>,
    now: Instant,
    same_topology: bool,
) -> Option<Duration> {
    let elapsed = now.checked_duration_since(previous?)?;
    (same_topology && (CPU_INTERVAL..=MAX_INTERVAL).contains(&elapsed)).then_some(elapsed)
}

fn available_count(available: Option<usize>, total: Option<usize>) -> usize {
    let available = available.filter(|count| *count > 0).or(total).unwrap_or(0);
    total.map_or(available, |total| available.min(total))
}

pub(super) struct CpuSampler {
    #[cfg(windows)]
    query: Option<windows::CpuQuery>,
    #[cfg(not(windows))]
    system: System,
    previous: Option<Instant>,
    latest: Option<CpuObservation>,
}

impl CpuSampler {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            query: None,
            #[cfg(not(windows))]
            system: System::new(),
            previous: None,
            latest: None,
        }
    }

    pub fn sample(&mut self) -> CpuObservation {
        let now = Instant::now();
        if let Some(latest) = &self.latest {
            if now.duration_since(latest.at) < CPU_INTERVAL {
                return latest.clone();
            }
        }
        #[cfg(windows)]
        let (total, collected) = {
            if self.query.is_none() {
                self.query = windows::CpuQuery::new();
            }
            let collected = self
                .query
                .as_mut()
                .ok_or(())
                .and_then(|query| query.collect());
            if collected.is_err() {
                self.query = None;
            }
            (windows::logical_count(), collected)
        };
        #[cfg(not(windows))]
        let (total, collected): (Option<usize>, Result<Option<f64>, ()>) = {
            self.system.refresh_cpu_usage();
            let count = self.system.cpus().len();
            (
                (count > 0).then_some(count),
                Ok(valid_percent(self.system.global_cpu_usage() as f64)),
            )
        };
        let at = Instant::now();
        let same_topology =
            total.is_some() && self.latest.as_ref().is_some_and(|old| old.total == total);
        let interval = sample_interval(self.previous, at, same_topology);
        let physical = if same_topology {
            self.latest.as_ref().and_then(|old| old.physical)
        } else {
            System::physical_core_count()
                .filter(|count| *count > 0 && total.is_some_and(|total| *count <= total))
        };
        let value = collected.as_ref().ok().copied().flatten();
        #[cfg(windows)]
        let available = windows::process_logical_count()
            .or_else(|| std::thread::available_parallelism().ok().map(usize::from));
        #[cfg(not(windows))]
        let available = std::thread::available_parallelism().ok().map(usize::from);
        let observation = CpuObservation {
            available: available_count(available, total),
            total,
            physical,
            percent: interval.and_then(|_| value.and_then(valid_percent)),
            interval_ms: interval.map(|dt| dt.as_millis() as u64),
            at,
        };
        self.previous = collected.is_ok().then_some(at);
        self.latest = Some(observation.clone());
        observation
    }
}

#[cfg(windows)]
mod windows {
    use super::valid_percent;
    use windows_sys::Win32::System::Performance::*;
    use windows_sys::Win32::System::Threading::{
        GetActiveProcessorCount, GetActiveProcessorGroupCount, GetCurrentProcess,
        GetProcessAffinityMask, GetProcessDefaultCpuSets, GetProcessGroupAffinity,
        ALL_PROCESSOR_GROUPS,
    };

    // Processor Information includes every processor group. Legacy Processor
    // counters / GetSystemInfo can describe only a group on >64-thread hosts.
    const COUNTER: &str = r"\Processor Information(_Total)\% Processor Time";
    pub(super) struct CpuQuery {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
    }
    // Owned PDH handles are moved between blocking jobs, never used concurrently;
    // the capacity service holds its Sampler mutex for the entire collection.
    unsafe impl Send for CpuQuery {}
    impl Drop for CpuQuery {
        fn drop(&mut self) {
            // SAFETY: this guard owns the successful query allocation and all
            // counters attached to it. No counter handle escapes the guard.
            unsafe {
                PdhCloseQuery(self.query);
            }
        }
    }
    pub(super) fn logical_count() -> Option<usize> {
        // SAFETY: read-only, documented all-groups selector; no pointers.
        let count = unsafe { GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) };
        (count > 0).then_some(count as usize)
    }
    pub(super) fn process_logical_count() -> Option<usize> {
        // Unlike a current-thread/group mask, process group membership can span
        // >64 logical processors. Never change affinity to measure capacity.
        // SAFETY: read-only current-process queries and sized initialized buffers.
        unsafe {
            let process = GetCurrentProcess();
            let mut count = GetActiveProcessorGroupCount();
            if count == 0 {
                return None;
            }
            let mut groups = vec![0u16; count as usize];
            if GetProcessGroupAffinity(process, &mut count, groups.as_mut_ptr()) == 0
                || count == 0
                || count as usize > groups.len()
            {
                return None;
            }
            groups.truncate(count as usize);
            let mut available = 0usize;
            for group in &groups {
                let active = GetActiveProcessorCount(*group) as usize;
                if active == 0 {
                    return None;
                }
                available = available.checked_add(active)?;
            }
            // An explicit single-group process mask narrows the default group.
            // With multiple groups the legacy mask cannot describe the process.
            if count == 1 {
                let (mut mask, mut system_mask) = (0usize, 0usize);
                if GetProcessAffinityMask(process, &mut mask, &mut system_mask) != 0 && mask != 0 {
                    available = available.min(mask.count_ones() as usize);
                }
            }
            let mut set_count = 0u32;
            let ok = GetProcessDefaultCpuSets(process, std::ptr::null_mut(), 0, &mut set_count);
            if ok == 0
                && windows_sys::Win32::Foundation::GetLastError()
                    != windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER
            {
                return None;
            }
            if set_count > 0 {
                available = available.min(set_count as usize);
            }
            (available > 0).then_some(available)
        }
    }
    fn formatted_value(call_status: u32, data_status: u32, value: f64) -> Option<f64> {
        if call_status != 0 || !matches!(data_status, PDH_CSTATUS_VALID_DATA | PDH_CSTATUS_NEW_DATA)
        {
            return None;
        }
        valid_percent(value)
    }
    impl CpuQuery {
        pub fn new() -> Option<Self> {
            let mut query = std::ptr::null_mut();
            // SAFETY: valid out pointer, null data source selects local counters.
            if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
                return None;
            }
            let mut guard = Self {
                query,
                counter: std::ptr::null_mut(),
            };
            let path: Vec<u16> = COUNTER.encode_utf16().chain(Some(0)).collect();
            // SAFETY: valid owned query, nul-terminated path and counter out pointer.
            if unsafe { PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut guard.counter) } != 0 {
                return None;
            }
            Some(guard)
        }
        pub fn collect(&mut self) -> Result<Option<f64>, ()> {
            // SAFETY: exclusive access to owned query; no asynchronous collector.
            if unsafe { PdhCollectQueryData(self.query) } != 0 {
                return Err(());
            }
            let mut value = PDH_FMT_COUNTERVALUE::default();
            // SAFETY: valid counter and initialized output structure; type out pointer optional.
            let status = unsafe {
                PdhGetFormattedCounterValue(
                    self.counter,
                    PDH_FMT_DOUBLE,
                    std::ptr::null_mut(),
                    &mut value,
                )
            };
            if status != 0 {
                return Ok(None);
            }
            // SAFETY: PDH_FMT_DOUBLE selects doubleValue; CStatus is validated below.
            Ok(formatted_value(status, value.CStatus, unsafe {
                value.Anonymous.doubleValue
            }))
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn invalid_pdh_data_never_becomes_idle_or_fully_busy() {
            assert_eq!(formatted_value(0, PDH_CSTATUS_VALID_DATA, 12.5), Some(12.5));
            assert_eq!(formatted_value(0, PDH_CSTATUS_NEW_DATA, 0.0), Some(0.0));
            assert_eq!(formatted_value(1, 0, 0.0), None);
            assert_eq!(formatted_value(0, 0xc0000bc6, 0.0), None);
            assert_eq!(formatted_value(0, 0, f64::NAN), None);
            assert!(COUNTER.starts_with(r"\Processor Information(_Total)"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thread_capacity_is_not_physical_cores_or_a_percent_divisor() {
        assert_eq!(available_count(Some(80), Some(80)), 80);
        assert_eq!(available_count(Some(8), Some(80)), 8);
        assert_eq!(available_count(Some(128), Some(80)), 80);
        assert_eq!(available_count(None, Some(80)), 80);
        assert_eq!(available_count(None, None), 0);
        for value in [0.0, 12.5, 100.0] {
            assert_eq!(valid_percent(value), Some(value));
        }
        for value in [-1.0, 101.0, f64::NAN, f64::INFINITY] {
            assert_eq!(valid_percent(value), None);
        }
    }
    #[test]
    fn require_two_recent_spaced_samples_on_the_same_topology() {
        let now = Instant::now();
        assert_eq!(sample_interval(None, now, true), None);
        assert_eq!(sample_interval(Some(now), now, true), None);
        assert_eq!(sample_interval(Some(now - CPU_INTERVAL), now, false), None);
        assert_eq!(
            sample_interval(Some(now - MAX_INTERVAL - CPU_INTERVAL), now, true),
            None
        );
        assert_eq!(
            sample_interval(Some(now - CPU_INTERVAL), now, true),
            Some(CPU_INTERVAL)
        );
    }
    #[test]
    fn passive_samples_report_topology_and_a_measured_interval() {
        let mut sampler = CpuSampler::new();
        let first = sampler.sample();
        assert!(first.total.is_some_and(|count| count > 0));
        assert!(first.available > 0 && first.available <= first.total.unwrap());
        assert_eq!(first.percent, None);
        assert_eq!(first.interval_ms, None);
        std::thread::sleep(CPU_INTERVAL + Duration::from_millis(50));
        let second = sampler.sample();
        assert!(second.interval_ms.is_some_and(|ms| ms >= 1000));
        assert!(second
            .percent
            .is_none_or(|percent| (0.0..=100.0).contains(&percent)));
        eprintln!(
            "CPU capacity: available={}, logical={:?}, physical={:?}, busy={:?}%, interval={:?}ms",
            second.available, second.total, second.physical, second.percent, second.interval_ms
        );
    }
}

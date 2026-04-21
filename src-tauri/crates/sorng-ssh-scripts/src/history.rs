// ── sorng-ssh-scripts/src/history.rs ─────────────────────────────────────────
//! Execution history tracker with querying and statistics.

use std::collections::HashMap;

use crate::types::*;

/// In-memory execution history store.
#[derive(Debug, Default)]
pub struct ExecutionHistory {
    records: Vec<ExecutionRecord>,
    chain_records: Vec<ChainExecutionRecord>,
    max_records: usize,
}

impl ExecutionHistory {
    pub fn new(max_records: usize) -> Self {
        ExecutionHistory {
            records: Vec::new(),
            chain_records: Vec::new(),
            max_records,
        }
    }

    pub fn add_record(&mut self, record: ExecutionRecord) {
        self.records.push(record);
        // Trim oldest if over limit
        if self.records.len() > self.max_records {
            let excess = self.records.len() - self.max_records;
            self.records.drain(0..excess);
        }
    }

    pub fn add_chain_record(&mut self, record: ChainExecutionRecord) {
        self.chain_records.push(record);
        if self.chain_records.len() > self.max_records / 10 {
            self.chain_records.remove(0);
        }
    }

    pub fn query(&self, query: &HistoryQuery) -> HistoryResponse {
        let filtered: Vec<_> = self
            .records
            .iter()
            .filter(|r| {
                if let Some(ref sid) = query.script_id {
                    if &r.script_id != sid {
                        return false;
                    }
                }
                if let Some(ref sess) = query.session_id {
                    if r.session_id.as_deref() != Some(sess.as_str()) {
                        return false;
                    }
                }
                if let Some(ref cid) = query.connection_id {
                    if r.connection_id.as_deref() != Some(cid.as_str()) {
                        return false;
                    }
                }
                if let Some(ref status) = query.status {
                    if &r.status != status {
                        return false;
                    }
                }
                if let Some(ref tt) = query.trigger_type {
                    if &r.trigger_type != tt {
                        return false;
                    }
                }
                if let Some(ref since) = query.since {
                    if &r.started_at < since {
                        return false;
                    }
                }
                if let Some(ref until) = query.until {
                    if &r.started_at > until {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect();

        let total = filtered.len() as u64;
        let offset = query.offset.unwrap_or(0) as usize;
        let limit = query.limit.unwrap_or(50) as usize;

        let records: Vec<_> = filtered
            .into_iter()
            .rev() // newest first
            .skip(offset)
            .take(limit)
            .collect();

        HistoryResponse { records, total }
    }

    pub fn get_record(&self, execution_id: &str) -> Option<ExecutionRecord> {
        self.records.iter().find(|r| r.id == execution_id).cloned()
    }

    pub fn get_chain_record(&self, chain_execution_id: &str) -> Option<ChainExecutionRecord> {
        self.chain_records
            .iter()
            .find(|r| r.id == chain_execution_id)
            .cloned()
    }

    pub fn get_last_execution(&self, script_id: &str) -> Option<ExecutionRecord> {
        self.records
            .iter()
            .rev()
            .find(|r| r.script_id == script_id)
            .cloned()
    }

    pub fn get_last_exit_code(&self, script_id: &str) -> Option<i32> {
        self.get_last_execution(script_id).and_then(|r| r.exit_code)
    }

    /// Build a map of script_id -> latest stdout for a given session.
    /// Used by variable resolution for `PreviousOutput` sources.
    pub fn latest_outputs_by_script(&self, session_id: &str) -> HashMap<String, String> {
        let mut outputs = HashMap::new();
        // Iterate newest-first so the first match per script_id wins.
        for r in self.records.iter().rev() {
            if r.session_id.as_deref() != Some(session_id) {
                continue;
            }
            if r.status != ExecutionStatus::Success {
                continue;
            }
            if let Some(ref stdout) = r.stdout {
                outputs.entry(r.script_id.clone()).or_insert_with(|| stdout.clone());
            }
        }
        outputs
    }

    pub fn get_script_stats(&self, script_id: &str) -> ScriptStats {
        let runs: Vec<_> = self
            .records
            .iter()
            .filter(|r| r.script_id == script_id)
            .collect();

        let total_runs = runs.len() as u64;
        let success_count = runs
            .iter()
            .filter(|r| r.status == ExecutionStatus::Success)
            .count() as u64;
        let failure_count = runs
            .iter()
            .filter(|r| r.status == ExecutionStatus::Failed)
            .count() as u64;
        let timeout_count = runs
            .iter()
            .filter(|r| r.status == ExecutionStatus::Timeout)
            .count() as u64;

        let avg_duration_ms = if runs.is_empty() {
            0.0
        } else {
            runs.iter().map(|r| r.duration_ms as f64).sum::<f64>() / runs.len() as f64
        };

        let last = runs.last();

        ScriptStats {
            script_id: script_id.to_string(),
            total_runs,
            success_count,
            failure_count,
            timeout_count,
            avg_duration_ms,
            last_run: last.map(|r| r.started_at),
            last_status: last.map(|r| r.status.clone()),
        }
    }

    pub fn get_all_stats(&self) -> Vec<ScriptStats> {
        let mut script_ids: Vec<String> =
            self.records.iter().map(|r| r.script_id.clone()).collect();
        script_ids.sort();
        script_ids.dedup();

        script_ids
            .iter()
            .map(|id| self.get_script_stats(id))
            .collect()
    }

    pub fn clear_history(&mut self) {
        self.records.clear();
        self.chain_records.clear();
    }

    pub fn clear_script_history(&mut self, script_id: &str) {
        self.records.retain(|r| r.script_id != script_id);
    }

    pub fn record_count(&self) -> usize {
        self.records.len()
    }

    pub fn chain_record_count(&self) -> usize {
        self.chain_records.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_record(id: &str, script_id: &str, session_id: &str, status: ExecutionStatus, stdout: Option<&str>) -> ExecutionRecord {
        ExecutionRecord {
            id: id.to_string(),
            script_id: script_id.to_string(),
            script_name: format!("Script {}", script_id),
            session_id: Some(session_id.to_string()),
            connection_id: None,
            trigger_type: "manual".to_string(),
            started_at: Utc::now(),
            ended_at: None,
            duration_ms: 100,
            exit_code: Some(0),
            stdout: stdout.map(String::from),
            stderr: None,
            status,
            error: None,
            resolved_variables: HashMap::new(),
            attempt: 1,
            chain_execution_id: None,
            chain_step_index: None,
        }
    }

    #[test]
    fn latest_outputs_empty_history() {
        let h = ExecutionHistory::new(100);
        let outputs = h.latest_outputs_by_script("s1");
        assert!(outputs.is_empty());
    }

    #[test]
    fn latest_outputs_single_success() {
        let mut h = ExecutionHistory::new(100);
        h.add_record(make_record("r1", "deploy", "s1", ExecutionStatus::Success, Some("ok")));
        let outputs = h.latest_outputs_by_script("s1");
        assert_eq!(outputs.get("deploy"), Some(&"ok".to_string()));
    }

    #[test]
    fn latest_outputs_filters_by_session() {
        let mut h = ExecutionHistory::new(100);
        h.add_record(make_record("r1", "deploy", "s1", ExecutionStatus::Success, Some("s1-out")));
        h.add_record(make_record("r2", "deploy", "s2", ExecutionStatus::Success, Some("s2-out")));
        let outputs = h.latest_outputs_by_script("s1");
        assert_eq!(outputs.get("deploy"), Some(&"s1-out".to_string()));
        assert_eq!(outputs.len(), 1);
    }

    #[test]
    fn latest_outputs_skips_failed() {
        let mut h = ExecutionHistory::new(100);
        h.add_record(make_record("r1", "deploy", "s1", ExecutionStatus::Success, Some("good")));
        h.add_record(make_record("r2", "deploy", "s1", ExecutionStatus::Failed, Some("bad")));
        let outputs = h.latest_outputs_by_script("s1");
        // Should get "good" from the older success, not "bad" from the failed
        assert_eq!(outputs.get("deploy"), Some(&"good".to_string()));
    }

    #[test]
    fn latest_outputs_newest_wins() {
        let mut h = ExecutionHistory::new(100);
        h.add_record(make_record("r1", "deploy", "s1", ExecutionStatus::Success, Some("old")));
        h.add_record(make_record("r2", "deploy", "s1", ExecutionStatus::Success, Some("new")));
        let outputs = h.latest_outputs_by_script("s1");
        // Reverse iteration means r2 (newer, pushed last) is found first
        assert_eq!(outputs.get("deploy"), Some(&"new".to_string()));
    }

    #[test]
    fn latest_outputs_multiple_scripts() {
        let mut h = ExecutionHistory::new(100);
        h.add_record(make_record("r1", "deploy", "s1", ExecutionStatus::Success, Some("deployed")));
        h.add_record(make_record("r2", "backup", "s1", ExecutionStatus::Success, Some("backed-up")));
        h.add_record(make_record("r3", "health", "s1", ExecutionStatus::Success, Some("healthy")));
        let outputs = h.latest_outputs_by_script("s1");
        assert_eq!(outputs.len(), 3);
        assert_eq!(outputs.get("deploy"), Some(&"deployed".to_string()));
        assert_eq!(outputs.get("backup"), Some(&"backed-up".to_string()));
        assert_eq!(outputs.get("health"), Some(&"healthy".to_string()));
    }

    #[test]
    fn latest_outputs_skips_none_stdout() {
        let mut h = ExecutionHistory::new(100);
        h.add_record(make_record("r1", "deploy", "s1", ExecutionStatus::Success, None));
        let outputs = h.latest_outputs_by_script("s1");
        assert!(outputs.is_empty());
    }

    #[test]
    fn add_record_trims_to_max() {
        let mut h = ExecutionHistory::new(3);
        h.add_record(make_record("r1", "a", "s1", ExecutionStatus::Success, None));
        h.add_record(make_record("r2", "b", "s1", ExecutionStatus::Success, None));
        h.add_record(make_record("r3", "c", "s1", ExecutionStatus::Success, None));
        h.add_record(make_record("r4", "d", "s1", ExecutionStatus::Success, None));
        assert_eq!(h.record_count(), 3);
        // r1 should have been dropped
        assert!(h.get_record("r1").is_none());
        assert!(h.get_record("r4").is_some());
    }

    #[test]
    fn get_last_exit_code_returns_latest() {
        let mut h = ExecutionHistory::new(100);
        let mut r1 = make_record("r1", "test", "s1", ExecutionStatus::Success, None);
        r1.exit_code = Some(0);
        let mut r2 = make_record("r2", "test", "s1", ExecutionStatus::Failed, None);
        r2.exit_code = Some(1);
        h.add_record(r1);
        h.add_record(r2);
        assert_eq!(h.get_last_exit_code("test"), Some(1));
    }

    #[test]
    fn script_stats_correct() {
        let mut h = ExecutionHistory::new(100);
        h.add_record(make_record("r1", "test", "s1", ExecutionStatus::Success, None));
        h.add_record(make_record("r2", "test", "s1", ExecutionStatus::Failed, None));
        h.add_record(make_record("r3", "test", "s1", ExecutionStatus::Timeout, None));
        let stats = h.get_script_stats("test");
        assert_eq!(stats.total_runs, 3);
        assert_eq!(stats.success_count, 1);
        assert_eq!(stats.failure_count, 1);
        assert_eq!(stats.timeout_count, 1);
    }

    #[test]
    fn clear_script_history_selective() {
        let mut h = ExecutionHistory::new(100);
        h.add_record(make_record("r1", "deploy", "s1", ExecutionStatus::Success, None));
        h.add_record(make_record("r2", "backup", "s1", ExecutionStatus::Success, None));
        h.clear_script_history("deploy");
        assert_eq!(h.record_count(), 1);
        assert!(h.get_record("r1").is_none());
        assert!(h.get_record("r2").is_some());
    }
}

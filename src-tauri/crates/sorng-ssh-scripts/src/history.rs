// ── sorng-ssh-scripts/src/history.rs ─────────────────────────────────────────
//! Execution history tracker with querying and statistics.

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

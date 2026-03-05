use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::cache::FilterCache;
use crate::error::{FilterError, Result};
use crate::evaluator;
use crate::groups::SmartGroupManager;
use crate::presets;
use crate::types::*;

/// Thread-safe state handle for Tauri managed state.
pub type FilterServiceState = Arc<Mutex<FilterService>>;

/// Create a new [`FilterServiceState`] with default configuration.
pub fn create_filter_state() -> FilterServiceState {
    Arc::new(Mutex::new(FilterService::new(FiltersConfig::default())))
}

/// Create a [`FilterServiceState`] with the given config.
pub fn create_filter_state_with_config(config: FiltersConfig) -> FilterServiceState {
    Arc::new(Mutex::new(FilterService::new(config)))
}

/// Top-level service orchestrating filters, groups, cache, and presets.
pub struct FilterService {
    filters: HashMap<String, SmartFilter>,
    groups: SmartGroupManager,
    cache: FilterCache,
    config: FiltersConfig,
    total_evaluations: u64,
    total_evaluation_ms: f64,
}

impl FilterService {
    pub fn new(config: FiltersConfig) -> Self {
        Self {
            filters: HashMap::new(),
            groups: SmartGroupManager::new(),
            cache: FilterCache::new(config.clone()),
            config,
            total_evaluations: 0,
            total_evaluation_ms: 0.0,
        }
    }

    // ── Filter CRUD ─────────────────────────────────────────────

    pub fn create_filter(&mut self, filter: SmartFilter) -> Result<String> {
        if self.filters.len() >= self.config.max_filters {
            return Err(FilterError::LimitExceeded(format!(
                "Maximum number of filters ({}) reached",
                self.config.max_filters
            )));
        }
        let id = filter.id.clone();
        self.filters.insert(id.clone(), filter);
        log::info!("Created filter '{id}'");
        Ok(id)
    }

    pub fn delete_filter(&mut self, id: &str) -> Result<()> {
        self.filters
            .remove(id)
            .ok_or_else(|| FilterError::FilterNotFound(id.to_string()))?;
        self.cache.invalidate(id);
        log::info!("Deleted filter '{id}'");
        Ok(())
    }

    pub fn update_filter(&mut self, filter: SmartFilter) -> Result<()> {
        let id = filter.id.clone();
        if !self.filters.contains_key(&id) {
            return Err(FilterError::FilterNotFound(id));
        }
        self.cache.invalidate(&id);
        self.filters.insert(id.clone(), filter);
        log::info!("Updated filter '{id}'");
        Ok(())
    }

    pub fn get_filter(&self, id: &str) -> Result<&SmartFilter> {
        self.filters
            .get(id)
            .ok_or_else(|| FilterError::FilterNotFound(id.to_string()))
    }

    pub fn list_filters(&self) -> Vec<&SmartFilter> {
        let mut filters: Vec<&SmartFilter> = self.filters.values().collect();
        filters.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        filters
    }

    // ── Evaluation ──────────────────────────────────────────────

    /// Evaluate a filter against connections, using cache when possible.
    pub fn evaluate(
        &mut self,
        filter_id: &str,
        connections: &[serde_json::Value],
    ) -> Result<FilterResult> {
        // Check cache
        if let Some(cached) = self.cache.get(filter_id) {
            return Ok(cached.clone());
        }

        let filter = self
            .filters
            .get(filter_id)
            .ok_or_else(|| FilterError::FilterNotFound(filter_id.to_string()))?
            .clone();

        let result = evaluator::evaluate_filter(&filter, connections)?;

        self.total_evaluations += 1;
        self.total_evaluation_ms += result.duration_ms;
        self.cache.set(filter_id, result.clone());

        Ok(result)
    }

    /// Evaluate a filter object directly (no lookup by ID, no cache).
    pub fn evaluate_inline(
        &mut self,
        filter: &SmartFilter,
        connections: &[serde_json::Value],
    ) -> Result<FilterResult> {
        let result = evaluator::evaluate_filter(filter, connections)?;
        self.total_evaluations += 1;
        self.total_evaluation_ms += result.duration_ms;
        Ok(result)
    }

    // ── Presets ─────────────────────────────────────────────────

    pub fn get_presets(&self) -> Vec<FilterPreset> {
        presets::get_built_in_presets()
    }

    // ── Smart Groups ────────────────────────────────────────────

    pub fn create_smart_group(&mut self, group: SmartGroup) -> Result<String> {
        if self.groups.count() >= self.config.max_smart_groups {
            return Err(FilterError::LimitExceeded(format!(
                "Maximum number of smart groups ({}) reached",
                self.config.max_smart_groups
            )));
        }
        self.groups.create_group(group)
    }

    pub fn delete_smart_group(&mut self, id: &str) -> Result<()> {
        self.groups.delete_group(id)
    }

    pub fn update_smart_group(&mut self, group: SmartGroup) -> Result<()> {
        self.groups.update_group(group)
    }

    pub fn list_smart_groups(&self) -> Vec<&SmartGroup> {
        self.groups.list_groups()
    }

    pub fn evaluate_smart_group(
        &mut self,
        group_id: &str,
        connections: &[serde_json::Value],
    ) -> Result<FilterResult> {
        let group = self.groups.get_group(group_id)?.clone();
        let filter = self.get_filter(&group.filter_id)?.clone();
        let result = evaluator::evaluate_filter(&filter, connections)?;
        self.total_evaluations += 1;
        self.total_evaluation_ms += result.duration_ms;
        Ok(result)
    }

    // ── Cache ───────────────────────────────────────────────────

    pub fn invalidate_cache(&mut self) {
        self.cache.invalidate_all();
    }

    // ── Stats ───────────────────────────────────────────────────

    pub fn get_stats(&self) -> FilterStats {
        let avg_ms = if self.total_evaluations == 0 {
            0.0
        } else {
            self.total_evaluation_ms / self.total_evaluations as f64
        };
        FilterStats {
            total_filters: self.filters.len(),
            total_smart_groups: self.groups.count(),
            total_evaluations: self.total_evaluations,
            avg_evaluation_ms: avg_ms,
            cache_hit_rate: self.cache.hit_rate(),
        }
    }

    // ── Config ──────────────────────────────────────────────────

    pub fn get_config(&self) -> &FiltersConfig {
        &self.config
    }

    pub fn update_config(&mut self, config: FiltersConfig) {
        self.cache.update_config(config.clone());
        self.config = config;
        log::info!("Filter config updated");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_connections() -> Vec<serde_json::Value> {
        vec![
            json!({"id":"1","name":"SSH Server","protocol":"ssh","hostname":"10.0.0.1","port":22,"favorite":true,"status":"online","connectionCount":10,"lastConnected":"2025-12-01T10:00:00Z","createdAt":"2024-01-01T00:00:00Z"}),
            json!({"id":"2","name":"RDP Desktop","protocol":"rdp","hostname":"10.0.0.2","port":3389,"favorite":false,"status":"offline","connectionCount":0,"lastConnected":null,"createdAt":"2024-06-01T00:00:00Z"}),
            json!({"id":"3","name":"VNC Box","protocol":"vnc","hostname":"192.168.1.50","port":5900,"favorite":false,"status":"online","connectionCount":3,"lastConnected":"2025-11-15T08:00:00Z","createdAt":"2024-03-15T00:00:00Z"}),
        ]
    }

    #[test]
    fn test_create_and_evaluate() {
        let mut svc = FilterService::new(FiltersConfig::default());
        let mut f = SmartFilter::new("SSH Only", "Filter SSH");
        f.conditions.push(FilterCondition {
            field: FilterField::Protocol,
            operator: FilterOperator::Equals,
            value: FilterValue::String("ssh".into()),
            negate: false,
        });
        let fid = svc.create_filter(f).unwrap();
        let result = svc.evaluate(&fid, &sample_connections()).unwrap();
        assert_eq!(result.match_count, 1);
        assert_eq!(result.matching_ids, vec!["1"]);
    }

    #[test]
    fn test_cache_hit() {
        let mut svc = FilterService::new(FiltersConfig::default());
        let f = SmartFilter::new("All", "");
        let fid = svc.create_filter(f).unwrap();
        let conns = sample_connections();

        // First call: miss
        let _ = svc.evaluate(&fid, &conns).unwrap();
        // Second call: should hit cache
        let _ = svc.evaluate(&fid, &conns).unwrap();

        let stats = svc.get_stats();
        assert!(stats.cache_hit_rate > 0.0);
    }

    #[test]
    fn test_limit_exceeded() {
        let cfg = FiltersConfig {
            max_filters: 1,
            ..Default::default()
        };
        let mut svc = FilterService::new(cfg);
        svc.create_filter(SmartFilter::new("A", "")).unwrap();
        let result = svc.create_filter(SmartFilter::new("B", ""));
        assert!(result.is_err());
    }

    #[test]
    fn test_get_presets() {
        let svc = FilterService::new(FiltersConfig::default());
        assert!(svc.get_presets().len() >= 15);
    }

    #[test]
    fn test_smart_group_lifecycle() {
        let mut svc = FilterService::new(FiltersConfig::default());
        let f = SmartFilter::new("SSH", "");
        let fid = svc.create_filter(f).unwrap();

        let g = SmartGroup::new("My SSH Group", &fid);
        let gid = svc.create_smart_group(g).unwrap();
        assert_eq!(svc.list_smart_groups().len(), 1);

        let result = svc
            .evaluate_smart_group(&gid, &sample_connections())
            .unwrap();
        assert_eq!(result.total_evaluated, 3);

        svc.delete_smart_group(&gid).unwrap();
        assert_eq!(svc.list_smart_groups().len(), 0);
    }
}

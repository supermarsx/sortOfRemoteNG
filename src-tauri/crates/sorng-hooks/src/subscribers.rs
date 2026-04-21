//! Subscriber registry with a fluent builder API.

use std::collections::HashMap;

use chrono::Utc;
use uuid::Uuid;

use crate::error::HookError;
use crate::types::*;

// ─── Registry ───────────────────────────────────────────────────────

/// A dedicated container for managing [`HookSubscription`]s.
pub struct SubscriberRegistry {
    subs: HashMap<String, HookSubscription>,
}

impl SubscriberRegistry {
    pub fn new() -> Self {
        Self {
            subs: HashMap::new(),
        }
    }

    /// Add a subscription.  Returns its ID.
    pub fn add(&mut self, sub: HookSubscription) -> String {
        let id = sub.id.clone();
        self.subs.insert(id.clone(), sub);
        id
    }

    /// Remove a subscription by ID.
    pub fn remove(&mut self, id: &str) -> Result<HookSubscription, HookError> {
        self.subs
            .remove(id)
            .ok_or_else(|| HookError::SubscriptionNotFound(id.to_string()))
    }

    /// Retrieve a subscription by ID.
    pub fn get(&self, id: &str) -> Option<&HookSubscription> {
        self.subs.get(id)
    }

    /// Get all subscriptions.
    pub fn get_all(&self) -> Vec<&HookSubscription> {
        self.subs.values().collect()
    }

    /// Enable a subscription.
    pub fn enable(&mut self, id: &str) -> Result<(), HookError> {
        let sub = self
            .subs
            .get_mut(id)
            .ok_or_else(|| HookError::SubscriptionNotFound(id.to_string()))?;
        sub.enabled = true;
        sub.updated_at = Utc::now();
        Ok(())
    }

    /// Disable a subscription.
    pub fn disable(&mut self, id: &str) -> Result<(), HookError> {
        let sub = self
            .subs
            .get_mut(id)
            .ok_or_else(|| HookError::SubscriptionNotFound(id.to_string()))?;
        sub.enabled = false;
        sub.updated_at = Utc::now();
        Ok(())
    }

    /// Replace the filter on a subscription.
    pub fn update_filter(&mut self, id: &str, filter: Option<HookFilter>) -> Result<(), HookError> {
        let sub = self
            .subs
            .get_mut(id)
            .ok_or_else(|| HookError::SubscriptionNotFound(id.to_string()))?;
        sub.filter = filter;
        sub.updated_at = Utc::now();
        Ok(())
    }

    /// Return all subscriptions that listen for `event_type`.
    pub fn get_by_event_type(&self, event_type: &HookEvent) -> Vec<&HookSubscription> {
        self.subs
            .values()
            .filter(|s| s.event_types.contains(event_type))
            .collect()
    }

    /// Return only enabled subscriptions.
    pub fn get_enabled(&self) -> Vec<&HookSubscription> {
        self.subs.values().filter(|s| s.enabled).collect()
    }

    /// Total number of subscriptions.
    pub fn count(&self) -> usize {
        self.subs.len()
    }

    /// Remove all subscriptions.
    pub fn clear(&mut self) {
        self.subs.clear();
    }
}

impl Default for SubscriberRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Builder ────────────────────────────────────────────────────────

/// Fluent builder for constructing a [`HookSubscription`].
pub struct SubscriberBuilder {
    name: String,
    description: String,
    event_types: Vec<HookEvent>,
    priority: i32,
    enabled: bool,
    filter: Option<HookFilter>,
}

impl SubscriberBuilder {
    /// Start building a new subscription with the given `name`.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: String::new(),
            event_types: Vec::new(),
            priority: 0,
            enabled: true,
            filter: None,
        }
    }

    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = desc.into();
        self
    }

    pub fn event_type(mut self, evt: HookEvent) -> Self {
        self.event_types.push(evt);
        self
    }

    pub fn event_types(mut self, evts: Vec<HookEvent>) -> Self {
        self.event_types.extend(evts);
        self
    }

    pub fn priority(mut self, p: i32) -> Self {
        self.priority = p;
        self
    }

    pub fn enabled(mut self, e: bool) -> Self {
        self.enabled = e;
        self
    }

    pub fn filter(mut self, f: HookFilter) -> Self {
        self.filter = Some(f);
        self
    }

    /// Consume the builder and produce a [`HookSubscription`].
    pub fn build(self) -> HookSubscription {
        let now = Utc::now();
        HookSubscription {
            id: Uuid::new_v4().to_string(),
            name: self.name,
            description: self.description,
            event_types: self.event_types,
            priority: self.priority,
            enabled: self.enabled,
            filter: self.filter,
            created_at: now,
            updated_at: now,
        }
    }
}

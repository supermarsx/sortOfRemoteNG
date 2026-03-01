// ── Memory Management ─────────────────────────────────────────────────────────

use std::collections::HashMap;
use chrono::Utc;
use uuid::Uuid;

use super::types::*;

// ── Memory Store ─────────────────────────────────────────────────────────────

pub struct MemoryStore {
    entries: Vec<MemoryEntry>,
    config: MemoryConfig,
}

impl MemoryStore {
    pub fn new(config: MemoryConfig) -> Self {
        Self { entries: Vec::new(), config }
    }

    pub fn default_config() -> MemoryConfig {
        MemoryConfig {
            memory_type: MemoryType::Buffer,
            max_messages: 200,
            auto_summarize: true,
            max_tokens: 128_000,
            namespace: None,
        }
    }

    pub fn config(&self) -> &MemoryConfig { &self.config }
    pub fn update_config(&mut self, config: MemoryConfig) { self.config = config; }

    // ── Entry CRUD ───────────────────────────────────────────────────────────

    pub fn add_entry(&mut self, content: &str, namespace: Option<&str>, metadata: HashMap<String, serde_json::Value>) -> String {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let ns = namespace.unwrap_or_else(|| {
            self.config.namespace.as_deref().unwrap_or("default")
        }).to_string();

        let entry = MemoryEntry {
            id: id.clone(),
            namespace: ns,
            content: content.to_string(),
            embedding: None,
            metadata,
            created_at: now,
            access_count: 0,
            last_accessed: now,
            relevance_score: None,
        };

        self.entries.push(entry);

        // Evict oldest if over capacity
        let max = self.config.max_messages;
        if self.entries.len() > max {
            let remove_count = self.entries.len() - max;
            self.entries.drain(..remove_count);
        }

        id
    }

    pub fn add_message_entry(&mut self, role: &MessageRole, text: &str) -> String {
        let mut meta = HashMap::new();
        meta.insert("role".into(), serde_json::json!(format!("{:?}", role)));
        self.add_entry(text, None, meta)
    }

    pub fn get_entry(&mut self, id: &str) -> Option<&MemoryEntry> {
        if let Some(entry) = self.entries.iter_mut().find(|e| e.id == id) {
            entry.access_count += 1;
            entry.last_accessed = Utc::now();
        }
        self.entries.iter().find(|e| e.id == id)
    }

    pub fn remove_entry(&mut self, id: &str) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        self.entries.len() < before
    }

    pub fn list_entries(&self, namespace: Option<&str>) -> Vec<&MemoryEntry> {
        match namespace {
            Some(ns) => self.entries.iter().filter(|e| e.namespace == ns).collect(),
            None => self.entries.iter().collect(),
        }
    }

    pub fn count(&self) -> usize { self.entries.len() }

    pub fn clear(&mut self) { self.entries.clear(); }

    pub fn clear_namespace(&mut self, namespace: &str) {
        self.entries.retain(|e| e.namespace != namespace);
    }

    // ── Context retrieval (for feeding into prompts) ─────────────────────────

    pub fn get_context_messages(&self, limit: usize) -> Vec<&MemoryEntry> {
        let start = self.entries.len().saturating_sub(limit);
        self.entries[start..].iter().collect()
    }

    pub fn get_context_by_tokens(&self, max_tokens: u32) -> Vec<&MemoryEntry> {
        // Approximate: 4 chars ≈ 1 token
        let mut budget = max_tokens as usize;
        let mut result = Vec::new();
        for entry in self.entries.iter().rev() {
            let approx_tokens = entry.content.len() / 4;
            if approx_tokens > budget { break; }
            budget -= approx_tokens;
            result.push(entry);
        }
        result.reverse();
        result
    }

    // ── Search (basic text matching; embeddings handled by VectorStore) ──────

    pub fn search_entries(&self, query: &str, limit: usize) -> Vec<&MemoryEntry> {
        let q = query.to_lowercase();
        let mut matches: Vec<_> = self.entries.iter()
            .filter(|e| e.content.to_lowercase().contains(&q))
            .collect();
        matches.truncate(limit);
        matches
    }

    // ── Embedding support ────────────────────────────────────────────────────

    pub fn set_entry_embedding(&mut self, id: &str, embedding: Vec<f32>) -> Result<(), String> {
        let entry = self.entries.iter_mut().find(|e| e.id == id)
            .ok_or_else(|| format!("Memory entry {} not found", id))?;
        entry.embedding = Some(embedding);
        Ok(())
    }

    pub fn similarity_search(&self, query_embedding: &[f32], limit: usize, threshold: f32) -> Vec<(&MemoryEntry, f32)> {
        let mut scored: Vec<_> = self.entries.iter()
            .filter_map(|e| {
                e.embedding.as_ref().map(|emb| {
                    let score = cosine_similarity(query_embedding, emb);
                    (e, score)
                })
            })
            .filter(|(_, s)| *s >= threshold)
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        scored
    }

    // ── Summary (stub – real implementation would call an LLM) ───────────────

    pub fn build_summary(&self) -> String {
        let count = self.entries.len();
        if count == 0 { return "No memory entries.".to_string(); }

        let namespaces: std::collections::HashSet<_> = self.entries.iter().map(|e| e.namespace.as_str()).collect();
        format!(
            "Memory: {} entries across {} namespace(s) [{}]. Latest: \"{}\"",
            count,
            namespaces.len(),
            namespaces.into_iter().collect::<Vec<_>>().join(", "),
            self.entries.last().map(|e| {
                if e.content.len() > 80 { format!("{}…", &e.content[..80]) } else { e.content.clone() }
            }).unwrap_or_default()
        )
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() { return 0.0; }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let mag_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 { return 0.0; }
    dot / (mag_a * mag_b)
}

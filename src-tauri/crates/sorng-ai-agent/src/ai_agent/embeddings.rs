// ── Embeddings & Vector Operations ───────────────────────────────────────────
//
// In-memory vector store with cosine similarity search, batch operations,
// and provider-agnostic embedding generation.

use std::collections::HashMap;

use super::types::*;
use super::AI_VECTOR_STORE;

// ── Vector Math ──────────────────────────────────────────────────────────────

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() { return 0.0; }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 { return 0.0; }
    dot / (norm_a * norm_b)
}

pub fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() { return f32::MAX; }
    a.iter().zip(b.iter()).map(|(x, y)| (x - y).powi(2)).sum::<f32>().sqrt()
}

pub fn dot_product(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() { return 0.0; }
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

pub fn normalize(v: &[f32]) -> Vec<f32> {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm == 0.0 { return v.to_vec(); }
    v.iter().map(|x| x / norm).collect()
}

pub fn mean_vector(vectors: &[Vec<f32>]) -> Vec<f32> {
    if vectors.is_empty() { return Vec::new(); }
    let dim = vectors[0].len();
    let mut result = vec![0.0f32; dim];
    for v in vectors {
        for (i, val) in v.iter().enumerate() {
            if i < dim { result[i] += val; }
        }
    }
    let n = vectors.len() as f32;
    result.iter_mut().for_each(|x| *x /= n);
    result
}

// ── In-Memory Vector Store ───────────────────────────────────────────────────

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorEntry {
    pub id: String,
    pub collection: String,
    pub text: String,
    pub embedding: Vec<f32>,
    pub metadata: HashMap<String, serde_json::Value>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub struct VectorStore {
    collections: HashMap<String, Vec<VectorEntry>>,
}

impl VectorStore {
    pub fn new() -> Self {
        Self { collections: HashMap::new() }
    }

    pub fn upsert(&mut self, entry: VectorEntry) {
        let coll = self.collections.entry(entry.collection.clone()).or_insert_with(Vec::new);
        if let Some(pos) = coll.iter().position(|e| e.id == entry.id) {
            coll[pos] = entry;
        } else {
            coll.push(entry);
        }
    }

    pub fn batch_upsert(&mut self, entries: Vec<VectorEntry>) {
        for entry in entries { self.upsert(entry); }
    }

    pub fn search(
        &self, collection: &str, query_vec: &[f32], top_k: usize, min_score: Option<f32>,
    ) -> Vec<SimilarityResult> {
        let min = min_score.unwrap_or(0.0);
        let entries = match self.collections.get(collection) {
            Some(e) => e,
            None => return Vec::new(),
        };

        let mut results: Vec<SimilarityResult> = entries.iter()
            .enumerate()
            .map(|(idx, e)| {
                let score = cosine_similarity(query_vec, &e.embedding);
                SimilarityResult {
                    index: idx,
                    text: e.text.clone(),
                    score,
                    metadata: e.metadata.clone(),
                }
            })
            .filter(|r| r.score >= min)
            .collect();

        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(top_k);
        results
    }

    pub fn remove(&mut self, collection: &str, id: &str) -> bool {
        if let Some(coll) = self.collections.get_mut(collection) {
            let before = coll.len();
            coll.retain(|e| e.id != id);
            coll.len() < before
        } else { false }
    }

    pub fn drop_collection(&mut self, collection: &str) -> bool {
        self.collections.remove(collection).is_some()
    }

    pub fn list_collections(&self) -> Vec<(String, usize)> {
        self.collections.iter().map(|(k, v)| (k.clone(), v.len())).collect()
    }

    pub fn total_entries(&self) -> usize {
        self.collections.values().map(|v| v.len()).sum()
    }

    pub fn get_entries(
        &self, collection: &str, filter: Option<&HashMap<String, serde_json::Value>>,
    ) -> Vec<&VectorEntry> {
        let entries = match self.collections.get(collection) {
            Some(e) => e,
            None => return Vec::new(),
        };
        match filter {
            Some(f) => entries.iter().filter(|e| {
                f.iter().all(|(k, v)| e.metadata.get(k).map(|mv| mv == v).unwrap_or(false))
            }).collect(),
            None => entries.iter().collect(),
        }
    }
}

// ── Global Vector Store Helpers ──────────────────────────────────────────────

pub fn global_vector_upsert(entry: VectorEntry) {
    if let Ok(mut store) = AI_VECTOR_STORE.lock() {
        store.upsert(entry);
    }
}

pub fn global_vector_search(
    collection: &str, query_vec: &[f32], top_k: usize, min_score: Option<f32>,
) -> Vec<SimilarityResult> {
    match AI_VECTOR_STORE.lock() {
        Ok(store) => store.search(collection, query_vec, top_k, min_score),
        Err(_) => Vec::new(),
    }
}

pub fn global_vector_collections() -> Vec<(String, usize)> {
    match AI_VECTOR_STORE.lock() {
        Ok(store) => store.list_collections(),
        Err(_) => Vec::new(),
    }
}

pub fn global_vector_drop_collection(collection: &str) -> bool {
    match AI_VECTOR_STORE.lock() {
        Ok(mut store) => store.drop_collection(collection),
        Err(_) => false,
    }
}

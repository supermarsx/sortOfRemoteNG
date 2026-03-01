// ── RAG (Retrieval-Augmented Generation) ──────────────────────────────────────

use std::collections::HashMap;
use uuid::Uuid;

use super::types::*;

// ── Document Store ───────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct StoredDocument {
    pub document_id: String,
    pub collection: String,
    pub title: Option<String>,
    pub source: Option<String>,
    pub chunks: Vec<DocumentChunk>,
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct DocumentChunk {
    pub chunk_index: usize,
    pub content: String,
    pub embedding: Option<Vec<f32>>,
}

pub struct RagStore {
    documents: HashMap<String, StoredDocument>,
}

impl RagStore {
    pub fn new() -> Self { Self { documents: HashMap::new() } }

    // ── Ingestion ────────────────────────────────────────────────────────────

    pub fn ingest(&mut self, req: IngestDocumentRequest) -> Result<String, String> {
        let chunking = req.chunking.unwrap_or_default();
        let raw_chunks = chunk_text(&req.content, &chunking);

        let chunks: Vec<DocumentChunk> = raw_chunks.into_iter().enumerate().map(|(i, text)| {
            DocumentChunk { chunk_index: i, content: text, embedding: None }
        }).collect();

        let doc_id = if req.document_id.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            req.document_id.clone()
        };

        let doc = StoredDocument {
            document_id: doc_id.clone(),
            collection: req.collection.clone(),
            title: req.title,
            source: req.source,
            chunks,
            metadata: req.metadata,
        };
        self.documents.insert(doc_id.clone(), doc);
        Ok(doc_id)
    }

    pub fn remove_document(&mut self, doc_id: &str) -> bool {
        self.documents.remove(doc_id).is_some()
    }

    pub fn get_document(&self, doc_id: &str) -> Option<&StoredDocument> {
        self.documents.get(doc_id)
    }

    pub fn list_documents(&self, collection: &str) -> Vec<&StoredDocument> {
        self.documents.values().filter(|d| d.collection == collection).collect()
    }

    pub fn document_count(&self) -> usize { self.documents.len() }

    pub fn collection_names(&self) -> Vec<String> {
        let mut names: Vec<_> = self.documents.values()
            .map(|d| d.collection.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter().collect();
        names.sort();
        names
    }

    pub fn collection_count(&self) -> usize {
        self.collection_names().len()
    }

    // ── Embedding assignment ─────────────────────────────────────────────────

    pub fn set_chunk_embedding(&mut self, doc_id: &str, chunk_index: usize, embedding: Vec<f32>) -> Result<(), String> {
        let doc = self.documents.get_mut(doc_id)
            .ok_or_else(|| format!("Document {} not found", doc_id))?;
        let chunk = doc.chunks.get_mut(chunk_index)
            .ok_or_else(|| format!("Chunk {} not found in document {}", chunk_index, doc_id))?;
        chunk.embedding = Some(embedding);
        Ok(())
    }

    // ── Search ───────────────────────────────────────────────────────────────

    pub fn search(&self, req: &RagSearchRequest, query_embedding: Option<&[f32]>) -> Vec<RagSearchResult> {
        let mut results = Vec::new();

        for doc in self.documents.values() {
            if doc.collection != req.collection { continue; }

            // Apply metadata filter
            if !metadata_matches(&doc.metadata, &req.filter) { continue; }

            for chunk in &doc.chunks {
                let score = match query_embedding {
                    Some(qe) => {
                        match &chunk.embedding {
                            Some(ce) => cosine_similarity(qe, ce),
                            None => {
                                // Fallback: simple text similarity
                                text_similarity(&req.query, &chunk.content)
                            }
                        }
                    }
                    None => text_similarity(&req.query, &chunk.content),
                };

                if score >= req.similarity_threshold {
                    results.push(RagSearchResult {
                        document_id: doc.document_id.clone(),
                        chunk_index: chunk.chunk_index,
                        content: chunk.content.clone(),
                        score,
                        title: doc.title.clone(),
                        source: doc.source.clone(),
                        metadata: doc.metadata.clone(),
                    });
                }
            }
        }

        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(req.top_k);
        results
    }

    /// Text-only search (no embeddings needed).
    pub fn text_search(&self, collection: &str, query: &str, top_k: usize) -> Vec<RagSearchResult> {
        let req = RagSearchRequest {
            collection: collection.to_string(),
            query: query.to_string(),
            top_k,
            similarity_threshold: 0.0,
            filter: HashMap::new(),
        };
        self.search(&req, None)
    }
}

// ── Chunking ─────────────────────────────────────────────────────────────────

pub fn chunk_text(text: &str, config: &ChunkingConfig) -> Vec<String> {
    if text.is_empty() { return Vec::new(); }

    match config.strategy {
        ChunkingStrategy::FixedSize => chunk_fixed_size(text, config.chunk_size, config.chunk_overlap),
        ChunkingStrategy::RecursiveCharacter => chunk_recursive(text, config.chunk_size, config.chunk_overlap),
        ChunkingStrategy::Sentence => chunk_by_pattern(text, &[". ", "! ", "? ", ".\n"], config.chunk_size, config.chunk_overlap),
        ChunkingStrategy::Paragraph => chunk_by_pattern(text, &["\n\n", "\r\n\r\n"], config.chunk_size, config.chunk_overlap),
        ChunkingStrategy::Markdown => chunk_markdown(text, config.chunk_size, config.chunk_overlap),
        ChunkingStrategy::Semantic => {
            // Semantic chunking requires embeddings; fall back to recursive
            chunk_recursive(text, config.chunk_size, config.chunk_overlap)
        }
    }
}

fn chunk_fixed_size(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0;
    let step = if size > overlap { size - overlap } else { 1 };
    while start < chars.len() {
        let end = (start + size).min(chars.len());
        chunks.push(chars[start..end].iter().collect());
        start += step;
        if end == chars.len() { break; }
    }
    chunks
}

fn chunk_recursive(text: &str, size: usize, overlap: usize) -> Vec<String> {
    let separators = ["\n\n", "\n", ". ", " "];
    recursive_split(text, &separators, size, overlap)
}

fn recursive_split(text: &str, separators: &[&str], size: usize, overlap: usize) -> Vec<String> {
    if text.len() <= size { return vec![text.to_string()]; }

    for &sep in separators {
        let parts: Vec<&str> = text.split(sep).collect();
        if parts.len() <= 1 { continue; }

        let mut chunks = Vec::new();
        let mut current = String::new();

        for part in parts {
            let candidate = if current.is_empty() {
                part.to_string()
            } else {
                format!("{}{}{}", current, sep, part)
            };

            if candidate.len() > size && !current.is_empty() {
                chunks.push(current.clone());
                // Overlap: take the tail of current
                let tail_start = current.len().saturating_sub(overlap);
                current = format!("{}{}{}", &current[tail_start..], sep, part);
            } else {
                current = candidate;
            }
        }
        if !current.is_empty() { chunks.push(current); }

        if chunks.len() > 1 { return chunks; }
    }

    // Fallback to fixed-size
    chunk_fixed_size(text, size, overlap)
}

fn chunk_by_pattern(text: &str, patterns: &[&str], max_size: usize, overlap: usize) -> Vec<String> {
    let mut split_points = vec![0usize];
    for pat in patterns {
        let mut start = 0;
        while let Some(pos) = text[start..].find(pat) {
            let abs = start + pos + pat.len();
            split_points.push(abs);
            start = abs;
        }
    }
    split_points.sort();
    split_points.dedup();
    if *split_points.last().unwrap_or(&0) < text.len() {
        split_points.push(text.len());
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut prev_end = 0usize;

    for &point in &split_points[1..] {
        let segment = &text[prev_end..point];
        let candidate = format!("{}{}", current, segment);
        if candidate.len() > max_size && !current.is_empty() {
            chunks.push(current.clone());
            let tail_start = current.len().saturating_sub(overlap);
            current = format!("{}{}", &current[tail_start..], segment);
        } else {
            current = candidate;
        }
        prev_end = point;
    }
    if !current.is_empty() { chunks.push(current); }
    if chunks.is_empty() { chunks.push(text.to_string()); }
    chunks
}

fn chunk_markdown(text: &str, max_size: usize, overlap: usize) -> Vec<String> {
    // Split at markdown headings (# ... ##)
    let mut sections = Vec::new();
    let mut current_section = String::new();

    for line in text.lines() {
        if line.starts_with('#') && !current_section.is_empty() {
            sections.push(current_section.clone());
            current_section.clear();
        }
        if !current_section.is_empty() { current_section.push('\n'); }
        current_section.push_str(line);
    }
    if !current_section.is_empty() { sections.push(current_section); }

    // If sections are too large, split them further
    let mut chunks = Vec::new();
    for section in sections {
        if section.len() <= max_size {
            chunks.push(section);
        } else {
            chunks.extend(chunk_recursive(&section, max_size, overlap));
        }
    }
    if chunks.is_empty() { chunks.push(text.to_string()); }
    chunks
}

// ── Similarity helpers ───────────────────────────────────────────────────────

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() { return 0.0; }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let ma: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let mb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if ma == 0.0 || mb == 0.0 { 0.0 } else { dot / (ma * mb) }
}

fn text_similarity(query: &str, text: &str) -> f32 {
    let q = query.to_lowercase();
    let t = text.to_lowercase();
    let words: Vec<&str> = q.split_whitespace().collect();
    if words.is_empty() { return 0.0; }
    let hits = words.iter().filter(|w| t.contains(**w)).count();
    hits as f32 / words.len() as f32
}

fn metadata_matches(meta: &HashMap<String, serde_json::Value>, filter: &HashMap<String, serde_json::Value>) -> bool {
    for (k, v) in filter {
        match meta.get(k) {
            Some(mv) if mv == v => {},
            _ => return false,
        }
    }
    true
}

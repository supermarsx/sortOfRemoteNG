use std::time::Instant;

use sorng_llm::LlmServiceState;

use crate::types::*;
use crate::history::HistoryEngine;
use crate::snippets::SnippetEngine;
use crate::ai::AiEngine;

/// The unified search/ranking engine that federates results from multiple
/// sources (history, snippets, aliases, AI) and merges them into a single
/// sorted list.
pub struct SearchEngine;

impl SearchEngine {
    /// Execute a palette query against all sources.
    ///
    /// This is the main entry-point called by the Tauri command.
    pub async fn search(
        query: &PaletteQuery,
        history: &HistoryEngine,
        snippets: &SnippetEngine,
        aliases: &[Alias],
        config: &PaletteConfig,
        llm: Option<&LlmServiceState>,
    ) -> PaletteResponse {
        let start = Instant::now();
        let mut items: Vec<PaletteItem> = Vec::new();
        let mut hints: Vec<String> = Vec::new();
        let mut ai_used = false;

        let input = query.input.trim();
        let max = query.max_results.min(config.max_results);

        // Resolve effective OS context for filtering.
        let os_ctx = if query.filter_by_os {
            query.os_filter.as_ref()
                .or(query.context.os_context.as_ref())
        } else {
            None
        };

        if let Some(ctx) = &os_ctx {
            let label = match (&ctx.family, &ctx.distro) {
                (_, Some(d)) => format!("{:?}", d),
                (Some(f), _) => format!("{:?}", f),
                _ => "custom OS filter".to_string(),
            };
            hints.push(format!("Filtering for {}", label));
        }

        // ── 1. Check for snippet trigger expansion ──────────────────
        if config.auto_expand_triggers {
            if let Some((trigger, snippet)) = snippets.try_expand_trigger(input) {
                // OS filter: skip trigger if snippet doesn't match the session OS.
                let os_ok = os_ctx.map_or(true, |ctx| snippet.os_target.matches(ctx));
                if os_ok {
                    items.push(PaletteItem {
                        id: format!("trigger-{}", snippet.id),
                        label: format!("↯ {} — {}", trigger, snippet.name),
                        description: Some(snippet.description.clone()),
                        insert_text: snippet.template.clone(),
                        category: PaletteCategory::Snippet,
                        kind: PaletteItemKind::Snippet,
                        source: PaletteSource::Snippet,
                        score: 1.0, // Trigger matches are top priority.
                        risk_level: snippet.risk_level.clone(),
                        tags: snippet.tags.clone(),
                        documentation: Some(format!("Template: {}", snippet.template)),
                        icon: Some("snippet-trigger".to_string()),
                        shortcut: None,
                        pinned: false,
                        os_target: snippet.os_target.clone(),
                    });
                    hints.push(format!("Snippet trigger '{}' matched", trigger));
                }
            }
        }

        // ── 2. History matches ──────────────────────────────────────
        if query.include_history {
            let history_results = if let Some(ref ctx) = query.context.session_id {
                // Prefer session-specific history, fall back to global.
                let session = history.by_session(ctx, max);
                if session.is_empty() { history.search(input, max) } else { session }
            } else {
                history.search(input, max)
            };

            for (entry, score) in history_results {
                if score < config.min_score { continue; }
                // OS filter: if the history entry has an os_context, use it;
                // otherwise treat as universal and include it.
                if let Some(ctx) = os_ctx {
                    if let Some(ref entry_os) = entry.os_context {
                        // Build an OsTarget from the entry's recorded OS to check
                        // compatibility with the queried context (heuristic: an
                        // entry from an Ubuntu host is likely Ubuntu-specific).
                        let inferred_target = OsTarget {
                            families: entry_os.family.iter().cloned().collect(),
                            distros: entry_os.distro.iter().cloned().collect(),
                            ..Default::default()
                        };
                        if !inferred_target.is_universal() && !inferred_target.matches(ctx) {
                            continue;
                        }
                    }
                }
                items.push(PaletteItem {
                    id: format!("hist-{}", hash_string(&entry.command)),
                    label: entry.command.clone(),
                    description: Some(format!(
                        "Used {} time{} · {}",
                        entry.use_count,
                        if entry.use_count == 1 { "" } else { "s" },
                        entry.host.as_deref().unwrap_or("unknown host"),
                    )),
                    insert_text: entry.command.clone(),
                    category: if entry.pinned { PaletteCategory::Recent } else { PaletteCategory::History },
                    kind: PaletteItemKind::HistoryRecall,
                    source: PaletteSource::History,
                    score,
                    risk_level: PaletteRiskLevel::Safe,
                    tags: entry.tags.clone(),
                    documentation: entry.cwd.as_ref().map(|c| format!("CWD: {}", c)),
                    icon: Some(if entry.pinned { "pin" } else { "history" }.to_string()),
                    shortcut: None,
                    pinned: entry.pinned,
                    os_target: entry.os_context.as_ref().map(|oc| OsTarget {
                        families: oc.family.iter().cloned().collect(),
                        distros: oc.distro.iter().cloned().collect(),
                        ..Default::default()
                    }).unwrap_or_default(),
                });
            }
        }

        // ── 3. Snippet matches ──────────────────────────────────────
        if query.include_snippets {
            let snippet_results = snippets.search(input, max);
            for (snippet, score) in snippet_results {
                if score < config.min_score { continue; }
                // OS filter: skip snippets that don't match the session OS.
                if let Some(ctx) = os_ctx {
                    if !snippet.os_target.matches(ctx) { continue; }
                }
                items.push(PaletteItem {
                    id: format!("snip-{}", snippet.id),
                    label: snippet.name.clone(),
                    description: Some(snippet.description.clone()),
                    insert_text: snippet.template.clone(),
                    category: PaletteCategory::Snippet,
                    kind: PaletteItemKind::Snippet,
                    source: PaletteSource::Snippet,
                    score,
                    risk_level: snippet.risk_level.clone(),
                    tags: snippet.tags.clone(),
                    documentation: Some(format!("Template: {}", snippet.template)),
                    icon: Some("snippet".to_string()),
                    shortcut: snippet.trigger.as_ref().map(|t| format!("type {}", t)),
                    pinned: false,
                    os_target: snippet.os_target.clone(),
                });
            }
        }

        // ── 4. Alias matches ────────────────────────────────────────
        for alias in aliases {
            if !alias.enabled { continue; }
            // OS filter: skip aliases that don't match the session OS.
            if let Some(ctx) = os_ctx {
                if !alias.os_target.matches(ctx) { continue; }
            }
            if input.is_empty() || alias.trigger.contains(input) || alias.expansion.contains(input) {
                let score = if alias.trigger == input { 1.0 } else { 0.5 };
                if score < config.min_score { continue; }
                items.push(PaletteItem {
                    id: format!("alias-{}", alias.trigger),
                    label: format!("{} → {}", alias.trigger, alias.expansion),
                    description: alias.description.clone(),
                    insert_text: alias.expansion.clone(),
                    category: PaletteCategory::Alias,
                    kind: PaletteItemKind::Alias,
                    source: PaletteSource::Local,
                    score,
                    risk_level: PaletteRiskLevel::Safe,
                    tags: Vec::new(),
                    documentation: None,
                    icon: Some("alias".to_string()),
                    shortcut: None,
                    pinned: false,
                    os_target: alias.os_target.clone(),
                });
            }
        }

        // ── 5. Bigram prediction (contextual "next command") ────────
        if !query.context.recent_commands.is_empty() {
            if let Some(last) = query.context.recent_commands.last() {
                let predictions = history.predict_next(last, 5);
                for (cmd, prob) in predictions {
                    let score = prob * 0.8; // Slight discount vs direct matches.
                    if score < config.min_score { continue; }
                    // Avoid duplicates.
                    if items.iter().any(|i| i.insert_text == cmd) { continue; }
                    items.push(PaletteItem {
                        id: format!("pred-{}", hash_string(&cmd)),
                        label: cmd.clone(),
                        description: Some(format!("Predicted next command ({:.0}%)", prob * 100.0)),
                        insert_text: cmd,
                        category: PaletteCategory::Completion,
                        kind: PaletteItemKind::ShellCommand,
                        source: PaletteSource::History,
                        score,
                        risk_level: PaletteRiskLevel::Safe,
                        tags: vec!["prediction".to_string()],
                        documentation: None,
                        icon: Some("predict".to_string()),
                        shortcut: None,
                        pinned: false,
                        os_target: OsTarget::default(),
                    });
                }
            }
        }

        // ── 6. AI suggestions (if enabled and input is non-trivial) ─
        if query.include_ai && config.ai_enabled && input.len() >= 2 {
            if let Some(llm_state) = llm {
                let snippet_triggers: Vec<String> = snippets.list().iter()
                    .filter_map(|s| s.trigger.clone())
                    .collect();

                // Race the AI call against a timeout.
                let ai_future = AiEngine::suggest(
                    llm_state,
                    input,
                    &query.context,
                    &query.context.recent_commands,
                    &snippet_triggers,
                );

                let timeout = std::time::Duration::from_millis(config.ai_timeout_ms);
                match tokio::time::timeout(timeout, ai_future).await {
                    Ok(suggestions) => {
                        ai_used = true;
                        let ai_items = AiEngine::into_palette_items(suggestions);
                        for item in ai_items {
                            // Avoid duplicate commands.
                            if items.iter().any(|i| i.insert_text == item.insert_text) { continue; }
                            items.push(item);
                        }
                    }
                    Err(_) => {
                        hints.push("AI suggestions timed out".to_string());
                    }
                }
            }
        }

        // ── 7. Sort by score (descending) with pinned items first ───
        items.sort_by(|a, b| {
            // Pinned first.
            b.pinned.cmp(&a.pinned)
                .then(b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal))
        });

        let total_matches = items.len();
        items.truncate(max);

        let elapsed = start.elapsed().as_millis() as u64;

        PaletteResponse {
            items,
            total_matches,
            processing_time_ms: elapsed,
            ai_used,
            hints,
        }
    }
}

/// Simple string hash for deterministic IDs.
fn hash_string(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

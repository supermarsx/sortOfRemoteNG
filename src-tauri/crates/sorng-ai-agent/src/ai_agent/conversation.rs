// ── Conversation Management ───────────────────────────────────────────────────

use std::collections::HashMap;
use chrono::Utc;
use uuid::Uuid;

use super::types::*;

// ── Conversation Store ───────────────────────────────────────────────────────

pub struct ConversationStore {
    conversations: HashMap<String, Conversation>,
}

impl ConversationStore {
    pub fn new() -> Self { Self { conversations: HashMap::new() } }

    // ── CRUD ─────────────────────────────────────────────────────────────────

    pub fn create(&mut self, req: CreateConversationRequest) -> Conversation {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let title = req.title.unwrap_or_else(|| format!("Conversation {}", &id[..8]));

        let mut messages = Vec::new();
        if let Some(ref sp) = req.system_prompt {
            messages.push(ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: MessageRole::System,
                content: vec![ContentBlock::Text { text: sp.clone() }],
                tool_call_id: None,
                tool_calls: Vec::new(),
                name: None,
                created_at: now,
                token_count: None,
                metadata: HashMap::new(),
            });
        }

        let conv = Conversation {
            id: id.clone(),
            title,
            provider_id: req.provider_id,
            model: req.model,
            system_prompt: req.system_prompt,
            messages,
            params: req.params,
            tools: req.tools,
            created_at: now,
            updated_at: now,
            total_tokens: 0,
            total_cost: 0.0,
            tags: req.tags,
            pinned: false,
            archived: false,
            metadata: req.metadata,
        };
        self.conversations.insert(id, conv.clone());
        conv
    }

    pub fn get(&self, id: &str) -> Option<&Conversation> { self.conversations.get(id) }
    pub fn get_mut(&mut self, id: &str) -> Option<&mut Conversation> { self.conversations.get_mut(id) }

    pub fn delete(&mut self, id: &str) -> bool { self.conversations.remove(id).is_some() }

    pub fn list_all(&self) -> Vec<&Conversation> {
        let mut convs: Vec<_> = self.conversations.values().collect();
        convs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        convs
    }

    pub fn list_summaries(&self, provider_map: &dyn Fn(&str) -> AiProvider) -> Vec<ConversationSummary> {
        let mut summaries: Vec<_> = self.conversations.values().map(|c| {
            let last_preview = c.messages.last().and_then(|m| {
                m.content.first().and_then(|b| match b {
                    ContentBlock::Text { text } => Some(text.chars().take(120).collect()),
                    _ => None,
                })
            });
            ConversationSummary {
                id: c.id.clone(),
                title: c.title.clone(),
                provider: provider_map(&c.provider_id),
                model: c.model.clone(),
                message_count: c.messages.len(),
                total_tokens: c.total_tokens,
                total_cost: c.total_cost,
                created_at: c.created_at,
                updated_at: c.updated_at,
                tags: c.tags.clone(),
                pinned: c.pinned,
                archived: c.archived,
                last_message_preview: last_preview,
            }
        }).collect();
        summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        summaries
    }

    pub fn count(&self) -> usize { self.conversations.len() }

    // ── Message management ───────────────────────────────────────────────────

    pub fn add_message(&mut self, conversation_id: &str, message: ChatMessage) -> Result<(), String> {
        let conv = self.conversations.get_mut(conversation_id)
            .ok_or_else(|| format!("Conversation {} not found", conversation_id))?;
        if let Some(tc) = message.token_count {
            conv.total_tokens += tc;
        }
        conv.messages.push(message);
        conv.updated_at = Utc::now();
        Ok(())
    }

    pub fn add_user_message(&mut self, conversation_id: &str, text: &str) -> Result<ChatMessage, String> {
        let msg = ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: MessageRole::User,
            content: vec![ContentBlock::Text { text: text.to_string() }],
            tool_call_id: None,
            tool_calls: Vec::new(),
            name: None,
            created_at: Utc::now(),
            token_count: None,
            metadata: HashMap::new(),
        };
        self.add_message(conversation_id, msg.clone())?;
        Ok(msg)
    }

    pub fn add_assistant_message(
        &mut self, conversation_id: &str, text: &str, usage: Option<&TokenUsage>,
    ) -> Result<ChatMessage, String> {
        let msg = ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: MessageRole::Assistant,
            content: vec![ContentBlock::Text { text: text.to_string() }],
            tool_call_id: None,
            tool_calls: Vec::new(),
            name: None,
            created_at: Utc::now(),
            token_count: usage.map(|u| u.total_tokens),
            metadata: HashMap::new(),
        };
        if let Some(u) = usage {
            if let Some(conv) = self.conversations.get_mut(conversation_id) {
                conv.total_tokens += u.total_tokens;
                conv.total_cost += u.estimated_cost;
            }
        }
        self.add_message(conversation_id, msg.clone())?;
        Ok(msg)
    }

    pub fn get_messages(&self, conversation_id: &str) -> Result<Vec<ChatMessage>, String> {
        let conv = self.conversations.get(conversation_id)
            .ok_or_else(|| format!("Conversation {} not found", conversation_id))?;
        Ok(conv.messages.clone())
    }

    pub fn get_recent_messages(&self, conversation_id: &str, limit: usize) -> Result<Vec<ChatMessage>, String> {
        let conv = self.conversations.get(conversation_id)
            .ok_or_else(|| format!("Conversation {} not found", conversation_id))?;
        let start = conv.messages.len().saturating_sub(limit);
        Ok(conv.messages[start..].to_vec())
    }

    pub fn clear_messages(&mut self, conversation_id: &str) -> Result<(), String> {
        let conv = self.conversations.get_mut(conversation_id)
            .ok_or_else(|| format!("Conversation {} not found", conversation_id))?;
        // Keep system prompt if present
        conv.messages.retain(|m| m.role == MessageRole::System);
        conv.updated_at = Utc::now();
        Ok(())
    }

    // ── Conversation metadata ────────────────────────────────────────────────

    pub fn rename(&mut self, id: &str, title: &str) -> Result<(), String> {
        let conv = self.conversations.get_mut(id)
            .ok_or_else(|| format!("Conversation {} not found", id))?;
        conv.title = title.to_string();
        conv.updated_at = Utc::now();
        Ok(())
    }

    pub fn set_pinned(&mut self, id: &str, pinned: bool) -> Result<(), String> {
        let conv = self.conversations.get_mut(id)
            .ok_or_else(|| format!("Conversation {} not found", id))?;
        conv.pinned = pinned;
        conv.updated_at = Utc::now();
        Ok(())
    }

    pub fn set_archived(&mut self, id: &str, archived: bool) -> Result<(), String> {
        let conv = self.conversations.get_mut(id)
            .ok_or_else(|| format!("Conversation {} not found", id))?;
        conv.archived = archived;
        conv.updated_at = Utc::now();
        Ok(())
    }

    pub fn set_tags(&mut self, id: &str, tags: Vec<String>) -> Result<(), String> {
        let conv = self.conversations.get_mut(id)
            .ok_or_else(|| format!("Conversation {} not found", id))?;
        conv.tags = tags;
        conv.updated_at = Utc::now();
        Ok(())
    }

    pub fn update_system_prompt(&mut self, id: &str, prompt: Option<String>) -> Result<(), String> {
        let conv = self.conversations.get_mut(id)
            .ok_or_else(|| format!("Conversation {} not found", id))?;
        conv.system_prompt = prompt.clone();
        // Update the system message if present
        if let Some(msg) = conv.messages.iter_mut().find(|m| m.role == MessageRole::System) {
            if let Some(ref p) = prompt {
                msg.content = vec![ContentBlock::Text { text: p.clone() }];
            }
        } else if let Some(ref p) = prompt {
            conv.messages.insert(0, ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: MessageRole::System,
                content: vec![ContentBlock::Text { text: p.clone() }],
                tool_call_id: None, tool_calls: Vec::new(), name: None,
                created_at: Utc::now(), token_count: None, metadata: HashMap::new(),
            });
        }
        conv.updated_at = Utc::now();
        Ok(())
    }

    // ── Fork ─────────────────────────────────────────────────────────────────

    pub fn fork(&mut self, req: ForkConversationRequest) -> Result<Conversation, String> {
        let source = self.conversations.get(&req.conversation_id)
            .ok_or_else(|| format!("Conversation {} not found", req.conversation_id))?
            .clone();

        if req.fork_after_index >= source.messages.len() {
            return Err(format!(
                "Fork index {} out of range (conversation has {} messages)",
                req.fork_after_index, source.messages.len()
            ));
        }

        let now = Utc::now();
        let new_id = Uuid::new_v4().to_string();
        let title = req.new_title.unwrap_or_else(|| format!("{} (fork)", source.title));

        let forked = Conversation {
            id: new_id.clone(),
            title,
            provider_id: source.provider_id.clone(),
            model: source.model.clone(),
            system_prompt: source.system_prompt.clone(),
            messages: source.messages[..=req.fork_after_index].to_vec(),
            params: source.params.clone(),
            tools: source.tools.clone(),
            created_at: now,
            updated_at: now,
            total_tokens: 0,
            total_cost: 0.0,
            tags: source.tags.clone(),
            pinned: false,
            archived: false,
            metadata: {
                let mut m = source.metadata.clone();
                m.insert("forked_from".into(), serde_json::Value::String(source.id.clone()));
                m
            },
        };
        self.conversations.insert(new_id, forked.clone());
        Ok(forked)
    }

    // ── Search & Export ──────────────────────────────────────────────────────

    pub fn search(&self, query: &str) -> Vec<&Conversation> {
        let q = query.to_lowercase();
        self.conversations.values().filter(|c| {
            c.title.to_lowercase().contains(&q)
                || c.messages.iter().any(|m| {
                    m.content.iter().any(|b| match b {
                        ContentBlock::Text { text } => text.to_lowercase().contains(&q),
                        _ => false,
                    })
                })
                || c.tags.iter().any(|t| t.to_lowercase().contains(&q))
        }).collect()
    }

    pub fn export_conversation(&self, id: &str) -> Result<serde_json::Value, String> {
        let conv = self.conversations.get(id)
            .ok_or_else(|| format!("Conversation {} not found", id))?;
        serde_json::to_value(conv).map_err(|e| format!("Serialization error: {}", e))
    }

    pub fn import_conversation(&mut self, data: serde_json::Value) -> Result<String, String> {
        let conv: Conversation = serde_json::from_value(data)
            .map_err(|e| format!("Deserialization error: {}", e))?;
        let id = conv.id.clone();
        self.conversations.insert(id.clone(), conv);
        Ok(id)
    }
}

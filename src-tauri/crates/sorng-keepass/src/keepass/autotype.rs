// ── sorng-keepass / autotype ───────────────────────────────────────────────────
//
// Auto-type sequence parsing, token generation, window matching, and
// keystroke sequence building for KeePass auto-type functionality.

use super::types::*;
use super::service::KeePassService;

impl KeePassService {
    // ─── Auto-Type ───────────────────────────────────────────────────

    /// Parse an auto-type sequence string into tokens.
    pub fn parse_autotype_sequence(sequence: &str) -> Vec<AutoTypeToken> {
        let mut tokens = Vec::new();
        let mut chars = sequence.chars().peekable();

        while let Some(ch) = chars.next() {
            if ch == '{' {
                // Parse placeholder
                let mut placeholder = String::new();
                let mut found_close = false;

                while let Some(inner) = chars.next() {
                    if inner == '}' {
                        found_close = true;
                        break;
                    }
                    placeholder.push(inner);
                }

                if found_close {
                    let token = Self::parse_placeholder(&placeholder);
                    tokens.push(token);
                } else {
                    // Malformed — treat as literal
                    tokens.push(AutoTypeToken::Literal(format!("{{{}", placeholder)));
                }
            } else if ch == '+' {
                // Shift modifier
                tokens.push(AutoTypeToken::Modifier("SHIFT".to_string()));
            } else if ch == '^' {
                // Ctrl modifier
                tokens.push(AutoTypeToken::Modifier("CTRL".to_string()));
            } else if ch == '%' {
                // Alt modifier
                tokens.push(AutoTypeToken::Modifier("ALT".to_string()));
            } else if ch == '~' {
                // Enter shorthand
                tokens.push(AutoTypeToken::Key("ENTER".to_string()));
            } else {
                tokens.push(AutoTypeToken::Literal(ch.to_string()));
            }
        }

        tokens
    }

    /// Parse a placeholder name into a token.
    fn parse_placeholder(name: &str) -> AutoTypeToken {
        let upper = name.to_uppercase();
        let parts: Vec<&str> = upper.splitn(2, ' ').collect();
        let key = parts[0];
        let arg = parts.get(1).map(|s| s.to_string());

        match key {
            // Field references
            "USERNAME" | "USER" => AutoTypeToken::FieldRef("UserName".to_string()),
            "PASSWORD" | "PASS" => AutoTypeToken::FieldRef("Password".to_string()),
            "TITLE" => AutoTypeToken::FieldRef("Title".to_string()),
            "URL" => AutoTypeToken::FieldRef("URL".to_string()),
            "NOTES" => AutoTypeToken::FieldRef("Notes".to_string()),
            "TOTP" | "OTP" => AutoTypeToken::FieldRef("TOTP".to_string()),
            "S:" => {
                // Custom string field: {S:FieldName}
                AutoTypeToken::FieldRef(format!("S:{}", arg.unwrap_or_default()))
            }

            // Keys
            "TAB" => AutoTypeToken::Key("TAB".to_string()),
            "ENTER" | "RETURN" => AutoTypeToken::Key("ENTER".to_string()),
            "SPACE" => AutoTypeToken::Key("SPACE".to_string()),
            "BACKSPACE" | "BS" | "BKSP" => AutoTypeToken::Key("BACKSPACE".to_string()),
            "DELETE" | "DEL" => AutoTypeToken::Key("DELETE".to_string()),
            "INSERT" | "INS" => AutoTypeToken::Key("INSERT".to_string()),
            "HOME" => AutoTypeToken::Key("HOME".to_string()),
            "END" => AutoTypeToken::Key("END".to_string()),
            "PGUP" | "PAGEUP" => AutoTypeToken::Key("PAGEUP".to_string()),
            "PGDN" | "PAGEDOWN" | "PGDOWN" => AutoTypeToken::Key("PAGEDOWN".to_string()),
            "UP" => AutoTypeToken::Key("UP".to_string()),
            "DOWN" => AutoTypeToken::Key("DOWN".to_string()),
            "LEFT" => AutoTypeToken::Key("LEFT".to_string()),
            "RIGHT" => AutoTypeToken::Key("RIGHT".to_string()),
            "ESC" | "ESCAPE" => AutoTypeToken::Key("ESCAPE".to_string()),
            "CAPSLOCK" => AutoTypeToken::Key("CAPSLOCK".to_string()),
            "NUMLOCK" => AutoTypeToken::Key("NUMLOCK".to_string()),
            "SCROLLLOCK" => AutoTypeToken::Key("SCROLLLOCK".to_string()),
            "PRTSC" | "PRINTSCREEN" => AutoTypeToken::Key("PRINTSCREEN".to_string()),
            "BREAK" => AutoTypeToken::Key("BREAK".to_string()),
            "APPS" => AutoTypeToken::Key("APPS".to_string()),
            "WIN" | "LWIN" | "RWIN" => AutoTypeToken::Key("WIN".to_string()),

            // Function keys
            _ if key.starts_with('F') && key[1..].parse::<u32>().is_ok() => {
                AutoTypeToken::Key(key.to_string())
            }

            // Delay
            "DELAY" => {
                let ms = arg.and_then(|a| a.parse::<u32>().ok()).unwrap_or(100);
                AutoTypeToken::Delay(ms)
            }
            "DELAY=" => {
                let ms = arg.and_then(|a| a.parse::<u32>().ok()).unwrap_or(50);
                AutoTypeToken::Delay(ms)
            }

            // Special actions
            "CLEARFIELD" => AutoTypeToken::Command("CLEARFIELD".to_string()),
            "VKEY" => AutoTypeToken::Command(format!("VKEY {}", arg.unwrap_or_default())),

            // Repeat: {KEY N} where N is the repeat count
            _ => {
                if let Some(count_str) = arg {
                    if let Ok(count) = count_str.parse::<u32>() {
                        // Repeated key press
                        return AutoTypeToken::Repeat(Box::new(AutoTypeToken::Key(key.to_string())), count);
                    }
                }
                AutoTypeToken::Literal(format!("{{{}}}", name))
            }
        }
    }

    /// Get the default auto-type sequence.
    pub fn get_default_autotype_sequence() -> String {
        "{USERNAME}{TAB}{PASSWORD}{ENTER}".to_string()
    }

    /// Resolve an auto-type sequence to actual keystrokes for a given entry.
    pub fn resolve_autotype_sequence(
        &self,
        db_id: &str,
        entry_uuid: &str,
        sequence: Option<&str>,
    ) -> Result<Vec<AutoTypeToken>, String> {
        let db = self.get_database(db_id)?;
        let entry = db.entries.get(entry_uuid)
            .ok_or("Entry not found")?;

        let seq = sequence
            .map(|s| s.to_string())
            .or_else(|| entry.auto_type.as_ref().and_then(|at| {
                at.default_sequence.as_ref().filter(|s| !s.is_empty()).cloned()
            }))
            .unwrap_or_else(Self::get_default_autotype_sequence);

        let tokens = Self::parse_autotype_sequence(&seq);

        // Resolve field references
        let resolved: Vec<AutoTypeToken> = tokens.into_iter().map(|token| {
            match token {
                AutoTypeToken::FieldRef(ref field_name) => {
                    let value = match field_name.as_str() {
                        "UserName" => entry.username.clone(),
                        "Password" => entry.password.clone(),
                        "Title" => entry.title.clone(),
                        "URL" => entry.url.clone(),
                        "Notes" => entry.notes.clone(),
                        "TOTP" => {
                            // Generate TOTP if available
                            if let Some(ref otp) = entry.otp {
                                match otp.otp_type {
                                    OtpType::Totp | OtpType::Steam => {
                                        let period = otp.period.unwrap_or(30);
                                        let now_ts = std::time::SystemTime::now()
                                            .duration_since(std::time::UNIX_EPOCH)
                                            .unwrap_or_default();
                                        let counter = now_ts.as_secs() / period as u64;
                                        Self::generate_otp_code(&otp.secret, counter, otp.digits, &otp.algorithm)
                                            .unwrap_or_default()
                                    }
                                    _ => String::new(),
                                }
                            } else {
                                String::new()
                            }
                        }
                        _ if field_name.starts_with("S:") => {
                            let custom_key = &field_name[2..];
                            entry.custom_fields.get(custom_key)
                                .map(|cf| cf.value.clone())
                                .unwrap_or_default()
                        }
                        _ => String::new(),
                    };
                    AutoTypeToken::Literal(value)
                }
                AutoTypeToken::Repeat(inner, count) => {
                    // Expand repeats
                    AutoTypeToken::Repeat(inner, count)
                }
                other => other,
            }
        }).collect();

        Ok(resolved)
    }

    /// Find entries matching a window title for auto-type.
    pub fn find_autotype_matches(
        &self,
        db_id: &str,
        window_title: &str,
    ) -> Result<Vec<AutoTypeMatch>, String> {
        let db = self.get_database(db_id)?;
        let mut matches = Vec::new();

        for entry in db.entries.values() {
            // Check auto-type enabled
            if let Some(ref at) = entry.auto_type {
                if !at.enabled {
                    continue;
                }

                // Check associations
                for assoc in &at.associations {
                    if Self::matches_window_pattern(&assoc.window, window_title) {
                        let sequence = if assoc.sequence.as_deref().map_or(true, str::is_empty) {
                            if at.default_sequence.as_deref().map_or(true, str::is_empty) {
                                Self::get_default_autotype_sequence()
                            } else {
                                at.default_sequence.clone().unwrap_or_default()
                            }
                        } else {
                            assoc.sequence.clone().unwrap_or_default()
                        };

                        matches.push(AutoTypeMatch {
                            entry_uuid: entry.uuid.clone(),
                            entry_title: entry.title.clone(),
                            sequence,
                            window_match: assoc.window.clone(),
                        });
                        break; // Only first matching association per entry
                    }
                }
            } else {
                // No auto-type config — match by title or URL in window title
                let title_lower = window_title.to_lowercase();
                let entry_title_lower = entry.title.to_lowercase();
                let entry_domain = if !entry.url.is_empty() {
                    Self::extract_domain(&entry.url)
                } else {
                    String::new()
                };

                if (!entry_title_lower.is_empty() && title_lower.contains(&entry_title_lower))
                    || (!entry_domain.is_empty() && title_lower.contains(&entry_domain))
                {
                    matches.push(AutoTypeMatch {
                        entry_uuid: entry.uuid.clone(),
                        entry_title: entry.title.clone(),
                        sequence: Self::get_default_autotype_sequence(),
                        window_match: format!("*{}*", entry.title),
                    });
                }
            }
        }

        Ok(matches)
    }

    /// Check if a window title matches a KeePass window pattern.
    /// Supports * (any chars) and // (regex) patterns.
    fn matches_window_pattern(pattern: &str, window_title: &str) -> bool {
        if pattern.is_empty() {
            return false;
        }

        // Regex pattern: //pattern//
        if pattern.starts_with("//") && pattern.ends_with("//") && pattern.len() > 4 {
            let regex_str = &pattern[2..pattern.len() - 2];
            return Self::simple_pattern_match(window_title, regex_str, true);
        }

        // Wildcard pattern
        let pattern_lower = pattern.to_lowercase();
        let title_lower = window_title.to_lowercase();

        // Convert glob to simple matching
        let parts: Vec<&str> = pattern_lower.split('*').collect();

        if parts.len() == 1 {
            // No wildcards — exact match
            return title_lower == pattern_lower;
        }

        let mut pos = 0;
        for (i, part) in parts.iter().enumerate() {
            if part.is_empty() {
                continue;
            }
            if let Some(found_pos) = title_lower[pos..].find(part) {
                if i == 0 && found_pos != 0 {
                    return false; // Must start with first part
                }
                pos += found_pos + part.len();
            } else {
                return false;
            }
        }

        // If pattern doesn't end with *, must match to end
        if !pattern_lower.ends_with('*') && pos != title_lower.len() {
            return false;
        }

        true
    }

    /// Get all auto-type window associations from all entries.
    pub fn list_autotype_associations(
        &self,
        db_id: &str,
    ) -> Result<Vec<AutoTypeMatch>, String> {
        let db = self.get_database(db_id)?;
        let mut associations = Vec::new();

        for entry in db.entries.values() {
            if let Some(ref at) = entry.auto_type {
                if !at.enabled {
                    continue;
                }
                for assoc in &at.associations {
                    let sequence = if assoc.sequence.as_deref().map_or(true, str::is_empty) {
                        if at.default_sequence.as_deref().map_or(true, str::is_empty) {
                            Self::get_default_autotype_sequence()
                        } else {
                            at.default_sequence.clone().unwrap_or_default()
                        }
                    } else {
                        assoc.sequence.clone().unwrap_or_default()
                    };

                    associations.push(AutoTypeMatch {
                        entry_uuid: entry.uuid.clone(),
                        entry_title: entry.title.clone(),
                        sequence,
                        window_match: assoc.window.clone(),
                    });
                }
            }
        }

        Ok(associations)
    }

    /// Validate an auto-type sequence string for syntax errors.
    pub fn validate_autotype_sequence(sequence: &str) -> Result<Vec<String>, String> {
        let mut warnings = Vec::new();
        let tokens = Self::parse_autotype_sequence(sequence);

        let mut has_password = false;
        let mut has_username = false;
        let mut has_enter = false;

        for token in &tokens {
            match token {
                AutoTypeToken::FieldRef(field) => {
                    if field == "Password" {
                        has_password = true;
                    }
                    if field == "UserName" {
                        has_username = true;
                    }
                }
                AutoTypeToken::Key(key) => {
                    if key == "ENTER" {
                        has_enter = true;
                    }
                }
                AutoTypeToken::Literal(text) => {
                    if text.contains('{') && !text.contains('}') {
                        warnings.push(format!("Possible malformed placeholder: {}", text));
                    }
                }
                _ => {}
            }
        }

        if !has_password {
            warnings.push("Sequence does not include {PASSWORD}".to_string());
        }
        if !has_username {
            warnings.push("Sequence does not include {USERNAME}".to_string());
        }
        if !has_enter {
            warnings.push("Sequence does not end with {ENTER}".to_string());
        }

        Ok(warnings)
    }
}

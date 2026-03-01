// ── sorng-keepass / crypto ─────────────────────────────────────────────────────
//
// Key management, password generation, key file creation, composite key logic,
// password analysis, and encryption utilities.

use sha2::{Sha256, Digest};
use rand::Rng;
use chrono::Utc;

use super::types::*;
use super::service::KeePassService;

impl KeePassService {
    // ─── Password Generation ──────────────────────────────────────────

    /// Generate a password based on the given configuration.
    pub fn generate_password(&self, req: PasswordGeneratorRequest) -> Result<GeneratedPassword, String> {
        match req.mode {
            PasswordGenMode::CharacterSet => self.generate_charset_password(&req),
            PasswordGenMode::Pattern => self.generate_pattern_password(&req),
            PasswordGenMode::Passphrase => self.generate_passphrase(&req),
        }
    }

    /// Generate multiple passwords.
    pub fn generate_passwords(&self, req: PasswordGeneratorRequest) -> Result<Vec<GeneratedPassword>, String> {
        let count = req.count.unwrap_or(1).max(1).min(100);
        let mut results = Vec::with_capacity(count);
        for _ in 0..count {
            results.push(self.generate_password(req.clone())?);
        }
        Ok(results)
    }

    fn generate_charset_password(&self, req: &PasswordGeneratorRequest) -> Result<GeneratedPassword, String> {
        let mut charset = String::new();
        let mut rng = rand::thread_rng();

        let sets = req.character_sets.as_ref()
            .ok_or("Character sets are required for CharacterSet mode")?;

        // Build character set
        let mut required_chars: Vec<String> = Vec::new();

        for set in sets {
            let chars = Self::charset_chars(set);
            charset.push_str(&chars);
            if req.ensure_each_set {
                required_chars.push(chars);
            }
        }

        // Add custom characters
        if let Some(ref custom) = req.custom_characters {
            charset.push_str(custom);
        }

        // Remove excluded characters
        if let Some(ref exclude) = req.exclude_characters {
            charset = charset.chars().filter(|c| !exclude.contains(*c)).collect();
        }

        // Remove look-alikes
        if req.exclude_lookalikes {
            let lookalikes = "0OIl1|`";
            charset = charset.chars().filter(|c| !lookalikes.contains(*c)).collect();
        }

        if charset.is_empty() {
            return Err("Character set is empty after exclusions".to_string());
        }

        let charset_chars: Vec<char> = charset.chars().collect();
        let length = req.length.max(1);

        let mut password: Vec<char> = Vec::with_capacity(length);

        // Ensure at least one char from each required set
        if req.ensure_each_set && !required_chars.is_empty() {
            for set_chars in &required_chars {
                let filtered: Vec<char> = set_chars.chars()
                    .filter(|c| charset_chars.contains(c))
                    .collect();
                if !filtered.is_empty() {
                    let idx = rng.gen_range(0..filtered.len());
                    password.push(filtered[idx]);
                }
            }
        }

        // Fill remaining length
        while password.len() < length {
            let idx = rng.gen_range(0..charset_chars.len());
            password.push(charset_chars[idx]);
        }

        // Shuffle to randomize positions of required chars
        for i in (1..password.len()).rev() {
            let j = rng.gen_range(0..=i);
            password.swap(i, j);
        }

        // Truncate if we went over
        password.truncate(length);

        let pw_string: String = password.into_iter().collect();
        self.analyze_generated_password(&pw_string)
    }

    fn generate_pattern_password(&self, req: &PasswordGeneratorRequest) -> Result<GeneratedPassword, String> {
        let pattern = req.pattern.as_ref()
            .ok_or("Pattern is required for Pattern mode")?;

        let mut rng = rand::thread_rng();
        let mut password = String::new();

        for ch in pattern.chars() {
            let generated = match ch {
                'u' => {
                    let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    let idx = rng.gen_range(0..chars.len());
                    chars.chars().nth(idx).unwrap()
                }
                'l' => {
                    let chars = "abcdefghijklmnopqrstuvwxyz";
                    let idx = rng.gen_range(0..chars.len());
                    chars.chars().nth(idx).unwrap()
                }
                'd' => {
                    let chars = "0123456789";
                    let idx = rng.gen_range(0..chars.len());
                    chars.chars().nth(idx).unwrap()
                }
                's' => {
                    let chars = "!@#$%^&*()_+-=[]{}|;:',.<>?/~`";
                    let idx = rng.gen_range(0..chars.len());
                    chars.chars().nth(idx).unwrap()
                }
                'h' => {
                    let chars = "0123456789abcdef";
                    let idx = rng.gen_range(0..chars.len());
                    chars.chars().nth(idx).unwrap()
                }
                'H' => {
                    let chars = "0123456789ABCDEF";
                    let idx = rng.gen_range(0..chars.len());
                    chars.chars().nth(idx).unwrap()
                }
                'a' => {
                    let chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    let idx = rng.gen_range(0..chars.len());
                    chars.chars().nth(idx).unwrap()
                }
                'A' => {
                    let chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                    let idx = rng.gen_range(0..chars.len());
                    chars.chars().nth(idx).unwrap()
                }
                'x' => {
                    // Any printable ASCII
                    let code = rng.gen_range(33..127u8);
                    code as char
                }
                '\\' => {
                    // Literal escape — next char is literal (simplified: just backslash)
                    '\\'
                }
                _ => ch, // Literal character
            };
            password.push(generated);
        }

        self.analyze_generated_password(&password)
    }

    fn generate_passphrase(&self, req: &PasswordGeneratorRequest) -> Result<GeneratedPassword, String> {
        let mut rng = rand::thread_rng();
        let word_count = req.length.max(3).min(20); // Use length as word count for passphrase

        // Common English words for passphrases
        let wordlist = Self::get_passphrase_wordlist();

        let mut words: Vec<String> = Vec::new();
        for _ in 0..word_count {
            let idx = rng.gen_range(0..wordlist.len());
            let mut word = wordlist[idx].to_string();

            // Capitalize first letter
            if req.ensure_each_set {
                if let Some(first) = word.get_mut(0..1) {
                    first.make_ascii_uppercase();
                }
            }

            words.push(word);
        }

        let separator = req.custom_characters.as_deref().unwrap_or("-");
        let password = words.join(separator);

        self.analyze_generated_password(&password)
    }

    fn analyze_generated_password(&self, password: &str) -> Result<GeneratedPassword, String> {
        let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
        let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
        let has_digits = password.chars().any(|c| c.is_ascii_digit());
        let has_special = password.chars().any(|c| c.is_ascii_punctuation());

        let entropy = Self::estimate_entropy(password);
        let strength = Self::entropy_to_strength(entropy);

        Ok(GeneratedPassword {
            password: password.to_string(),
            entropy_bits: entropy,
            strength,
            character_count: password.len(),
            has_upper,
            has_lower,
            has_digits,
            has_special,
        })
    }

    /// Get character string for a character set.
    fn charset_chars(set: &CharacterSet) -> String {
        match set {
            CharacterSet::UpperCase => "ABCDEFGHIJKLMNOPQRSTUVWXYZ".to_string(),
            CharacterSet::LowerCase => "abcdefghijklmnopqrstuvwxyz".to_string(),
            CharacterSet::Digits => "0123456789".to_string(),
            CharacterSet::Special => "!@#$%^&*()_+-=[]{}|;:',.<>?/~`\"".to_string(),
            CharacterSet::Space => " ".to_string(),
            CharacterSet::Brackets => "()[]{}<>".to_string(),
            CharacterSet::HighAnsi => {
                // Characters 128-255
                (128u8..=255).map(|c| c as char).collect()
            }
            CharacterSet::Minus => "-".to_string(),
            CharacterSet::Underline => "_".to_string(),
        }
    }

    // ─── Password Analysis ────────────────────────────────────────────

    /// Analyze a password's quality and provide suggestions.
    pub fn analyze_password(password: &str) -> PasswordAnalysis {
        let length = password.len();
        let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
        let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
        let has_digits = password.chars().any(|c| c.is_ascii_digit());
        let has_special = password.chars().any(|c| c.is_ascii_punctuation());
        let has_unicode = password.chars().any(|c| !c.is_ascii());

        let entropy = Self::estimate_entropy(password);
        let strength = Self::entropy_to_strength(entropy);

        // Check for repeated characters
        let repeated_chars = {
            let chars: Vec<char> = password.chars().collect();
            let mut count = 0;
            for i in 1..chars.len() {
                if chars[i] == chars[i - 1] {
                    count += 1;
                }
            }
            count
        };

        // Check for sequential characters
        let sequential_chars = {
            let chars: Vec<char> = password.chars().collect();
            let mut count = 0;
            for i in 1..chars.len() {
                let diff = (chars[i] as i32) - (chars[i - 1] as i32);
                if diff == 1 || diff == -1 {
                    count += 1;
                }
            }
            count
        };

        // Check for common patterns
        let mut common_patterns = Vec::new();
        let lower = password.to_lowercase();
        let weak_patterns = [
            "password", "123456", "qwerty", "abc123", "letmein",
            "admin", "welcome", "monkey", "master", "dragon",
        ];
        for pattern in &weak_patterns {
            if lower.contains(pattern) {
                common_patterns.push(format!("Contains common pattern: '{}'", pattern));
            }
        }

        // Generate suggestions
        let mut suggestions = Vec::new();
        if length < 12 {
            suggestions.push("Increase password length to at least 12 characters".to_string());
        }
        if !has_upper {
            suggestions.push("Add uppercase letters".to_string());
        }
        if !has_lower {
            suggestions.push("Add lowercase letters".to_string());
        }
        if !has_digits {
            suggestions.push("Add digits".to_string());
        }
        if !has_special {
            suggestions.push("Add special characters".to_string());
        }
        if repeated_chars > 2 {
            suggestions.push("Reduce repeated characters".to_string());
        }
        if sequential_chars > 2 {
            suggestions.push("Reduce sequential characters".to_string());
        }

        let estimated_crack_time = Self::estimate_crack_time(entropy);

        PasswordAnalysis {
            entropy_bits: entropy,
            strength,
            length,
            has_upper,
            has_lower,
            has_digits,
            has_special,
            has_unicode,
            repeated_chars,
            sequential_chars,
            common_patterns,
            suggestions,
            estimated_crack_time,
        }
    }

    /// Estimate the time to crack a password given its entropy.
    fn estimate_crack_time(entropy_bits: f64) -> String {
        // Assume 10 billion guesses per second (modern GPU cluster)
        let guesses_per_second: f64 = 1e10;
        let total_guesses = 2f64.powf(entropy_bits);
        let seconds = total_guesses / guesses_per_second / 2.0; // Average case

        if seconds < 1.0 {
            "Instantly".to_string()
        } else if seconds < 60.0 {
            format!("{:.0} seconds", seconds)
        } else if seconds < 3600.0 {
            format!("{:.0} minutes", seconds / 60.0)
        } else if seconds < 86400.0 {
            format!("{:.1} hours", seconds / 3600.0)
        } else if seconds < 31536000.0 {
            format!("{:.1} days", seconds / 86400.0)
        } else if seconds < 31536000.0 * 1000.0 {
            format!("{:.1} years", seconds / 31536000.0)
        } else if seconds < 31536000.0 * 1e6 {
            format!("{:.0} thousand years", seconds / 31536000.0 / 1000.0)
        } else if seconds < 31536000.0 * 1e9 {
            format!("{:.0} million years", seconds / 31536000.0 / 1e6)
        } else {
            format!("{:.0} billion years", seconds / 31536000.0 / 1e9)
        }
    }

    // ─── Key File Operations ──────────────────────────────────────────

    /// Create a new key file.
    pub fn create_key_file(req: CreateKeyFileRequest) -> Result<KeyFileInfo, String> {
        let mut rng = rand::thread_rng();

        let data = match req.format {
            KeyFileFormat::Xml => {
                // Generate XML key file (KeePass 2.x format)
                let key_data: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
                let key_base64 = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    &key_data,
                );
                let mut hasher = Sha256::new();
                hasher.update(&key_data);
                let hash_hex = hex::encode(&hasher.finalize()[..4]);

                format!(
                    r#"<?xml version="1.0" encoding="utf-8"?>
<KeyFile>
    <Meta>
        <Version>2.0</Version>
    </Meta>
    <Key>
        <Data Hash="{}">{}</Data>
    </Key>
</KeyFile>"#,
                    hash_hex, key_base64
                ).into_bytes()
            }
            KeyFileFormat::Binary32 => {
                // 32 random bytes
                (0..32).map(|_| rng.gen()).collect()
            }
            KeyFileFormat::Hex64 => {
                // 64-character hex string (32 bytes of entropy)
                let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
                hex::encode(&bytes).into_bytes()
            }
            KeyFileFormat::Random => {
                // Custom data or random 256 bytes
                if let Some(ref custom) = req.custom_data {
                    base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        custom,
                    ).map_err(|e| format!("Invalid base64 custom data: {}", e))?
                } else {
                    (0..256).map(|_| rng.gen()).collect()
                }
            }
        };

        // Write key file
        std::fs::write(&req.file_path, &data)
            .map_err(|e| format!("Failed to write key file: {}", e))?;

        let mut hasher = Sha256::new();
        hasher.update(&data);
        let hash = hex::encode(hasher.finalize());

        Ok(KeyFileInfo {
            file_path: req.file_path,
            format: req.format,
            hash,
            file_size: data.len() as u64,
            created_at: Some(Utc::now().to_rfc3339()),
        })
    }

    /// Verify a key file and return its info.
    pub fn verify_key_file(file_path: &str) -> Result<KeyFileInfo, String> {
        let data = std::fs::read(file_path)
            .map_err(|e| format!("Cannot read key file: {}", e))?;

        let mut hasher = Sha256::new();
        hasher.update(&data);
        let hash = hex::encode(hasher.finalize());

        // Detect format
        let format = if data.len() >= 5 && &data[..5] == b"<?xml" {
            KeyFileFormat::Xml
        } else if data.len() == 32 {
            KeyFileFormat::Binary32
        } else if data.len() == 64 && data.iter().all(|b| b.is_ascii_hexdigit()) {
            KeyFileFormat::Hex64
        } else {
            KeyFileFormat::Random
        };

        let metadata = std::fs::metadata(file_path).ok();

        Ok(KeyFileInfo {
            file_path: file_path.to_string(),
            format,
            hash,
            file_size: data.len() as u64,
            created_at: metadata.and_then(|m| m.created().ok()).map(|t| {
                let dt: chrono::DateTime<Utc> = t.into();
                dt.to_rfc3339()
            }),
        })
    }

    // ─── Passphrase Word List ─────────────────────────────────────────

    fn get_passphrase_wordlist() -> Vec<&'static str> {
        vec![
            "abandon", "ability", "able", "about", "above", "absent", "absorb",
            "abstract", "absurd", "abuse", "access", "accident", "account",
            "accuse", "achieve", "acid", "acoustic", "acquire", "across", "act",
            "action", "actor", "actress", "actual", "adapt", "add", "addict",
            "address", "adjust", "admit", "adult", "advance", "advice", "aerobic",
            "affair", "afford", "afraid", "again", "age", "agent", "agree",
            "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
            "alcohol", "alert", "alien", "all", "alley", "allow", "almost",
            "alone", "alpha", "already", "also", "alter", "always", "amateur",
            "amazing", "among", "amount", "amused", "analyst", "anchor",
            "ancient", "anger", "angle", "angry", "animal", "ankle", "announce",
            "annual", "another", "answer", "antenna", "antique", "anxiety",
            "apart", "apology", "appear", "apple", "approve", "april",
            "arch", "arctic", "area", "arena", "argue", "arm", "armed",
            "armor", "army", "around", "arrange", "arrest", "arrive", "arrow",
            "art", "artifact", "artist", "artwork", "ask", "aspect", "assault",
            "asset", "assist", "assume", "asthma", "athlete", "atom", "attack",
            "attend", "attitude", "attract", "auction", "audit", "august",
            "aunt", "author", "auto", "autumn", "average", "avocado", "avoid",
            "awake", "aware", "awesome", "awful", "awkward", "axis",
            "baby", "bachelor", "bacon", "badge", "bag", "balance", "balcony",
            "ball", "bamboo", "banana", "banner", "bar", "barely", "bargain",
            "barrel", "base", "basic", "basket", "battle", "beach", "bean",
            "beauty", "because", "become", "beef", "before", "begin", "behave",
            "behind", "believe", "below", "belt", "bench", "benefit", "best",
            "betray", "better", "between", "beyond", "bicycle", "bid", "bike",
            "bind", "biology", "bird", "birth", "bitter", "black", "blade",
            "blame", "blanket", "blast", "bleak", "bless", "blind", "blood",
            "blossom", "blow", "blue", "blur", "blush", "board", "boat",
            "body", "boil", "bomb", "bone", "bonus", "book", "boost", "border",
            "boring", "borrow", "boss", "bottom", "bounce", "box", "boy",
            "bracket", "brain", "brand", "brass", "brave", "bread", "breeze",
            "brick", "bridge", "brief", "bright", "bring", "brisk", "broccoli",
            "broken", "bronze", "broom", "brother", "brown", "brush", "bubble",
            "buddy", "budget", "buffalo", "build", "bulb", "bulk", "bullet",
            "bundle", "bunny", "burden", "burger", "burst", "bus", "business",
            "busy", "butter", "buyer", "buzz", "cabbage", "cabin", "cable",
            "cactus", "cage", "cake", "call", "calm", "camera", "camp",
            "canal", "cancel", "candy", "cannon", "canoe", "canvas", "canyon",
            "capable", "capital", "captain", "carbon", "card", "cargo",
            "carpet", "carry", "cart", "case", "castle", "casual", "catalog",
            "catch", "category", "cattle", "caught", "cause", "caution",
            "cave", "ceiling", "celery", "cement", "census", "century",
            "cereal", "certain", "chair", "chalk", "champion", "change",
            "chaos", "chapter", "charge", "chase", "cheap", "check", "cheese",
            "cherry", "chest", "chicken", "chief", "child", "chimney",
            "choice", "choose", "chronic", "chunk", "cinema", "circle",
            "citizen", "city", "civil", "claim", "clap", "clarify", "claw",
            "clay", "clean", "clerk", "clever", "click", "client", "cliff",
            "climb", "clinic", "clip", "clock", "close", "cloth", "cloud",
            "clown", "club", "clump", "cluster", "clutch", "coach", "coast",
            "coconut", "code", "coffee", "coil", "coin", "collect", "color",
            "column", "combine", "come", "comfort", "comic", "common",
            "company", "concert", "conduct", "confirm", "congress",
        ]
    }
}

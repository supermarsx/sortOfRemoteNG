//! Local password & passphrase generation utilities.
//!
//! Provides a fallback generator that doesn't require the `bw` CLI.
//! The CLI `bw generate` command is preferred for production use,
//! but this module provides offline generation capability.

use crate::bitwarden::types::{BitwardenError, PasswordGenerateOptions};

/// Character sets for password generation.
const LOWERCASE: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
const UPPERCASE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &[u8] = b"0123456789";
const SPECIAL: &[u8] = b"!@#$%^&*()-_=+[]{}|;:',.<>?/`~";

/// Default passphrase word list (EFF short word list subset).
const WORD_LIST: &[&str] = &[
    "acid", "acme", "aged", "also", "area", "army", "away", "baby",
    "back", "bail", "bait", "bake", "bald", "ball", "band", "bank",
    "barn", "base", "bath", "bead", "beam", "bear", "beat", "been",
    "bell", "belt", "best", "bike", "bird", "bite", "blow", "blue",
    "blur", "boat", "body", "bold", "bolt", "bomb", "bond", "bone",
    "book", "bore", "born", "boss", "both", "bowl", "bulk", "bump",
    "burn", "bush", "busy", "buzz", "cafe", "cage", "cake", "calm",
    "came", "camp", "cape", "card", "care", "cart", "case", "cash",
    "cast", "cave", "cell", "chat", "chip", "chop", "cite", "city",
    "clam", "clan", "clap", "claw", "clay", "clip", "clock", "club",
    "clue", "coal", "coat", "code", "coil", "coin", "cola", "cold",
    "colt", "comb", "come", "cone", "cook", "cool", "cope", "copy",
    "cord", "core", "cork", "corn", "cost", "cozy", "crab", "crew",
    "crop", "crow", "cube", "cult", "curb", "cure", "curl", "cute",
    "dare", "dark", "dart", "dash", "data", "date", "dawn", "deal",
    "dear", "debt", "deck", "deed", "deem", "deep", "deer", "demo",
    "dent", "deny", "desk", "dial", "dice", "diet", "dine", "disc",
    "dish", "dock", "does", "dome", "done", "doom", "door", "dose",
    "dove", "down", "drag", "draw", "drip", "drop", "drum", "dual",
    "duck", "duel", "duke", "dull", "dumb", "dump", "dune", "dusk",
    "dust", "duty", "each", "earl", "earn", "ease", "east", "easy",
    "echo", "edge", "edit", "else", "emit", "epic", "even", "ever",
    "exam", "exit", "face", "fact", "fade", "fail", "fair", "fake",
    "fall", "fame", "fang", "farm", "fast", "fate", "fear", "feat",
    "feed", "feel", "file", "fill", "film", "find", "fine", "fire",
    "firm", "fish", "fist", "five", "flag", "flame", "flat", "flaw",
    "fled", "flew", "flip", "float", "flow", "foam", "fold", "folk",
    "fond", "font", "food", "fool", "foot", "ford", "fore", "fork",
    "form", "fort", "foul", "four", "free", "frog", "from", "fuel",
    "full", "fund", "fury", "fuse", "fuss", "gain", "gait", "gale",
    "game", "gang", "gape", "gate", "gave", "gaze", "gear", "gene",
    "gift", "girl", "glad", "glee", "glen", "glow", "glue", "goat",
    "goes", "gold", "golf", "gone", "good", "grab", "gram", "gray",
    "grew", "grid", "grim", "grin", "grip", "grit", "grow", "gulf",
    "guru", "gust", "guts", "hack", "hail", "hair", "half", "hall",
    "halt", "hand", "hang", "hare", "harm", "harp", "hash", "haste",
    "hate", "haul", "have", "hawk", "haze", "head", "heal", "heap",
    "heat", "heel", "held", "helm", "help", "herb", "herd", "here",
    "hero", "hide", "high", "hike", "hill", "hint", "hire", "hold",
    "hole", "holy", "home", "hook", "hope", "horn", "host", "hour",
    "huge", "hull", "hung", "hunt", "hurt", "hush", "hymn", "icon",
    "idea", "idle", "inch", "info", "iron", "item", "jack", "jade",
    "jail", "jazz", "jean", "jest", "jobs", "join", "joke", "joy",
    "jump", "june", "jury", "just", "keen", "keep", "kelp", "kept",
    "kick", "kill", "kind", "king", "kiss", "kite", "knee", "knelt",
    "knew", "knit", "knob", "knot", "know", "lace", "lack", "laid",
    "lake", "lamp", "land", "lane", "lark", "last", "late", "lawn",
    "lead", "leaf", "leak", "lean", "leap", "left", "lend", "lens",
    "less", "liar", "lick", "life", "lift", "like", "lily", "limb",
    "lime", "limp", "line", "link", "lion", "list", "live", "load",
    "loaf", "loan", "lock", "loft", "logo", "long", "look", "loop",
    "lord", "lore", "lose", "loss", "lost", "loud", "love", "luck",
    "lump", "lung", "lure", "lurk", "lush", "made", "mail", "main",
    "make", "male", "mall", "malt", "mane", "many", "mare", "mark",
    "mars", "mask", "mass", "mast", "mate", "maze", "meal", "mean",
    "meat", "meet", "meld", "melt", "memo", "mend", "menu", "mere",
    "mesh", "mild", "milk", "mill", "mime", "mind", "mine", "mint",
    "miss", "mist", "moan", "moat", "mock", "mode", "mold", "mole",
];

/// Simple entropy source for password generation.
/// In production, integrate with `getrandom` or `rand` crate.
struct SimpleRng {
    state: u64,
}

impl SimpleRng {
    fn new() -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        // Mix with thread ID for uniqueness across threads
        let thread_id: u64 = format!("{:?}", std::thread::current().id()).len() as u64;
        Self { state: seed ^ (thread_id.wrapping_mul(0x9E3779B97F4A7C15)) }
    }

    #[cfg(test)]
    fn with_seed(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        // xorshift64
        self.state ^= self.state << 13;
        self.state ^= self.state >> 7;
        self.state ^= self.state << 17;
        self.state
    }

    fn next_range(&mut self, max: usize) -> usize {
        if max == 0 { return 0; }
        (self.next_u64() as usize) % max
    }

    fn shuffle<T>(&mut self, slice: &mut [T]) {
        for i in (1..slice.len()).rev() {
            let j = self.next_range(i + 1);
            slice.swap(i, j);
        }
    }
}

/// Generate a password locally (without the `bw` CLI).
pub fn generate_password(opts: &PasswordGenerateOptions) -> Result<String, BitwardenError> {
    if opts.passphrase {
        return generate_passphrase(opts);
    }

    let mut charset: Vec<u8> = Vec::new();
    let mut required: Vec<u8> = Vec::new();
    let mut rng = SimpleRng::new();

    if opts.lowercase {
        charset.extend_from_slice(LOWERCASE);
        required.push(LOWERCASE[rng.next_range(LOWERCASE.len())]);
    }
    if opts.uppercase {
        charset.extend_from_slice(UPPERCASE);
        required.push(UPPERCASE[rng.next_range(UPPERCASE.len())]);
    }
    if opts.numbers {
        charset.extend_from_slice(DIGITS);
        required.push(DIGITS[rng.next_range(DIGITS.len())]);
    }
    if opts.special {
        charset.extend_from_slice(SPECIAL);
        required.push(SPECIAL[rng.next_range(SPECIAL.len())]);
    }

    if charset.is_empty() {
        return Err(BitwardenError::invalid_config(
            "At least one character class must be enabled",
        ));
    }

    let length = opts.length.max(1) as usize;
    if length < required.len() {
        return Err(BitwardenError::invalid_config(
            "Password length too short for required character classes",
        ));
    }

    let mut password: Vec<u8> = Vec::with_capacity(length);

    // Add required characters first
    password.extend_from_slice(&required);

    // Fill remaining with random chars
    while password.len() < length {
        let idx = rng.next_range(charset.len());
        password.push(charset[idx]);
    }

    // Shuffle to randomize positions
    rng.shuffle(&mut password);

    Ok(String::from_utf8_lossy(&password).to_string())
}

/// Generate a passphrase.
fn generate_passphrase(opts: &PasswordGenerateOptions) -> Result<String, BitwardenError> {
    let word_count = opts.words.unwrap_or(4) as usize;
    if word_count == 0 {
        return Err(BitwardenError::invalid_config("Word count must be at least 1"));
    }

    let separator = opts.separator.as_deref().unwrap_or("-");
    let mut rng = SimpleRng::new();
    let mut words: Vec<String> = Vec::with_capacity(word_count);

    for _ in 0..word_count {
        let idx = rng.next_range(WORD_LIST.len());
        let mut word = WORD_LIST[idx].to_string();
        if opts.capitalize {
            // Capitalize first letter
            if let Some(first) = word.get_mut(0..1) {
                first.make_ascii_uppercase();
            }
        }
        words.push(word);
    }

    if opts.include_number {
        // Insert a random number in a random position's word
        let word_idx = rng.next_range(words.len());
        let num = rng.next_range(100);
        words[word_idx].push_str(&num.to_string());
    }

    Ok(words.join(separator))
}

/// Calculate the entropy of a password in bits.
pub fn calculate_entropy(password: &str) -> f64 {
    if password.is_empty() { return 0.0; }

    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password.chars().any(|c| !c.is_alphanumeric() && c.is_ascii());

    let mut pool_size: f64 = 0.0;
    if has_lower { pool_size += 26.0; }
    if has_upper { pool_size += 26.0; }
    if has_digit { pool_size += 10.0; }
    if has_special { pool_size += 32.0; }

    if pool_size == 0.0 { pool_size = 1.0; }

    (password.len() as f64) * pool_size.log2()
}

/// Estimate the entropy of a passphrase.
pub fn passphrase_entropy(word_count: u32, word_list_size: u32) -> f64 {
    if word_count == 0 || word_list_size == 0 { return 0.0; }
    (word_count as f64) * (word_list_size as f64).log2()
}

/// Get the word list size used for local generation.
pub fn word_list_size() -> usize {
    WORD_LIST.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Password generation ─────────────────────────────────────────

    #[test]
    fn generate_default_password() {
        let opts = PasswordGenerateOptions::default();
        let password = generate_password(&opts).unwrap();
        assert_eq!(password.len(), opts.length as usize);
    }

    #[test]
    fn generate_password_length() {
        let opts = PasswordGenerateOptions { length: 32, ..Default::default() };
        let password = generate_password(&opts).unwrap();
        assert_eq!(password.len(), 32);
    }

    #[test]
    fn generate_password_lowercase_only() {
        let opts = PasswordGenerateOptions {
            length: 20,
            uppercase: false,
            lowercase: true,
            numbers: false,
            special: false,
            ..Default::default()
        };
        let password = generate_password(&opts).unwrap();
        assert!(password.chars().all(|c| c.is_ascii_lowercase()));
    }

    #[test]
    fn generate_password_uppercase_only() {
        let opts = PasswordGenerateOptions {
            length: 20,
            uppercase: true,
            lowercase: false,
            numbers: false,
            special: false,
            ..Default::default()
        };
        let password = generate_password(&opts).unwrap();
        assert!(password.chars().all(|c| c.is_ascii_uppercase()));
    }

    #[test]
    fn generate_password_numbers_only() {
        let opts = PasswordGenerateOptions {
            length: 20,
            uppercase: false,
            lowercase: false,
            numbers: true,
            special: false,
            ..Default::default()
        };
        let password = generate_password(&opts).unwrap();
        assert!(password.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn generate_password_includes_required_classes() {
        // With all classes enabled, the password should contain at least one of each
        let opts = PasswordGenerateOptions {
            length: 20,
            uppercase: true,
            lowercase: true,
            numbers: true,
            special: true,
            ..Default::default()
        };
        let password = generate_password(&opts).unwrap();
        assert!(password.chars().any(|c| c.is_ascii_lowercase()));
        assert!(password.chars().any(|c| c.is_ascii_uppercase()));
        assert!(password.chars().any(|c| c.is_ascii_digit()));
        assert!(password.chars().any(|c| !c.is_alphanumeric()));
    }

    #[test]
    fn generate_password_no_classes_error() {
        let opts = PasswordGenerateOptions {
            length: 20,
            uppercase: false,
            lowercase: false,
            numbers: false,
            special: false,
            ..Default::default()
        };
        let result = generate_password(&opts);
        assert!(result.is_err());
    }

    #[test]
    fn generate_password_length_too_short() {
        let opts = PasswordGenerateOptions {
            length: 2,
            uppercase: true,
            lowercase: true,
            numbers: true,
            special: true,
            ..Default::default()
        };
        // 4 required chars but only length 2
        let result = generate_password(&opts);
        assert!(result.is_err());
    }

    // ── Passphrase generation ───────────────────────────────────────

    #[test]
    fn generate_passphrase_default() {
        let opts = PasswordGenerateOptions {
            passphrase: true,
            words: Some(4),
            separator: Some("-".into()),
            ..Default::default()
        };
        let phrase = generate_password(&opts).unwrap();
        let parts: Vec<&str> = phrase.split('-').collect();
        assert_eq!(parts.len(), 4);
    }

    #[test]
    fn generate_passphrase_custom_separator() {
        let opts = PasswordGenerateOptions {
            passphrase: true,
            words: Some(3),
            separator: Some(".".into()),
            ..Default::default()
        };
        let phrase = generate_password(&opts).unwrap();
        let parts: Vec<&str> = phrase.split('.').collect();
        assert_eq!(parts.len(), 3);
    }

    #[test]
    fn generate_passphrase_capitalized() {
        let opts = PasswordGenerateOptions {
            passphrase: true,
            words: Some(3),
            separator: Some("-".into()),
            capitalize: true,
            ..Default::default()
        };
        let phrase = generate_password(&opts).unwrap();
        for word in phrase.split('-') {
            // Each word-part (before any appended numbers) should start uppercase
            assert!(word.chars().next().unwrap().is_ascii_uppercase()
                || word.chars().next().unwrap().is_ascii_digit());
        }
    }

    #[test]
    fn generate_passphrase_with_number() {
        let opts = PasswordGenerateOptions {
            passphrase: true,
            words: Some(3),
            separator: Some("-".into()),
            include_number: true,
            ..Default::default()
        };
        let phrase = generate_password(&opts).unwrap();
        // Should contain at least one digit
        assert!(phrase.chars().any(|c| c.is_ascii_digit()));
    }

    #[test]
    fn generate_passphrase_zero_words_error() {
        let opts = PasswordGenerateOptions {
            passphrase: true,
            words: Some(0),
            ..Default::default()
        };
        let result = generate_password(&opts);
        assert!(result.is_err());
    }

    // ── SimpleRng ───────────────────────────────────────────────────

    #[test]
    fn rng_with_seed_deterministic() {
        let mut rng1 = SimpleRng::with_seed(42);
        let mut rng2 = SimpleRng::with_seed(42);
        for _ in 0..10 {
            assert_eq!(rng1.next_u64(), rng2.next_u64());
        }
    }

    #[test]
    fn rng_next_range_bounded() {
        let mut rng = SimpleRng::with_seed(42);
        for _ in 0..100 {
            let v = rng.next_range(10);
            assert!(v < 10);
        }
    }

    #[test]
    fn rng_shuffle() {
        let mut rng = SimpleRng::with_seed(42);
        let original = vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        let mut shuffled = original.clone();
        rng.shuffle(&mut shuffled);
        // Very unlikely to be in the same order after shuffle
        // (but possible; we test probabilistically)
        assert_eq!(shuffled.len(), original.len());
        // All elements still present
        for v in &original {
            assert!(shuffled.contains(v));
        }
    }

    // ── Entropy calculation ─────────────────────────────────────────

    #[test]
    fn entropy_empty() {
        assert_eq!(calculate_entropy(""), 0.0);
    }

    #[test]
    fn entropy_lowercase() {
        let entropy = calculate_entropy("abcdefgh");
        assert!(entropy > 30.0); // 8 chars * log2(26) ≈ 37.6
    }

    #[test]
    fn entropy_mixed() {
        let entropy = calculate_entropy("Abc123!@");
        // Pool: 26+26+10+32 = 94, 8 * log2(94) ≈ 52.4
        assert!(entropy > 50.0);
    }

    #[test]
    fn entropy_increases_with_length() {
        let e1 = calculate_entropy("abcdefgh");
        let e2 = calculate_entropy("abcdefghijklmnop");
        assert!(e2 > e1);
    }

    #[test]
    fn passphrase_entropy_calculation() {
        let entropy = passphrase_entropy(4, WORD_LIST.len() as u32);
        // For ~500 words: 4 * log2(500) ≈ 35.9
        assert!(entropy > 30.0);
    }

    #[test]
    fn passphrase_entropy_zero() {
        assert_eq!(passphrase_entropy(0, 100), 0.0);
        assert_eq!(passphrase_entropy(4, 0), 0.0);
    }

    // ── Word list ───────────────────────────────────────────────────

    #[test]
    fn word_list_not_empty() {
        assert!(word_list_size() > 100);
    }

    #[test]
    fn word_list_all_lowercase() {
        for word in WORD_LIST {
            assert!(word.chars().all(|c| c.is_ascii_lowercase()),
                "Word '{}' is not all lowercase", word);
        }
    }
}

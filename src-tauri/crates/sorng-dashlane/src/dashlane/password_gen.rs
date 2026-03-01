use crate::dashlane::types::{DashlaneError, PasswordGenConfig};

/// Generate a random password based on configuration.
pub fn generate_password(config: &PasswordGenConfig) -> Result<String, DashlaneError> {
    use rand::Rng;

    let length = config.length.unwrap_or(16).max(4).min(128) as usize;
    let use_lowercase = config.lowercase.unwrap_or(true);
    let use_uppercase = config.uppercase.unwrap_or(true);
    let use_digits = config.digits.unwrap_or(true);
    let use_symbols = config.symbols.unwrap_or(true);
    let avoid_ambiguous = config.avoid_ambiguous.unwrap_or(false);

    let mut charset = String::new();

    let lowercase = if avoid_ambiguous {
        "abcdefghjkmnpqrstuvwxyz"
    } else {
        "abcdefghijklmnopqrstuvwxyz"
    };
    let uppercase = if avoid_ambiguous {
        "ABCDEFGHJKMNPQRSTUVWXYZ"
    } else {
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    };
    let digits_chars = if avoid_ambiguous {
        "23456789"
    } else {
        "0123456789"
    };
    let symbols_chars = "!@#$%^&*()-_=+[]{}|;:,.<>?";

    if use_lowercase {
        charset.push_str(lowercase);
    }
    if use_uppercase {
        charset.push_str(uppercase);
    }
    if use_digits {
        charset.push_str(digits_chars);
    }
    if use_symbols {
        charset.push_str(symbols_chars);
    }

    if charset.is_empty() {
        return Err(DashlaneError::InvalidConfig(
            "At least one character set must be enabled".into(),
        ));
    }

    let charset: Vec<char> = charset.chars().collect();
    let mut rng = rand::thread_rng();
    let mut password = String::with_capacity(length);

    // Guarantee at least one character from each enabled set
    let mut required = Vec::new();
    if use_lowercase {
        let chars: Vec<char> = lowercase.chars().collect();
        required.push(chars[rng.gen_range(0..chars.len())]);
    }
    if use_uppercase {
        let chars: Vec<char> = uppercase.chars().collect();
        required.push(chars[rng.gen_range(0..chars.len())]);
    }
    if use_digits {
        let chars: Vec<char> = digits_chars.chars().collect();
        required.push(chars[rng.gen_range(0..chars.len())]);
    }
    if use_symbols {
        let chars: Vec<char> = symbols_chars.chars().collect();
        required.push(chars[rng.gen_range(0..chars.len())]);
    }

    // Fill the rest randomly
    for _ in required.len()..length {
        password.push(charset[rng.gen_range(0..charset.len())]);
    }

    // Insert required characters at random positions
    for ch in required {
        let pos = rng.gen_range(0..=password.len());
        password.insert(pos, ch);
    }

    // Truncate if somehow longer
    password.truncate(length);

    Ok(password)
}

/// Generate a pronounceable password using alternating consonant-vowel patterns.
pub fn generate_pronounceable(length: usize) -> Result<String, DashlaneError> {
    use rand::Rng;

    let consonants: Vec<char> = "bcdfghjklmnpqrstvwxyz".chars().collect();
    let vowels: Vec<char> = "aeiou".chars().collect();
    let mut rng = rand::thread_rng();
    let mut password = String::with_capacity(length);

    for i in 0..length {
        if i % 2 == 0 {
            password.push(consonants[rng.gen_range(0..consonants.len())]);
        } else {
            password.push(vowels[rng.gen_range(0..vowels.len())]);
        }
    }

    // Capitalize a couple random letters
    let mut chars: Vec<char> = password.chars().collect();
    for _ in 0..2 {
        let idx = rng.gen_range(0..chars.len());
        chars[idx] = chars[idx].to_uppercase().next().unwrap_or(chars[idx]);
    }

    // Add a digit and symbol
    if length >= 4 {
        let digit = (rng.gen_range(0..10u8) + b'0') as char;
        let symbols: Vec<char> = "!@#$%&*".chars().collect();
        let symbol = symbols[rng.gen_range(0..symbols.len())];
        chars.push(digit);
        chars.push(symbol);
    }

    Ok(chars.into_iter().collect())
}

/// Generate a passphrase from a word list.
pub fn generate_passphrase(
    word_count: usize,
    separator: &str,
    capitalize: bool,
) -> Result<String, DashlaneError> {
    use rand::Rng;

    let words = vec![
        "apple", "brave", "coral", "delta", "eagle", "flame", "grape", "honey",
        "ivory", "joker", "karma", "lemon", "maple", "noble", "ocean", "pearl",
        "quest", "river", "stone", "tiger", "unity", "vivid", "whale", "xenon",
        "yacht", "zebra", "amber", "blaze", "cloud", "dream", "ember", "frost",
        "globe", "haste", "index", "jewel", "knack", "lodge", "myth", "nexus",
        "orbit", "prism", "quilt", "ridge", "solar", "trust", "ultra", "valor",
        "width", "youth", "arena", "bench", "crane", "diver", "epoch", "forge",
        "glyph", "haven", "icicle", "jumbo", "kiosk", "lyric", "moose", "ninja",
    ];

    let mut rng = rand::thread_rng();
    let count = word_count.max(3).min(12);

    let selected: Vec<String> = (0..count)
        .map(|_| {
            let word = words[rng.gen_range(0..words.len())].to_string();
            if capitalize {
                let mut chars = word.chars();
                match chars.next() {
                    None => String::new(),
                    Some(c) => c.to_uppercase().to_string() + chars.as_str(),
                }
            } else {
                word
            }
        })
        .collect();

    Ok(selected.join(separator))
}

/// Calculate password entropy in bits.
pub fn calculate_entropy(password: &str) -> f64 {
    if password.is_empty() {
        return 0.0;
    }

    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password.chars().any(|c| !c.is_alphanumeric());

    let mut pool_size: f64 = 0.0;
    if has_lower {
        pool_size += 26.0;
    }
    if has_upper {
        pool_size += 26.0;
    }
    if has_digit {
        pool_size += 10.0;
    }
    if has_special {
        pool_size += 32.0;
    }

    if pool_size == 0.0 {
        return 0.0;
    }

    password.len() as f64 * pool_size.log2()
}

/// Rate password strength as a human-readable string.
pub fn rate_strength(password: &str) -> String {
    let entropy = calculate_entropy(password);
    match entropy as u32 {
        0..=27 => "Very Weak".to_string(),
        28..=35 => "Weak".to_string(),
        36..=59 => "Fair".to_string(),
        60..=79 => "Strong".to_string(),
        _ => "Very Strong".to_string(),
    }
}

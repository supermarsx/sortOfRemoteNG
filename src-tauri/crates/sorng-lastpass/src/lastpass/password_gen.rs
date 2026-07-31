use crate::lastpass::types::{LastPassError, PasswordGenConfig};
use rand::seq::SliceRandom;
use rand::{rngs::OsRng, Rng};

/// Generate a password based on the given configuration.
pub fn generate_password(config: &PasswordGenConfig) -> Result<String, LastPassError> {
    if !(4..=256).contains(&config.length) {
        return Err(LastPassError::new(
            crate::lastpass::types::LastPassErrorKind::BadRequest,
            "Password length must be between 4 and 256",
        ));
    }
    if config
        .exclude_chars
        .as_ref()
        .is_some_and(|value| value.len() > 256)
    {
        return Err(LastPassError::new(
            crate::lastpass::types::LastPassErrorKind::BadRequest,
            "Excluded character list is too large",
        ));
    }
    if !config.digits && config.min_digits.unwrap_or(0) > 0 {
        return Err(LastPassError::new(
            crate::lastpass::types::LastPassErrorKind::BadRequest,
            "Minimum digits requires the digit character set",
        ));
    }
    if !config.symbols && config.min_symbols.unwrap_or(0) > 0 {
        return Err(LastPassError::new(
            crate::lastpass::types::LastPassErrorKind::BadRequest,
            "Minimum symbols requires the symbol character set",
        ));
    }
    let required_digits = if config.digits {
        config.min_digits.unwrap_or(1).max(1)
    } else {
        0
    };
    let required_symbols = if config.symbols {
        config.min_symbols.unwrap_or(1).max(1)
    } else {
        0
    };
    let required_total = (if config.uppercase { 1u32 } else { 0 })
        .saturating_add(if config.lowercase { 1u32 } else { 0 })
        .saturating_add(required_digits)
        .saturating_add(required_symbols);
    if required_total > config.length {
        return Err(LastPassError::new(
            crate::lastpass::types::LastPassErrorKind::BadRequest,
            "Minimum character requirements exceed password length",
        ));
    }

    let mut charset = String::new();
    let mut required_chars: Vec<char> = Vec::new();
    let mut rng = OsRng;

    let uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let lowercase = "abcdefghijklmnopqrstuvwxyz";
    let digits = "0123456789";
    let symbols = "!@#$%^&*()_+-=[]{}|;:',.<>?/`~";
    let ambiguous = "0O1lI";

    if config.uppercase {
        let chars: String = if config.avoid_ambiguous {
            uppercase
                .chars()
                .filter(|c| !ambiguous.contains(*c))
                .collect()
        } else {
            uppercase.to_string()
        };
        let chars: String = chars
            .chars()
            .filter(|c| {
                !config
                    .exclude_chars
                    .as_ref()
                    .is_some_and(|excluded| excluded.contains(*c))
            })
            .collect();
        let cv: Vec<char> = chars.chars().collect();
        if cv.is_empty() {
            return Err(LastPassError::new(
                crate::lastpass::types::LastPassErrorKind::BadRequest,
                "Uppercase character set was fully excluded",
            ));
        }
        required_chars.push(cv[rng.gen_range(0..cv.len())]);
        charset.push_str(&chars);
    }

    if config.lowercase {
        let chars: String = if config.avoid_ambiguous {
            lowercase
                .chars()
                .filter(|c| !ambiguous.contains(*c))
                .collect()
        } else {
            lowercase.to_string()
        };
        let chars: String = chars
            .chars()
            .filter(|c| {
                !config
                    .exclude_chars
                    .as_ref()
                    .is_some_and(|excluded| excluded.contains(*c))
            })
            .collect();
        let cv: Vec<char> = chars.chars().collect();
        if cv.is_empty() {
            return Err(LastPassError::new(
                crate::lastpass::types::LastPassErrorKind::BadRequest,
                "Lowercase character set was fully excluded",
            ));
        }
        required_chars.push(cv[rng.gen_range(0..cv.len())]);
        charset.push_str(&chars);
    }

    if config.digits {
        let chars: String = if config.avoid_ambiguous {
            digits.chars().filter(|c| !ambiguous.contains(*c)).collect()
        } else {
            digits.to_string()
        };
        let chars: String = chars
            .chars()
            .filter(|c| {
                !config
                    .exclude_chars
                    .as_ref()
                    .is_some_and(|excluded| excluded.contains(*c))
            })
            .collect();
        let cv: Vec<char> = chars.chars().collect();
        if cv.is_empty() {
            return Err(LastPassError::new(
                crate::lastpass::types::LastPassErrorKind::BadRequest,
                "Digit character set was fully excluded",
            ));
        }
        for _ in 0..required_digits {
            required_chars.push(cv[rng.gen_range(0..cv.len())]);
        }
        charset.push_str(&chars);
    }

    if config.symbols {
        let chars: String = symbols
            .chars()
            .filter(|c| {
                !config
                    .exclude_chars
                    .as_ref()
                    .is_some_and(|excluded| excluded.contains(*c))
            })
            .collect();
        let sv: Vec<char> = chars.chars().collect();
        if sv.is_empty() {
            return Err(LastPassError::new(
                crate::lastpass::types::LastPassErrorKind::BadRequest,
                "Symbol character set was fully excluded",
            ));
        }
        for _ in 0..required_symbols {
            required_chars.push(sv[rng.gen_range(0..sv.len())]);
        }
        charset.push_str(&chars);
    }

    if charset.is_empty() {
        return Err(LastPassError::new(
            crate::lastpass::types::LastPassErrorKind::BadRequest,
            "No character sets selected for password generation",
        ));
    }

    let charset_chars: Vec<char> = charset.chars().collect();
    if required_chars.len() > config.length as usize {
        return Err(LastPassError::new(
            crate::lastpass::types::LastPassErrorKind::BadRequest,
            "Minimum character requirements exceed password length",
        ));
    }
    let mut password: Vec<char> = Vec::with_capacity(config.length as usize);

    // Add required chars first
    for c in &required_chars {
        password.push(*c);
    }

    // Fill remaining
    while password.len() < config.length as usize {
        let idx = rng.gen_range(0..charset_chars.len());
        password.push(charset_chars[idx]);
    }

    // Shuffle
    password.shuffle(&mut rng);

    Ok(password.into_iter().collect())
}

/// Generate a memorable passphrase.
pub fn generate_passphrase(word_count: u32, separator: &str) -> Result<String, LastPassError> {
    if !(3..=24).contains(&word_count)
        || separator.len() > 16
        || separator.chars().any(|ch| ch.is_control())
    {
        return Err(LastPassError::new(
            crate::lastpass::types::LastPassErrorKind::BadRequest,
            "Passphrase settings exceed the supported safety limits",
        ));
    }
    let words = [
        "apple", "banana", "cherry", "dragon", "eagle", "falcon", "garden", "harbor", "island",
        "jungle", "kernel", "lantern", "marble", "nectar", "orange", "planet", "quartz", "rocket",
        "silver", "thunder", "umbrella", "vertex", "walnut", "xenon", "yellow", "zenith", "aurora",
        "breeze", "cosmos", "delta", "ember", "frost", "glacier", "horizon", "indigo", "jasper",
        "knight", "legend", "mystic", "noble", "oracle", "phoenix", "quest", "realm", "storm",
        "titan", "unity", "voyage", "wonder", "zephyr", "anchor", "beacon", "cipher", "drift",
        "echo", "flame", "ghost", "haven", "ivory", "jade", "kite", "lotus", "mirror", "north",
    ];

    let mut rng = OsRng;
    let selected: Vec<&str> = (0..word_count)
        .map(|_| words[rng.gen_range(0..words.len())])
        .collect();

    Ok(selected.join(separator))
}

/// Calculate password entropy (bits).
pub fn calculate_entropy(password: &str) -> f64 {
    let mut charset_size = 0u32;
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_symbol = password
        .chars()
        .any(|c| !c.is_alphanumeric() && c.is_ascii());

    if has_lower {
        charset_size += 26;
    }
    if has_upper {
        charset_size += 26;
    }
    if has_digit {
        charset_size += 10;
    }
    if has_symbol {
        charset_size += 32;
    }

    if charset_size == 0 {
        return 0.0;
    }

    password.len() as f64 * (charset_size as f64).log2()
}

/// Rate password strength as a string.
pub fn rate_strength(entropy: f64) -> &'static str {
    if entropy < 28.0 {
        "Very Weak"
    } else if entropy < 36.0 {
        "Weak"
    } else if entropy < 60.0 {
        "Fair"
    } else if entropy < 80.0 {
        "Strong"
    } else {
        "Very Strong"
    }
}

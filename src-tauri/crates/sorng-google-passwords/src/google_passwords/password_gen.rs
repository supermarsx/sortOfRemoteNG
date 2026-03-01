use crate::google_passwords::types::{GooglePasswordsError, PasswordGenConfig};
use rand::Rng;

/// Generate a password based on the given configuration.
pub fn generate_password(config: &PasswordGenConfig) -> Result<String, GooglePasswordsError> {
    if config.length < 4 {
        return Err(GooglePasswordsError::new(
            crate::google_passwords::types::GooglePasswordsErrorKind::BadRequest,
            "Password length must be at least 4",
        ));
    }

    let mut charset = String::new();
    let mut required: Vec<char> = Vec::new();
    let mut rng = rand::thread_rng();

    let uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let lowercase = "abcdefghijklmnopqrstuvwxyz";
    let digits = "0123456789";
    let symbols = "!@#$%^&*()_+-=[]{}|;:',.<>?";
    let ambiguous = "0O1lI";

    if config.include_uppercase {
        let chars: String = if config.exclude_ambiguous {
            uppercase.chars().filter(|c| !ambiguous.contains(*c)).collect()
        } else {
            uppercase.to_string()
        };
        let chars_v: Vec<char> = chars.chars().collect();
        required.push(chars_v[rng.gen_range(0..chars_v.len())]);
        charset.push_str(&chars);
    }

    if config.include_lowercase {
        let chars: String = if config.exclude_ambiguous {
            lowercase.chars().filter(|c| !ambiguous.contains(*c)).collect()
        } else {
            lowercase.to_string()
        };
        let chars_v: Vec<char> = chars.chars().collect();
        required.push(chars_v[rng.gen_range(0..chars_v.len())]);
        charset.push_str(&chars);
    }

    if config.include_numbers {
        let chars: String = if config.exclude_ambiguous {
            digits.chars().filter(|c| !ambiguous.contains(*c)).collect()
        } else {
            digits.to_string()
        };
        let chars_v: Vec<char> = chars.chars().collect();
        required.push(chars_v[rng.gen_range(0..chars_v.len())]);
        charset.push_str(&chars);
    }

    if config.include_symbols {
        let sym_v: Vec<char> = symbols.chars().collect();
        required.push(sym_v[rng.gen_range(0..sym_v.len())]);
        charset.push_str(symbols);
    }

    if charset.is_empty() {
        return Err(GooglePasswordsError::new(
            crate::google_passwords::types::GooglePasswordsErrorKind::BadRequest,
            "No character sets selected",
        ));
    }

    let charset_chars: Vec<char> = charset.chars().collect();
    let mut password: Vec<char> = Vec::with_capacity(config.length as usize);

    for c in &required {
        password.push(*c);
    }

    while password.len() < config.length as usize {
        let idx = rng.gen_range(0..charset_chars.len());
        password.push(charset_chars[idx]);
    }

    // Shuffle
    for i in (1..password.len()).rev() {
        let j = rng.gen_range(0..=i);
        password.swap(i, j);
    }

    Ok(password.into_iter().collect())
}

/// Calculate password entropy in bits.
pub fn calculate_entropy(password: &str) -> f64 {
    let mut charset_size = 0u32;
    if password.chars().any(|c| c.is_ascii_lowercase()) { charset_size += 26; }
    if password.chars().any(|c| c.is_ascii_uppercase()) { charset_size += 26; }
    if password.chars().any(|c| c.is_ascii_digit()) { charset_size += 10; }
    if password.chars().any(|c| !c.is_alphanumeric() && c.is_ascii()) { charset_size += 32; }
    if charset_size == 0 { return 0.0; }
    password.len() as f64 * (charset_size as f64).log2()
}

/// Rate password strength as a human-readable string.
pub fn rate_strength(entropy: f64) -> &'static str {
    if entropy < 28.0 { "Very Weak" }
    else if entropy < 36.0 { "Weak" }
    else if entropy < 60.0 { "Fair" }
    else if entropy < 80.0 { "Strong" }
    else { "Very Strong" }
}

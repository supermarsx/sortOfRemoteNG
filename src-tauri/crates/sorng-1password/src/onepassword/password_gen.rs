use super::types::*;

/// Secure password generation utilities for 1Password items.
pub struct OnePasswordPasswordGen;

impl OnePasswordPasswordGen {
    /// Generate a random password with the given configuration.
    pub fn generate(config: &PasswordGenConfig) -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();

        let mut chars = String::new();
        if config.include_letters {
            chars.push_str("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");
        }
        if config.include_digits {
            chars.push_str("0123456789");
        }
        if config.include_symbols {
            chars.push_str("!@#$%^&*()_+-=[]{}|;:,.<>?");
        }

        // Remove excluded characters
        if let Some(exclude) = &config.exclude_characters {
            chars = chars.chars().filter(|c| !exclude.contains(*c)).collect();
        }

        if chars.is_empty() {
            chars = "abcdefghijklmnopqrstuvwxyz".to_string();
        }

        let char_vec: Vec<char> = chars.chars().collect();
        let mut password = String::with_capacity(config.length as usize);

        for _ in 0..config.length {
            let idx = rng.gen_range(0..char_vec.len());
            password.push(char_vec[idx]);
        }

        password
    }

    /// Generate a passphrase using random words.
    pub fn generate_passphrase(word_count: u32, separator: &str) -> String {
        use rand::seq::SliceRandom;
        let mut rng = rand::thread_rng();

        // Static word list (commonly used passphrase words)
        let words = &[
            "apple", "bright", "castle", "dance", "eagle", "forest", "garden",
            "harbor", "island", "jungle", "kettle", "lemon", "mountain", "noble",
            "ocean", "planet", "quartz", "river", "sunset", "tower", "umbrella",
            "valley", "winter", "xenon", "yellow", "zenith", "anchor", "breeze",
            "cloud", "desert", "ember", "falcon", "glacier", "horizon", "ivory",
            "jasmine", "knight", "lantern", "meadow", "nectar", "orchid", "prism",
            "quill", "rapids", "silver", "thunder", "uplift", "velvet", "willow",
            "mystic", "blaze", "crystal", "dragon", "eclipse", "flame", "granite",
            "hollow", "infernal", "jubilee", "karma", "lotus", "marble", "nimbus",
        ];

        let selected: Vec<&str> = words
            .choose_multiple(&mut rng, word_count as usize)
            .cloned()
            .collect();

        selected.join(separator)
    }

    /// Build a GeneratorRecipe from a PasswordGenConfig.
    pub fn to_recipe(config: &PasswordGenConfig) -> GeneratorRecipe {
        let mut sets = Vec::new();
        if config.include_letters {
            sets.push("LETTERS".to_string());
        }
        if config.include_digits {
            sets.push("DIGITS".to_string());
        }
        if config.include_symbols {
            sets.push("SYMBOLS".to_string());
        }

        GeneratorRecipe {
            length: Some(config.length),
            character_sets: if sets.is_empty() { None } else { Some(sets) },
            exclude_characters: config.exclude_characters.clone(),
        }
    }

    /// Calculate password entropy in bits.
    pub fn calculate_entropy(password: &str) -> f64 {
        let mut has_lower = false;
        let mut has_upper = false;
        let mut has_digit = false;
        let mut has_symbol = false;

        for c in password.chars() {
            if c.is_ascii_lowercase() {
                has_lower = true;
            } else if c.is_ascii_uppercase() {
                has_upper = true;
            } else if c.is_ascii_digit() {
                has_digit = true;
            } else {
                has_symbol = true;
            }
        }

        let mut pool_size: f64 = 0.0;
        if has_lower { pool_size += 26.0; }
        if has_upper { pool_size += 26.0; }
        if has_digit { pool_size += 10.0; }
        if has_symbol { pool_size += 32.0; }

        if pool_size == 0.0 {
            return 0.0;
        }

        password.len() as f64 * pool_size.log2()
    }

    /// Rate password strength based on entropy.
    pub fn rate_strength(password: &str) -> &'static str {
        let entropy = Self::calculate_entropy(password);
        match entropy as u32 {
            0..=28 => "Very Weak",
            29..=35 => "Weak",
            36..=59 => "Fair",
            60..=127 => "Strong",
            _ => "Very Strong",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_default_length() {
        let config = PasswordGenConfig::default();
        let pwd = OnePasswordPasswordGen::generate(&config);
        assert_eq!(pwd.len(), 32);
    }

    #[test]
    fn test_generate_custom_length() {
        let config = PasswordGenConfig {
            length: 16,
            ..Default::default()
        };
        let pwd = OnePasswordPasswordGen::generate(&config);
        assert_eq!(pwd.len(), 16);
    }

    #[test]
    fn test_generate_digits_only() {
        let config = PasswordGenConfig {
            length: 20,
            include_letters: false,
            include_digits: true,
            include_symbols: false,
            exclude_characters: None,
        };
        let pwd = OnePasswordPasswordGen::generate(&config);
        assert!(pwd.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn test_passphrase_word_count() {
        let phrase = OnePasswordPasswordGen::generate_passphrase(4, "-");
        assert_eq!(phrase.split('-').count(), 4);
    }

    #[test]
    fn test_entropy_calculation() {
        let entropy = OnePasswordPasswordGen::calculate_entropy("password123");
        assert!(entropy > 0.0);
    }

    #[test]
    fn test_strength_rating() {
        assert_eq!(OnePasswordPasswordGen::rate_strength("abc"), "Very Weak");
        let strong = OnePasswordPasswordGen::generate(&PasswordGenConfig::default());
        let rating = OnePasswordPasswordGen::rate_strength(&strong);
        assert!(rating == "Strong" || rating == "Very Strong");
    }
}

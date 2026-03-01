use crate::google_passwords::types::{Credential, GooglePasswordsError, PasswordCheckupResult, PasswordStrength};

/// Run Google Password Checkup analysis on all credentials.
pub fn run_checkup(credentials: &[Credential]) -> PasswordCheckupResult {
    use std::collections::HashMap;

    let mut compromised_list = Vec::new();
    let mut weak_list = Vec::new();
    let mut password_groups: HashMap<String, Vec<Credential>> = HashMap::new();

    for cred in credentials {
        // Track password reuse
        if !cred.password.is_empty() {
            password_groups
                .entry(cred.password.clone())
                .or_default()
                .push(cred.clone());
        }

        // Track compromised
        if cred.compromised {
            compromised_list.push(cred.clone());
        }

        // Track weak passwords
        if cred.weak || is_weak_password(&cred.password) {
            weak_list.push(cred.clone());
        }
    }

    let reused_groups: Vec<Vec<Credential>> = password_groups
        .into_values()
        .filter(|group| group.len() > 1)
        .collect();

    let reused_count: u64 = reused_groups.iter().map(|g| g.len() as u64).sum();

    PasswordCheckupResult {
        total_passwords: credentials.len() as u64,
        compromised: compromised_list.len() as u64,
        reused: reused_count,
        weak: weak_list.len() as u64,
        compromised_credentials: compromised_list,
        reused_credentials: reused_groups,
        weak_credentials: weak_list,
    }
}

/// Check if a password is considered weak.
fn is_weak_password(password: &str) -> bool {
    if password.is_empty() || password.len() < 8 {
        return true;
    }

    let has_upper = password.chars().any(|c| c.is_uppercase());
    let has_lower = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_symbol = password.chars().any(|c| !c.is_alphanumeric());

    let variety = [has_upper, has_lower, has_digit, has_symbol]
        .iter()
        .filter(|&&v| v)
        .count();

    variety < 2
}

/// Check if a URL is using insecure HTTP.
pub fn is_insecure_url(url: &str) -> bool {
    url.starts_with("http://") && !url.starts_with("http://localhost")
}

/// Get credentials with insecure URLs.
pub fn find_insecure_urls(credentials: &[Credential]) -> Vec<Credential> {
    credentials
        .iter()
        .filter(|c| is_insecure_url(&c.url))
        .cloned()
        .collect()
}

/// Get a summary of password strength distribution.
pub fn strength_distribution(credentials: &[Credential]) -> Vec<(PasswordStrength, usize)> {
    use crate::google_passwords::items::assess_strength;

    let mut very_weak = 0;
    let mut weak = 0;
    let mut fair = 0;
    let mut strong = 0;
    let mut very_strong = 0;

    for cred in credentials {
        match assess_strength(&cred.password) {
            PasswordStrength::VeryWeak => very_weak += 1,
            PasswordStrength::Weak => weak += 1,
            PasswordStrength::Fair => fair += 1,
            PasswordStrength::Strong => strong += 1,
            PasswordStrength::VeryStrong => very_strong += 1,
        }
    }

    vec![
        (PasswordStrength::VeryWeak, very_weak),
        (PasswordStrength::Weak, weak),
        (PasswordStrength::Fair, fair),
        (PasswordStrength::Strong, strong),
        (PasswordStrength::VeryStrong, very_strong),
    ]
}

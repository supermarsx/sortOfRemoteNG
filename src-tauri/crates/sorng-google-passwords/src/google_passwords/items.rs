use crate::google_passwords::types::{
    Credential, CredentialFilter, GooglePasswordsError, PasswordStrength,
};

/// Filter credentials based on the given criteria.
pub fn filter_credentials(credentials: &[Credential], filter: &CredentialFilter) -> Vec<Credential> {
    credentials
        .iter()
        .filter(|c| {
            if filter.compromised_only && !c.compromised {
                return false;
            }
            if filter.weak_only && !c.weak {
                return false;
            }
            if filter.reused_only && !c.reused {
                return false;
            }
            if let Some(ref folder) = filter.folder {
                if c.folder.as_deref() != Some(folder) {
                    return false;
                }
            }
            if let Some(ref search) = filter.search {
                let search_lower = search.to_lowercase();
                let matches = c.name.to_lowercase().contains(&search_lower)
                    || c.url.to_lowercase().contains(&search_lower)
                    || c.username.to_lowercase().contains(&search_lower);
                if !matches {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect()
}

/// Find a credential by ID.
pub fn find_by_id<'a>(credentials: &'a [Credential], id: &str) -> Option<&'a Credential> {
    credentials.iter().find(|c| c.id == id)
}

/// Find credentials by URL (partial match).
pub fn find_by_url(credentials: &[Credential], url: &str) -> Vec<Credential> {
    let url_lower = url.to_lowercase();
    credentials
        .iter()
        .filter(|c| c.url.to_lowercase().contains(&url_lower))
        .cloned()
        .collect()
}

/// Find credentials by name (case-insensitive partial match).
pub fn find_by_name(credentials: &[Credential], name: &str) -> Vec<Credential> {
    let name_lower = name.to_lowercase();
    credentials
        .iter()
        .filter(|c| c.name.to_lowercase().contains(&name_lower))
        .cloned()
        .collect()
}

/// Assess password strength.
pub fn assess_strength(password: &str) -> PasswordStrength {
    let len = password.len();
    let has_upper = password.chars().any(|c| c.is_uppercase());
    let has_lower = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_symbol = password.chars().any(|c| !c.is_alphanumeric());

    let variety = [has_upper, has_lower, has_digit, has_symbol]
        .iter()
        .filter(|&&v| v)
        .count();

    if len < 6 || variety < 1 {
        PasswordStrength::VeryWeak
    } else if len < 8 || variety < 2 {
        PasswordStrength::Weak
    } else if len < 12 || variety < 3 {
        PasswordStrength::Fair
    } else if len < 16 || variety < 4 {
        PasswordStrength::Strong
    } else {
        PasswordStrength::VeryStrong
    }
}

/// Detect duplicate passwords.
pub fn find_duplicates(credentials: &[Credential]) -> Vec<Vec<Credential>> {
    use std::collections::HashMap;
    let mut by_password: HashMap<&str, Vec<Credential>> = HashMap::new();

    for cred in credentials {
        if !cred.password.is_empty() {
            by_password
                .entry(&cred.password)
                .or_default()
                .push(cred.clone());
        }
    }

    by_password
        .into_values()
        .filter(|group| group.len() > 1)
        .collect()
}

/// Mark credentials with security issues (weak, reused, compromised).
pub fn run_security_analysis(credentials: &mut [Credential]) {
    // Detect reused passwords
    use std::collections::HashMap;
    let mut password_count: HashMap<String, usize> = HashMap::new();
    for cred in credentials.iter() {
        if !cred.password.is_empty() {
            *password_count.entry(cred.password.clone()).or_default() += 1;
        }
    }

    for cred in credentials.iter_mut() {
        // Assess strength
        let strength = assess_strength(&cred.password);
        cred.weak = matches!(strength, PasswordStrength::VeryWeak | PasswordStrength::Weak);
        cred.password_strength = Some(strength);

        // Check reuse
        cred.reused = password_count
            .get(&cred.password)
            .map(|&count| count > 1)
            .unwrap_or(false);
    }
}

/// Get all unique folders from credentials.
pub fn get_folders(credentials: &[Credential]) -> Vec<String> {
    let mut folders: Vec<String> = credentials
        .iter()
        .filter_map(|c| c.folder.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    folders.sort();
    folders
}

/// Count credentials per folder.
pub fn count_by_folder(credentials: &[Credential]) -> Vec<(String, usize)> {
    use std::collections::HashMap;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for cred in credentials {
        let folder = cred.folder.clone().unwrap_or_else(|| "(None)".to_string());
        *counts.entry(folder).or_default() += 1;
    }
    let mut result: Vec<_> = counts.into_iter().collect();
    result.sort_by(|a, b| b.1.cmp(&a.1));
    result
}

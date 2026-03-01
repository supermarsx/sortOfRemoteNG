use crate::dashlane::types::{
    DashlaneCredential, DashlaneError, PasswordHealthScore, PasswordHealthDetail,
};

/// Analyze password health across all credentials.
pub fn analyze_password_health(credentials: &[DashlaneCredential]) -> PasswordHealthScore {
    if credentials.is_empty() {
        return PasswordHealthScore {
            overall_score: 100,
            total_passwords: 0,
            strong_count: 0,
            medium_count: 0,
            weak_count: 0,
            reused_count: 0,
            compromised_count: 0,
            old_count: 0,
            details: Vec::new(),
        };
    }

    let mut details = Vec::new();
    let mut strong = 0u32;
    let mut medium = 0u32;
    let mut weak = 0u32;
    let mut compromised = 0u32;
    let mut old = 0u32;

    // Detect reused passwords
    let mut password_users: std::collections::HashMap<&str, Vec<&str>> =
        std::collections::HashMap::new();
    for cred in credentials {
        if !cred.password.is_empty() {
            password_users
                .entry(cred.password.as_str())
                .or_default()
                .push(cred.id.as_str());
        }
    }
    let reused_ids: std::collections::HashSet<&str> = password_users
        .values()
        .filter(|users| users.len() > 1)
        .flat_map(|users| users.iter().copied())
        .collect();
    let reused_count = reused_ids.len() as u32;

    let now = chrono::Utc::now();

    for cred in credentials {
        let strength = assess_password_strength(&cred.password);
        match strength {
            s if s >= 80 => strong += 1,
            s if s >= 50 => medium += 1,
            _ => weak += 1,
        }

        if cred.compromised {
            compromised += 1;
        }

        // Check if password is old (> 180 days)
        let is_old = cred.modified_at.as_ref().map_or(false, |date| {
            chrono::DateTime::parse_from_rfc3339(date)
                .map(|d| (now - d.with_timezone(&chrono::Utc)).num_days() > 180)
                .unwrap_or(false)
        });
        if is_old {
            old += 1;
        }

        let is_reused = reused_ids.contains(cred.id.as_str());

        let mut issues = Vec::new();
        if strength < 50 {
            issues.push("Weak password".to_string());
        }
        if is_reused {
            issues.push("Reused password".to_string());
        }
        if cred.compromised {
            issues.push("Compromised".to_string());
        }
        if is_old {
            issues.push("Password not changed in 180+ days".to_string());
        }

        if !issues.is_empty() {
            details.push(PasswordHealthDetail {
                credential_id: cred.id.clone(),
                credential_title: cred.title.clone(),
                strength,
                is_reused,
                is_compromised: cred.compromised,
                is_old,
                issues,
            });
        }
    }

    let total = credentials.len() as u32;
    let penalty_weak = (weak as f64 / total as f64) * 40.0;
    let penalty_reused = (reused_count as f64 / total as f64) * 30.0;
    let penalty_compromised = (compromised as f64 / total as f64) * 20.0;
    let penalty_old = (old as f64 / total as f64) * 10.0;
    let overall =
        (100.0 - penalty_weak - penalty_reused - penalty_compromised - penalty_old).max(0.0)
            as u32;

    // Sort details by strength (worst first)
    let mut details = details;
    details.sort_by(|a, b| a.strength.cmp(&b.strength));

    PasswordHealthScore {
        overall_score: overall,
        total_passwords: total,
        strong_count: strong,
        medium_count: medium,
        weak_count: weak,
        reused_count,
        compromised_count: compromised,
        old_count: old,
        details,
    }
}

/// Assess the strength of a single password (0-100).
pub fn assess_password_strength(password: &str) -> u32 {
    if password.is_empty() {
        return 0;
    }

    let len = password.len();
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password.chars().any(|c| !c.is_alphanumeric());

    let mut score: u32 = 0;

    // Length scoring
    score += match len {
        0..=5 => 5,
        6..=7 => 15,
        8..=11 => 25,
        12..=15 => 35,
        16..=19 => 45,
        _ => 50,
    };

    // Diversity scoring
    let mut diversity = 0u32;
    if has_lower {
        diversity += 1;
    }
    if has_upper {
        diversity += 1;
    }
    if has_digit {
        diversity += 1;
    }
    if has_special {
        diversity += 1;
    }
    score += diversity * 10;

    // Penalty for repeating characters
    let unique_chars: std::collections::HashSet<char> = password.chars().collect();
    let uniqueness = unique_chars.len() as f64 / len as f64;
    if uniqueness < 0.5 {
        score = score.saturating_sub(15);
    }

    // Penalty for common patterns
    let lower = password.to_lowercase();
    let common = [
        "password",
        "123456",
        "qwerty",
        "admin",
        "letmein",
        "welcome",
    ];
    if common.iter().any(|p| lower.contains(p)) {
        score = score.saturating_sub(30);
    }

    score.min(100)
}

/// Get credentials with the worst health issues.
pub fn get_worst_credentials(
    health: &PasswordHealthScore,
    limit: usize,
) -> Vec<&PasswordHealthDetail> {
    health.details.iter().take(limit).collect()
}

/// Get actionable improvement suggestions.
pub fn get_improvement_suggestions(health: &PasswordHealthScore) -> Vec<String> {
    let mut suggestions = Vec::new();

    if health.weak_count > 0 {
        suggestions.push(format!(
            "Strengthen {} weak password{}",
            health.weak_count,
            if health.weak_count == 1 { "" } else { "s" }
        ));
    }

    if health.reused_count > 0 {
        suggestions.push(format!(
            "Change {} reused password{} to unique ones",
            health.reused_count,
            if health.reused_count == 1 { "" } else { "s" }
        ));
    }

    if health.compromised_count > 0 {
        suggestions.push(format!(
            "Immediately change {} compromised password{}",
            health.compromised_count,
            if health.compromised_count == 1 { "" } else { "s" }
        ));
    }

    if health.old_count > 0 {
        suggestions.push(format!(
            "Update {} password{} not changed in 180+ days",
            health.old_count,
            if health.old_count == 1 { "" } else { "s" }
        ));
    }

    if suggestions.is_empty() {
        suggestions.push("Your password health is excellent! Keep it up.".to_string());
    }

    suggestions
}

use crate::lastpass::types::{
    Account, SecurityIssue, SecurityScore, SecurityScoreDetail, LastPassError,
};

/// Perform a security analysis on all accounts.
pub fn analyze_security(accounts: &[Account]) -> SecurityScore {
    let mut details = Vec::new();
    let mut weak_count = 0u64;
    let mut reused_count = 0u64;
    let mut old_count = 0u64;
    let mut blank_count = 0u64;
    let mut total_length: usize = 0;

    // Count password frequencies for reuse detection
    use std::collections::HashMap;
    let mut password_freq: HashMap<&str, usize> = HashMap::new();
    for account in accounts {
        if !account.password.is_empty() {
            *password_freq.entry(&account.password).or_default() += 1;
        }
    }

    for account in accounts {
        let mut issues = Vec::new();
        let password = &account.password;

        if password.is_empty() {
            issues.push(SecurityIssue::BlankPassword);
            blank_count += 1;
        } else {
            total_length += password.len();

            // Check length
            if password.len() < 8 {
                issues.push(SecurityIssue::ShortPassword);
            }

            // Check complexity
            let has_upper = password.chars().any(|c| c.is_uppercase());
            let has_lower = password.chars().any(|c| c.is_lowercase());
            let has_digit = password.chars().any(|c| c.is_ascii_digit());
            let has_symbol = password.chars().any(|c| !c.is_alphanumeric());

            if !has_upper {
                issues.push(SecurityIssue::NoUppercase);
            }
            if !has_lower {
                issues.push(SecurityIssue::NoLowercase);
            }
            if !has_digit {
                issues.push(SecurityIssue::NoDigits);
            }
            if !has_symbol {
                issues.push(SecurityIssue::NoSymbols);
            }

            // Weak password detection
            if password.len() < 8 || (!has_upper && !has_symbol) {
                issues.push(SecurityIssue::WeakPassword);
                weak_count += 1;
            }

            // Reuse check
            if password_freq.get(password.as_str()).copied().unwrap_or(0) > 1 {
                issues.push(SecurityIssue::ReusedPassword);
                reused_count += 1;
            }

            // HTTP URL check
            if account.url.starts_with("http://") && !account.url.starts_with("http://localhost") {
                issues.push(SecurityIssue::HttpUrl);
            }
        }

        // Old password check (> 180 days)
        if let Some(ref modified) = account.last_modified {
            if let Ok(ts) = modified.parse::<i64>() {
                let now = chrono::Utc::now().timestamp();
                if now - ts > 180 * 86400 {
                    issues.push(SecurityIssue::OldPassword);
                    old_count += 1;
                }
            }
        }

        let score = calculate_item_score(&issues);
        details.push(SecurityScoreDetail {
            account_id: account.id.clone(),
            account_name: account.name.clone(),
            score,
            issues,
        });
    }

    let non_blank = accounts.iter().filter(|a| !a.password.is_empty()).count();
    let avg_length = if non_blank > 0 {
        total_length as f64 / non_blank as f64
    } else {
        0.0
    };

    let total_score = if details.is_empty() {
        100.0
    } else {
        details.iter().map(|d| d.score).sum::<f64>() / details.len() as f64
    };

    SecurityScore {
        total_score,
        total_items: accounts.len() as u64,
        weak_passwords: weak_count,
        reused_passwords: reused_count,
        old_passwords: old_count,
        blank_passwords: blank_count,
        duplicate_count: password_freq
            .values()
            .filter(|&&c| c > 1)
            .count() as u64,
        average_password_length: avg_length,
        compromised_emails: 0,
        accounts_without_mfa: 0,
        details,
    }
}

/// Calculate a score for a single item based on its issues.
fn calculate_item_score(issues: &[SecurityIssue]) -> f64 {
    let mut score = 100.0;
    for issue in issues {
        match issue {
            SecurityIssue::BlankPassword => score -= 100.0,
            SecurityIssue::WeakPassword => score -= 40.0,
            SecurityIssue::ReusedPassword => score -= 30.0,
            SecurityIssue::ShortPassword => score -= 20.0,
            SecurityIssue::OldPassword => score -= 10.0,
            SecurityIssue::HttpUrl => score -= 15.0,
            SecurityIssue::CompromisedSite => score -= 50.0,
            SecurityIssue::NoUppercase => score -= 5.0,
            SecurityIssue::NoLowercase => score -= 5.0,
            SecurityIssue::NoDigits => score -= 5.0,
            SecurityIssue::NoSymbols => score -= 5.0,
        }
    }
    score.max(0.0)
}

/// Get accounts with the worst security scores.
pub fn get_worst_accounts(score: &SecurityScore, limit: usize) -> Vec<SecurityScoreDetail> {
    let mut sorted = score.details.clone();
    sorted.sort_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal));
    sorted.into_iter().take(limit).collect()
}

/// Get accounts that need immediate attention (score < 50).
pub fn get_critical_accounts(score: &SecurityScore) -> Vec<SecurityScoreDetail> {
    score
        .details
        .iter()
        .filter(|d| d.score < 50.0)
        .cloned()
        .collect()
}

//! High-level vault operations for the Bitwarden integration.
//!
//! Provides helpers for searching, filtering, credential matching,
//! password health analysis, and vault statistics.

use crate::bitwarden::types::*;
use std::collections::HashMap;

// ── Credential matching ─────────────────────────────────────────────

/// Match vault items against a target URI for autofill purposes.
///
/// Returns items sorted by match score (highest first).
pub fn match_credentials(items: &[VaultItem], target_uri: &str) -> Vec<CredentialMatch> {
    let normalized_target = normalize_for_matching(target_uri);
    let target_domain = extract_domain(target_uri);

    let mut matches: Vec<CredentialMatch> = Vec::new();

    for item in items {
        if item.item_type != ItemType::Login as u8 || item.is_deleted() {
            continue;
        }

        let Some(ref login) = item.login else { continue };
        let Some(ref uris) = login.uris else { continue };

        let mut best_score: f64 = 0.0;
        let mut matched_uri: Option<String> = None;

        for login_uri in uris {
            let Some(ref uri) = login_uri.uri else { continue };
            let score = compute_uri_match_score(
                uri,
                target_uri,
                &normalized_target,
                &target_domain,
                login_uri.match_type,
            );
            if score > best_score {
                best_score = score;
                matched_uri = Some(uri.clone());
            }
        }

        if best_score > 0.0 {
            matches.push(CredentialMatch {
                item_id: item.id.clone().unwrap_or_default(),
                item_name: item.name.clone(),
                username: login.username.clone(),
                password: login.password.clone(),
                totp: login.totp.clone(),
                uri: matched_uri,
                score: best_score,
            });
        }
    }

    matches.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    matches
}

/// Compute a match score between a stored URI and a target URI.
fn compute_uri_match_score(
    stored_uri: &str,
    target_uri: &str,
    normalized_target: &str,
    target_domain: &str,
    match_type: Option<u8>,
) -> f64 {
    let normalized_stored = normalize_for_matching(stored_uri);
    let stored_domain = extract_domain(stored_uri);

    match match_type.and_then(UriMatchType::from_u8) {
        Some(UriMatchType::Never) => return 0.0,
        Some(UriMatchType::Exact) => {
            if normalized_stored == normalized_target {
                return 1.0;
            }
            return 0.0;
        }
        Some(UriMatchType::StartsWith) => {
            if normalized_target.starts_with(&normalized_stored) {
                return 0.9;
            }
            return 0.0;
        }
        Some(UriMatchType::Host) => {
            let stored_host = extract_host(stored_uri);
            let target_host = extract_host(target_uri);
            if stored_host == target_host {
                return 0.85;
            }
            return 0.0;
        }
        Some(UriMatchType::RegularExpression) => {
            match regex::Regex::new(stored_uri) {
                Ok(re) => {
                    if re.is_match(target_uri) {
                        return 0.7;
                    }
                }
                Err(_) => {}
            }
            return 0.0;
        }
        // Default and Domain match
        _ => {
            // Exact match
            if normalized_stored == normalized_target {
                return 1.0;
            }
            // Domain match (the default)
            if !stored_domain.is_empty() && stored_domain == target_domain {
                return 0.8;
            }
            // Partial match (stored is a prefix of target)
            if normalized_target.starts_with(&normalized_stored) {
                return 0.5;
            }
            0.0
        }
    }
}

/// Normalize a URI for matching: lowercase, strip protocol, strip trailing slash.
fn normalize_for_matching(uri: &str) -> String {
    let s = uri.to_lowercase();
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(&s);
    let s = s.strip_prefix("www.").unwrap_or(s);
    s.trim_end_matches('/').to_string()
}

/// Extract the domain from a URI.
fn extract_domain(uri: &str) -> String {
    let host = extract_host(uri);
    // Try to get the registerable domain (last two parts for .com, etc.)
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() >= 2 {
        parts[parts.len() - 2..].join(".")
    } else {
        host
    }
}

/// Extract the hostname from a URI.
fn extract_host(uri: &str) -> String {
    let s = uri.to_lowercase();
    let s = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")).unwrap_or(&s);
    let s = s.strip_prefix("www.").unwrap_or(s);
    // Take everything before the first / or : (port)
    s.split('/').next().unwrap_or(s)
        .split(':').next().unwrap_or(s)
        .to_string()
}

// ── Search & filter ─────────────────────────────────────────────────

/// Search items by name, username, URI, or notes.
pub fn search_items<'a>(items: &'a [VaultItem], query: &str) -> Vec<&'a VaultItem> {
    let q = query.to_lowercase();
    items.iter().filter(|item| {
        if item.is_deleted() { return false; }

        // Match on name
        if item.name.to_lowercase().contains(&q) { return true; }

        // Match on notes
        if let Some(ref notes) = item.notes {
            if notes.to_lowercase().contains(&q) { return true; }
        }

        // Match on login fields
        if let Some(ref login) = item.login {
            if let Some(ref u) = login.username {
                if u.to_lowercase().contains(&q) { return true; }
            }
            if let Some(ref uris) = login.uris {
                for uri in uris {
                    if let Some(ref u) = uri.uri {
                        if u.to_lowercase().contains(&q) { return true; }
                    }
                }
            }
        }

        // Match on card fields
        if let Some(ref card) = item.card {
            if let Some(ref name) = card.cardholder_name {
                if name.to_lowercase().contains(&q) { return true; }
            }
            if let Some(ref brand) = card.brand {
                if brand.to_lowercase().contains(&q) { return true; }
            }
        }

        // Match on identity fields
        if let Some(ref id) = item.identity {
            if let Some(ref first) = id.first_name {
                if first.to_lowercase().contains(&q) { return true; }
            }
            if let Some(ref last) = id.last_name {
                if last.to_lowercase().contains(&q) { return true; }
            }
            if let Some(ref email) = id.email {
                if email.to_lowercase().contains(&q) { return true; }
            }
        }

        // Match on custom fields
        if let Some(ref fields) = item.fields {
            for field in fields {
                if let Some(ref name) = field.name {
                    if name.to_lowercase().contains(&q) { return true; }
                }
                if field.field_type != FieldType::Hidden as u8 {
                    if let Some(ref val) = field.value {
                        if val.to_lowercase().contains(&q) { return true; }
                    }
                }
            }
        }

        false
    }).collect()
}

/// Filter items by type.
pub fn filter_by_type(items: &[VaultItem], item_type: ItemType) -> Vec<&VaultItem> {
    items.iter()
        .filter(|item| item.item_type == item_type as u8 && !item.is_deleted())
        .collect()
}

/// Filter items by folder.
pub fn filter_by_folder<'a>(items: &'a [VaultItem], folder_id: Option<&str>) -> Vec<&'a VaultItem> {
    items.iter()
        .filter(|item| {
            !item.is_deleted() && item.folder_id.as_deref() == folder_id
        })
        .collect()
}

/// Filter favorite items.
pub fn filter_favorites(items: &[VaultItem]) -> Vec<&VaultItem> {
    items.iter()
        .filter(|item| !item.is_deleted() && item.favorite == Some(true))
        .collect()
}

/// Filter items in trash.
pub fn filter_trash(items: &[VaultItem]) -> Vec<&VaultItem> {
    items.iter()
        .filter(|item| item.is_deleted())
        .collect()
}

// ── Password health analysis ────────────────────────────────────────

/// Analyze password health across all login items.
pub fn analyze_password_health(items: &[VaultItem]) -> Vec<PasswordHealthReport> {
    let mut reports = Vec::new();
    let mut password_map: HashMap<String, Vec<String>> = HashMap::new();

    // First pass: collect all passwords
    for item in items {
        if item.is_deleted() || !item.is_login() { continue; }
        if let Some(pw) = item.password() {
            password_map
                .entry(pw.to_string())
                .or_default()
                .push(item.id.clone().unwrap_or_default());
        }
    }

    // Second pass: generate reports
    for item in items {
        if item.is_deleted() || !item.is_login() { continue; }
        let Some(pw) = item.password() else { continue };

        let is_reused = password_map.get(pw)
            .map_or(false, |ids| ids.len() > 1);

        let is_weak = check_password_weakness(pw);

        let password_age_days = item.login.as_ref()
            .and_then(|l| l.password_revision_date.as_ref())
            .and_then(|d| {
                chrono::DateTime::parse_from_rfc3339(d).ok()
            })
            .map(|d| {
                let now = chrono::Utc::now();
                (now - d.with_timezone(&chrono::Utc)).num_days() as u64
            });

        reports.push(PasswordHealthReport {
            item_id: item.id.clone().unwrap_or_default(),
            item_name: item.name.clone(),
            exposed_count: None, // Would need HIBP API
            is_weak,
            is_reused,
            password_age_days,
        });
    }

    reports
}

/// Basic password weakness check.
fn check_password_weakness(password: &str) -> bool {
    if password.len() < 8 { return true; }

    let has_upper = password.chars().any(|c| c.is_uppercase());
    let has_lower = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password.chars().any(|c| !c.is_alphanumeric());

    let char_classes = [has_upper, has_lower, has_digit, has_special]
        .iter().filter(|&&b| b).count();

    // Weak if fewer than 3 character classes or length < 10
    char_classes < 2 || (char_classes < 3 && password.len() < 12)
}

/// Count password strength score (0-4).
pub fn password_strength_score(password: &str) -> u8 {
    let mut score: u8 = 0;

    if password.len() >= 8 { score += 1; }
    if password.len() >= 16 { score += 1; }
    if password.chars().any(|c| c.is_uppercase()) && password.chars().any(|c| c.is_lowercase()) {
        score += 1;
    }
    if password.chars().any(|c| c.is_ascii_digit()) { score += 1; }
    if password.chars().any(|c| !c.is_alphanumeric()) { score += 1; }

    score.min(4)
}

// ── Sorting ─────────────────────────────────────────────────────────

/// Sort criteria for vault items.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortBy {
    Name,
    DateModified,
    DateCreated,
    ItemType,
}

/// Sort vault items.
pub fn sort_items(items: &mut [VaultItem], by: SortBy, ascending: bool) {
    items.sort_by(|a, b| {
        let cmp = match by {
            SortBy::Name => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            SortBy::DateModified => {
                a.revision_date.cmp(&b.revision_date)
            }
            SortBy::DateCreated => {
                a.creation_date.cmp(&b.creation_date)
            }
            SortBy::ItemType => {
                a.item_type.cmp(&b.item_type)
            }
        };
        if ascending { cmp } else { cmp.reverse() }
    });
}

// ── Deduplication ───────────────────────────────────────────────────

/// Find potential duplicate items.
pub fn find_duplicates(items: &[VaultItem]) -> Vec<(String, String)> {
    let mut pairs = Vec::new();
    let active: Vec<&VaultItem> = items.iter()
        .filter(|item| !item.is_deleted() && item.is_login())
        .collect();

    for i in 0..active.len() {
        for j in (i + 1)..active.len() {
            let a = active[i];
            let b = active[j];

            // Same username + same first URI = likely duplicate
            if let (Some(au), Some(bu)) = (a.username(), b.username()) {
                if au == bu && !au.is_empty() {
                    if let (Some(a_uri), Some(b_uri)) = (a.first_uri(), b.first_uri()) {
                        let a_domain = extract_domain(a_uri);
                        let b_domain = extract_domain(b_uri);
                        if a_domain == b_domain {
                            pairs.push((
                                a.id.clone().unwrap_or_default(),
                                b.id.clone().unwrap_or_default(),
                            ));
                        }
                    }
                }
            }
        }
    }

    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_login(name: &str, user: &str, pass: &str, uri: &str) -> VaultItem {
        let mut item = VaultItem::new_login_with_uri(name, user, pass, uri);
        item.id = Some(format!("id-{}", name.to_lowercase().replace(' ', "-")));
        item
    }

    // ── match_credentials ───────────────────────────────────────────

    #[test]
    fn match_exact_uri() {
        let items = vec![
            make_login("GitHub", "user", "pass", "https://github.com"),
            make_login("GitLab", "user2", "pass2", "https://gitlab.com"),
        ];

        let matches = match_credentials(&items, "https://github.com");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].item_name, "GitHub");
        assert!(matches[0].score > 0.9);
    }

    #[test]
    fn match_domain_uri() {
        let items = vec![
            make_login("GitHub", "user", "pass", "https://github.com/login"),
        ];

        let matches = match_credentials(&items, "https://github.com/dashboard");
        assert_eq!(matches.len(), 1);
        assert!(matches[0].score > 0.0);
    }

    #[test]
    fn match_no_result() {
        let items = vec![
            make_login("GitHub", "user", "pass", "https://github.com"),
        ];

        let matches = match_credentials(&items, "https://example.com");
        assert_eq!(matches.len(), 0);
    }

    #[test]
    fn match_skips_deleted() {
        let mut item = make_login("GitHub", "user", "pass", "https://github.com");
        item.deleted_date = Some("2024-01-01".into());
        let items = vec![item];

        let matches = match_credentials(&items, "https://github.com");
        assert_eq!(matches.len(), 0);
    }

    #[test]
    fn match_skips_non_login() {
        let items = vec![
            VaultItem::new_secure_note("Note", "content"),
        ];

        let matches = match_credentials(&items, "https://example.com");
        assert_eq!(matches.len(), 0);
    }

    #[test]
    fn match_sorted_by_score() {
        let items = vec![
            make_login("Exact", "u1", "p1", "https://example.com"),
            make_login("Domain", "u2", "p2", "https://example.com/other"),
        ];

        let matches = match_credentials(&items, "https://example.com");
        assert!(matches.len() >= 1);
        // First match should have the highest score
        if matches.len() >= 2 {
            assert!(matches[0].score >= matches[1].score);
        }
    }

    // ── extract_domain ──────────────────────────────────────────────

    #[test]
    fn extract_domain_simple() {
        assert_eq!(extract_domain("https://www.github.com/login"), "github.com");
        assert_eq!(extract_domain("https://mail.google.com"), "google.com");
        assert_eq!(extract_domain("http://example.com"), "example.com");
    }

    #[test]
    fn extract_host_simple() {
        assert_eq!(extract_host("https://www.github.com/path"), "github.com");
        assert_eq!(extract_host("http://localhost:8080/api"), "localhost");
    }

    // ── search_items ────────────────────────────────────────────────

    #[test]
    fn search_by_name() {
        let items = vec![
            make_login("GitHub", "user", "pass", "https://github.com"),
            make_login("GitLab", "user2", "pass2", "https://gitlab.com"),
            VaultItem::new_secure_note("Notes", "some content"),
        ];

        let results = search_items(&items, "git");
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn search_by_username() {
        let items = vec![
            make_login("Site1", "john@example.com", "p", "https://a.com"),
            make_login("Site2", "jane@example.com", "p", "https://b.com"),
        ];

        let results = search_items(&items, "john");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Site1");
    }

    #[test]
    fn search_by_uri() {
        let items = vec![
            make_login("Site1", "u", "p", "https://mysite.example.com"),
            make_login("Site2", "u", "p", "https://other.com"),
        ];

        let results = search_items(&items, "mysite");
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn search_by_notes() {
        let items = vec![
            VaultItem::new_secure_note("Secret", "this is a special note"),
            VaultItem::new_secure_note("Other", "nothing here"),
        ];

        let results = search_items(&items, "special");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Secret");
    }

    #[test]
    fn search_skips_deleted() {
        let mut item = make_login("GitHub", "user", "pass", "https://github.com");
        item.deleted_date = Some("2024-01-01".into());
        let items = vec![item];

        let results = search_items(&items, "github");
        assert_eq!(results.len(), 0);
    }

    // ── filter functions ────────────────────────────────────────────

    #[test]
    fn filter_by_type_login() {
        let items = vec![
            make_login("L1", "u", "p", "https://a.com"),
            VaultItem::new_secure_note("N1", "notes"),
            VaultItem::new_card("C1", CardData::default()),
        ];

        let logins = filter_by_type(&items, ItemType::Login);
        assert_eq!(logins.len(), 1);
        assert_eq!(logins[0].name, "L1");
    }

    #[test]
    fn filter_favorites() {
        let mut item1 = make_login("F1", "u", "p", "https://a.com");
        item1.favorite = Some(true);
        let item2 = make_login("F2", "u", "p", "https://b.com");

        let items = vec![item1, item2];
        let favs = super::filter_favorites(&items);
        assert_eq!(favs.len(), 1);
        assert_eq!(favs[0].name, "F1");
    }

    #[test]
    fn filter_trash_items() {
        let mut item1 = make_login("T1", "u", "p", "https://a.com");
        item1.deleted_date = Some("2024-01-01".into());
        let item2 = make_login("T2", "u", "p", "https://b.com");

        let items = vec![item1, item2];
        let trash = filter_trash(&items);
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].name, "T1");
    }

    #[test]
    fn filter_by_folder_some() {
        let mut item1 = make_login("A", "u", "p", "https://a.com");
        item1.folder_id = Some("folder-1".into());
        let mut item2 = make_login("B", "u", "p", "https://b.com");
        item2.folder_id = Some("folder-2".into());
        let item3 = make_login("C", "u", "p", "https://c.com"); // No folder

        let items = vec![item1, item2, item3];
        let result = filter_by_folder(&items, Some("folder-1"));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "A");
    }

    #[test]
    fn filter_by_folder_none() {
        let mut item1 = make_login("A", "u", "p", "https://a.com");
        item1.folder_id = Some("folder-1".into());
        let item2 = make_login("B", "u", "p", "https://b.com");

        let items = vec![item1, item2];
        let result = filter_by_folder(&items, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "B");
    }

    // ── password health ─────────────────────────────────────────────

    #[test]
    fn check_weak_password() {
        assert!(check_password_weakness("1234567")); // too short
        assert!(check_password_weakness("abcdefgh")); // all lowercase
        assert!(!check_password_weakness("MyP@ssw0rd!123")); // strong
    }

    #[test]
    fn password_strength_empty() {
        assert_eq!(password_strength_score(""), 0);
    }

    #[test]
    fn password_strength_weak() {
        assert!(password_strength_score("pass") <= 1);
    }

    #[test]
    fn password_strength_strong() {
        assert!(password_strength_score("MyP@ssw0rd!IsVeryL0ng") >= 3);
    }

    #[test]
    fn analyze_health_detects_reuse() {
        let items = vec![
            make_login("Site1", "u", "same_password", "https://a.com"),
            make_login("Site2", "u2", "same_password", "https://b.com"),
        ];

        let reports = analyze_password_health(&items);
        assert_eq!(reports.len(), 2);
        assert!(reports[0].is_reused);
        assert!(reports[1].is_reused);
    }

    #[test]
    fn analyze_health_detects_weak() {
        let items = vec![
            make_login("Weak", "u", "abc", "https://a.com"),
            make_login("Strong", "u", "MyStr0ng!P@ssword", "https://b.com"),
        ];

        let reports = analyze_password_health(&items);
        let weak = reports.iter().find(|r| r.item_name == "Weak").unwrap();
        let strong = reports.iter().find(|r| r.item_name == "Strong").unwrap();
        assert!(weak.is_weak);
        assert!(!strong.is_weak);
    }

    // ── sorting ─────────────────────────────────────────────────────

    #[test]
    fn sort_by_name_ascending() {
        let mut items = vec![
            make_login("Zeta", "u", "p", "https://a.com"),
            make_login("Alpha", "u", "p", "https://b.com"),
            make_login("Mike", "u", "p", "https://c.com"),
        ];

        sort_items(&mut items, SortBy::Name, true);
        assert_eq!(items[0].name, "Alpha");
        assert_eq!(items[1].name, "Mike");
        assert_eq!(items[2].name, "Zeta");
    }

    #[test]
    fn sort_by_name_descending() {
        let mut items = vec![
            make_login("Alpha", "u", "p", "https://a.com"),
            make_login("Zeta", "u", "p", "https://b.com"),
        ];

        sort_items(&mut items, SortBy::Name, false);
        assert_eq!(items[0].name, "Zeta");
        assert_eq!(items[1].name, "Alpha");
    }

    #[test]
    fn sort_by_type() {
        let mut items = vec![
            VaultItem::new_secure_note("Note", "n"),
            make_login("Login", "u", "p", "https://a.com"),
            VaultItem::new_card("Card", CardData::default()),
        ];

        sort_items(&mut items, SortBy::ItemType, true);
        assert_eq!(items[0].item_type, 1); // Login
        assert_eq!(items[1].item_type, 2); // SecureNote
        assert_eq!(items[2].item_type, 3); // Card
    }

    // ── duplicates ──────────────────────────────────────────────────

    #[test]
    fn find_duplicates_same_user_domain() {
        let items = vec![
            make_login("GH 1", "user@example.com", "p1", "https://github.com/login"),
            make_login("GH 2", "user@example.com", "p2", "https://github.com/auth"),
        ];

        let dupes = find_duplicates(&items);
        assert_eq!(dupes.len(), 1);
    }

    #[test]
    fn find_duplicates_different_user() {
        let items = vec![
            make_login("GH 1", "user1@example.com", "p1", "https://github.com"),
            make_login("GH 2", "user2@example.com", "p2", "https://github.com"),
        ];

        let dupes = find_duplicates(&items);
        assert_eq!(dupes.len(), 0);
    }

    #[test]
    fn find_duplicates_different_domain() {
        let items = vec![
            make_login("Site 1", "user@example.com", "p1", "https://github.com"),
            make_login("Site 2", "user@example.com", "p2", "https://gitlab.com"),
        ];

        let dupes = find_duplicates(&items);
        assert_eq!(dupes.len(), 0);
    }
}

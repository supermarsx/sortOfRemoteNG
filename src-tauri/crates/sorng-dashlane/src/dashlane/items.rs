use crate::dashlane::types::{
    CredentialFilter, DashlaneCredential, DashlaneError, CreateCredentialRequest,
    UpdateCredentialRequest,
};

/// Filter credentials based on various criteria.
pub fn filter_credentials(
    credentials: &[DashlaneCredential],
    filter: &CredentialFilter,
) -> Vec<DashlaneCredential> {
    let mut result: Vec<DashlaneCredential> = credentials
        .iter()
        .filter(|c| {
            if let Some(ref q) = filter.query {
                let q_lower = q.to_lowercase();
                let matches = c.title.to_lowercase().contains(&q_lower)
                    || c.url.to_lowercase().contains(&q_lower)
                    || c.login.to_lowercase().contains(&q_lower);
                if !matches {
                    return false;
                }
            }
            if let Some(ref cat) = filter.category {
                if c.category.as_deref() != Some(cat.as_str()) {
                    return false;
                }
            }
            if let Some(compromised_only) = filter.compromised_only {
                if compromised_only && !c.compromised {
                    return false;
                }
            }
            if let Some(reused_only) = filter.reused_only {
                if reused_only && !c.reused {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect();

    if let Some(ref sort_by) = filter.sort_by {
        match sort_by.as_str() {
            "title" => result.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase())),
            "url" => result.sort_by(|a, b| a.url.to_lowercase().cmp(&b.url.to_lowercase())),
            "modified" => result.sort_by(|a, b| b.modified_at.cmp(&a.modified_at)),
            "last_used" => result.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at)),
            _ => {}
        }
    }

    if let Some(limit) = filter.limit {
        result.truncate(limit);
    }

    result
}

/// Find a credential by ID.
pub fn find_by_id<'a>(
    credentials: &'a [DashlaneCredential],
    id: &str,
) -> Option<&'a DashlaneCredential> {
    credentials.iter().find(|c| c.id == id)
}

/// Find credentials by URL (domain match).
pub fn find_by_url(credentials: &[DashlaneCredential], url: &str) -> Vec<DashlaneCredential> {
    let domain = extract_domain(url);
    credentials
        .iter()
        .filter(|c| {
            let c_domain = extract_domain(&c.url);
            c_domain == domain
        })
        .cloned()
        .collect()
}

/// Find credentials by title.
pub fn find_by_title(credentials: &[DashlaneCredential], title: &str) -> Vec<DashlaneCredential> {
    let lower = title.to_lowercase();
    credentials
        .iter()
        .filter(|c| c.title.to_lowercase().contains(&lower))
        .cloned()
        .collect()
}

/// Find credentials with duplicate passwords.
pub fn find_duplicates(credentials: &[DashlaneCredential]) -> Vec<Vec<DashlaneCredential>> {
    use std::collections::HashMap;
    let mut password_map: HashMap<&str, Vec<&DashlaneCredential>> = HashMap::new();

    for cred in credentials {
        if !cred.password.is_empty() {
            password_map.entry(cred.password.as_str()).or_default().push(cred);
        }
    }

    password_map
        .into_values()
        .filter(|group| group.len() > 1)
        .map(|group| group.into_iter().cloned().collect())
        .collect()
}

/// Prepare a new credential from a create request.
pub fn prepare_credential(req: &CreateCredentialRequest) -> DashlaneCredential {
    let now = chrono::Utc::now().to_rfc3339();
    DashlaneCredential {
        id: uuid::Uuid::new_v4().to_string(),
        title: req.title.clone(),
        url: req.url.clone().unwrap_or_default(),
        login: req.login.clone(),
        secondary_login: req.secondary_login.clone(),
        password: req.password.clone(),
        notes: req.notes.clone(),
        category: req.category.clone(),
        auto_login: req.auto_login.unwrap_or(false),
        auto_protect: req.auto_protect.unwrap_or(false),
        otp_secret: req.otp_secret.clone(),
        otp_url: None,
        linked_services: Vec::new(),
        created_at: Some(now.clone()),
        modified_at: Some(now),
        last_used_at: None,
        password_strength: None,
        compromised: false,
        reused: false,
    }
}

/// Apply an update request to an existing credential.
pub fn apply_update(
    credential: &mut DashlaneCredential,
    req: &UpdateCredentialRequest,
) -> Result<(), DashlaneError> {
    if let Some(ref title) = req.title {
        credential.title = title.clone();
    }
    if let Some(ref url) = req.url {
        credential.url = url.clone();
    }
    if let Some(ref login) = req.login {
        credential.login = login.clone();
    }
    if let Some(ref password) = req.password {
        credential.password = password.clone();
    }
    if let Some(ref notes) = req.notes {
        credential.notes = Some(notes.clone());
    }
    if let Some(ref category) = req.category {
        credential.category = Some(category.clone());
    }
    if let Some(auto_login) = req.auto_login {
        credential.auto_login = auto_login;
    }
    credential.modified_at = Some(chrono::Utc::now().to_rfc3339());
    Ok(())
}

/// Get all unique categories.
pub fn get_categories(credentials: &[DashlaneCredential]) -> Vec<String> {
    let mut cats: Vec<String> = credentials
        .iter()
        .filter_map(|c| c.category.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    cats.sort();
    cats
}

/// Count credentials by category.
pub fn count_by_category(credentials: &[DashlaneCredential]) -> Vec<(String, usize)> {
    use std::collections::HashMap;
    let mut map: HashMap<String, usize> = HashMap::new();
    for cred in credentials {
        let cat = cred.category.clone().unwrap_or_else(|| "Uncategorized".into());
        *map.entry(cat).or_default() += 1;
    }
    let mut result: Vec<_> = map.into_iter().collect();
    result.sort_by(|a, b| b.1.cmp(&a.1));
    result
}

fn extract_domain(url: &str) -> String {
    let url = url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.");
    url.split('/').next().unwrap_or(url).to_lowercase()
}

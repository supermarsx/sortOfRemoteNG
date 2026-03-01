use crate::dashlane::types::{DashlaneError, DashlaneIdentity, DashlaneAddress};

/// Search identities by query.
pub fn search_identities(identities: &[DashlaneIdentity], query: &str) -> Vec<DashlaneIdentity> {
    let lower = query.to_lowercase();
    identities
        .iter()
        .filter(|i| {
            i.first_name.to_lowercase().contains(&lower)
                || i.last_name.to_lowercase().contains(&lower)
                || i.email.as_deref().unwrap_or("").to_lowercase().contains(&lower)
        })
        .cloned()
        .collect()
}

/// Find an identity by ID.
pub fn find_identity_by_id<'a>(
    identities: &'a [DashlaneIdentity],
    id: &str,
) -> Option<&'a DashlaneIdentity> {
    identities.iter().find(|i| i.id == id)
}

/// Get the full display name of an identity.
pub fn get_display_name(identity: &DashlaneIdentity) -> String {
    let mut parts = Vec::new();
    if let Some(ref title) = identity.title {
        parts.push(title.clone());
    }
    parts.push(identity.first_name.clone());
    if let Some(ref middle) = identity.middle_name {
        parts.push(middle.clone());
    }
    parts.push(identity.last_name.clone());
    parts.join(" ")
}

/// Create a new identity.
pub fn create_identity(
    first_name: String,
    last_name: String,
    email: Option<String>,
    phone: Option<String>,
) -> DashlaneIdentity {
    let now = chrono::Utc::now().to_rfc3339();
    DashlaneIdentity {
        id: uuid::Uuid::new_v4().to_string(),
        first_name,
        middle_name: None,
        last_name,
        title: None,
        email,
        phone,
        date_of_birth: None,
        address: None,
        created_at: Some(now.clone()),
        modified_at: Some(now),
    }
}

/// Update an existing identity.
pub fn update_identity(
    identity: &mut DashlaneIdentity,
    first_name: Option<String>,
    last_name: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    address: Option<DashlaneAddress>,
) {
    if let Some(f) = first_name {
        identity.first_name = f;
    }
    if let Some(l) = last_name {
        identity.last_name = l;
    }
    if let Some(e) = email {
        identity.email = Some(e);
    }
    if let Some(p) = phone {
        identity.phone = Some(p);
    }
    if let Some(a) = address {
        identity.address = Some(a);
    }
    identity.modified_at = Some(chrono::Utc::now().to_rfc3339());
}

/// Format an address as a single string.
pub fn format_address(address: &DashlaneAddress) -> String {
    let mut parts = Vec::new();
    parts.push(address.street.clone());
    if let Some(ref line2) = address.street2 {
        parts.push(line2.clone());
    }
    let city_state = format!(
        "{}, {} {}",
        address.city,
        address.state.as_deref().unwrap_or(""),
        address.zip_code.as_deref().unwrap_or("")
    )
    .trim()
    .to_string();
    parts.push(city_state);
    parts.push(address.country.clone());
    parts.join("\n")
}

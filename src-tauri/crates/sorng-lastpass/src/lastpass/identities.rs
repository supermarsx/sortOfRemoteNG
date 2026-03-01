use crate::lastpass::types::{Identity, LastPassError};

/// Parse an identity from a secure note's structured content.
pub fn parse_identity_from_note(content: &str) -> Identity {
    let mut identity = Identity {
        id: String::new(),
        title: None,
        first_name: None,
        middle_name: None,
        last_name: None,
        email: None,
        phone: None,
        mobile_phone: None,
        address1: None,
        address2: None,
        city: None,
        state: None,
        zip: None,
        country: None,
        company: None,
        username: None,
        birthday: None,
        gender: None,
        ssn: None,
        timezone: None,
        notes: None,
    };

    for line in content.lines() {
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim().to_lowercase();
            let value = value.trim().to_string();
            if value.is_empty() {
                continue;
            }
            match key.as_str() {
                "title" => identity.title = Some(value),
                "firstname" | "first_name" | "first name" => identity.first_name = Some(value),
                "middlename" | "middle_name" | "middle name" => identity.middle_name = Some(value),
                "lastname" | "last_name" | "last name" => identity.last_name = Some(value),
                "email" | "email1" => identity.email = Some(value),
                "phone" | "phone1" | "homephone" => identity.phone = Some(value),
                "mobilephone" | "cellphone" | "mobile" => identity.mobile_phone = Some(value),
                "address" | "address1" => identity.address1 = Some(value),
                "address2" => identity.address2 = Some(value),
                "city" => identity.city = Some(value),
                "state" => identity.state = Some(value),
                "zip" | "zipcode" | "postalcode" => identity.zip = Some(value),
                "country" => identity.country = Some(value),
                "company" | "organization" => identity.company = Some(value),
                "username" => identity.username = Some(value),
                "birthday" | "birthdate" | "dob" => identity.birthday = Some(value),
                "gender" | "sex" => identity.gender = Some(value),
                "ssn" | "socialsecuritynumber" => identity.ssn = Some(value),
                "timezone" => identity.timezone = Some(value),
                "notes" => identity.notes = Some(value),
                _ => {}
            }
        }
    }

    identity
}

/// Search identities by name or email.
pub fn search_identities(identities: &[Identity], query: &str) -> Vec<Identity> {
    let query_lower = query.to_lowercase();
    identities
        .iter()
        .filter(|i| {
            let matches_name = i
                .first_name
                .as_ref()
                .map(|n| n.to_lowercase().contains(&query_lower))
                .unwrap_or(false)
                || i.last_name
                    .as_ref()
                    .map(|n| n.to_lowercase().contains(&query_lower))
                    .unwrap_or(false);
            let matches_email = i
                .email
                .as_ref()
                .map(|e| e.to_lowercase().contains(&query_lower))
                .unwrap_or(false);
            let matches_company = i
                .company
                .as_ref()
                .map(|c| c.to_lowercase().contains(&query_lower))
                .unwrap_or(false);
            matches_name || matches_email || matches_company
        })
        .cloned()
        .collect()
}

/// Get the full name from an identity.
pub fn get_full_name(identity: &Identity) -> String {
    let parts: Vec<&str> = [
        identity.title.as_deref(),
        identity.first_name.as_deref(),
        identity.middle_name.as_deref(),
        identity.last_name.as_deref(),
    ]
    .iter()
    .filter_map(|p| *p)
    .collect();

    parts.join(" ")
}

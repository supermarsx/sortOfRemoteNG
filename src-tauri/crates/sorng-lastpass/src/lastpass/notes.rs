use crate::lastpass::types::{SecureNote, SecureNoteType, CustomField, LastPassError};

/// Determine the secure note type from its content/metadata.
pub fn detect_note_type(content: &str, name: &str) -> SecureNoteType {
    let content_lower = content.to_lowercase();
    let name_lower = name.to_lowercase();

    if content_lower.contains("hostname:") && content_lower.contains("port:") {
        SecureNoteType::ServerCredentials
    } else if content_lower.contains("database_type:") || content_lower.contains("dbname:") {
        SecureNoteType::Database
    } else if content_lower.contains("license_key:") || content_lower.contains("licensekey:") {
        SecureNoteType::SoftwareLicense
    } else if content_lower.contains("ssh") || content_lower.contains("private_key:") {
        SecureNoteType::SshKey
    } else if content_lower.contains("ssid:") || name_lower.contains("wifi") {
        SecureNoteType::WifiPassword
    } else if content_lower.contains("ccnum:") || content_lower.contains("cardnumber:") {
        SecureNoteType::CreditCard
    } else if content_lower.contains("routing:") || content_lower.contains("bankname:") {
        SecureNoteType::BankAccount
    } else if content_lower.contains("dlnum:") || name_lower.contains("driver") {
        SecureNoteType::DriversLicense
    } else if content_lower.contains("passportnumber:") || name_lower.contains("passport") {
        SecureNoteType::Passport
    } else if content_lower.contains("policynumber:") || name_lower.contains("insurance") {
        SecureNoteType::Insurance
    } else if content_lower.contains("membership") {
        SecureNoteType::Membership
    } else {
        SecureNoteType::Generic
    }
}

/// Parse structured fields from a secure note's content.
/// LastPass secure notes use "NoteType:xxx\nField:value\n..." format.
pub fn parse_note_fields(content: &str) -> Vec<CustomField> {
    let mut fields = Vec::new();

    for line in content.lines() {
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim();
            if !key.is_empty() && key != "NoteType" && key != "Language" {
                fields.push(CustomField {
                    name: key.to_string(),
                    value: value.to_string(),
                    field_type: if key.to_lowercase().contains("password")
                        || key.to_lowercase().contains("pin")
                    {
                        crate::lastpass::types::CustomFieldType::Password
                    } else if key.to_lowercase().contains("email") {
                        crate::lastpass::types::CustomFieldType::Email
                    } else if key.to_lowercase().contains("phone") || key.to_lowercase().contains("tel") {
                        crate::lastpass::types::CustomFieldType::Tel
                    } else if key.to_lowercase().contains("notes") || value.contains('\n') {
                        crate::lastpass::types::CustomFieldType::Textarea
                    } else {
                        crate::lastpass::types::CustomFieldType::Text
                    },
                });
            }
        }
    }

    fields
}

/// Filter secure notes by type.
pub fn filter_by_type(notes: &[SecureNote], note_type: &SecureNoteType) -> Vec<SecureNote> {
    notes
        .iter()
        .filter(|n| &n.note_type == note_type)
        .cloned()
        .collect()
}

/// Find a secure note by name (case-insensitive).
pub fn find_by_name(notes: &[SecureNote], name: &str) -> Option<SecureNote> {
    let name_lower = name.to_lowercase();
    notes
        .iter()
        .find(|n| n.name.to_lowercase() == name_lower)
        .cloned()
}

/// Search secure notes by content.
pub fn search_notes(notes: &[SecureNote], query: &str) -> Vec<SecureNote> {
    let query_lower = query.to_lowercase();
    notes
        .iter()
        .filter(|n| {
            n.name.to_lowercase().contains(&query_lower)
                || n.content.to_lowercase().contains(&query_lower)
        })
        .cloned()
        .collect()
}

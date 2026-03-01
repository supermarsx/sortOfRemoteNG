use super::types::*;

/// Item category helpers and metadata.
pub struct OnePasswordCategories;

impl OnePasswordCategories {
    /// Get all supported item categories.
    pub fn all() -> Vec<ItemCategory> {
        vec![
            ItemCategory::LOGIN,
            ItemCategory::PASSWORD,
            ItemCategory::API_CREDENTIAL,
            ItemCategory::SERVER,
            ItemCategory::DATABASE,
            ItemCategory::CREDIT_CARD,
            ItemCategory::MEMBERSHIP,
            ItemCategory::PASSPORT,
            ItemCategory::SOFTWARE_LICENSE,
            ItemCategory::OUTDOOR_LICENSE,
            ItemCategory::SECURE_NOTE,
            ItemCategory::WIRELESS_ROUTER,
            ItemCategory::BANK_ACCOUNT,
            ItemCategory::DRIVER_LICENSE,
            ItemCategory::IDENTITY,
            ItemCategory::REWARD_PROGRAM,
            ItemCategory::DOCUMENT,
            ItemCategory::EMAIL_ACCOUNT,
            ItemCategory::SOCIAL_SECURITY_NUMBER,
            ItemCategory::MEDICAL_RECORD,
            ItemCategory::SSH_KEY,
            ItemCategory::CUSTOM,
        ]
    }

    /// Get the default fields for a given category.
    pub fn default_fields(category: &ItemCategory) -> Vec<Field> {
        match category {
            ItemCategory::LOGIN => vec![
                Self::field("username", FieldType::STRING, Some(FieldPurpose::USERNAME)),
                Self::field("password", FieldType::CONCEALED, Some(FieldPurpose::PASSWORD)),
                Self::field("notesPlain", FieldType::STRING, Some(FieldPurpose::NOTES)),
            ],
            ItemCategory::PASSWORD => vec![
                Self::field("password", FieldType::CONCEALED, Some(FieldPurpose::PASSWORD)),
                Self::field("notesPlain", FieldType::STRING, Some(FieldPurpose::NOTES)),
            ],
            ItemCategory::API_CREDENTIAL => vec![
                Self::field("username", FieldType::STRING, Some(FieldPurpose::USERNAME)),
                Self::field("credential", FieldType::CONCEALED, None),
                Self::field("type", FieldType::STRING, None),
                Self::field("filename", FieldType::STRING, None),
            ],
            ItemCategory::SERVER => vec![
                Self::field("url", FieldType::URL, None),
                Self::field("username", FieldType::STRING, Some(FieldPurpose::USERNAME)),
                Self::field("password", FieldType::CONCEALED, Some(FieldPurpose::PASSWORD)),
            ],
            ItemCategory::DATABASE => vec![
                Self::field("type", FieldType::MENU, None),
                Self::field("hostname", FieldType::STRING, None),
                Self::field("port", FieldType::STRING, None),
                Self::field("database", FieldType::STRING, None),
                Self::field("username", FieldType::STRING, Some(FieldPurpose::USERNAME)),
                Self::field("password", FieldType::CONCEALED, Some(FieldPurpose::PASSWORD)),
            ],
            ItemCategory::SSH_KEY => vec![
                Self::field("private_key", FieldType::CONCEALED, None),
                Self::field("public_key", FieldType::STRING, None),
                Self::field("fingerprint", FieldType::STRING, None),
                Self::field("key_type", FieldType::STRING, None),
            ],
            ItemCategory::SECURE_NOTE => vec![
                Self::field("notesPlain", FieldType::STRING, Some(FieldPurpose::NOTES)),
            ],
            _ => vec![
                Self::field("notesPlain", FieldType::STRING, Some(FieldPurpose::NOTES)),
            ],
        }
    }

    /// Get a human-readable label for a category.
    pub fn label(category: &ItemCategory) -> &'static str {
        match category {
            ItemCategory::LOGIN => "Login",
            ItemCategory::PASSWORD => "Password",
            ItemCategory::API_CREDENTIAL => "API Credential",
            ItemCategory::SERVER => "Server",
            ItemCategory::DATABASE => "Database",
            ItemCategory::CREDIT_CARD => "Credit Card",
            ItemCategory::MEMBERSHIP => "Membership",
            ItemCategory::PASSPORT => "Passport",
            ItemCategory::SOFTWARE_LICENSE => "Software License",
            ItemCategory::OUTDOOR_LICENSE => "Outdoor License",
            ItemCategory::SECURE_NOTE => "Secure Note",
            ItemCategory::WIRELESS_ROUTER => "Wireless Router",
            ItemCategory::BANK_ACCOUNT => "Bank Account",
            ItemCategory::DRIVER_LICENSE => "Driver License",
            ItemCategory::IDENTITY => "Identity",
            ItemCategory::REWARD_PROGRAM => "Reward Program",
            ItemCategory::DOCUMENT => "Document",
            ItemCategory::EMAIL_ACCOUNT => "Email Account",
            ItemCategory::SOCIAL_SECURITY_NUMBER => "Social Security Number",
            ItemCategory::MEDICAL_RECORD => "Medical Record",
            ItemCategory::SSH_KEY => "SSH Key",
            ItemCategory::CUSTOM => "Custom",
        }
    }

    /// Get the icon name for a category.
    pub fn icon(category: &ItemCategory) -> &'static str {
        match category {
            ItemCategory::LOGIN => "key",
            ItemCategory::PASSWORD => "lock",
            ItemCategory::API_CREDENTIAL => "code",
            ItemCategory::SERVER => "server",
            ItemCategory::DATABASE => "database",
            ItemCategory::CREDIT_CARD => "credit-card",
            ItemCategory::MEMBERSHIP => "id-card",
            ItemCategory::PASSPORT => "passport",
            ItemCategory::SOFTWARE_LICENSE => "license",
            ItemCategory::SECURE_NOTE => "note",
            ItemCategory::SSH_KEY => "terminal",
            ItemCategory::IDENTITY => "user",
            _ => "file",
        }
    }

    fn field(id: &str, field_type: FieldType, purpose: Option<FieldPurpose>) -> Field {
        Field {
            id: id.to_string(),
            section: None,
            field_type,
            purpose,
            label: Some(id.to_string()),
            value: None,
            generate: None,
            recipe: None,
            entropy: None,
        }
    }
}

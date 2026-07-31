use crate::dashlane::types::{
    DashlaneCredential, DashlaneError, ExportFormat, ExportResult, ImportResult, ImportSource,
    SecureNote,
};

const MAX_EXPORT_ITEMS: usize = 10_000;
const MAX_EXPORT_BYTES: usize = 16 * 1024 * 1024;
const MAX_FIELD_BYTES: usize = 64 * 1024;

pub fn export_csv(credentials: &[DashlaneCredential]) -> Result<ExportResult, DashlaneError> {
    validate_credentials(credentials)?;
    let mut data = String::from("title,url,username,username2,password,note,category,otpsecret\n");
    for credential in credentials {
        let fields = [
            credential.title.as_str(),
            credential.url.as_str(),
            credential.login.as_str(),
            credential.secondary_login.as_deref().unwrap_or(""),
            credential.password.as_str(),
            credential.notes.as_deref().unwrap_or(""),
            credential.category.as_deref().unwrap_or(""),
            credential.otp_secret.as_deref().unwrap_or(""),
        ];
        for (index, field) in fields.iter().enumerate() {
            if index > 0 {
                data.push(',');
            }
            data.push_str(&csv_escape(field));
        }
        data.push('\n');
        if data.len() > MAX_EXPORT_BYTES {
            return Err(DashlaneError::ExportFailed(
                "Export exceeds the allowed size".into(),
            ));
        }
    }
    Ok(ExportResult {
        format: ExportFormat::Csv,
        data,
        item_count: credentials.len(),
    })
}

pub fn export_json(credentials: &[DashlaneCredential]) -> Result<ExportResult, DashlaneError> {
    validate_credentials(credentials)?;
    let data = serde_json::to_string(credentials)
        .map_err(|_| DashlaneError::ExportFailed("Could not serialize export".into()))?;
    if data.len() > MAX_EXPORT_BYTES {
        return Err(DashlaneError::ExportFailed(
            "Export exceeds the allowed size".into(),
        ));
    }
    Ok(ExportResult {
        format: ExportFormat::Json,
        data,
        item_count: credentials.len(),
    })
}

pub fn import_dashlane_csv(_csv_content: &str) -> Result<ImportResult, DashlaneError> {
    Err(import_unavailable(ImportSource::DashlaneCsv))
}

pub fn import_1password_csv(_csv_content: &str) -> Result<ImportResult, DashlaneError> {
    Err(import_unavailable(ImportSource::OnePasswordCsv))
}

pub fn import_lastpass_csv(_csv_content: &str) -> Result<ImportResult, DashlaneError> {
    Err(import_unavailable(ImportSource::LastPassCsv))
}

pub fn import_chrome_csv(_csv_content: &str) -> Result<ImportResult, DashlaneError> {
    Err(import_unavailable(ImportSource::ChromeCsv))
}

pub fn export_notes_json(notes: &[SecureNote]) -> Result<ExportResult, DashlaneError> {
    if notes.len() > MAX_EXPORT_ITEMS
        || notes.iter().any(|note| {
            note.title.len() > MAX_FIELD_BYTES
                || note.content.len() > MAX_FIELD_BYTES
                || note
                    .category
                    .as_ref()
                    .is_some_and(|value| value.len() > MAX_FIELD_BYTES)
        })
    {
        return Err(DashlaneError::ExportFailed(
            "Notes export exceeds the allowed size".into(),
        ));
    }
    let data = serde_json::to_string(notes)
        .map_err(|_| DashlaneError::ExportFailed("Could not serialize export".into()))?;
    if data.len() > MAX_EXPORT_BYTES {
        return Err(DashlaneError::ExportFailed(
            "Export exceeds the allowed size".into(),
        ));
    }
    Ok(ExportResult {
        format: ExportFormat::Json,
        data,
        item_count: notes.len(),
    })
}

fn validate_credentials(credentials: &[DashlaneCredential]) -> Result<(), DashlaneError> {
    if credentials.len() > MAX_EXPORT_ITEMS {
        return Err(DashlaneError::ExportFailed(
            "Too many credentials to export".into(),
        ));
    }
    if credentials.iter().any(|credential| {
        [
            credential.title.as_str(),
            credential.url.as_str(),
            credential.login.as_str(),
            credential.secondary_login.as_deref().unwrap_or(""),
            credential.password.as_str(),
            credential.notes.as_deref().unwrap_or(""),
            credential.category.as_deref().unwrap_or(""),
            credential.otp_secret.as_deref().unwrap_or(""),
        ]
        .iter()
        .any(|field| field.len() > MAX_FIELD_BYTES)
    }) {
        return Err(DashlaneError::ExportFailed(
            "Credential field exceeds the allowed size".into(),
        ));
    }
    Ok(())
}

fn csv_escape(value: &str) -> String {
    let formula_risk = matches!(
        value.trim_start().chars().next(),
        Some('=' | '+' | '-' | '@' | '\t' | '\r')
    );
    let mut safe = if formula_risk {
        format!("'{}", value)
    } else {
        value.to_string()
    };
    if safe.contains(',') || safe.contains('"') || safe.contains('\n') || safe.contains('\r') {
        safe = format!("\"{}\"", safe.replace('"', "\"\""));
    }
    safe
}

fn import_unavailable(source: ImportSource) -> DashlaneError {
    DashlaneError::unsupported(format!(
        "{:?} import is unavailable because vault persistence is not implemented",
        source
    ))
}

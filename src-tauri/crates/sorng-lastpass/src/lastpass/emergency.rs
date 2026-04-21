use crate::lastpass::types::{
    EmergencyAccessLevel, EmergencyContact, EmergencyContactStatus, LastPassError,
};

/// Filter emergency contacts by status.
pub fn filter_by_status(
    contacts: &[EmergencyContact],
    status: &EmergencyContactStatus,
) -> Vec<EmergencyContact> {
    contacts
        .iter()
        .filter(|c| &c.status == status)
        .cloned()
        .collect()
}

/// Get active emergency contacts (accepted or pending).
pub fn get_active_contacts(contacts: &[EmergencyContact]) -> Vec<EmergencyContact> {
    contacts
        .iter()
        .filter(|c| {
            c.status == EmergencyContactStatus::Accepted
                || c.status == EmergencyContactStatus::Pending
                || c.status == EmergencyContactStatus::Approved
        })
        .cloned()
        .collect()
}

/// Create a new emergency contact request.
pub fn create_emergency_request(
    email: &str,
    wait_time_days: u32,
    access_level: EmergencyAccessLevel,
) -> EmergencyContact {
    EmergencyContact {
        id: String::new(),
        email: email.to_string(),
        status: EmergencyContactStatus::Invited,
        wait_time_days,
        access_level,
        created_at: Some(chrono::Utc::now().to_rfc3339()),
    }
}

/// Validate emergency access wait time (must be 0-30 days).
pub fn validate_wait_time(days: u32) -> Result<(), LastPassError> {
    if days > 30 {
        return Err(LastPassError::new(
            crate::lastpass::types::LastPassErrorKind::BadRequest,
            "Emergency access wait time must be between 0 and 30 days",
        ));
    }
    Ok(())
}

/// Check if the user has any approved emergency access.
pub fn has_approved_access(contacts: &[EmergencyContact]) -> bool {
    contacts
        .iter()
        .any(|c| c.status == EmergencyContactStatus::Approved)
}

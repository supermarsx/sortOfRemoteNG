use super::output_state::{record_input_entry, record_output_entry, record_resize_entry};

// ===============================
// Internal recording helpers
// ===============================

/// Add output data to an active recording (internal helper)
pub fn record_output(session_id: &str, data: &str) {
    record_output_entry(session_id, data);
}

/// Add input data to an active recording (internal helper)
pub fn record_input(session_id: &str, data: &str) {
    record_input_entry(session_id, data);
}

/// Record a resize event
pub fn record_resize(session_id: &str, cols: u32, rows: u32) {
    record_resize_entry(session_id, cols, rows);
}

// ===============================
// Tauri commands for recording
// ===============================

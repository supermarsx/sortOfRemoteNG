//! File operations — upload and download files via Bot API.

use crate::types::*;
use serde_json::json;

/// Build the JSON body for `getFile`.
pub fn build_get_file(file_id: &str) -> serde_json::Value {
    json!({ "file_id": file_id })
}

/// Metadata for a file upload via multipart.
#[derive(Debug, Clone)]
pub struct FileUpload {
    /// The field name in the multipart form (e.g. "photo", "document").
    pub field_name: String,
    /// File name with extension.
    pub file_name: String,
    /// MIME type.
    pub mime_type: String,
    /// Raw file bytes.
    pub data: Vec<u8>,
}

/// Build a multipart form for file upload alongside text parameters.
pub fn build_upload_form(
    chat_id: &ChatId,
    upload: &FileUpload,
    caption: Option<&str>,
    parse_mode: Option<&ParseMode>,
    disable_notification: bool,
    reply_to_message_id: Option<i64>,
) -> Result<reqwest::multipart::Form, String> {
    let mut form = reqwest::multipart::Form::new()
        .text("chat_id", chat_id.to_string());

    let part = reqwest::multipart::Part::bytes(upload.data.clone())
        .file_name(upload.file_name.clone())
        .mime_str(&upload.mime_type)
        .map_err(|e| format!("Invalid MIME type: {e}"))?;

    form = form.part(upload.field_name.clone(), part);

    if let Some(c) = caption {
        form = form.text("caption", c.to_string());
    }
    if let Some(pm) = parse_mode {
        let pm_str = match pm {
            ParseMode::Markdown => "Markdown",
            ParseMode::MarkdownV2 => "MarkdownV2",
            ParseMode::Html => "HTML",
        };
        form = form.text("parse_mode", pm_str.to_string());
    }
    if disable_notification {
        form = form.text("disable_notification", "true".to_string());
    }
    if let Some(mid) = reply_to_message_id {
        form = form.text("reply_to_message_id", mid.to_string());
    }

    Ok(form)
}

/// Determine the Bot API method name based on file field.
pub fn upload_method_for_field(field_name: &str) -> &str {
    match field_name {
        "photo" => "sendPhoto",
        "document" => "sendDocument",
        "video" => "sendVideo",
        "audio" => "sendAudio",
        "voice" => "sendVoice",
        "video_note" => "sendVideoNote",
        "animation" => "sendAnimation",
        "sticker" => "sendSticker",
        _ => "sendDocument", // fallback
    }
}

/// Guess MIME type from file extension.
pub fn guess_mime_type(file_name: &str) -> &str {
    let ext = file_name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "gzip" => "application/gzip",
        "tar" => "application/x-tar",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/x-rar-compressed",
        "txt" => "text/plain",
        "json" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "js" => "application/javascript",
        "css" => "text/css",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

/// Determine the appropriate upload field based on MIME type.
pub fn field_for_mime(mime: &str) -> &str {
    if mime.starts_with("image/") {
        if mime == "image/gif" {
            "animation"
        } else {
            "photo"
        }
    } else if mime.starts_with("video/") {
        "video"
    } else if mime.starts_with("audio/") {
        if mime == "audio/ogg" {
            "voice"
        } else {
            "audio"
        }
    } else {
        "document"
    }
}

/// Human-readable file size string.
pub fn format_file_size(bytes: i64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;

    let b = bytes as f64;
    if b < KB {
        format!("{} B", bytes)
    } else if b < MB {
        format!("{:.1} KB", b / KB)
    } else if b < GB {
        format!("{:.1} MB", b / MB)
    } else {
        format!("{:.2} GB", b / GB)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_file_json() {
        let body = build_get_file("AgACAgI...");
        assert_eq!(body["file_id"], "AgACAgI...");
    }

    #[test]
    fn upload_method_mapping() {
        assert_eq!(upload_method_for_field("photo"), "sendPhoto");
        assert_eq!(upload_method_for_field("document"), "sendDocument");
        assert_eq!(upload_method_for_field("video"), "sendVideo");
        assert_eq!(upload_method_for_field("audio"), "sendAudio");
        assert_eq!(upload_method_for_field("voice"), "sendVoice");
        assert_eq!(upload_method_for_field("animation"), "sendAnimation");
        assert_eq!(upload_method_for_field("sticker"), "sendSticker");
        assert_eq!(upload_method_for_field("unknown"), "sendDocument");
    }

    #[test]
    fn mime_type_guessing() {
        assert_eq!(guess_mime_type("photo.jpg"), "image/jpeg");
        assert_eq!(guess_mime_type("photo.JPEG"), "image/jpeg");
        assert_eq!(guess_mime_type("photo.png"), "image/png");
        assert_eq!(guess_mime_type("doc.pdf"), "application/pdf");
        assert_eq!(guess_mime_type("video.mp4"), "video/mp4");
        assert_eq!(guess_mime_type("song.mp3"), "audio/mpeg");
        assert_eq!(guess_mime_type("archive.zip"), "application/zip");
        assert_eq!(guess_mime_type("data.csv"), "text/csv");
        assert_eq!(guess_mime_type("unknown"), "application/octet-stream");
        assert_eq!(guess_mime_type("file.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    }

    #[test]
    fn field_for_mime_mapping() {
        assert_eq!(field_for_mime("image/jpeg"), "photo");
        assert_eq!(field_for_mime("image/png"), "photo");
        assert_eq!(field_for_mime("image/gif"), "animation");
        assert_eq!(field_for_mime("video/mp4"), "video");
        assert_eq!(field_for_mime("audio/mpeg"), "audio");
        assert_eq!(field_for_mime("audio/ogg"), "voice");
        assert_eq!(field_for_mime("application/pdf"), "document");
        assert_eq!(field_for_mime("text/plain"), "document");
    }

    #[test]
    fn file_size_formatting() {
        assert_eq!(format_file_size(0), "0 B");
        assert_eq!(format_file_size(512), "512 B");
        assert_eq!(format_file_size(1024), "1.0 KB");
        assert_eq!(format_file_size(1536), "1.5 KB");
        assert_eq!(format_file_size(1048576), "1.0 MB");
        assert_eq!(format_file_size(1073741824), "1.00 GB");
    }

    #[test]
    fn build_upload_form_test() {
        let upload = FileUpload {
            field_name: "document".to_string(),
            file_name: "test.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            data: vec![0x25, 0x50, 0x44, 0x46], // %PDF
        };
        let form = build_upload_form(
            &ChatId::Numeric(123),
            &upload,
            Some("Test PDF"),
            Some(&ParseMode::Html),
            true,
            Some(42),
        );
        assert!(form.is_ok());
    }

    #[test]
    fn build_upload_form_minimal() {
        let upload = FileUpload {
            field_name: "photo".to_string(),
            file_name: "pic.jpg".to_string(),
            mime_type: "image/jpeg".to_string(),
            data: vec![0xFF, 0xD8],
        };
        let form = build_upload_form(
            &ChatId::Username("@chan".to_string()),
            &upload,
            None,
            None,
            false,
            None,
        );
        assert!(form.is_ok());
    }

    #[test]
    fn file_upload_clone() {
        let upload = FileUpload {
            field_name: "photo".to_string(),
            file_name: "pic.jpg".to_string(),
            mime_type: "image/jpeg".to_string(),
            data: vec![1, 2, 3],
        };
        let cloned = upload.clone();
        assert_eq!(cloned.field_name, "photo");
        assert_eq!(cloned.data, vec![1, 2, 3]);
    }
}

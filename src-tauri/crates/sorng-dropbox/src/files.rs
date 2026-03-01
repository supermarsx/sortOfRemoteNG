//! File operations — upload, download, move, copy, delete, search,
//! revisions, thumbnails, and content hashing.

use crate::types::*;
use sha2::{Digest, Sha256};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Request Builders
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Build a simple upload arg header.
pub fn build_upload_arg(path: &str, mode: &WriteMode, autorename: bool) -> serde_json::Value {
    let mode_val = match mode {
        WriteMode::Add => serde_json::json!("add"),
        WriteMode::Overwrite => serde_json::json!("overwrite"),
        WriteMode::Update(rev) => serde_json::json!({"update": rev}),
    };
    serde_json::json!({
        "path": path,
        "mode": mode_val,
        "autorename": autorename,
        "mute": false,
        "strict_conflict": false,
    })
}

/// Build a download arg header.
pub fn build_download_arg(path: &str) -> serde_json::Value {
    serde_json::json!({ "path": path })
}

/// Build a get_metadata request body.
pub fn build_get_metadata(path: &str, include_media_info: bool) -> serde_json::Value {
    serde_json::json!({
        "path": path,
        "include_media_info": include_media_info,
        "include_deleted": false,
        "include_has_explicit_shared_members": false,
    })
}

/// Build a move request body.
pub fn build_move(from: &str, to: &str, autorename: bool) -> serde_json::Value {
    serde_json::json!({
        "from_path": from,
        "to_path": to,
        "autorename": autorename,
        "allow_shared_folder": false,
        "allow_ownership_transfer": false,
    })
}

/// Build a copy request body.
pub fn build_copy(from: &str, to: &str, autorename: bool) -> serde_json::Value {
    serde_json::json!({
        "from_path": from,
        "to_path": to,
        "autorename": autorename,
        "allow_shared_folder": false,
        "allow_ownership_transfer": false,
    })
}

/// Build a delete request body.
pub fn build_delete(path: &str) -> serde_json::Value {
    serde_json::json!({ "path": path })
}

/// Build a batch delete request body.
pub fn build_delete_batch(paths: &[&str]) -> serde_json::Value {
    let entries: Vec<serde_json::Value> = paths
        .iter()
        .map(|p| serde_json::json!({ "path": *p }))
        .collect();
    serde_json::json!({ "entries": entries })
}

/// Build a batch move request body.
pub fn build_move_batch(entries: &[(&str, &str)], autorename: bool) -> serde_json::Value {
    let entries: Vec<serde_json::Value> = entries
        .iter()
        .map(|(from, to)| {
            serde_json::json!({
                "from_path": *from,
                "to_path": *to,
            })
        })
        .collect();
    serde_json::json!({
        "entries": entries,
        "autorename": autorename,
        "allow_ownership_transfer": false,
    })
}

/// Build a batch copy request body.
pub fn build_copy_batch(entries: &[(&str, &str)], autorename: bool) -> serde_json::Value {
    let entries: Vec<serde_json::Value> = entries
        .iter()
        .map(|(from, to)| {
            serde_json::json!({
                "from_path": *from,
                "to_path": *to,
            })
        })
        .collect();
    serde_json::json!({
        "entries": entries,
        "autorename": autorename,
        "allow_ownership_transfer": false,
    })
}

/// Build a search_v2 request body.
pub fn build_search(query: &str, path: Option<&str>, max_results: Option<u64>) -> serde_json::Value {
    let mut body = serde_json::json!({ "query": query });
    if path.is_some() || max_results.is_some() {
        let mut opts = serde_json::Map::new();
        if let Some(p) = path {
            opts.insert("path".into(), serde_json::json!(p));
        }
        if let Some(max) = max_results {
            opts.insert("max_results".into(), serde_json::json!(max));
        }
        body["options"] = serde_json::Value::Object(opts);
    }
    body
}

/// Build a search/continue_v2 request body.
pub fn build_search_continue(cursor: &str) -> serde_json::Value {
    serde_json::json!({ "cursor": cursor })
}

/// Build a list_revisions request body.
pub fn build_list_revisions(path: &str, limit: Option<u64>) -> serde_json::Value {
    let mut body = serde_json::json!({ "path": path, "mode": "path" });
    if let Some(l) = limit {
        body["limit"] = serde_json::json!(l);
    }
    body
}

/// Build a restore request body.
pub fn build_restore(path: &str, rev: &str) -> serde_json::Value {
    serde_json::json!({ "path": path, "rev": rev })
}

/// Build thumbnails request arg.
pub fn build_get_thumbnail(
    path: &str,
    format: &ThumbnailFormat,
    size: &ThumbnailSize,
    mode: &ThumbnailMode,
) -> serde_json::Value {
    serde_json::json!({
        "resource": {".tag": "path", "path": path},
        "format": format,
        "size": size,
        "mode": mode,
    })
}

/// Build an upload session start arg.
pub fn build_upload_session_start(close: bool) -> serde_json::Value {
    serde_json::json!({ "close": close })
}

/// Build an upload session append arg.
pub fn build_upload_session_append(session_id: &str, offset: u64, close: bool) -> serde_json::Value {
    serde_json::json!({
        "cursor": { "session_id": session_id, "offset": offset },
        "close": close,
    })
}

/// Build an upload session finish arg.
pub fn build_upload_session_finish(
    session_id: &str,
    offset: u64,
    path: &str,
    mode: &WriteMode,
    autorename: bool,
) -> serde_json::Value {
    let mode_val = match mode {
        WriteMode::Add => serde_json::json!("add"),
        WriteMode::Overwrite => serde_json::json!("overwrite"),
        WriteMode::Update(rev) => serde_json::json!({"update": rev}),
    };
    serde_json::json!({
        "cursor": { "session_id": session_id, "offset": offset },
        "commit": {
            "path": path,
            "mode": mode_val,
            "autorename": autorename,
            "mute": false,
            "strict_conflict": false,
        },
    })
}

/// Build a check async job status body.
pub fn build_check_job_status(async_job_id: &str) -> serde_json::Value {
    serde_json::json!({ "async_job_id": async_job_id })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Content Hash
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Compute the Dropbox content hash for a byte slice.
///
/// Algorithm: split data into 4 MB blocks, SHA-256 each block,
/// then SHA-256 the concatenated block hashes.
pub fn content_hash(data: &[u8]) -> String {
    let mut overall = Sha256::new();
    for chunk in data.chunks(CONTENT_HASH_BLOCK_SIZE) {
        let block_hash = Sha256::digest(chunk);
        overall.update(block_hash);
    }
    hex::encode(overall.finalize())
}

/// Compute content hash for data that arrives in segments.
pub struct ContentHasher {
    overall: Sha256,
    block: Sha256,
    block_offset: usize,
}

impl ContentHasher {
    pub fn new() -> Self {
        Self {
            overall: Sha256::new(),
            block: Sha256::new(),
            block_offset: 0,
        }
    }

    pub fn update(&mut self, data: &[u8]) {
        let mut remaining = data;
        while !remaining.is_empty() {
            let space = CONTENT_HASH_BLOCK_SIZE - self.block_offset;
            let take = remaining.len().min(space);
            self.block.update(&remaining[..take]);
            self.block_offset += take;
            remaining = &remaining[take..];

            if self.block_offset == CONTENT_HASH_BLOCK_SIZE {
                let block_hash = std::mem::replace(&mut self.block, Sha256::new()).finalize();
                self.overall.update(block_hash);
                self.block_offset = 0;
            }
        }
    }

    pub fn finalize(mut self) -> String {
        if self.block_offset > 0 {
            let block_hash = self.block.finalize();
            self.overall.update(block_hash);
        }
        hex::encode(self.overall.finalize())
    }
}

impl Default for ContentHasher {
    fn default() -> Self {
        Self::new()
    }
}

/// Guess the MIME type from a file name extension.
pub fn guess_mime(filename: &str) -> &'static str {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "txt" | "text" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" => "application/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "md" => "text/markdown",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "gzip" => "application/gzip",
        "tar" => "application/x-tar",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "tiff" | "tif" => "image/tiff",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "mp4" => "video/mp4",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "yaml" | "yml" => "application/x-yaml",
        "toml" => "application/toml",
        "sh" => "application/x-sh",
        "py" => "text/x-python",
        "rs" => "text/x-rust",
        "ts" | "tsx" => "text/typescript",
        "exe" => "application/x-msdownload",
        "dmg" => "application/x-apple-diskimage",
        "iso" => "application/x-iso9660-image",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_arg_add() {
        let v = build_upload_arg("/test.txt", &WriteMode::Add, false);
        assert_eq!(v["mode"], "add");
        assert_eq!(v["path"], "/test.txt");
    }

    #[test]
    fn upload_arg_overwrite() {
        let v = build_upload_arg("/x.txt", &WriteMode::Overwrite, true);
        assert_eq!(v["mode"], "overwrite");
        assert!(v["autorename"].as_bool().unwrap());
    }

    #[test]
    fn upload_arg_update() {
        let v = build_upload_arg("/x.txt", &WriteMode::Update("abc123".into()), false);
        assert_eq!(v["mode"]["update"], "abc123");
    }

    #[test]
    fn download_arg_path() {
        let v = build_download_arg("/docs/report.pdf");
        assert_eq!(v["path"], "/docs/report.pdf");
    }

    #[test]
    fn get_metadata_body() {
        let v = build_get_metadata("/file.txt", true);
        assert_eq!(v["path"], "/file.txt");
        assert!(v["include_media_info"].as_bool().unwrap());
    }

    #[test]
    fn move_body() {
        let v = build_move("/a.txt", "/b.txt", false);
        assert_eq!(v["from_path"], "/a.txt");
        assert_eq!(v["to_path"], "/b.txt");
    }

    #[test]
    fn copy_body() {
        let v = build_copy("/src", "/dst", true);
        assert_eq!(v["from_path"], "/src");
        assert!(v["autorename"].as_bool().unwrap());
    }

    #[test]
    fn delete_body() {
        let v = build_delete("/trash.txt");
        assert_eq!(v["path"], "/trash.txt");
    }

    #[test]
    fn delete_batch_body() {
        let v = build_delete_batch(&["/a", "/b", "/c"]);
        assert_eq!(v["entries"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn move_batch_body() {
        let v = build_move_batch(&[("/a", "/b"), ("/c", "/d")], true);
        assert_eq!(v["entries"].as_array().unwrap().len(), 2);
        assert!(v["autorename"].as_bool().unwrap());
    }

    #[test]
    fn copy_batch_body() {
        let v = build_copy_batch(&[("/x", "/y")], false);
        assert_eq!(v["entries"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn search_basic() {
        let v = build_search("hello world", None, None);
        assert_eq!(v["query"], "hello world");
        assert!(v.get("options").is_none());
    }

    #[test]
    fn search_with_options() {
        let v = build_search("test", Some("/docs"), Some(10));
        assert_eq!(v["options"]["path"], "/docs");
        assert_eq!(v["options"]["max_results"], 10);
    }

    #[test]
    fn search_continue_body() {
        let v = build_search_continue("cursor_abc");
        assert_eq!(v["cursor"], "cursor_abc");
    }

    #[test]
    fn list_revisions_body() {
        let v = build_list_revisions("/file.txt", Some(5));
        assert_eq!(v["path"], "/file.txt");
        assert_eq!(v["limit"], 5);
    }

    #[test]
    fn restore_body() {
        let v = build_restore("/file.txt", "rev123");
        assert_eq!(v["path"], "/file.txt");
        assert_eq!(v["rev"], "rev123");
    }

    #[test]
    fn content_hash_empty() {
        let h = content_hash(b"");
        assert!(!h.is_empty());
        assert_eq!(h.len(), 64); // SHA-256 = 32 bytes = 64 hex
    }

    #[test]
    fn content_hash_small() {
        let h = content_hash(b"hello world");
        assert_eq!(h.len(), 64);
    }

    #[test]
    fn content_hash_deterministic() {
        let h1 = content_hash(b"test data");
        let h2 = content_hash(b"test data");
        assert_eq!(h1, h2);
    }

    #[test]
    fn content_hash_differs() {
        let h1 = content_hash(b"aaa");
        let h2 = content_hash(b"bbb");
        assert_ne!(h1, h2);
    }

    #[test]
    fn content_hasher_streaming() {
        let full = content_hash(b"hello world, this is a streaming test");
        let mut hasher = ContentHasher::new();
        hasher.update(b"hello world, ");
        hasher.update(b"this is a streaming test");
        assert_eq!(hasher.finalize(), full);
    }

    #[test]
    fn guess_mime_common() {
        assert_eq!(guess_mime("photo.jpg"), "image/jpeg");
        assert_eq!(guess_mime("doc.pdf"), "application/pdf");
        assert_eq!(guess_mime("data.json"), "application/json");
        assert_eq!(guess_mime("archive.zip"), "application/zip");
        assert_eq!(guess_mime("README.md"), "text/markdown");
        assert_eq!(guess_mime("video.mp4"), "video/mp4");
    }

    #[test]
    fn guess_mime_unknown() {
        assert_eq!(guess_mime("file.xyz"), "application/octet-stream");
        assert_eq!(guess_mime("noext"), "application/octet-stream");
    }

    #[test]
    fn upload_session_start_arg() {
        let v = build_upload_session_start(false);
        assert!(!v["close"].as_bool().unwrap());
    }

    #[test]
    fn upload_session_append_arg() {
        let v = build_upload_session_append("sess123", 4096, false);
        assert_eq!(v["cursor"]["session_id"], "sess123");
        assert_eq!(v["cursor"]["offset"], 4096);
    }

    #[test]
    fn upload_session_finish_arg() {
        let v = build_upload_session_finish("sess123", 8192, "/big.zip", &WriteMode::Overwrite, true);
        assert_eq!(v["cursor"]["offset"], 8192);
        assert_eq!(v["commit"]["path"], "/big.zip");
        assert_eq!(v["commit"]["mode"], "overwrite");
    }

    #[test]
    fn check_job_status_body() {
        let v = build_check_job_status("job_abc");
        assert_eq!(v["async_job_id"], "job_abc");
    }

    #[test]
    fn thumbnail_arg() {
        let v = build_get_thumbnail(
            "/photo.jpg",
            &ThumbnailFormat::Jpeg,
            &ThumbnailSize::W256H256,
            &ThumbnailMode::Bestfit,
        );
        assert_eq!(v["resource"][".tag"], "path");
        assert_eq!(v["resource"]["path"], "/photo.jpg");
    }
}

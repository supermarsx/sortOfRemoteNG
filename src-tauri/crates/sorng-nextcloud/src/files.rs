// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · files
// ──────────────────────────────────────────────────────────────────────────────
// WebDAV file operations:
//  • Upload / download
//  • Move / copy / delete
//  • Metadata (PROPFIND depth-0)
//  • Chunked upload (Nextcloud v2 chunked upload)
//  • Versions
//  • Trashbin
//  • Search (WebDAV REPORT + unified search)
//  • Content hashing, MIME guessing
//  • Favorite / tag management
//  • Thumbnails / previews
// ──────────────────────────────────────────────────────────────────────────────

use crate::client::{encode_dav_path, proppatch_favorite_body, proppatch_tags_body, NextcloudClient};
use crate::types::*;
use sha2::{Digest, Sha256};
use uuid::Uuid;

// ── Upload / Download ────────────────────────────────────────────────────────

/// Build upload arguments with sensible defaults.
pub fn build_upload_args(remote_path: &str, overwrite: bool) -> UploadArgs {
    UploadArgs {
        remote_path: remote_path.to_string(),
        overwrite,
        content_type: None,
        mtime: None,
    }
}

/// Upload file content via PUT.
pub async fn upload(
    client: &NextcloudClient,
    args: &UploadArgs,
    data: Vec<u8>,
) -> Result<(), String> {
    client
        .put(
            &args.remote_path,
            data,
            args.content_type.as_deref(),
            args.mtime,
        )
        .await
}

/// Download a file. Returns raw bytes.
pub async fn download(client: &NextcloudClient, remote_path: &str) -> Result<Vec<u8>, String> {
    client.get(remote_path).await
}

// ── Move / Copy / Delete ─────────────────────────────────────────────────────

pub fn build_move_args(from: &str, to: &str, overwrite: bool) -> MoveArgs {
    MoveArgs {
        from_path: from.to_string(),
        to_path: to.to_string(),
        overwrite,
    }
}

pub async fn move_file(client: &NextcloudClient, args: &MoveArgs) -> Result<(), String> {
    client
        .move_resource(&args.from_path, &args.to_path, args.overwrite)
        .await
}

pub async fn copy_file(client: &NextcloudClient, args: &MoveArgs) -> Result<(), String> {
    client
        .copy_resource(&args.from_path, &args.to_path, args.overwrite)
        .await
}

pub async fn delete_file(client: &NextcloudClient, path: &str) -> Result<(), String> {
    client.delete(path).await
}

// ── Metadata ─────────────────────────────────────────────────────────────────

/// Get metadata for a single resource (depth-0 PROPFIND).
pub async fn get_metadata(
    client: &NextcloudClient,
    path: &str,
) -> Result<DavResource, String> {
    let items = client.propfind(path, PropfindDepth::Zero, None).await?;
    items
        .into_iter()
        .next()
        .ok_or_else(|| format!("no metadata returned for {}", path))
}

// ── Chunked Upload v2 ───────────────────────────────────────────────────────

/// Start a chunked upload session.
/// Creates the upload directory on the server.
pub async fn chunked_upload_start(
    client: &NextcloudClient,
    remote_path: &str,
    total_size: u64,
) -> Result<ChunkedUploadSession, String> {
    let session_id = Uuid::new_v4().to_string();
    let upload_dir = format!("{}/{}", client.uploads_base(), session_id);

    // MKCOL to create the chunked-upload directory
    let http = reqwest::Client::new();
    let req = http
        .request(
            reqwest::Method::from_bytes(b"MKCOL").unwrap(),
            &upload_dir,
        )
        .basic_auth(client.username(), Some(&String::new()))
        .header("OCS-APIRequest", "true");

    // We use a direct call here because uploads_base already returns an absolute URL
    let _resp = req.send().await.map_err(|e| format!("MKCOL upload dir: {}", e))?;

    Ok(ChunkedUploadSession {
        session_id,
        remote_path: remote_path.to_string(),
        total_size,
        bytes_uploaded: 0,
        chunks_uploaded: 0,
        complete: false,
    })
}

/// Upload a single chunk.
pub async fn chunked_upload_append(
    client: &NextcloudClient,
    session: &mut ChunkedUploadSession,
    chunk_data: Vec<u8>,
) -> Result<(), String> {
    let chunk_size = chunk_data.len() as u64;
    let chunk_name = format!(
        "{:015}-{:015}",
        session.bytes_uploaded,
        session.bytes_uploaded + chunk_size
    );
    let chunk_url = format!(
        "{}/{}/{}",
        client.uploads_base(),
        session.session_id,
        chunk_name
    );

    let http = reqwest::Client::new();
    let resp = http
        .put(&chunk_url)
        .basic_auth(client.username(), Some(&String::new()))
        .header("OCS-APIRequest", "true")
        .body(chunk_data)
        .send()
        .await
        .map_err(|e| format!("chunk upload: {}", e))?;

    let status = resp.status();
    if !status.is_success() && status != reqwest::StatusCode::CREATED {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("chunk upload {} → {}: {}", chunk_url, status, text));
    }

    session.bytes_uploaded += chunk_size;
    session.chunks_uploaded += 1;
    Ok(())
}

/// Assemble (finish) a chunked upload by MOVEing the upload dir to the final destination.
pub async fn chunked_upload_finish(
    client: &NextcloudClient,
    session: &mut ChunkedUploadSession,
) -> Result<(), String> {
    let src_url = format!(
        "{}/{}/.file",
        client.uploads_base(),
        session.session_id
    );
    let dst_url = format!(
        "{}/{}",
        client.dav_base(),
        encode_dav_path(&session.remote_path)
    );

    let http = reqwest::Client::new();
    let resp = http
        .request(reqwest::Method::from_bytes(b"MOVE").unwrap(), &src_url)
        .basic_auth(client.username(), Some(&String::new()))
        .header("Destination", &dst_url)
        .header("Overwrite", "T")
        .header("OCS-APIRequest", "true")
        .send()
        .await
        .map_err(|e| format!("chunked finish MOVE: {}", e))?;

    let status = resp.status();
    if status.is_success() || status == reqwest::StatusCode::CREATED || status == reqwest::StatusCode::NO_CONTENT {
        session.complete = true;
        Ok(())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("chunked finish {} → {}: {}", src_url, status, text))
    }
}

// ── Versions ─────────────────────────────────────────────────────────────────

/// List versions of a file. Requires the file id.
pub async fn list_versions(
    client: &NextcloudClient,
    file_id: u64,
) -> Result<Vec<FileVersion>, String> {
    let url = client.versions_base(file_id);
    let body = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:getetag/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>"#;

    let http = reqwest::Client::new();
    let resp = http
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &url)
        .basic_auth(client.username(), Some(&String::new()))
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("OCS-APIRequest", "true")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("list versions: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if status == reqwest::StatusCode::MULTI_STATUS || status.is_success() {
        let resources = crate::client::parse_multistatus_xml(&text)?;
        // Skip the first entry (the versions folder itself)
        let versions = resources
            .into_iter()
            .skip(1)
            .map(|r| FileVersion {
                version_id: r.display_name.clone(),
                size: r.content_length.unwrap_or(0),
                content_type: r.content_type,
                last_modified: r.last_modified,
                etag: r.etag,
            })
            .collect();
        Ok(versions)
    } else {
        Err(format!("list versions {} → {}: {}", url, status, text))
    }
}

/// Restore a specific version of a file.
pub async fn restore_version(
    client: &NextcloudClient,
    file_id: u64,
    version_id: &str,
) -> Result<(), String> {
    let src_url = format!("{}/{}", client.versions_base(file_id), version_id);
    let dst_url = format!(
        "{}/remote.php/dav/versions/{}/restore/target",
        client.base_url(),
        client.username()
    );

    let http = reqwest::Client::new();
    let resp = http
        .request(reqwest::Method::from_bytes(b"MOVE").unwrap(), &src_url)
        .basic_auth(client.username(), Some(&String::new()))
        .header("Destination", &dst_url)
        .header("OCS-APIRequest", "true")
        .send()
        .await
        .map_err(|e| format!("restore version: {}", e))?;

    let status = resp.status();
    if status.is_success() || status == reqwest::StatusCode::CREATED || status == reqwest::StatusCode::NO_CONTENT {
        Ok(())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("restore version {} → {}: {}", src_url, status, text))
    }
}

// ── Trashbin ─────────────────────────────────────────────────────────────────

/// List items in the trashbin.
pub async fn list_trash(client: &NextcloudClient) -> Result<Vec<TrashItem>, String> {
    let url = client.trashbin_base();
    let body = r#"<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <d:getcontentlength/>
    <d:resourcetype/>
    <oc:trashbin-original-location/>
    <oc:trashbin-delete-datetime/>
    <oc:trashbin-filename/>
    <oc:fileid/>
  </d:prop>
</d:propfind>"#;

    let resources = propfind_raw(client, &url, "1", body).await?;

    let items = resources
        .into_iter()
        .skip(1) // skip the trashbin folder itself
        .map(|r| {
            TrashItem {
                id: r.file_id.map(|id| id.to_string()).unwrap_or_default(),
                original_name: r.display_name.clone(),
                original_location: String::new(), // would need custom XML parsing
                deletion_time: r.last_modified,
                size: r.content_length,
                resource_type: r.resource_type,
            }
        })
        .collect();

    Ok(items)
}

/// Restore an item from the trashbin.
pub async fn restore_trash_item(
    client: &NextcloudClient,
    trash_item_name: &str,
    destination_path: &str,
) -> Result<(), String> {
    let src_url = format!("{}/{}", client.trashbin_base(), encode_dav_path(trash_item_name));
    let dst_url = format!(
        "{}/{}",
        client.dav_base(),
        encode_dav_path(destination_path)
    );

    let http = reqwest::Client::new();
    let resp = http
        .request(reqwest::Method::from_bytes(b"MOVE").unwrap(), &src_url)
        .basic_auth(client.username(), Some(&String::new()))
        .header("Destination", &dst_url)
        .header("Overwrite", "F")
        .header("OCS-APIRequest", "true")
        .send()
        .await
        .map_err(|e| format!("restore trash: {}", e))?;

    let status = resp.status();
    if status.is_success() || status == reqwest::StatusCode::CREATED || status == reqwest::StatusCode::NO_CONTENT {
        Ok(())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("restore trash {} → {}: {}", src_url, status, text))
    }
}

/// Permanently delete a single trashbin item.
pub async fn delete_trash_item(
    client: &NextcloudClient,
    trash_item_name: &str,
) -> Result<(), String> {
    let url = format!("{}/{}", client.trashbin_base(), encode_dav_path(trash_item_name));

    let http = reqwest::Client::new();
    let resp = http
        .delete(&url)
        .basic_auth(client.username(), Some(&String::new()))
        .header("OCS-APIRequest", "true")
        .send()
        .await
        .map_err(|e| format!("delete trash item: {}", e))?;

    let status = resp.status();
    if status.is_success() || status == reqwest::StatusCode::NO_CONTENT {
        Ok(())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("delete trash item {} → {}: {}", url, status, text))
    }
}

/// Empty the entire trashbin.
pub async fn empty_trash(client: &NextcloudClient) -> Result<(), String> {
    let url = client.trashbin_base();

    let http = reqwest::Client::new();
    let resp = http
        .delete(&url)
        .basic_auth(client.username(), Some(&String::new()))
        .header("OCS-APIRequest", "true")
        .send()
        .await
        .map_err(|e| format!("empty trash: {}", e))?;

    let status = resp.status();
    if status.is_success() || status == reqwest::StatusCode::NO_CONTENT {
        Ok(())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("empty trash {} → {}: {}", url, status, text))
    }
}

// ── Favorites & Tags ─────────────────────────────────────────────────────────

/// Set or unset the favorite flag on a resource.
pub async fn set_favorite(
    client: &NextcloudClient,
    path: &str,
    favorite: bool,
) -> Result<(), String> {
    let body = proppatch_favorite_body(favorite);
    client.proppatch(path, &body).await
}

/// Set system tags on a resource.
pub async fn set_tags(
    client: &NextcloudClient,
    path: &str,
    tags: &[String],
) -> Result<(), String> {
    let body = proppatch_tags_body(tags);
    client.proppatch(path, &body).await
}

// ── Search ───────────────────────────────────────────────────────────────────

/// Perform a unified search via OCS.
pub async fn unified_search(
    client: &NextcloudClient,
    query: &SearchQuery,
) -> Result<SearchResult, String> {
    let provider = query.provider.as_deref().unwrap_or("files");
    let mut url = format!(
        "ocs/v2.php/search/providers/{}/search?format=json&term={}",
        provider,
        url::form_urlencoded::byte_serialize(query.term.as_bytes()).collect::<String>()
    );

    if let Some(limit) = query.limit {
        url.push_str(&format!("&limit={}", limit));
    }
    if let Some(ref cursor) = query.cursor {
        url.push_str(&format!("&cursor={}", cursor));
    }

    let resp: OcsResponse<SearchResult> = client.ocs_get(&url).await?;
    Ok(resp.ocs.data)
}

/// Build a WebDAV REPORT / SEARCH body for filename search.
pub fn build_search_report_body(term: &str, path_prefix: &str, limit: u32) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<oc:filter-files xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <d:displayname/>
    <d:getcontenttype/>
    <d:getcontentlength/>
    <d:getetag/>
    <d:getlastmodified/>
    <d:resourcetype/>
    <oc:fileid/>
  </d:prop>
  <oc:filter-rules>
    <oc:name>{}</oc:name>
  </oc:filter-rules>
</oc:filter-files>"#,
        quick_xml::escape::escape(term)
    )
}

// ── Content Hash ─────────────────────────────────────────────────────────────

/// Compute SHA-256 hash of file contents. Returns hex string.
pub fn content_hash_sha256(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    hex::encode(digest)
}

/// Compute SHA-256 in chunks (streaming).
pub fn content_hash_sha256_chunks(chunks: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    for chunk in chunks {
        hasher.update(chunk);
    }
    hex::encode(hasher.finalize())
}

// ── MIME guessing ────────────────────────────────────────────────────────────

/// Guess MIME type from file extension.
pub fn guess_mime(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "txt" | "log" | "md" | "csv" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" => "application/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "gzip" => "application/gzip",
        "tar" => "application/x-tar",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "odp" => "application/vnd.oasis.opendocument.presentation",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
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
        "aac" => "audio/aac",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "wmv" => "video/x-ms-wmv",
        "rdp" => "application/x-rdp",
        "ssh" => "text/plain",
        "pem" | "crt" | "cer" => "application/x-x509-ca-cert",
        "key" => "application/x-pem-file",
        _ => "application/octet-stream",
    }
}

// ── Preview / Thumbnail ──────────────────────────────────────────────────────

/// Get a file preview / thumbnail. Returns raw image bytes.
pub async fn get_preview(
    client: &NextcloudClient,
    args: &PreviewArgs,
) -> Result<Vec<u8>, String> {
    let mut url = format!(
        "{}/index.php/core/preview?file={}&x={}&y={}",
        client.base_url(),
        url::form_urlencoded::byte_serialize(args.path.as_bytes()).collect::<String>(),
        args.width,
        args.height
    );

    if let Some(ref mode) = args.mode {
        url.push_str(&format!("&mode={}", mode));
    }
    if let Some(force) = args.force_icon {
        url.push_str(&format!("&forceIcon={}", if force { "1" } else { "0" }));
    }

    client.plain_get_bytes(&url).await
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/// Raw PROPFIND against an arbitrary URL.
async fn propfind_raw(
    client: &NextcloudClient,
    url: &str,
    depth: &str,
    body: &str,
) -> Result<Vec<DavResource>, String> {
    let http = reqwest::Client::new();
    let resp = http
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), url)
        .basic_auth(client.username(), Some(&String::new()))
        .header("Depth", depth)
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("OCS-APIRequest", "true")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("PROPFIND: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if status == reqwest::StatusCode::MULTI_STATUS || status.is_success() {
        crate::client::parse_multistatus_xml(&text)
    } else {
        Err(format!("PROPFIND {} → {}: {}", url, status, text))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_upload_args_defaults() {
        let a = build_upload_args("/Documents/test.txt", false);
        assert_eq!(a.remote_path, "/Documents/test.txt");
        assert!(!a.overwrite);
        assert!(a.content_type.is_none());
    }

    #[test]
    fn build_move_args_basic() {
        let a = build_move_args("/a.txt", "/b.txt", true);
        assert_eq!(a.from_path, "/a.txt");
        assert_eq!(a.to_path, "/b.txt");
        assert!(a.overwrite);
    }

    #[test]
    fn content_hash_sha256_known() {
        let hash = content_hash_sha256(b"hello world");
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn content_hash_sha256_chunks_matches_whole() {
        let data = b"hello world";
        let whole = content_hash_sha256(data);
        let chunked = content_hash_sha256_chunks(&[b"hello ", b"world"]);
        assert_eq!(whole, chunked);
    }

    #[test]
    fn content_hash_empty() {
        let hash = content_hash_sha256(b"");
        // SHA-256 of empty string
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn guess_mime_common_types() {
        assert_eq!(guess_mime("test.pdf"), "application/pdf");
        assert_eq!(guess_mime("photo.jpg"), "image/jpeg");
        assert_eq!(guess_mime("video.mp4"), "video/mp4");
        assert_eq!(guess_mime("doc.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        assert_eq!(guess_mime("archive.zip"), "application/zip");
    }

    #[test]
    fn guess_mime_rdp() {
        assert_eq!(guess_mime("session.rdp"), "application/x-rdp");
    }

    #[test]
    fn guess_mime_unknown() {
        assert_eq!(guess_mime("file.xyz123"), "application/octet-stream");
    }

    #[test]
    fn guess_mime_case_insensitive() {
        assert_eq!(guess_mime("IMAGE.PNG"), "image/png");
        assert_eq!(guess_mime("VIDEO.MKV"), "video/x-matroska");
    }

    #[test]
    fn guess_mime_no_extension() {
        assert_eq!(guess_mime("Makefile"), "application/octet-stream");
    }

    #[test]
    fn build_search_report_body_escapes() {
        let body = build_search_report_body("<test>", "/", 10);
        assert!(body.contains("&lt;test&gt;"));
        assert!(body.contains("oc:filter-files"));
    }

    #[test]
    fn build_search_report_body_contains_props() {
        let body = build_search_report_body("query", "/", 50);
        assert!(body.contains("d:displayname"));
        assert!(body.contains("oc:fileid"));
    }

    #[test]
    fn chunked_session_initial_state() {
        let s = ChunkedUploadSession {
            session_id: "test-id".into(),
            remote_path: "/file.bin".into(),
            total_size: 1024,
            bytes_uploaded: 0,
            chunks_uploaded: 0,
            complete: false,
        };
        assert_eq!(s.bytes_uploaded, 0);
        assert!(!s.complete);
    }
}

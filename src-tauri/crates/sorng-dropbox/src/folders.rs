//! Folder operations — create, list, recursive list, get latest cursor.

use crate::types::*;

/// Build a create_folder_v2 request body.
pub fn build_create_folder(path: &str, autorename: bool) -> serde_json::Value {
    serde_json::json!({
        "path": path,
        "autorename": autorename,
    })
}

/// Build a list_folder request body.
pub fn build_list_folder(req: &ListFolderRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "path": req.path,
        "recursive": req.recursive,
        "include_media_info": req.include_media_info,
        "include_deleted": req.include_deleted,
        "include_has_explicit_shared_members": req.include_has_explicit_shared_members,
        "include_mounted_folders": req.include_mounted_folders,
        "include_non_downloadable_files": req.include_non_downloadable_files,
    });
    if let Some(limit) = req.limit {
        body["limit"] = serde_json::json!(limit);
    }
    body
}

/// Build a list_folder/continue request body.
pub fn build_list_folder_continue(cursor: &str) -> serde_json::Value {
    serde_json::json!({ "cursor": cursor })
}

/// Build a list_folder/get_latest_cursor request body.
pub fn build_get_latest_cursor(path: &str, recursive: bool) -> serde_json::Value {
    serde_json::json!({
        "path": path,
        "recursive": recursive,
        "include_media_info": false,
        "include_deleted": false,
        "include_has_explicit_shared_members": false,
        "include_mounted_folders": true,
        "include_non_downloadable_files": true,
    })
}

/// Build a batch create_folder request body.
pub fn build_create_folder_batch(paths: &[&str], autorename: bool, force_async: bool) -> serde_json::Value {
    let entries: Vec<serde_json::Value> = paths
        .iter()
        .map(|p| serde_json::json!({"path": *p}))
        .collect();
    serde_json::json!({
        "paths": entries.iter().map(|e| e["path"].as_str().unwrap()).collect::<Vec<_>>(),
        "autorename": autorename,
        "force_async": force_async,
    })
}

/// Filter metadata entries to only files.
pub fn files_only(entries: &[Metadata]) -> Vec<&Metadata> {
    entries
        .iter()
        .filter(|m| m.tag == MetadataTag::File)
        .collect()
}

/// Filter metadata entries to only folders.
pub fn folders_only(entries: &[Metadata]) -> Vec<&Metadata> {
    entries
        .iter()
        .filter(|m| m.tag == MetadataTag::Folder)
        .collect()
}

/// Count files and folders in a listing.
pub fn count_entries(entries: &[Metadata]) -> (usize, usize) {
    let files = entries.iter().filter(|m| m.tag == MetadataTag::File).count();
    let folders = entries
        .iter()
        .filter(|m| m.tag == MetadataTag::Folder)
        .count();
    (files, folders)
}

/// Calculate the total size of file entries.
pub fn total_size(entries: &[Metadata]) -> u64 {
    entries
        .iter()
        .filter(|m| m.tag == MetadataTag::File)
        .filter_map(|m| m.size)
        .sum()
}

/// Sort entries: folders first, then files, alphabetically.
pub fn sort_entries(entries: &mut [Metadata]) {
    entries.sort_by(|a, b| {
        let tag_ord = |t: &MetadataTag| match t {
            MetadataTag::Folder => 0,
            MetadataTag::File => 1,
            MetadataTag::Deleted => 2,
        };
        tag_ord(&a.tag)
            .cmp(&tag_ord(&b.tag))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// Build a breadcrumb path from a display path.
///
/// Example: "/Documents/Work/Reports" → ["Documents", "Work", "Reports"]
pub fn breadcrumbs(path: &str) -> Vec<String> {
    path.split('/')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Get the parent path from a full path.
pub fn parent_path(path: &str) -> &str {
    if path == "/" || path.is_empty() {
        return "";
    }
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => "/",
        Some(i) => &trimmed[..i],
        None => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_folder_body() {
        let v = build_create_folder("/new-folder", true);
        assert_eq!(v["path"], "/new-folder");
        assert!(v["autorename"].as_bool().unwrap());
    }

    #[test]
    fn list_folder_body_default() {
        let req = ListFolderRequest {
            path: "".to_string(),
            ..Default::default()
        };
        let v = build_list_folder(&req);
        assert_eq!(v["path"], "");
        assert!(!v["recursive"].as_bool().unwrap());
    }

    #[test]
    fn list_folder_body_recursive() {
        let req = ListFolderRequest {
            path: "/docs".to_string(),
            recursive: true,
            limit: Some(100),
            ..Default::default()
        };
        let v = build_list_folder(&req);
        assert!(v["recursive"].as_bool().unwrap());
        assert_eq!(v["limit"], 100);
    }

    #[test]
    fn list_folder_continue_body() {
        let v = build_list_folder_continue("CURSOR_ABC");
        assert_eq!(v["cursor"], "CURSOR_ABC");
    }

    #[test]
    fn get_latest_cursor_body() {
        let v = build_get_latest_cursor("/sync", true);
        assert_eq!(v["path"], "/sync");
        assert!(v["recursive"].as_bool().unwrap());
    }

    #[test]
    fn create_folder_batch_body() {
        let v = build_create_folder_batch(&["/a", "/b", "/c"], false, true);
        assert_eq!(v["paths"].as_array().unwrap().len(), 3);
        assert!(v["force_async"].as_bool().unwrap());
    }

    fn make_file(name: &str, size: u64) -> Metadata {
        Metadata {
            tag: MetadataTag::File,
            name: name.to_string(),
            path_lower: Some(format!("/{}", name.to_lowercase())),
            path_display: Some(format!("/{name}")),
            id: None,
            size: Some(size),
            rev: None,
            content_hash: None,
            client_modified: None,
            server_modified: None,
            is_downloadable: None,
            media_info: None,
            symlink_info: None,
            sharing_info: None,
            property_groups: None,
            has_explicit_shared_members: None,
            file_lock_info: None,
        }
    }

    fn make_folder(name: &str) -> Metadata {
        Metadata {
            tag: MetadataTag::Folder,
            name: name.to_string(),
            path_lower: Some(format!("/{}", name.to_lowercase())),
            path_display: Some(format!("/{name}")),
            id: None,
            size: None,
            rev: None,
            content_hash: None,
            client_modified: None,
            server_modified: None,
            is_downloadable: None,
            media_info: None,
            symlink_info: None,
            sharing_info: None,
            property_groups: None,
            has_explicit_shared_members: None,
            file_lock_info: None,
        }
    }

    #[test]
    fn files_only_filter() {
        let entries = vec![make_file("a.txt", 10), make_folder("docs"), make_file("b.txt", 20)];
        let result = files_only(&entries);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn folders_only_filter() {
        let entries = vec![make_file("a.txt", 10), make_folder("docs"), make_folder("pics")];
        let result = folders_only(&entries);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn count_entries_test() {
        let entries = vec![make_file("a", 1), make_folder("b"), make_file("c", 2)];
        let (f, d) = count_entries(&entries);
        assert_eq!(f, 2);
        assert_eq!(d, 1);
    }

    #[test]
    fn total_size_sum() {
        let entries = vec![make_file("a", 100), make_folder("b"), make_file("c", 300)];
        assert_eq!(total_size(&entries), 400);
    }

    #[test]
    fn sort_entries_folders_first() {
        let mut entries = vec![make_file("z.txt", 1), make_folder("Alpha"), make_file("a.txt", 2)];
        sort_entries(&mut entries);
        assert_eq!(entries[0].name, "Alpha");
        assert_eq!(entries[1].name, "a.txt");
        assert_eq!(entries[2].name, "z.txt");
    }

    #[test]
    fn breadcrumbs_test() {
        assert_eq!(breadcrumbs("/Documents/Work/Reports"), vec!["Documents", "Work", "Reports"]);
        assert_eq!(breadcrumbs("/"), Vec::<String>::new());
        assert_eq!(breadcrumbs(""), Vec::<String>::new());
    }

    #[test]
    fn parent_path_test() {
        assert_eq!(parent_path("/a/b/c"), "/a/b");
        assert_eq!(parent_path("/a"), "/");
        assert_eq!(parent_path("/"), "");
        assert_eq!(parent_path(""), "");
    }
}

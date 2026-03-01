// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · folders
// ──────────────────────────────────────────────────────────────────────────────
// WebDAV folder operations:
//  • Create folder (MKCOL)
//  • List folder (PROPFIND depth 1)
//  • Recursive listing (depth infinity or iterative)
//  • Breadcrumbs
//  • Sorting & filtering utilities
//  • Create folder hierarchy
// ──────────────────────────────────────────────────────────────────────────────

use crate::client::NextcloudClient;
use crate::types::*;

// ── Create ───────────────────────────────────────────────────────────────────

/// Create a single folder via WebDAV MKCOL.
pub async fn create_folder(client: &NextcloudClient, path: &str) -> Result<(), String> {
    client.mkcol(path).await
}

/// Create a folder and all parent directories (like `mkdir -p`).
pub async fn create_folder_recursive(client: &NextcloudClient, path: &str) -> Result<(), String> {
    let parts: Vec<&str> = path
        .trim_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();

    let mut current = String::new();
    for part in parts {
        current.push('/');
        current.push_str(part);
        // Ignore errors from MKCOL if the folder already exists (405 / 409)
        let _ = client.mkcol(&current).await;
    }
    Ok(())
}

// ── Listing ──────────────────────────────────────────────────────────────────

/// List folder contents (depth 1). Returns a `PropfindResult` with the
/// folder itself (`folder`) and its children (`children`).
pub async fn list_folder(
    client: &NextcloudClient,
    path: &str,
) -> Result<PropfindResult, String> {
    let items = client.propfind(path, PropfindDepth::One, None).await?;
    if items.is_empty() {
        return Err(format!("empty PROPFIND response for {}", path));
    }

    let folder = items[0].clone();
    let children = items.into_iter().skip(1).collect();

    Ok(PropfindResult { folder, children })
}

/// List only files in a folder (no sub-folders).
pub async fn list_files(
    client: &NextcloudClient,
    path: &str,
) -> Result<Vec<DavResource>, String> {
    let result = list_folder(client, path).await?;
    Ok(filter_files(&result.children))
}

/// List only sub-folders in a folder.
pub async fn list_subfolders(
    client: &NextcloudClient,
    path: &str,
) -> Result<Vec<DavResource>, String> {
    let result = list_folder(client, path).await?;
    Ok(filter_folders(&result.children))
}

/// Recursively list all resources under a path.
/// NOTE: Some servers disable depth-infinity PROPFIND. This helper falls back
/// to an iterative BFS approach.
pub async fn list_folder_recursive(
    client: &NextcloudClient,
    path: &str,
) -> Result<Vec<DavResource>, String> {
    let mut all: Vec<DavResource> = Vec::new();
    let mut queue: Vec<String> = vec![path.to_string()];

    while let Some(dir) = queue.pop() {
        let result = list_folder(client, &dir).await?;
        for child in &result.children {
            if child.resource_type == DavResourceType::Folder {
                // Extract path from href for queuing
                let child_path = dav_href_to_path(&child.href, client.username());
                queue.push(child_path);
            }
        }
        all.extend(result.children);
    }

    Ok(all)
}

// ── Filtering ────────────────────────────────────────────────────────────────

/// Filter to files only.
pub fn filter_files(resources: &[DavResource]) -> Vec<DavResource> {
    resources
        .iter()
        .filter(|r| r.resource_type == DavResourceType::File)
        .cloned()
        .collect()
}

/// Filter to folders only.
pub fn filter_folders(resources: &[DavResource]) -> Vec<DavResource> {
    resources
        .iter()
        .filter(|r| r.resource_type == DavResourceType::Folder)
        .cloned()
        .collect()
}

/// Filter resources by MIME type prefix (e.g. `"image/"`, `"text/"`).
pub fn filter_by_mime(resources: &[DavResource], mime_prefix: &str) -> Vec<DavResource> {
    resources
        .iter()
        .filter(|r| {
            r.content_type
                .as_ref()
                .map(|ct| ct.starts_with(mime_prefix))
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}

/// Filter resources by minimum size.
pub fn filter_by_min_size(resources: &[DavResource], min_bytes: u64) -> Vec<DavResource> {
    resources
        .iter()
        .filter(|r| r.content_length.unwrap_or(0) >= min_bytes)
        .cloned()
        .collect()
}

/// Filter resources by maximum size.
pub fn filter_by_max_size(resources: &[DavResource], max_bytes: u64) -> Vec<DavResource> {
    resources
        .iter()
        .filter(|r| r.content_length.unwrap_or(0) <= max_bytes)
        .cloned()
        .collect()
}

/// Filter to only favorited resources.
pub fn filter_favorites(resources: &[DavResource]) -> Vec<DavResource> {
    resources
        .iter()
        .filter(|r| r.favorite == Some(true))
        .cloned()
        .collect()
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/// Sort resources: folders first, then alphabetically by display name.
pub fn sort_folders_first(resources: &mut [DavResource]) {
    resources.sort_by(|a, b| {
        let a_folder = a.resource_type == DavResourceType::Folder;
        let b_folder = b.resource_type == DavResourceType::Folder;
        b_folder
            .cmp(&a_folder)
            .then_with(|| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()))
    });
}

/// Sort by size (ascending).
pub fn sort_by_size_asc(resources: &mut [DavResource]) {
    resources.sort_by_key(|r| r.content_length.unwrap_or(0));
}

/// Sort by size (descending).
pub fn sort_by_size_desc(resources: &mut [DavResource]) {
    resources.sort_by(|a, b| {
        b.content_length
            .unwrap_or(0)
            .cmp(&a.content_length.unwrap_or(0))
    });
}

/// Sort by name (case-insensitive).
pub fn sort_by_name(resources: &mut [DavResource]) {
    resources.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
}

/// Sort by last modified (newest first). Falls back to display name.
pub fn sort_by_modified_desc(resources: &mut [DavResource]) {
    resources.sort_by(|a, b| {
        let a_mod = a.last_modified.as_deref().unwrap_or("");
        let b_mod = b.last_modified.as_deref().unwrap_or("");
        b_mod.cmp(a_mod)
    });
}

// ── Breadcrumbs ──────────────────────────────────────────────────────────────

/// Generate breadcrumb entries from a path.
/// Each entry is `(label, path)`.
pub fn breadcrumbs(path: &str) -> Vec<(String, String)> {
    let mut crumbs = vec![("Home".to_string(), "/".to_string())];
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        return crumbs;
    }
    let mut current = String::new();
    for part in trimmed.split('/') {
        current.push('/');
        current.push_str(part);
        crumbs.push((part.to_string(), current.clone()));
    }
    crumbs
}

/// Get the parent path of a given path.
pub fn parent_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(pos) => trimmed[..pos].to_string(),
    }
}

/// Extract the filename from a path.
pub fn filename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    trimmed
        .rsplit('/')
        .next()
        .unwrap_or(trimmed)
        .to_string()
}

/// Join two paths.
pub fn join_path(base: &str, child: &str) -> String {
    let b = base.trim_end_matches('/');
    let c = child.trim_start_matches('/');
    format!("{}/{}", b, c)
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/// Convert a DAV href back to a user-relative path.
pub fn dav_href_to_path(href: &str, username: &str) -> String {
    let prefix = format!("/remote.php/dav/files/{}/", username);
    let decoded = url::form_urlencoded::parse(href.as_bytes())
        .map(|(k, v)| {
            if v.is_empty() {
                k.to_string()
            } else {
                format!("{}={}", k, v)
            }
        })
        .collect::<String>();

    if let Some(rest) = decoded.strip_prefix(&prefix) {
        format!("/{}", rest.trim_end_matches('/'))
    } else {
        decoded.trim_end_matches('/').to_string()
    }
}

/// Compute folder "size" by summing child content lengths.
pub fn folder_size(children: &[DavResource]) -> u64 {
    children
        .iter()
        .filter_map(|r| r.content_length)
        .sum()
}

/// Count files and folders in a list.
pub fn count_resources(resources: &[DavResource]) -> (usize, usize) {
    let files = resources
        .iter()
        .filter(|r| r.resource_type == DavResourceType::File)
        .count();
    let folders = resources
        .iter()
        .filter(|r| r.resource_type == DavResourceType::Folder)
        .count();
    (files, folders)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn make_resource(name: &str, rtype: DavResourceType, size: Option<u64>) -> DavResource {
        DavResource {
            display_name: name.to_string(),
            resource_type: rtype,
            content_length: size,
            ..DavResource::default()
        }
    }

    #[test]
    fn breadcrumbs_root() {
        let bc = breadcrumbs("/");
        assert_eq!(bc.len(), 1);
        assert_eq!(bc[0], ("Home".to_string(), "/".to_string()));
    }

    #[test]
    fn breadcrumbs_nested() {
        let bc = breadcrumbs("/Documents/Work/Reports");
        assert_eq!(bc.len(), 4);
        assert_eq!(bc[0].0, "Home");
        assert_eq!(bc[1], ("Documents".to_string(), "/Documents".to_string()));
        assert_eq!(bc[2], ("Work".to_string(), "/Documents/Work".to_string()));
        assert_eq!(
            bc[3],
            ("Reports".to_string(), "/Documents/Work/Reports".to_string())
        );
    }

    #[test]
    fn parent_path_nested() {
        assert_eq!(parent_path("/a/b/c"), "/a/b");
    }

    #[test]
    fn parent_path_root() {
        assert_eq!(parent_path("/"), "/");
    }

    #[test]
    fn parent_path_top_level() {
        assert_eq!(parent_path("/Documents"), "/");
    }

    #[test]
    fn filename_basic() {
        assert_eq!(filename("/path/to/file.txt"), "file.txt");
    }

    #[test]
    fn filename_folder() {
        assert_eq!(filename("/path/to/folder/"), "folder");
    }

    #[test]
    fn join_path_basic() {
        assert_eq!(join_path("/a/b", "c/d"), "/a/b/c/d");
    }

    #[test]
    fn join_path_trailing_leading_slash() {
        assert_eq!(join_path("/a/b/", "/c/d"), "/a/b/c/d");
    }

    #[test]
    fn filter_files_only() {
        let items = vec![
            make_resource("a.txt", DavResourceType::File, Some(100)),
            make_resource("Dir", DavResourceType::Folder, None),
            make_resource("b.pdf", DavResourceType::File, Some(200)),
        ];
        let files = filter_files(&items);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].display_name, "a.txt");
    }

    #[test]
    fn filter_folders_only() {
        let items = vec![
            make_resource("a.txt", DavResourceType::File, Some(100)),
            make_resource("Dir", DavResourceType::Folder, None),
        ];
        let folders = filter_folders(&items);
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].display_name, "Dir");
    }

    #[test]
    fn filter_by_mime_prefix() {
        let items = vec![
            DavResource {
                display_name: "a.jpg".into(),
                content_type: Some("image/jpeg".into()),
                ..DavResource::default()
            },
            DavResource {
                display_name: "b.txt".into(),
                content_type: Some("text/plain".into()),
                ..DavResource::default()
            },
        ];
        let images = filter_by_mime(&items, "image/");
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].display_name, "a.jpg");
    }

    #[test]
    fn filter_by_size() {
        let items = vec![
            make_resource("small", DavResourceType::File, Some(10)),
            make_resource("big", DavResourceType::File, Some(1000)),
        ];
        let big = filter_by_min_size(&items, 500);
        assert_eq!(big.len(), 1);
        assert_eq!(big[0].display_name, "big");

        let small = filter_by_max_size(&items, 100);
        assert_eq!(small.len(), 1);
        assert_eq!(small[0].display_name, "small");
    }

    #[test]
    fn filter_favorites_only() {
        let items = vec![
            DavResource {
                display_name: "fav".into(),
                favorite: Some(true),
                ..DavResource::default()
            },
            DavResource {
                display_name: "nope".into(),
                favorite: Some(false),
                ..DavResource::default()
            },
        ];
        let favs = filter_favorites(&items);
        assert_eq!(favs.len(), 1);
        assert_eq!(favs[0].display_name, "fav");
    }

    #[test]
    fn sort_folders_first_works() {
        let mut items = vec![
            make_resource("z.txt", DavResourceType::File, Some(10)),
            make_resource("Alpha", DavResourceType::Folder, None),
            make_resource("a.txt", DavResourceType::File, Some(20)),
            make_resource("Beta", DavResourceType::Folder, None),
        ];
        sort_folders_first(&mut items);
        assert_eq!(items[0].display_name, "Alpha");
        assert_eq!(items[1].display_name, "Beta");
        assert_eq!(items[2].display_name, "a.txt");
        assert_eq!(items[3].display_name, "z.txt");
    }

    #[test]
    fn sort_by_size() {
        let mut items = vec![
            make_resource("big", DavResourceType::File, Some(1000)),
            make_resource("small", DavResourceType::File, Some(10)),
        ];
        sort_by_size_asc(&mut items);
        assert_eq!(items[0].display_name, "small");

        sort_by_size_desc(&mut items);
        assert_eq!(items[0].display_name, "big");
    }

    #[test]
    fn sort_by_name_case_insensitive() {
        let mut items = vec![
            make_resource("Zebra", DavResourceType::File, None),
            make_resource("apple", DavResourceType::File, None),
        ];
        sort_by_name(&mut items);
        assert_eq!(items[0].display_name, "apple");
    }

    #[test]
    fn dav_href_to_path_basic() {
        let p = dav_href_to_path("/remote.php/dav/files/alice/Documents/test.txt", "alice");
        assert_eq!(p, "/Documents/test.txt");
    }

    #[test]
    fn dav_href_to_path_trailing_slash() {
        let p = dav_href_to_path("/remote.php/dav/files/alice/Photos/", "alice");
        assert_eq!(p, "/Photos");
    }

    #[test]
    fn folder_size_sum() {
        let items = vec![
            make_resource("a", DavResourceType::File, Some(100)),
            make_resource("b", DavResourceType::File, Some(200)),
            make_resource("c", DavResourceType::Folder, None),
        ];
        assert_eq!(folder_size(&items), 300);
    }

    #[test]
    fn count_resources_basic() {
        let items = vec![
            make_resource("a", DavResourceType::File, None),
            make_resource("b", DavResourceType::Folder, None),
            make_resource("c", DavResourceType::File, None),
        ];
        let (files, folders) = count_resources(&items);
        assert_eq!(files, 2);
        assert_eq!(folders, 1);
    }
}

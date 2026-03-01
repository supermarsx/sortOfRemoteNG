use crate::lastpass::types::{Account, Folder, LastPassError};
use crate::lastpass::vault_parser::FolderEntry;

/// Build folder list from vault parsed entries and accounts.
pub fn build_folder_list(
    folder_entries: &[FolderEntry],
    accounts: &[Account],
) -> Vec<Folder> {
    use std::collections::HashMap;

    // Count items per folder/group
    let mut counts: HashMap<String, u64> = HashMap::new();
    for account in accounts {
        let group = if account.group.is_empty() {
            "(None)".to_string()
        } else {
            account.group.clone()
        };
        *counts.entry(group).or_default() += 1;
    }

    let mut folders: Vec<Folder> = folder_entries
        .iter()
        .enumerate()
        .map(|(idx, entry)| {
            let count = counts.get(&entry.name).copied().unwrap_or(0);
            Folder {
                id: format!("folder_{}", idx),
                name: entry.name.clone(),
                parent_id: extract_parent(&entry.name),
                is_shared: entry.is_shared,
                item_count: count,
            }
        })
        .collect();

    // Also add groups from accounts that don't have explicit folder entries
    let folder_names: std::collections::HashSet<String> =
        folder_entries.iter().map(|f| f.name.clone()).collect();

    for (group, count) in &counts {
        if group != "(None)" && !folder_names.contains(group) {
            folders.push(Folder {
                id: format!("folder_auto_{}", group.replace('/', "_")),
                name: group.clone(),
                parent_id: extract_parent(group),
                is_shared: false,
                item_count: *count,
            });
        }
    }

    folders.sort_by(|a, b| a.name.cmp(&b.name));
    folders
}

/// Extract parent folder name from a path like "Parent/Child".
fn extract_parent(name: &str) -> Option<String> {
    if let Some(pos) = name.rfind('/') {
        if pos > 0 {
            return Some(name[..pos].to_string());
        }
    }
    if let Some(pos) = name.rfind('\\') {
        if pos > 0 {
            return Some(name[..pos].to_string());
        }
    }
    None
}

/// Find a folder by name (case-insensitive).
pub fn find_folder_by_name<'a>(folders: &'a [Folder], name: &str) -> Option<&'a Folder> {
    folders
        .iter()
        .find(|f| f.name.eq_ignore_ascii_case(name))
}

/// Get all child folders of a given parent.
pub fn get_child_folders(folders: &[Folder], parent_name: &str) -> Vec<Folder> {
    folders
        .iter()
        .filter(|f| {
            f.parent_id
                .as_ref()
                .map(|p| p.eq_ignore_ascii_case(parent_name))
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}

/// Get top-level folders (no parent).
pub fn get_root_folders(folders: &[Folder]) -> Vec<Folder> {
    folders
        .iter()
        .filter(|f| f.parent_id.is_none())
        .cloned()
        .collect()
}

/// Get shared folders only.
pub fn get_shared_folders(folders: &[Folder]) -> Vec<Folder> {
    folders
        .iter()
        .filter(|f| f.is_shared)
        .cloned()
        .collect()
}

/// Rename a folder by updating all accounts in that group.
pub fn rename_folder_in_accounts(
    accounts: &mut [Account],
    old_name: &str,
    new_name: &str,
) {
    for account in accounts.iter_mut() {
        if account.group.eq_ignore_ascii_case(old_name) {
            account.group = new_name.to_string();
            account.folder_id = Some(new_name.to_string());
        } else if account.group.starts_with(&format!("{}/", old_name)) {
            account.group = account
                .group
                .replacen(old_name, new_name, 1);
            account.folder_id = Some(account.group.clone());
        }
    }
}

use crate::lastpass::types::{Account, SharedFolder, SharedFolderMember, LastPassError};

/// Check if an account is in a shared folder.
pub fn is_shared(account: &Account) -> bool {
    account.group.contains("Shared-")
}

/// Get the shared folder name from an account group path.
pub fn get_shared_folder_name(group: &str) -> Option<String> {
    if group.starts_with("Shared-") {
        let name = group
            .strip_prefix("Shared-")
            .unwrap_or(group)
            .split('/')
            .next()
            .unwrap_or("");
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    None
}

/// Filter accounts that are in shared folders.
pub fn get_shared_accounts(accounts: &[Account]) -> Vec<Account> {
    accounts
        .iter()
        .filter(|a| is_shared(a))
        .cloned()
        .collect()
}

/// Filter accounts that are NOT in shared folders (personal vault).
pub fn get_personal_accounts(accounts: &[Account]) -> Vec<Account> {
    accounts
        .iter()
        .filter(|a| !is_shared(a))
        .cloned()
        .collect()
}

/// Group accounts by their shared folder.
pub fn group_by_shared_folder(accounts: &[Account]) -> Vec<(String, Vec<Account>)> {
    use std::collections::HashMap;

    let mut groups: HashMap<String, Vec<Account>> = HashMap::new();
    for account in accounts {
        if let Some(folder_name) = get_shared_folder_name(&account.group) {
            groups
                .entry(folder_name)
                .or_default()
                .push(account.clone());
        }
    }

    let mut result: Vec<_> = groups.into_iter().collect();
    result.sort_by(|a, b| a.0.cmp(&b.0));
    result
}

/// Check if a member has write access to a shared folder.
pub fn member_can_write(member: &SharedFolderMember) -> bool {
    !member.read_only || member.admin
}

/// Check if a member can see passwords.
pub fn member_can_see_passwords(member: &SharedFolderMember) -> bool {
    !member.hide_passwords || member.admin
}

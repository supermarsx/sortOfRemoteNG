use crate::lastpass::types::{Account, CreateAccountRequest, LastPassError, UpdateAccountRequest, AccountListParams};

/// Filter accounts by search parameters.
pub fn filter_accounts(accounts: &[Account], params: &AccountListParams) -> Vec<Account> {
    accounts
        .iter()
        .filter(|a| {
            if params.favorites_only && !a.favorite {
                return false;
            }
            if let Some(ref folder) = params.folder {
                if !a.group.eq_ignore_ascii_case(folder) {
                    return false;
                }
            }
            if let Some(ref search) = params.search {
                let search_lower = search.to_lowercase();
                let matches = a.name.to_lowercase().contains(&search_lower)
                    || a.url.to_lowercase().contains(&search_lower)
                    || a.username.to_lowercase().contains(&search_lower)
                    || a.notes.to_lowercase().contains(&search_lower);
                if !matches {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect()
}

/// Find an account by ID.
pub fn find_account_by_id<'a>(accounts: &'a [Account], id: &str) -> Option<&'a Account> {
    accounts.iter().find(|a| a.id == id)
}

/// Find accounts by URL (partial match).
pub fn find_accounts_by_url(accounts: &[Account], url: &str) -> Vec<Account> {
    let url_lower = url.to_lowercase();
    accounts
        .iter()
        .filter(|a| a.url.to_lowercase().contains(&url_lower))
        .cloned()
        .collect()
}

/// Find accounts by name (case-insensitive partial match).
pub fn find_accounts_by_name(accounts: &[Account], name: &str) -> Vec<Account> {
    let name_lower = name.to_lowercase();
    accounts
        .iter()
        .filter(|a| a.name.to_lowercase().contains(&name_lower))
        .cloned()
        .collect()
}

/// Get all duplicate passwords (accounts that share the same password).
pub fn find_duplicate_passwords(accounts: &[Account]) -> Vec<Vec<Account>> {
    use std::collections::HashMap;

    let mut by_password: HashMap<String, Vec<Account>> = HashMap::new();
    for account in accounts {
        if !account.password.is_empty() {
            by_password
                .entry(account.password.clone())
                .or_default()
                .push(account.clone());
        }
    }

    by_password
        .into_values()
        .filter(|group| group.len() > 1)
        .collect()
}

/// Get all accounts in a given folder/group.
pub fn get_accounts_in_folder(accounts: &[Account], folder: &str) -> Vec<Account> {
    accounts
        .iter()
        .filter(|a| a.group.eq_ignore_ascii_case(folder))
        .cloned()
        .collect()
}

/// Get all favorite accounts.
pub fn get_favorites(accounts: &[Account]) -> Vec<Account> {
    accounts.iter().filter(|a| a.favorite).cloned().collect()
}

/// Convert a CreateAccountRequest into data suitable for API submission.
pub fn prepare_create_account(req: &CreateAccountRequest) -> Account {
    Account {
        id: String::new(),
        name: req.name.clone(),
        url: req.url.clone(),
        username: req.username.clone(),
        password: req.password.clone(),
        notes: req.notes.clone().unwrap_or_default(),
        group: req.group.clone().unwrap_or_default(),
        folder_id: req.group.clone(),
        favorite: req.favorite.unwrap_or(false),
        auto_login: req.auto_login.unwrap_or(false),
        never_autofill: false,
        realm: None,
        totp_secret: req.totp_secret.clone(),
        last_modified: None,
        last_touched: None,
        pwprotect: false,
        custom_fields: req.custom_fields.clone().unwrap_or_default(),
    }
}

/// Apply updates from an UpdateAccountRequest to an existing account.
pub fn apply_update(existing: &Account, update: &UpdateAccountRequest) -> Account {
    Account {
        id: existing.id.clone(),
        name: update.name.clone().unwrap_or_else(|| existing.name.clone()),
        url: update.url.clone().unwrap_or_else(|| existing.url.clone()),
        username: update
            .username
            .clone()
            .unwrap_or_else(|| existing.username.clone()),
        password: update
            .password
            .clone()
            .unwrap_or_else(|| existing.password.clone()),
        notes: update
            .notes
            .clone()
            .unwrap_or_else(|| existing.notes.clone()),
        group: update
            .group
            .clone()
            .unwrap_or_else(|| existing.group.clone()),
        folder_id: update
            .group
            .clone()
            .or_else(|| existing.folder_id.clone()),
        favorite: update.favorite.unwrap_or(existing.favorite),
        auto_login: update.auto_login.unwrap_or(existing.auto_login),
        never_autofill: existing.never_autofill,
        realm: existing.realm.clone(),
        totp_secret: update
            .totp_secret
            .clone()
            .or_else(|| existing.totp_secret.clone()),
        last_modified: existing.last_modified.clone(),
        last_touched: existing.last_touched.clone(),
        pwprotect: existing.pwprotect,
        custom_fields: update
            .custom_fields
            .clone()
            .unwrap_or_else(|| existing.custom_fields.clone()),
    }
}

/// Count total accounts by group.
pub fn count_by_group(accounts: &[Account]) -> Vec<(String, usize)> {
    use std::collections::HashMap;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for account in accounts {
        let group = if account.group.is_empty() {
            "(None)".to_string()
        } else {
            account.group.clone()
        };
        *counts.entry(group).or_default() += 1;
    }
    let mut result: Vec<_> = counts.into_iter().collect();
    result.sort_by(|a, b| b.1.cmp(&a.1));
    result
}

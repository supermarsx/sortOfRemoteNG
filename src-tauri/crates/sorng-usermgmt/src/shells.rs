//! Shell management — list available shells, validate, change.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;

/// List available login shells from /etc/shells.
pub async fn list_shells(host: &UserMgmtHost) -> Result<Vec<LoginShell>, UserMgmtError> {
    let content = client::read_file(host, "/etc/shells").await?;
    Ok(parse_shells(&content))
}

fn parse_shells(content: &str) -> Vec<LoginShell> {
    content
        .lines()
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|path| {
            let name = path.rsplit('/').next().unwrap_or(path).to_string();
            LoginShell {
                path: path.trim().to_string(),
                name,
                exists: true, // would verify on actual host
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_shells() {
        let content = "# /etc/shells\n/bin/sh\n/bin/bash\n/usr/bin/zsh\n/usr/bin/fish\n";
        let shells = parse_shells(content);
        assert_eq!(shells.len(), 4);
        assert_eq!(shells[0].path, "/bin/sh");
        assert_eq!(shells[0].name, "sh");
        assert_eq!(shells[2].path, "/usr/bin/zsh");
        assert_eq!(shells[2].name, "zsh");
    }
}

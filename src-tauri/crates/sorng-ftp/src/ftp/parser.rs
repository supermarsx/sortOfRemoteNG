//! LIST / MLSD response parser.
//!
//! Supports three formats:
//! 1. **Unix-style** (`ls -l`): `-rwxr-xr-x 1 owner group 1234 Jan  1 12:00 file.txt`
//! 2. **Windows/IIS-style**: `01-01-26  12:00AM       1234 file.txt`
//! 3. **MLSD facts** (RFC 3659): `type=file;size=1234;modify=20260101120000; file.txt`
//!
//! The parser tries MLSD first (if the raw line contains `=` and `;`),
//! then Unix, then Windows, falling back to a raw entry.

use crate::ftp::types::{FtpEntry, FtpEntryKind};
use chrono::{DateTime, NaiveDateTime, Utc, TimeZone, NaiveDate, NaiveTime};
use regex::Regex;
use std::collections::HashMap;

/// Parse a full multi-line LIST or MLSD response body.
pub fn parse_listing(raw: &str) -> Vec<FtpEntry> {
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| parse_line(line.trim()))
        .filter(|e| e.name != "." && e.name != "..")
        .collect()
}

/// Parse a single line from a listing.
fn parse_line(line: &str) -> Option<FtpEntry> {
    // Try MLSD first (contains ";")
    if line.contains(';') && line.contains('=') {
        if let Some(e) = parse_mlsd(line) {
            return Some(e);
        }
    }

    // Try Unix-style
    if let Some(e) = parse_unix(line) {
        return Some(e);
    }

    // Try Windows-style
    if let Some(e) = parse_windows(line) {
        return Some(e);
    }

    // Fallback: treat the whole line as a filename
    Some(FtpEntry {
        name: line.to_string(),
        kind: FtpEntryKind::Unknown,
        size: 0,
        modified: None,
        permissions: None,
        owner: None,
        group: None,
        link_target: None,
        raw: Some(line.to_string()),
        facts: HashMap::new(),
    })
}

// ─── MLSD parser ─────────────────────────────────────────────────────

/// Parse MLSD fact-line: `fact1=val1;fact2=val2; filename`
fn parse_mlsd(line: &str) -> Option<FtpEntry> {
    // The last space-preceded token after "; " is the filename.
    let (facts_str, name) = if let Some(pos) = line.find("; ") {
        (&line[..pos + 1], line[pos + 2..].to_string())
    } else if let Some(pos) = line.rfind(' ') {
        (&line[..pos], line[pos + 1..].to_string())
    } else {
        return None;
    };

    if name.is_empty() {
        return None;
    }

    let mut facts: HashMap<String, String> = HashMap::new();
    for segment in facts_str.split(';') {
        let segment = segment.trim();
        if let Some((k, v)) = segment.split_once('=') {
            facts.insert(k.to_lowercase(), v.to_string());
        }
    }

    let kind = match facts.get("type").map(|s| s.to_lowercase()).as_deref() {
        Some("dir") | Some("cdir") | Some("pdir") => FtpEntryKind::Directory,
        Some("file") => FtpEntryKind::File,
        Some("os.unix=symlink") | Some("os.unix=slink") => FtpEntryKind::Symlink,
        _ => FtpEntryKind::Unknown,
    };

    let size = facts
        .get("size")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    let modified = facts.get("modify").and_then(|v| parse_mlsd_time(v));

    Some(FtpEntry {
        name,
        kind,
        size,
        modified,
        permissions: facts.get("unix.mode").cloned(),
        owner: facts.get("unix.owner").cloned(),
        group: facts.get("unix.group").cloned(),
        link_target: None,
        raw: Some(line.to_string()),
        facts,
    })
}

/// Parse MLSD timestamp: `YYYYMMDDHHmmSS[.fraction]`
fn parse_mlsd_time(s: &str) -> Option<DateTime<Utc>> {
    let base = if s.len() >= 14 { &s[..14] } else { s };
    NaiveDateTime::parse_from_str(base, "%Y%m%d%H%M%S")
        .ok()
        .map(|dt| Utc.from_utc_datetime(&dt))
}

// ─── Unix-style parser ───────────────────────────────────────────────

/// Parse a Unix `ls -l` line:
/// ```text
/// drwxr-xr-x   2 user group  4096 Jan  1 12:00 dirname
/// -rw-r--r--   1 user group  1234 Jan  1  2025 file.txt
/// lrwxrwxrwx   1 user group    42 Jan  1 12:00 link -> target
/// ```
fn parse_unix(line: &str) -> Option<FtpEntry> {
    let re = Regex::new(
        r"(?x)
        ^([dlcbps-][rwxsStT-]{9})\s+   # permissions
        (\d+)\s+                         # link count
        (\S+)\s+                         # owner
        (\S+)\s+                         # group
        (\d+)\s+                         # size
        (\w{3}\s+\d{1,2}\s+[\d:]+)\s+   # date
        (.+)$                            # filename (possibly with -> target)
        ",
    )
    .ok()?;

    let caps = re.captures(line)?;

    let perms = caps.get(1)?.as_str();
    let owner = caps.get(3).map(|m| m.as_str().to_string());
    let group = caps.get(4).map(|m| m.as_str().to_string());
    let size = caps.get(5)?.as_str().parse::<u64>().unwrap_or(0);
    let date_str = caps.get(6)?.as_str();
    let name_raw = caps.get(7)?.as_str();

    let kind = match perms.as_bytes().first() {
        Some(b'd') => FtpEntryKind::Directory,
        Some(b'l') => FtpEntryKind::Symlink,
        Some(b'-') => FtpEntryKind::File,
        _ => FtpEntryKind::Unknown,
    };

    let (name, link_target) = if kind == FtpEntryKind::Symlink {
        if let Some(pos) = name_raw.find(" -> ") {
            (
                name_raw[..pos].to_string(),
                Some(name_raw[pos + 4..].to_string()),
            )
        } else {
            (name_raw.to_string(), None)
        }
    } else {
        (name_raw.to_string(), None)
    };

    let modified = parse_unix_date(date_str);

    Some(FtpEntry {
        name,
        kind,
        size,
        modified,
        permissions: Some(perms.to_string()),
        owner,
        group,
        link_target,
        raw: Some(line.to_string()),
        facts: HashMap::new(),
    })
}

/// Parse the date portion: "Jan  1 12:00" or "Jan  1  2025"
fn parse_unix_date(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();

    // Try "Jan  1 12:00" (current year implied)
    if let Ok(dt) = NaiveDateTime::parse_from_str(
        &format!("{} {}", Utc::now().format("%Y"), s),
        "%Y %b %d %H:%M",
    ) {
        return Some(Utc.from_utc_datetime(&dt));
    }

    // Normalise double-spaces
    let normalised: String = s
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    // Try "Jan 1 12:00"
    if let Ok(dt) = NaiveDateTime::parse_from_str(
        &format!("{} {}", Utc::now().format("%Y"), normalised),
        "%Y %b %d %H:%M",
    ) {
        return Some(Utc.from_utc_datetime(&dt));
    }

    // Try "Jan 1 2025" (no time)
    if let Ok(date) = NaiveDate::parse_from_str(&normalised, "%b %d %Y") {
        let dt = date.and_time(NaiveTime::from_hms_opt(0, 0, 0)?);
        return Some(Utc.from_utc_datetime(&dt));
    }

    None
}

// ─── Windows-style parser ────────────────────────────────────────────

/// Parse Windows / IIS style line:
/// ```text
/// 01-01-26  12:00AM       1234 file.txt
/// 01-01-26  12:00PM      <DIR> Directory Name
/// ```
fn parse_windows(line: &str) -> Option<FtpEntry> {
    let re = Regex::new(
        r"(?x)
        ^(\d{2}-\d{2}-\d{2})\s+         # date
        (\d{1,2}:\d{2}(?:AM|PM)?)\s+    # time
        (<DIR>|\d+)\s+                   # size or <DIR>
        (.+)$                            # filename
        ",
    )
    .ok()?;

    let caps = re.captures(line)?;

    let date_str = caps.get(1)?.as_str();
    let time_str = caps.get(2)?.as_str();
    let size_or_dir = caps.get(3)?.as_str();
    let name = caps.get(4)?.as_str().to_string();

    let (kind, size) = if size_or_dir == "<DIR>" {
        (FtpEntryKind::Directory, 0)
    } else {
        (
            FtpEntryKind::File,
            size_or_dir.parse::<u64>().unwrap_or(0),
        )
    };

    let modified = parse_windows_date(date_str, time_str);

    Some(FtpEntry {
        name,
        kind,
        size,
        modified,
        permissions: None,
        owner: None,
        group: None,
        link_target: None,
        raw: Some(line.to_string()),
        facts: HashMap::new(),
    })
}

fn parse_windows_date(date: &str, time: &str) -> Option<DateTime<Utc>> {
    let combined = format!("{} {}", date, time);
    // Try with AM/PM
    if let Ok(dt) = NaiveDateTime::parse_from_str(&combined, "%m-%d-%y %I:%M%p") {
        return Some(Utc.from_utc_datetime(&dt));
    }
    // Try 24-hour
    if let Ok(dt) = NaiveDateTime::parse_from_str(&combined, "%m-%d-%y %H:%M") {
        return Some(Utc.from_utc_datetime(&dt));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unix_file() {
        let line = "-rw-r--r--   1 user group  1234 Jan  1 12:00 readme.txt";
        let entries = parse_listing(line);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "readme.txt");
        assert_eq!(entries[0].kind, FtpEntryKind::File);
        assert_eq!(entries[0].size, 1234);
    }

    #[test]
    fn test_unix_dir() {
        let line = "drwxr-xr-x   2 root root  4096 Mar  1 09:30 subdir";
        let entries = parse_listing(line);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, FtpEntryKind::Directory);
    }

    #[test]
    fn test_unix_symlink() {
        let line = "lrwxrwxrwx   1 root root    22 Jan  5 08:00 link -> /var/target";
        let entries = parse_listing(line);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, FtpEntryKind::Symlink);
        assert_eq!(entries[0].link_target.as_deref(), Some("/var/target"));
    }

    #[test]
    fn test_mlsd() {
        let line = "type=file;size=1024;modify=20260101120000; example.bin";
        let entries = parse_listing(line);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "example.bin");
        assert_eq!(entries[0].kind, FtpEntryKind::File);
        assert_eq!(entries[0].size, 1024);
    }

    #[test]
    fn test_filters_dots() {
        let raw = "type=dir;; .\ntype=dir;; ..\ntype=file;size=10;; real.txt";
        let entries = parse_listing(raw);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "real.txt");
    }

    #[test]
    fn test_windows_dir() {
        let line = "01-01-26  12:00AM      <DIR> My Documents";
        let entries = parse_listing(line);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, FtpEntryKind::Directory);
        assert_eq!(entries[0].name, "My Documents");
    }
}

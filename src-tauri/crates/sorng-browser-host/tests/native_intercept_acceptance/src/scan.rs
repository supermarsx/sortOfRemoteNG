//! "No CA or leaf file anywhere on disk": search files for the attempt CAs and
//! every leaf the proxy minted, as raw DER, as one base64 string and as the
//! second and third 64-column PEM lines (distinctive: subject, key, serial).
use base64::Engine;
use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

const MAX_FILE: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 50_000;

pub struct Needles(Vec<Vec<u8>>);

impl Needles {
    pub fn new<'a>(certificates: impl IntoIterator<Item = &'a [u8]>) -> Self {
        let mut needles = vec![];
        for der in certificates {
            if der.len() < 64 {
                continue;
            }
            let text = base64::engine::general_purpose::STANDARD.encode(der);
            needles.push(der.to_vec());
            needles.push(text.as_bytes().to_vec());
            for line in [1, 2] {
                let start = line * 64;
                if text.len() >= start + 64 {
                    needles.push(text.as_bytes()[start..start + 64].to_vec());
                }
            }
        }
        needles.sort();
        needles.dedup();
        Self(needles)
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn found_in(&self, bytes: &[u8]) -> bool {
        self.0.iter().any(|needle| {
            bytes
                .windows(needle.len())
                .any(|window| window == needle.as_slice())
        })
    }
}

#[derive(Default)]
pub struct Scan {
    pub files: usize,
    pub bytes: u64,
    pub skipped: usize,
    pub unreadable: usize,
    pub truncated: bool,
    pub hits: Vec<String>,
}

/// Walks `root` without following links. With `since`, only files modified
/// at or after it are read (used for the shared temp directory).
pub fn scan(root: &Path, needles: &Needles, since: Option<SystemTime>, scan: &mut Scan) {
    let mut pending: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            scan.unreadable += 1;
            continue;
        };
        for entry in entries.flatten() {
            if scan.files >= MAX_FILES {
                scan.truncated = true;
                return;
            }
            let Ok(kind) = entry.file_type() else {
                scan.unreadable += 1;
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                pending.push(path);
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                scan.unreadable += 1;
                continue;
            };
            if since.is_some_and(|since| metadata.modified().map_or(true, |m| m < since)) {
                continue;
            }
            if metadata.len() > MAX_FILE {
                scan.skipped += 1;
                continue;
            }
            match std::fs::read(&path) {
                Ok(bytes) => {
                    scan.files += 1;
                    scan.bytes += bytes.len() as u64;
                    if needles.found_in(&bytes) {
                        scan.hits.push(
                            path.strip_prefix(root)
                                .unwrap_or(&path)
                                .to_string_lossy()
                                .replace('\\', "/"),
                        );
                    }
                }
                Err(_) => scan.unreadable += 1,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_der_base64_and_pem_lines_but_not_unrelated_bytes() {
        let der: Vec<u8> = (0..300u32).map(|i| (i * 7 % 251) as u8).collect();
        let needles = Needles::new([der.as_slice()]);
        assert_eq!(needles.len(), 4);
        let mut file = b"prefix".to_vec();
        file.extend_from_slice(&der);
        assert!(needles.found_in(&file));
        let text = base64::engine::general_purpose::STANDARD.encode(&der);
        let pem: String = text
            .as_bytes()
            .chunks(64)
            .map(|c| format!("{}\n", std::str::from_utf8(c).unwrap()))
            .collect();
        assert!(needles.found_in(pem.as_bytes()));
        assert!(!needles.found_in(&der[..200]));
        assert!(!needles.found_in(b"nothing here"));
    }

    #[test]
    fn scan_reports_relative_hits_only_for_matching_files() {
        let root =
            std::env::temp_dir().join(format!("sorng-intercept-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        let der: Vec<u8> = (0..200u32).map(|i| (i * 13 % 253) as u8).collect();
        std::fs::write(root.join("a/b/leaf.der"), &der).unwrap();
        std::fs::write(root.join("a/clean.txt"), b"clean").unwrap();
        let mut result = Scan::default();
        scan(&root, &Needles::new([der.as_slice()]), None, &mut result);
        assert_eq!(result.files, 2);
        assert_eq!(result.hits, vec!["a/b/leaf.der".to_owned()]);
        std::fs::remove_dir_all(&root).unwrap();
    }
}

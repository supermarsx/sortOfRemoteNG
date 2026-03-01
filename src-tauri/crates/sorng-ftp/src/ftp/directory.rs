//! Directory operations — list, mkdir, rmdir, rename, etc.

use crate::ftp::client::FtpClient;
use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::types::*;

impl FtpClient {
    // ─── MKD ─────────────────────────────────────────────────────

    /// Create a directory on the remote server.
    pub async fn mkdir(&mut self, path: &str) -> FtpResult<String> {
        let resp = self.codec.expect_ok(&format!("MKD {}", path)).await?;
        self.touch();
        // Parse the created path from "257 \"/new/dir\" created"
        let text = resp.text();
        if let Some(start) = text.find('"') {
            if let Some(end) = text[start + 1..].find('"') {
                return Ok(text[start + 1..start + 1 + end].to_string());
            }
        }
        Ok(path.to_string())
    }

    /// Create a directory and all missing parents (emulated – FTP has no MKDIRP).
    pub async fn mkdir_all(&mut self, path: &str) -> FtpResult<()> {
        let components: Vec<&str> = path
            .split('/')
            .filter(|c| !c.is_empty())
            .collect();

        let mut current = String::new();
        if path.starts_with('/') {
            current.push('/');
        }

        for component in &components {
            if current.ends_with('/') {
                current.push_str(component);
            } else {
                current.push('/');
                current.push_str(component);
            }

            // Try to CWD into it — if it fails, create it.
            let cwd_resp = self.codec.execute(&format!("CWD {}", current)).await?;
            if !cwd_resp.is_success() {
                let mkd_resp = self.codec.execute(&format!("MKD {}", current)).await?;
                if !mkd_resp.is_success() && mkd_resp.code != 550 {
                    return Err(FtpError::from_reply(mkd_resp.code, &mkd_resp.text()));
                }
            }
        }

        self.touch();
        Ok(())
    }

    // ─── RMD ─────────────────────────────────────────────────────

    /// Remove an empty directory.
    pub async fn rmdir(&mut self, path: &str) -> FtpResult<()> {
        self.codec
            .expect_ok(&format!("RMD {}", path))
            .await?;
        self.touch();
        Ok(())
    }

    /// Recursively remove a directory and all its contents.
    pub async fn rmdir_recursive(&mut self, path: &str) -> FtpResult<()> {
        let entries = self.list(Some(path), true).await?;

        for entry in entries {
            let full_path = if path.ends_with('/') {
                format!("{}{}", path, entry.name)
            } else {
                format!("{}/{}", path, entry.name)
            };

            match entry.kind {
                FtpEntryKind::Directory => {
                    Box::pin(self.rmdir_recursive(&full_path)).await?;
                }
                _ => {
                    self.delete(&full_path).await?;
                }
            }
        }

        self.rmdir(path).await
    }

    // ─── RNFR / RNTO ────────────────────────────────────────────

    /// Rename (or move) a file or directory.
    pub async fn rename(&mut self, from: &str, to: &str) -> FtpResult<()> {
        let rnfr = self.codec.execute(&format!("RNFR {}", from)).await?;
        if !rnfr.is_intermediate() && !rnfr.is_success() {
            return Err(FtpError::from_reply(rnfr.code, &rnfr.text()));
        }
        self.codec
            .expect_ok(&format!("RNTO {}", to))
            .await?;
        self.touch();
        Ok(())
    }

    // ─── DELE ────────────────────────────────────────────────────

    /// Delete a remote file.
    pub async fn delete(&mut self, path: &str) -> FtpResult<()> {
        self.codec
            .expect_ok(&format!("DELE {}", path))
            .await?;
        self.touch();
        Ok(())
    }

    // ─── MLST (single entry info) ───────────────────────────────

    /// Get facts about a single file/directory via MLST (RFC 3659).
    pub async fn stat_entry(&mut self, path: &str) -> FtpResult<FtpEntry> {
        if !self.features.mlst {
            return Err(FtpError::unsupported("Server does not support MLST"));
        }

        let resp = self.codec.expect_ok(&format!("MLST {}", path)).await?;
        // MLST response comes in the control channel (between 250 lines):
        // 250-Listing /foo
        //  type=file;size=1234;modify=20260101120000; foo.txt
        // 250 End
        let entry_line = resp
            .lines
            .iter()
            .find(|l| l.trim_start().contains('=') && l.contains(';'))
            .ok_or_else(|| FtpError::protocol_error("MLST: no fact line in response"))?;

        let entries = crate::ftp::parser::parse_listing(entry_line.trim());
        entries
            .into_iter()
            .next()
            .ok_or_else(|| FtpError::protocol_error("MLST: empty parsed result"))
    }

    // ─── MFMT (set modification time) ───────────────────────────

    /// Set the modification time of a remote file (RFC 3659 MFMT).
    pub async fn set_modified(
        &mut self,
        path: &str,
        timestamp: &str,
    ) -> FtpResult<()> {
        if !self.features.mfmt {
            return Err(FtpError::unsupported("Server does not support MFMT"));
        }
        self.codec
            .expect_ok(&format!("MFMT {} {}", timestamp, path))
            .await?;
        self.touch();
        Ok(())
    }

    // ─── SITE CHMOD ─────────────────────────────────────────────

    /// Change file permissions via SITE CHMOD (common but not standard).
    pub async fn chmod(&mut self, path: &str, mode: &str) -> FtpResult<()> {
        self.codec
            .expect_ok(&format!("SITE CHMOD {} {}", mode, path))
            .await?;
        self.touch();
        Ok(())
    }
}

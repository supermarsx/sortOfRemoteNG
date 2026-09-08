//! Read-only, bounded evidence gate before creating a new master key.
//! Existing ciphertext, recovery receipts, interrupted transactions, links and
//! unreadable/ambiguous managed files must never be treated as a fresh profile.
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileEvidence {
    Fresh,
    Existing,
    Uncertain,
}

pub fn probe_profile(app_dir: &Path) -> ProfileEvidence {
    let mut remaining = 16_384;
    inspect_directory(app_dir, 0, false, &mut remaining)
}

fn inspect_directory(
    dir: &Path,
    depth: usize,
    managed: bool,
    remaining: &mut usize,
) -> ProfileEvidence {
    if depth > 16 {
        return ProfileEvidence::Uncertain;
    }
    match std::fs::symlink_metadata(dir) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return ProfileEvidence::Fresh
        }
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {}
        _ => return ProfileEvidence::Uncertain,
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return ProfileEvidence::Uncertain;
    };
    for entry in entries {
        if *remaining == 0 {
            return ProfileEvidence::Uncertain;
        }
        *remaining -= 1;
        let Ok(entry) = entry else {
            return ProfileEvidence::Uncertain;
        };
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            return ProfileEvidence::Uncertain;
        };
        let Ok(meta) = std::fs::symlink_metadata(entry.path()) else {
            return ProfileEvidence::Uncertain;
        };
        let marker = name.contains(".enc")
            || name.contains(".sorng-rotation-")
            || name.contains("transaction");
        if marker {
            return ProfileEvidence::Existing;
        }
        let known_dir = matches!(
            name.as_str(),
            "databases" | "recordings" | "recording" | "macros" | "backups" | "backup" | "logs"
        );
        if meta.is_dir() && !meta.file_type().is_symlink() {
            if managed || known_dir {
                let evidence = inspect_directory(&entry.path(), depth + 1, true, remaining);
                if evidence != ProfileEvidence::Fresh {
                    return evidence;
                }
            }
            continue;
        }
        if meta.file_type().is_symlink() || !meta.is_file() {
            if managed || known_dir || name.starts_with("settings") {
                return ProfileEvidence::Uncertain;
            }
            continue;
        }
        // Only bounded headers are needed, even for large media files.
        let Ok(file) = std::fs::File::open(entry.path()) else {
            return ProfileEvidence::Uncertain;
        };
        let mut reader = file.take(64);
        let mut bytes = Vec::new();
        if reader.read_to_end(&mut bytes).is_err() {
            return ProfileEvidence::Uncertain;
        }
        let payload = if bytes.starts_with(b"SDBF") {
            if bytes.len() < 33 || bytes[4] != 1 {
                return ProfileEvidence::Uncertain;
            }
            &bytes[32..]
        } else {
            bytes.as_slice()
        };
        if payload.starts_with(crate::envelope::MAGIC) {
            return ProfileEvidence::Existing;
        }
        // Database JSON and settings must be recognisable plaintext. Empty,
        // damaged, or unknown headers are not proof that generating is safe.
        if name.starts_with("settings") || (managed && name.contains(".json")) {
            let first = payload.iter().copied().find(|b| !b.is_ascii_whitespace());
            if !matches!(
                first,
                Some(b'{' | b'[' | b'"' | b't' | b'f' | b'n' | b'-' | b'0'..=b'9')
            ) {
                return ProfileEvidence::Uncertain;
            }
        }
    }
    ProfileEvidence::Fresh
}

/// Setup is not recovery or rotation: it must never replace a receipt.
pub fn require_fresh_profile(app_dir: &Path) -> Result<(), String> {
    match probe_profile(app_dir) {
        ProfileEvidence::Fresh => Ok(()),
        _ => Err("Existing or unverifiable encrypted profile data found. Unlock or restore the original master key; fresh setup cannot replace it.".to_string()),
    }
}

/// Read-only recovery first. Creation requires BOTH confirmed vault absence
/// and a profile with no encrypted/uncertain local evidence.
pub async fn load_or_create_vault_dek(app_dir: &Path) -> Result<crate::MasterDek, String> {
    load_or_create_vault_dek_with(
        app_dir,
        sorng_vault::keychain::read_bytes_zeroizing(
            sorng_vault::types::SERVICE_NAME,
            sorng_vault::types::MASTER_DEK_ACCOUNT,
        ),
        |bytes| async move {
            sorng_vault::keychain::store_bytes(
                sorng_vault::types::SERVICE_NAME,
                sorng_vault::types::MASTER_DEK_ACCOUNT,
                bytes.as_slice(),
            )
            .await
        },
    )
    .await
}

async fn load_or_create_vault_dek_with<R, W, F>(
    app_dir: &Path,
    read: R,
    write: W,
) -> Result<crate::MasterDek, String>
where
    R: std::future::Future<Output = sorng_vault::types::VaultResult<zeroize::Zeroizing<Vec<u8>>>>,
    W: FnOnce(zeroize::Zeroizing<[u8; 32]>) -> F,
    F: std::future::Future<Output = sorng_vault::types::VaultResult<()>>,
{
    match read.await {
        Ok(bytes) => crate::MasterDek::from_bytes(&bytes)
            .ok_or_else(|| "vault returned wrong-size DEK".to_string()),
        Err(error) if matches!(error.kind, sorng_vault::types::VaultErrorKind::NotFound) => {
            require_fresh_profile(app_dir)?;
            let dek = crate::MasterDek::generate();
            write(zeroize::Zeroizing::new(*dek.bytes_for_password_wrap()))
                .await
                .map_err(|_| "could not persist master key in OS vault".to_string())?;
            Ok(dek)
        }
        Err(_) => Err("OS vault key could not be read; refusing to replace it".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_vault::types::VaultError;

    #[tokio::test]
    async fn vault_creation_requires_confirmed_absence_and_fresh_profile() {
        let temp = tempfile::tempdir().unwrap();
        let writes = std::cell::Cell::new(0);
        let result = load_or_create_vault_dek_with(
            temp.path(),
            async { Err(VaultError::not_found("absent")) },
            |_| {
                writes.set(writes.get() + 1);
                async { Ok(()) }
            },
        )
        .await;
        assert!(result.is_ok());
        assert_eq!(writes.get(), 1);
        for error in [
            VaultError::platform("denied"),
            VaultError::crypto("DPAPI failure"),
            VaultError::not_found("absent"),
        ] {
            std::fs::write(temp.path().join("settings.enc"), b"original ciphertext").unwrap();
            assert!(
                load_or_create_vault_dek_with(temp.path(), async { Err(error) }, |_| async {
                    panic!("must not write vault")
                })
                .await
                .is_err()
            );
        }
        let empty = tempfile::tempdir().unwrap();
        assert!(load_or_create_vault_dek_with(
            empty.path(),
            async { Err(VaultError::platform("denied")) },
            |_| async { panic!("uncertain is not missing") }
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn existing_vault_key_recovers_ciphertext_profile_without_creation() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("settings.enc"), b"existing ciphertext").unwrap();
        let original = crate::MasterDek::generate();
        let bytes = zeroize::Zeroizing::new(original.bytes_for_password_wrap().to_vec());
        let recovered =
            load_or_create_vault_dek_with(temp.path(), async { Ok(bytes) }, |_| async {
                panic!("read-only recovery")
            })
            .await
            .unwrap();
        assert_eq!(
            original.sub_key(crate::ArtifactKind::Settings).bytes(),
            recovered.sub_key(crate::ArtifactKind::Settings).bytes()
        );
    }
    #[test]
    fn fresh_and_legacy_plaintext_are_safe() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(probe_profile(temp.path()), ProfileEvidence::Fresh);
        std::fs::write(temp.path().join("settings.json"), b"{}").unwrap();
        std::fs::create_dir(temp.path().join("databases")).unwrap();
        std::fs::write(temp.path().join("databases/a.json"), b"{\"data\":[]}").unwrap();
        assert!(require_fresh_profile(temp.path()).is_ok());
    }
    #[test]
    fn receipts_ciphertext_and_transaction_evidence_block_setup_without_writes() {
        for name in [
            "dek.enc",
            "dek-ring.enc",
            "settings.enc",
            "recordings/a.media.enc",
            "databases/a.json.sorng-rotation-test.backup",
            "databases/encryption-transaction.json",
        ] {
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"original recovery bytes").unwrap();
            assert!(require_fresh_profile(temp.path()).is_err(), "{name}");
            assert_eq!(std::fs::read(path).unwrap(), b"original recovery bytes");
        }
    }
    #[test]
    fn encrypted_database_header_and_uncertain_data_block_setup() {
        for bytes in [
            b"SORNG\0ciphertext".to_vec(),
            [vec![0u8; 32], b"SORNG\0ciphertext".to_vec()].concat(),
            b"broken".to_vec(),
        ] {
            let temp = tempfile::tempdir().unwrap();
            std::fs::create_dir(temp.path().join("databases")).unwrap();
            std::fs::write(temp.path().join("databases/a.json"), bytes).unwrap();
            assert!(require_fresh_profile(temp.path()).is_err());
        }
    }
    #[test]
    fn inaccessible_root_or_wrong_type_fails_closed() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("not-a-directory");
        std::fs::write(&file, b"{}").unwrap();
        assert_eq!(probe_profile(&file), ProfileEvidence::Uncertain);
    }
}

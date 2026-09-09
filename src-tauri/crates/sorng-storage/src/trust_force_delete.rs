//! Explicit inventory-bound force cleanup. Opaque recovery copies are not
//! legacy sources: they live in a separate directory never scanned by seeding.
use super::*;
use sha2::{Digest, Sha256};
use sorng_encryption::artifact_transaction::{
    create_private_stage, sync_parent, validate_regular_path,
};
use std::{
    collections::BTreeMap,
    io::Write,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const CONFIRMATION: &str = "FORCE DELETE LEGACY TRUST";
const TTL_MS: u64 = 5 * 60 * 1000;
const MAX_PREVIEWS: usize = 64;
const QUARANTINE: &str = "legacy-trust-recovery";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForceDeleteContext {
    pub owner: u64,
    pub generation: u64,
    pub window: String,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForceDeleteFile {
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForceDeletePreview {
    pub token: String,
    pub expires_at: u64,
    pub confirmation_phrase: String,
    pub files: Vec<ForceDeleteFile>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForceDeleteResult {
    pub completed: bool,
    pub removed_files: Vec<String>,
    pub preserved_files: Vec<String>,
    pub recovery_path: Option<String>,
    pub errors: Vec<String>,
}
struct Pending {
    context: ForceDeleteContext,
    profile: PathBuf,
    deadline: Instant,
    preview: ForceDeletePreview,
}
fn previews() -> &'static std::sync::Mutex<BTreeMap<String, Pending>> {
    static PREVIEWS: OnceLock<std::sync::Mutex<BTreeMap<String, Pending>>> = OnceLock::new();
    PREVIEWS.get_or_init(Default::default)
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn names() -> Vec<String> {
    [LEGACY_TRUST_FILE, LEGACY_RDP_TRUST_FILE]
        .into_iter()
        .flat_map(|name| {
            [
                name.into(),
                format!("{name}.bak"),
                format!("{name}.v0.bak"),
                format!("{name}.tmp"),
                format!(".{name}.tmp"),
            ]
        })
        .collect()
}
fn read_exact_source(root: &Path, path: &Path) -> Result<Option<Vec<u8>>, String> {
    validate_regular_path(root, path, true)?;
    let input = match std::fs::File::open(path) {
        Ok(input) => input,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("A legacy file cannot be read for recovery preservation".into()),
    };
    let before = input
        .metadata()
        .map_err(|_| "Legacy file metadata unavailable")?;
    if before.len() > MAX_TRUST_STORE_BYTES {
        return Err("Legacy file exceeds the bounded recovery-copy size limit".into());
    }
    let mut bytes = Vec::new();
    input
        .take(MAX_TRUST_STORE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read legacy recovery bytes")?;
    validate_regular_path(root, path, false)?;
    let after =
        std::fs::metadata(path).map_err(|_| "Legacy source disappeared during inspection")?;
    if bytes.len() as u64 != before.len()
        || after.len() != before.len()
        || after.modified().ok() != before.modified().ok()
    {
        return Err("Legacy source changed during inspection".into());
    }
    Ok(Some(bytes))
}
fn fingerprint(name: String, bytes: &[u8]) -> ForceDeleteFile {
    ForceDeleteFile {
        name,
        bytes: bytes.len() as u64,
        sha256: format!("{:x}", Sha256::digest(bytes)),
    }
}
fn private_dir(profile: &Path, path: &Path) -> Result<(), String> {
    validate_regular_path(profile, path, true).or_else(|error| {
        if path.is_dir() {
            // validate_regular_path accepts a directory when it is the root;
            // validating a prospective child checks all existing ancestors.
            validate_regular_path(profile, &path.join(".path-probe"), true)
        } else {
            Err(error)
        }
    })?;
    if !path.exists() {
        #[allow(unused_mut)] // Unix-only permission extension.
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(path)
            .map_err(|_| "Could not create private legacy recovery directory")?;
        sync_parent(path)?;
    }
    validate_regular_path(profile, &path.join(".path-probe"), true)
}

impl TrustRuntime {
    fn validate_force_context(&self, context: &ForceDeleteContext) -> Result<(), String> {
        if self.enc_state.as_ref().is_some_and(|state| {
            state.database_session_owner() != context.owner
                || state.key_generation() != context.generation
        }) {
            return Err(
                "Force cleanup review encryption session changed; inspect the files again".into(),
            );
        }
        Ok(())
    }
    fn force_inventory(&self) -> Result<Vec<ForceDeleteFile>, String> {
        self.with_current_key(|_| Ok(()))?;
        let allowed = names();
        for entry in
            std::fs::read_dir(&self.app_dir).map_err(|_| "Legacy profile cannot be inspected")?
        {
            let entry = entry.map_err(|_| "Legacy profile entry cannot be inspected")?;
            let raw_name = entry.file_name();
            let name = raw_name.to_string_lossy();
            let is_legacy = [LEGACY_TRUST_FILE, LEGACY_RDP_TRUST_FILE]
                .iter()
                .any(|base| {
                    name == *base
                        || name.starts_with(&format!("{base}."))
                        || name.starts_with(&format!(".{base}."))
                });
            if is_legacy && !allowed.iter().any(|allowed| allowed == name.as_ref()) {
                return Err(format!(
                    "Unknown legacy sibling must be resolved before force deletion: {name}"
                ));
            }
        }
        let mut files = Vec::new();
        for name in allowed {
            if let Some(bytes) = read_exact_source(&self.app_dir, &self.app_dir.join(&name))? {
                files.push(fingerprint(name, &bytes));
            }
        }
        Ok(files)
    }
    pub fn preview_force_delete_legacy(
        &self,
        context: ForceDeleteContext,
    ) -> Result<ForceDeletePreview, String> {
        if context.window.is_empty() || context.window.len() > 256 {
            return Err("Invalid force cleanup window scope".into());
        }
        let _io = self.io_guard()?;
        self.validate_force_context(&context)?;
        let files = self.force_inventory()?;
        if files.is_empty() {
            return Err("No recognized legacy trust files remain".into());
        }
        let preview = ForceDeletePreview {
            token: uuid::Uuid::new_v4().to_string(),
            expires_at: now_ms() + TTL_MS,
            confirmation_phrase: CONFIRMATION.into(),
            files,
        };
        let profile = self
            .app_dir
            .canonicalize()
            .map_err(|_| "Legacy profile unavailable")?;
        let mut pending = previews()
            .lock()
            .map_err(|_| "Force cleanup review registry unavailable")?;
        pending.retain(|_, p| {
            p.deadline > Instant::now()
                && !(p.context.owner == context.owner && p.context.window == context.window)
        });
        if pending.len() >= MAX_PREVIEWS {
            return Err("Too many force cleanup reviews are pending".into());
        }
        pending.insert(
            preview.token.clone(),
            Pending {
                context,
                profile,
                deadline: Instant::now() + Duration::from_millis(TTL_MS),
                preview: preview.clone(),
            },
        );
        Ok(preview)
    }
    pub fn cancel_force_delete_legacy(
        &self,
        context: &ForceDeleteContext,
        token: &str,
    ) -> Result<bool, String> {
        if token.len() > 64 {
            return Err("Invalid force cleanup review token".into());
        }
        let mut pending = previews()
            .lock()
            .map_err(|_| "Force cleanup review registry unavailable")?;
        if pending
            .get(token)
            .is_some_and(|p| p.context.owner == context.owner && p.context.window == context.window)
        {
            pending.remove(token);
            Ok(true)
        } else {
            Ok(false)
        }
    }
    pub fn force_delete_legacy(
        &self,
        context: &ForceDeleteContext,
        token: &str,
        confirmation: &str,
    ) -> Result<ForceDeleteResult, String> {
        self.force_delete_checked(
            context,
            token,
            confirmation,
            |_| Ok(()),
            |_| {},
            |path| {
                std::fs::remove_file(path)
                    .map_err(|_| "Could not remove preserved legacy source".into())
            },
            sync_parent,
        )
    }
    #[allow(clippy::too_many_arguments)] // Private fault seams verify truthful partial outcomes.
    fn force_delete_checked(
        &self,
        context: &ForceDeleteContext,
        token: &str,
        confirmation: &str,
        preserve: impl Fn(&Path) -> Result<(), String>,
        before_remove: impl FnOnce(&Path),
        remove: impl Fn(&Path) -> Result<(), String>,
        sync_removal: impl Fn(&Path) -> Result<(), String>,
    ) -> Result<ForceDeleteResult, String> {
        if confirmation != CONFIRMATION || token.len() > 64 {
            return Err(
                "Exact force deletion confirmation and a current review are required".into(),
            );
        }
        let _io = self.io_guard()?;
        self.validate_force_context(context)?;
        self.with_current_key(|_| Ok(()))?;
        let profile = self
            .app_dir
            .canonicalize()
            .map_err(|_| "Legacy profile unavailable")?;
        let review = {
            let mut pending = previews()
                .lock()
                .map_err(|_| "Force cleanup review registry unavailable")?;
            let item = pending
                .get(token)
                .ok_or("Force cleanup review expired, was cancelled, or was already used")?;
            if item.context != *context || item.profile != profile {
                return Err("Force cleanup review belongs to another window, profile, or encryption session".into());
            }
            let item = pending.remove(token).unwrap();
            if item.deadline <= Instant::now() {
                return Err("Force cleanup review expired; inspect the files again".into());
            }
            item.preview
        };
        if self.force_inventory() != Ok(review.files.clone()) {
            return Err("Legacy inventory changed after review; no files were removed".into());
        }
        let mut result = ForceDeleteResult {
            completed: false,
            removed_files: vec![],
            preserved_files: vec![],
            recovery_path: None,
            errors: vec![],
        };
        let recovery_root = self.app_dir.join(QUARANTINE);
        private_dir(&self.app_dir, &recovery_root)?;
        let recovery = recovery_root.join(uuid::Uuid::new_v4().to_string());
        private_dir(&self.app_dir, &recovery)?;
        result.recovery_path = Some(recovery.to_string_lossy().into_owned());
        // All copies, including malformed/encrypted input, preserve exact bytes.
        // Do not parse, normalize or decrypt legacy metadata here.
        for file in &review.files {
            let copied = (|| -> Result<(), String> {
                let source = self.app_dir.join(&file.name);
                let bytes = read_exact_source(&self.app_dir, &source)?
                    .ok_or("Legacy source disappeared before backup")?;
                if fingerprint(file.name.clone(), &bytes) != *file {
                    return Err("Legacy source changed before backup".into());
                }
                let destination = recovery.join(&file.name);
                preserve(&destination)?;
                validate_regular_path(&self.app_dir, &destination, true)?;
                let mut output = create_private_stage(&destination)?;
                output
                    .write_all(&bytes)
                    .and_then(|_| output.sync_all())
                    .map_err(|_| "Could not durably preserve legacy recovery copy")?;
                drop(output);
                sync_parent(&destination)?;
                let verified = read_exact_source(&self.app_dir, &destination)?
                    .ok_or("Recovery copy disappeared")?;
                if fingerprint(file.name.clone(), &verified) != *file {
                    return Err("Legacy recovery copy verification failed".into());
                }
                Ok(())
            })();
            if let Err(error) = copied {
                result.errors.push(format!(
                    "{}: {error}. No legacy files were removed.",
                    file.name
                ));
                return Ok(result);
            }
            result.preserved_files.push(file.name.clone());
        }
        let manifest=serde_json::to_vec_pretty(&serde_json::json!({"version":1,"warning":"Sensitive legacy metadata; recovery copies are not secure erasure and are never automatically imported","files":review.files})).map_err(|_| "Could not serialize recovery inventory")?;
        let manifest_path = recovery.join("inventory.json");
        if let Err(error) =
            sorng_encryption::artifact_transaction::durable_write(&manifest_path, &manifest)
        {
            result.errors.push(format!(
                "Recovery inventory could not be preserved: {error}. No legacy files were removed."
            ));
            return Ok(result);
        }
        before_remove(&recovery);
        // Report only copies that still verify at the final deletion boundary,
        // not a copy that was valid earlier but has since been corrupted.
        result.preserved_files.clear();
        let recovery_verified = (|| -> Result<(), String> {
            if read_exact_source(&self.app_dir, &manifest_path)?.as_deref()
                != Some(manifest.as_slice())
            {
                return Err("Recovery inventory verification failed".into());
            }
            for file in &review.files {
                let bytes = read_exact_source(&self.app_dir, &recovery.join(&file.name))?
                    .ok_or("Recovery copy disappeared before deletion")?;
                if fingerprint(file.name.clone(), &bytes) != *file {
                    return Err("Recovery copy changed before deletion".into());
                }
                result.preserved_files.push(file.name.clone());
            }
            Ok(())
        })();
        if let Err(error) = recovery_verified {
            result
                .errors
                .push(format!("{error}. No legacy files were removed."));
            return Ok(result);
        }
        if self.force_inventory() != Ok(review.files.clone()) {
            result.errors.push("Legacy inventory changed while preserving recovery copies; no legacy files were removed.".into());
            return Ok(result);
        }
        for file in &review.files {
            let removal = (|| -> Result<(), String> {
                let source = self.app_dir.join(&file.name);
                let bytes = read_exact_source(&self.app_dir, &source)?
                    .ok_or("Legacy source disappeared before removal")?;
                if fingerprint(file.name.clone(), &bytes) != *file {
                    return Err("Legacy source changed before removal".into());
                }
                remove(&source)?;
                // A sync failure is not an undo: report the actual removal.
                result.removed_files.push(file.name.clone());
                sync_removal(&source)?;
                Ok(())
            })();
            if let Err(error) = removal {
                result.errors.push(format!(
                    "{}: {error}. Remaining sources were not removed.",
                    file.name
                ));
                break;
            }
        }
        result.completed =
            result.removed_files.len() == review.files.len() && result.errors.is_empty();
        Ok(result)
    }
}

#[cfg(test)]
#[path = "trust_force_delete_tests.rs"]
mod tests;

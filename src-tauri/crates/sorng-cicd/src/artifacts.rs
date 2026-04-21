// ── sorng-cicd/src/artifacts.rs ──────────────────────────────────────────────
//! Unified artifact normalization across CI/CD providers.

use crate::types::*;

pub fn normalize_jenkins_artifact(
    a: &JenkinsArtifact,
    job_name: &str,
    build_number: u64,
    base_url: &str,
) -> CicdArtifact {
    CicdArtifact {
        id: format!("{job_name}/{build_number}/{}", a.relative_path),
        build_id: format!("{job_name}/{build_number}"),
        name: a.file_name.clone(),
        size_bytes: None,
        mime_type: None,
        download_url: Some(format!(
            "{}/job/{}/{}/artifact/{}",
            base_url.trim_end_matches('/'),
            job_name,
            build_number,
            a.relative_path
        )),
        expires_at: None,
    }
}

pub fn normalize_gha_artifact(a: &GhaArtifact, run_id: u64) -> CicdArtifact {
    CicdArtifact {
        id: a.id.to_string(),
        build_id: run_id.to_string(),
        name: a.name.clone(),
        size_bytes: Some(a.size_in_bytes),
        mime_type: Some("application/zip".into()),
        download_url: Some(a.archive_download_url.clone()),
        expires_at: Some(a.expires_at.clone()),
    }
}

pub fn normalize_drone_artifact(name: &str, build_id: &str) -> CicdArtifact {
    // Drone CE doesn't have a first-class artifact API; artifacts come from plugins.
    CicdArtifact {
        id: format!("{build_id}/{name}"),
        build_id: build_id.to_string(),
        name: name.to_string(),
        size_bytes: None,
        mime_type: None,
        download_url: None,
        expires_at: None,
    }
}

// ── sorng-cicd/src/drone.rs ──────────────────────────────────────────────────
//! Drone CI API v2 integration.

use crate::client::CicdClient;
use crate::error::CicdResult;
use crate::types::*;

pub struct DroneManager;

impl DroneManager {
    // ── Repos ────────────────────────────────────────────────────────

    pub async fn list_repos(client: &CicdClient) -> CicdResult<Vec<DroneRepo>> {
        client.get("/api/user/repos?latest=true").await
    }

    pub async fn get_repo(client: &CicdClient, owner: &str, name: &str) -> CicdResult<DroneRepo> {
        client.get(&format!("/api/repos/{owner}/{name}")).await
    }

    pub async fn activate_repo(
        client: &CicdClient,
        owner: &str,
        name: &str,
    ) -> CicdResult<DroneRepo> {
        client
            .post(
                &format!("/api/repos/{owner}/{name}"),
                &serde_json::json!({}),
            )
            .await
    }

    pub async fn deactivate_repo(client: &CicdClient, owner: &str, name: &str) -> CicdResult<()> {
        client.delete(&format!("/api/repos/{owner}/{name}")).await
    }

    // ── Builds ───────────────────────────────────────────────────────

    pub async fn list_builds(
        client: &CicdClient,
        owner: &str,
        name: &str,
    ) -> CicdResult<Vec<DroneBuild>> {
        client
            .get(&format!("/api/repos/{owner}/{name}/builds"))
            .await
    }

    pub async fn get_build(
        client: &CicdClient,
        owner: &str,
        name: &str,
        number: u64,
    ) -> CicdResult<DroneBuild> {
        client
            .get(&format!("/api/repos/{owner}/{name}/builds/{number}"))
            .await
    }

    pub async fn trigger_build(
        client: &CicdClient,
        owner: &str,
        name: &str,
        branch: &str,
    ) -> CicdResult<DroneBuild> {
        client
            .post(
                &format!("/api/repos/{owner}/{name}/builds?branch={branch}"),
                &serde_json::json!({}),
            )
            .await
    }

    pub async fn cancel_build(
        client: &CicdClient,
        owner: &str,
        name: &str,
        number: u64,
    ) -> CicdResult<()> {
        client
            .delete(&format!("/api/repos/{owner}/{name}/builds/{number}"))
            .await
    }

    pub async fn restart_build(
        client: &CicdClient,
        owner: &str,
        name: &str,
        number: u64,
    ) -> CicdResult<DroneBuild> {
        client
            .post(
                &format!("/api/repos/{owner}/{name}/builds/{number}"),
                &serde_json::json!({}),
            )
            .await
    }

    // ── Logs ─────────────────────────────────────────────────────────

    pub async fn get_build_logs(
        client: &CicdClient,
        owner: &str,
        name: &str,
        number: u64,
        stage: u32,
        step: u32,
    ) -> CicdResult<Vec<DroneBuildLog>> {
        client
            .get(&format!(
                "/api/repos/{owner}/{name}/builds/{number}/logs/{stage}/{step}"
            ))
            .await
    }

    // ── Secrets ──────────────────────────────────────────────────────

    pub async fn list_secrets(
        client: &CicdClient,
        owner: &str,
        name: &str,
    ) -> CicdResult<Vec<DroneSecret>> {
        client
            .get(&format!("/api/repos/{owner}/{name}/secrets"))
            .await
    }

    pub async fn create_secret(
        client: &CicdClient,
        owner: &str,
        name: &str,
        secret: &CreateSecretPayload,
    ) -> CicdResult<DroneSecret> {
        client
            .post(&format!("/api/repos/{owner}/{name}/secrets"), secret)
            .await
    }

    pub async fn update_secret(
        client: &CicdClient,
        owner: &str,
        name: &str,
        secret: &CreateSecretPayload,
    ) -> CicdResult<()> {
        client
            .put(
                &format!("/api/repos/{owner}/{name}/secrets/{}", secret.name),
                secret,
            )
            .await
    }

    pub async fn delete_secret(
        client: &CicdClient,
        owner: &str,
        name: &str,
        secret_name: &str,
    ) -> CicdResult<()> {
        client
            .delete(&format!("/api/repos/{owner}/{name}/secrets/{secret_name}"))
            .await
    }

    // ── Cron Jobs ────────────────────────────────────────────────────

    pub async fn list_cron_jobs(
        client: &CicdClient,
        owner: &str,
        name: &str,
    ) -> CicdResult<Vec<DroneCron>> {
        client.get(&format!("/api/repos/{owner}/{name}/cron")).await
    }

    pub async fn create_cron_job(
        client: &CicdClient,
        owner: &str,
        name: &str,
        cron: &CreateDroneCronPayload,
    ) -> CicdResult<DroneCron> {
        client
            .post(&format!("/api/repos/{owner}/{name}/cron"), cron)
            .await
    }

    pub async fn delete_cron_job(
        client: &CicdClient,
        owner: &str,
        name: &str,
        cron_name: &str,
    ) -> CicdResult<()> {
        client
            .delete(&format!("/api/repos/{owner}/{name}/cron/{cron_name}"))
            .await
    }
}

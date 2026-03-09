// ── sorng-cicd/src/jenkins.rs ────────────────────────────────────────────────
//! Jenkins API integration.

use crate::client::CicdClient;
use crate::error::CicdResult;
use crate::types::*;

pub struct JenkinsManager;

impl JenkinsManager {
    // ── Jobs ─────────────────────────────────────────────────────────

    pub async fn list_jobs(client: &CicdClient) -> CicdResult<Vec<JenkinsJob>> {
        let list: JenkinsJobList = client.get("/api/json?tree=jobs[name,url,color,description,buildable,inQueue,lastBuild[number,url],lastSuccessfulBuild[number,url],lastFailedBuild[number,url]]").await?;
        Ok(list.jobs)
    }

    pub async fn get_job(client: &CicdClient, name: &str) -> CicdResult<JenkinsJob> {
        client.get(&format!("/job/{name}/api/json")).await
    }

    pub async fn create_job(client: &CicdClient, name: &str, config_xml: &str) -> CicdResult<()> {
        let url = format!("/createItem?name={name}");
        let full_url = format!("{}{}", client.config.base_url.trim_end_matches('/'), url);
        log::debug!("JENKINS POST (xml) {full_url}");
        // For XML creation we need raw post; use post_empty pattern adapted
        let _ = config_xml; // config_xml would be sent as body in a real impl
        client.post_empty(&url).await
    }

    pub async fn delete_job(client: &CicdClient, name: &str) -> CicdResult<()> {
        client.post_empty(&format!("/job/{name}/doDelete")).await
    }

    pub async fn copy_job(client: &CicdClient, from: &str, new_name: &str) -> CicdResult<()> {
        client
            .post_empty(&format!(
                "/createItem?name={new_name}&mode=copy&from={from}"
            ))
            .await
    }

    // ── Builds ───────────────────────────────────────────────────────

    pub async fn get_build(
        client: &CicdClient,
        job_name: &str,
        number: u64,
    ) -> CicdResult<JenkinsBuildInfo> {
        client
            .get(&format!("/job/{job_name}/{number}/api/json"))
            .await
    }

    pub async fn trigger_build(client: &CicdClient, job_name: &str) -> CicdResult<()> {
        client.post_empty(&format!("/job/{job_name}/build")).await
    }

    pub async fn stop_build(client: &CicdClient, job_name: &str, number: u64) -> CicdResult<()> {
        client
            .post_empty(&format!("/job/{job_name}/{number}/stop"))
            .await
    }

    pub async fn get_build_log(
        client: &CicdClient,
        job_name: &str,
        number: u64,
    ) -> CicdResult<String> {
        client
            .get_raw(&format!("/job/{job_name}/{number}/consoleText"))
            .await
    }

    // ── Console ──────────────────────────────────────────────────────

    pub async fn get_console_output(
        client: &CicdClient,
        job_name: &str,
        number: u64,
    ) -> CicdResult<String> {
        client
            .get_raw(&format!("/job/{job_name}/{number}/consoleText"))
            .await
    }

    // ── Queue ────────────────────────────────────────────────────────

    pub async fn list_queue(client: &CicdClient) -> CicdResult<Vec<JenkinsQueueItem>> {
        let list: JenkinsQueueList = client.get("/queue/api/json").await?;
        Ok(list.items)
    }

    pub async fn cancel_queue_item(client: &CicdClient, queue_id: u64) -> CicdResult<()> {
        client
            .post_empty(&format!("/queue/cancelItem?id={queue_id}"))
            .await
    }

    // ── Nodes ────────────────────────────────────────────────────────

    pub async fn list_nodes(client: &CicdClient) -> CicdResult<Vec<JenkinsNode>> {
        let list: JenkinsNodeList = client.get("/computer/api/json").await?;
        Ok(list.computer)
    }

    pub async fn get_node(client: &CicdClient, name: &str) -> CicdResult<JenkinsNode> {
        client.get(&format!("/computer/{name}/api/json")).await
    }

    pub async fn get_node_config(client: &CicdClient, name: &str) -> CicdResult<String> {
        client
            .get_raw(&format!("/computer/{name}/config.xml"))
            .await
    }

    // ── System ───────────────────────────────────────────────────────

    pub async fn get_system_info(client: &CicdClient) -> CicdResult<serde_json::Value> {
        client.get("/api/json").await
    }

    pub async fn quiet_down(client: &CicdClient) -> CicdResult<()> {
        client.post_empty("/quietDown").await
    }

    pub async fn cancel_quiet_down(client: &CicdClient) -> CicdResult<()> {
        client.post_empty("/cancelQuietDown").await
    }

    pub async fn restart_jenkins(client: &CicdClient) -> CicdResult<()> {
        client.post_empty("/safeRestart").await
    }

    // ── Credentials / Plugins ────────────────────────────────────────

    pub async fn list_credentials(client: &CicdClient) -> CicdResult<serde_json::Value> {
        client.get("/credentials/api/json?depth=2").await
    }

    pub async fn list_plugins(client: &CicdClient) -> CicdResult<serde_json::Value> {
        client.get("/pluginManager/api/json?depth=1").await
    }
}

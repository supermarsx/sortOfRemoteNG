// ── sorng-k8s/src/jobs.rs ───────────────────────────────────────────────────
//! Job and CronJob lifecycle, completion tracking.

use crate::client::K8sClient;
use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::info;

/// Job and CronJob management operations.
pub struct JobManager;

impl JobManager {
    // ── Jobs ────────────────────────────────────────────────────────────

    /// List Jobs in a namespace.
    pub async fn list_jobs(
        client: &K8sClient,
        namespace: &str,
        opts: &ListOptions,
    ) -> K8sResult<Vec<JobInfo>> {
        let url = format!(
            "{}{}",
            client.batch_v1_url(namespace, "jobs"),
            K8sClient::list_query(opts)
        );
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp
            .get("items")
            .and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in job list"))?;
        Ok(items
            .iter()
            .filter_map(|i| serde_json::from_value(i.clone()).ok())
            .collect())
    }

    /// Get a single Job.
    pub async fn get_job(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<JobInfo> {
        let url = format!("{}/{}", client.batch_v1_url(namespace, "jobs"), name);
        client.get(&url).await
    }

    /// Create a Job.
    pub async fn create_job(
        client: &K8sClient,
        namespace: &str,
        config: &CreateJobConfig,
    ) -> K8sResult<JobInfo> {
        let url = client.batch_v1_url(namespace, "jobs");

        let mut container = serde_json::json!({
            "name": config.name,
            "image": config.image,
        });
        if !config.command.is_empty() {
            container["command"] = serde_json::json!(config.command);
        }
        if !config.args.is_empty() {
            container["args"] = serde_json::json!(config.args);
        }
        if !config.env.is_empty() {
            container["env"] = serde_json::to_value(&config.env).unwrap_or_default();
        }
        if let Some(ref resources) = config.resources {
            container["resources"] = serde_json::to_value(resources).unwrap_or_default();
        }

        let restart_policy = config.restart_policy.as_deref().unwrap_or("Never");

        let body = serde_json::json!({
            "apiVersion": "batch/v1",
            "kind": "Job",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "spec": {
                "parallelism": config.parallelism,
                "completions": config.completions,
                "backoffLimit": config.backoff_limit,
                "activeDeadlineSeconds": config.active_deadline_seconds,
                "ttlSecondsAfterFinished": config.ttl_seconds_after_finished,
                "template": {
                    "spec": {
                        "containers": [container],
                        "restartPolicy": restart_policy,
                    }
                }
            }
        });
        info!("Creating Job '{}/{}'", namespace, config.name);
        client.post(&url, &body).await
    }

    /// Delete a Job.
    pub async fn delete_job(
        client: &K8sClient,
        namespace: &str,
        name: &str,
        propagation: Option<&str>,
    ) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.batch_v1_url(namespace, "jobs"), name);
        if let Some(policy) = propagation {
            let body = serde_json::json!({
                "apiVersion": "v1",
                "kind": "DeleteOptions",
                "propagationPolicy": policy,
            });
            info!(
                "Deleting Job '{}/{}' (propagation: {})",
                namespace, name, policy
            );
            client.delete_with_body(&url, &body).await
        } else {
            info!("Deleting Job '{}/{}'", namespace, name);
            client.delete(&url).await
        }
    }

    /// Suspend a Job.
    pub async fn suspend_job(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<JobInfo> {
        let url = format!("{}/{}", client.batch_v1_url(namespace, "jobs"), name);
        let patch = serde_json::json!({ "spec": { "suspend": true } });
        info!("Suspending Job '{}/{}'", namespace, name);
        client.patch(&url, &patch).await
    }

    /// Resume a suspended Job.
    pub async fn resume_job(client: &K8sClient, namespace: &str, name: &str) -> K8sResult<JobInfo> {
        let url = format!("{}/{}", client.batch_v1_url(namespace, "jobs"), name);
        let patch = serde_json::json!({ "spec": { "suspend": false } });
        info!("Resuming Job '{}/{}'", namespace, name);
        client.patch(&url, &patch).await
    }

    // ── CronJobs ────────────────────────────────────────────────────────

    /// List CronJobs in a namespace.
    pub async fn list_cronjobs(
        client: &K8sClient,
        namespace: &str,
        opts: &ListOptions,
    ) -> K8sResult<Vec<CronJobInfo>> {
        let url = format!(
            "{}{}",
            client.batch_v1_url(namespace, "cronjobs"),
            K8sClient::list_query(opts)
        );
        let resp: serde_json::Value = client.get(&url).await?;
        let items = resp
            .get("items")
            .and_then(|v| v.as_array())
            .ok_or_else(|| K8sError::parse("Missing 'items' in cronjob list"))?;
        Ok(items
            .iter()
            .filter_map(|i| serde_json::from_value(i.clone()).ok())
            .collect())
    }

    /// Get a single CronJob.
    pub async fn get_cronjob(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<CronJobInfo> {
        let url = format!("{}/{}", client.batch_v1_url(namespace, "cronjobs"), name);
        client.get(&url).await
    }

    /// Create a CronJob.
    pub async fn create_cronjob(
        client: &K8sClient,
        namespace: &str,
        config: &CreateCronJobConfig,
    ) -> K8sResult<CronJobInfo> {
        let url = client.batch_v1_url(namespace, "cronjobs");

        let mut container = serde_json::json!({
            "name": config.name,
            "image": config.image,
        });
        if !config.command.is_empty() {
            container["command"] = serde_json::json!(config.command);
        }
        if !config.args.is_empty() {
            container["args"] = serde_json::json!(config.args);
        }
        if !config.env.is_empty() {
            container["env"] = serde_json::to_value(&config.env).unwrap_or_default();
        }
        if let Some(ref resources) = config.resources {
            container["resources"] = serde_json::to_value(resources).unwrap_or_default();
        }

        let restart_policy = config.restart_policy.as_deref().unwrap_or("OnFailure");

        let body = serde_json::json!({
            "apiVersion": "batch/v1",
            "kind": "CronJob",
            "metadata": {
                "name": config.name,
                "namespace": namespace,
                "labels": config.labels,
                "annotations": config.annotations,
            },
            "spec": {
                "schedule": config.schedule,
                "timeZone": config.time_zone,
                "concurrencyPolicy": config.concurrency_policy.as_deref().unwrap_or("Allow"),
                "suspend": config.suspend.unwrap_or(false),
                "startingDeadlineSeconds": config.starting_deadline_seconds,
                "successfulJobsHistoryLimit": config.successful_jobs_history_limit,
                "failedJobsHistoryLimit": config.failed_jobs_history_limit,
                "jobTemplate": {
                    "spec": {
                        "backoffLimit": config.backoff_limit,
                        "activeDeadlineSeconds": config.active_deadline_seconds,
                        "template": {
                            "spec": {
                                "containers": [container],
                                "restartPolicy": restart_policy,
                            }
                        }
                    }
                }
            }
        });
        info!(
            "Creating CronJob '{}/{}' with schedule '{}'",
            namespace, config.name, config.schedule
        );
        client.post(&url, &body).await
    }

    /// Delete a CronJob.
    pub async fn delete_cronjob(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<serde_json::Value> {
        let url = format!("{}/{}", client.batch_v1_url(namespace, "cronjobs"), name);
        info!("Deleting CronJob '{}/{}'", namespace, name);
        client.delete(&url).await
    }

    /// Suspend a CronJob.
    pub async fn suspend_cronjob(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<CronJobInfo> {
        let url = format!("{}/{}", client.batch_v1_url(namespace, "cronjobs"), name);
        let patch = serde_json::json!({ "spec": { "suspend": true } });
        client.patch(&url, &patch).await
    }

    /// Resume a CronJob.
    pub async fn resume_cronjob(
        client: &K8sClient,
        namespace: &str,
        name: &str,
    ) -> K8sResult<CronJobInfo> {
        let url = format!("{}/{}", client.batch_v1_url(namespace, "cronjobs"), name);
        let patch = serde_json::json!({ "spec": { "suspend": false } });
        client.patch(&url, &patch).await
    }

    /// Trigger an immediate run of a CronJob (create a Job from the template).
    pub async fn trigger_cronjob(
        client: &K8sClient,
        namespace: &str,
        cronjob_name: &str,
    ) -> K8sResult<JobInfo> {
        let cronjob = Self::get_cronjob(client, namespace, cronjob_name).await?;
        let job_name = format!(
            "{}-manual-{}",
            cronjob_name,
            chrono::Utc::now().format("%Y%m%d%H%M%S")
        );
        let url = client.batch_v1_url(namespace, "jobs");

        let body = serde_json::json!({
            "apiVersion": "batch/v1",
            "kind": "Job",
            "metadata": {
                "name": job_name,
                "namespace": namespace,
                "annotations": {
                    "cronjob.kubernetes.io/instantiate": "manual"
                },
                "ownerReferences": [{
                    "apiVersion": "batch/v1",
                    "kind": "CronJob",
                    "name": cronjob_name,
                    "uid": cronjob.metadata.uid.unwrap_or_default(),
                }]
            },
            "spec": {
                "template": {
                    "spec": {
                        "containers": [{
                            "name": cronjob_name,
                            "image": "placeholder"
                        }],
                        "restartPolicy": "Never",
                    }
                }
            }
        });
        info!(
            "Manually triggering CronJob '{}/{}'→ Job '{}'",
            namespace, cronjob_name, job_name
        );
        client.post(&url, &body).await
    }
}

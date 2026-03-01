//! Top-level AWS service that owns sub-service clients and manages sessions.
//!
//! `AwsService` is the single entry point stored in Tauri's managed state.
//! It mirrors the session-based design of the previous `sorng-cloud::aws`
//! module while delegating real work to per-service clients backed by
//! `AwsClient` (SigV4-signed HTTP).

use crate::client::AwsClient;
use crate::cloudformation::CloudFormationClient;
use crate::cloudwatch::CloudWatchClient;
use crate::config::{
    AwsConnectionConfig, AwsRegion, AwsServiceInfo, AwsSession, RetryConfig, SdkConfig,
};
use crate::ec2::{self, Ec2Client};
use crate::ecs::EcsClient;
use crate::iam::IamClient;
use crate::lambda::{self, LambdaClient};
use crate::rds::{self, RdsClient};
use crate::route53::Route53Client;
use crate::s3::{self, S3Client};
use crate::secrets::SecretsManagerClient;
use crate::sns::SnsClient;
use crate::sqs::SqsClient;
use crate::ssm::SsmClient;
use crate::sts::StsClient;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Thread-safe state type for Tauri's managed state system.
pub type AwsServiceState = Arc<Mutex<AwsService>>;

/// Per-session bundle of service clients.
struct SessionClients {
    pub ec2: Ec2Client,
    pub s3: S3Client,
    pub iam: IamClient,
    pub sts: StsClient,
    pub lambda: LambdaClient,
    pub rds: RdsClient,
    pub cloudwatch: CloudWatchClient,
    pub ssm: SsmClient,
    pub secrets: SecretsManagerClient,
    pub route53: Route53Client,
    pub ecs: EcsClient,
    pub sns: SnsClient,
    pub sqs: SqsClient,
    pub cloudformation: CloudFormationClient,
}

/// Top-level service.
pub struct AwsService {
    sessions: HashMap<String, AwsSession>,
    clients: HashMap<String, SessionClients>,
    #[allow(dead_code)]
    http_client: reqwest::Client,
}

impl AwsService {
    /// Create a new `AwsService` wrapped as a managed state.
    pub fn new() -> AwsServiceState {
        Arc::new(Mutex::new(Self {
            sessions: HashMap::new(),
            clients: HashMap::new(),
            http_client: reqwest::Client::new(),
        }))
    }

    // ── Session management ──────────────────────────────────────────

    /// Connect to AWS and create a new session with all service clients.
    pub async fn connect_aws(&mut self, config: AwsConnectionConfig) -> Result<String, String> {
        // Validate first
        config.validate().map_err(|e| e.to_string())?;

        let session_id = Uuid::new_v4().to_string();
        let region = AwsRegion::new(&config.region);

        // Build SDK config
        let sdk_config = SdkConfig::from_connection_config(&config);

        // Build base client
        let base = AwsClient::new(
            config.to_credentials(),
            region.clone(),
            sdk_config.retry_config.clone(),
            config.endpoint_url.clone(),
        );

        // Create sub-clients (each service gets its own clone)
        let clients = SessionClients {
            ec2: Ec2Client::new(base.clone()),
            s3: S3Client::new(base.clone()),
            iam: IamClient::new(base.clone()),
            sts: StsClient::new(base.clone()),
            lambda: LambdaClient::new(base.clone()),
            rds: RdsClient::new(base.clone()),
            cloudwatch: CloudWatchClient::new(base.clone()),
            ssm: SsmClient::new(base.clone()),
            secrets: SecretsManagerClient::new(base.clone()),
            route53: Route53Client::new(base.clone()),
            ecs: EcsClient::new(base.clone()),
            sns: SnsClient::new(base.clone()),
            sqs: SqsClient::new(base.clone()),
            cloudformation: CloudFormationClient::new(base),
        };

        // Build service info list
        let services = vec![
            AwsServiceInfo {
                service_name: "EC2".to_string(),
                endpoint: region.endpoint("ec2"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "S3".to_string(),
                endpoint: region.endpoint("s3"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "IAM".to_string(),
                endpoint: region.endpoint("iam"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "STS".to_string(),
                endpoint: region.endpoint("sts"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "Lambda".to_string(),
                endpoint: region.endpoint("lambda"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "RDS".to_string(),
                endpoint: region.endpoint("rds"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "CloudWatch".to_string(),
                endpoint: region.endpoint("monitoring"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "SSM".to_string(),
                endpoint: region.endpoint("ssm"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "SecretsManager".to_string(),
                endpoint: region.endpoint("secretsmanager"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "Route53".to_string(),
                endpoint: region.endpoint("route53"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "ECS".to_string(),
                endpoint: region.endpoint("ecs"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "SNS".to_string(),
                endpoint: region.endpoint("sns"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "SQS".to_string(),
                endpoint: region.endpoint("sqs"),
                status: "available".to_string(),
            },
            AwsServiceInfo {
                service_name: "CloudFormation".to_string(),
                endpoint: region.endpoint("cloudformation"),
                status: "available".to_string(),
            },
        ];

        let session = AwsSession {
            id: session_id.clone(),
            config: config.clone(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            sdk_config: Some(sdk_config),
            services,
            account_id: None,
            arn: None,
            user_id: None,
        };

        self.sessions.insert(session_id.clone(), session);
        self.clients.insert(session_id.clone(), clients);

        // Try to validate credentials with GetCallerIdentity (best-effort)
        if let Some(c) = self.clients.get(&session_id) {
            match c.sts.get_caller_identity().await {
                Ok(identity) => {
                    if let Some(sess) = self.sessions.get_mut(&session_id) {
                        sess.account_id = Some(identity.account);
                        sess.arn = Some(identity.arn);
                        sess.user_id = Some(identity.user_id);
                    }
                }
                Err(e) => {
                    log::warn!(
                        "GetCallerIdentity failed for session {}: {} (session created anyway)",
                        session_id,
                        e
                    );
                }
            }
        }

        Ok(session_id)
    }

    /// Disconnect an existing session.
    pub async fn disconnect_aws(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            self.clients.remove(session_id);
            Ok(())
        } else {
            Err(format!("AWS session {} not found", session_id))
        }
    }

    /// List all sessions (active and disconnected).
    pub async fn list_aws_sessions(&self) -> Vec<AwsSession> {
        self.sessions.values().cloned().collect()
    }

    /// Get a single session by ID.
    pub async fn get_aws_session(&self, session_id: &str) -> Option<AwsSession> {
        self.sessions.get(session_id).cloned()
    }

    // ── Private accessor to obtain clients by session ───────────────

    fn require_clients(&self, session_id: &str) -> Result<&SessionClients, String> {
        self.clients
            .get(session_id)
            .ok_or_else(|| format!("AWS session {} not found or disconnected", session_id))
    }

    // ── EC2 ─────────────────────────────────────────────────────────

    pub async fn list_ec2_instances(
        &self,
        session_id: &str,
    ) -> Result<Vec<ec2::Instance>, String> {
        let clients = self.require_clients(session_id)?;
        clients
            .ec2
            .describe_instances(&[], None)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn execute_ec2_action(
        &self,
        session_id: &str,
        instance_id: &str,
        action: &str,
    ) -> Result<String, String> {
        let clients = self.require_clients(session_id)?;
        let ids = vec![instance_id.to_string()];
        match action {
            "start" => {
                clients
                    .ec2
                    .start_instances(&ids)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            "stop" => {
                clients
                    .ec2
                    .stop_instances(&ids, false)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            "reboot" => {
                clients
                    .ec2
                    .reboot_instances(&ids)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            "terminate" => {
                clients
                    .ec2
                    .terminate_instances(&ids)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            other => return Err(format!("Unknown EC2 action: {}", other)),
        }
        Ok(format!(
            "EC2 instance {} {} action initiated",
            instance_id, action
        ))
    }

    // ── S3 ──────────────────────────────────────────────────────────

    pub async fn list_s3_buckets(
        &self,
        session_id: &str,
    ) -> Result<Vec<s3::Bucket>, String> {
        let clients = self.require_clients(session_id)?;
        clients
            .s3
            .list_buckets()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_s3_objects(
        &self,
        session_id: &str,
        bucket: &str,
        prefix: Option<&str>,
    ) -> Result<Vec<s3::Object>, String> {
        let clients = self.require_clients(session_id)?;
        clients
            .s3
            .list_objects_v2(bucket, prefix, None, None)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn create_s3_bucket(
        &self,
        session_id: &str,
        bucket_name: &str,
        region: &str,
    ) -> Result<String, String> {
        let clients = self.require_clients(session_id)?;
        clients
            .s3
            .create_bucket(bucket_name, Some(region))
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!(
            "S3 bucket {} created in region {}",
            bucket_name, region
        ))
    }

    // ── RDS ─────────────────────────────────────────────────────────

    pub async fn list_rds_instances(
        &self,
        session_id: &str,
    ) -> Result<Vec<rds::DBInstance>, String> {
        let clients = self.require_clients(session_id)?;
        clients
            .rds
            .describe_db_instances(None)
            .await
            .map_err(|e| e.to_string())
    }

    // ── Lambda ──────────────────────────────────────────────────────

    pub async fn list_lambda_functions(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<lambda::FunctionConfiguration>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .lambda
            .list_functions(None, None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    pub async fn invoke_lambda_function(
        &mut self,
        session_id: &str,
        function_name: &str,
        payload: Option<String>,
    ) -> Result<String, String> {
        let clients = self.require_clients(session_id)?;
        let payload_bytes = payload.map(|p| p.into_bytes()).unwrap_or_default();
        let result = clients
            .lambda
            .invoke(function_name, &payload_bytes, None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        let body = result
            .payload
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default();
        Ok(body)
    }

    // ── CloudWatch ──────────────────────────────────────────────────

    pub async fn get_cloudwatch_metrics(
        &mut self,
        session_id: &str,
        namespace: &str,
        metric_name: &str,
    ) -> Result<Vec<crate::cloudwatch::Metric>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .cloudwatch
            .list_metrics(Some(namespace), Some(metric_name), &[], None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    // ── IAM ─────────────────────────────────────────────────────────

    pub async fn list_iam_users(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::iam::User>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .iam
            .list_users(None, None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    pub async fn list_iam_roles(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::iam::Role>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .iam
            .list_roles(None, None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    // ── STS ─────────────────────────────────────────────────────────

    pub async fn get_caller_identity(
        &mut self,
        session_id: &str,
    ) -> Result<crate::sts::CallerIdentity, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .sts
            .get_caller_identity()
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    // ── SSM ─────────────────────────────────────────────────────────

    pub async fn get_ssm_parameter(
        &mut self,
        session_id: &str,
        name: &str,
        with_decryption: bool,
    ) -> Result<crate::ssm::Parameter, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .ssm
            .get_parameter(name, with_decryption)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    // ── Secrets Manager ─────────────────────────────────────────────

    pub async fn get_secret_value(
        &mut self,
        session_id: &str,
        secret_id: &str,
    ) -> Result<crate::secrets::SecretValue, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .secrets
            .get_secret_value(secret_id, None, None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    pub async fn list_secrets(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::secrets::SecretListEntry>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .secrets
            .list_secrets(None, None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    // ── ECS ─────────────────────────────────────────────────────────

    pub async fn list_ecs_clusters(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<String>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .ecs
            .list_clusters(None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    pub async fn list_ecs_services(
        &mut self,
        session_id: &str,
        cluster: &str,
    ) -> Result<Vec<String>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .ecs
            .list_services(cluster, None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    // ── Route 53 ────────────────────────────────────────────────────

    pub async fn list_hosted_zones(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::route53::HostedZone>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .route53
            .list_hosted_zones(None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    // ── SNS ─────────────────────────────────────────────────────────

    pub async fn list_sns_topics(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::sns::Topic>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .sns
            .list_topics(None)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    // ── SQS ─────────────────────────────────────────────────────────

    pub async fn list_sqs_queues(
        &mut self,
        session_id: &str,
        prefix: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .sqs
            .list_queues(prefix)
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }

    // ── CloudFormation ──────────────────────────────────────────────

    pub async fn list_cloudformation_stacks(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<crate::cloudformation::StackSummary>, String> {
        let clients = self.require_clients(session_id)?;
        let result = clients
            .cloudformation
            .list_stacks(&[])
            .await
            .map_err(|e| e.to_string())?;
        self.touch_session(session_id);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn new_service_creates_state() {
        let state = AwsService::new();
        let svc = state.lock().await;
        assert!(svc.sessions.is_empty());
    }

    #[tokio::test]
    async fn list_sessions_empty() {
        let state = AwsService::new();
        let svc = state.lock().await;
        assert!(svc.list_aws_sessions().await.is_empty());
    }
}

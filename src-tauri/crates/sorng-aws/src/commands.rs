//! Tauri command bindings for the AWS crate.
//!
//! Every `#[tauri::command]` declared here is registered in the main app's
//! command handler. Commands take `tauri::State<'_, AwsServiceState>` and
//! delegate to `AwsService` methods.

use crate::cloudformation::StackSummary;
use crate::cloudwatch::Metric;
use crate::config::AwsConnectionConfig;
use crate::config::AwsSession;
use crate::ec2::Instance;
use crate::iam::{Role, User};
use crate::lambda::FunctionConfiguration;
use crate::rds::DBInstance;
use crate::route53::HostedZone;
use crate::s3::{Bucket, Object};
use crate::secrets::{SecretListEntry, SecretValue};
use crate::service::AwsServiceState;
use crate::sns::Topic;
use crate::ssm::Parameter;
use crate::sts::CallerIdentity;

// ── Session management ──────────────────────────────────────────────────

#[tauri::command]
pub async fn connect_aws(
    state: tauri::State<'_, AwsServiceState>,
    config: AwsConnectionConfig,
) -> Result<String, String> {
    let mut aws = state.lock().await;
    aws.connect_aws(config).await
}

#[tauri::command]
pub async fn disconnect_aws(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut aws = state.lock().await;
    aws.disconnect_aws(&session_id).await
}

#[tauri::command]
pub async fn list_aws_sessions(
    state: tauri::State<'_, AwsServiceState>,
) -> Result<Vec<AwsSession>, String> {
    let aws = state.lock().await;
    Ok(aws.list_aws_sessions().await)
}

#[tauri::command]
pub async fn get_aws_session(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<AwsSession, String> {
    let aws = state.lock().await;
    aws.get_aws_session(&session_id)
        .await
        .ok_or_else(|| format!("AWS session {} not found", session_id))
}

// ── EC2 ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_ec2_instances(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<Instance>, String> {
    let mut aws = state.lock().await;
    aws.list_ec2_instances(&session_id).await
}

#[tauri::command]
pub async fn execute_ec2_action(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    instance_id: String,
    action: String,
) -> Result<String, String> {
    let mut aws = state.lock().await;
    aws.execute_ec2_action(&session_id, &instance_id, &action)
        .await
}

// ── S3 ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_s3_buckets(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<Bucket>, String> {
    let mut aws = state.lock().await;
    aws.list_s3_buckets(&session_id).await
}

#[tauri::command]
pub async fn get_s3_objects(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    bucket: String,
    prefix: Option<String>,
) -> Result<Vec<Object>, String> {
    let mut aws = state.lock().await;
    aws.list_s3_objects(&session_id, &bucket, prefix.as_deref())
        .await
}

#[tauri::command]
pub async fn create_s3_bucket(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    bucket_name: String,
    region: String,
) -> Result<String, String> {
    let mut aws = state.lock().await;
    aws.create_s3_bucket(&session_id, &bucket_name, &region)
        .await
}

// ── RDS ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_rds_instances(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<DBInstance>, String> {
    let mut aws = state.lock().await;
    aws.list_rds_instances(&session_id).await
}

// ── Lambda ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_lambda_functions(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<FunctionConfiguration>, String> {
    let mut aws = state.lock().await;
    aws.list_lambda_functions(&session_id).await
}

#[tauri::command]
pub async fn invoke_lambda_function(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    function_name: String,
    payload: Option<String>,
) -> Result<String, String> {
    let mut aws = state.lock().await;
    aws.invoke_lambda_function(&session_id, &function_name, payload)
        .await
}

// ── CloudWatch ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_cloudwatch_metrics(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    namespace: String,
    metric_name: String,
) -> Result<Vec<Metric>, String> {
    let mut aws = state.lock().await;
    aws.get_cloudwatch_metrics(&session_id, &namespace, &metric_name)
        .await
}

// ── IAM ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_iam_users(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<User>, String> {
    let mut aws = state.lock().await;
    aws.list_iam_users(&session_id).await
}

#[tauri::command]
pub async fn list_iam_roles(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<Role>, String> {
    let mut aws = state.lock().await;
    aws.list_iam_roles(&session_id).await
}

// ── STS ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_caller_identity(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<CallerIdentity, String> {
    let mut aws = state.lock().await;
    aws.get_caller_identity(&session_id).await
}

// ── SSM ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_ssm_parameter(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    name: String,
    with_decryption: bool,
) -> Result<Parameter, String> {
    let mut aws = state.lock().await;
    aws.get_ssm_parameter(&session_id, &name, with_decryption)
        .await
}

// ── Secrets Manager ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_secret_value(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    secret_id: String,
) -> Result<SecretValue, String> {
    let mut aws = state.lock().await;
    aws.get_secret_value(&session_id, &secret_id).await
}

#[tauri::command]
pub async fn list_secrets(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<SecretListEntry>, String> {
    let mut aws = state.lock().await;
    aws.list_secrets(&session_id).await
}

// ── ECS ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_ecs_clusters(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let mut aws = state.lock().await;
    aws.list_ecs_clusters(&session_id).await
}

#[tauri::command]
pub async fn list_ecs_services(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    cluster: String,
) -> Result<Vec<String>, String> {
    let mut aws = state.lock().await;
    aws.list_ecs_services(&session_id, &cluster).await
}

// ── Route 53 ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_hosted_zones(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<HostedZone>, String> {
    let mut aws = state.lock().await;
    aws.list_hosted_zones(&session_id).await
}

// ── SNS ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_sns_topics(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<Topic>, String> {
    let mut aws = state.lock().await;
    aws.list_sns_topics(&session_id).await
}

// ── SQS ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_sqs_queues(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    prefix: Option<String>,
) -> Result<Vec<String>, String> {
    let mut aws = state.lock().await;
    aws.list_sqs_queues(&session_id, prefix.as_deref()).await
}

// ── CloudFormation ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_cloudformation_stacks(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<StackSummary>, String> {
    let mut aws = state.lock().await;
    aws.list_cloudformation_stacks(&session_id).await
}

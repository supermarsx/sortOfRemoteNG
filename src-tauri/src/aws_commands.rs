use crate::aws;

#[tauri::command]
pub async fn connect_aws(
    state: tauri::State<'_, aws::AwsServiceState>,
    config: aws::AwsConnectionConfig,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.connect_aws(config).await
}

#[tauri::command]
pub async fn disconnect_aws(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.disconnect_aws(&session_id).await
}

#[tauri::command]
pub async fn list_aws_sessions(
    state: tauri::State<'_, aws::AwsServiceState>,
) -> Result<Vec<aws::AwsSession>, String> {
    let service = state.lock().await;
    Ok(service.list_aws_sessions().await)
}

#[tauri::command]
pub async fn get_aws_session(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<aws::AwsSession, String> {
    let service = state.lock().await;
    service
        .get_aws_session(&session_id)
        .await
        .ok_or_else(|| format!("AWS session {} not found", session_id))
}

#[tauri::command]
pub async fn list_ec2_instances(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::ec2::Instance>, String> {
    let service = state.lock().await;
    service.list_ec2_instances(&session_id).await
}

#[tauri::command]
pub async fn execute_ec2_action(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
    instance_id: String,
    action: String,
) -> Result<String, String> {
    let service = state.lock().await;
    service
        .execute_ec2_action(&session_id, &instance_id, &action)
        .await
}

#[tauri::command]
pub async fn list_s3_buckets(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::s3::Bucket>, String> {
    let service = state.lock().await;
    service.list_s3_buckets(&session_id).await
}

#[tauri::command]
pub async fn get_s3_objects(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
    bucket: String,
    prefix: Option<String>,
) -> Result<Vec<aws::s3::Object>, String> {
    let service = state.lock().await;
    service
        .list_s3_objects(&session_id, &bucket, prefix.as_deref())
        .await
}

#[tauri::command]
pub async fn create_s3_bucket(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
    bucket_name: String,
    region: String,
) -> Result<String, String> {
    let service = state.lock().await;
    service
        .create_s3_bucket(&session_id, &bucket_name, &region)
        .await
}

#[tauri::command]
pub async fn list_rds_instances(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::rds::DBInstance>, String> {
    let service = state.lock().await;
    service.list_rds_instances(&session_id).await
}

#[tauri::command]
pub async fn list_lambda_functions(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::lambda::FunctionConfiguration>, String> {
    let service = state.lock().await;
    service.list_lambda_functions(&session_id).await
}

#[tauri::command]
pub async fn invoke_lambda_function(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
    function_name: String,
    payload: Option<String>,
) -> Result<String, String> {
    let service = state.lock().await;
    service
        .invoke_lambda_function(&session_id, &function_name, payload)
        .await
}

#[tauri::command]
pub async fn get_cloudwatch_metrics(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
    namespace: String,
    metric_name: String,
) -> Result<Vec<aws::cloudwatch::Metric>, String> {
    let service = state.lock().await;
    service
        .get_cloudwatch_metrics(&session_id, &namespace, &metric_name)
        .await
}

#[tauri::command]
pub async fn list_iam_users(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::iam::User>, String> {
    let service = state.lock().await;
    service.list_iam_users(&session_id).await
}

#[tauri::command]
pub async fn list_iam_roles(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::iam::Role>, String> {
    let service = state.lock().await;
    service.list_iam_roles(&session_id).await
}

#[tauri::command]
pub async fn get_caller_identity(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<aws::sts::CallerIdentity, String> {
    let service = state.lock().await;
    service.get_caller_identity(&session_id).await
}

#[tauri::command]
pub async fn get_ssm_parameter(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
    name: String,
    with_decryption: bool,
) -> Result<aws::ssm::Parameter, String> {
    let service = state.lock().await;
    service
        .get_ssm_parameter(&session_id, &name, with_decryption)
        .await
}

#[tauri::command]
pub async fn get_secret_value(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
    secret_id: String,
) -> Result<aws::secrets::SecretValue, String> {
    let service = state.lock().await;
    service.get_secret_value(&session_id, &secret_id).await
}

#[tauri::command]
pub async fn list_secrets(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::secrets::SecretListEntry>, String> {
    let service = state.lock().await;
    service.list_secrets(&session_id).await
}

#[tauri::command]
pub async fn list_ecs_clusters(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<String>, String> {
    let service = state.lock().await;
    service.list_ecs_clusters(&session_id).await
}

#[tauri::command]
pub async fn list_ecs_services(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
    cluster: String,
) -> Result<Vec<String>, String> {
    let service = state.lock().await;
    service.list_ecs_services(&session_id, &cluster).await
}

#[tauri::command]
pub async fn list_hosted_zones(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::route53::HostedZone>, String> {
    let service = state.lock().await;
    service.list_hosted_zones(&session_id).await
}

#[tauri::command]
pub async fn list_sns_topics(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::sns::Topic>, String> {
    let service = state.lock().await;
    service.list_sns_topics(&session_id).await
}

#[tauri::command]
pub async fn list_sqs_queues(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
    prefix: Option<String>,
) -> Result<Vec<String>, String> {
    let service = state.lock().await;
    service
        .list_sqs_queues(&session_id, prefix.as_deref())
        .await
}

#[tauri::command]
pub async fn list_cloudformation_stacks(
    state: tauri::State<'_, aws::AwsServiceState>,
    session_id: String,
) -> Result<Vec<aws::cloudformation::StackSummary>, String> {
    let service = state.lock().await;
    service.list_cloudformation_stacks(&session_id).await
}

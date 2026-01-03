use std::sync::Arc;
use tokio::sync::Mutex;
use std::collections::HashMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use reqwest::Client;

pub type AwsServiceState = Arc<Mutex<AwsService>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsConnectionConfig {
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub profile_name: Option<String>,
    pub role_arn: Option<String>,
    pub mfa_serial: Option<String>,
    pub mfa_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsSession {
    pub id: String,
    pub config: AwsConnectionConfig,
    pub connected_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub is_connected: bool,
    pub services: Vec<AwsServiceInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsServiceInfo {
    pub service_name: String,
    pub endpoint: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ec2Instance {
    pub instance_id: String,
    pub instance_type: String,
    pub state: String,
    pub public_ip: Option<String>,
    pub private_ip: Option<String>,
    pub launch_time: String,
    pub availability_zone: String,
    pub tags: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Bucket {
    pub name: String,
    pub creation_date: String,
    pub region: String,
    pub objects_count: Option<u64>,
    pub total_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdsInstance {
    pub db_instance_identifier: String,
    pub db_instance_class: String,
    pub engine: String,
    pub db_instance_status: String,
    pub endpoint: Option<String>,
    pub port: Option<u16>,
    pub allocated_storage: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LambdaFunction {
    pub function_name: String,
    pub runtime: String,
    pub handler: String,
    pub last_modified: String,
    pub state: String,
    pub state_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudWatchMetric {
    pub namespace: String,
    pub metric_name: String,
    pub dimensions: HashMap<String, String>,
    pub value: f64,
    pub unit: String,
    pub timestamp: String,
}

pub struct AwsService {
    sessions: HashMap<String, AwsSession>,
    http_client: Client,
}

impl AwsService {
    pub fn new() -> AwsServiceState {
        Arc::new(Mutex::new(AwsService {
            sessions: HashMap::new(),
            http_client: Client::new(),
        }))
    }

    pub async fn connect_aws(&mut self, config: AwsConnectionConfig) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        // In a real implementation, this would validate AWS credentials
        // For now, we'll create a mock session
        let session = AwsSession {
            id: session_id.clone(),
            config: config.clone(),
            connected_at: Utc::now(),
            last_activity: Utc::now(),
            is_connected: true,
            services: vec![
                AwsServiceInfo {
                    service_name: "EC2".to_string(),
                    endpoint: format!("https://ec2.{}.amazonaws.com", config.region),
                    status: "available".to_string(),
                },
                AwsServiceInfo {
                    service_name: "S3".to_string(),
                    endpoint: format!("https://s3.{}.amazonaws.com", config.region),
                    status: "available".to_string(),
                },
                AwsServiceInfo {
                    service_name: "RDS".to_string(),
                    endpoint: format!("https://rds.{}.amazonaws.com", config.region),
                    status: "available".to_string(),
                },
                AwsServiceInfo {
                    service_name: "Lambda".to_string(),
                    endpoint: format!("https://lambda.{}.amazonaws.com", config.region),
                    status: "available".to_string(),
                },
                AwsServiceInfo {
                    service_name: "CloudWatch".to_string(),
                    endpoint: format!("https://monitoring.{}.amazonaws.com", config.region),
                    status: "available".to_string(),
                },
            ],
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub async fn disconnect_aws(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.is_connected = false;
            session.last_activity = Utc::now();
            Ok(())
        } else {
            Err(format!("AWS session {} not found", session_id))
        }
    }

    pub async fn list_aws_sessions(&self) -> Vec<AwsSession> {
        self.sessions.values().cloned().collect()
    }

    pub async fn get_aws_session(&self, session_id: &str) -> Option<AwsSession> {
        self.sessions.get(session_id).cloned()
    }

    pub async fn list_ec2_instances(&self, session_id: &str) -> Result<Vec<Ec2Instance>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("AWS session {} not found", session_id));
        }

        // Mock EC2 instances for demonstration
        Ok(vec![
            Ec2Instance {
                instance_id: "i-1234567890abcdef0".to_string(),
                instance_type: "t3.micro".to_string(),
                state: "running".to_string(),
                public_ip: Some("54.123.45.67".to_string()),
                private_ip: Some("10.0.1.100".to_string()),
                launch_time: "2024-01-01T00:00:00Z".to_string(),
                availability_zone: "us-east-1a".to_string(),
                tags: HashMap::from([
                    ("Name".to_string(), "web-server".to_string()),
                    ("Environment".to_string(), "production".to_string()),
                ]),
            },
            Ec2Instance {
                instance_id: "i-0987654321fedcba0".to_string(),
                instance_type: "t3.small".to_string(),
                state: "stopped".to_string(),
                public_ip: None,
                private_ip: Some("10.0.1.101".to_string()),
                launch_time: "2024-01-02T00:00:00Z".to_string(),
                availability_zone: "us-east-1b".to_string(),
                tags: HashMap::from([
                    ("Name".to_string(), "database".to_string()),
                    ("Environment".to_string(), "staging".to_string()),
                ]),
            },
        ])
    }

    pub async fn list_s3_buckets(&self, session_id: &str) -> Result<Vec<S3Bucket>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("AWS session {} not found", session_id));
        }

        // Mock S3 buckets for demonstration
        Ok(vec![
            S3Bucket {
                name: "my-app-bucket".to_string(),
                creation_date: "2024-01-01T00:00:00Z".to_string(),
                region: "us-east-1".to_string(),
                objects_count: Some(150),
                total_size: Some(1073741824), // 1GB
            },
            S3Bucket {
                name: "backup-bucket".to_string(),
                creation_date: "2024-01-02T00:00:00Z".to_string(),
                region: "us-west-2".to_string(),
                objects_count: Some(500),
                total_size: Some(5368709120), // 5GB
            },
        ])
    }

    pub async fn list_rds_instances(&self, session_id: &str) -> Result<Vec<RdsInstance>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("AWS session {} not found", session_id));
        }

        // Mock RDS instances for demonstration
        Ok(vec![
            RdsInstance {
                db_instance_identifier: "my-database".to_string(),
                db_instance_class: "db.t3.micro".to_string(),
                engine: "mysql".to_string(),
                db_instance_status: "available".to_string(),
                endpoint: Some("my-database.cluster-random.us-east-1.rds.amazonaws.com".to_string()),
                port: Some(3306),
                allocated_storage: Some(20),
            },
        ])
    }

    pub async fn list_lambda_functions(&self, session_id: &str) -> Result<Vec<LambdaFunction>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("AWS session {} not found", session_id));
        }

        // Mock Lambda functions for demonstration
        Ok(vec![
            LambdaFunction {
                function_name: "my-api-function".to_string(),
                runtime: "nodejs18.x".to_string(),
                handler: "index.handler".to_string(),
                last_modified: "2024-01-01T00:00:00Z".to_string(),
                state: "Active".to_string(),
                state_reason: None,
            },
        ])
    }

    pub async fn get_cloudwatch_metrics(&self, session_id: &str, namespace: &str, metric_name: &str) -> Result<Vec<CloudWatchMetric>, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("AWS session {} not found", session_id));
        }

        // Mock CloudWatch metrics for demonstration
        Ok(vec![
            CloudWatchMetric {
                namespace: namespace.to_string(),
                metric_name: metric_name.to_string(),
                dimensions: HashMap::from([
                    ("InstanceId".to_string(), "i-1234567890abcdef0".to_string()),
                ]),
                value: 75.0,
                unit: "Percent".to_string(),
                timestamp: "2024-01-03T12:00:00Z".to_string(),
            },
        ])
    }

    pub async fn execute_ec2_action(&self, session_id: &str, instance_id: &str, action: &str) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("AWS session {} not found", session_id));
        }

        // Mock EC2 actions for demonstration
        match action {
            "start" | "stop" | "reboot" | "terminate" => {
                Ok(format!("EC2 instance {} {} action initiated", instance_id, action))
            },
            _ => Err(format!("Unknown EC2 action: {}", action)),
        }
    }

    pub async fn create_s3_bucket(&self, session_id: &str, bucket_name: &str, region: &str) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("AWS session {} not found", session_id));
        }

        // Mock S3 bucket creation
        Ok(format!("S3 bucket {} created in region {}", bucket_name, region))
    }

    pub async fn invoke_lambda_function(&self, session_id: &str, function_name: &str, payload: Option<String>) -> Result<String, String> {
        if !self.sessions.contains_key(session_id) {
            return Err(format!("AWS session {} not found", session_id));
        }

        // Mock Lambda invocation
        let payload_str = payload.unwrap_or_else(|| "{}".to_string());
        Ok(format!("Lambda function {} invoked with payload: {}", function_name, payload_str))
    }
}

// Tauri commands
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

#[tauri::command]
pub async fn list_ec2_instances(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<Ec2Instance>, String> {
    let aws = state.lock().await;
    aws.list_ec2_instances(&session_id).await
}

#[tauri::command]
pub async fn list_s3_buckets(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<S3Bucket>, String> {
    let aws = state.lock().await;
    aws.list_s3_buckets(&session_id).await
}

#[tauri::command]
pub async fn list_rds_instances(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<RdsInstance>, String> {
    let aws = state.lock().await;
    aws.list_rds_instances(&session_id).await
}

#[tauri::command]
pub async fn list_lambda_functions(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
) -> Result<Vec<LambdaFunction>, String> {
    let aws = state.lock().await;
    aws.list_lambda_functions(&session_id).await
}

#[tauri::command]
pub async fn get_cloudwatch_metrics(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    namespace: String,
    metric_name: String,
) -> Result<Vec<CloudWatchMetric>, String> {
    let aws = state.lock().await;
    aws.get_cloudwatch_metrics(&session_id, &namespace, &metric_name).await
}

#[tauri::command]
pub async fn execute_ec2_action(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    instance_id: String,
    action: String,
) -> Result<String, String> {
    let aws = state.lock().await;
    aws.execute_ec2_action(&session_id, &instance_id, &action).await
}

#[tauri::command]
pub async fn create_s3_bucket(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    bucket_name: String,
    region: String,
) -> Result<String, String> {
    let aws = state.lock().await;
    aws.create_s3_bucket(&session_id, &bucket_name, &region).await
}

#[tauri::command]
pub async fn invoke_lambda_function(
    state: tauri::State<'_, AwsServiceState>,
    session_id: String,
    function_name: String,
    payload: Option<String>,
) -> Result<String, String> {
    let aws = state.lock().await;
    aws.invoke_lambda_function(&session_id, &function_name, payload).await
}
//! # sorng-aws – Comprehensive AWS integration crate
//!
//! Provides AWS service clients with real SigV4 request signing, covering
//! EC2, S3, IAM, STS, Lambda, RDS, CloudWatch, SSM, Secrets Manager,
//! Route 53, ECS, SNS, SQS, and CloudFormation.
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────────────────────────────────────────┐
//! │  AwsService  (service.rs)                        │
//! │  ├── session management                          │
//! │  └── per-session bundle of:                      │
//! │       Ec2Client · S3Client · IamClient           │
//! │       StsClient · LambdaClient · RdsClient       │
//! │       CloudWatchClient · SsmClient               │
//! │       SecretsManagerClient · Route53Client        │
//! │       EcsClient · SnsClient · SqsClient          │
//! │       CloudFormationClient                       │
//! ├──────────────────────────────────────────────────┤
//! │  AwsClient  (client.rs)                          │
//! │  ├── query_request  (EC2, IAM, STS, CW, …)      │
//! │  ├── json_request   (Lambda, ECS, SSM, SM, …)   │
//! │  └── rest_xml_request  (S3, Route 53)            │
//! ├──────────────────────────────────────────────────┤
//! │  SigV4Signer  (signing.rs)                       │
//! │  └── hmac-sha256 / canonical request / signing   │
//! └──────────────────────────────────────────────────┘
//! ```
//!
//! ## API Protocols
//!
//! | Protocol    | Services                                    |
//! |-------------|---------------------------------------------|
//! | Query + XML | EC2, IAM, STS, CloudWatch, RDS, SNS, SQS, CloudFormation |
//! | REST + JSON | Lambda, ECS, SSM, Secrets Manager, CloudWatch Logs |
//! | REST + XML  | S3, Route 53                                |

// ── Sub-modules ─────────────────────────────────────────────────────────

pub mod error;
pub mod config;
pub mod signing;
pub mod client;

// Service clients
pub mod ec2;
pub mod s3;
pub mod iam;
pub mod sts;
pub mod lambda;
pub mod rds;
pub mod cloudwatch;
pub mod ssm;
pub mod secrets;
pub mod route53;
pub mod ecs;
pub mod sns;
pub mod sqs;
pub mod cloudformation;

// High-level service + Tauri bindings
pub mod service;
pub mod commands;

// ── Re-exports for ergonomic access ─────────────────────────────────────

pub use config::{
    AwsConnectionConfig, AwsCredentials, AwsProfile, AwsRegion, AwsServiceInfo, AwsSession,
    Filter, PaginatedResponse, RetryConfig, SdkConfig, Tag,
};
pub use error::{AwsError, AwsResult};
pub use service::{AwsService, AwsServiceState};

// Re-export all Tauri commands for registration in the main app
pub use commands::{
    connect_aws,
    create_s3_bucket,
    disconnect_aws,
    execute_ec2_action,
    get_aws_session,
    get_caller_identity,
    get_cloudwatch_metrics,
    get_s3_objects,
    get_secret_value,
    get_ssm_parameter,
    invoke_lambda_function,
    list_aws_sessions,
    list_cloudformation_stacks,
    list_ec2_instances,
    list_ecs_clusters,
    list_ecs_services,
    list_hosted_zones,
    list_iam_roles,
    list_iam_users,
    list_lambda_functions,
    list_rds_instances,
    list_s3_buckets,
    list_secrets,
    list_sns_topics,
    list_sqs_queues,
};

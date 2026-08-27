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

// `AwsError` is a flat struct of required fields — four `String`s (two of them
// optional), an HTTP status code and a retry flag — which lands on exactly the
// 128-byte default threshold of `clippy::result_large_err`. There is no large
// element to box, so satisfying the lint would mean returning `Box<AwsError>`
// from every public method in the crate: an API change rather than a lint fix.
// Revisit if the struct grows further.
#![allow(clippy::result_large_err)]

// ── Vendor dylib re-exports ──────────────────────────────────────────────
pub(crate) use sorng_aws_vendor::hmac;
pub(crate) use sorng_aws_vendor::hex;
pub(crate) use sorng_aws_vendor::percent_encoding;
pub(crate) use sorng_aws_vendor::sha2;

// ── Sub-modules ─────────────────────────────────────────────────────────

pub mod client;
pub mod config;
pub mod error;
pub mod signing;

// Service clients
pub mod cloudformation;
pub mod cloudwatch;
pub mod ec2;
pub mod ecs;
pub mod iam;
pub mod lambda;
pub mod rds;
pub mod route53;
pub mod s3;
pub mod secrets;
pub mod sns;
pub mod sqs;
pub mod ssm;
pub mod sts;

// High-level service
pub mod service;

// ── Re-exports for ergonomic access ─────────────────────────────────────

pub use config::{
    AwsConnectionConfig, AwsCredentials, AwsProfile, AwsRegion, AwsServiceInfo, AwsSession, Filter,
    PaginatedResponse, RetryConfig, SdkConfig, Tag,
};
pub use error::{AwsError, AwsResult};
pub use service::{AwsService, AwsServiceState};

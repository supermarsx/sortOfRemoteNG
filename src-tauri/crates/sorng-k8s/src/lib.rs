//! # SortOfRemote NG – Kubernetes Management
//!
//! Comprehensive Kubernetes cluster management via the Kubernetes API.
//! Supports both kubeconfig-based and in-cluster authentication with
//! full CRUD for all major resource types.
//!
//! ## Modules
//!
//! - **types** — Shared data structures (clusters, pods, deployments, services, etc.)
//! - **error** — Crate-specific error types
//! - **kubeconfig** — Kubeconfig parsing, context switching, credential management
//! - **client** — HTTP client for the Kubernetes API with auth, TLS, token refresh
//! - **pods** — Pod lifecycle, logs, exec, port-forward, ephemeral containers
//! - **deployments** — Deployment CRUD, scaling, rollouts, rollback
//! - **services** — Service CRUD, type management, endpoint resolution
//! - **configmaps** — ConfigMap CRUD with data/binaryData support
//! - **secrets** — Secret CRUD with type-aware encoding (Opaque, TLS, Docker, etc.)
//! - **namespaces** — Namespace lifecycle, quota, limit ranges
//! - **ingress** — Ingress / IngressClass CRUD, TLS termination, path rules
//! - **jobs** — Job and CronJob lifecycle, completion tracking
//! - **nodes** — Node info, taints, labels, cordon/uncordon, drain
//! - **rbac** — Roles, ClusterRoles, RoleBindings, ClusterRoleBindings, ServiceAccounts
//! - **helm** — Helm release management (list, install, upgrade, rollback, uninstall)
//! - **events** — Cluster event streaming and filtering
//! - **metrics** — Resource metrics (CPU, memory) for nodes and pods
//! - **service** — Aggregate façade + Tauri state alias
//! - **commands** — `#[tauri::command]` handlers

pub mod client;
pub mod configmaps;
pub mod deployments;
pub mod error;
pub mod events;
pub mod helm;
pub mod ingress;
pub mod jobs;
pub mod kubeconfig;
pub mod metrics;
pub mod namespaces;
pub mod nodes;
pub mod pods;
pub mod rbac;
pub mod secrets;
pub mod service;
pub mod services;
pub mod types;

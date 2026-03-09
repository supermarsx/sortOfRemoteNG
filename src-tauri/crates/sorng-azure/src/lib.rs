//! # SortOfRemote NG – Azure Integration
//!
//! Comprehensive Azure Resource Manager (ARM) REST API integration for cloud
//! infrastructure management.
//!
//! ## Features
//!
//! - **OAuth2 Authentication** – client credentials & authorization-code flows, token cache
//! - **Virtual Machines** – list, get, start, stop, restart, deallocate, delete, resize, instance view
//! - **Resource Groups** – list, get, create, update, delete, export template
//! - **Storage Accounts** – list, get, create, delete, list keys, regenerate keys, list containers, blobs
//! - **Networking** – VNets, subnets, NSGs, public IPs, NICs, load balancers
//! - **App Service** – web apps, function apps, deployment slots, start/stop/restart
//! - **SQL Databases** – servers, databases, firewall rules
//! - **Key Vault** – secrets list/get/set/delete, keys list, certificates list
//! - **Container Instances** – container groups list/get/create/delete, logs
//! - **Monitor** – metrics, activity log, metric alerts
//! - **Cost Management** – usage details, budgets, cost forecast
//! - **Resource Search** – query resources across subscriptions

pub mod app_service;
pub mod auth;
pub mod client;
pub mod commands;
pub mod container_instances;
pub mod cost;
pub mod key_vault;
pub mod monitor;
pub mod networking;
pub mod resource_groups;
pub mod search;
pub mod service;
pub mod sql;
pub mod storage;
pub mod types;
pub mod virtual_machines;

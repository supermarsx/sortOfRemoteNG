//! # SortOfRemote NG – Exchange Integration
//!
//! Comprehensive Microsoft Exchange Server (on-premises) and Exchange Online
//! management integration covering the top 30% most common administrative
//! operations.
//!
//! ## Features
//!
//! - **Authentication** – Kerberos/NTLM for on-prem EMS, OAuth2 for Exchange Online & Graph API
//! - **Mailboxes** – list, get, create, remove, set quotas, enable/disable, permissions, forwarding, OOF, statistics
//! - **Distribution Groups** – CRUD, membership management, dynamic groups, M365 groups
//! - **Transport Rules** – list, create, update, remove, enable/disable mail flow rules
//! - **Connectors** – send/receive connectors (on-prem), inbound/outbound connectors (online)
//! - **Mail Flow** – message trace, queue management, delivery reports
//! - **Calendars** – calendar permissions, resource mailbox configuration, booking policies
//! - **Public Folders** – list, create, remove, mail-enable, statistics
//! - **Address Policies** – email address policies, accepted domains, address lists
//! - **Migration** – migration batches, move requests, status monitoring
//! - **Compliance** – retention policies, retention tags, DLP policies, holds
//! - **Health** – server health, database status, DAG replication, service health (online)
//! - **Contacts** – mail contacts, mail users (external recipients)
//! - **Shared Mailboxes** – convert, automapping, send-as, send-on-behalf, room/equipment
//! - **Archive** – enable/disable archive, auto-expanding archive, quotas
//! - **Mobile Devices** – ActiveSync devices, wipe, block, allow
//! - **Inbox Rules** – per-mailbox inbox rules CRUD
//! - **Policies** – OWA, mobile device, throttling policies
//! - **Journal Rules** – journal rules for compliance
//! - **RBAC & Audit** – role groups, management roles, role assignments, admin/mailbox audit
//! - **Remote Domains** – remote domain configuration
//! - **Certificates** – Exchange certificate management
//! - **Virtual Directories & Org Config** – OWA/ECP/EWS/MAPI/etc. virtual directories, org & transport config
//! - **Anti-Spam & Hygiene** – content filter, connection filter, sender filter, quarantine, PST import/export

pub mod types;
pub mod auth;
pub mod client;
pub mod mailbox;
pub mod distribution_groups;
pub mod transport;
pub mod connectors;
pub mod mail_flow;
pub mod calendars;
pub mod public_folders;
pub mod address_policy;
pub mod migration;
pub mod compliance;
pub mod health;
pub mod contacts;
pub mod shared_mailbox;
pub mod archive;
pub mod mobile_devices;
pub mod inbox_rules;
pub mod policies;
pub mod journal_rules;
pub mod rbac_audit;
pub mod remote_domains;
pub mod certificates;
pub mod org_config;
pub mod hygiene;
pub mod service;
pub mod commands;

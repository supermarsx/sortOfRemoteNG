//! # sorng-ldap — LDAP Directory Management
//!
//! OpenLDAP, 389DS, FreeIPA administration — users, groups, OUs, schema, replication.

pub mod types;
pub mod error;
pub mod client;
pub mod service;
pub mod entries;
pub mod users;
pub mod groups;
pub mod ous;
pub mod schema;
pub mod replication;
pub mod slapd;
pub mod ldif;

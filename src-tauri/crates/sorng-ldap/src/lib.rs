//! # sorng-ldap — LDAP Directory Management
//!
//! OpenLDAP, 389DS, FreeIPA administration — users, groups, OUs, schema, replication.

pub mod client;
pub mod entries;
pub mod error;
pub mod groups;
pub mod ldif;
pub mod ous;
pub mod replication;
pub mod schema;
pub mod service;
pub mod slapd;
pub mod types;
pub mod users;

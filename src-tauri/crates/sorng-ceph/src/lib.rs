//! # sorng-ceph
//!
//! Ceph distributed storage cluster integration for SortOfRemote NG.
//!
//! Manages Ceph clusters via the Ceph Manager REST API (ceph-mgr RESTful module),
//! ceph CLI wrappers, and RADOS operations. Provides comprehensive management of:
//!
//! - **Cluster health & status** — overall health, storage stats, quorum
//! - **OSD management** — lifecycle, reweighting, device classes, performance
//! - **Pool operations** — create/delete, quotas, compression, erasure coding
//! - **RBD images** — block device management, snapshots, cloning, mirroring
//! - **CephFS** — filesystem management, MDS, subvolumes, client eviction
//! - **RGW (S3/Swift)** — user management, buckets, quotas, multi-site zones
//! - **CRUSH maps** — rules, buckets, tunables, topology management
//! - **Monitors** — quorum status, monitor map, store compaction
//! - **MDS** — metadata server management and performance
//! - **Placement Groups** — PG states, repair, scrub, stuck PG analysis
//! - **Performance metrics** — IOPS, throughput, latency, slow requests
//! - **Alerts** — health checks, muting, acknowledgment

pub mod alerts;
pub mod cephfs;
pub mod cluster;
pub mod crush;
pub mod error;
pub mod mds;
pub mod monitors;
pub mod osd;
pub mod performance;
pub mod pg;
pub mod pools;
pub mod rbd;
pub mod rgw;
pub mod service;
pub mod types;

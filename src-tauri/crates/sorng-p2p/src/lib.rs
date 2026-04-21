//! # sorng-p2p — Peer-to-Peer Connectivity Engine
//!
//! This crate provides the foundational P2P infrastructure for SortOfRemote NG,
//! enabling direct peer-to-peer connections as an alternative to client→server
//! or client→gateway→target routing.
//!
//! ## Architecture
//!
//! The P2P stack is layered:
//!
//! 1. **NAT Detection** — Discovers the local NAT type (full-cone, restricted, symmetric)
//!    using STUN binding requests and heuristics.
//! 2. **STUN** — RFC 5389 client for discovering the public (server-reflexive) address.
//! 3. **TURN** — RFC 5766 relay allocation when direct connectivity is impossible.
//! 4. **ICE** — RFC 8445 candidate gathering, connectivity checks, and nomination.
//! 5. **Hole Punching** — UDP/TCP simultaneous-open techniques for NAT traversal.
//! 6. **Signaling** — WebSocket-based exchange of connection offers, answers, and
//!    ICE candidates between peers via a lightweight signaling broker.
//! 7. **Data Channel** — Encrypted, authenticated bidirectional byte stream over
//!    the established P2P connection.
//! 8. **Peer Discovery** — LAN (mDNS/DNS-SD) and WAN (rendezvous server) peer finding.
//! 9. **Relay** — Application-level relay fallback when all NAT traversal fails.
//! 10. **Peer Identity** — Mutual authentication using sorng-auth credentials and
//!     X25519 key exchange.
//!
//! ## Usage
//!
//! ```rust,ignore
//! let service = P2pService::new(data_dir);
//! let mut svc = service.lock().await;
//!
//! // Detect NAT type
//! let nat = svc.detect_nat_type().await?;
//!
//! // Create a connection offer
//! let offer = svc.create_offer("peer-id-xyz", 22).await?;
//!
//! // ... exchange offer/answer via signaling ...
//!
//! // Accept an offer from a remote peer
//! let session = svc.accept_offer(remote_offer).await?;
//!
//! // Get the local port for protocol proxying
//! let local_port = session.local_port;
//! ```

pub mod data_channel;
pub mod discovery;
pub mod hole_punch;
pub mod ice;
pub mod metrics;
pub mod nat_detect;
pub mod peer_identity;
pub mod relay;
pub mod service;
pub mod signaling;
pub mod stun;
pub mod turn;
pub mod types;

pub use service::{P2pService, P2pServiceState};
pub use types::*;

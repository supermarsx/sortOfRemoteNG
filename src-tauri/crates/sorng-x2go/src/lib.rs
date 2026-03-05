//! # sorng-x2go
//!
//! X2Go remote desktop protocol support for sortOfRemoteNG.
//!
//! X2Go provides graphical Linux remote desktop sessions over SSH. Built on
//! NX 3 technology, it supports session suspend/resume, file sharing, audio
//! forwarding, printing, and clipboard integration.
//!
//! ## Features
//!
//! - **SSH transport** — all traffic is encrypted via SSH tunnel
//! - **Session types** — Desktop (KDE, GNOME, Xfce, LXDE, etc.), single application, shadow
//! - **Suspend / resume** — detach and re-attach sessions seamlessly
//! - **File sharing** — SSHFS-based drive mounting
//! - **Audio forwarding** — PulseAudio forwarding to the client
//! - **Printing** — redirect remote print jobs to local printers
//! - **Clipboard** — bidirectional clipboard sharing
//! - **Multi-session** — manage many concurrent sessions

pub mod x2go;

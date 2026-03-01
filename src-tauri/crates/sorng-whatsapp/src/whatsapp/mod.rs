//! # sorng-whatsapp — WhatsApp Business Cloud API Integration
//!
//! Comprehensive WhatsApp Business Platform client for SortOfRemote NG.
//! Built against the **Meta Cloud API v21.0+** specification.
//!
//! ## Capabilities
//!
//! - **Messaging** – text, image, video, audio, document, sticker, location,
//!   contact, reaction, reply, forward, and interactive (list, button, CTA,
//!   product, catalog) messages.
//! - **Media** – upload, download, get URL, and delete media assets.
//! - **Templates** – create, list, delete, and send message templates with
//!   header/body/footer/button components, variables, and localization.
//! - **Contacts** – phone number verification (wa.me look-up via API).
//! - **Webhooks** – receive & verify incoming messages, delivery/read receipts,
//!   message status changes, and account alerts.
//! - **Business Profile** – get/update business profile (about, address,
//!   description, email, websites, profile picture).
//! - **Phone Numbers** – list, get, request verification code, verify code.
//! - **Two-Step Verification** – enable/disable 2FA PIN for phone numbers.
//! - **Registration** – register/deregister phone numbers.
//! - **Health & Analytics** – message analytics, conversation analytics.
//! - **Groups** – create, update, get info, add/remove participants, leave.
//! - **Interactive Flows** – WhatsApp Flows for structured interactions.

pub mod types;
pub mod error;
pub mod api_client;
pub mod auth;
pub mod messaging;
pub mod media;
pub mod templates;
pub mod contacts;
pub mod webhooks;
pub mod groups;
pub mod flows;
pub mod business_profile;
pub mod phone_numbers;
pub mod analytics;
pub mod unofficial;
pub mod pairing;
pub mod service;
pub mod commands;

// Re-exports
pub use commands::*;
pub use error::{WhatsAppError, WhatsAppResult};
pub use service::{WhatsAppService, WhatsAppServiceState};
pub use types::*;

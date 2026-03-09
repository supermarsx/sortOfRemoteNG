//! # SortOfRemote NG – Cloud
//!
//! Cloud provider integrations: IBM Cloud, DigitalOcean,
//! Heroku, Scaleway, Linode, OVH, Vercel, and Cloudflare.
//!
//! AWS has been moved to its own crate: `sorng-aws`.
//! Azure has been moved to its own crate: `sorng-azure`.
//! GCP has been moved to its own crate: `sorng-gcp`.

pub mod aws;
pub mod cloudflare;
pub mod digital_ocean;
pub mod gcp;
pub mod heroku;
pub mod ibm;
pub mod linode;
pub mod ovh;
pub mod scaleway;
pub mod vercel;

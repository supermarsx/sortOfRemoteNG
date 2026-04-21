//! Dynamically linked vendor dependencies for the AWS stack.
//!
//! Re-exports heavy/unique deps so downstream sorng-aws doesn't trigger
//! recompilation of the XML parser and crypto primitives on every change.

pub extern crate quick_xml;
pub extern crate percent_encoding;
pub extern crate hmac;
pub extern crate sha2;
pub extern crate hex;

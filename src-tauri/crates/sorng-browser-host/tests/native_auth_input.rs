//! Compile and exercise the production input driver without starting CEF.
#[path = "../src/native_auth_input.rs"]
mod input;

#[cfg(feature = "cef-host")]
const _: fn(&cef::Browser, &input::NativeAuthTarget, u16) -> bool = input::send_cef_character;

#[cfg(feature = "cef-host")]
const _: fn(&cef::Browser, &input::NativeAuthTarget, u16) -> bool = input::send_cef_login_character;

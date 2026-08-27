//! THE single table of request shapes per firmware generation.
//!
//! Nothing outside this file contains a phone URL path, query string, form
//! field name or status-page label. If a real phone disagrees with the public
//! documentation these constants were derived from, fix them here — the
//! driver is written to be tolerant of the exact strings.

/// Legacy generation: T20P / T21P / T22P / T26P / T28P on firmware ≤ v7x.
/// Whole UI is one CGI behind HTTP Basic (`admin`/`admin` factory default).
pub mod legacy {
    /// The CGI that serves every page (also the URL to open in a browser).
    pub const CGI: &str = "/cgi-bin/ConfigManApp.com";
    /// Login probe target (any authenticated GET works).
    pub const LOGIN_PROBE: &str = "/cgi-bin/ConfigManApp.com";
    /// Status page (`Id=1` is the first/status tab).
    pub const STATUS: &str = "/cgi-bin/ConfigManApp.com?Id=1";
    /// Action-URI reboot (Basic creds accepted).
    pub const REBOOT_ACTION_URI: &str = "/cgi-bin/ConfigManApp.com?key=Reboot";
    /// Web-UI reboot form (Upgrade tab submit). Best-effort: unverified on a
    /// real phone — a non-2xx answer is reported as `Unsupported`.
    pub const REBOOT_FORM: &str = "/cgi-bin/ConfigManApp.com";
    pub const REBOOT_FORM_FIELDS: &[(&str, &str)] = &[("Reboot", "Reboot")];
    /// Body marker that identifies this generation on a 200 probe.
    pub const BODY_MARKER: &str = "ConfigManApp.com";
    /// `WWW-Authenticate: Basic realm=…` substrings (lower-case) that
    /// identify this generation on a 401 probe.
    pub const REALM_MARKERS: &[&str] = &["yealink", "phone", "sip-t", "confbox", "voip"];
}

/// Servlet generation: T21P E2 and every v8x+ phone.
pub mod servlet {
    /// Login page (GET) — serves the form and (v8x+) an RSA public key.
    pub const LOGIN_FORM: &str = "/servlet?m=mod_listener&p=login&q=loginForm";
    /// Login POST target.
    pub const LOGIN_POST: &str = "/servlet?m=mod_listener&p=login&q=login";
    /// Post-login landing / status page.
    pub const STATUS: &str = "/servlet?m=mod_data&p=status&q=load";
    /// Logout.
    pub const LOGOUT: &str = "/servlet?m=mod_listener&p=login&q=logout";
    /// Action-URI reboot (Basic creds or session cookie; needs the phone's
    /// "Features → Remote Control → Action URI allow IP list").
    pub const REBOOT_ACTION_URI: &str = "/servlet?key=Reboot";
    /// Web-UI reboot form (Settings → Upgrade → Reboot).
    pub const REBOOT_FORM: &str = "/servlet?m=mod_data&p=settings-upgrade&q=reboot";
    pub const REBOOT_FORM_FIELDS: &[(&str, &str)] = &[];

    pub const FIELD_USERNAME: &str = "username";
    pub const FIELD_PASSWORD: &str = "pwd";
    pub const FIELD_RSAKEY: &str = "rsakey";
    pub const SESSION_COOKIE: &str = "JSESSIONID";
    /// Marker in a redirect `Location` / body that identifies this generation.
    pub const MARKER: &str = "servlet?m=mod_listener";
    /// Marker present in the login page (its absence after POST = success).
    pub const LOGIN_FORM_MARKER: &str = "loginForm";
    /// Marker of the post-login area.
    pub const DATA_MARKER: &str = "mod_data";
    /// Public exponent used by the phone's client-side RSA (0x10001).
    pub const RSA_EXPONENT_HEX: &str = "10001";
    /// Regexes that locate the RSA modulus (hex) in the login page.
    pub const RSA_KEY_PATTERNS: &[&str] = &[
        r#"rsakey\s*=\s*['"]([0-9a-fA-F]{64,})['"]"#,
        r#"RSA\.setPublic\(\s*['"]([0-9a-fA-F]{64,})['"]"#,
        r#"setPublic\(\s*['"]([0-9a-fA-F]{64,})['"]"#,
    ];

    /// Embedded-browser auto-login selectors.
    pub const SEL_USERNAME: &str = "input[name=username]";
    pub const SEL_PASSWORD: &str = "input[name=pwd]";
    pub const SEL_SUBMIT: &str = "input[type=submit],#login,button[type=submit]";
}

/// Status-page label → field mapping shared by both generations. Matching is
/// case-insensitive on a whitespace-normalised, colon-stripped label.
pub mod labels {
    pub const MODEL: &[&str] = &["product name", "model", "phone model", "product model"];
    pub const FIRMWARE: &[&str] = &["firmware version", "firmware", "software version"];
    pub const HARDWARE: &[&str] = &["hardware version", "hardware"];
    pub const MAC: &[&str] = &["mac", "mac address", "wan mac", "ethernet mac"];
    pub const IP: &[&str] = &["ipv4", "ip address", "wan ip", "ip", "ipv4 address"];
    pub const UPTIME: &[&str] = &["uptime", "up time", "running time"];
    /// Account rows look like `Account 1` / `Line 1` with a state value.
    pub const ACCOUNT_ROW: &str = r"(?i)^(?:account|line)\s*(\d+)\b";
    pub const REGISTERED_MARKERS: &[&str] = &["registered", "register ok", "online"];
    pub const UNREGISTERED_MARKERS: &[&str] = &[
        "unregistered",
        "register failed",
        "disabled",
        "offline",
        "registering",
        "not registered",
    ];
}

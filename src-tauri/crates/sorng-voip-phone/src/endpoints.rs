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
    /// Real firmware appends `&Random=<n>`; see [`PARAM_FORM_NONCE`].
    pub const LOGIN_FORM: &str = "/servlet?m=mod_listener&p=login&q=loginForm";
    /// Login POST target. Real firmware appends `&Rajax=<n>`; see
    /// [`PARAM_LOGIN_NONCE`].
    pub const LOGIN_POST: &str = "/servlet?m=mod_listener&p=login&q=login";
    /// Cache-buster the phone's own pages append to the login-page GET.
    pub const PARAM_FORM_NONCE: &str = "Random";
    /// Cache-buster the phone's own pages append to the login POST.
    pub const PARAM_LOGIN_NONCE: &str = "Rajax";
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
    /// RSA-wrapped AES key (hex string) — NOT the modulus.
    pub const FIELD_RSAKEY: &str = "rsakey";
    /// RSA-wrapped AES IV (hex string).
    pub const FIELD_RSAIV: &str = "rsaiv";
    pub const SESSION_COOKIE: &str = "JSESSIONID";
    /// Marker in a redirect `Location` / body that identifies this generation.
    pub const MARKER: &str = "servlet?m=mod_listener";
    /// Marker present in the login page body.
    pub const LOGIN_FORM_MARKER: &str = "loginForm";
    /// Marker in a redirect `Location` that means "back to the login page".
    pub const LOGIN_FORM_QUERY_MARKER: &str = "q=loginForm";
    /// DOM id of the login page's username field — also the tell that a
    /// response is the login page again rather than the post-login area.
    pub const USERNAME_ID_MARKER: &str = "idUsername";
    /// Marker of the post-login area.
    pub const DATA_MARKER: &str = "mod_data";

    /// Default public exponent when the page does not carry `g_rsa_e` (0x10001).
    pub const RSA_EXPONENT_HEX: &str = "10001";
    /// Regexes that locate the RSA modulus (hex) in the login page. The first
    /// entry is the attested T21P E2 shape (`var g_rsa_n="…"`, per session);
    /// the rest are the older shapes this table carried before and are kept as
    /// alternates so one page grammar change cannot silently disable the
    /// encryption.
    pub const RSA_N_PATTERNS: &[&str] = &[
        r#"g_rsa_n\s*=\s*['"]([0-9a-fA-F]{64,})['"]"#,
        r#"rsakey\s*=\s*['"]([0-9a-fA-F]{64,})['"]"#,
        r#"RSA\.setPublic\(\s*['"]([0-9a-fA-F]{64,})['"]"#,
        r#"setPublic\(\s*['"]([0-9a-fA-F]{64,})['"]"#,
    ];
    /// Regexes that locate the RSA public exponent (hex) in the login page.
    /// The `setPublic` alternate takes the modulus argument as-is, because the
    /// pages pass it as a variable (`rsa.setPublic(g_rsa_n, "10001")`) as
    /// often as they inline it.
    pub const RSA_E_PATTERNS: &[&str] = &[
        r#"g_rsa_e\s*=\s*['"]([0-9a-fA-F]{1,16})['"]"#,
        r#"setPublic\(\s*[^,()]{1,80},\s*['"]([0-9a-fA-F]{1,16})['"]"#,
    ];
    /// Model and firmware are readable *before* authenticating. Non-secret:
    /// these two may be logged, nothing else from the login page may.
    pub const PHONETYPE_PATTERN: &str = r#"g_phonetype\s*=\s*['"]([^'"]{1,64})['"]"#;
    pub const FIRMWARE_PATTERN: &str = r#"g_strFirmware\s*=\s*['"]([^'"]{1,64})['"]"#;
    /// The phone's JS submits the RSA ciphertext base64-encoded (`hex2b64`).
    /// Flip to `false` if a real phone turns out to want raw hex.
    pub const RSA_CIPHERTEXT_IS_BASE64: bool = true;

    /// Login answer: `<div id="_RES_INFO_">{"authstatus":"done"}</div>`.
    pub const AUTHSTATUS_PATTERN: &str = r#"(?i)"authstatus"\s*:\s*"([a-z]+)""#;
    /// Signed in.
    pub const AUTHSTATUS_DONE: &str = "done";
    /// Username or password rejected. Terminal — never retry.
    pub const AUTHSTATUS_NONE: &str = "none";
    /// Account locked out after repeated failures. Terminal — never retry.
    pub const AUTHSTATUS_LOCK: &str = "lock";

    /// Embedded-browser auto-login selectors. The first alternate in each is
    /// the attested T21P E2 markup; the second is the older markup this table
    /// carried before. `findInRoot` requires exactly one visible match per
    /// role, so listing both is safe and covers both generations.
    ///
    /// These strings are mirrored by the `voip-phone` HTTP application profile
    /// (`src/utils/connection/httpApplicationProfiles.ts`) — keep them equal.
    pub const SEL_USERNAME: &str = r#"#idUsername, input[name="username"]"#;
    pub const SEL_PASSWORD: &str = r#"#idPassword, input[name="pwd"][type="password"]"#;
    /// The real confirm control is an `<a>` that calls the page's own JS, not
    /// a native submit input.
    pub const SEL_SUBMIT: &str = r#"#idConfirm, input[type="submit"][name="login"]"#;
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

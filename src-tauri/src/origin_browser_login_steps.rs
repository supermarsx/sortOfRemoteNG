//! Native re-validation of declarative login steps (t102 contract L1) for the
//! credential authority. It mirrors `src/utils/connection/httpLoginSteps.ts`
//! (`validateHttpLoginSteps`, `validateUserHttpLoginSteps`, `resolvePlan`)
//! and `httpCustomLogin.ts` for everything the authority relies on: the
//! origins, the per-origin order of the stages and each step's path and frame
//! scope. Input is the reviewed bundled catalog or the saved row, never the
//! page or the browser host. Anything unknown or out of bounds rejects the
//! whole plan; a rejected plan is never used in part.
use serde_json::{json, Map, Value};
use url::Url;

const MAX_STEPS: usize = 16;
const MAX_ORIGINS: usize = 8;
const MAX_PATHS: usize = 16;
/// UTF-16 units, as the native and legacy clients count them.
const SELECTOR_LENGTH: usize = 512;
const ORIGIN_LENGTH: usize = 512;
const PATH_LENGTH: usize = 512;
const FRAME_LENGTH: usize = 128;
/// `HTTP_LOGIN_NON_PUBLIC_SUFFIXES`: no listed origin may end in one of these.
const NON_PUBLIC_SUFFIXES: [&str; 16] = [
    "localhost",
    "local",
    "test",
    "invalid",
    "example",
    "onion",
    "alt",
    "internal",
    "arpa",
    "localdomain",
    "lan",
    "home",
    "corp",
    "mail",
    "intranet",
    "private",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Click,
    Identifier,
    Password,
    Form,
    Submit,
}

impl Kind {
    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "click" => Self::Click,
            "identifier" => Self::Identifier,
            "password" => Self::Password,
            "form" => Self::Form,
            "submit" => Self::Submit,
            _ => return None,
        })
    }

    fn credential(self) -> bool {
        matches!(self, Self::Identifier | Self::Password | Self::Form)
    }
}

/// One step with nothing left implicit (`ResolvedHttpLoginStep`).
#[derive(Debug, Clone, PartialEq, Eq)]
struct Step {
    kind: Kind,
    origin: String,
    paths: Vec<String>,
    prefixes: Vec<String>,
    frame: Option<String>,
    /// `submit` steps only: the kind of the credential step it submits.
    submits: Option<Kind>,
}

impl Step {
    /// `httpLoginStepMatchesPath` plus the frame. `path` and `frame` are what
    /// the host reports for the requesting document at the moment of the
    /// request. Without a reported path only an ungated step applies.
    fn in_scope(&self, path: Option<&str>, frame: Option<&str>) -> bool {
        if self.frame.as_deref() != frame {
            return false;
        }
        if self.paths.is_empty() && self.prefixes.is_empty() {
            return true;
        }
        let Some(path) = path.filter(|path| path.starts_with('/')) else {
            return false;
        };
        self.paths.iter().any(|exact| exact == path)
            || self
                .prefixes
                .iter()
                .any(|prefix| prefix.ends_with('/') && path.starts_with(prefix.as_str()))
    }
}

/// A validated plan for one saved connection. Holds no credential.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct LoginStepsPlan {
    connection_origin: String,
    password_only: bool,
    /// The file's own list, re-validated; sent to the host as is.
    listed_origins: Vec<String>,
    /// Username and password go only here: exactly the origins of the steps.
    credential_origins: Vec<String>,
    steps: Vec<Step>,
    /// The steps as written (catalog file or the custom builder), re-validated.
    raw_steps: Value,
}

impl LoginStepsPlan {
    pub(super) fn password_only(&self) -> bool {
        self.password_only
    }

    pub(super) fn credential_origins(&self) -> &[String] {
        &self.credential_origins
    }

    /// The host's setup contract (t102-e9): selectors and scopes only.
    pub(super) fn configuration(&self) -> Value {
        json!({
            "connectionOrigin": self.connection_origin,
            "passwordOnly": self.password_only,
            "credentialOrigins": self.listed_origins,
            "loginSteps": self.raw_steps,
        })
    }

    /// Whether the steps let `stage` (the host's wire name) run on this exact
    /// origin, at this live path and in this frame. `form-prepare` carries no
    /// credential and belongs to any step of the origin; every other stage
    /// needs the step of its own kind (identifier, password, form) or the
    /// submit that follows it. `bound-password` and unknown stages never.
    pub(super) fn permits(
        &self,
        origin: &str,
        stage: &str,
        path: Option<&str>,
        frame: Option<&str>,
    ) -> bool {
        let wanted: (Kind, Option<Kind>) = match stage {
            "form-prepare" => {
                return self
                    .steps
                    .iter()
                    .any(|step| step.origin == origin && step.in_scope(path, frame));
            }
            "identifier" => (Kind::Identifier, None),
            "password" => (Kind::Password, None),
            "form" => (Kind::Form, None),
            "id-submit" => (Kind::Submit, Some(Kind::Identifier)),
            "pw-submit" => (Kind::Submit, Some(Kind::Password)),
            "form-submit" => (Kind::Submit, Some(Kind::Form)),
            _ => return false,
        };
        self.credential_origins
            .iter()
            .any(|listed| listed == origin)
            && self.steps.iter().any(|step| {
                (step.kind, step.submits) == wanted
                    && step.origin == origin
                    && step.in_scope(path, frame)
            })
    }
}

/// One step as read, before origins are made concrete.
struct RawStep {
    kind: Kind,
    origin: Option<String>,
    paths: Vec<String>,
    prefixes: Vec<String>,
    frame: Option<String>,
}

fn has_control(value: &str) -> bool {
    value
        .chars()
        .any(|c| (c as u32) < 32 || (127..=159).contains(&(c as u32)))
}

/// Selector-shaped text: bounded, printable, no surrounding spaces.
fn bounded_text(value: &Value, limit: usize) -> bool {
    value.as_str().is_some_and(|text| {
        !text.is_empty()
            && text.encode_utf16().count() <= limit
            && !has_control(text)
            && !text.starts_with(' ')
            && !text.ends_with(' ')
    })
}

fn dns_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    (1..=63).contains(&bytes.len())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
        && bytes[0] != b'-'
        && bytes[bytes.len() - 1] != b'-'
}

/// An exact HTTPS origin of a public DNS name (`originIssue`).
fn listed_origin(value: &Value) -> Option<String> {
    let value = value.as_str()?;
    if value.len() > ORIGIN_LENGTH {
        return None;
    }
    let authority = value.strip_prefix("https://")?;
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    let labels: Vec<&str> = host.split('.').collect();
    let last = labels.last()?;
    if NON_PUBLIC_SUFFIXES.contains(&last.to_ascii_lowercase().as_str())
        || host.len() > 253
        || labels.len() < 2
        || !labels.iter().all(|label| dns_label(label))
        || !last.starts_with(|c: char| c.is_ascii_lowercase())
    {
        return None;
    }
    if let Some(port) = port {
        if port.is_empty()
            || port.len() > 5
            || port.starts_with('0')
            || !port.bytes().all(|b| b.is_ascii_digit())
            || port.parse::<u32>().ok()? > 65_535
        {
            return None;
        }
    }
    // Exact, already-canonical origins only: this also refuses `:443`.
    (Url::parse(value).ok()?.origin().ascii_serialization() == value).then(|| value.to_owned())
}

/// Pathname only: no query, fragment, encoding, empty or dot segment.
fn safe_path(value: &str) -> bool {
    if value.len() > PATH_LENGTH || !value.starts_with('/') {
        return false;
    }
    let segments: Vec<&str> = value[1..].split('/').collect();
    let last = segments.len() - 1;
    segments.iter().enumerate().all(|(index, segment)| {
        if segment.is_empty() {
            index == last
        } else {
            segment
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._~-".contains(&b))
                && *segment != "."
                && *segment != ".."
        }
    })
}

fn safe_prefix(value: &str) -> bool {
    safe_path(value) && value.len() > 1 && value.ends_with('/')
}

/// A bounded list of unique strings, each accepted by `entry`.
fn strings(
    value: &Value,
    min: usize,
    max: usize,
    entry: impl Fn(&Value) -> Option<String>,
) -> Option<Vec<String>> {
    let list = value
        .as_array()
        .filter(|list| (min..=max).contains(&list.len()))?;
    let mut out: Vec<String> = Vec::with_capacity(list.len());
    for item in list {
        let item = entry(item)?;
        if out.contains(&item) {
            return None;
        }
        out.push(item);
    }
    Some(out)
}

fn only_keys(record: &Map<String, Value>, allowed: &[&str]) -> bool {
    record.keys().all(|key| allowed.contains(&key.as_str()))
}

fn read_step(value: &Value, password_only: bool) -> Option<RawStep> {
    let record = value.as_object()?;
    let kind = Kind::parse(record.get("kind")?.as_str()?)?;
    if password_only && matches!(kind, Kind::Identifier | Kind::Form) {
        return None;
    }
    let mut step = RawStep {
        kind,
        origin: None,
        paths: Vec::new(),
        prefixes: Vec::new(),
        frame: None,
    };
    let selector_keys: &[&str] = match kind {
        Kind::Click => &["control"],
        Kind::Identifier => &["username"],
        Kind::Password => &["password"],
        Kind::Form => &["username", "password"],
        Kind::Submit => match record.get("submission")?.as_str()? {
            // Enter is pressed in the field just typed: it names no control.
            "enter" => &[],
            "click" | "spa" => &["control"],
            _ => return None,
        },
    };
    if kind == Kind::Submit {
        // A submit runs in its credential step's document: no scope of its own.
        let allowed: &[&str] = if selector_keys.is_empty() {
            &["kind", "submission", "waitFor"]
        } else {
            &["kind", "submission", "waitFor", "selectors"]
        };
        if !only_keys(record, allowed) {
            return None;
        }
    } else {
        if !only_keys(
            record,
            &[
                "kind",
                "origin",
                "paths",
                "pathPrefixes",
                "frame",
                "waitFor",
                "selectors",
            ],
        ) {
            return None;
        }
        if let Some(origin) = record.get("origin") {
            step.origin = Some(listed_origin(origin)?);
        }
        if let Some(paths) = record.get("paths") {
            step.paths = strings(paths, 1, MAX_PATHS, |entry| {
                entry
                    .as_str()
                    .filter(|path| safe_path(path))
                    .map(str::to_owned)
            })?;
        }
        if let Some(prefixes) = record.get("pathPrefixes") {
            step.prefixes = strings(prefixes, 1, MAX_PATHS, |entry| {
                entry
                    .as_str()
                    .filter(|path| safe_prefix(path))
                    .map(str::to_owned)
            })?;
        }
        if let Some(frame) = record.get("frame") {
            let frame = frame.as_str().filter(|frame| {
                (1..=FRAME_LENGTH).contains(&frame.len())
                    && frame
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            })?;
            step.frame = Some(frame.to_owned());
        }
    }
    if let Some(wait_for) = record.get("waitFor") {
        if !bounded_text(wait_for, SELECTOR_LENGTH) {
            return None;
        }
    }
    if selector_keys.is_empty() {
        if record.contains_key("selectors") {
            return None;
        }
    } else {
        let selectors = record.get("selectors")?.as_object()?;
        if selectors.len() != selector_keys.len()
            || !selector_keys.iter().all(|key| {
                selectors
                    .get(*key)
                    .is_some_and(|value| bounded_text(value, SELECTOR_LENGTH))
            })
        {
            return None;
        }
    }
    Some(step)
}

/// `checkSequence`: the order rules per exact origin.
fn sequence_valid(steps: &[(Kind, &str)], password_only: bool) -> bool {
    if !steps.iter().any(|(kind, _)| kind.credential()) {
        return false;
    }
    let mut typed: Vec<(&str, &str)> = Vec::new();
    let mut submitted: Vec<(&str, &str)> = Vec::new();
    let mut username_seen = false;
    let mut credential: Option<usize> = None;
    for (index, (kind, origin)) in steps.iter().enumerate() {
        match kind {
            kind if kind.credential() => {
                let fields: &[&str] = match kind {
                    Kind::Form => &["username", "password"],
                    Kind::Identifier => &["username"],
                    _ => &["password"],
                };
                if fields
                    .iter()
                    .any(|field| typed.contains(&(*field, *origin)))
                {
                    return false;
                }
                typed.extend(fields.iter().map(|field| (*field, *origin)));
                if *kind == Kind::Password && !username_seen && !password_only {
                    return false;
                }
                if *kind != Kind::Password {
                    username_seen = true;
                }
                credential = Some(index);
            }
            Kind::Click => {
                // A pre-step only: never post-login automation.
                if !steps[index + 1..]
                    .iter()
                    .any(|(later, later_origin)| later.credential() && later_origin == origin)
                {
                    return false;
                }
            }
            _ => {
                let Some(target) = credential else {
                    return false;
                };
                let (target_kind, target_origin) = steps[target];
                let stage = if target_kind == Kind::Identifier {
                    "identifier"
                } else {
                    "password"
                };
                if submitted.contains(&(stage, target_origin)) || target + 1 != index {
                    return false;
                }
                submitted.push((stage, target_origin));
            }
        }
    }
    true
}

/// `isConnectionOrigin` plus the transport rule: an HTTP connection origin
/// only when the saved row itself is HTTP (`http_allowed`).
fn connection_origin(value: &str, http_allowed: bool) -> Option<String> {
    let url = Url::parse(value).ok()?;
    let exact = matches!(url.scheme(), "http" | "https")
        && value.len() <= 2048
        && url.origin().ascii_serialization() == value;
    (exact && (url.scheme() == "https" || http_allowed)).then(|| value.to_owned())
}

fn plan(
    listed: Vec<String>,
    password_only: bool,
    raw_steps: &Value,
    connection: &str,
    http_allowed: bool,
) -> Option<LoginStepsPlan> {
    let connection = connection_origin(connection, http_allowed)?;
    let list = raw_steps
        .as_array()
        .filter(|list| (1..=MAX_STEPS).contains(&list.len()))?;
    let read: Vec<RawStep> = list
        .iter()
        .map(|step| read_step(step, password_only))
        .collect::<Option<_>>()?;
    // `checkPlan`: only listed origins, and every listed origin is used.
    let mut used: Vec<&str> = Vec::new();
    for step in &read {
        if let Some(origin) = &step.origin {
            if !listed.contains(origin) {
                return None;
            }
            used.push(origin.as_str());
        }
    }
    if listed.iter().any(|origin| !used.contains(&origin.as_str())) {
        return None;
    }
    let unnamed: Vec<(Kind, &str)> = read
        .iter()
        .map(|step| {
            let origin = if step.kind == Kind::Submit {
                ""
            } else {
                step.origin.as_deref().unwrap_or("")
            };
            (step.kind, origin)
        })
        .collect();
    if !sequence_valid(&unnamed, password_only) {
        return None;
    }
    // `resolvePlan`: concrete origins; submits take their target's scope.
    let mut steps: Vec<Step> = Vec::with_capacity(read.len());
    let mut target: Option<Step> = None;
    for raw in read {
        let step = if raw.kind == Kind::Submit {
            let target = target.as_ref()?;
            Step {
                kind: Kind::Submit,
                submits: Some(target.kind),
                ..target.clone()
            }
        } else {
            let step = Step {
                kind: raw.kind,
                origin: raw.origin.unwrap_or_else(|| connection.clone()),
                paths: raw.paths,
                prefixes: raw.prefixes,
                frame: raw.frame,
                submits: None,
            };
            if step.kind.credential() {
                target = Some(step.clone());
            }
            step
        };
        steps.push(step);
    }
    // Re-checked with the real origin: a listed origin may be the connection's.
    let concrete: Vec<(Kind, &str)> = steps
        .iter()
        .map(|step| (step.kind, step.origin.as_str()))
        .collect();
    if !sequence_valid(&concrete, password_only) {
        return None;
    }
    let credential_origins = std::iter::once(&connection)
        .chain(listed.iter())
        .filter(|origin| steps.iter().any(|step| &step.origin == *origin))
        .fold(Vec::new(), |mut out: Vec<String>, origin| {
            if !out.contains(origin) {
                out.push(origin.clone());
            }
            out
        });
    Some(LoginStepsPlan {
        connection_origin: connection,
        password_only,
        listed_origins: listed,
        credential_origins,
        steps,
        raw_steps: raw_steps.clone(),
    })
}

/// A reviewed catalog entry's `declarativeLogin` (`mode`, `credentialOrigins`,
/// `passwordOnly`, `loginSteps`, as `scripts/generate-native-login-catalog.mjs`
/// emits it) resolved for the saved connection origin. Returns the mode too.
pub(super) fn from_catalog(
    declarative: &Value,
    connection: &str,
    http_allowed: bool,
) -> Option<(LoginStepsPlan, &'static str)> {
    let record = declarative.as_object()?;
    if !only_keys(
        record,
        &["mode", "credentialOrigins", "passwordOnly", "loginSteps"],
    ) {
        return None;
    }
    let mode = match record.get("mode")?.as_str()? {
        "exclusive" => "exclusive",
        "additive" => "additive",
        _ => return None,
    };
    let listed = strings(
        record.get("credentialOrigins")?,
        0,
        MAX_ORIGINS,
        listed_origin,
    )?;
    let password_only = record.get("passwordOnly")?.as_bool()?;
    plan(
        listed,
        password_only,
        record.get("loginSteps")?,
        connection,
        http_allowed,
    )
    .map(|plan| (plan, mode))
}

/// The Custom application's selectors and `customLogin` options as steps
/// (`normalizeHttpCustomLoginOptions` + `buildHttpCustomLoginSteps` +
/// `validateUserHttpLoginSteps`). `Ok(None)`: no option is set, so the row is
/// an ordinary custom form. A step can never name an origin here.
pub(super) fn from_custom(
    selectors: Option<&Value>,
    options: &Value,
    connection: &str,
    http_allowed: bool,
) -> Result<Option<LoginStepsPlan>, ()> {
    let options = options.as_object().ok_or(())?;
    if !only_keys(
        options,
        &["frame", "passwordOnly", "preStepSelector", "submission"],
    ) {
        return Err(());
    }
    let frame = match options.get("frame") {
        None => None,
        Some(frame) => Some(frame.as_str().ok_or(())?.to_owned()),
    };
    let password_only = match options.get("passwordOnly") {
        None => false,
        Some(value) => value.as_bool().ok_or(())?,
    };
    let pre_step = match options.get("preStepSelector") {
        None => None,
        Some(value) => Some(
            value
                .as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .ok_or(())?
                .to_owned(),
        ),
    };
    let submission = match options.get("submission") {
        None => "click",
        Some(value) => match value.as_str().ok_or(())? {
            submission @ ("click" | "enter" | "spa") => submission,
            _ => return Err(()),
        },
    };
    if frame.is_none() && !password_only && pre_step.is_none() && submission == "click" {
        return Ok(None);
    }
    let selectors = match selectors {
        None | Some(Value::Null) => Map::new(),
        Some(value) => value.as_object().cloned().ok_or(())?,
    };
    let selector = |key: &str| -> Result<Value, ()> {
        match selectors.get(key) {
            None | Some(Value::Null) => Ok(Value::Null),
            Some(value) => Ok(Value::String(value.as_str().ok_or(())?.trim().to_owned())),
        }
    };
    let scoped = |mut step: Value| {
        if let Some(frame) = &frame {
            step["frame"] = frame.clone().into();
        }
        step
    };
    let mut steps = Vec::new();
    if let Some(control) = pre_step {
        steps.push(scoped(
            json!({"kind":"click","selectors":{"control":control}}),
        ));
    }
    steps.push(scoped(if password_only {
        json!({"kind":"password","selectors":{"password":selector("passwordSelector")?}})
    } else {
        json!({"kind":"form","selectors":{
            "username":selector("usernameSelector")?,
            "password":selector("passwordSelector")?,
        }})
    }));
    steps.push(if submission == "enter" {
        json!({"kind":"submit","submission":"enter"})
    } else {
        json!({"kind":"submit","submission":submission,
            "selectors":{"control":selector("submitSelector")?}})
    });
    plan(
        Vec::new(),
        password_only,
        &Value::Array(steps),
        connection,
        http_allowed,
    )
    .map(Some)
    .ok_or(())
}

#[cfg(test)]
#[path = "origin_browser_login_steps_tests.rs"]
mod tests;

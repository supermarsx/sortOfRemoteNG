//! Semantic version parsing, comparison, and ordering.

use std::cmp::Ordering;
use std::fmt;

use crate::error::UpdateError;

/// A parsed semantic version (major.minor.patch[-pre_release][+build_metadata]).
#[derive(Debug, Clone, Eq)]
pub struct SemVer {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub pre_release: Option<String>,
    pub build_metadata: Option<String>,
}

impl SemVer {
    /// Create a new `SemVer`.
    pub fn new(major: u64, minor: u64, patch: u64) -> Self {
        Self {
            major,
            minor,
            patch,
            pre_release: None,
            build_metadata: None,
        }
    }

    /// Create with pre-release label.
    pub fn with_pre_release(mut self, pre: impl Into<String>) -> Self {
        self.pre_release = Some(pre.into());
        self
    }

    /// Create with build metadata.
    pub fn with_build_metadata(mut self, meta: impl Into<String>) -> Self {
        self.build_metadata = Some(meta.into());
        self
    }
}

impl fmt::Display for SemVer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)?;
        if let Some(ref pre) = self.pre_release {
            write!(f, "-{pre}")?;
        }
        if let Some(ref meta) = self.build_metadata {
            write!(f, "+{meta}")?;
        }
        Ok(())
    }
}

// ─── Parsing ────────────────────────────────────────────────────────

/// Parse a version string such as `"1.2.3"`, `"1.2.3-beta.1"`, or
/// `"1.2.3+build.42"` into a [`SemVer`].
///
/// A leading `v` or `V` prefix is stripped automatically.
pub fn parse(s: &str) -> Result<SemVer, UpdateError> {
    let s = s.strip_prefix('v').unwrap_or(s);
    let s = s.strip_prefix('V').unwrap_or(s);

    // Split off build metadata first (everything after `+`).
    let (version_and_pre, build_metadata) = match s.split_once('+') {
        Some((vp, bm)) => (vp, Some(bm.to_string())),
        None => (s, None),
    };

    // Split off pre-release (everything after first `-` that follows the patch).
    let (version_core, pre_release) = match version_and_pre.split_once('-') {
        Some((core, pre)) => (core, Some(pre.to_string())),
        None => (version_and_pre, None),
    };

    let parts: Vec<&str> = version_core.split('.').collect();
    if parts.len() != 3 {
        return Err(UpdateError::VersionParseError(format!(
            "expected 3 numeric components, got {} in \"{s}\"",
            parts.len()
        )));
    }

    let major = parts[0].parse::<u64>().map_err(|e| {
        UpdateError::VersionParseError(format!("invalid major version \"{}\": {e}", parts[0]))
    })?;
    let minor = parts[1].parse::<u64>().map_err(|e| {
        UpdateError::VersionParseError(format!("invalid minor version \"{}\": {e}", parts[1]))
    })?;
    let patch = parts[2].parse::<u64>().map_err(|e| {
        UpdateError::VersionParseError(format!("invalid patch version \"{}\": {e}", parts[2]))
    })?;

    Ok(SemVer {
        major,
        minor,
        patch,
        pre_release,
        build_metadata,
    })
}

// ─── Ordering helpers ───────────────────────────────────────────────

/// Compare two pre-release strings according to SemVer 2.0 rules.
///
/// Each dot-separated identifier is compared: numeric identifiers are
/// compared as integers; alphanumeric identifiers are compared
/// lexically. Numeric identifiers always have lower precedence than
/// alphanumeric identifiers. A version with a pre-release field has
/// *lower* precedence than the same version without one.
fn compare_pre_release(a: &Option<String>, b: &Option<String>) -> Ordering {
    match (a, b) {
        // No pre-release on either → equal.
        (None, None) => Ordering::Equal,
        // Pre-release < release.
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (Some(a), Some(b)) => {
            let a_ids: Vec<&str> = a.split('.').collect();
            let b_ids: Vec<&str> = b.split('.').collect();
            for (ai, bi) in a_ids.iter().zip(b_ids.iter()) {
                let a_num = ai.parse::<u64>();
                let b_num = bi.parse::<u64>();
                let ord = match (a_num, b_num) {
                    (Ok(an), Ok(bn)) => an.cmp(&bn),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    (Err(_), Err(_)) => ai.cmp(bi),
                };
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            a_ids.len().cmp(&b_ids.len())
        }
    }
}

/// Compare two [`SemVer`] values.
///
/// Build metadata is **not** considered in the comparison per the
/// SemVer 2.0 specification.
pub fn compare(a: &SemVer, b: &SemVer) -> Ordering {
    a.major
        .cmp(&b.major)
        .then_with(|| a.minor.cmp(&b.minor))
        .then_with(|| a.patch.cmp(&b.patch))
        .then_with(|| compare_pre_release(&a.pre_release, &b.pre_release))
}

impl PartialEq for SemVer {
    fn eq(&self, other: &Self) -> bool {
        compare(self, other) == Ordering::Equal
    }
}

impl PartialOrd for SemVer {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SemVer {
    fn cmp(&self, other: &Self) -> Ordering {
        compare(self, other)
    }
}

// ─── Convenience helpers ────────────────────────────────────────────

/// Returns `true` if `current` satisfies the minimum
/// version requirement `required_min` (i.e. `current >= required_min`).
pub fn is_compatible(current: &SemVer, required_min: &SemVer) -> bool {
    current >= required_min
}

/// Returns `true` if `candidate` is strictly newer than `current`.
pub fn is_newer(candidate: &SemVer, current: &SemVer) -> bool {
    candidate > current
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse ────────────────────────────────────────────────────

    #[test]
    fn parse_simple() {
        let v = parse("1.2.3").unwrap();
        assert_eq!(v.major, 1);
        assert_eq!(v.minor, 2);
        assert_eq!(v.patch, 3);
        assert!(v.pre_release.is_none());
        assert!(v.build_metadata.is_none());
    }

    #[test]
    fn parse_with_v_prefix() {
        let v = parse("v2.0.0").unwrap();
        assert_eq!(v.major, 2);
        assert_eq!(v.minor, 0);
        assert_eq!(v.patch, 0);
    }

    #[test]
    fn parse_pre_release() {
        let v = parse("1.0.0-beta.1").unwrap();
        assert_eq!(v.pre_release.as_deref(), Some("beta.1"));
    }

    #[test]
    fn parse_build_metadata() {
        let v = parse("1.0.0+build.42").unwrap();
        assert_eq!(v.build_metadata.as_deref(), Some("build.42"));
    }

    #[test]
    fn parse_pre_release_and_build() {
        let v = parse("1.2.3-alpha.2+sha.abc").unwrap();
        assert_eq!(v.pre_release.as_deref(), Some("alpha.2"));
        assert_eq!(v.build_metadata.as_deref(), Some("sha.abc"));
    }

    #[test]
    fn parse_invalid_too_few_parts() {
        assert!(parse("1.2").is_err());
    }

    #[test]
    fn parse_invalid_non_numeric() {
        assert!(parse("a.b.c").is_err());
    }

    #[test]
    fn parse_zeros() {
        let v = parse("0.0.0").unwrap();
        assert_eq!(v.major, 0);
        assert_eq!(v.minor, 0);
        assert_eq!(v.patch, 0);
    }

    #[test]
    fn parse_large_numbers() {
        let v = parse("999.888.777").unwrap();
        assert_eq!(v.major, 999);
        assert_eq!(v.minor, 888);
        assert_eq!(v.patch, 777);
    }

    // ── ordering / comparison ───────────────────────────────────

    #[test]
    fn compare_major() {
        let a = parse("2.0.0").unwrap();
        let b = parse("1.0.0").unwrap();
        assert!(a > b);
    }

    #[test]
    fn compare_minor() {
        let a = parse("1.3.0").unwrap();
        let b = parse("1.2.0").unwrap();
        assert!(a > b);
    }

    #[test]
    fn compare_patch() {
        let a = parse("1.0.2").unwrap();
        let b = parse("1.0.1").unwrap();
        assert!(a > b);
    }

    #[test]
    fn compare_equal() {
        let a = parse("1.0.0").unwrap();
        let b = parse("1.0.0").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn pre_release_lower_than_release() {
        let pre = parse("1.0.0-alpha").unwrap();
        let rel = parse("1.0.0").unwrap();
        assert!(pre < rel);
    }

    #[test]
    fn pre_release_ordering() {
        let alpha = parse("1.0.0-alpha").unwrap();
        let beta = parse("1.0.0-beta").unwrap();
        assert!(alpha < beta);
    }

    #[test]
    fn pre_release_numeric_ordering() {
        let b1 = parse("1.0.0-beta.1").unwrap();
        let b2 = parse("1.0.0-beta.2").unwrap();
        assert!(b1 < b2);
    }

    #[test]
    fn pre_release_numeric_before_alpha() {
        // Numeric identifiers have lower precedence than alphanumeric.
        let num = parse("1.0.0-1").unwrap();
        let alpha = parse("1.0.0-alpha").unwrap();
        assert!(num < alpha);
    }

    #[test]
    fn build_metadata_ignored_in_comparison() {
        let a = parse("1.0.0+build.1").unwrap();
        let b = parse("1.0.0+build.2").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn pre_release_more_fields_greater() {
        let short = parse("1.0.0-alpha").unwrap();
        let long = parse("1.0.0-alpha.1").unwrap();
        assert!(long > short);
    }

    // ── is_compatible / is_newer ────────────────────────────────

    #[test]
    fn compatible_when_equal() {
        let v = parse("1.0.0").unwrap();
        assert!(is_compatible(&v, &v));
    }

    #[test]
    fn compatible_when_newer() {
        let current = parse("2.0.0").unwrap();
        let min = parse("1.0.0").unwrap();
        assert!(is_compatible(&current, &min));
    }

    #[test]
    fn not_compatible_when_older() {
        let current = parse("0.9.0").unwrap();
        let min = parse("1.0.0").unwrap();
        assert!(!is_compatible(&current, &min));
    }

    #[test]
    fn newer_true() {
        let candidate = parse("2.0.0").unwrap();
        let current = parse("1.0.0").unwrap();
        assert!(is_newer(&candidate, &current));
    }

    #[test]
    fn newer_false_when_equal() {
        let v = parse("1.0.0").unwrap();
        assert!(!is_newer(&v, &v));
    }

    #[test]
    fn newer_false_when_older() {
        let candidate = parse("0.9.0").unwrap();
        let current = parse("1.0.0").unwrap();
        assert!(!is_newer(&candidate, &current));
    }

    // ── Display round-trip ──────────────────────────────────────

    #[test]
    fn display_simple() {
        let v = parse("1.2.3").unwrap();
        assert_eq!(v.to_string(), "1.2.3");
    }

    #[test]
    fn display_full() {
        let v = parse("1.2.3-beta.1+sha.abc").unwrap();
        assert_eq!(v.to_string(), "1.2.3-beta.1+sha.abc");
    }

    // ── sorting a collection ────────────────────────────────────

    #[test]
    fn sort_versions() {
        let mut versions: Vec<SemVer> = vec![
            parse("2.0.0").unwrap(),
            parse("1.0.0-alpha").unwrap(),
            parse("1.0.0").unwrap(),
            parse("1.0.0-beta").unwrap(),
            parse("0.1.0").unwrap(),
        ];
        versions.sort();
        let strs: Vec<String> = versions.iter().map(|v| v.to_string()).collect();
        assert_eq!(
            strs,
            vec!["0.1.0", "1.0.0-alpha", "1.0.0-beta", "1.0.0", "2.0.0"]
        );
    }
}

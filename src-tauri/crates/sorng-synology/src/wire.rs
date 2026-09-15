//! Lenient decoders for DSM wire quirks: numbers sent as strings, CSV-or-array
//! values, grouped rows and JSON-encoded string parameters.
//!
//! Errors stay serde errors, so `ResponseFacts` still reports a closed
//! `json_schema` diagnostic. List envelopes (`{"users":[...],"total":5}` or a
//! bare array) are decoded by `SynoClient::api_list`.
//!
//! Managers decode a private `XxxWire` struct with DSM's field names and map it
//! into the IPC DTO in `types`; the DTO's camelCase `Serialize` is unchanged.

// The t84 decoder lanes adopt these helpers module by module; until every
// manager uses them, some are called only from tests.
#![cfg_attr(not(test), allow(dead_code))]

use crate::client::SynoClient;
use crate::types::DiskUtilization;
use serde::{de::Error as _, Deserialize, Deserializer};

#[derive(Deserialize)]
#[serde(untagged)]
enum Num {
    U(u64),
    I(i64),
    F(f64),
    S(String),
}

fn to_u64(number: Num) -> Result<u64, &'static str> {
    const EXPECTED: &str = "expected an unsigned number";
    match number {
        Num::U(value) => Ok(value),
        Num::F(value) if value.is_finite() && value >= 0.0 && value.fract() == 0.0 => {
            Ok(value as u64)
        }
        Num::S(text) => text.trim().parse().map_err(|_| EXPECTED),
        _ => Err(EXPECTED),
    }
}

/// `123` | `"123"` | `" 123 "` | `123.0` -> 123. Negative, fractional, null
/// and non-numeric values fail.
pub(crate) fn u64_lenient<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    to_u64(Num::deserialize(deserializer)?).map_err(D::Error::custom)
}

/// absent | `null` | `""` -> None; `123` | `"123"` -> Some(123).
/// Use with `#[serde(default, deserialize_with = "crate::wire::opt_u64_lenient")]`.
pub(crate) fn opt_u64_lenient<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u64>, D::Error> {
    match Option::<Num>::deserialize(deserializer)? {
        None => Ok(None),
        Some(Num::S(text)) if text.trim().is_empty() => Ok(None),
        Some(number) => to_u64(number).map(Some).map_err(D::Error::custom),
    }
}

/// Signed variant for Unix times: Download Station's `create_time` is
/// `"1341210005"` in the official guide and `1550089068` on devices.
/// absent | `null` | `""` -> None; fractions fail. Use with `default`.
pub(crate) fn opt_i64_lenient<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<i64>, D::Error> {
    match Option::<Num>::deserialize(deserializer)? {
        None => Ok(None),
        Some(Num::U(value)) => i64::try_from(value).map(Some).map_err(D::Error::custom),
        Some(Num::I(value)) => Ok(Some(value)),
        Some(Num::S(text)) if text.trim().is_empty() => Ok(None),
        Some(Num::S(text)) => text.trim().parse().map(Some).map_err(D::Error::custom),
        Some(Num::F(_)) => Err(D::Error::custom("expected an integer time")),
    }
}

fn number_text(number: Num) -> String {
    match number {
        Num::U(value) => value.to_string(),
        Num::I(value) => value.to_string(),
        Num::F(value) => value.to_string(),
        Num::S(text) => text,
    }
}

/// `3543` | `"3.8-3543"` -> String (Download Station `version`, Surveillance
/// `version.build`, recording ids). Null, booleans and containers fail.
pub(crate) fn string_or_number<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<String, D::Error> {
    Num::deserialize(deserializer).map(number_text)
}

/// absent | `null` -> None; a number or string -> Some(String).
/// Use with `#[serde(default, deserialize_with = "crate::wire::opt_string_or_number")]`.
pub(crate) fn opt_string_or_number<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<Num>::deserialize(deserializer).map(|number| number.map(number_text))
}

/// `"cifs,nfs,iso"` (File Station guide) | `["cifs","nfs","iso"]` (DSM 7) ->
/// Some(list); `""` -> Some(empty); absent | `null` -> None.
/// Use with `#[serde(default, deserialize_with = "crate::wire::opt_csv_or_list")]`.
pub(crate) fn opt_csv_or_list<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Vec<String>>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Values {
        List(Vec<String>),
        Csv(String),
    }
    Ok(
        Option::<Values>::deserialize(deserializer)?.map(|values| match values {
            Values::List(list) => list,
            Values::Csv(text) => text
                .split(',')
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(String::from)
                .collect(),
        }),
    )
}

/// Utilization disks: DSM groups them as `{"disk":[...],"total":{...}}`; a flat
/// array is accepted too. An object without `disk` fails, never an empty list.
pub(crate) fn disk_rows<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<DiskUtilization>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Rows {
        Grouped { disk: Vec<DiskUtilization> },
        Flat(Vec<DiskUtilization>),
    }
    Ok(match Rows::deserialize(deserializer)? {
        Rows::Grouped { disk } => disk,
        Rows::Flat(rows) => rows,
    })
}

/// `true` | `1` | `"yes"` | `"true"` -> true; `false` | `0` | `"no"` | `"false"`
/// -> false. Any other number, string, null or container fails.
pub(crate) fn bool_lenient<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Flag {
        Bool(bool),
        Number(u64),
        Text(String),
    }
    const EXPECTED: &str = "expected a boolean flag";
    match Flag::deserialize(deserializer)? {
        Flag::Bool(value) => Ok(value),
        Flag::Number(0) => Ok(false),
        Flag::Number(1) => Ok(true),
        Flag::Text(text) => match text.as_str() {
            "yes" | "true" => Ok(true),
            "no" | "false" => Ok(false),
            _ => Err(D::Error::custom(EXPECTED)),
        },
        Flag::Number(_) => Err(D::Error::custom(EXPECTED)),
    }
}

/// A string parameter for `api`, encoded the way the API declares: JSON-quoted
/// (`"all"` -> `"\"all\""`) when discovery reports `requestFormat: "JSON"`, the
/// raw value otherwise. Mirrors `SynoClient::file_call_typed`.
pub(crate) fn string_param(client: &SynoClient, api: &str, value: &str) -> String {
    let json_format = client
        .api_info
        .get(api)
        .and_then(|info| info.request_format.as_deref())
        == Some("JSON");
    if json_format {
        serde_json::Value::String(value.to_owned()).to_string()
    } else {
        value.to_owned()
    }
}

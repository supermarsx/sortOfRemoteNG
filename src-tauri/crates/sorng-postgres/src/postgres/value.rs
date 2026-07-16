//! Lossless, explicit conversion from SQLx PostgreSQL values to IPC JSON.

use crate::postgres::types::{PgError, PgErrorKind, RowMap};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use bigdecimal::BigDecimal;
use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat, Utc};
use serde_json::{json, Number, Value};
use sqlx::postgres::types::{Oid, PgInterval, PgMoney, PgTimeTz};
use sqlx::postgres::{PgRow, PgTypeInfo, PgValueRef};
use sqlx::{Column, Decode, Postgres, Row, TypeInfo, ValueRef};
use uuid::Uuid;

const MAX_SAFE_JSON_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
enum PgJsonKind {
    Bool,
    I8,
    I16,
    I32,
    I64,
    F32,
    F64,
    Numeric,
    String,
    Json,
    Uuid,
    Date,
    Time,
    Timestamp,
    Timestamptz,
    Bytes,
    Oid,
    Interval,
    Timetz,
    Money,
    Array(Box<PgJsonKind>),
}

fn unsupported_type_name(type_name: &str) -> PgError {
    PgError::new(
        PgErrorKind::QueryFailed,
        format!(
            "PostgreSQL result type {} is not supported by the JSON result contract; cast the column to text explicitly",
            type_name
        ),
    )
}

fn unsupported_type(type_info: &PgTypeInfo) -> PgError {
    unsupported_type_name(type_info.name())
}

fn classify_simple_name(type_name: &str) -> Option<PgJsonKind> {
    match type_name.to_ascii_lowercase().as_str() {
        "bool" => Some(PgJsonKind::Bool),
        "char" => Some(PgJsonKind::I8),
        "int2" => Some(PgJsonKind::I16),
        "int4" => Some(PgJsonKind::I32),
        "int8" => Some(PgJsonKind::I64),
        "float4" => Some(PgJsonKind::F32),
        "float8" => Some(PgJsonKind::F64),
        "numeric" => Some(PgJsonKind::Numeric),
        "text" | "name" | "bpchar" | "varchar" | "unknown" | "citext" => Some(PgJsonKind::String),
        "json" | "jsonb" => Some(PgJsonKind::Json),
        "uuid" => Some(PgJsonKind::Uuid),
        "date" => Some(PgJsonKind::Date),
        "time" => Some(PgJsonKind::Time),
        "timestamp" => Some(PgJsonKind::Timestamp),
        "timestamptz" => Some(PgJsonKind::Timestamptz),
        "bytea" => Some(PgJsonKind::Bytes),
        "oid" => Some(PgJsonKind::Oid),
        "interval" => Some(PgJsonKind::Interval),
        "timetz" => Some(PgJsonKind::Timetz),
        "money" => Some(PgJsonKind::Money),
        _ => None,
    }
}

fn classify_type(type_info: &PgTypeInfo) -> Result<PgJsonKind, PgError> {
    use sqlx::postgres::PgTypeKind;

    match type_info.kind() {
        PgTypeKind::Domain(base) => return classify_type(base),
        PgTypeKind::Enum(_) => return Ok(PgJsonKind::String),
        PgTypeKind::Array(element) => {
            return classify_type(element).map(|kind| PgJsonKind::Array(Box::new(kind)))
        }
        PgTypeKind::Composite(_) | PgTypeKind::Pseudo | PgTypeKind::Range(_) => {
            return Err(unsupported_type(type_info))
        }
        PgTypeKind::Simple => {}
    }

    classify_simple_name(type_info.name()).ok_or_else(|| unsupported_type(type_info))
}

fn decoding_error(column: &str, type_name: &str, error: impl std::fmt::Display) -> PgError {
    PgError::new(
        PgErrorKind::QueryFailed,
        format!("Unable to decode PostgreSQL column {column:?} ({type_name}): {error}"),
    )
}

fn decode<'row, T>(raw: PgValueRef<'row>, column: &str, type_name: &str) -> Result<T, PgError>
where
    T: Decode<'row, Postgres>,
{
    T::decode(raw).map_err(|error| decoding_error(column, type_name, error))
}

fn i64_json(value: i64) -> Value {
    if (-MAX_SAFE_JSON_INTEGER..=MAX_SAFE_JSON_INTEGER).contains(&value) {
        Value::Number(Number::from(value))
    } else {
        // Tauri's JSON bridge ends in a JavaScript Number. Preserve exact
        // BIGINT/MONEY/interval values outside IEEE-754's integer range.
        Value::String(value.to_string())
    }
}

fn f64_json(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(value.to_string()))
}

fn bytes_json(value: &[u8]) -> Value {
    json!({
        "$binary": BASE64_STANDARD.encode(value),
        "encoding": "base64",
    })
}

fn interval_json(value: PgInterval) -> Value {
    json!({
        "months": value.months,
        "days": value.days,
        "microseconds": i64_json(value.microseconds),
    })
}

fn timetz_json(value: PgTimeTz<NaiveTime, FixedOffset>) -> Value {
    Value::String(format!(
        "{}{}",
        value.time.format("%H:%M:%S%.f"),
        value.offset
    ))
}

fn money_json(value: PgMoney) -> Value {
    json!({
        "minorUnits": i64_json(value.0),
        "scale": "server-locale-dependent",
    })
}

fn optional_array_json<T>(values: Vec<Option<T>>, convert: impl Fn(T) -> Value) -> Value {
    Value::Array(
        values
            .into_iter()
            .map(|value| value.map(&convert).unwrap_or(Value::Null))
            .collect(),
    )
}

fn decode_array<'row>(
    raw: PgValueRef<'row>,
    element: PgJsonKind,
    column: &str,
    type_name: &str,
) -> Result<Value, PgError> {
    let value = match element {
        PgJsonKind::Bool => optional_array_json(
            decode::<Vec<Option<bool>>>(raw, column, type_name)?,
            Value::Bool,
        ),
        PgJsonKind::I8 => optional_array_json(
            decode::<Vec<Option<i8>>>(raw, column, type_name)?,
            |value| Value::Number(Number::from(value)),
        ),
        PgJsonKind::I16 => optional_array_json(
            decode::<Vec<Option<i16>>>(raw, column, type_name)?,
            |value| Value::Number(Number::from(value)),
        ),
        PgJsonKind::I32 => optional_array_json(
            decode::<Vec<Option<i32>>>(raw, column, type_name)?,
            |value| Value::Number(Number::from(value)),
        ),
        PgJsonKind::I64 => optional_array_json(
            decode::<Vec<Option<i64>>>(raw, column, type_name)?,
            i64_json,
        ),
        PgJsonKind::F32 => optional_array_json(
            decode::<Vec<Option<f32>>>(raw, column, type_name)?,
            |value| f64_json(value.into()),
        ),
        PgJsonKind::F64 => optional_array_json(
            decode::<Vec<Option<f64>>>(raw, column, type_name)?,
            f64_json,
        ),
        PgJsonKind::Numeric => optional_array_json(
            decode::<Vec<Option<BigDecimal>>>(raw, column, type_name)?,
            |value| Value::String(value.normalized().to_string()),
        ),
        PgJsonKind::String => optional_array_json(
            decode::<Vec<Option<String>>>(raw, column, type_name)?,
            Value::String,
        ),
        PgJsonKind::Json => optional_array_json(
            decode::<Vec<Option<Value>>>(raw, column, type_name)?,
            |value| value,
        ),
        PgJsonKind::Uuid => optional_array_json(
            decode::<Vec<Option<Uuid>>>(raw, column, type_name)?,
            |value| Value::String(value.to_string()),
        ),
        PgJsonKind::Date => optional_array_json(
            decode::<Vec<Option<NaiveDate>>>(raw, column, type_name)?,
            |value| Value::String(value.format("%Y-%m-%d").to_string()),
        ),
        PgJsonKind::Time => optional_array_json(
            decode::<Vec<Option<NaiveTime>>>(raw, column, type_name)?,
            |value| Value::String(value.format("%H:%M:%S%.f").to_string()),
        ),
        PgJsonKind::Timestamp => optional_array_json(
            decode::<Vec<Option<NaiveDateTime>>>(raw, column, type_name)?,
            |value| Value::String(value.format("%Y-%m-%dT%H:%M:%S%.f").to_string()),
        ),
        PgJsonKind::Timestamptz => optional_array_json(
            decode::<Vec<Option<DateTime<Utc>>>>(raw, column, type_name)?,
            |value| Value::String(value.to_rfc3339_opts(SecondsFormat::AutoSi, true)),
        ),
        PgJsonKind::Bytes => optional_array_json(
            decode::<Vec<Option<Vec<u8>>>>(raw, column, type_name)?,
            |value| bytes_json(&value),
        ),
        PgJsonKind::Oid => optional_array_json(
            decode::<Vec<Option<Oid>>>(raw, column, type_name)?,
            |value| Value::Number(Number::from(value.0)),
        ),
        PgJsonKind::Interval => optional_array_json(
            decode::<Vec<Option<PgInterval>>>(raw, column, type_name)?,
            interval_json,
        ),
        PgJsonKind::Timetz => optional_array_json(
            decode::<Vec<Option<PgTimeTz<NaiveTime, FixedOffset>>>>(
                raw, column, type_name,
            )?,
            timetz_json,
        ),
        PgJsonKind::Money => optional_array_json(
            decode::<Vec<Option<PgMoney>>>(raw, column, type_name)?,
            money_json,
        ),
        PgJsonKind::Array(_) => {
            return Err(PgError::new(
                PgErrorKind::QueryFailed,
                format!(
                    "PostgreSQL column {column:?} ({type_name}) is multidimensional; only one-dimensional arrays are supported"
                ),
            ))
        }
    };
    Ok(value)
}

fn decode_non_null<'row>(
    raw: PgValueRef<'row>,
    kind: PgJsonKind,
    column: &str,
    type_name: &str,
) -> Result<Value, PgError> {
    let value = match kind {
        PgJsonKind::Bool => Value::Bool(decode(raw, column, type_name)?),
        PgJsonKind::I8 => Value::Number(Number::from(decode::<i8>(raw, column, type_name)?)),
        PgJsonKind::I16 => Value::Number(Number::from(decode::<i16>(raw, column, type_name)?)),
        PgJsonKind::I32 => Value::Number(Number::from(decode::<i32>(raw, column, type_name)?)),
        PgJsonKind::I64 => i64_json(decode(raw, column, type_name)?),
        PgJsonKind::F32 => f64_json(f64::from(decode::<f32>(raw, column, type_name)?)),
        PgJsonKind::F64 => f64_json(decode(raw, column, type_name)?),
        PgJsonKind::Numeric => Value::String(
            decode::<BigDecimal>(raw, column, type_name)?
                .normalized()
                .to_string(),
        ),
        PgJsonKind::String => Value::String(decode::<String>(raw, column, type_name)?),
        PgJsonKind::Json => decode::<Value>(raw, column, type_name)?,
        PgJsonKind::Uuid => Value::String(decode::<Uuid>(raw, column, type_name)?.to_string()),
        PgJsonKind::Date => Value::String(
            decode::<NaiveDate>(raw, column, type_name)?
                .format("%Y-%m-%d")
                .to_string(),
        ),
        PgJsonKind::Time => Value::String(
            decode::<NaiveTime>(raw, column, type_name)?
                .format("%H:%M:%S%.f")
                .to_string(),
        ),
        PgJsonKind::Timestamp => Value::String(
            decode::<NaiveDateTime>(raw, column, type_name)?
                .format("%Y-%m-%dT%H:%M:%S%.f")
                .to_string(),
        ),
        PgJsonKind::Timestamptz => Value::String(
            decode::<DateTime<Utc>>(raw, column, type_name)?
                .to_rfc3339_opts(SecondsFormat::AutoSi, true),
        ),
        PgJsonKind::Bytes => bytes_json(&decode::<Vec<u8>>(raw, column, type_name)?),
        PgJsonKind::Oid => Value::Number(Number::from(decode::<Oid>(raw, column, type_name)?.0)),
        PgJsonKind::Interval => interval_json(decode(raw, column, type_name)?),
        PgJsonKind::Timetz => timetz_json(decode(raw, column, type_name)?),
        PgJsonKind::Money => money_json(decode(raw, column, type_name)?),
        PgJsonKind::Array(element) => return decode_array(raw, *element, column, type_name),
    };
    Ok(value)
}

/// Convert a SQLx row without conflating decode failures with SQL NULL.
pub(crate) fn row_to_map(row: &PgRow) -> Result<RowMap, PgError> {
    let mut map = RowMap::with_capacity(row.len());
    for (index, column) in row.columns().iter().enumerate() {
        let name = column.name();
        if map.contains_key(name) {
            return Err(PgError::new(
                PgErrorKind::QueryFailed,
                format!(
                    "PostgreSQL result contains duplicate column name {name:?}; alias duplicate columns uniquely"
                ),
            ));
        }
        let type_info = column.type_info();
        let type_name = type_info.name();
        let raw = row
            .try_get_raw(index)
            .map_err(|error| decoding_error(name, type_name, error))?;
        let value = if raw.is_null() {
            Value::Null
        } else {
            decode_non_null(raw, classify_type(type_info)?, name, type_name)?
        };
        map.insert(name.to_string(), value);
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_required_scalar_and_array_contracts() {
        let cases = [
            ("BOOL", PgJsonKind::Bool),
            ("CHAR", PgJsonKind::I8),
            ("INT2", PgJsonKind::I16),
            ("INT4", PgJsonKind::I32),
            ("INT8", PgJsonKind::I64),
            ("FLOAT4", PgJsonKind::F32),
            ("FLOAT8", PgJsonKind::F64),
            ("NUMERIC", PgJsonKind::Numeric),
            ("TEXT", PgJsonKind::String),
            ("VARCHAR", PgJsonKind::String),
            ("JSONB", PgJsonKind::Json),
            ("UUID", PgJsonKind::Uuid),
            ("DATE", PgJsonKind::Date),
            ("TIME", PgJsonKind::Time),
            ("TIMESTAMP", PgJsonKind::Timestamp),
            ("TIMESTAMPTZ", PgJsonKind::Timestamptz),
            ("BYTEA", PgJsonKind::Bytes),
        ];
        for (type_name, expected) in cases {
            assert_eq!(classify_simple_name(type_name), Some(expected));
        }
    }

    #[test]
    fn unsupported_types_fail_explicitly() {
        assert_eq!(classify_simple_name("JSONPATH"), None);
        let error = unsupported_type_name("JSONPATH");
        assert!(error.message.contains("JSONPATH"));
        assert!(error.message.contains("cast the column to text"));
    }

    #[test]
    fn preserves_large_integers_and_non_finite_floats() {
        assert_eq!(
            i64_json(MAX_SAFE_JSON_INTEGER),
            json!(MAX_SAFE_JSON_INTEGER)
        );
        assert_eq!(
            i64_json(MAX_SAFE_JSON_INTEGER + 1),
            Value::String((MAX_SAFE_JSON_INTEGER + 1).to_string())
        );
        assert_eq!(f64_json(f64::INFINITY), Value::String("inf".into()));
        assert_eq!(f64_json(f64::NEG_INFINITY), Value::String("-inf".into()));
        assert_eq!(f64_json(f64::NAN), Value::String("NaN".into()));
    }

    #[test]
    fn bytea_has_an_explicit_base64_envelope() {
        assert_eq!(
            bytes_json(&[0, 1, 2, 255]),
            json!({ "$binary": "AAEC/w==", "encoding": "base64" })
        );
    }

    #[test]
    fn arrays_preserve_real_sql_nulls() {
        assert_eq!(
            optional_array_json(vec![Some(1_i32), None, Some(3_i32)], |value| {
                Value::Number(Number::from(value))
            }),
            json!([1, null, 3])
        );
    }

    #[test]
    fn interval_and_money_are_not_lossy_strings() {
        assert_eq!(
            interval_json(PgInterval {
                months: 2,
                days: 3,
                microseconds: MAX_SAFE_JSON_INTEGER + 1,
            }),
            json!({
                "months": 2,
                "days": 3,
                "microseconds": (MAX_SAFE_JSON_INTEGER + 1).to_string(),
            })
        );
        assert_eq!(
            money_json(PgMoney(12345)),
            json!({
                "minorUnits": 12345,
                "scale": "server-locale-dependent",
            })
        );
    }
}

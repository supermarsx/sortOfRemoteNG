//! Closed response facts only: no body, URL, parser message, field name or token.
use crate::error::{SynologyError, SynologyResult};
use serde::{de::DeserializeOwned, Serialize};

pub(crate) const RESPONSE_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Stage {
    ApiDiscovery,
    ApiLogin,
    AuthenticatedFileStation,
    ApiResponse,
}

impl Stage {
    pub(crate) fn operation(api: &str, method: &str) -> Self {
        if api == "SYNO.API.Auth" && method == "login" {
            Self::ApiLogin
        } else if api.starts_with("SYNO.FileStation.") {
            Self::AuthenticatedFileStation
        } else {
            Self::ApiResponse
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Category {
    Empty,
    Html,
    JsonSyntax,
    JsonSchema,
    HttpStatus,
    ResponseTooLarge,
    DsmApi,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum ContentType {
    Json,
    Html,
    Text,
    Other,
    Missing,
}

#[derive(Clone, Copy)]
pub(crate) struct ResponseFacts {
    stage: Stage,
    status: u16,
    content_type: ContentType,
    pub(crate) bytes_read: usize,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResponseDiagnostic {
    stage: Stage,
    category: Category,
    http_status: u16,
    content_type: ContentType,
    bytes_read: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    dsm_code: Option<i32>,
}

impl std::fmt::Display for ResponseDiagnostic {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let json = serde_json::to_string(self).map_err(|_| std::fmt::Error)?;
        write!(formatter, "\nsynology-diagnostic:v1:{json}")
    }
}

impl ResponseDiagnostic {
    pub(crate) fn discovery_fallback(self) -> bool {
        matches!(self.stage, Stage::ApiDiscovery)
            && (matches!(self.http_status, 404 | 405)
                || matches!(self.category, Category::Html)
                || matches!(self.category, Category::DsmApi)
                    && matches!(self.dsm_code, Some(102 | 103)))
    }
}

impl ResponseFacts {
    pub(crate) fn new(response: &reqwest::Response, stage: Stage) -> Self {
        let content_type = match response.headers().get(reqwest::header::CONTENT_TYPE) {
            None => ContentType::Missing,
            Some(header) => match header
                .to_str()
                .ok()
                .and_then(|value| value.split(';').next())
            {
                Some(value) if value.trim().eq_ignore_ascii_case("application/json") => {
                    ContentType::Json
                }
                Some(value)
                    if value.trim().eq_ignore_ascii_case("text/html")
                        || value.trim().eq_ignore_ascii_case("application/xhtml+xml") =>
                {
                    ContentType::Html
                }
                Some(value) if value.trim().eq_ignore_ascii_case("text/plain") => ContentType::Text,
                _ => ContentType::Other,
            },
        };
        Self {
            stage,
            status: response.status().as_u16(),
            content_type,
            bytes_read: 0,
        }
    }

    pub(crate) fn annotate(
        self,
        mut error: SynologyError,
        category: Category,
        code: Option<i32>,
    ) -> SynologyError {
        // reqwest can represent nonstandard three-digit statuses. Preserve that
        // ordinary HTTP error, but never emit an out-of-contract diagnostic or
        // invent a standard status for it.
        if !(100..=599).contains(&self.status) {
            return error;
        }
        error.diagnostic = Some(ResponseDiagnostic {
            stage: self.stage,
            category,
            http_status: self.status,
            content_type: self.content_type,
            bytes_read: self.bytes_read,
            dsm_code: code.filter(|value| (0..=65535).contains(value)),
        });
        error
    }

    pub(crate) fn decode<T: DeserializeOwned>(self, bytes: &[u8]) -> SynologyResult<T> {
        serde_json::from_slice(bytes).map_err(|error| {
            let significant = bytes.iter().position(|byte| !byte.is_ascii_whitespace());
            let category = match significant {
                None => Category::Empty,
                Some(start)
                    if bytes[start..]
                        .get(..5)
                        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"<html"))
                        || bytes[start..]
                            .get(..9)
                            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"<!doctype"))
                        || matches!(self.content_type, ContentType::Html)
                            && bytes[start] == b'<' =>
                {
                    Category::Html
                }
                _ if error.is_data() => Category::JsonSchema,
                _ => Category::JsonSyntax,
            };
            self.annotate(SynologyError::from(error), category, None)
        })
    }

    pub(crate) fn decode_value<T: DeserializeOwned>(
        self,
        value: serde_json::Value,
    ) -> SynologyResult<T> {
        serde_json::from_value(value)
            .map_err(|error| self.annotate(SynologyError::from(error), Category::JsonSchema, None))
    }
}

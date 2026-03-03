use thiserror::Error;

/// All errors that can occur within the i18n subsystem.
#[derive(Debug, Error)]
pub enum I18nError {
    #[error("locale not found: {0}")]
    LocaleNotFound(String),

    #[error("translation key not found: {key} (locale: {locale})")]
    KeyNotFound { locale: String, key: String },

    #[error("failed to load locale file {path}: {source}")]
    LoadError {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to parse locale file {path}: {source}")]
    ParseError {
        path: String,
        #[source]
        source: serde_json::Error,
    },

    #[error("watcher error: {0}")]
    WatcherError(String),

    #[error("invalid locale tag: {0}")]
    InvalidLocale(String),

    #[error("interpolation error in key {key}: missing variable {variable}")]
    InterpolationError { key: String, variable: String },

    #[error("pluralisation error in key {key}: missing plural form for count {count}")]
    PluralError { key: String, count: i64 },

    #[error("namespace not found: {0}")]
    NamespaceNotFound(String),

    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for I18nError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Convenience type alias.
pub type I18nResult<T> = Result<T, I18nError>;

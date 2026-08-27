//! Live MySQL / MariaDB tests. Ignored by default; run with
//!
//! ```text
//! npm run e2e:docker:up            # brings up test-mysql (13306) / test-mariadb (13307)
//! cargo test -p sorng-mysql --test mysql_live -- --include-ignored
//! ```
//!
//! Environment (all optional):
//! `SORNG_MYSQL_TEST_{HOST,PORT,USER,PASSWORD,DATABASE}` — defaults
//! `127.0.0.1 / 13306 / testuser / testpass / testdb`;
//! `SORNG_MARIADB_TEST_PORT` — default `13307` (same host/creds/db).
//!
//! The seeded fixture (`e2e/fixtures/db/mysql/01-seed.sql`, owned by t69-e6)
//! provides `people(id, name, city)` with 5 rows; when it is absent the tests
//! create and drop their own scratch table so they still prove the driver
//! path (connect, caching_sha2_password / mysql_native_password auth over a
//! plaintext channel, dialect detection, DDL/DML, disconnect).

use sorng_mysql::mysql::service::MysqlService;
use sorng_mysql::mysql::types::{MysqlConnectionConfig, MysqlErrorKind, ServerDialect, TlsConfig};

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn base_config(port_env: &str, default_port: u16) -> MysqlConnectionConfig {
    let port = std::env::var(port_env)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default_port);
    let mut cfg = MysqlConnectionConfig::new(
        &env_or("SORNG_MYSQL_TEST_HOST", "127.0.0.1"),
        port,
        &env_or("SORNG_MYSQL_TEST_USER", "testuser"),
        &env_or("SORNG_MYSQL_TEST_PASSWORD", "testpass"),
    )
    .with_database(&env_or("SORNG_MYSQL_TEST_DATABASE", "testdb"));
    cfg.connect_timeout_secs = Some(15);
    cfg
}

fn mysql_config() -> MysqlConnectionConfig {
    base_config("SORNG_MYSQL_TEST_PORT", 13_306)
}

fn mariadb_config() -> MysqlConnectionConfig {
    base_config("SORNG_MARIADB_TEST_PORT", 13_307)
}

/// Full round trip against one server; returns the detected dialect.
async fn round_trip(cfg: MysqlConnectionConfig) -> ServerDialect {
    let database = cfg.database.clone().unwrap();
    let mut svc = MysqlService::new();
    let id = svc.connect(cfg).await.expect("connect");

    let info = svc.server_info(&id).unwrap();
    let version = info.server_version.clone().expect("VERSION() readable");
    assert_eq!(info.dialect, ServerDialect::detect(&version));
    let session = svc.get_session(&id).unwrap();
    assert_eq!(session.dialect, info.dialect);
    assert_eq!(session.server_version.as_deref(), Some(version.as_str()));
    assert!(!session.via_ssh_tunnel);
    assert!(svc.ping(&id).await.unwrap());

    let dbs = svc.list_databases(&id).await.unwrap();
    assert!(
        dbs.iter().any(|d| d.name == database),
        "{database} missing from {dbs:?}"
    );

    // Scratch table so the test is independent of the seed fixture.
    let table = format!("sorng_live_{}", uuid_suffix());
    svc.execute_statement(
        &id,
        &format!(
            "CREATE TABLE `{database}`.`{table}` \
             (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL, city VARCHAR(64))"
        ),
    )
    .await
    .unwrap();

    (async {
        let tables = svc.list_tables(&id, &database).await.unwrap();
        assert!(tables.iter().any(|t| t.name == table));

        let cols = svc.describe_table(&id, &database, &table).await.unwrap();
        assert_eq!(cols.len(), 3);
        assert!(cols[0].is_primary_key && cols[0].is_auto_increment);

        let inserted = svc
            .execute_statement(
                &id,
                &format!(
                    "INSERT INTO `{database}`.`{table}` (name, city) VALUES \
                     ('Ada', 'London'), ('Grace', 'Arlington'), ('Linus', 'Helsinki')"
                ),
            )
            .await
            .unwrap();
        assert_eq!(inserted.affected_rows, 3);
        assert_eq!(inserted.last_insert_id, Some(1));

        let rows = svc
            .execute_query(
                &id,
                &format!("SELECT name, city FROM `{database}`.`{table}` ORDER BY id"),
            )
            .await
            .unwrap();
        assert_eq!(rows.row_count, 3);
        assert_eq!(rows.columns.len(), 2);
        assert_eq!(rows.columns[0].name, "name");
        assert_eq!(rows.rows[0][0], serde_json::Value::String("Ada".into()));
        assert_eq!(
            rows.rows[2][1],
            serde_json::Value::String("Helsinki".into())
        );

        let plan = svc
            .explain_query(
                &id,
                &format!("SELECT * FROM `{database}`.`{table}` WHERE id = 1"),
            )
            .await
            .unwrap();
        assert!(!plan.is_empty());

        // Non-text columns must keep their type instead of collapsing to the
        // literal string "NULL" (the pre-hardening behaviour), and a real SQL
        // NULL must be JSON null and nothing else.
        let typed = svc
            .execute_query(
                &id,
                "SELECT CAST(42 AS SIGNED) AS i, CAST(-7 AS SIGNED) AS neg, \
                 CAST(1.5 AS DOUBLE) AS f, CAST('9.99' AS DECIMAL(6,2)) AS dec_col, \
                 DATE '2024-03-01' AS d, TIMESTAMP '2024-03-01 12:34:56' AS ts, \
                 'text' AS s, NULL AS n",
            )
            .await
            .unwrap();
        assert_eq!(typed.columns[3].data_type, "DECIMAL");
        let cells = &typed.rows[0];
        assert_eq!(cells[0], serde_json::json!(42), "SIGNED int");
        assert_eq!(cells[1], serde_json::json!(-7), "negative int");
        assert_eq!(cells[2], serde_json::json!(1.5), "double");
        assert_eq!(cells[3].as_str(), Some("9.99"), "decimal stays exact text");
        assert_eq!(cells[4].as_str(), Some("2024-03-01"), "date");
        assert!(
            cells[5]
                .as_str()
                .is_some_and(|v| v.starts_with("2024-03-01 12:34:56")),
            "timestamp: {:?}",
            cells[5]
        );
        assert_eq!(cells[6], serde_json::json!("text"));
        assert_eq!(cells[7], serde_json::Value::Null, "SQL NULL");

        // Seed fixture (if present) — proves the e2e contract e6 relies on.
        if let Ok(people) = svc
            .execute_query(
                &id,
                &format!("SELECT name FROM `{database}`.people ORDER BY id"),
            )
            .await
        {
            assert_eq!(
                people.row_count, 5,
                "seeded people table should have 5 rows"
            );
            assert_eq!(people.rows[0][0], serde_json::Value::String("Ada".into()));
        }

        let session = svc.get_session(&id).unwrap();
        assert!(session.queries_executed >= 5);
        assert!(session.total_rows_fetched >= 3);
    })
    .await;

    svc.execute_statement(&id, &format!("DROP TABLE `{database}`.`{table}`"))
        .await
        .unwrap();
    svc.disconnect(&id).await.unwrap();
    assert_eq!(
        svc.ping(&id).await.unwrap_err().kind,
        MysqlErrorKind::NotConnected
    );
    info.dialect
}

fn uuid_suffix() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

#[tokio::test]
#[ignore = "requires a live MySQL server configured by SORNG_MYSQL_TEST_* variables"]
async fn mysql8_round_trip_detects_mysql_dialect() {
    // mysql:8 default auth plugin is caching_sha2_password; with TLS off the
    // driver must complete the RSA public-key exchange on its own.
    let mut cfg = mysql_config();
    cfg.tls = Some(TlsConfig {
        enabled: false,
        ..TlsConfig::default()
    });
    let dialect = round_trip(cfg).await;
    assert_eq!(dialect, ServerDialect::MySql);
}

#[tokio::test]
#[ignore = "requires a live MariaDB server configured by SORNG_MARIADB_TEST_PORT"]
async fn mariadb_round_trip_detects_mariadb_dialect() {
    let mut cfg = mariadb_config();
    cfg.tls = Some(TlsConfig {
        enabled: false,
        ..TlsConfig::default()
    });
    let dialect = round_trip(cfg).await;
    assert_eq!(dialect, ServerDialect::MariaDb);
}

#[tokio::test]
#[ignore = "requires a live MySQL server configured by SORNG_MYSQL_TEST_* variables"]
async fn mysql8_tls_required_negotiates_and_verify_ca_without_ca_fails() {
    // mysql:8 ships auto-generated self-signed certificates: `Required`
    // (encrypt, don't verify) must connect and report a negotiated cipher;
    // `VerifyCa` without a CA must be rejected instead of downgraded.
    let mut svc = MysqlService::new();

    let mut required = mysql_config();
    required.tls = Some(TlsConfig {
        enabled: true,
        skip_verify: true,
        ..TlsConfig::default()
    });
    let id = svc.connect(required).await.expect("TLS required connect");
    let info = svc.server_info(&id).unwrap();
    assert!(info.tls_enabled, "Ssl_cipher should be non-empty: {info:?}");
    svc.disconnect(&id).await.unwrap();

    let mut verify = mysql_config();
    verify.tls = Some(TlsConfig {
        enabled: true,
        ..TlsConfig::default()
    });
    let err = svc.connect(verify).await.unwrap_err();
    assert_eq!(err.kind, MysqlErrorKind::Connection);
    assert!(!err.message.contains("testpass"), "{}", err.message);
}

#[tokio::test]
#[ignore = "requires a live MySQL server configured by SORNG_MYSQL_TEST_* variables"]
async fn two_sessions_are_independent() {
    let mut svc = MysqlService::new();
    let a = svc.connect(mysql_config()).await.unwrap();
    let b = svc.connect(mysql_config()).await.unwrap();
    assert_ne!(a, b);
    assert_eq!(svc.list_sessions().len(), 2);
    svc.disconnect(&a).await.unwrap();
    assert!(svc.ping(&b).await.unwrap());
    assert_eq!(svc.list_sessions().len(), 1);
    svc.disconnect_all().await;
    assert!(svc.list_sessions().is_empty());
}

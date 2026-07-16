use serde_json::json;
use sorng_postgres::postgres::service::PostgresService;
use sorng_postgres::postgres::types::PgConnectionConfig;
use std::collections::HashMap;

fn live_config() -> PgConnectionConfig {
    let host =
        std::env::var("SORNG_POSTGRES_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("SORNG_POSTGRES_TEST_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(55_432);
    let username =
        std::env::var("SORNG_POSTGRES_TEST_USER").unwrap_or_else(|_| "postgres".to_string());
    let password = std::env::var("SORNG_POSTGRES_TEST_PASSWORD")
        .unwrap_or_else(|_| "sorng-test-password".to_string());
    let database =
        std::env::var("SORNG_POSTGRES_TEST_DATABASE").unwrap_or_else(|_| "postgres".to_string());

    let mut config = PgConnectionConfig::new(host, port, username)
        .with_password(password)
        .with_database(database);
    config.extra_params = Some(HashMap::from([(
        "sslmode".to_string(),
        "disable".to_string(),
    )]));
    config
}

#[tokio::test]
#[ignore = "requires a live PostgreSQL server configured by SORNG_POSTGRES_TEST_* variables"]
async fn query_results_preserve_postgresql_types_and_session_state() {
    let mut service = PostgresService::new();
    let session_id = service.connect(live_config()).await.unwrap();

    let result = service
        .execute_query(
            &session_id,
            r#"
                SELECT
                    NULL::text AS null_value,
                    TRUE AS bool_value,
                    12::smallint AS int2_value,
                    34::integer AS int4_value,
                    9007199254740992::bigint AS int8_value,
                    1.5::real AS float4_value,
                    2.25::double precision AS float8_value,
                    1234567890.123456789::numeric AS numeric_value,
                    'hello'::text AS text_value,
                    '{"a":1}'::jsonb AS json_value,
                    '123e4567-e89b-12d3-a456-426614174000'::uuid AS uuid_value,
                    DATE '2026-07-16' AS date_value,
                    TIME '12:34:56.123456' AS time_value,
                    TIMESTAMP '2026-07-16 12:34:56.123456' AS timestamp_value,
                    TIMESTAMPTZ '2026-07-16 12:34:56+01' AS timestamptz_value,
                    decode('0001ff', 'hex') AS bytea_value,
                    ARRAY[1, NULL, 3]::int4[] AS int_array,
                    ARRAY['a', NULL, 'c']::text[] AS text_array
            "#,
        )
        .await
        .unwrap();

    assert_eq!(result.columns.len(), 18);
    assert_eq!(result.rows.len(), 1);
    let row = &result.rows[0];
    assert_eq!(row["null_value"], json!(null));
    assert_eq!(row["bool_value"], json!(true));
    assert_eq!(row["int2_value"], json!(12));
    assert_eq!(row["int4_value"], json!(34));
    assert_eq!(row["int8_value"], json!("9007199254740992"));
    assert_eq!(row["float4_value"], json!(1.5));
    assert_eq!(row["float8_value"], json!(2.25));
    assert_eq!(row["numeric_value"], json!("1234567890.123456789"));
    assert_eq!(row["text_value"], json!("hello"));
    assert_eq!(row["json_value"], json!({ "a": 1 }));
    assert_eq!(
        row["uuid_value"],
        json!("123e4567-e89b-12d3-a456-426614174000")
    );
    assert_eq!(row["date_value"], json!("2026-07-16"));
    assert_eq!(row["time_value"], json!("12:34:56.123456"));
    assert_eq!(row["timestamp_value"], json!("2026-07-16T12:34:56.123456"));
    assert_eq!(row["timestamptz_value"], json!("2026-07-16T11:34:56Z"));
    assert_eq!(
        row["bytea_value"],
        json!({ "$binary": "AAH/", "encoding": "base64" })
    );
    assert_eq!(row["int_array"], json!([1, null, 3]));
    assert_eq!(row["text_array"], json!(["a", null, "c"]));

    let empty = service
        .execute_query(&session_id, "SELECT 1::int4 AS id WHERE FALSE")
        .await
        .unwrap();
    assert!(empty.rows.is_empty());
    assert_eq!(empty.columns.len(), 1);
    assert_eq!(empty.columns[0].name, "id");

    service
        .execute_statement(
            &session_id,
            "CREATE TEMP TABLE sorng_session_state(value int4)",
        )
        .await
        .unwrap();
    service
        .execute_statement(
            &session_id,
            "INSERT INTO sorng_session_state(value) VALUES (7)",
        )
        .await
        .unwrap();
    let session_state = service
        .execute_query(&session_id, "SELECT value FROM sorng_session_state")
        .await
        .unwrap();
    assert_eq!(session_state.rows[0]["value"], json!(7));

    let duplicate = service
        .execute_query(&session_id, "SELECT 1 AS duplicate, 2 AS duplicate")
        .await
        .unwrap_err();
    assert!(duplicate.message.contains("duplicate column name"));

    let unsupported = service
        .execute_query(&session_id, "SELECT '$.a'::jsonpath AS path")
        .await
        .unwrap_err();
    assert!(unsupported.message.contains("JSONPATH"));
    assert!(unsupported.message.contains("cast the column to text"));

    service.disconnect(&session_id).await.unwrap();
}

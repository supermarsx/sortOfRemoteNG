//! Live round-trip against a real MongoDB (e.g. the e2e `mongo:7` fixture).
//!
//! Run with:
//!   cargo test -p sorng-mongodb --test mongo_live -- --include-ignored
//! Env: SORNG_MONGO_TEST_{HOST,PORT,USER,PASSWORD,AUTH_DB,DATABASE}
//! Defaults: 127.0.0.1 / 27117 / testuser / testpass / admin / testdb

use serde_json::json;
use sorng_mongodb::mongodb::service::MongoService;
use sorng_mongodb::mongodb::types::{MongoConnectionConfig, MongoErrorKind, TlsConfig};

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

fn live_config() -> MongoConnectionConfig {
    let host = env_or("SORNG_MONGO_TEST_HOST", "127.0.0.1");
    let port = env_or("SORNG_MONGO_TEST_PORT", "27117");
    let user = env_or("SORNG_MONGO_TEST_USER", "testuser");
    let password = env_or("SORNG_MONGO_TEST_PASSWORD", "testpass");
    let auth_db = env_or("SORNG_MONGO_TEST_AUTH_DB", "admin");
    let database = env_or("SORNG_MONGO_TEST_DATABASE", "testdb");
    MongoConnectionConfig {
        label: Some("live".into()),
        hosts: vec![format!("{host}:{port}")],
        database: Some(database),
        username: Some(user).filter(|value| !value.is_empty()),
        password: Some(password).filter(|value| !value.is_empty()),
        auth_database: Some(auth_db),
        auth_mechanism: None,
        replica_set: None,
        read_preference: None,
        direct_connection: Some(true),
        app_name: Some("sorng-mongo-live".into()),
        connection_string: None,
        connect_timeout_secs: Some(5),
        server_selection_timeout_secs: Some(5),
        ssh_tunnel: None,
        // Plaintext is only allowed for literal loopback hosts; a remote
        // fixture must be reached over TLS.
        tls: Some(TlsConfig {
            enabled: false,
            ..Default::default()
        }),
    }
}

#[tokio::test]
#[ignore = "requires a live MongoDB server configured by SORNG_MONGO_TEST_* variables"]
async fn document_and_index_round_trip() {
    let mut service = MongoService::new();
    let session_id = service.connect(live_config()).await.unwrap();
    let info = service.get_session(&session_id).unwrap();
    assert!(info.server_version.is_some(), "buildInfo version probe");
    assert!(service.ping(&session_id).await.unwrap());

    let db = info.database.clone();
    let collection = format!("live_{}", &session_id[..8]);

    // Databases / collections.
    let databases = service.list_databases(&session_id).await.unwrap();
    assert!(databases.iter().any(|entry| entry.name == "admin"));
    service
        .create_collection(&session_id, db.as_deref(), &collection)
        .await
        .unwrap();
    let collections = service
        .list_collections(&session_id, db.as_deref())
        .await
        .unwrap();
    assert!(collections.iter().any(|entry| entry.name == collection));

    // Insert.
    let inserted = service
        .insert_documents(
            &session_id,
            db.as_deref(),
            &collection,
            vec![
                json!({ "name": "Ada", "city": "London", "age": 36, "address": { "zip": "N1" } }),
                json!({ "name": "Grace", "city": "New York", "age": 45 }),
                json!({ "name": "Linus", "city": "London", "age": 28 }),
                json!({ "name": "Ken", "city": "Portland", "age": 80, "when": { "$date": "2026-01-02T03:04:05Z" } }),
                json!({ "name": "Margaret", "city": "Boston", "age": 60 }),
            ],
        )
        .await
        .unwrap();
    assert_eq!(inserted.inserted_count, 5);
    assert!(inserted.inserted_ids[0]["$oid"].is_string());

    // Find with filter / sort / projection / skip / limit.
    let page = service
        .find(
            &session_id,
            db.as_deref(),
            &collection,
            json!({ "city": "London" }),
            Some(json!({ "name": 1, "_id": 0 })),
            Some(json!({ "age": 1 })),
            Some(10),
            None,
        )
        .await
        .unwrap();
    assert_eq!(page.returned, 2);
    assert!(!page.has_more);
    assert_eq!(page.documents[0], json!({ "name": "Linus" }));

    let paged = service
        .find(
            &session_id,
            db.as_deref(),
            &collection,
            json!({}),
            None,
            Some(json!({ "age": 1 })),
            Some(2),
            Some(1),
        )
        .await
        .unwrap();
    assert_eq!(paged.returned, 2);
    assert!(paged.has_more);
    assert_eq!(paged.documents[0]["name"], "Ada");
    assert!(paged.documents[0]["_id"]["$oid"].is_string());

    // Extended JSON round trip.
    let dated = service
        .find(
            &session_id,
            db.as_deref(),
            &collection,
            json!({ "when": { "$gte": { "$date": "2026-01-01T00:00:00Z" } } }),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(dated.returned, 1);
    assert_eq!(dated.documents[0]["name"], "Ken");

    // Counts.
    assert_eq!(
        service
            .count_documents(
                &session_id,
                db.as_deref(),
                &collection,
                json!({ "city": "London" })
            )
            .await
            .unwrap(),
        2
    );
    assert_eq!(
        service
            .estimated_count(&session_id, db.as_deref(), &collection)
            .await
            .unwrap(),
        5
    );

    // Aggregate.
    let grouped = service
        .aggregate(
            &session_id,
            db.as_deref(),
            &collection,
            vec![
                json!({ "$group": { "_id": "$city", "n": { "$sum": 1 } } }),
                json!({ "$sort": { "_id": 1 } }),
            ],
            None,
        )
        .await
        .unwrap();
    assert_eq!(grouped.returned, 4);
    assert_eq!(grouped.documents[1], json!({ "_id": "London", "n": 2 }));

    // Update / delete.
    let updated = service
        .update_documents(
            &session_id,
            db.as_deref(),
            &collection,
            json!({ "city": "London" }),
            json!({ "$set": { "country": "UK" } }),
            true,
            false,
        )
        .await
        .unwrap();
    assert_eq!(updated.matched_count, 2);
    assert_eq!(updated.modified_count, 2);

    let upserted = service
        .update_documents(
            &session_id,
            db.as_deref(),
            &collection,
            json!({ "name": "Nobody" }),
            json!({ "$set": { "city": "Nowhere" } }),
            false,
            true,
        )
        .await
        .unwrap();
    assert!(upserted.upserted_id.is_some());

    let bad_update = service
        .update_documents(
            &session_id,
            db.as_deref(),
            &collection,
            json!({}),
            json!({ "city": "replace" }),
            true,
            false,
        )
        .await
        .unwrap_err();
    assert_eq!(bad_update.kind, MongoErrorKind::InvalidConfig);

    let deleted = service
        .delete_documents(
            &session_id,
            db.as_deref(),
            &collection,
            json!({ "name": "Nobody" }),
            false,
        )
        .await
        .unwrap();
    assert_eq!(deleted.deleted_count, 1);

    // Indexes.
    let name = service
        .create_index(
            &session_id,
            db.as_deref(),
            &collection,
            json!({ "city": 1 }),
            Some(json!({ "name": "city_1" })),
        )
        .await
        .unwrap();
    assert_eq!(name, "city_1");
    let indexes = service
        .list_indexes(&session_id, db.as_deref(), &collection)
        .await
        .unwrap();
    assert!(indexes.iter().any(|index| index.name == "_id_"));
    let city = indexes.iter().find(|index| index.name == "city_1").unwrap();
    assert_eq!(city.keys, json!({ "city": 1 }));
    service
        .drop_index(&session_id, db.as_deref(), &collection, "city_1")
        .await
        .unwrap();
    let indexes = service
        .list_indexes(&session_id, db.as_deref(), &collection)
        .await
        .unwrap();
    assert!(!indexes.iter().any(|index| index.name == "city_1"));

    // Stats / admin.
    let stats = service
        .collection_stats(&session_id, db.as_deref(), &collection)
        .await
        .unwrap();
    assert_eq!(stats.count, 5);
    assert!(stats.namespace.ends_with(&collection));
    let status = service.server_status(&session_id).await.unwrap();
    assert!(!status.version.is_empty());
    assert!(!service.current_op(&session_id).await.unwrap().is_empty());

    // Cleanup.
    service
        .drop_collection(&session_id, db.as_deref(), &collection)
        .await
        .unwrap();
    service.disconnect(&session_id).await.unwrap();
    assert!(service.get_session(&session_id).is_err());
}

#[tokio::test]
#[ignore = "requires a live MongoDB server configured by SORNG_MONGO_TEST_* variables"]
async fn wrong_password_is_reported_without_echoing_secrets() {
    let mut service = MongoService::new();
    let mut config = live_config();
    if config.username.is_none() {
        return; // unauthenticated fixture; nothing to assert
    }
    config.password = Some("definitely-wrong-password".into());
    let error = service.connect(config).await.unwrap_err();
    assert_eq!(error.kind, MongoErrorKind::ConnectionFailed);
    assert!(!error.message.contains("definitely-wrong-password"));
    assert!(!error.message.contains("mongodb://"));
    assert!(service.list_sessions().is_empty());
}

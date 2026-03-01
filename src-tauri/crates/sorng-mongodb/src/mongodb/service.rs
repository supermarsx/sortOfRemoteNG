//! MongoDB service providing multi-session connection management,
//! document CRUD, aggregation, collection & index management, and server admin.

use crate::mongodb::types::*;
use chrono::Utc;
use log::{error, info, warn};
use mongodb::{
    bson::{doc, Bson, Document as BsonDocument},
    options::{ClientOptions, FindOptions as MongoFindOptions},
    Client,
};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ── State ───────────────────────────────────────────────────────────

pub type MongoServiceState = Arc<Mutex<MongoService>>;

pub fn new_state() -> MongoServiceState {
    Arc::new(Mutex::new(MongoService::new()))
}

/// A live MongoDB session.
struct MongoSession {
    client: Client,
    info: SessionInfo,
    ssh_child: Option<std::process::Child>,
}

/// Manages multiple named MongoDB sessions.
pub struct MongoService {
    sessions: HashMap<String, MongoSession>,
}

impl MongoService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    // ── Connection lifecycle ────────────────────────────────────────

    /// Connect to a MongoDB instance, returning the session ID.
    pub async fn connect(&mut self, config: MongoConnectionConfig) -> Result<String, MongoError> {
        let session_id = Uuid::new_v4().to_string();
        let label = config
            .label
            .clone()
            .unwrap_or_else(|| format!("mongo-{}", &session_id[..8]));

        // SSH tunnel setup
        let (effective_hosts, ssh_child) = if let Some(ref _ssh) = config.ssh_tunnel {
            // SSH tunnel would redirect connections through a local port.
            // For now, store the child handle for cleanup later.
            warn!("SSH tunnel support for MongoDB is a stub — connecting directly");
            (config.hosts.clone(), None)
        } else {
            (config.hosts.clone(), None)
        };

        let cs = if config.connection_string.is_some() {
            config.to_connection_string()
        } else {
            let mut cfg_clone = config.clone();
            cfg_clone.hosts = effective_hosts.clone();
            cfg_clone.to_connection_string()
        };

        let mut client_options = ClientOptions::parse(&cs).await.map_err(|e| {
            MongoError::connection_failed(format!("Failed to parse connection options: {e}"))
        })?;

        if let Some(t) = config.connect_timeout_secs {
            client_options.connect_timeout =
                Some(std::time::Duration::from_secs(t));
        }
        if let Some(t) = config.server_selection_timeout_secs {
            client_options.server_selection_timeout =
                Some(std::time::Duration::from_secs(t));
        }

        let client = Client::with_options(client_options).map_err(|e| {
            MongoError::connection_failed(format!("Failed to create client: {e}"))
        })?;

        // Verify connectivity by pinging admin
        let db = client.database("admin");
        db.run_command(doc! { "ping": 1 }).await.map_err(|e| {
            MongoError::connection_failed(format!("Ping failed: {e}"))
        })?;

        // Get server version
        let build_info: Option<BsonDocument> = db
            .run_command(doc! { "buildInfo": 1 })
            .await
            .ok();
        let server_version = build_info
            .as_ref()
            .and_then(|d| d.get_str("version").ok())
            .map(|s| s.to_string());

        let info = SessionInfo {
            id: session_id.clone(),
            label,
            hosts: effective_hosts,
            database: config.database.clone(),
            status: ConnectionStatus::Connected,
            connected_at: Utc::now().to_rfc3339(),
            server_version,
            replica_set: config.replica_set.clone(),
        };

        info!("MongoDB connected: {} ({})", info.label, session_id);

        self.sessions.insert(
            session_id.clone(),
            MongoSession {
                client,
                info,
                ssh_child,
            },
        );

        Ok(session_id)
    }

    /// Disconnect a specific session.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), MongoError> {
        let mut session = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| MongoError::session_not_found(session_id))?;

        if let Some(ref mut child) = session.ssh_child {
            let _ = child.kill();
        }

        info!("MongoDB disconnected: {session_id}");
        Ok(())
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&mut self) {
        for (id, mut s) in self.sessions.drain() {
            if let Some(ref mut child) = s.ssh_child {
                let _ = child.kill();
            }
            info!("MongoDB disconnected: {id}");
        }
    }

    /// List active sessions.
    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info.clone()).collect()
    }

    /// Get a specific session's info.
    pub fn get_session(&self, session_id: &str) -> Result<SessionInfo, MongoError> {
        self.sessions
            .get(session_id)
            .map(|s| s.info.clone())
            .ok_or_else(|| MongoError::session_not_found(session_id))
    }

    /// Ping the server for a session.
    pub async fn ping(&self, session_id: &str) -> Result<bool, MongoError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| MongoError::session_not_found(session_id))?;

        let db = session.client.database("admin");
        match db.run_command(doc! { "ping": 1 }).await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    fn get_client(&self, session_id: &str) -> Result<&Client, MongoError> {
        self.sessions
            .get(session_id)
            .map(|s| &s.client)
            .ok_or_else(|| MongoError::session_not_found(session_id))
    }

    fn resolve_db<'a>(
        &'a self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<mongodb::Database, MongoError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| MongoError::session_not_found(session_id))?;
        let name = db_name
            .or(session.info.database.as_deref())
            .ok_or_else(|| {
                MongoError::new(MongoErrorKind::InvalidConfig, "No database specified")
            })?;
        Ok(session.client.database(name))
    }

    // ── Database management ─────────────────────────────────────────

    /// List all databases.
    pub async fn list_databases(&self, session_id: &str) -> Result<Vec<DatabaseInfo>, MongoError> {
        let client = self.get_client(session_id)?;
        let dbs = client.list_databases().await.map_err(|e| {
            MongoError::new(MongoErrorKind::DatabaseError, format!("list_databases: {e}"))
        })?;
        Ok(dbs
            .into_iter()
            .map(|d| DatabaseInfo {
                name: d.name,
                size_on_disk: Some(d.size_on_disk as i64),
                empty: None,
            })
            .collect())
    }

    /// Drop a database.
    pub async fn drop_database(
        &self,
        session_id: &str,
        db_name: &str,
    ) -> Result<(), MongoError> {
        let client = self.get_client(session_id)?;
        client
            .database(db_name)
            .drop()
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::DatabaseError, format!("drop_database: {e}"))
            })
    }

    // ── Collection management ───────────────────────────────────────

    /// List collections in a database.
    pub async fn list_collections(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<Vec<CollectionInfo>, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let specs = db.list_collections().await.map_err(|e| {
            MongoError::new(
                MongoErrorKind::DatabaseError,
                format!("list_collections: {e}"),
            )
        })?;

        use futures_core::Stream;
        use tokio_stream::StreamExt;

        // We need to collect from the cursor
        let mut cursor = db.list_collections().await.map_err(|e| {
            MongoError::new(
                MongoErrorKind::DatabaseError,
                format!("list_collections: {e}"),
            )
        })?;

        let mut collections = Vec::new();
        while let Some(result) = StreamExt::next(&mut cursor).await {
            match result {
                Ok(spec) => {
                    collections.push(CollectionInfo {
                        name: spec.name,
                        collection_type: format!("{:?}", spec.collection_type),
                        options: spec
                            .options
                            .and_then(|o| serde_json::to_value(&o).ok()),
                        read_only: false,
                    });
                }
                Err(e) => {
                    error!("Error iterating collections: {e}");
                }
            }
        }
        Ok(collections)
    }

    /// Create a new collection.
    pub async fn create_collection(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<(), MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        db.create_collection(collection_name).await.map_err(|e| {
            MongoError::new(
                MongoErrorKind::DatabaseError,
                format!("create_collection: {e}"),
            )
        })
    }

    /// Drop a collection.
    pub async fn drop_collection(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<(), MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        db.collection::<BsonDocument>(collection_name)
            .drop()
            .await
            .map_err(|e| {
                MongoError::new(
                    MongoErrorKind::DatabaseError,
                    format!("drop_collection: {e}"),
                )
            })
    }

    /// Get collection statistics.
    pub async fn collection_stats(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<CollectionStats, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let result = db
            .run_command(doc! { "collStats": collection_name })
            .await
            .map_err(|e| {
                MongoError::new(
                    MongoErrorKind::DatabaseError,
                    format!("collStats: {e}"),
                )
            })?;

        Ok(CollectionStats {
            namespace: result
                .get_str("ns")
                .unwrap_or_default()
                .to_string(),
            count: result.get_i64("count").unwrap_or(0),
            size: result.get_i64("size").unwrap_or(0),
            avg_obj_size: result.get_f64("avgObjSize").ok(),
            storage_size: result.get_i64("storageSize").unwrap_or(0),
            num_indexes: result.get_i32("nindexes").unwrap_or(0),
            total_index_size: result.get_i64("totalIndexSize").unwrap_or(0),
            capped: result.get_bool("capped").unwrap_or(false),
        })
    }

    // ── Document CRUD ───────────────────────────────────────────────

    /// Find documents in a collection.
    pub async fn find(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        options: FindOptions,
    ) -> Result<DocumentResult, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let filter = options
            .filter
            .and_then(|v| json_to_bson_doc(&v))
            .unwrap_or_default();

        let mut find_opts = MongoFindOptions::builder().build();

        if let Some(proj) = options.projection {
            if let Some(p) = json_to_bson_doc(&proj) {
                find_opts.projection = Some(p);
            }
        }
        if let Some(ref sorts) = options.sort {
            let mut sort_doc = BsonDocument::new();
            for s in sorts {
                sort_doc.insert(
                    s.field.clone(),
                    match s.direction {
                        SortDirection::Ascending => 1,
                        SortDirection::Descending => -1,
                    },
                );
            }
            find_opts.sort = Some(sort_doc);
        }
        if let Some(l) = options.limit {
            find_opts.limit = Some(l);
        }
        if let Some(s) = options.skip {
            find_opts.skip = Some(s);
        }

        let mut cursor = coll.find(filter).with_options(find_opts).await.map_err(|e| {
            MongoError::new(MongoErrorKind::DatabaseError, format!("find: {e}"))
        })?;

        let mut documents = Vec::new();
        use tokio_stream::StreamExt;
        while let Some(result) = StreamExt::next(&mut cursor).await {
            match result {
                Ok(d) => {
                    if let Ok(json) = bson_doc_to_json(&d) {
                        documents.push(json);
                    }
                }
                Err(e) => {
                    error!("Error reading document: {e}");
                }
            }
        }

        let count = documents.len();
        Ok(DocumentResult { documents, count })
    }

    /// Count documents matching a filter.
    pub async fn count_documents(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        filter: Option<serde_json::Value>,
    ) -> Result<u64, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let filter_doc = filter.and_then(|v| json_to_bson_doc(&v)).unwrap_or_default();

        coll.count_documents(filter_doc)
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::DatabaseError, format!("count_documents: {e}"))
            })
    }

    /// Insert a single document.
    pub async fn insert_one(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        document: serde_json::Value,
    ) -> Result<InsertResult, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let doc = json_to_bson_doc(&document).ok_or_else(|| {
            MongoError::new(MongoErrorKind::SerializationError, "Invalid document JSON")
        })?;

        let result = coll.insert_one(doc).await.map_err(|e| {
            MongoError::new(MongoErrorKind::WriteError, format!("insert_one: {e}"))
        })?;

        let id_str = bson_to_string(&result.inserted_id);
        Ok(InsertResult {
            inserted_ids: vec![id_str],
            count: 1,
        })
    }

    /// Insert multiple documents.
    pub async fn insert_many(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        documents: Vec<serde_json::Value>,
    ) -> Result<InsertResult, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let docs: Vec<BsonDocument> = documents
            .iter()
            .filter_map(|v| json_to_bson_doc(v))
            .collect();

        if docs.is_empty() {
            return Err(MongoError::new(
                MongoErrorKind::SerializationError,
                "No valid documents to insert",
            ));
        }

        let result = coll.insert_many(docs).await.map_err(|e| {
            MongoError::new(MongoErrorKind::BulkWriteError, format!("insert_many: {e}"))
        })?;

        let ids: Vec<String> = result
            .inserted_ids
            .values()
            .map(|b| bson_to_string(b))
            .collect();
        let count = ids.len();

        Ok(InsertResult {
            inserted_ids: ids,
            count,
        })
    }

    /// Update documents matching a filter.
    pub async fn update_many(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        filter: serde_json::Value,
        update: serde_json::Value,
    ) -> Result<UpdateResult, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let filter_doc = json_to_bson_doc(&filter).unwrap_or_default();
        let update_doc = json_to_bson_doc(&update).ok_or_else(|| {
            MongoError::new(MongoErrorKind::SerializationError, "Invalid update document")
        })?;

        let result = coll
            .update_many(filter_doc, update_doc)
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::WriteError, format!("update_many: {e}"))
            })?;

        Ok(UpdateResult {
            matched_count: result.matched_count,
            modified_count: result.modified_count,
            upserted_id: result.upserted_id.map(|b| bson_to_string(&b)),
        })
    }

    /// Update a single document matching a filter.
    pub async fn update_one(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        filter: serde_json::Value,
        update: serde_json::Value,
    ) -> Result<UpdateResult, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let filter_doc = json_to_bson_doc(&filter).unwrap_or_default();
        let update_doc = json_to_bson_doc(&update).ok_or_else(|| {
            MongoError::new(MongoErrorKind::SerializationError, "Invalid update document")
        })?;

        let result = coll
            .update_one(filter_doc, update_doc)
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::WriteError, format!("update_one: {e}"))
            })?;

        Ok(UpdateResult {
            matched_count: result.matched_count,
            modified_count: result.modified_count,
            upserted_id: result.upserted_id.map(|b| bson_to_string(&b)),
        })
    }

    /// Delete documents matching a filter.
    pub async fn delete_many(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        filter: serde_json::Value,
    ) -> Result<DeleteResult, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let filter_doc = json_to_bson_doc(&filter).unwrap_or_default();

        let result = coll.delete_many(filter_doc).await.map_err(|e| {
            MongoError::new(MongoErrorKind::WriteError, format!("delete_many: {e}"))
        })?;

        Ok(DeleteResult {
            deleted_count: result.deleted_count,
        })
    }

    /// Delete a single document matching a filter.
    pub async fn delete_one(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        filter: serde_json::Value,
    ) -> Result<DeleteResult, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let filter_doc = json_to_bson_doc(&filter).unwrap_or_default();

        let result = coll.delete_one(filter_doc).await.map_err(|e| {
            MongoError::new(MongoErrorKind::WriteError, format!("delete_one: {e}"))
        })?;

        Ok(DeleteResult {
            deleted_count: result.deleted_count,
        })
    }

    // ── Aggregation ─────────────────────────────────────────────────

    /// Run an aggregation pipeline on a collection.
    pub async fn aggregate(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        pipeline: Vec<serde_json::Value>,
    ) -> Result<DocumentResult, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let bson_pipeline: Vec<BsonDocument> = pipeline
            .iter()
            .filter_map(|v| json_to_bson_doc(v))
            .collect();

        let mut cursor = coll.aggregate(bson_pipeline).await.map_err(|e| {
            MongoError::new(
                MongoErrorKind::AggregationError,
                format!("aggregate: {e}"),
            )
        })?;

        let mut documents = Vec::new();
        use tokio_stream::StreamExt;
        while let Some(result) = StreamExt::next(&mut cursor).await {
            match result {
                Ok(d) => {
                    if let Ok(json) = bson_doc_to_json(&d) {
                        documents.push(json);
                    }
                }
                Err(e) => {
                    error!("Error reading aggregation result: {e}");
                }
            }
        }

        let count = documents.len();
        Ok(DocumentResult { documents, count })
    }

    /// Run an arbitrary command on a database.
    pub async fn run_command(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        command: serde_json::Value,
    ) -> Result<serde_json::Value, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let cmd = json_to_bson_doc(&command).ok_or_else(|| {
            MongoError::new(MongoErrorKind::SerializationError, "Invalid command JSON")
        })?;

        let result = db.run_command(cmd).await.map_err(|e| {
            MongoError::new(MongoErrorKind::CommandError, format!("run_command: {e}"))
        })?;

        bson_doc_to_json(&result).map_err(|e| {
            MongoError::new(
                MongoErrorKind::SerializationError,
                format!("Failed to serialise result: {e}"),
            )
        })
    }

    // ── Index management ────────────────────────────────────────────

    /// List indexes on a collection.
    pub async fn list_indexes(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<Vec<IndexInfo>, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let mut cursor = coll.list_indexes().await.map_err(|e| {
            MongoError::new(MongoErrorKind::IndexError, format!("list_indexes: {e}"))
        })?;

        let mut indexes = Vec::new();
        use tokio_stream::StreamExt;
        while let Some(result) = StreamExt::next(&mut cursor).await {
            match result {
                Ok(idx) => {
                    let keys_json =
                        bson_doc_to_json(&idx.keys).unwrap_or(serde_json::json!({}));
                    let options = &idx.options;
                    indexes.push(IndexInfo {
                        name: options
                            .as_ref()
                            .and_then(|o| o.name.clone())
                            .unwrap_or_default(),
                        keys: keys_json,
                        unique: options.as_ref().and_then(|o| o.unique).unwrap_or(false),
                        sparse: options.as_ref().and_then(|o| o.sparse).unwrap_or(false),
                        ttl: options
                            .as_ref()
                            .and_then(|o| o.expire_after.map(|d| d.as_secs() as i64)),
                        partial_filter: options
                            .as_ref()
                            .and_then(|o| {
                                o.partial_filter_expression
                                    .as_ref()
                                    .and_then(|d| bson_doc_to_json(d).ok())
                            }),
                    });
                }
                Err(e) => {
                    error!("Error iterating indexes: {e}");
                }
            }
        }

        Ok(indexes)
    }

    /// Create an index on a collection.
    pub async fn create_index(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        keys: serde_json::Value,
        unique: bool,
        name: Option<String>,
    ) -> Result<String, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        let keys_doc = json_to_bson_doc(&keys).ok_or_else(|| {
            MongoError::new(MongoErrorKind::SerializationError, "Invalid index keys JSON")
        })?;

        let mut opts = mongodb::options::IndexOptions::builder().build();
        opts.unique = Some(unique);
        if let Some(n) = name {
            opts.name = Some(n);
        }

        let model = mongodb::IndexModel::builder()
            .keys(keys_doc)
            .options(opts)
            .build();

        let result = coll.create_index(model).await.map_err(|e| {
            MongoError::new(MongoErrorKind::IndexError, format!("create_index: {e}"))
        })?;

        Ok(result.index_name)
    }

    /// Drop an index on a collection.
    pub async fn drop_index(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        index_name: &str,
    ) -> Result<(), MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let coll = db.collection::<BsonDocument>(collection_name);

        coll.drop_index(index_name).await.map_err(|e| {
            MongoError::new(MongoErrorKind::IndexError, format!("drop_index: {e}"))
        })
    }

    // ── Server admin ────────────────────────────────────────────────

    /// Get the server status.
    pub async fn server_status(
        &self,
        session_id: &str,
    ) -> Result<ServerStatus, MongoError> {
        let client = self.get_client(session_id)?;
        let db = client.database("admin");
        let result = db
            .run_command(doc! { "serverStatus": 1 })
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::CommandError, format!("serverStatus: {e}"))
            })?;

        let host = result.get_str("host").unwrap_or("unknown").to_string();
        let version = result.get_str("version").unwrap_or("unknown").to_string();
        let uptime_secs = result.get_f64("uptime").unwrap_or(0.0);

        let connections = if let Ok(conn_doc) = result.get_document("connections") {
            ConnectionStats {
                current: conn_doc.get_i32("current").unwrap_or(0),
                available: conn_doc.get_i32("available").unwrap_or(0),
                total_created: conn_doc.get_i64("totalCreated").unwrap_or(0),
            }
        } else {
            ConnectionStats {
                current: 0,
                available: 0,
                total_created: 0,
            }
        };

        let opcounters = result
            .get_document("opcounters")
            .ok()
            .and_then(|d| bson_doc_to_json(d).ok());

        let mem = result
            .get_document("mem")
            .ok()
            .and_then(|d| bson_doc_to_json(d).ok());

        let extra = bson_doc_to_json(&result).unwrap_or(serde_json::json!({}));

        Ok(ServerStatus {
            host,
            version,
            uptime_secs,
            connections,
            opcounters,
            mem,
            extra,
        })
    }

    /// List users in a database.
    pub async fn list_users(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<Vec<MongoUserInfo>, MongoError> {
        let db = self.resolve_db(session_id, db_name.or(Some("admin")))?;
        let result = db
            .run_command(doc! { "usersInfo": 1 })
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::CommandError, format!("usersInfo: {e}"))
            })?;

        let mut users = Vec::new();
        if let Ok(users_arr) = result.get_array("users") {
            for u in users_arr {
                if let Bson::Document(ref d) = u {
                    let user = d.get_str("user").unwrap_or_default().to_string();
                    let database = d.get_str("db").unwrap_or_default().to_string();
                    let mut roles = Vec::new();
                    if let Ok(roles_arr) = d.get_array("roles") {
                        for r in roles_arr {
                            if let Bson::Document(ref rd) = r {
                                roles.push(MongoRole {
                                    role: rd.get_str("role").unwrap_or_default().to_string(),
                                    db: rd.get_str("db").unwrap_or_default().to_string(),
                                });
                            }
                        }
                    }
                    users.push(MongoUserInfo {
                        user,
                        database,
                        roles,
                    });
                }
            }
        }
        Ok(users)
    }

    /// Get replica set status.
    pub async fn replica_set_status(
        &self,
        session_id: &str,
    ) -> Result<Vec<ReplicaSetMember>, MongoError> {
        let client = self.get_client(session_id)?;
        let db = client.database("admin");
        let result = db
            .run_command(doc! { "replSetGetStatus": 1 })
            .await
            .map_err(|e| {
                MongoError::new(
                    MongoErrorKind::CommandError,
                    format!("replSetGetStatus: {e}"),
                )
            })?;

        let mut members = Vec::new();
        if let Ok(members_arr) = result.get_array("members") {
            for m in members_arr {
                if let Bson::Document(ref d) = m {
                    members.push(ReplicaSetMember {
                        name: d.get_str("name").unwrap_or_default().to_string(),
                        state_str: d.get_str("stateStr").unwrap_or_default().to_string(),
                        state: d.get_i32("state").unwrap_or(0),
                        health: d.get_f64("health").unwrap_or(0.0),
                        is_self: d.get_bool("self").ok(),
                        uptime: d.get_i64("uptime").ok(),
                    });
                }
            }
        }
        Ok(members)
    }

    /// Get current operations.
    pub async fn current_op(
        &self,
        session_id: &str,
    ) -> Result<Vec<serde_json::Value>, MongoError> {
        let client = self.get_client(session_id)?;
        let db = client.database("admin");
        let result = db
            .run_command(doc! { "currentOp": 1 })
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::CommandError, format!("currentOp: {e}"))
            })?;

        let mut ops = Vec::new();
        if let Ok(inprog) = result.get_array("inprog") {
            for o in inprog {
                if let Bson::Document(ref d) = o {
                    if let Ok(json) = bson_doc_to_json(d) {
                        ops.push(json);
                    }
                }
            }
        }
        Ok(ops)
    }

    /// Kill an operation by opId.
    pub async fn kill_op(
        &self,
        session_id: &str,
        op_id: i64,
    ) -> Result<(), MongoError> {
        let client = self.get_client(session_id)?;
        let db = client.database("admin");
        db.run_command(doc! { "killOp": 1, "op": op_id })
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::CommandError, format!("killOp: {e}"))
            })?;
        Ok(())
    }

    // ── Export ───────────────────────────────────────────────────────

    /// Export a collection to a string format.
    pub async fn export_collection(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        options: ExportOptions,
    ) -> Result<String, MongoError> {
        let find_opts = FindOptions {
            filter: options.filter,
            projection: options.projection,
            sort: None,
            limit: options.limit,
            skip: None,
        };

        let result = self
            .find(session_id, db_name, collection_name, find_opts)
            .await?;

        match options.format {
            ExportFormat::Json => serde_json::to_string_pretty(&result.documents).map_err(|e| {
                MongoError::new(
                    MongoErrorKind::SerializationError,
                    format!("JSON export: {e}"),
                )
            }),
            ExportFormat::JsonArray => {
                serde_json::to_string(&result.documents).map_err(|e| {
                    MongoError::new(
                        MongoErrorKind::SerializationError,
                        format!("JSON array export: {e}"),
                    )
                })
            }
            ExportFormat::Ndjson => {
                let mut output = String::new();
                for doc in &result.documents {
                    let line = serde_json::to_string(doc).map_err(|e| {
                        MongoError::new(
                            MongoErrorKind::SerializationError,
                            format!("NDJSON export: {e}"),
                        )
                    })?;
                    output.push_str(&line);
                    output.push('\n');
                }
                Ok(output)
            }
            ExportFormat::Csv => {
                // Collect all field names
                let mut fields = Vec::new();
                let mut field_set = std::collections::HashSet::new();
                for doc in &result.documents {
                    if let Some(obj) = doc.as_object() {
                        for key in obj.keys() {
                            if field_set.insert(key.clone()) {
                                fields.push(key.clone());
                            }
                        }
                    }
                }

                let mut output = fields.join(",");
                output.push('\n');

                for doc in &result.documents {
                    let row: Vec<String> = fields
                        .iter()
                        .map(|f| {
                            doc.get(f)
                                .map(|v| match v {
                                    JsonValue::String(s) => csv_escape(s),
                                    JsonValue::Null => String::new(),
                                    other => csv_escape(&other.to_string()),
                                })
                                .unwrap_or_default()
                        })
                        .collect();
                    output.push_str(&row.join(","));
                    output.push('\n');
                }
                Ok(output)
            }
        }
    }
}

// ── Conversion helpers ──────────────────────────────────────────────

/// Convert a serde_json::Value to a BSON Document.
fn json_to_bson_doc(v: &serde_json::Value) -> Option<BsonDocument> {
    let bson: Bson = v.clone().try_into().ok()?;
    match bson {
        Bson::Document(d) => Some(d),
        _ => None,
    }
}

/// Convert a BSON Document to serde_json::Value.
fn bson_doc_to_json(d: &BsonDocument) -> Result<serde_json::Value, String> {
    let bson = Bson::Document(d.clone());
    let v: serde_json::Value = bson.into();
    Ok(v)
}

/// Convert a Bson value to a string representation.
fn bson_to_string(b: &Bson) -> String {
    match b {
        Bson::ObjectId(oid) => oid.to_hex(),
        Bson::String(s) => s.clone(),
        Bson::Int32(i) => i.to_string(),
        Bson::Int64(i) => i.to_string(),
        other => format!("{other:?}"),
    }
}

/// CSV-escape a string value.
fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_service() {
        let svc = MongoService::new();
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn test_session_not_found() {
        let svc = MongoService::new();
        let result = svc.get_session("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_json_to_bson_doc() {
        let v = serde_json::json!({"name": "test", "value": 42});
        let doc = json_to_bson_doc(&v).unwrap();
        assert_eq!(doc.get_str("name").unwrap(), "test");
    }

    #[test]
    fn test_json_to_bson_doc_invalid() {
        let v = serde_json::json!("just a string");
        assert!(json_to_bson_doc(&v).is_none());
    }

    #[test]
    fn test_bson_doc_to_json() {
        let doc = doc! { "key": "value", "num": 10 };
        let json = bson_doc_to_json(&doc).unwrap();
        assert_eq!(json["key"], "value");
        assert_eq!(json["num"], 10);
    }

    #[test]
    fn test_bson_to_string_objectid() {
        let oid = mongodb::bson::oid::ObjectId::new();
        let b = Bson::ObjectId(oid);
        let s = bson_to_string(&b);
        assert_eq!(s.len(), 24); // hex objectid
    }

    #[test]
    fn test_bson_to_string_int() {
        assert_eq!(bson_to_string(&Bson::Int32(42)), "42");
        assert_eq!(bson_to_string(&Bson::Int64(999)), "999");
    }

    #[test]
    fn test_csv_escape_no_special() {
        assert_eq!(csv_escape("hello"), "hello");
    }

    #[test]
    fn test_csv_escape_with_comma() {
        assert_eq!(csv_escape("foo,bar"), "\"foo,bar\"");
    }

    #[test]
    fn test_csv_escape_with_quotes() {
        assert_eq!(csv_escape("say \"hi\""), "\"say \"\"hi\"\"\"");
    }

    #[tokio::test]
    async fn test_disconnect_nonexistent() {
        let mut svc = MongoService::new();
        let result = svc.disconnect("no-such").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_ping_nonexistent() {
        let svc = MongoService::new();
        let result = svc.ping("no-such").await;
        assert!(result.is_err());
    }
}

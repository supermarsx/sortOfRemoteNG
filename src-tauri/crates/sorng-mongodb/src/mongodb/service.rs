//! MongoDB service built on the official `mongodb` driver.
//!
//! Every session owns one driver [`Client`]. Connection URIs and passwords are
//! held only for the duration of `connect` (zeroized afterwards); they are never
//! logged, echoed in errors, or retained on the session.

use crate::mongodb::types::*;
use chrono::Utc;
use futures::TryStreamExt;
use log::info;
use mongodb::bson::{doc, Bson, Document};
use mongodb::error::{Error as DriverError, ErrorKind, WriteFailure};
use mongodb::options::{ClientOptions, IndexOptions, Tls, TlsOptions, UpdateModifications};
use mongodb::{Client, IndexModel};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const MAX_CONNECTION_URI_BYTES: usize = 8 * 1024;
pub const MAX_SESSIONS: usize = 32;
const MAX_HOSTS: usize = 32;
const MAX_HOST_BYTES: usize = 512;
const MAX_FIELD_BYTES: usize = 1024;
const MAX_PATH_BYTES: usize = 4096;
const MAX_SESSION_ID_BYTES: usize = 128;
const MAX_TIMEOUT_SECS: u64 = 300;
const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_SERVER_SELECTION_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_APP_NAME: &str = "sortOfRemoteNG";

pub type MongoServiceState = Arc<Mutex<MongoService>>;

pub fn new_state() -> MongoServiceState {
    Arc::new(Mutex::new(MongoService::new()))
}

struct MongoSession {
    client: Client,
    info: SessionInfo,
}

pub struct MongoService {
    sessions: HashMap<String, MongoSession>,
    /// Test hook: skip the post-connect server probe so sessions can be created
    /// without a live server.
    probe_server: bool,
}

impl Default for MongoService {
    fn default() -> Self {
        Self::new()
    }
}

impl MongoService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            probe_server: true,
        }
    }

    #[cfg(test)]
    fn offline() -> Self {
        Self {
            sessions: HashMap::new(),
            probe_server: false,
        }
    }

    pub async fn connect(&mut self, config: MongoConnectionConfig) -> Result<String, MongoError> {
        self.connect_with_acknowledgement(config, None).await
    }

    pub async fn connect_with_acknowledgement(
        &mut self,
        mut config: MongoConnectionConfig,
        insecure_tls_acknowledgement: Option<String>,
    ) -> Result<String, MongoError> {
        let session_id = Uuid::new_v4().to_string();
        let label = config
            .label
            .clone()
            .unwrap_or_else(|| format!("mongo-{}", &session_id[..8]));

        if self.sessions.len() >= MAX_SESSIONS {
            scrub_config_secrets(&mut config);
            return Err(MongoError::new(
                MongoErrorKind::InvalidConfig,
                "MongoDB session limit reached; disconnect an existing session first",
            ));
        }

        if config.ssh_tunnel.is_some() {
            scrub_config_secrets(&mut config);
            return Err(MongoError::new(
                MongoErrorKind::InvalidConfig,
                "MongoDB SSH tunnelling is not available; use a direct target",
            ));
        }

        let acknowledgement = insecure_tls_acknowledgement.map(Zeroizing::new);
        let policy_result = validate_and_secure_config(
            &mut config,
            acknowledgement.as_ref().map(|value| value.as_str()),
        );
        drop(acknowledgement);
        let effective_hosts = match policy_result {
            Ok(hosts) => hosts,
            Err(error) => {
                scrub_config_secrets(&mut config);
                return Err(error);
            }
        };

        // Secrets that must never surface in an error message.
        let secrets = collect_secrets(&config);
        let connection_string = Zeroizing::new(config.to_connection_string());
        let options_result = build_client_options(&config, connection_string.as_str()).await;
        scrub_config_secrets(&mut config);
        let options = match options_result {
            Ok(options) => options,
            Err(error) => return Err(redact_error(error, &secrets)),
        };
        drop(connection_string);

        let client = match Client::with_options(options) {
            Ok(client) => client,
            Err(error) => return Err(redact_error(driver_error(&error), &secrets)),
        };

        let server_version = if self.probe_server {
            match probe_server(&client).await {
                Ok(version) => version,
                Err(error) => {
                    client.shutdown().await;
                    return Err(redact_error(error, &secrets));
                }
            }
        } else {
            None
        };
        drop(secrets);

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

        info!("MongoDB connected: {session_id}");
        self.sessions
            .insert(session_id.clone(), MongoSession { client, info });
        Ok(session_id)
    }

    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), MongoError> {
        let session = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| MongoError::session_not_found(session_id))?;
        session.client.shutdown().await;
        info!("MongoDB disconnected: {session_id}");
        Ok(())
    }

    pub async fn disconnect_all(&mut self) {
        for (id, session) in self.sessions.drain() {
            session.client.shutdown().await;
            info!("MongoDB disconnected: {id}");
        }
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions
            .values()
            .map(|session| session.info.clone())
            .collect()
    }

    pub fn get_session(&self, session_id: &str) -> Result<SessionInfo, MongoError> {
        self.sessions
            .get(session_id)
            .map(|session| session.info.clone())
            .ok_or_else(|| MongoError::session_not_found(session_id))
    }

    // ── Admin operations ─────────────────────────────────────────────

    pub async fn ping(&self, session_id: &str) -> Result<bool, MongoError> {
        let client = self.client(session_id)?;
        let reply = run_admin_command(client, doc! { "ping": 1 }).await?;
        Ok(reply_ok(&reply))
    }

    pub async fn list_databases(&self, session_id: &str) -> Result<Vec<DatabaseInfo>, MongoError> {
        let client = self.client(session_id)?;
        let names = client
            .list_database_names()
            .await
            .map_err(|error| driver_error(&error))?;
        Ok(names
            .into_iter()
            .map(|name| DatabaseInfo { name })
            .collect())
    }

    pub async fn drop_database(&self, session_id: &str, db_name: &str) -> Result<(), MongoError> {
        validate_required_field("MongoDB database name", db_name, MAX_FIELD_BYTES)?;
        let client = self.client(session_id)?;
        client
            .database(db_name)
            .drop()
            .await
            .map_err(|error| driver_error(&error))
    }

    pub async fn list_collections(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<Vec<CollectionInfo>, MongoError> {
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let client = self.client(session_id)?;
        let reply = run_db_command(
            client,
            &selected_db,
            doc! { "listCollections": 1, "nameOnly": false },
        )
        .await?;
        let batch = cursor_first_batch(&reply);
        Ok(batch
            .into_iter()
            .map(|entry| CollectionInfo {
                name: entry.get_str("name").unwrap_or_default().to_string(),
                collection_type: entry.get_str("type").unwrap_or("collection").to_string(),
            })
            .collect())
    }

    pub async fn create_collection(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<(), MongoError> {
        validate_required_field("MongoDB collection name", collection_name, MAX_FIELD_BYTES)?;
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let client = self.client(session_id)?;
        client
            .database(&selected_db)
            .create_collection(collection_name)
            .await
            .map_err(|error| driver_error(&error))
    }

    pub async fn drop_collection(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<(), MongoError> {
        validate_required_field("MongoDB collection name", collection_name, MAX_FIELD_BYTES)?;
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let client = self.client(session_id)?;
        client
            .database(&selected_db)
            .collection::<Document>(collection_name)
            .drop()
            .await
            .map_err(|error| driver_error(&error))
    }

    pub async fn collection_stats(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<CollectionStats, MongoError> {
        validate_required_field("MongoDB collection name", collection_name, MAX_FIELD_BYTES)?;
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let client = self.client(session_id)?;
        let stats =
            run_db_command(client, &selected_db, doc! { "collStats": collection_name }).await?;
        Ok(CollectionStats {
            namespace: stats.get_str("ns").unwrap_or_default().to_string(),
            count: bson_i64(stats.get("count")),
            size: bson_i64(stats.get("size")),
            storage_size: bson_i64(stats.get("storageSize")),
            num_indexes: bson_i64(stats.get("nindexes")) as i32,
            total_index_size: bson_i64(stats.get("totalIndexSize")),
            capped: stats.get_bool("capped").unwrap_or(false),
        })
    }

    pub async fn server_status(&self, session_id: &str) -> Result<ServerStatus, MongoError> {
        let client = self.client(session_id)?;
        let status = run_admin_command(client, doc! { "serverStatus": 1 }).await?;
        let connections = status.get_document("connections").ok();
        Ok(ServerStatus {
            host: status.get_str("host").unwrap_or("unknown").to_string(),
            version: status.get_str("version").unwrap_or("unknown").to_string(),
            uptime_secs: bson_f64(status.get("uptime")),
            connections: ConnectionStats {
                current: bson_i64(connections.and_then(|c| c.get("current"))) as i32,
                available: bson_i64(connections.and_then(|c| c.get("available"))) as i32,
                total_created: bson_i64(connections.and_then(|c| c.get("totalCreated"))),
            },
        })
    }

    pub async fn list_users(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<Vec<MongoUserInfo>, MongoError> {
        let selected_db = self.resolve_db_name(session_id, db_name.or(Some("admin")))?;
        let client = self.client(session_id)?;
        let reply = run_db_command(client, &selected_db, doc! { "usersInfo": 1 }).await?;
        let users = reply
            .get_array("users")
            .map(|users| users.to_vec())
            .unwrap_or_default();
        Ok(users
            .iter()
            .filter_map(Bson::as_document)
            .map(|user| MongoUserInfo {
                user: user.get_str("user").unwrap_or_default().to_string(),
                database: user.get_str("db").unwrap_or_default().to_string(),
                roles: user
                    .get_array("roles")
                    .map(|roles| {
                        roles
                            .iter()
                            .filter_map(Bson::as_document)
                            .map(|role| MongoRole {
                                role: role.get_str("role").unwrap_or_default().to_string(),
                                db: role.get_str("db").unwrap_or_default().to_string(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .collect())
    }

    pub async fn replica_set_status(
        &self,
        session_id: &str,
    ) -> Result<Vec<ReplicaSetMember>, MongoError> {
        let client = self.client(session_id)?;
        let reply = run_admin_command(client, doc! { "replSetGetStatus": 1 }).await?;
        let members = reply
            .get_array("members")
            .map(|members| members.to_vec())
            .unwrap_or_default();
        Ok(members
            .iter()
            .filter_map(Bson::as_document)
            .map(|member| ReplicaSetMember {
                name: member.get_str("name").unwrap_or_default().to_string(),
                state_str: member.get_str("stateStr").unwrap_or_default().to_string(),
                state: bson_i64(member.get("state")) as i32,
                health: bson_f64(member.get("health")),
                is_self: member.get_bool("self").ok(),
                uptime: member.get("uptime").map(|value| bson_i64(Some(value))),
            })
            .collect())
    }

    pub async fn current_op(&self, session_id: &str) -> Result<Vec<Value>, MongoError> {
        let client = self.client(session_id)?;
        let cursor = client
            .database("admin")
            .aggregate(vec![doc! { "$currentOp": {} }])
            .await
            .map_err(|error| driver_error(&error))?;
        let docs: Vec<Document> = cursor
            .try_collect()
            .await
            .map_err(|error| driver_error(&error))?;
        Ok(docs.into_iter().map(document_to_json).collect())
    }

    pub async fn kill_op(&self, session_id: &str, op_id: i64) -> Result<(), MongoError> {
        let client = self.client(session_id)?;
        run_admin_command(client, doc! { "killOp": 1, "op": op_id }).await?;
        Ok(())
    }

    // ── Document operations ──────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub async fn find(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        filter: Value,
        projection: Option<Value>,
        sort: Option<Value>,
        limit: Option<i64>,
        skip: Option<u64>,
    ) -> Result<FindResult, MongoError> {
        let collection = self.collection(session_id, db_name, collection_name)?;
        let filter = json_to_document(filter, "filter")?;
        let projection = projection
            .map(|p| json_to_document(p, "projection"))
            .transpose()?;
        let sort = sort.map(|s| json_to_document(s, "sort")).transpose()?;
        let limit = clamp_limit(limit);

        let started = Instant::now();
        let mut find = collection.find(filter).limit(limit + 1);
        if let Some(projection) = projection {
            find = find.projection(projection);
        }
        if let Some(sort) = sort {
            find = find.sort(sort);
        }
        if let Some(skip) = skip {
            find = find.skip(skip);
        }
        let cursor = find.await.map_err(|error| driver_error(&error))?;
        let docs: Vec<Document> = cursor
            .try_collect()
            .await
            .map_err(|error| driver_error(&error))?;
        Ok(page_result(docs, limit, started))
    }

    pub async fn count_documents(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        filter: Value,
    ) -> Result<u64, MongoError> {
        let collection = self.collection(session_id, db_name, collection_name)?;
        let filter = json_to_document(filter, "filter")?;
        collection
            .count_documents(filter)
            .await
            .map_err(|error| driver_error(&error))
    }

    pub async fn estimated_count(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<u64, MongoError> {
        let collection = self.collection(session_id, db_name, collection_name)?;
        collection
            .estimated_document_count()
            .await
            .map_err(|error| driver_error(&error))
    }

    pub async fn aggregate(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        pipeline: Vec<Value>,
        limit: Option<i64>,
    ) -> Result<FindResult, MongoError> {
        let collection = self.collection(session_id, db_name, collection_name)?;
        if pipeline.len() > MAX_PIPELINE_STAGES {
            return Err(invalid_config(format!(
                "MongoDB aggregation pipeline exceeds {MAX_PIPELINE_STAGES} stages"
            )));
        }
        let stages = pipeline
            .into_iter()
            .map(|stage| json_to_document(stage, "pipeline stage"))
            .collect::<Result<Vec<_>, _>>()?;
        let limit = clamp_limit(limit);

        let started = Instant::now();
        let mut cursor = collection
            .aggregate(stages)
            .await
            .map_err(|error| driver_error(&error))?;
        let mut docs = Vec::new();
        while docs.len() <= limit as usize {
            match cursor.try_next().await {
                Ok(Some(doc)) => docs.push(doc),
                Ok(None) => break,
                Err(error) => return Err(driver_error(&error)),
            }
        }
        Ok(page_result(docs, limit, started))
    }

    pub async fn insert_documents(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        documents: Vec<Value>,
    ) -> Result<InsertResult, MongoError> {
        let collection = self.collection(session_id, db_name, collection_name)?;
        if documents.is_empty() {
            return Err(invalid_config(
                "MongoDB insert requires at least one document",
            ));
        }
        if documents.len() > MAX_INSERT_DOCUMENTS {
            return Err(invalid_config(format!(
                "MongoDB insert exceeds {MAX_INSERT_DOCUMENTS} documents"
            )));
        }
        let docs = documents
            .into_iter()
            .map(|document| json_to_document(document, "document"))
            .collect::<Result<Vec<_>, _>>()?;
        let result = collection
            .insert_many(docs)
            .await
            .map_err(|error| driver_error(&error))?;
        let mut ids: Vec<(usize, Bson)> = result.inserted_ids.into_iter().collect();
        ids.sort_by_key(|(index, _)| *index);
        Ok(InsertResult {
            inserted_count: ids.len(),
            inserted_ids: ids
                .into_iter()
                .map(|(_, id)| id.into_relaxed_extjson())
                .collect(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn update_documents(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        filter: Value,
        update: Value,
        multi: bool,
        upsert: bool,
    ) -> Result<UpdateResult, MongoError> {
        let collection = self.collection(session_id, db_name, collection_name)?;
        let filter = json_to_document(filter, "filter")?;
        let modifications = json_to_update(update)?;
        let result = if multi {
            collection
                .update_many(filter, modifications)
                .upsert(upsert)
                .await
        } else {
            collection
                .update_one(filter, modifications)
                .upsert(upsert)
                .await
        }
        .map_err(|error| driver_error(&error))?;
        Ok(UpdateResult {
            matched_count: result.matched_count,
            modified_count: result.modified_count,
            upserted_id: result.upserted_id.map(Bson::into_relaxed_extjson),
        })
    }

    pub async fn delete_documents(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        filter: Value,
        multi: bool,
    ) -> Result<DeleteResult, MongoError> {
        let collection = self.collection(session_id, db_name, collection_name)?;
        let filter = json_to_document(filter, "filter")?;
        let result = if multi {
            collection.delete_many(filter).await
        } else {
            collection.delete_one(filter).await
        }
        .map_err(|error| driver_error(&error))?;
        Ok(DeleteResult {
            deleted_count: result.deleted_count,
        })
    }

    // ── Index operations ─────────────────────────────────────────────

    pub async fn list_indexes(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<Vec<IndexInfo>, MongoError> {
        validate_required_field("MongoDB collection name", collection_name, MAX_FIELD_BYTES)?;
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let client = self.client(session_id)?;
        let reply = run_db_command(
            client,
            &selected_db,
            doc! { "listIndexes": collection_name },
        )
        .await?;
        Ok(cursor_first_batch(&reply)
            .into_iter()
            .map(index_info_from_spec)
            .collect())
    }

    pub async fn create_index(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        keys: Value,
        options: Option<Value>,
    ) -> Result<String, MongoError> {
        let collection = self.collection(session_id, db_name, collection_name)?;
        let keys = json_to_document(keys, "index keys")?;
        if keys.is_empty() {
            return Err(invalid_config("MongoDB index keys must not be empty"));
        }
        let options = options.map(json_to_index_options).transpose()?;
        let model = IndexModel::builder().keys(keys).options(options).build();
        let result = collection
            .create_index(model)
            .await
            .map_err(|error| driver_error(&error))?;
        Ok(result.index_name)
    }

    pub async fn drop_index(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
        index_name: &str,
    ) -> Result<(), MongoError> {
        validate_required_field("MongoDB index name", index_name, MAX_FIELD_BYTES)?;
        if index_name == "_id_" {
            return Err(invalid_config("The _id index cannot be dropped"));
        }
        let collection = self.collection(session_id, db_name, collection_name)?;
        collection
            .drop_index(index_name)
            .await
            .map_err(|error| driver_error(&error))
    }

    // ── Internals ────────────────────────────────────────────────────

    fn client(&self, session_id: &str) -> Result<&Client, MongoError> {
        validate_required_field("MongoDB session ID", session_id, MAX_SESSION_ID_BYTES)?;
        self.sessions
            .get(session_id)
            .map(|session| &session.client)
            .ok_or_else(|| MongoError::session_not_found(session_id))
    }

    fn resolve_db_name(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<String, MongoError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| MongoError::session_not_found(session_id))?;
        let name = db_name
            .or(session.info.database.as_deref())
            .map(ToOwned::to_owned)
            .ok_or_else(|| invalid_config("No database specified"))?;
        validate_required_field("MongoDB database name", &name, MAX_FIELD_BYTES)?;
        Ok(name)
    }

    fn collection(
        &self,
        session_id: &str,
        db_name: Option<&str>,
        collection_name: &str,
    ) -> Result<mongodb::Collection<Document>, MongoError> {
        validate_required_field("MongoDB collection name", collection_name, MAX_FIELD_BYTES)?;
        let selected_db = self.resolve_db_name(session_id, db_name)?;
        let client = self.client(session_id)?;
        Ok(client
            .database(&selected_db)
            .collection::<Document>(collection_name))
    }
}

// ── Driver plumbing ──────────────────────────────────────────────────

/// Builds driver options from the validated config. The URI carries hosts,
/// credentials, auth source/mechanism, replica set, read preference, direct
/// connection, app name, and timeouts; structured TLS settings (CA / client
/// certificate paths) are applied on top because they cannot be expressed as
/// URI options safely.
async fn build_client_options(
    config: &MongoConnectionConfig,
    connection_string: &str,
) -> Result<ClientOptions, MongoError> {
    let mut options = ClientOptions::parse(connection_string)
        .await
        .map_err(|error| driver_error(&error))?;

    if options.app_name.is_none() {
        options.app_name = Some(DEFAULT_APP_NAME.to_string());
    }
    if options.connect_timeout.is_none() {
        options.connect_timeout = Some(DEFAULT_CONNECT_TIMEOUT);
    }
    if options.server_selection_timeout.is_none() {
        options.server_selection_timeout = Some(DEFAULT_SERVER_SELECTION_TIMEOUT);
    }

    if config.connection_string.is_none() {
        if let Some(tls) = config.tls.as_ref() {
            options.tls = Some(tls_from_config(tls)?);
        }
    }

    Ok(options)
}

fn tls_from_config(tls: &TlsConfig) -> Result<Tls, MongoError> {
    if !tls.enabled {
        return Ok(Tls::Disabled);
    }
    let cert_key_file_path = match (
        tls.client_cert_path.as_deref(),
        tls.client_key_path.as_deref(),
    ) {
        (Some(cert), Some(key)) if cert != key => {
            return Err(invalid_config(
                "MongoDB client certificate and key must be supplied as one combined PEM file",
            ))
        }
        (Some(cert), _) => Some(PathBuf::from(cert)),
        (None, Some(key)) => Some(PathBuf::from(key)),
        (None, None) => None,
    };
    let mut tls_options = TlsOptions::builder()
        .allow_invalid_certificates(tls.allow_invalid_certificates)
        .build();
    tls_options.ca_file_path = tls.ca_cert_path.as_deref().map(PathBuf::from);
    tls_options.cert_key_file_path = cert_key_file_path;
    Ok(Tls::Enabled(tls_options))
}

async fn probe_server(client: &Client) -> Result<Option<String>, MongoError> {
    let ping = run_admin_command(client, doc! { "ping": 1 }).await?;
    if !reply_ok(&ping) {
        return Err(MongoError::connection_failed("MongoDB ping failed"));
    }
    let build_info = run_admin_command(client, doc! { "buildInfo": 1 }).await?;
    Ok(build_info.get_str("version").ok().map(ToOwned::to_owned))
}

async fn run_admin_command(client: &Client, command: Document) -> Result<Document, MongoError> {
    run_db_command(client, "admin", command).await
}

async fn run_db_command(
    client: &Client,
    db_name: &str,
    command: Document,
) -> Result<Document, MongoError> {
    client
        .database(db_name)
        .run_command(command)
        .await
        .map_err(|error| driver_error(&error))
}

fn reply_ok(reply: &Document) -> bool {
    bson_f64(reply.get("ok")) == 1.0
}

fn cursor_first_batch(reply: &Document) -> Vec<Document> {
    reply
        .get_document("cursor")
        .ok()
        .and_then(|cursor| cursor.get_array("firstBatch").ok())
        .map(|batch| {
            batch
                .iter()
                .filter_map(Bson::as_document)
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

fn page_result(mut docs: Vec<Document>, limit: i64, started: Instant) -> FindResult {
    let has_more = docs.len() > limit as usize;
    docs.truncate(limit as usize);
    let documents: Vec<Value> = docs.into_iter().map(document_to_json).collect();
    FindResult {
        returned: documents.len(),
        documents,
        has_more,
        elapsed_ms: started.elapsed().as_millis() as u64,
    }
}

// ── JSON ⇄ BSON ──────────────────────────────────────────────────────

/// Converts caller JSON (plain or extended JSON: `$oid`, `$date`,
/// `$numberLong`, …) into a BSON document. User input is never interpolated
/// into a string; it is converted structurally.
pub fn json_to_document(value: Value, what: &str) -> Result<Document, MongoError> {
    match Bson::try_from(value) {
        Ok(Bson::Document(document)) => Ok(document),
        Ok(_) => Err(invalid_config(format!(
            "MongoDB {what} must be a JSON object"
        ))),
        Err(_) => Err(invalid_config(format!(
            "MongoDB {what} is not valid extended JSON"
        ))),
    }
}

fn json_to_update(value: Value) -> Result<UpdateModifications, MongoError> {
    match value {
        Value::Array(stages) => {
            if stages.is_empty() {
                return Err(invalid_config("MongoDB update pipeline must not be empty"));
            }
            let stages = stages
                .into_iter()
                .map(|stage| json_to_document(stage, "update stage"))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(UpdateModifications::Pipeline(stages))
        }
        other => {
            let document = json_to_document(other, "update")?;
            if document.is_empty() {
                return Err(invalid_config("MongoDB update document must not be empty"));
            }
            if !document.keys().all(|key| key.starts_with('$')) {
                return Err(invalid_config(
                    "MongoDB update documents must use update operators such as $set",
                ));
            }
            Ok(UpdateModifications::Document(document))
        }
    }
}

fn json_to_index_options(value: Value) -> Result<IndexOptions, MongoError> {
    let document = json_to_document(value, "index options")?;
    let mut options = IndexOptions::default();
    for (key, value) in document {
        match key.as_str() {
            "name" => {
                let name = value
                    .as_str()
                    .ok_or_else(|| invalid_config("MongoDB index name must be a string"))?;
                validate_required_field("MongoDB index name", name, MAX_FIELD_BYTES)?;
                options.name = Some(name.to_string());
            }
            "unique" => options.unique = value.as_bool(),
            "sparse" => options.sparse = value.as_bool(),
            "hidden" => options.hidden = value.as_bool(),
            "background" => options.background = value.as_bool(),
            "expireAfterSeconds" => {
                let seconds = bson_i64(Some(&value));
                if seconds < 0 {
                    return Err(invalid_config("MongoDB expireAfterSeconds must be >= 0"));
                }
                options.expire_after = Some(Duration::from_secs(seconds as u64));
            }
            "partialFilterExpression" => {
                options.partial_filter_expression = value.as_document().cloned();
            }
            other => {
                return Err(invalid_config(format!(
                    "MongoDB index option '{other}' is not supported"
                )))
            }
        }
    }
    Ok(options)
}

fn index_info_from_spec(spec: Document) -> IndexInfo {
    let keys = spec
        .get_document("key")
        .cloned()
        .map(document_to_json)
        .unwrap_or(Value::Object(Default::default()));
    IndexInfo {
        name: spec.get_str("name").unwrap_or_default().to_string(),
        keys,
        unique: spec.get_bool("unique").unwrap_or(false),
        sparse: spec.get_bool("sparse").unwrap_or(false),
        options: document_to_json(spec),
    }
}

pub fn document_to_json(document: Document) -> Value {
    Bson::Document(document).into_relaxed_extjson()
}

pub fn clamp_limit(limit: Option<i64>) -> i64 {
    limit
        .unwrap_or(DEFAULT_DOCUMENT_LIMIT)
        .clamp(1, MAX_DOCUMENT_LIMIT)
}

fn bson_i64(value: Option<&Bson>) -> i64 {
    match value {
        Some(Bson::Int32(v)) => i64::from(*v),
        Some(Bson::Int64(v)) => *v,
        Some(Bson::Double(v)) => *v as i64,
        _ => 0,
    }
}

fn bson_f64(value: Option<&Bson>) -> f64 {
    match value {
        Some(Bson::Int32(v)) => f64::from(*v),
        Some(Bson::Int64(v)) => *v as f64,
        Some(Bson::Double(v)) => *v,
        _ => 0.0,
    }
}

// ── Errors ───────────────────────────────────────────────────────────

/// Maps a driver error to a `MongoError` that never contains the connection
/// URI or credentials. Server-side command messages are preserved because they
/// are the only actionable detail (e.g. "not authorized on testdb").
fn driver_error(error: &DriverError) -> MongoError {
    match &*error.kind {
        ErrorKind::Authentication { .. } => MongoError::new(
            MongoErrorKind::ConnectionFailed,
            "MongoDB authentication failed; check the username, password, and authentication database",
        ),
        ErrorKind::ServerSelection { .. } => MongoError::new(
            MongoErrorKind::ConnectionFailed,
            "MongoDB server is unreachable (server selection timed out)",
        ),
        ErrorKind::DnsResolve { .. } => MongoError::new(
            MongoErrorKind::ConnectionFailed,
            "MongoDB host name could not be resolved",
        ),
        ErrorKind::Io(_) => MongoError::new(
            MongoErrorKind::ConnectionFailed,
            "MongoDB connection I/O error",
        ),
        ErrorKind::InvalidTlsConfig { .. } => MongoError::new(
            MongoErrorKind::InvalidConfig,
            "MongoDB TLS configuration is invalid (check certificate paths)",
        ),
        ErrorKind::InvalidArgument { .. } => MongoError::new(
            MongoErrorKind::InvalidConfig,
            "MongoDB rejected the connection configuration",
        ),
        ErrorKind::Command(command) => MongoError::new(
            MongoErrorKind::CommandError,
            format!(
                "MongoDB command failed ({}): {}",
                command.code_name, command.message
            ),
        ),
        ErrorKind::Write(WriteFailure::WriteError(write)) => MongoError::new(
            MongoErrorKind::DatabaseError,
            format!("MongoDB write failed: {}", write.message),
        ),
        ErrorKind::Write(WriteFailure::WriteConcernError(concern)) => MongoError::new(
            MongoErrorKind::DatabaseError,
            format!("MongoDB write concern error: {}", concern.message),
        ),
        ErrorKind::InsertMany(insert) => {
            let detail = insert
                .write_errors
                .as_ref()
                .and_then(|errors| errors.first())
                .map(|first| first.message.clone())
                .or_else(|| {
                    insert
                        .write_concern_error
                        .as_ref()
                        .map(|concern| concern.message.clone())
                })
                .unwrap_or_else(|| "one or more documents were rejected".to_string());
            MongoError::new(
                MongoErrorKind::DatabaseError,
                format!("MongoDB insert failed: {detail}"),
            )
        }
        ErrorKind::BsonDeserialization(_)
        | ErrorKind::BsonSerialization(_)
        | ErrorKind::Bson(_)
        | ErrorKind::InvalidResponse { .. } => MongoError::new(
            MongoErrorKind::SerializationError,
            "MongoDB returned data that could not be decoded",
        ),
        _ => MongoError::new(
            MongoErrorKind::DatabaseError,
            "MongoDB operation failed",
        ),
    }
}

fn collect_secrets(config: &MongoConnectionConfig) -> Vec<Zeroizing<String>> {
    let mut secrets = Vec::new();
    if let Some(password) = config.password.as_deref() {
        if !password.is_empty() {
            secrets.push(Zeroizing::new(password.to_string()));
            secrets.push(Zeroizing::new(urlencoded(password)));
        }
    }
    if let Some(uri) = config.connection_string.as_deref() {
        if let Some(password) = uri_password(uri) {
            if !password.is_empty() {
                secrets.push(Zeroizing::new(password.to_string()));
            }
        }
    }
    secrets
}

/// Extracts the password component of `scheme://user:password@hosts/...`.
fn uri_password(uri: &str) -> Option<&str> {
    let remainder = uri.split_once("://")?.1;
    let authority = remainder.split(['/', '?']).next()?;
    let (userinfo, _) = authority.rsplit_once('@')?;
    userinfo.split_once(':').map(|(_, password)| password)
}

fn redact_error(mut error: MongoError, secrets: &[Zeroizing<String>]) -> MongoError {
    error.message = redact_secrets(&error.message, secrets);
    error.details = error
        .details
        .as_deref()
        .map(|details| redact_secrets(details, secrets));
    error
}

fn redact_secrets(message: &str, secrets: &[Zeroizing<String>]) -> String {
    let mut redacted = message.to_string();
    for secret in secrets {
        if !secret.is_empty() {
            redacted = redacted.replace(secret.as_str(), "***");
        }
    }
    redacted
}

// ── Config validation & transport policy (unchanged semantics) ───────

struct ParsedMongoUri {
    hosts: Vec<String>,
    has_credentials: bool,
    all_hosts_are_literal_loopback: bool,
    tls_enabled: bool,
    allows_invalid_certificates: bool,
}

fn validate_and_secure_config(
    config: &mut MongoConnectionConfig,
    insecure_tls_acknowledgement: Option<&str>,
) -> Result<Vec<String>, MongoError> {
    validate_optional_field("label", config.label.as_deref(), MAX_FIELD_BYTES)?;
    validate_optional_field("database", config.database.as_deref(), MAX_FIELD_BYTES)?;
    validate_optional_field("username", config.username.as_deref(), MAX_FIELD_BYTES)?;
    validate_optional_field("password", config.password.as_deref(), MAX_FIELD_BYTES)?;
    validate_optional_field(
        "authentication database",
        config.auth_database.as_deref(),
        MAX_FIELD_BYTES,
    )?;
    validate_optional_field(
        "replica set",
        config.replica_set.as_deref(),
        MAX_FIELD_BYTES,
    )?;
    validate_optional_field(
        "read preference",
        config.read_preference.as_deref(),
        MAX_FIELD_BYTES,
    )?;
    validate_optional_field(
        "application name",
        config.app_name.as_deref(),
        MAX_FIELD_BYTES,
    )?;
    validate_timeout(config.connect_timeout_secs)?;
    validate_timeout(config.server_selection_timeout_secs)?;

    if let Some(uri) = config.connection_string.as_deref() {
        if config.username.is_some() || config.password.is_some() || config.tls.is_some() {
            return Err(invalid_config(
                "Raw MongoDB URIs must contain their own authentication and TLS settings",
            ));
        }
        let parsed = parse_mongo_uri(uri)?;
        enforce_transport_policy(&parsed, insecure_tls_acknowledgement)?;
        return Ok(parsed.hosts);
    }

    if config.hosts.is_empty() {
        config.hosts.push("127.0.0.1:27017".to_string());
    }
    if config.hosts.len() > MAX_HOSTS {
        return Err(invalid_config(
            "MongoDB host count exceeds the safety limit",
        ));
    }

    let mut all_hosts_are_literal_loopback = true;
    for host in &config.hosts {
        let parsed = parse_host(host, false)?;
        all_hosts_are_literal_loopback &= parsed.literal_loopback;
    }

    if let Some(tls) = config.tls.as_ref() {
        validate_optional_field("TLS CA path", tls.ca_cert_path.as_deref(), MAX_PATH_BYTES)?;
        validate_optional_field(
            "TLS client certificate path",
            tls.client_cert_path.as_deref(),
            MAX_PATH_BYTES,
        )?;
        validate_optional_field(
            "TLS client key path",
            tls.client_key_path.as_deref(),
            MAX_PATH_BYTES,
        )?;
    } else if !all_hosts_are_literal_loopback {
        config.tls = Some(TlsConfig::default());
    }

    let has_credentials = config.username.is_some()
        || config.password.is_some()
        || matches!(
            config.auth_mechanism.as_ref(),
            Some(MongoAuthMechanism::X509 | MongoAuthMechanism::AwsIam)
        );
    let tls_enabled = config.tls.as_ref().is_some_and(|tls| tls.enabled);
    let allows_invalid_certificates = config
        .tls
        .as_ref()
        .is_some_and(|tls| tls.allow_invalid_certificates);
    let policy = ParsedMongoUri {
        hosts: config.hosts.clone(),
        has_credentials,
        all_hosts_are_literal_loopback,
        tls_enabled,
        allows_invalid_certificates,
    };
    enforce_transport_policy(&policy, insecure_tls_acknowledgement)?;

    let generated_uri = Zeroizing::new(config.to_connection_string());
    validate_uri_bytes(generated_uri.as_str())?;
    Ok(policy.hosts)
}

fn enforce_transport_policy(
    policy: &ParsedMongoUri,
    insecure_tls_acknowledgement: Option<&str>,
) -> Result<(), MongoError> {
    if policy.allows_invalid_certificates {
        if !policy.tls_enabled {
            return Err(invalid_config(
                "MongoDB invalid-certificate mode requires TLS to be enabled",
            ));
        }
        if insecure_tls_acknowledgement != Some(INVALID_CERTIFICATE_ACKNOWLEDGEMENT) {
            return Err(invalid_config(
                "MongoDB invalid-certificate mode requires the exact one-time acknowledgement",
            ));
        }
    }

    if policy.has_credentials
        && !policy.all_hosts_are_literal_loopback
        && (!policy.tls_enabled || policy.allows_invalid_certificates)
    {
        return Err(invalid_config(
            "Credentialed remote MongoDB connections require certificate-verified TLS",
        ));
    }
    Ok(())
}

fn parse_mongo_uri(uri: &str) -> Result<ParsedMongoUri, MongoError> {
    validate_uri_bytes(uri)?;
    if uri.trim() != uri || uri.contains('#') {
        return Err(invalid_uri());
    }

    let (srv, remainder) = if let Some(remainder) = uri.strip_prefix("mongodb://") {
        (false, remainder)
    } else if let Some(remainder) = uri.strip_prefix("mongodb+srv://") {
        (true, remainder)
    } else {
        return Err(invalid_uri());
    };

    let (location, query) = remainder
        .split_once('?')
        .map_or((remainder, None), |(location, query)| {
            (location, Some(query))
        });
    let (authority, path) = location
        .split_once('/')
        .map_or((location, ""), |(authority, path)| (authority, path));
    validate_required_field("MongoDB URI authority", authority, MAX_CONNECTION_URI_BYTES)?;
    validate_optional_field("MongoDB URI database", Some(path), MAX_FIELD_BYTES)?;

    let (userinfo, host_list) = authority
        .rsplit_once('@')
        .map_or((None, authority), |(userinfo, hosts)| {
            (Some(userinfo), hosts)
        });
    if let Some(userinfo) = userinfo {
        if userinfo.is_empty() || userinfo.contains('@') || userinfo.len() > MAX_FIELD_BYTES * 2 {
            return Err(invalid_uri());
        }
    }

    let host_values = host_list.split(',').collect::<Vec<_>>();
    if host_values.is_empty() || host_values.len() > MAX_HOSTS {
        return Err(invalid_uri());
    }
    if srv && host_values.len() != 1 {
        return Err(invalid_config(
            "MongoDB SRV URIs require exactly one hostname",
        ));
    }

    let mut hosts = Vec::with_capacity(host_values.len());
    let mut all_hosts_are_literal_loopback = true;
    for host in host_values {
        let parsed = parse_host(host, srv)?;
        all_hosts_are_literal_loopback &= parsed.literal_loopback;
        hosts.push(host.to_string());
    }

    let mut tls_enabled = srv;
    let mut tls_seen = false;
    let mut invalid_seen = false;
    let mut allows_invalid_certificates = false;
    let mut mechanism_has_credentials = false;
    if let Some(query) = query {
        validate_optional_field("MongoDB URI options", Some(query), MAX_CONNECTION_URI_BYTES)?;
        for option in query.split('&') {
            if option.is_empty() {
                return Err(invalid_uri());
            }
            let (name, value) = option.split_once('=').unwrap_or((option, ""));
            validate_required_field("MongoDB URI option", name, MAX_FIELD_BYTES)?;
            validate_optional_field("MongoDB URI option value", Some(value), MAX_FIELD_BYTES)?;
            if name.eq_ignore_ascii_case("tls") || name.eq_ignore_ascii_case("ssl") {
                if tls_seen {
                    return Err(invalid_config("MongoDB URI contains ambiguous TLS options"));
                }
                tls_enabled = parse_bool_option(value)?;
                tls_seen = true;
            } else if name.eq_ignore_ascii_case("tlsAllowInvalidCertificates")
                || name.eq_ignore_ascii_case("tlsAllowInvalidHostnames")
                || name.eq_ignore_ascii_case("tlsInsecure")
            {
                if invalid_seen {
                    return Err(invalid_config(
                        "MongoDB URI contains ambiguous certificate-verification options",
                    ));
                }
                allows_invalid_certificates = parse_bool_option(value)?;
                invalid_seen = true;
            } else if name.eq_ignore_ascii_case("authMechanism") {
                mechanism_has_credentials =
                    !value.eq_ignore_ascii_case("none") && !value.is_empty();
            }
        }
    }

    Ok(ParsedMongoUri {
        hosts,
        has_credentials: userinfo.is_some() || mechanism_has_credentials,
        all_hosts_are_literal_loopback,
        tls_enabled,
        allows_invalid_certificates,
    })
}

struct ParsedHost {
    literal_loopback: bool,
}

fn parse_host(value: &str, srv: bool) -> Result<ParsedHost, MongoError> {
    validate_required_field("MongoDB host", value, MAX_HOST_BYTES)?;
    if value.chars().any(|character| character.is_whitespace()) {
        return Err(invalid_uri());
    }

    let (hostname, has_port) = if let Some(bracketed) = value.strip_prefix('[') {
        let (hostname, suffix) = bracketed.split_once(']').ok_or_else(invalid_uri)?;
        if suffix.is_empty() {
            (hostname, false)
        } else if let Some(port) = suffix.strip_prefix(':') {
            validate_port(port)?;
            (hostname, true)
        } else {
            return Err(invalid_uri());
        }
    } else {
        let colon_count = value.bytes().filter(|byte| *byte == b':').count();
        if colon_count > 1 {
            return Err(invalid_uri());
        }
        if let Some((hostname, port)) = value.rsplit_once(':') {
            validate_port(port)?;
            (hostname, true)
        } else {
            (value, false)
        }
    };

    if hostname.is_empty() {
        return Err(invalid_uri());
    }
    if hostname.contains(':') {
        if std::net::IpAddr::from_str(hostname).is_err() {
            return Err(invalid_uri());
        }
    } else if !hostname
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(invalid_uri());
    }
    if srv && has_port {
        return Err(invalid_config("MongoDB SRV URIs cannot specify a port"));
    }

    let literal_loopback = std::net::IpAddr::from_str(hostname)
        .map(|address| address.is_loopback())
        .unwrap_or(false);
    Ok(ParsedHost { literal_loopback })
}

fn validate_port(value: &str) -> Result<(), MongoError> {
    match value.parse::<u16>() {
        Ok(1..=u16::MAX) => Ok(()),
        _ => Err(invalid_uri()),
    }
}

fn parse_bool_option(value: &str) -> Result<bool, MongoError> {
    if value.eq_ignore_ascii_case("true") || value == "1" {
        Ok(true)
    } else if value.eq_ignore_ascii_case("false") || value == "0" {
        Ok(false)
    } else {
        Err(invalid_config(
            "MongoDB URI contains an invalid security option",
        ))
    }
}

fn validate_timeout(value: Option<u64>) -> Result<(), MongoError> {
    if value.is_some_and(|seconds| seconds == 0 || seconds > MAX_TIMEOUT_SECS) {
        return Err(invalid_config(
            "MongoDB timeout must be between 1 and 300 seconds",
        ));
    }
    Ok(())
}

fn validate_uri_bytes(connection_string: &str) -> Result<(), MongoError> {
    if connection_string.is_empty()
        || connection_string.len() > MAX_CONNECTION_URI_BYTES
        || connection_string
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        return Err(invalid_config(
            "MongoDB connection URI is invalid or exceeds the safety limit",
        ));
    }
    Ok(())
}

fn validate_optional_field(
    name: &str,
    value: Option<&str>,
    max_bytes: usize,
) -> Result<(), MongoError> {
    if let Some(value) = value {
        if value.len() > max_bytes
            || value
                .chars()
                .any(|character| matches!(character, '\0' | '\r' | '\n'))
        {
            return Err(invalid_config(format!(
                "{name} is invalid or exceeds the safety limit"
            )));
        }
    }
    Ok(())
}

fn validate_required_field(name: &str, value: &str, max_bytes: usize) -> Result<(), MongoError> {
    validate_optional_field(name, Some(value), max_bytes)?;
    if value.is_empty() {
        return Err(invalid_config(format!("{name} is required")));
    }
    Ok(())
}

fn invalid_uri() -> MongoError {
    invalid_config("MongoDB connection URI is invalid")
}

fn invalid_config(message: impl Into<String>) -> MongoError {
    MongoError::new(MongoErrorKind::InvalidConfig, message)
}

fn scrub_config_secrets(config: &mut MongoConnectionConfig) {
    if let Some(password) = config.password.as_mut() {
        password.zeroize();
    }
    config.password = None;

    if let Some(connection_string) = config.connection_string.as_mut() {
        connection_string.zeroize();
    }
    config.connection_string = None;

    if let Some(tunnel) = config.ssh_tunnel.as_mut() {
        if let Some(password) = tunnel.password.as_mut() {
            password.zeroize();
        }
        tunnel.password = None;
        if let Some(passphrase) = tunnel.passphrase.as_mut() {
            passphrase.zeroize();
        }
        tunnel.passphrase = None;
    }
}

fn urlencoded(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(byte));
        } else {
            use std::fmt::Write;
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::options::{ConnectionString, HostInfo, ReadPreference, SelectionCriteria};
    use serde_json::json;

    fn config_with_uri(uri: &str) -> MongoConnectionConfig {
        MongoConnectionConfig {
            label: Some("test".into()),
            hosts: vec!["ignored:27017".into()],
            database: Some("admin".into()),
            username: None,
            password: None,
            auth_database: None,
            auth_mechanism: None,
            replica_set: None,
            read_preference: None,
            direct_connection: None,
            app_name: None,
            connection_string: Some(uri.into()),
            connect_timeout_secs: None,
            server_selection_timeout_secs: None,
            ssh_tunnel: None,
            tls: None,
        }
    }

    fn structured_config() -> MongoConnectionConfig {
        MongoConnectionConfig {
            label: Some("structured".into()),
            hosts: vec![
                "db1.example.com:27017".into(),
                "db2.example.com:27018".into(),
            ],
            database: Some("app".into()),
            username: Some("admin".into()),
            password: Some("p@ss:word".into()),
            auth_database: Some("authdb".into()),
            auth_mechanism: Some(MongoAuthMechanism::ScramSha256),
            replica_set: Some("rs0".into()),
            read_preference: Some("secondaryPreferred".into()),
            direct_connection: None,
            app_name: Some("custom-app".into()),
            connection_string: None,
            connect_timeout_secs: Some(7),
            server_selection_timeout_secs: Some(9),
            ssh_tunnel: None,
            tls: Some(TlsConfig {
                enabled: true,
                ca_cert_path: Some("/certs/ca.pem".into()),
                client_cert_path: Some("/certs/client.pem".into()),
                client_key_path: None,
                allow_invalid_certificates: false,
            }),
        }
    }

    // ── Session lifecycle ────────────────────────────────────────────

    #[test]
    fn test_new_service() {
        let svc = MongoService::new();
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn test_session_not_found() {
        let svc = MongoService::new();
        assert!(svc.get_session("nonexistent").is_err());
    }

    #[tokio::test]
    async fn test_disconnect_nonexistent() {
        let mut svc = MongoService::new();
        assert!(svc.disconnect("no-such").await.is_err());
    }

    #[tokio::test]
    async fn test_ping_nonexistent() {
        let svc = MongoService::new();
        let error = svc.ping("no-such").await.unwrap_err();
        assert_eq!(error.kind, MongoErrorKind::SessionNotFound);
    }

    #[tokio::test]
    async fn document_operations_require_an_existing_session() {
        let svc = MongoService::new();
        let error = svc
            .find(
                "missing",
                Some("db"),
                "coll",
                json!({}),
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap_err();
        assert_eq!(error.kind, MongoErrorKind::SessionNotFound);
        let error = svc
            .list_indexes("missing", Some("db"), "coll")
            .await
            .unwrap_err();
        assert_eq!(error.kind, MongoErrorKind::SessionNotFound);
    }

    #[tokio::test]
    async fn ssh_tunnel_is_refused_before_any_connection_attempt() {
        let mut svc = MongoService::offline();
        let mut config = config_with_uri("mongodb://127.0.0.1/dev");
        config.ssh_tunnel = Some(SshTunnelConfig {
            host: "bastion".into(),
            port: 22,
            username: "u".into(),
            password: Some("tunnel-secret".into()),
            private_key_path: None,
            passphrase: None,
        });
        let error = svc.connect(config).await.unwrap_err();
        assert_eq!(error.kind, MongoErrorKind::InvalidConfig);
        assert!(error.message.contains("SSH"));
        assert!(!error.message.contains("tunnel-secret"));
        assert!(svc.list_sessions().is_empty());
    }

    #[tokio::test]
    async fn session_cap_is_enforced() {
        let mut service = MongoService::offline();
        for _ in 0..MAX_SESSIONS {
            service
                .connect(config_with_uri("mongodb://127.0.0.1/dev"))
                .await
                .unwrap();
        }
        assert_eq!(service.list_sessions().len(), MAX_SESSIONS);

        let error = service
            .connect(config_with_uri("mongodb://127.0.0.1/dev"))
            .await
            .unwrap_err();
        assert_eq!(error.kind, MongoErrorKind::InvalidConfig);
        assert!(error.message.contains("session limit"));
        service.disconnect_all().await;
        assert!(service.list_sessions().is_empty());
    }

    #[tokio::test]
    async fn session_info_reflects_config_and_disconnect_removes_it() {
        let mut service = MongoService::offline();
        let session_id = service
            .connect(config_with_uri("mongodb://admin:secret@127.0.0.1/admin"))
            .await
            .unwrap();
        let info = service.get_session(&session_id).unwrap();
        assert_eq!(info.hosts, vec!["127.0.0.1"]);
        assert_eq!(info.database.as_deref(), Some("admin"));
        assert_eq!(info.status, ConnectionStatus::Connected);
        assert!(info.server_version.is_none());
        let serialized = serde_json::to_string(&info).unwrap();
        assert!(!serialized.contains("secret"));

        service.disconnect(&session_id).await.unwrap();
        assert!(service.get_session(&session_id).is_err());
        assert!(service.client(&session_id).is_err());
    }

    #[tokio::test]
    async fn connect_failure_never_echoes_the_password() {
        // Loopback + credentials passes policy; the probe fails because
        // nothing listens on this port.
        let mut service = MongoService::new();
        let mut config = config_with_uri("mongodb://127.0.0.1:1/dev");
        config.connection_string = None;
        config.hosts = vec!["127.0.0.1:1".into()];
        config.username = Some("admin".into());
        config.password = Some("hunter2-very-secret".into());
        config.server_selection_timeout_secs = Some(1);
        config.connect_timeout_secs = Some(1);
        let error = service.connect(config).await.unwrap_err();
        assert_eq!(error.kind, MongoErrorKind::ConnectionFailed);
        assert!(!error.message.contains("hunter2"));
        assert!(!error.message.contains("mongodb://"));
        assert!(service.list_sessions().is_empty());
    }

    // ── ClientOptions mapping ────────────────────────────────────────

    #[tokio::test]
    async fn client_options_map_structured_config() {
        let mut config = structured_config();
        let hosts = validate_and_secure_config(&mut config, None).unwrap();
        assert_eq!(hosts.len(), 2);
        let uri = config.to_connection_string();
        let options = build_client_options(&config, &uri).await.unwrap();

        assert_eq!(options.hosts.len(), 2);
        assert_eq!(options.hosts[0].to_string(), "db1.example.com:27017");
        assert_eq!(options.hosts[1].to_string(), "db2.example.com:27018");
        assert_eq!(options.app_name.as_deref(), Some("custom-app"));
        assert_eq!(options.repl_set_name.as_deref(), Some("rs0"));
        assert_eq!(options.connect_timeout, Some(Duration::from_secs(7)));
        assert_eq!(
            options.server_selection_timeout,
            Some(Duration::from_secs(9))
        );
        assert_eq!(options.default_database.as_deref(), Some("app"));
        assert!(matches!(
            options.selection_criteria,
            Some(SelectionCriteria::ReadPreference(
                ReadPreference::SecondaryPreferred { .. }
            ))
        ));

        let credential = options.credential.expect("credential from userinfo");
        assert_eq!(credential.username.as_deref(), Some("admin"));
        assert_eq!(credential.password.as_deref(), Some("p@ss:word"));
        assert_eq!(credential.source.as_deref(), Some("authdb"));
        assert!(matches!(
            credential.mechanism,
            Some(mongodb::options::AuthMechanism::ScramSha256)
        ));

        match options.tls {
            Some(Tls::Enabled(tls)) => {
                assert_eq!(tls.ca_file_path, Some(PathBuf::from("/certs/ca.pem")));
                assert_eq!(
                    tls.cert_key_file_path,
                    Some(PathBuf::from("/certs/client.pem"))
                );
                assert_eq!(tls.allow_invalid_certificates, Some(false));
            }
            other => panic!("expected TLS enabled, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn client_options_defaults_and_direct_connection() {
        let mut config = config_with_uri("mongodb://127.0.0.1/dev");
        config.connection_string = None;
        config.hosts = vec!["127.0.0.1:27017".into()];
        config.direct_connection = Some(true);
        config.tls = Some(TlsConfig {
            enabled: false,
            ..Default::default()
        });
        validate_and_secure_config(&mut config, None).unwrap();
        let uri = config.to_connection_string();
        let options = build_client_options(&config, &uri).await.unwrap();

        assert_eq!(options.app_name.as_deref(), Some(DEFAULT_APP_NAME));
        assert_eq!(options.connect_timeout, Some(DEFAULT_CONNECT_TIMEOUT));
        assert_eq!(
            options.server_selection_timeout,
            Some(DEFAULT_SERVER_SELECTION_TIMEOUT)
        );
        assert_eq!(options.direct_connection, Some(true));
        assert!(options.credential.is_none());
        assert!(matches!(options.tls, Some(Tls::Disabled)));
    }

    #[tokio::test]
    async fn client_options_allow_invalid_certificates_only_with_acknowledgement() {
        let mut config = config_with_uri("mongodb://127.0.0.1/dev");
        config.connection_string = None;
        config.hosts = vec!["db.example.com:27017".into()];
        config.tls = Some(TlsConfig {
            enabled: true,
            allow_invalid_certificates: true,
            ..Default::default()
        });
        assert!(validate_and_secure_config(&mut config.clone(), None).is_err());
        validate_and_secure_config(&mut config, Some(INVALID_CERTIFICATE_ACKNOWLEDGEMENT)).unwrap();
        let uri = config.to_connection_string();
        let options = build_client_options(&config, &uri).await.unwrap();
        match options.tls {
            Some(Tls::Enabled(tls)) => assert_eq!(tls.allow_invalid_certificates, Some(true)),
            other => panic!("expected TLS enabled, got {other:?}"),
        }
    }

    #[test]
    fn tls_mapping_rejects_split_client_cert_and_key_files() {
        let error = tls_from_config(&TlsConfig {
            enabled: true,
            client_cert_path: Some("/a/cert.pem".into()),
            client_key_path: Some("/a/key.pem".into()),
            ..Default::default()
        })
        .unwrap_err();
        assert_eq!(error.kind, MongoErrorKind::InvalidConfig);

        let same = tls_from_config(&TlsConfig {
            enabled: true,
            client_cert_path: Some("/a/combined.pem".into()),
            client_key_path: Some("/a/combined.pem".into()),
            ..Default::default()
        })
        .unwrap();
        match same {
            Tls::Enabled(tls) => assert_eq!(
                tls.cert_key_file_path,
                Some(PathBuf::from("/a/combined.pem"))
            ),
            Tls::Disabled => panic!("expected TLS enabled"),
        }
    }

    #[test]
    fn srv_uris_pass_through_to_the_driver_as_dns_seedlists() {
        let parsed = parse_mongo_uri("mongodb+srv://cluster0.example.com/app").unwrap();
        assert!(parsed.tls_enabled, "SRV implies TLS");
        let connection_string =
            ConnectionString::parse("mongodb+srv://cluster0.example.com/app").unwrap();
        assert!(matches!(
            connection_string.host_info,
            HostInfo::DnsRecord(_)
        ));
        assert_eq!(connection_string.default_database.as_deref(), Some("app"));
    }

    #[tokio::test]
    async fn raw_uri_credentials_map_to_driver_credential_with_auth_source() {
        let config = config_with_uri("mongodb://u:p@127.0.0.1:27017/app?authSource=admin");
        let options = build_client_options(&config, config.connection_string.as_deref().unwrap())
            .await
            .unwrap();
        let credential = options.credential.unwrap();
        assert_eq!(credential.username.as_deref(), Some("u"));
        assert_eq!(credential.source.as_deref(), Some("admin"));
        assert_eq!(options.default_database.as_deref(), Some("app"));
    }

    // ── JSON ⇄ BSON ──────────────────────────────────────────────────

    #[test]
    fn json_to_document_supports_extended_json() {
        let doc = json_to_document(
            json!({
                "_id": { "$oid": "507f1f77bcf86cd799439011" },
                "when": { "$date": "2026-08-26T10:00:00Z" },
                "big": { "$numberLong": "9007199254740993" },
                "tags": ["a", { "n": 1 }, [1, 2.5]],
                "nested": { "flag": true, "none": null }
            }),
            "filter",
        )
        .unwrap();

        assert!(matches!(doc.get("_id"), Some(Bson::ObjectId(_))));
        assert!(matches!(doc.get("when"), Some(Bson::DateTime(_))));
        assert_eq!(doc.get("big"), Some(&Bson::Int64(9007199254740993)));
        let tags = doc.get_array("tags").unwrap();
        assert_eq!(tags.len(), 3);
        assert!(matches!(tags[1], Bson::Document(_)));
        assert!(matches!(tags[2], Bson::Array(_)));
        assert_eq!(
            doc.get_document("nested").unwrap().get("none"),
            Some(&Bson::Null)
        );
    }

    #[test]
    fn json_to_document_rejects_non_objects_and_bad_extjson() {
        let error = json_to_document(json!([1, 2]), "filter").unwrap_err();
        assert_eq!(error.kind, MongoErrorKind::InvalidConfig);
        assert!(error.message.contains("filter"));
        assert!(json_to_document(json!({ "_id": { "$oid": "nope" } }), "filter").is_err());
        assert!(json_to_document(json!("string"), "sort").is_err());
    }

    #[test]
    fn document_to_json_emits_relaxed_extended_json() {
        let oid = mongodb::bson::oid::ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap();
        let doc = doc! {
            "_id": oid,
            "n": 5_i32,
            "big": 9007199254740993_i64,
            "f": 2.5_f64,
            "when": mongodb::bson::DateTime::from_millis(1_700_000_000_000),
            "nested": { "list": [1, "x"] }
        };
        let value = document_to_json(doc);
        assert_eq!(value["_id"]["$oid"], "507f1f77bcf86cd799439011");
        assert_eq!(value["n"], 5);
        assert_eq!(value["big"], 9007199254740993_i64);
        assert_eq!(value["f"], 2.5);
        assert!(value["when"]["$date"].is_string());
        assert_eq!(value["nested"]["list"][1], "x");
    }

    #[test]
    fn json_to_update_accepts_operators_and_pipelines_only() {
        assert!(matches!(
            json_to_update(json!({ "$set": { "a": 1 } })).unwrap(),
            UpdateModifications::Document(_)
        ));
        assert!(matches!(
            json_to_update(json!([{ "$set": { "a": 1 } }])).unwrap(),
            UpdateModifications::Pipeline(_)
        ));
        assert!(json_to_update(json!({ "a": 1 })).is_err());
        assert!(json_to_update(json!({})).is_err());
        assert!(json_to_update(json!([])).is_err());
    }

    #[test]
    fn index_options_map_supported_keys_and_reject_unknown() {
        let options = json_to_index_options(json!({
            "name": "city_1",
            "unique": true,
            "sparse": false,
            "expireAfterSeconds": 3600,
            "partialFilterExpression": { "city": { "$exists": true } }
        }))
        .unwrap();
        assert_eq!(options.name.as_deref(), Some("city_1"));
        assert_eq!(options.unique, Some(true));
        assert_eq!(options.sparse, Some(false));
        assert_eq!(options.expire_after, Some(Duration::from_secs(3600)));
        assert!(options.partial_filter_expression.is_some());

        assert!(json_to_index_options(json!({ "bogus": 1 })).is_err());
        assert!(json_to_index_options(json!({ "expireAfterSeconds": -1 })).is_err());
        assert!(json_to_index_options(json!({ "name": "" })).is_err());
    }

    #[test]
    fn index_info_reads_server_spec() {
        let info = index_info_from_spec(doc! {
            "v": 2, "key": { "city": 1 }, "name": "city_1", "unique": true
        });
        assert_eq!(info.name, "city_1");
        assert_eq!(info.keys["city"], 1);
        assert!(info.unique);
        assert!(!info.sparse);
        assert_eq!(info.options["v"], 2);
    }

    #[test]
    fn limit_is_clamped_to_a_safe_page() {
        assert_eq!(clamp_limit(None), DEFAULT_DOCUMENT_LIMIT);
        assert_eq!(clamp_limit(Some(0)), 1);
        assert_eq!(clamp_limit(Some(-5)), 1);
        assert_eq!(clamp_limit(Some(10)), 10);
        assert_eq!(
            clamp_limit(Some(MAX_DOCUMENT_LIMIT + 1)),
            MAX_DOCUMENT_LIMIT
        );
    }

    #[test]
    fn page_result_reports_has_more_from_the_extra_row() {
        let docs = (0..4).map(|i| doc! { "i": i }).collect::<Vec<_>>();
        let page = page_result(docs.clone(), 3, Instant::now());
        assert_eq!(page.returned, 3);
        assert!(page.has_more);
        assert_eq!(page.documents[2]["i"], 2);

        let page = page_result(docs, 4, Instant::now());
        assert_eq!(page.returned, 4);
        assert!(!page.has_more);
    }

    #[test]
    fn cursor_reply_helpers_read_first_batch_and_numeric_shapes() {
        let reply = doc! {
            "ok": 1.0,
            "cursor": { "firstBatch": [ { "name": "people", "type": "collection" }, "junk" ] }
        };
        assert!(reply_ok(&reply));
        let batch = cursor_first_batch(&reply);
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].get_str("name").unwrap(), "people");
        assert_eq!(bson_i64(Some(&Bson::Int32(3))), 3);
        assert_eq!(bson_i64(Some(&Bson::Double(3.9))), 3);
        assert_eq!(bson_f64(Some(&Bson::Int64(2))), 2.0);
        assert_eq!(bson_i64(None), 0);
    }

    // ── Redaction / opacity ──────────────────────────────────────────

    #[test]
    fn redaction_strips_plain_and_url_encoded_passwords() {
        let mut config = structured_config();
        config.connection_string = None;
        let secrets = collect_secrets(&config);
        let message = "failed: mongodb://admin:p%40ss%3Aword@db1 (p@ss:word)";
        let redacted = redact_secrets(message, &secrets);
        assert!(!redacted.contains("p@ss:word"));
        assert!(!redacted.contains("p%40ss%3Aword"));
        assert!(redacted.contains("***"));

        let raw = config_with_uri("mongodb+srv://u:raw-secret@cluster/app");
        let secrets = collect_secrets(&raw);
        assert_eq!(redact_secrets("raw-secret leaked", &secrets), "*** leaked");
        assert!(collect_secrets(&config_with_uri("mongodb://127.0.0.1/x")).is_empty());
    }

    #[test]
    fn uri_password_extraction_handles_shapes() {
        assert_eq!(uri_password("mongodb://u:p@h/db"), Some("p"));
        assert_eq!(uri_password("mongodb://u@h/db"), None);
        assert_eq!(uri_password("mongodb://h/db?x=1"), None);
        assert_eq!(
            uri_password("mongodb+srv://u:p%40w@h?tls=true"),
            Some("p%40w")
        );
    }

    #[test]
    fn driver_errors_are_mapped_to_opaque_kinds() {
        let io = DriverError::from(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "refused mongodb://admin:secret@host",
        ));
        let mapped = driver_error(&io);
        assert_eq!(mapped.kind, MongoErrorKind::ConnectionFailed);
        assert!(!mapped.message.contains("secret"));

        let invalid = ConnectionString::parse("mongodb://admin:secret@/nohost").unwrap_err();
        assert!(matches!(*invalid.kind, ErrorKind::InvalidArgument { .. }));
        let mapped = driver_error(&invalid);
        assert_eq!(mapped.kind, MongoErrorKind::InvalidConfig);
        assert!(!mapped.message.contains("secret"));
        assert!(!mapped.message.contains("mongodb://"));

        let custom = DriverError::custom("boom with mongodb://x:y@z");
        let mapped = driver_error(&custom);
        assert_eq!(mapped.kind, MongoErrorKind::DatabaseError);
        assert!(!mapped.message.contains("boom"));
    }

    // ── Transport policy (ported) ────────────────────────────────────

    #[test]
    fn raw_uri_parser_enforces_scheme_hosts_and_bounds_without_leaking_secrets() {
        assert!(parse_mongo_uri("https://db.example.com").is_err());
        assert!(parse_mongo_uri("mongodb://db1.example.com,db2.example.com/admin").is_ok());
        assert!(parse_mongo_uri("mongodb+srv://db1.example.com,db2.example.com/admin").is_err());
        assert!(parse_mongo_uri("mongodb://[::1]:27017/admin").is_ok());
        assert!(parse_mongo_uri(&format!(
            "mongodb://127.0.0.1/{}",
            "x".repeat(MAX_FIELD_BYTES + 1)
        ))
        .is_err());

        let secret = "do-not-reflect-this-secret";
        let error = match parse_mongo_uri(&format!("mongodb://admin:{secret}@/admin")) {
            Err(error) => error,
            Ok(_) => panic!("credential URI without a host must be rejected"),
        };
        assert!(!error.message.contains(secret));
    }

    #[test]
    fn transport_policy_allows_plaintext_only_for_safe_loopback_case() {
        let loopback = parse_mongo_uri("mongodb://127.0.0.1:27017/dev").unwrap();
        assert!(!loopback.has_credentials);
        assert!(loopback.all_hosts_are_literal_loopback);
        enforce_transport_policy(&loopback, None).unwrap();

        let remote_plaintext =
            parse_mongo_uri("mongodb://admin:secret@db.example.com/admin").unwrap();
        assert!(enforce_transport_policy(&remote_plaintext, None).is_err());

        let remote_verified =
            parse_mongo_uri("mongodb://admin:secret@db.example.com/admin?tls=true").unwrap();
        enforce_transport_policy(&remote_verified, None).unwrap();
    }

    #[test]
    fn invalid_certificate_mode_requires_exact_one_shot_acknowledgement() {
        let insecure = parse_mongo_uri(
            "mongodb://db.example.com/admin?tls=true&tlsAllowInvalidCertificates=true",
        )
        .unwrap();
        assert!(enforce_transport_policy(&insecure, None).is_err());
        assert!(enforce_transport_policy(&insecure, Some("yes")).is_err());
        enforce_transport_policy(&insecure, Some(INVALID_CERTIFICATE_ACKNOWLEDGEMENT)).unwrap();

        let credentialed = parse_mongo_uri(
            "mongodb://admin:secret@db.example.com/admin?tls=true&tlsAllowInvalidCertificates=true",
        )
        .unwrap();
        assert!(
            enforce_transport_policy(&credentialed, Some(INVALID_CERTIFICATE_ACKNOWLEDGEMENT))
                .is_err()
        );
    }

    #[test]
    fn structured_remote_connections_default_to_verified_tls() {
        let mut config = config_with_uri("mongodb://127.0.0.1/dev");
        config.connection_string = None;
        config.hosts = vec!["db.example.com:27017".into()];
        let hosts = validate_and_secure_config(&mut config, None).unwrap();
        assert_eq!(hosts, vec!["db.example.com:27017"]);
        assert!(config.tls.as_ref().is_some_and(|tls| tls.enabled));
        assert!(config.to_connection_string().contains("tls=true"));
    }

    #[test]
    fn field_limits_are_applied_before_driver_use() {
        let mut config = config_with_uri("mongodb://127.0.0.1/dev");
        config.label = Some("x".repeat(MAX_FIELD_BYTES + 1));
        assert!(validate_and_secure_config(&mut config, None).is_err());
        assert!(validate_uri_bytes(&format!(
            "mongodb://{}",
            "x".repeat(MAX_CONNECTION_URI_BYTES)
        ))
        .is_err());
        assert!(validate_uri_bytes("mongodb://127.0.0.1\n/dev").is_err());
        assert!(validate_required_field("f", "", 10).is_err());
    }

    #[test]
    fn scrub_removes_every_secret_field() {
        let mut config = structured_config();
        config.connection_string = Some("mongodb://u:p@h".into());
        config.ssh_tunnel = Some(SshTunnelConfig {
            host: "h".into(),
            port: 22,
            username: "u".into(),
            password: Some("p".into()),
            private_key_path: None,
            passphrase: Some("pp".into()),
        });
        scrub_config_secrets(&mut config);
        assert!(config.password.is_none());
        assert!(config.connection_string.is_none());
        let tunnel = config.ssh_tunnel.unwrap();
        assert!(tunnel.password.is_none());
        assert!(tunnel.passphrase.is_none());
    }
}

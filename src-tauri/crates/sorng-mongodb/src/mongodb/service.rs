//! MongoDB service providing simple session and management operations.

use crate::mongodb::types::*;
use chrono::Utc;
use log::{info, warn};
use mongodb::{
    bson::{doc, Bson, Document as BsonDocument},
    options::ClientOptions,
    Client,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_stream::StreamExt;
use uuid::Uuid;

pub type MongoServiceState = Arc<Mutex<MongoService>>;

pub fn new_state() -> MongoServiceState {
    Arc::new(Mutex::new(MongoService::new()))
}

struct MongoSession {
    client: Client,
    info: SessionInfo,
    ssh_child: Option<std::process::Child>,
}

pub struct MongoService {
    sessions: HashMap<String, MongoSession>,
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
        }
    }

    pub async fn connect(&mut self, config: MongoConnectionConfig) -> Result<String, MongoError> {
        let session_id = Uuid::new_v4().to_string();
        let label = config
            .label
            .clone()
            .unwrap_or_else(|| format!("mongo-{}", &session_id[..8]));

        let (effective_hosts, ssh_child) = if config.ssh_tunnel.is_some() {
            warn!("SSH tunnel support for MongoDB is a stub; connecting directly");
            (config.hosts.clone(), None)
        } else {
            (config.hosts.clone(), None)
        };

        let connection_string = if config.connection_string.is_some() {
            config.to_connection_string()
        } else {
            let mut config_clone = config.clone();
            config_clone.hosts = effective_hosts.clone();
            config_clone.to_connection_string()
        };

        let mut client_options = ClientOptions::parse(&connection_string)
            .await
            .map_err(|e| {
                MongoError::connection_failed(format!("Failed to parse connection options: {e}"))
            })?;

        if let Some(timeout_secs) = config.connect_timeout_secs {
            client_options.connect_timeout = Some(std::time::Duration::from_secs(timeout_secs));
        }
        if let Some(timeout_secs) = config.server_selection_timeout_secs {
            client_options.server_selection_timeout =
                Some(std::time::Duration::from_secs(timeout_secs));
        }

        let client = Client::with_options(client_options)
            .map_err(|e| MongoError::connection_failed(format!("Failed to create client: {e}")))?;

        let admin_db = client.database("admin");
        admin_db
            .run_command(doc! { "ping": 1 })
            .await
            .map_err(|e| MongoError::connection_failed(format!("Ping failed: {e}")))?;

        let build_info = admin_db.run_command(doc! { "buildInfo": 1 }).await.ok();
        let server_version = build_info
            .as_ref()
            .and_then(|doc| doc.get_str("version").ok())
            .map(ToOwned::to_owned);

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

    pub async fn disconnect_all(&mut self) {
        for (id, mut session) in self.sessions.drain() {
            if let Some(ref mut child) = session.ssh_child {
                let _ = child.kill();
            }
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

    pub async fn ping(&self, session_id: &str) -> Result<bool, MongoError> {
        let client = self.get_client(session_id)?;
        let admin_db = client.database("admin");
        Ok(admin_db.run_command(doc! { "ping": 1 }).await.is_ok())
    }

    pub async fn list_databases(&self, session_id: &str) -> Result<Vec<DatabaseInfo>, MongoError> {
        let client = self.get_client(session_id)?;
        let names = client.list_database_names().await.map_err(|e| {
            MongoError::new(
                MongoErrorKind::DatabaseError,
                format!("list_database_names: {e}"),
            )
        })?;

        Ok(names
            .into_iter()
            .map(|name| DatabaseInfo { name })
            .collect())
    }

    pub async fn drop_database(&self, session_id: &str, db_name: &str) -> Result<(), MongoError> {
        let client = self.get_client(session_id)?;
        client.database(db_name).drop().await.map_err(|e| {
            MongoError::new(MongoErrorKind::DatabaseError, format!("drop_database: {e}"))
        })
    }

    pub async fn list_collections(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<Vec<CollectionInfo>, MongoError> {
        let db = self.resolve_db(session_id, db_name)?;
        let mut cursor = db.list_collections().await.map_err(|e| {
            MongoError::new(
                MongoErrorKind::DatabaseError,
                format!("list_collections: {e}"),
            )
        })?;

        let mut collections = Vec::new();
        while let Some(result) = cursor.next().await {
            let spec = result.map_err(|e| {
                MongoError::new(
                    MongoErrorKind::DatabaseError,
                    format!("list_collections cursor: {e}"),
                )
            })?;

            collections.push(CollectionInfo {
                name: spec.name,
                collection_type: format!("{:?}", spec.collection_type),
            });
        }

        Ok(collections)
    }

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
                MongoError::new(MongoErrorKind::DatabaseError, format!("collStats: {e}"))
            })?;

        Ok(CollectionStats {
            namespace: result.get_str("ns").unwrap_or_default().to_string(),
            count: result.get_i64("count").unwrap_or(0),
            size: result.get_i64("size").unwrap_or(0),
            storage_size: result.get_i64("storageSize").unwrap_or(0),
            num_indexes: result.get_i32("nindexes").unwrap_or(0),
            total_index_size: result.get_i64("totalIndexSize").unwrap_or(0),
            capped: result.get_bool("capped").unwrap_or(false),
        })
    }

    pub async fn server_status(&self, session_id: &str) -> Result<ServerStatus, MongoError> {
        let client = self.get_client(session_id)?;
        let admin_db = client.database("admin");
        let result = admin_db
            .run_command(doc! { "serverStatus": 1 })
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::CommandError, format!("serverStatus: {e}"))
            })?;

        let connections = result
            .get_document("connections")
            .map(|connections| ConnectionStats {
                current: connections.get_i32("current").unwrap_or(0),
                available: connections.get_i32("available").unwrap_or(0),
                total_created: connections.get_i64("totalCreated").unwrap_or(0),
            })
            .unwrap_or(ConnectionStats {
                current: 0,
                available: 0,
                total_created: 0,
            });

        Ok(ServerStatus {
            host: result.get_str("host").unwrap_or("unknown").to_string(),
            version: result.get_str("version").unwrap_or("unknown").to_string(),
            uptime_secs: result.get_f64("uptime").unwrap_or(0.0),
            connections,
        })
    }

    pub async fn list_users(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<Vec<MongoUserInfo>, MongoError> {
        let db = self.resolve_db(session_id, db_name.or(Some("admin")))?;
        let result = db.run_command(doc! { "usersInfo": 1 }).await.map_err(|e| {
            MongoError::new(MongoErrorKind::CommandError, format!("usersInfo: {e}"))
        })?;

        let mut users = Vec::new();
        if let Ok(user_entries) = result.get_array("users") {
            for entry in user_entries {
                if let Bson::Document(user_doc) = entry {
                    let mut roles = Vec::new();
                    if let Ok(role_entries) = user_doc.get_array("roles") {
                        for role in role_entries {
                            if let Bson::Document(role_doc) = role {
                                roles.push(MongoRole {
                                    role: role_doc.get_str("role").unwrap_or_default().to_string(),
                                    db: role_doc.get_str("db").unwrap_or_default().to_string(),
                                });
                            }
                        }
                    }

                    users.push(MongoUserInfo {
                        user: user_doc.get_str("user").unwrap_or_default().to_string(),
                        database: user_doc.get_str("db").unwrap_or_default().to_string(),
                        roles,
                    });
                }
            }
        }

        Ok(users)
    }

    pub async fn replica_set_status(
        &self,
        session_id: &str,
    ) -> Result<Vec<ReplicaSetMember>, MongoError> {
        let client = self.get_client(session_id)?;
        let admin_db = client.database("admin");
        let result = admin_db
            .run_command(doc! { "replSetGetStatus": 1 })
            .await
            .map_err(|e| {
                MongoError::new(
                    MongoErrorKind::CommandError,
                    format!("replSetGetStatus: {e}"),
                )
            })?;

        let mut members = Vec::new();
        if let Ok(member_entries) = result.get_array("members") {
            for entry in member_entries {
                if let Bson::Document(member_doc) = entry {
                    members.push(ReplicaSetMember {
                        name: member_doc.get_str("name").unwrap_or_default().to_string(),
                        state_str: member_doc
                            .get_str("stateStr")
                            .unwrap_or_default()
                            .to_string(),
                        state: member_doc.get_i32("state").unwrap_or(0),
                        health: member_doc.get_f64("health").unwrap_or(0.0),
                        is_self: member_doc.get_bool("self").ok(),
                        uptime: member_doc.get_i64("uptime").ok(),
                    });
                }
            }
        }

        Ok(members)
    }

    pub async fn current_op(&self, session_id: &str) -> Result<Vec<serde_json::Value>, MongoError> {
        let client = self.get_client(session_id)?;
        let admin_db = client.database("admin");
        let result = admin_db
            .run_command(doc! { "currentOp": 1 })
            .await
            .map_err(|e| {
                MongoError::new(MongoErrorKind::CommandError, format!("currentOp: {e}"))
            })?;

        let mut ops = Vec::new();
        if let Ok(in_progress) = result.get_array("inprog") {
            for entry in in_progress {
                if let Bson::Document(doc) = entry {
                    let json = bson_doc_to_json(doc).map_err(|e| {
                        MongoError::new(
                            MongoErrorKind::SerializationError,
                            format!("currentOp serialization: {e}"),
                        )
                    })?;
                    ops.push(json);
                }
            }
        }

        Ok(ops)
    }

    pub async fn kill_op(&self, session_id: &str, op_id: i64) -> Result<(), MongoError> {
        let client = self.get_client(session_id)?;
        let admin_db = client.database("admin");
        admin_db
            .run_command(doc! { "killOp": 1, "op": op_id })
            .await
            .map_err(|e| MongoError::new(MongoErrorKind::CommandError, format!("killOp: {e}")))?;
        Ok(())
    }

    fn get_client(&self, session_id: &str) -> Result<&Client, MongoError> {
        self.sessions
            .get(session_id)
            .map(|session| &session.client)
            .ok_or_else(|| MongoError::session_not_found(session_id))
    }

    fn resolve_db(
        &self,
        session_id: &str,
        db_name: Option<&str>,
    ) -> Result<mongodb::Database, MongoError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| MongoError::session_not_found(session_id))?;
        let db_name = db_name
            .or(session.info.database.as_deref())
            .ok_or_else(|| {
                MongoError::new(MongoErrorKind::InvalidConfig, "No database specified")
            })?;

        Ok(session.client.database(db_name))
    }
}

fn bson_doc_to_json(doc: &BsonDocument) -> Result<serde_json::Value, String> {
    let bson = Bson::Document(doc.clone());
    Ok(bson.into())
}

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
    fn test_bson_doc_to_json() {
        let doc = doc! { "key": "value", "num": 10 };
        let json = bson_doc_to_json(&doc).unwrap();
        assert_eq!(json["key"], "value");
        assert_eq!(json["num"], 10);
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

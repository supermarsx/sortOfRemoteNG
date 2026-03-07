use crate::client::OciClient;
use crate::error::OciResult;
use crate::types::{OciAutonomousDb, OciDbSystem};

/// Database operations for DB Systems and Autonomous Databases.
pub struct DatabaseManager;

impl DatabaseManager {
    // ── DB Systems ───────────────────────────────────────────────────

    pub async fn list_db_systems(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciDbSystem>> {
        client
            .get(
                "database",
                &format!("/20160918/dbSystems?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_db_system(client: &OciClient, db_system_id: &str) -> OciResult<OciDbSystem> {
        client
            .get(
                "database",
                &format!("/20160918/dbSystems/{db_system_id}"),
            )
            .await
    }

    pub async fn launch_db_system(
        client: &OciClient,
        body: &serde_json::Value,
    ) -> OciResult<OciDbSystem> {
        client.post("database", "/20160918/dbSystems", body).await
    }

    pub async fn terminate_db_system(
        client: &OciClient,
        db_system_id: &str,
    ) -> OciResult<()> {
        client
            .delete(
                "database",
                &format!("/20160918/dbSystems/{db_system_id}"),
            )
            .await
    }

    // ── Autonomous Databases ─────────────────────────────────────────

    pub async fn list_autonomous_dbs(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciAutonomousDb>> {
        client
            .get(
                "database",
                &format!("/20160918/autonomousDatabases?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_autonomous_db(
        client: &OciClient,
        autonomous_db_id: &str,
    ) -> OciResult<OciAutonomousDb> {
        client
            .get(
                "database",
                &format!("/20160918/autonomousDatabases/{autonomous_db_id}"),
            )
            .await
    }

    pub async fn create_autonomous_db(
        client: &OciClient,
        body: &serde_json::Value,
    ) -> OciResult<OciAutonomousDb> {
        client
            .post("database", "/20160918/autonomousDatabases", body)
            .await
    }

    pub async fn delete_autonomous_db(
        client: &OciClient,
        autonomous_db_id: &str,
    ) -> OciResult<()> {
        client
            .delete(
                "database",
                &format!("/20160918/autonomousDatabases/{autonomous_db_id}"),
            )
            .await
    }

    pub async fn start_autonomous_db(
        client: &OciClient,
        autonomous_db_id: &str,
    ) -> OciResult<OciAutonomousDb> {
        client
            .post(
                "database",
                &format!("/20160918/autonomousDatabases/{autonomous_db_id}/actions/start"),
                &serde_json::json!({}),
            )
            .await
    }

    pub async fn stop_autonomous_db(
        client: &OciClient,
        autonomous_db_id: &str,
    ) -> OciResult<OciAutonomousDb> {
        client
            .post(
                "database",
                &format!("/20160918/autonomousDatabases/{autonomous_db_id}/actions/stop"),
                &serde_json::json!({}),
            )
            .await
    }
}

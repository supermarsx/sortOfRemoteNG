// ── sorng-osticket/src/topics.rs ───────────────────────────────────────────────
use crate::client::OsticketClient;
use crate::error::OsticketResult;
use crate::types::*;

pub struct TopicManager;

impl TopicManager {
    pub async fn list(client: &OsticketClient) -> OsticketResult<Vec<OsticketTopic>> {
        client.get("/topics").await
    }

    pub async fn get(client: &OsticketClient, topic_id: i64) -> OsticketResult<OsticketTopic> {
        client.get(&format!("/topics/{}", topic_id)).await
    }

    pub async fn create(
        client: &OsticketClient,
        req: &CreateTopicRequest,
    ) -> OsticketResult<OsticketTopic> {
        client.post("/topics", req).await
    }

    pub async fn update(
        client: &OsticketClient,
        topic_id: i64,
        req: &UpdateTopicRequest,
    ) -> OsticketResult<OsticketTopic> {
        client.patch(&format!("/topics/{}", topic_id), req).await
    }

    pub async fn delete(client: &OsticketClient, topic_id: i64) -> OsticketResult<()> {
        client.delete(&format!("/topics/{}", topic_id)).await
    }
}

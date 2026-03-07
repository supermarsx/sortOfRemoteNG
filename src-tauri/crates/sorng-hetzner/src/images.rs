use crate::client::HetznerClient;
use crate::error::HetznerResult;
use crate::types::*;

pub struct ImageManager;

impl ImageManager {
    pub async fn list_images(client: &HetznerClient) -> HetznerResult<Vec<HetznerImage>> {
        let resp: ImagesResponse = client.get("/images").await?;
        Ok(resp.images)
    }

    pub async fn get_image(client: &HetznerClient, id: u64) -> HetznerResult<HetznerImage> {
        let resp: ImageResponse = client.get(&format!("/images/{id}")).await?;
        Ok(resp.image)
    }

    pub async fn update_image(
        client: &HetznerClient,
        id: u64,
        description: Option<String>,
        labels: Option<serde_json::Value>,
    ) -> HetznerResult<HetznerImage> {
        let mut body = serde_json::json!({});
        if let Some(d) = description {
            body["description"] = serde_json::Value::String(d);
        }
        if let Some(l) = labels {
            body["labels"] = l;
        }
        let resp: ImageResponse = client.put(&format!("/images/{id}"), &body).await?;
        Ok(resp.image)
    }

    pub async fn delete_image(client: &HetznerClient, id: u64) -> HetznerResult<()> {
        client.delete_req(&format!("/images/{id}")).await
    }
}

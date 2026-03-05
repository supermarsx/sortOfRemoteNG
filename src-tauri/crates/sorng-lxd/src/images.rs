// ─── LXD – Image management ─────────────────────────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

/// GET /1.0/images?recursion=1 — list all images with full metadata
pub async fn list_images(client: &LxdClient) -> LxdResult<Vec<LxdImage>> {
    client.list_recursion("/images").await
}

/// GET /1.0/images/<fingerprint>
pub async fn get_image(client: &LxdClient, fingerprint: &str) -> LxdResult<LxdImage> {
    client.get(&format!("/images/{fingerprint}")).await
}

/// GET /1.0/images/aliases/<name> — resolve alias → fingerprint
pub async fn get_image_alias(
    client: &LxdClient,
    alias: &str,
) -> LxdResult<serde_json::Value> {
    client.get(&format!("/images/aliases/{alias}")).await
}

/// POST /1.0/images/aliases — create an image alias
pub async fn create_image_alias(
    client: &LxdClient,
    req: &CreateImageAliasRequest,
) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
        description: &'a Option<String>,
        target: &'a str,
    }
    client
        .put(
            "/images/aliases",
            &Body {
                name: &req.name,
                description: &req.description,
                target: &req.target,
            },
        )
        .await
}

/// DELETE /1.0/images/aliases/<name>
pub async fn delete_image_alias(client: &LxdClient, alias: &str) -> LxdResult<()> {
    client.delete(&format!("/images/aliases/{alias}")).await
}

/// DELETE /1.0/images/<fingerprint>
pub async fn delete_image(client: &LxdClient, fingerprint: &str) -> LxdResult<LxdOperation> {
    client
        .delete_async(&format!("/images/{fingerprint}"))
        .await
}

/// PUT /1.0/images/<fingerprint> — update image properties
pub async fn update_image(
    client: &LxdClient,
    fingerprint: &str,
    properties: &std::collections::HashMap<String, String>,
    public: Option<bool>,
    auto_update: Option<bool>,
) -> LxdResult<()> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        properties: &'a std::collections::HashMap<String, String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        public: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        auto_update: Option<bool>,
    }
    client
        .put(
            &format!("/images/{fingerprint}"),
            &Body {
                properties,
                public,
                auto_update,
            },
        )
        .await
}

/// POST /1.0/images — copy an image from a remote server
pub async fn copy_image_from_remote(
    client: &LxdClient,
    server: &str,
    protocol: &str,
    alias: Option<&str>,
    fingerprint: Option<&str>,
    auto_update: bool,
    public: bool,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        source: Source<'a>,
        public: bool,
        auto_update: bool,
    }
    #[derive(serde::Serialize)]
    struct Source<'a> {
        #[serde(rename = "type")]
        source_type: &'static str,
        server: &'a str,
        protocol: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        alias: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        fingerprint: Option<&'a str>,
        mode: &'static str,
    }

    client
        .post_async(
            "/images",
            &Body {
                source: Source {
                    source_type: "image",
                    server,
                    protocol,
                    alias,
                    fingerprint,
                    mode: "pull",
                },
                public,
                auto_update,
            },
        )
        .await
}

/// POST /1.0/images/<fingerprint>/refresh — trigger image refresh
pub async fn refresh_image(
    client: &LxdClient,
    fingerprint: &str,
) -> LxdResult<LxdOperation> {
    let empty: serde_json::Value = serde_json::json!({});
    client
        .post_async(&format!("/images/{fingerprint}/refresh"), &empty)
        .await
}

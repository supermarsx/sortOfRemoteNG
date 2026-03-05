// ─── LXD – Instance migration ───────────────────────────────────────────────
use crate::client::LxdClient;
use crate::types::*;

/// POST /1.0/instances/<name> with migration=true — initiate live/offline migration
/// For cluster-internal migration (moving instance to a different cluster member).
pub async fn migrate_instance(
    client: &LxdClient,
    req: &MigrateInstanceRequest,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        migration: bool,
        name: &'a str,
        live: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        target: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pool: Option<&'a str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        project: Option<&'a str>,
    }

    client
        .post_async(
            &format!("/instances/{}", req.name),
            &Body {
                migration: true,
                name: req
                    .target_name
                    .as_deref()
                    .unwrap_or(&req.name),
                live: req.live,
                target: Some(&req.target_server),
                pool: req.target_pool.as_deref(),
                project: req.target_project.as_deref(),
            },
        )
        .await
}

/// Copy an instance (local copy within same server/cluster).
pub async fn copy_instance(
    client: &LxdClient,
    source_name: &str,
    new_name: &str,
    instance_only: bool,
    stateful: bool,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        name: &'a str,
        source: Source<'a>,
    }
    #[derive(serde::Serialize)]
    struct Source<'a> {
        #[serde(rename = "type")]
        source_type: &'static str,
        source: &'a str,
        instance_only: bool,
        stateful: bool,
    }

    client
        .post_async(
            "/instances",
            &Body {
                name: new_name,
                source: Source {
                    source_type: "copy",
                    source: source_name,
                    instance_only,
                    stateful,
                },
            },
        )
        .await
}

/// Publish an instance as an image.
pub async fn publish_instance(
    client: &LxdClient,
    instance: &str,
    alias: Option<&str>,
    public: bool,
    properties: Option<&std::collections::HashMap<String, String>>,
) -> LxdResult<LxdOperation> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        source: Source<'a>,
        public: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        aliases: Option<Vec<AliasRef<'a>>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        properties: Option<&'a std::collections::HashMap<String, String>>,
    }
    #[derive(serde::Serialize)]
    struct Source<'a> {
        #[serde(rename = "type")]
        source_type: &'static str,
        name: &'a str,
    }
    #[derive(serde::Serialize)]
    struct AliasRef<'a> {
        name: &'a str,
    }

    let aliases = alias.map(|a| vec![AliasRef { name: a }]);

    client
        .post_async(
            "/images",
            &Body {
                source: Source {
                    source_type: "instance",
                    name: instance,
                },
                public,
                aliases,
                properties,
            },
        )
        .await
}

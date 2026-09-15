//! Owned by t84-e12g: Container Manager containers, images, networks and
//! projects, decoded from DSM's envelopes (and the id-keyed project map) into
//! the unchanged IPC DTOs, plus the id-based project start/stop call.
//!
//! Compatibility kept: container, image and network lists also decode as a
//! bare array, and projects also as an array (with plain service names).

use super::*;
use crate::docker::DockerManager;

const CONTAINER: &str = "SYNO.Docker.Container";
const IMAGE: &str = "SYNO.Docker.Image";
const NETWORK: &str = "SYNO.Docker.Network";
const PROJECT: &str = "SYNO.Docker.Project";
const MANAGER_PROJECT: &str = "SYNO.ContainerManager.Project";

const STACK_ID: &str = "00000000-0000-4000-8000-000000000001";
const TOOLS_ID: &str = "00000000-0000-4000-8000-000000000002";

// ── Fixtures ────────────────────────────────────────────────────────

/// `dockerContainers` read.
// shape: vcf-content-factory api-maps/synology-docker.md [observed DSM 7.3.2] (MIT), synology-go pkg/docker/containers/response.go (MIT)
pub(super) fn real_docker_containers() -> Value {
    json!({
        "containers": [{
            "id": "0000000000000000000000000000000000000000000000000000000000000a01",
            "name": "web",
            "image": "nginx:1.27",
            "status": "running",
            "up_status": "Up 7 weeks (healthy)",
            "up_time": null,
            "created": 1_769_627_261,
            "finish_time": null,
            "cmd": "nginx -g daemon off;",
            "is_ddsm": false,
            "is_package": false,
            "exporting": false,
            "enable_service_portal": false,
            "services": null,
            "Labels": {},
            "NetworkSettings": {"Networks": {}},
            "State": {
                "Status": "running", "Running": true, "Paused": false, "Restarting": false, "OOMKilled": false, "Dead": false,
                "Pid": 1234, "ExitCode": 0, "Error": "",
                "StartedAt": "2026-02-24T14:23:14.459089407Z", "FinishedAt": "2026-02-24T14:19:33.036106954Z",
                "StartedTs": 1_771_943_000, "FinishedTs": 1_771_942_773
            }
        }],
        "limit": 1,
        "offset": 0,
        "total": 1
    })
}

/// `dockerImages` read.
// shape: N4S4/synology-api docker_api.py downloaded_images Example (MIT), synology-go pkg/docker/images/response.go (MIT)
pub(super) fn real_docker_images() -> Value {
    json!({
        "images": [{
            "created": 1_745_034_718,
            "description": "",
            "digest": "",
            "id": "sha256:0000000000000000000000000000000000000000000000000000000000000b01",
            "remote_digest": "",
            "repository": "caddy",
            "size": 50_509_416,
            "tags": ["alpine"],
            "upgradable": false,
            "virtual_size": 50_509_416
        }],
        "limit": 1,
        "offset": 0,
        "total": 1
    })
}

/// `dockerNetworks` read.
// shape: N4S4/synology-api docker_api.py network Example (MIT), dsm_helper Docker/DockerNetwork.dart (Apache-2.0)
pub(super) fn real_docker_networks() -> Value {
    json!({
        "network": [
            {"containers": ["web", "db"], "driver": "bridge", "enable_ipv6": false, "gateway": "192.0.2.1", "id": "0000000000000000000000000000000000000000000000000000000000000c01", "iprange": "", "name": "stack_default", "subnet": "192.0.2.0/24"},
            {"containers": [], "driver": "host", "enable_ipv6": false, "gateway": "", "id": "0000000000000000000000000000000000000000000000000000000000000c02", "iprange": "", "name": "host", "subnet": ""}
        ]
    })
}

/// `dockerProjects` read: a map keyed by project id.
// shape: N4S4/synology-api docker_api.py list_projects Example (MIT), synology-go pkg/docker/projects/response.go ProjectList = map[string]Project (MIT)
pub(super) fn real_docker_projects() -> Value {
    json!({
        STACK_ID: {
            "containerIds": ["0000000000000000000000000000000000000000000000000000000000000a01"],
            "created_at": "2025-03-14T14:07:04.874304Z",
            "enable_service_portal": true,
            "id": STACK_ID,
            "is_package": false,
            "name": "stack",
            "path": "/volume1/docker/stack",
            "service_portal_name": "stack",
            "service_portal_port": 8080,
            "service_portal_protocol": "http",
            "services": [{
                "display_name": "stack (project)",
                "id": format!("Docker-Project-{STACK_ID}"),
                "proxy_target": "http://127.0.0.1:8080",
                "service": format!("Docker-Project-{STACK_ID}"),
                "type": "reverse_proxy"
            }],
            "share_path": "/docker/stack",
            "state": "",
            "status": "RUNNING",
            "updated_at": "2025-03-14T15:17:31.840634Z",
            "version": 2
        },
        TOOLS_ID: {
            "containerIds": [],
            "created_at": "2025-05-27T08:33:03.213407Z",
            "enable_service_portal": false,
            "id": TOOLS_ID,
            "is_package": false,
            "name": "tools",
            "path": "/volume1/docker/tools",
            "services": null,
            "share_path": "/docker/tools",
            "state": "",
            "status": "STOPPED",
            "updated_at": "2025-06-15T10:38:52.247951Z",
            "version": 2
        }
    })
}

fn done() -> Value {
    json!({"success": true})
}

fn assert_project_selection_error(error: &SynologyError) {
    assert!(
        matches!(error.kind, SynologyErrorKind::ParseError),
        "{error}"
    );
    assert_eq!(error.to_string(), "Select one Container Manager project");
    assert!(error.diagnostic.is_none(), "{error}");
}

// ── Containers ──────────────────────────────────────────────────────

#[tokio::test]
async fn containers_decode_the_confirmed_dsm_shape() {
    // shape: dsm_helper Docker/DockerContainer.dart [DSM 7.2] (Apache-2.0): `up_time` is a number, no `State`.
    let dsm72 = json!({"containers": [{"id": "0000000000000000000000000000000000000000000000000000000000000a02", "name": "db", "image": "postgres:16", "status": "exited", "created": "1745034718", "up_time": 1_771_943_000}], "total": 1});
    let mut state_wins = real_docker_containers();
    state_wins["containers"][0]["State"]["Status"] = json!("restarting");
    let bare = real_docker_containers()["containers"].clone();
    let mut no_image = real_docker_containers();
    no_image["containers"][0]
        .as_object_mut()
        .unwrap()
        .remove("image");
    let mut bad_time = real_docker_containers();
    bad_time["containers"][0]["created"] = json!("yesterday");
    let (service, nas) = service_with(
        &[(CONTAINER, 1)],
        vec![
            ok(real_docker_containers()),
            ok(dsm72),
            ok(state_wins),
            ok(bare),
            ok(json!({"limit": 500, "offset": 0, "total": 0})),
            ok(no_image),
            ok(bad_time),
        ],
    )
    .await;

    let containers = service.list_docker_containers().await.unwrap();
    assert_eq!(containers.len(), 1);
    let web = &containers[0];
    assert_eq!(web.name, "web");
    assert_eq!(web.image, "nginx:1.27");
    assert_eq!(web.status, "running");
    assert_eq!(web.state, "running");
    assert_eq!(web.created.as_deref(), Some("2026-01-28T19:07:41+00:00"));
    assert_eq!(
        web.finished_at.as_deref(),
        Some("2026-02-24T14:19:33.036106954Z")
    );
    // DSM 7.3.2 sends `up_time: null`; it stays unknown.
    assert_eq!(web.up_time, None);
    let ipc = serde_json::to_value(web).unwrap();
    for key in [
        "ports",
        "volumes",
        "upTime",
        "cpuPercent",
        "memoryUsage",
        "memoryLimit",
    ] {
        assert!(ipc[key].is_null(), "{key}");
    }
    assert_eq!(ipc["state"], "running");
    assert_eq!(ipc["finishedAt"], "2026-02-24T14:19:33.036106954Z");

    let dsm72 = service.list_docker_containers().await.unwrap();
    assert_eq!(dsm72[0].up_time, Some(1_771_943_000));
    assert_eq!(dsm72[0].state, "exited");
    assert_eq!(dsm72[0].finished_at, None);
    assert_eq!(
        dsm72[0].created.as_deref(),
        Some("2025-04-19T03:51:58+00:00")
    );
    // The engine's `State.Status` is preferred over the summary `status`.
    let state_wins = service.list_docker_containers().await.unwrap();
    assert_eq!(state_wins[0].status, "running");
    assert_eq!(state_wins[0].state, "restarting");
    // Regression: a bare container array decodes.
    let bare = service.list_docker_containers().await.unwrap();
    assert_eq!(bare[0].name, "web");

    // Missing `containers`; a row without `image`; a non-numeric `created`.
    for _ in 0..3 {
        assert_schema_failure(&service.list_docker_containers().await.unwrap_err());
    }

    assert_eq!(nas.requests().len(), 7);
    for index in 0..7 {
        assert_eq!(request_api(&nas, index), CONTAINER);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 1);
        assert_eq!(
            request_field(&nas, index, "type").as_deref(),
            Some(r#""all""#)
        );
        assert_eq!(request_field(&nas, index, "limit").as_deref(), Some("500"));
        assert_eq!(request_field(&nas, index, "offset").as_deref(), Some("0"));
    }
}

#[tokio::test]
async fn container_reads_and_actions_follow_the_declared_request_format() {
    let (service, nas) = service_with_format(
        &[(CONTAINER, 1, None), (IMAGE, 1, None)],
        vec![ok(real_docker_containers()), dsm_error(105), done(), done()],
    )
    .await;

    service.list_docker_containers().await.unwrap();
    assert_eq!(request_field(&nas, 0, "type").as_deref(), Some("all"));
    // (e) DSM's refusal keeps its kind and diagnostic.
    let denied = service.list_docker_containers().await.unwrap_err();
    assert!(matches!(denied.kind, SynologyErrorKind::PermissionDenied));
    assert_dsm_failure(&denied, 105);
    service.start_docker_container("web").await.unwrap();
    service.pull_docker_image("caddy", "alpine").await.unwrap();
    assert_eq!(request_field(&nas, 2, "name").as_deref(), Some("web"));
    assert_eq!(
        request_field(&nas, 3, "repository").as_deref(),
        Some("caddy")
    );
    assert_eq!(request_field(&nas, 3, "tag").as_deref(), Some("alpine"));
}

#[tokio::test]
async fn container_image_and_network_actions_quote_string_params_under_json() {
    let (service, nas) = service_with(
        &[
            (CONTAINER, 1),
            (IMAGE, 1),
            (NETWORK, 1),
            ("SYNO.Docker.Container.Log", 1),
        ],
        (0..9).map(|_| done()).collect(),
    )
    .await;

    service.start_docker_container("web").await.unwrap();
    service.stop_docker_container("web").await.unwrap();
    service.restart_docker_container("web").await.unwrap();
    service.delete_docker_container("web", true).await.unwrap();
    service.pull_docker_image("caddy", "alpine").await.unwrap();
    let client = service.client.as_ref().unwrap();
    DockerManager::delete_image(client, "caddy:alpine")
        .await
        .unwrap();
    DockerManager::create_network(client, "lan", "bridge", "192.0.2.0/24", "192.0.2.1")
        .await
        .unwrap();
    DockerManager::delete_network(client, "lan").await.unwrap();
    DockerManager::get_container_logs(client, "web")
        .await
        .unwrap();

    let expected = [
        (CONTAINER, "start", "name", r#""web""#),
        (CONTAINER, "stop", "name", r#""web""#),
        (CONTAINER, "restart", "name", r#""web""#),
        (CONTAINER, "delete", "name", r#""web""#),
        (IMAGE, "pull", "repository", r#""caddy""#),
        (IMAGE, "delete", "name", r#""caddy:alpine""#),
        (NETWORK, "create", "subnet", r#""192.0.2.0/24""#),
        (NETWORK, "delete", "name", r#""lan""#),
        ("SYNO.Docker.Container.Log", "get", "name", r#""web""#),
    ];
    for (index, (api, method, key, value)) in expected.into_iter().enumerate() {
        assert_eq!(request_api(&nas, index), api);
        assert_eq!(request_method(&nas, index), method);
        assert_eq!(request_field(&nas, index, key).as_deref(), Some(value));
    }
    assert_eq!(request_field(&nas, 3, "force").as_deref(), Some("true"));
    assert_eq!(
        request_field(&nas, 4, "tag").as_deref(),
        Some(r#""alpine""#)
    );
    assert_eq!(request_field(&nas, 6, "name").as_deref(), Some(r#""lan""#));
    assert_eq!(
        request_field(&nas, 6, "driver").as_deref(),
        Some(r#""bridge""#)
    );
    assert_eq!(
        request_field(&nas, 6, "gateway").as_deref(),
        Some(r#""192.0.2.1""#)
    );
}

// ── Images and networks ─────────────────────────────────────────────

#[tokio::test]
async fn images_join_tags_and_convert_creation_times() {
    let mut multi = real_docker_images();
    multi["images"][0]["tags"] = json!(["1.27", "latest"]);
    multi["images"][0]["size"] = json!("50509416");
    multi["images"][0]
        .as_object_mut()
        .unwrap()
        .remove("virtual_size");
    let bare = json!([{"id": "sha256:0000000000000000000000000000000000000000000000000000000000000b02", "repository": "busybox", "size": 4_096, "tags": []}]);
    let mut no_size = real_docker_images();
    no_size["images"][0].as_object_mut().unwrap().remove("size");
    let (service, nas) = service_with(
        &[(IMAGE, 1)],
        vec![
            ok(real_docker_images()),
            ok(multi),
            ok(bare),
            ok(json!({"total": 0})),
            ok(no_size),
        ],
    )
    .await;

    let images = service.list_docker_images().await.unwrap();
    assert_eq!(images[0].repository, "caddy");
    assert_eq!(images[0].tag, "alpine");
    assert_eq!(images[0].size, 50_509_416);
    assert_eq!(images[0].virtual_size, Some(50_509_416));
    assert_eq!(
        serde_json::to_value(&images[0]).unwrap(),
        json!({"id": "sha256:0000000000000000000000000000000000000000000000000000000000000b01", "repository": "caddy", "tag": "alpine", "created": "2025-04-19T03:51:58+00:00", "size": 50_509_416, "virtualSize": 50_509_416})
    );
    let multi = service.list_docker_images().await.unwrap();
    assert_eq!(multi[0].tag, "1.27, latest");
    assert_eq!(multi[0].size, 50_509_416);
    assert_eq!(multi[0].virtual_size, None);
    // Regression: a bare array; an untagged image without a creation time.
    let bare = service.list_docker_images().await.unwrap();
    assert_eq!(bare[0].tag, "");
    assert_eq!(bare[0].created, None);
    for _ in 0..2 {
        assert_schema_failure(&service.list_docker_images().await.unwrap_err());
    }

    for index in 0..5 {
        assert_eq!(request_api(&nas, index), IMAGE);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 1);
        assert_eq!(request_field(&nas, index, "offset").as_deref(), Some("0"));
    }
}

#[tokio::test]
async fn networks_count_attached_containers_and_drop_empty_addresses() {
    let bare = json!([{"id": "0000000000000000000000000000000000000000000000000000000000000c03", "name": "none", "driver": "null"}]);
    let (service, nas) = service_with(
        &[(NETWORK, 1)],
        vec![
            ok(real_docker_networks()),
            ok(bare),
            ok(json!({"networks": []})),
            ok(json!({"network": [{"name": "no-id", "driver": "bridge"}]})),
        ],
    )
    .await;

    let networks = service.list_docker_networks().await.unwrap();
    assert_eq!(networks.len(), 2);
    assert_eq!(networks[0].name, "stack_default");
    assert_eq!(networks[0].driver, "bridge");
    assert_eq!(networks[0].containers, Some(2));
    assert_eq!(networks[0].subnet.as_deref(), Some("192.0.2.0/24"));
    assert_eq!(networks[0].gateway.as_deref(), Some("192.0.2.1"));
    assert_eq!(networks[1].containers, Some(0));
    assert_eq!(networks[1].subnet, None);
    assert_eq!(networks[1].gateway, None);
    let ipc = serde_json::to_value(&networks[0]).unwrap();
    assert!(ipc["scope"].is_null());
    assert_eq!(ipc["containers"], 2);
    // Regression: a bare array; no container list means an unknown count.
    let bare = service.list_docker_networks().await.unwrap();
    assert_eq!(bare[0].containers, None);
    for _ in 0..2 {
        assert_schema_failure(&service.list_docker_networks().await.unwrap_err());
    }

    for index in 0..4 {
        assert_eq!(request_api(&nas, index), NETWORK);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 1);
    }
}

// ── Projects ────────────────────────────────────────────────────────

#[tokio::test]
async fn projects_decode_the_id_keyed_map_and_the_array_shape() {
    let array = json!([
        {"id": STACK_ID, "name": "stack", "status": "RUNNING", "path": "/volume1/docker/stack", "services": ["web", {"id": "db-service"}]},
        {"name": "legacy", "status": "STOPPED"}
    ]);
    let (service, nas) = service_with(
        &[(PROJECT, 1)],
        vec![
            ok(json!({})),
            ok(real_docker_projects()),
            ok(array),
            ok(json!({TOOLS_ID: {"name": "tools", "status": "STOPPED", "services": []}})),
            ok(json!({STACK_ID: {"id": STACK_ID, "name": "stack"}})),
            ok(json!({"total": 0})),
            json!({"success": true}),
        ],
    )
    .await;

    // Probed DSM 7.4: `data: {}` when there are no projects.
    assert!(service.list_docker_projects().await.unwrap().is_empty());

    let projects = service.list_docker_projects().await.unwrap();
    assert_eq!(projects.len(), 2);
    let stack = &projects[0];
    assert_eq!(stack.id.as_deref(), Some(STACK_ID));
    assert_eq!(stack.name, "stack");
    assert_eq!(stack.status, "RUNNING");
    assert_eq!(stack.path.as_deref(), Some("/volume1/docker/stack"));
    assert_eq!(stack.services, ["stack (project)"]);
    let tools = &projects[1];
    assert_eq!(tools.id.as_deref(), Some(TOOLS_ID));
    assert_eq!(tools.status, "STOPPED");
    assert!(tools.services.is_empty());
    assert_eq!(
        serde_json::to_value(stack).unwrap(),
        json!({"id": STACK_ID, "name": "stack", "status": "RUNNING", "services": ["stack (project)"], "path": "/volume1/docker/stack"})
    );

    // The array shape: plain service names and object ids; id stays unknown
    // when a row does not carry one.
    let array = service.list_docker_projects().await.unwrap();
    assert_eq!(array[0].id.as_deref(), Some(STACK_ID));
    assert_eq!(array[0].services, ["web", "db-service"]);
    assert_eq!(array[1].id, None);
    assert!(serde_json::to_value(&array[1]).unwrap()["id"].is_null());
    // A map entry without its own `id` is identified by its key.
    let keyed = service.list_docker_projects().await.unwrap();
    assert_eq!(keyed[0].id.as_deref(), Some(TOOLS_ID));
    assert_eq!(keyed[0].name, "tools");

    // A project without `status`; a map of non-projects; no data at all.
    for _ in 0..3 {
        assert_schema_failure(&service.list_docker_projects().await.unwrap_err());
    }

    for index in 0..7 {
        assert_eq!(request_api(&nas, index), PROJECT);
        assert_eq!(request_method(&nas, index), "list");
        assert_eq!(request_version(&nas, index), 1);
    }
}

#[tokio::test]
async fn projects_prefer_container_manager_project_when_discovered() {
    let (service, nas) = service_with(
        &[(MANAGER_PROJECT, 1), (PROJECT, 1)],
        vec![
            ok(real_docker_projects()),
            ok(real_docker_projects()),
            done(),
        ],
    )
    .await;

    assert_eq!(service.list_docker_projects().await.unwrap().len(), 2);
    service.stop_docker_project("tools").await.unwrap();
    for index in 0..3 {
        assert_eq!(request_api(&nas, index), MANAGER_PROJECT);
    }
    assert_eq!(request_method(&nas, 2), "stop");
    assert_eq!(
        request_field(&nas, 2, "id"),
        Some(format!("\"{TOOLS_ID}\""))
    );
}

#[tokio::test]
async fn project_start_and_stop_address_one_project_by_its_id() {
    let duplicate = json!({
        STACK_ID: {"id": STACK_ID, "name": "stack", "status": "RUNNING"},
        TOOLS_ID: {"id": TOOLS_ID, "name": "stack", "status": "STOPPED"}
    });
    let without_id = json!([{"name": "legacy", "status": "STOPPED"}]);
    let (service, nas) = service_with(
        &[(PROJECT, 1)],
        vec![
            // start by name
            ok(real_docker_projects()),
            done(),
            // start by id
            ok(real_docker_projects()),
            done(),
            // stop by name
            ok(real_docker_projects()),
            done(),
            // unknown, ambiguous, no id, list refused
            ok(real_docker_projects()),
            ok(duplicate),
            ok(without_id),
            dsm_error(105),
        ],
    )
    .await;

    service.start_docker_project("stack").await.unwrap();
    service.start_docker_project(STACK_ID).await.unwrap();
    service.stop_docker_project("tools").await.unwrap();
    let quoted_stack = format!("\"{STACK_ID}\"");
    for (index, method, id) in [
        (1, "start", quoted_stack.clone()),
        (3, "start", quoted_stack),
        (5, "stop", format!("\"{TOOLS_ID}\"")),
    ] {
        assert_eq!(request_method(&nas, index - 1), "list");
        assert_eq!(request_api(&nas, index), PROJECT);
        assert_eq!(request_method(&nas, index), method);
        assert_eq!(request_version(&nas, index), 1);
        assert_eq!(request_field(&nas, index, "id"), Some(id));
        assert_eq!(request_field(&nas, index, "name"), None);
    }

    // Each failure costs exactly one (list) request and never starts anything.
    for (expected_requests, name) in [(7, "missing"), (8, "stack"), (9, "legacy")] {
        let error = service.start_docker_project(name).await.unwrap_err();
        assert_project_selection_error(&error);
        assert_eq!(nas.requests().len(), expected_requests, "{name}");
        assert_eq!(request_method(&nas, expected_requests - 1), "list");
    }
    let denied = service.stop_docker_project("stack").await.unwrap_err();
    assert!(matches!(denied.kind, SynologyErrorKind::PermissionDenied));
    assert_dsm_failure(&denied, 105);
    assert_eq!(nas.requests().len(), 10);
    assert_eq!(request_method(&nas, 9), "list");
}

#[tokio::test]
async fn project_ids_are_sent_raw_to_a_plain_form_api() {
    let (service, nas) = service_with_format(
        &[(PROJECT, 1, None)],
        vec![ok(real_docker_projects()), done()],
    )
    .await;

    service.start_docker_project("stack").await.unwrap();
    assert_eq!(request_method(&nas, 1), "start");
    assert_eq!(request_field(&nas, 1, "id").as_deref(), Some(STACK_ID));
}

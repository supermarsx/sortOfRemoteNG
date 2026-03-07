use crate::service::OciServiceState;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
//  Connection management
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn oci_connect(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    config: OciConnectionConfig,
) -> Result<OciConnectionSummary, String> {
    let mut svc = state.lock().await;
    svc.connect(connection_id, config).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_disconnect(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect(&connection_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_connections(
    state: tauri::State<'_, OciServiceState>,
) -> Result<Vec<OciConnectionSummary>, String> {
    let svc = state.lock().await;
    Ok(svc.list_connections())
}

#[tauri::command]
pub async fn oci_ping(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.ping(&connection_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_dashboard(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
) -> Result<OciDashboard, String> {
    let svc = state.lock().await;
    svc.get_dashboard(&connection_id).await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Compute
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn oci_list_instances(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciInstance>, String> {
    let svc = state.lock().await;
    svc.list_instances(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_instance(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    instance_id: String,
) -> Result<OciInstance, String> {
    let svc = state.lock().await;
    svc.get_instance(&connection_id, &instance_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_launch_instance(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    request: LaunchInstanceRequest,
) -> Result<OciInstance, String> {
    let svc = state.lock().await;
    svc.launch_instance(&connection_id, &request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_terminate_instance(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    instance_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.terminate_instance(&connection_id, &instance_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_start_instance(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    instance_id: String,
) -> Result<OciInstance, String> {
    let svc = state.lock().await;
    svc.start_instance(&connection_id, &instance_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_stop_instance(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    instance_id: String,
) -> Result<OciInstance, String> {
    let svc = state.lock().await;
    svc.stop_instance(&connection_id, &instance_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_reboot_instance(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    instance_id: String,
) -> Result<OciInstance, String> {
    let svc = state.lock().await;
    svc.reboot_instance(&connection_id, &instance_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_shapes(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciShape>, String> {
    let svc = state.lock().await;
    svc.list_shapes(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_images(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciImage>, String> {
    let svc = state.lock().await;
    svc.list_images(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_image(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    image_id: String,
) -> Result<OciImage, String> {
    let svc = state.lock().await;
    svc.get_image(&connection_id, &image_id)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Networking
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn oci_list_vcns(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciVcn>, String> {
    let svc = state.lock().await;
    svc.list_vcns(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_vcn(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    vcn_id: String,
) -> Result<OciVcn, String> {
    let svc = state.lock().await;
    svc.get_vcn(&connection_id, &vcn_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_create_vcn(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    display_name: String,
    cidr_block: String,
) -> Result<OciVcn, String> {
    let svc = state.lock().await;
    svc.create_vcn(&connection_id, &compartment_id, &display_name, &cidr_block)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_delete_vcn(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    vcn_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_vcn(&connection_id, &vcn_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_subnets(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    vcn_id: Option<String>,
) -> Result<Vec<OciSubnet>, String> {
    let svc = state.lock().await;
    svc.list_subnets(&connection_id, &compartment_id, vcn_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_subnet(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    subnet_id: String,
) -> Result<OciSubnet, String> {
    let svc = state.lock().await;
    svc.get_subnet(&connection_id, &subnet_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_create_subnet(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    body: serde_json::Value,
) -> Result<OciSubnet, String> {
    let svc = state.lock().await;
    svc.create_subnet(&connection_id, &body)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_delete_subnet(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    subnet_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_subnet(&connection_id, &subnet_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_security_lists(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    vcn_id: Option<String>,
) -> Result<Vec<OciSecurityList>, String> {
    let svc = state.lock().await;
    svc.list_security_lists(&connection_id, &compartment_id, vcn_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_security_list(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    security_list_id: String,
) -> Result<OciSecurityList, String> {
    let svc = state.lock().await;
    svc.get_security_list(&connection_id, &security_list_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_route_tables(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    vcn_id: Option<String>,
) -> Result<Vec<OciRouteTable>, String> {
    let svc = state.lock().await;
    svc.list_route_tables(&connection_id, &compartment_id, vcn_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_internet_gateways(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    vcn_id: Option<String>,
) -> Result<Vec<OciInternetGateway>, String> {
    let svc = state.lock().await;
    svc.list_internet_gateways(&connection_id, &compartment_id, vcn_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_nat_gateways(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    vcn_id: Option<String>,
) -> Result<Vec<OciNatGateway>, String> {
    let svc = state.lock().await;
    svc.list_nat_gateways(&connection_id, &compartment_id, vcn_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_load_balancers(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciLoadBalancer>, String> {
    let svc = state.lock().await;
    svc.list_load_balancers(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_load_balancer(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    lb_id: String,
) -> Result<OciLoadBalancer, String> {
    let svc = state.lock().await;
    svc.get_load_balancer(&connection_id, &lb_id)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Storage
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn oci_list_block_volumes(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciBlockVolume>, String> {
    let svc = state.lock().await;
    svc.list_block_volumes(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_block_volume(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    volume_id: String,
) -> Result<OciBlockVolume, String> {
    let svc = state.lock().await;
    svc.get_block_volume(&connection_id, &volume_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_create_block_volume(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    availability_domain: String,
    display_name: String,
    size_in_gbs: u64,
) -> Result<OciBlockVolume, String> {
    let svc = state.lock().await;
    svc.create_block_volume(
        &connection_id,
        &compartment_id,
        &availability_domain,
        &display_name,
        size_in_gbs,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_delete_block_volume(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    volume_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_block_volume(&connection_id, &volume_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_buckets(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    namespace: String,
    compartment_id: String,
) -> Result<Vec<OciBucket>, String> {
    let svc = state.lock().await;
    svc.list_buckets(&connection_id, &namespace, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_bucket(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    namespace: String,
    bucket_name: String,
) -> Result<OciBucket, String> {
    let svc = state.lock().await;
    svc.get_bucket(&connection_id, &namespace, &bucket_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_create_bucket(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    namespace: String,
    compartment_id: String,
    bucket_name: String,
) -> Result<OciBucket, String> {
    let svc = state.lock().await;
    svc.create_bucket(&connection_id, &namespace, &compartment_id, &bucket_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_delete_bucket(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    namespace: String,
    bucket_name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_bucket(&connection_id, &namespace, &bucket_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_objects(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    namespace: String,
    bucket_name: String,
    prefix: Option<String>,
) -> Result<Vec<OciObject>, String> {
    let svc = state.lock().await;
    svc.list_objects(&connection_id, &namespace, &bucket_name, prefix.as_deref())
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Identity / IAM
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn oci_list_compartments(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciCompartment>, String> {
    let svc = state.lock().await;
    svc.list_compartments(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_compartment(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<OciCompartment, String> {
    let svc = state.lock().await;
    svc.get_compartment(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_create_compartment(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    parent_compartment_id: String,
    name: String,
    description: String,
) -> Result<OciCompartment, String> {
    let svc = state.lock().await;
    svc.create_compartment(&connection_id, &parent_compartment_id, &name, &description)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_users(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciUser>, String> {
    let svc = state.lock().await;
    svc.list_users(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_user(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    user_id: String,
) -> Result<OciUser, String> {
    let svc = state.lock().await;
    svc.get_user(&connection_id, &user_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_create_user(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    name: String,
    description: String,
    email: Option<String>,
) -> Result<OciUser, String> {
    let svc = state.lock().await;
    svc.create_user(
        &connection_id,
        &compartment_id,
        &name,
        &description,
        email.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_delete_user(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    user_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_user(&connection_id, &user_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_groups(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciGroup>, String> {
    let svc = state.lock().await;
    svc.list_groups(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_policies(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciPolicy>, String> {
    let svc = state.lock().await;
    svc.list_policies(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Database
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn oci_list_db_systems(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciDbSystem>, String> {
    let svc = state.lock().await;
    svc.list_db_systems(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_db_system(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    db_system_id: String,
) -> Result<OciDbSystem, String> {
    let svc = state.lock().await;
    svc.get_db_system(&connection_id, &db_system_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_autonomous_dbs(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciAutonomousDb>, String> {
    let svc = state.lock().await;
    svc.list_autonomous_dbs(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_autonomous_db(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    autonomous_db_id: String,
) -> Result<OciAutonomousDb, String> {
    let svc = state.lock().await;
    svc.get_autonomous_db(&connection_id, &autonomous_db_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_create_autonomous_db(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    body: serde_json::Value,
) -> Result<OciAutonomousDb, String> {
    let svc = state.lock().await;
    svc.create_autonomous_db(&connection_id, &body)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_start_autonomous_db(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    autonomous_db_id: String,
) -> Result<OciAutonomousDb, String> {
    let svc = state.lock().await;
    svc.start_autonomous_db(&connection_id, &autonomous_db_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_stop_autonomous_db(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    autonomous_db_id: String,
) -> Result<OciAutonomousDb, String> {
    let svc = state.lock().await;
    svc.stop_autonomous_db(&connection_id, &autonomous_db_id)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Containers / OKE
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn oci_list_container_instances(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciContainerInstance>, String> {
    let svc = state.lock().await;
    svc.list_container_instances(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_oke_clusters(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OkeCluster>, String> {
    let svc = state.lock().await;
    svc.list_oke_clusters(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_oke_cluster(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    cluster_id: String,
) -> Result<OkeCluster, String> {
    let svc = state.lock().await;
    svc.get_oke_cluster(&connection_id, &cluster_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_node_pools(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    cluster_id: Option<String>,
) -> Result<Vec<OkeNodePool>, String> {
    let svc = state.lock().await;
    svc.list_node_pools(&connection_id, &compartment_id, cluster_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Functions
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn oci_list_applications(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciFunctionApplication>, String> {
    let svc = state.lock().await;
    svc.list_applications(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_functions(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    application_id: String,
) -> Result<Vec<OciFunction>, String> {
    let svc = state.lock().await;
    svc.list_functions(&connection_id, &application_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_function(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    function_id: String,
) -> Result<OciFunction, String> {
    let svc = state.lock().await;
    svc.get_function(&connection_id, &function_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_invoke_function(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    function_id: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.invoke_function(&connection_id, &function_id, &payload)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Monitoring
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn oci_list_alarms(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
) -> Result<Vec<OciAlarm>, String> {
    let svc = state.lock().await;
    svc.list_alarms(&connection_id, &compartment_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_get_alarm(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    alarm_id: String,
) -> Result<OciAlarm, String> {
    let svc = state.lock().await;
    svc.get_alarm(&connection_id, &alarm_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_query_metrics(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    query: String,
    namespace: String,
) -> Result<Vec<OciMetricData>, String> {
    let svc = state.lock().await;
    svc.query_metrics(&connection_id, &compartment_id, &query, &namespace)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn oci_list_audit_events(
    state: tauri::State<'_, OciServiceState>,
    connection_id: String,
    compartment_id: String,
    start_time: String,
    end_time: String,
) -> Result<Vec<OciAuditEvent>, String> {
    let svc = state.lock().await;
    svc.list_audit_events(&connection_id, &compartment_id, &start_time, &end_time)
        .await
        .map_err(|e| e.to_string())
}

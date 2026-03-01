//! AWS ECS (Elastic Container Service) client.
//!
//! Mirrors `aws-sdk-ecs` types and operations. ECS uses JSON protocol
//! with target prefix `AmazonEC2ContainerServiceV20141113`.
//!
//! Reference: <https://docs.aws.amazon.com/AmazonECS/latest/APIReference/>

use crate::client::AwsClient;
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "ecs";
const TARGET_PREFIX: &str = "AmazonEC2ContainerServiceV20141113";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cluster {
    #[serde(rename = "clusterArn")]
    pub cluster_arn: Option<String>,
    #[serde(rename = "clusterName")]
    pub cluster_name: String,
    #[serde(rename = "status")]
    pub status: Option<String>,
    #[serde(rename = "registeredContainerInstancesCount")]
    pub registered_container_instances_count: Option<i32>,
    #[serde(rename = "runningTasksCount")]
    pub running_tasks_count: Option<i32>,
    #[serde(rename = "pendingTasksCount")]
    pub pending_tasks_count: Option<i32>,
    #[serde(rename = "activeServicesCount")]
    pub active_services_count: Option<i32>,
    #[serde(rename = "capacityProviders")]
    pub capacity_providers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    #[serde(rename = "serviceArn")]
    pub service_arn: Option<String>,
    #[serde(rename = "serviceName")]
    pub service_name: String,
    #[serde(rename = "clusterArn")]
    pub cluster_arn: Option<String>,
    #[serde(rename = "taskDefinition")]
    pub task_definition: Option<String>,
    #[serde(rename = "desiredCount")]
    pub desired_count: Option<i32>,
    #[serde(rename = "runningCount")]
    pub running_count: Option<i32>,
    #[serde(rename = "pendingCount")]
    pub pending_count: Option<i32>,
    #[serde(rename = "status")]
    pub status: Option<String>,
    #[serde(rename = "launchType")]
    pub launch_type: Option<String>,
    #[serde(rename = "deployments")]
    pub deployments: Vec<Deployment>,
    #[serde(rename = "loadBalancers")]
    pub load_balancers: Vec<LoadBalancer>,
    #[serde(rename = "networkConfiguration")]
    pub network_configuration: Option<NetworkConfiguration>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    #[serde(rename = "taskArn")]
    pub task_arn: Option<String>,
    #[serde(rename = "taskDefinitionArn")]
    pub task_definition_arn: Option<String>,
    #[serde(rename = "clusterArn")]
    pub cluster_arn: Option<String>,
    #[serde(rename = "lastStatus")]
    pub last_status: Option<String>,
    #[serde(rename = "desiredStatus")]
    pub desired_status: Option<String>,
    #[serde(rename = "cpu")]
    pub cpu: Option<String>,
    #[serde(rename = "memory")]
    pub memory: Option<String>,
    #[serde(rename = "launchType")]
    pub launch_type: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: Option<String>,
    #[serde(rename = "stoppedAt")]
    pub stopped_at: Option<String>,
    #[serde(rename = "stoppedReason")]
    pub stopped_reason: Option<String>,
    #[serde(rename = "containers")]
    pub containers: Vec<Container>,
    #[serde(rename = "group")]
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDefinition {
    #[serde(rename = "taskDefinitionArn")]
    pub task_definition_arn: Option<String>,
    #[serde(rename = "family")]
    pub family: String,
    #[serde(rename = "revision")]
    pub revision: Option<i32>,
    #[serde(rename = "status")]
    pub status: Option<String>,
    #[serde(rename = "containerDefinitions")]
    pub container_definitions: Vec<ContainerDefinition>,
    #[serde(rename = "cpu")]
    pub cpu: Option<String>,
    #[serde(rename = "memory")]
    pub memory: Option<String>,
    #[serde(rename = "networkMode")]
    pub network_mode: Option<String>,
    #[serde(rename = "requiresCompatibilities")]
    pub requires_compatibilities: Vec<String>,
    #[serde(rename = "executionRoleArn")]
    pub execution_role_arn: Option<String>,
    #[serde(rename = "taskRoleArn")]
    pub task_role_arn: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerDefinition {
    pub name: String,
    pub image: Option<String>,
    pub cpu: Option<i32>,
    pub memory: Option<i32>,
    #[serde(rename = "memoryReservation")]
    pub memory_reservation: Option<i32>,
    pub essential: Option<bool>,
    #[serde(rename = "portMappings")]
    pub port_mappings: Vec<PortMapping>,
    pub environment: Vec<KeyValuePair>,
    #[serde(rename = "logConfiguration")]
    pub log_configuration: Option<LogConfiguration>,
    pub command: Vec<String>,
    #[serde(rename = "healthCheck")]
    pub health_check: Option<HealthCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Container {
    #[serde(rename = "containerArn")]
    pub container_arn: Option<String>,
    pub name: Option<String>,
    #[serde(rename = "lastStatus")]
    pub last_status: Option<String>,
    #[serde(rename = "exitCode")]
    pub exit_code: Option<i32>,
    pub reason: Option<String>,
    #[serde(rename = "networkInterfaces")]
    pub network_interfaces: Vec<NetworkInterface>,
    #[serde(rename = "healthStatus")]
    pub health_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    #[serde(rename = "containerPort")]
    pub container_port: Option<i32>,
    #[serde(rename = "hostPort")]
    pub host_port: Option<i32>,
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValuePair {
    pub name: Option<String>,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogConfiguration {
    #[serde(rename = "logDriver")]
    pub log_driver: String,
    pub options: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    pub command: Vec<String>,
    pub interval: Option<i32>,
    pub timeout: Option<i32>,
    pub retries: Option<i32>,
    #[serde(rename = "startPeriod")]
    pub start_period: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deployment {
    pub id: Option<String>,
    pub status: Option<String>,
    #[serde(rename = "taskDefinition")]
    pub task_definition: Option<String>,
    #[serde(rename = "desiredCount")]
    pub desired_count: Option<i32>,
    #[serde(rename = "runningCount")]
    pub running_count: Option<i32>,
    #[serde(rename = "pendingCount")]
    pub pending_count: Option<i32>,
    #[serde(rename = "rolloutState")]
    pub rollout_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadBalancer {
    #[serde(rename = "targetGroupArn")]
    pub target_group_arn: Option<String>,
    #[serde(rename = "containerName")]
    pub container_name: Option<String>,
    #[serde(rename = "containerPort")]
    pub container_port: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfiguration {
    #[serde(rename = "awsvpcConfiguration")]
    pub awsvpc_configuration: Option<AwsVpcConfiguration>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsVpcConfiguration {
    pub subnets: Vec<String>,
    #[serde(rename = "securityGroups")]
    pub security_groups: Vec<String>,
    #[serde(rename = "assignPublicIp")]
    pub assign_public_ip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterface {
    #[serde(rename = "attachmentId")]
    pub attachment_id: Option<String>,
    #[serde(rename = "privateIpv4Address")]
    pub private_ipv4_address: Option<String>,
}

// ── ECS Client ──────────────────────────────────────────────────────────

pub struct EcsClient {
    client: AwsClient,
}

impl EcsClient {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    fn target(action: &str) -> String {
        format!("{}.{}", TARGET_PREFIX, action)
    }

    // ── Clusters ────────────────────────────────────────────────────

    pub async fn list_clusters(&self) -> AwsResult<Vec<String>> {
        let body = serde_json::json!({});
        let response = self.client.json_request(SERVICE, &Self::target("ListClusters"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("clusterArns")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn describe_clusters(&self, clusters: &[String]) -> AwsResult<Vec<Cluster>> {
        let body = serde_json::json!({ "clusters": clusters, "include": ["STATISTICS"] });
        let response = self.client.json_request(SERVICE, &Self::target("DescribeClusters"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("clusters")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn create_cluster(&self, cluster_name: &str, capacity_providers: &[String]) -> AwsResult<Cluster> {
        let mut body = serde_json::json!({ "clusterName": cluster_name });
        if !capacity_providers.is_empty() {
            body["capacityProviders"] = serde_json::to_value(capacity_providers).unwrap_or_default();
        }
        let response = self.client.json_request(SERVICE, &Self::target("CreateCluster"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("cluster")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No cluster in response", 200))
    }

    pub async fn delete_cluster(&self, cluster: &str) -> AwsResult<Cluster> {
        let body = serde_json::json!({ "cluster": cluster });
        let response = self.client.json_request(SERVICE, &Self::target("DeleteCluster"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("cluster")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No cluster in response", 200))
    }

    // ── Services ────────────────────────────────────────────────────

    pub async fn list_services(&self, cluster: &str) -> AwsResult<Vec<String>> {
        let body = serde_json::json!({ "cluster": cluster });
        let response = self.client.json_request(SERVICE, &Self::target("ListServices"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("serviceArns")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn describe_services(&self, cluster: &str, services: &[String]) -> AwsResult<Vec<Service>> {
        let body = serde_json::json!({ "cluster": cluster, "services": services });
        let response = self.client.json_request(SERVICE, &Self::target("DescribeServices"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("services")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn create_service(&self, cluster: &str, service_name: &str, task_definition: &str, desired_count: i32, launch_type: Option<&str>, network_config: Option<&NetworkConfiguration>) -> AwsResult<Service> {
        let mut body = serde_json::json!({
            "cluster": cluster,
            "serviceName": service_name,
            "taskDefinition": task_definition,
            "desiredCount": desired_count,
        });
        if let Some(lt) = launch_type {
            body["launchType"] = serde_json::Value::String(lt.to_string());
        }
        if let Some(nc) = network_config {
            body["networkConfiguration"] = serde_json::to_value(nc).unwrap_or_default();
        }
        let response = self.client.json_request(SERVICE, &Self::target("CreateService"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("service")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No service in response", 200))
    }

    pub async fn update_service(&self, cluster: &str, service: &str, desired_count: Option<i32>, task_definition: Option<&str>) -> AwsResult<Service> {
        let mut body = serde_json::json!({ "cluster": cluster, "service": service });
        if let Some(dc) = desired_count {
            body["desiredCount"] = serde_json::json!(dc);
        }
        if let Some(td) = task_definition {
            body["taskDefinition"] = serde_json::Value::String(td.to_string());
        }
        let response = self.client.json_request(SERVICE, &Self::target("UpdateService"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("service")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No service in response", 200))
    }

    pub async fn delete_service(&self, cluster: &str, service: &str, force: bool) -> AwsResult<Service> {
        let body = serde_json::json!({ "cluster": cluster, "service": service, "force": force });
        let response = self.client.json_request(SERVICE, &Self::target("DeleteService"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("service")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No service in response", 200))
    }

    // ── Tasks ───────────────────────────────────────────────────────

    pub async fn list_tasks(&self, cluster: &str, service_name: Option<&str>, desired_status: Option<&str>) -> AwsResult<Vec<String>> {
        let mut body = serde_json::json!({ "cluster": cluster });
        if let Some(sn) = service_name {
            body["serviceName"] = serde_json::Value::String(sn.to_string());
        }
        if let Some(ds) = desired_status {
            body["desiredStatus"] = serde_json::Value::String(ds.to_string());
        }
        let response = self.client.json_request(SERVICE, &Self::target("ListTasks"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("taskArns")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn describe_tasks(&self, cluster: &str, tasks: &[String]) -> AwsResult<Vec<Task>> {
        let body = serde_json::json!({ "cluster": cluster, "tasks": tasks });
        let response = self.client.json_request(SERVICE, &Self::target("DescribeTasks"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("tasks")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn run_task(&self, cluster: &str, task_definition: &str, count: i32, launch_type: Option<&str>, network_config: Option<&NetworkConfiguration>) -> AwsResult<Vec<Task>> {
        let mut body = serde_json::json!({
            "cluster": cluster,
            "taskDefinition": task_definition,
            "count": count,
        });
        if let Some(lt) = launch_type {
            body["launchType"] = serde_json::Value::String(lt.to_string());
        }
        if let Some(nc) = network_config {
            body["networkConfiguration"] = serde_json::to_value(nc).unwrap_or_default();
        }
        let response = self.client.json_request(SERVICE, &Self::target("RunTask"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("tasks")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }

    pub async fn stop_task(&self, cluster: &str, task: &str, reason: Option<&str>) -> AwsResult<Task> {
        let mut body = serde_json::json!({ "cluster": cluster, "task": task });
        if let Some(r) = reason {
            body["reason"] = serde_json::Value::String(r.to_string());
        }
        let response = self.client.json_request(SERVICE, &Self::target("StopTask"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("task")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No task in response", 200))
    }

    // ── Task Definitions ────────────────────────────────────────────

    pub async fn register_task_definition(&self, family: &str, container_definitions: &[ContainerDefinition], cpu: Option<&str>, memory: Option<&str>, network_mode: Option<&str>, requires_compatibilities: &[String], execution_role_arn: Option<&str>, task_role_arn: Option<&str>) -> AwsResult<TaskDefinition> {
        let mut body = serde_json::json!({
            "family": family,
            "containerDefinitions": container_definitions,
        });
        if let Some(c) = cpu { body["cpu"] = serde_json::Value::String(c.to_string()); }
        if let Some(m) = memory { body["memory"] = serde_json::Value::String(m.to_string()); }
        if let Some(nm) = network_mode { body["networkMode"] = serde_json::Value::String(nm.to_string()); }
        if !requires_compatibilities.is_empty() {
            body["requiresCompatibilities"] = serde_json::to_value(requires_compatibilities).unwrap_or_default();
        }
        if let Some(era) = execution_role_arn { body["executionRoleArn"] = serde_json::Value::String(era.to_string()); }
        if let Some(tra) = task_role_arn { body["taskRoleArn"] = serde_json::Value::String(tra.to_string()); }
        let response = self.client.json_request(SERVICE, &Self::target("RegisterTaskDefinition"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("taskDefinition")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No taskDefinition in response", 200))
    }

    pub async fn deregister_task_definition(&self, task_definition: &str) -> AwsResult<TaskDefinition> {
        let body = serde_json::json!({ "taskDefinition": task_definition });
        let response = self.client.json_request(SERVICE, &Self::target("DeregisterTaskDefinition"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        result.get("taskDefinition")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No taskDefinition in response", 200))
    }

    pub async fn list_task_definitions(&self, family_prefix: Option<&str>, status: Option<&str>) -> AwsResult<Vec<String>> {
        let mut body = serde_json::json!({});
        if let Some(fp) = family_prefix {
            body["familyPrefix"] = serde_json::Value::String(fp.to_string());
        }
        if let Some(s) = status {
            body["status"] = serde_json::Value::String(s.to_string());
        }
        let response = self.client.json_request(SERVICE, &Self::target("ListTaskDefinitions"), &body.to_string()).await?;
        let result: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|e| AwsError::new(SERVICE, "ParseError", &e.to_string(), response.status))?;
        Ok(result.get("taskDefinitionArns")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cluster_serde() {
        let c = Cluster {
            cluster_arn: Some("arn:aws:ecs:us-east-1:123:cluster/my-cluster".to_string()),
            cluster_name: "my-cluster".to_string(),
            status: Some("ACTIVE".to_string()),
            registered_container_instances_count: Some(3),
            running_tasks_count: Some(5),
            pending_tasks_count: Some(0),
            active_services_count: Some(2),
            capacity_providers: vec!["FARGATE".to_string()],
        };
        let json = serde_json::to_string(&c).unwrap();
        let back: Cluster = serde_json::from_str(&json).unwrap();
        assert_eq!(back.cluster_name, "my-cluster");
    }

    #[test]
    fn container_definition_serde() {
        let cd = ContainerDefinition {
            name: "web".to_string(),
            image: Some("nginx:latest".to_string()),
            cpu: Some(256),
            memory: Some(512),
            memory_reservation: None,
            essential: Some(true),
            port_mappings: vec![PortMapping { container_port: Some(80), host_port: Some(80), protocol: Some("tcp".to_string()) }],
            environment: vec![KeyValuePair { name: Some("ENV".to_string()), value: Some("prod".to_string()) }],
            log_configuration: Some(LogConfiguration {
                log_driver: "awslogs".to_string(),
                options: [("awslogs-group".to_string(), "/ecs/my-app".to_string())].into(),
            }),
            command: vec![],
            health_check: None,
        };
        let json = serde_json::to_string(&cd).unwrap();
        assert!(json.contains("nginx:latest"));
    }
}

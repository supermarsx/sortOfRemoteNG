// ── sorng-terraform/src/graph.rs ──────────────────────────────────────────────
//! `terraform graph` — dependency graph generation and DOT parsing.

use regex::Regex;

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::*;

pub struct GraphManager;

impl GraphManager {
    /// Run `terraform graph` and return the raw DOT output plus parsed nodes/edges.
    pub async fn generate(
        client: &TerraformClient,
        graph_type: Option<&str>,
    ) -> TerraformResult<GraphResult> {
        let mut args = vec!["graph"];
        if let Some(t) = graph_type {
            args.push("-type");
            args.push(t);
        }

        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::GraphFailed,
                format!("terraform graph failed: {}", output.stderr),
            ));
        }

        let dot = output.stdout.clone();
        let nodes = Self::parse_nodes(&dot);
        let edges = Self::parse_edges(&dot);

        Ok(GraphResult { dot, nodes, edges })
    }

    /// Generate a plan graph (requires a plan file).
    pub async fn generate_plan_graph(
        client: &TerraformClient,
        plan_file: &str,
    ) -> TerraformResult<GraphResult> {
        let args = ["graph", "-plan", plan_file];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::GraphFailed,
                format!("terraform graph -plan failed: {}", output.stderr),
            ));
        }

        let dot = output.stdout.clone();
        let nodes = Self::parse_nodes(&dot);
        let edges = Self::parse_edges(&dot);

        Ok(GraphResult { dot, nodes, edges })
    }

    /// Parse nodes from DOT format.
    fn parse_nodes(dot: &str) -> Vec<GraphNode> {
        // Match lines like: "aws_instance.web" [label = "aws_instance.web"]
        let node_re = Regex::new(r#""([^"]+)"\s*\[label\s*=\s*"([^"]*)"\]"#).expect("valid regex literal");

        let mut nodes = Vec::new();
        for cap in node_re.captures_iter(dot) {
            let id = cap[1].to_string();
            let label = cap[2].to_string();
            let node_type = Self::classify_node(&id, &label);
            nodes.push(GraphNode {
                id,
                label,
                node_type,
            });
        }

        // Also match simple node declarations (just the identifier on a line)
        let simple_re = Regex::new(r#"^\s+"([^"]+)"\s*;?\s*$"#).expect("valid regex literal");
        for cap in simple_re.captures_iter(dot) {
            let id = cap[1].to_string();
            if !nodes.iter().any(|n| n.id == id) {
                let node_type = Self::classify_node(&id, &id);
                nodes.push(GraphNode {
                    label: id.clone(),
                    id,
                    node_type,
                });
            }
        }

        nodes
    }

    /// Parse edges from DOT format.
    fn parse_edges(dot: &str) -> Vec<GraphEdge> {
        let edge_re = Regex::new(r#""([^"]+)"\s*->\s*"([^"]+)""#).expect("valid regex literal");

        edge_re
            .captures_iter(dot)
            .map(|cap| GraphEdge {
                from: cap[1].to_string(),
                to: cap[2].to_string(),
            })
            .collect()
    }

    /// Classify a node by its name/label into a category.
    fn classify_node(id: &str, _label: &str) -> GraphNodeType {
        if id.starts_with("[root]") || id == "root" {
            GraphNodeType::Root
        } else if id.starts_with("provider[") || id.starts_with("provider.") {
            GraphNodeType::Provider
        } else if id.starts_with("module.") {
            GraphNodeType::Module
        } else if id.starts_with("data.") {
            GraphNodeType::DataSource
        } else if id.starts_with("var.") {
            GraphNodeType::Variable
        } else if id.starts_with("output.") {
            GraphNodeType::Output
        } else if id.starts_with("local.") {
            GraphNodeType::Local
        } else if id.contains('.') {
            // e.g. aws_instance.web → resource
            GraphNodeType::Resource
        } else {
            GraphNodeType::Unknown
        }
    }
}

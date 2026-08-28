import {
  Activity,
  BarChart3,
  Bot,
  Bug,
  ChartNoAxesCombined,
  Code2,
  FileCode2,
  Gauge,
  GitBranch,
  GitCommit,
  Package,
  PanelTop,
  Settings,
  SquareKanban,
  TestTube2,
  Webhook,
  Workflow,
  Wrench,
} from "lucide-react";

import { defineIcon } from "./types";

export const DEVOPS_MONITORING_ICONS = [
  defineIcon("activity", "Activity", "devops-monitoring", Activity, [
    "prometheus",
    "monitoring",
    "health",
  ]),
  defineIcon("bar-chart", "Dashboard", "devops-monitoring", BarChart3, [
    "grafana",
    "metrics",
    "chart",
  ]),
  defineIcon("chart", "Analytics", "devops-monitoring", ChartNoAxesCombined, [
    "analytics",
    "trend",
  ]),
  defineIcon("gauge", "Performance", "devops-monitoring", Gauge, [
    "speed",
    "metrics",
  ]),
  defineIcon("workflow", "Automation", "devops-monitoring", Workflow, [
    "ansible",
    "pipeline",
  ]),
  defineIcon("git-branch", "Git branch", "devops-monitoring", GitBranch, [
    "git",
    "source control",
  ]),
  defineIcon("git-commit", "Git commit", "devops-monitoring", GitCommit, [
    "git",
    "revision",
  ]),
  defineIcon("package", "Package", "devops-monitoring", Package, [
    "artifact",
    "deployment",
  ]),
  defineIcon("wrench", "Tools", "devops-monitoring", Wrench, [
    "maintenance",
    "admin",
  ]),
  defineIcon("settings", "Settings", "devops-monitoring", Settings, [
    "configuration",
    "admin",
  ]),
  defineIcon("code", "Code", "devops-monitoring", Code2, [
    "development",
    "source",
  ]),
  defineIcon("file-code", "Code file", "devops-monitoring", FileCode2, [
    "php",
    "script",
  ]),
  defineIcon("bug", "Issue", "devops-monitoring", Bug, ["debug", "problem"]),
  defineIcon("test-tube", "Test", "devops-monitoring", TestTube2, [
    "qa",
    "lab",
  ]),
  defineIcon("kanban", "Kanban", "devops-monitoring", SquareKanban, [
    "jira",
    "tasks",
  ]),
  defineIcon("panel", "Control panel", "devops-monitoring", PanelTop, [
    "cpanel",
    "dashboard",
  ]),
  defineIcon("bot", "Automation bot", "devops-monitoring", Bot, [
    "agent",
    "automation",
  ]),
  defineIcon("webhook", "Webhook", "devops-monitoring", Webhook, [
    "event",
    "integration",
  ]),
] as const;

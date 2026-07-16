import {
  Activity,
  Archive,
  AtSign,
  BarChart3,
  Bell,
  Bookmark,
  Bot,
  Boxes,
  Bug,
  Cable,
  Camera,
  ChartNoAxesCombined,
  Circle,
  CircleDot,
  Cloud,
  CloudCog,
  CloudDownload,
  CloudLightning,
  CloudUpload,
  Code2,
  Container,
  Cpu,
  Database,
  DatabaseBackup,
  DatabaseZap,
  Diamond,
  Download,
  Eye,
  File,
  FileCode2,
  FileKey2,
  FileText,
  Fingerprint,
  Flag,
  Folder,
  FolderOpen,
  Gauge,
  GitBranch,
  GitCommit,
  Globe,
  HardDrive,
  Heart,
  Hexagon,
  Keyboard,
  KeyRound,
  Laptop,
  LifeBuoy,
  Link,
  Lock,
  Mail,
  Mailbox,
  MessageSquare,
  MessagesSquare,
  Monitor,
  MonitorPlay,
  MousePointer2,
  Network,
  Package,
  PanelTop,
  Phone,
  Printer,
  Radio,
  RadioTower,
  Route,
  Router,
  Save,
  ScanFace,
  Send,
  Server,
  ServerCog,
  Settings,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Square,
  SquareKanban,
  Star,
  Table2,
  Tablet,
  Tag,
  Terminal,
  TestTube2,
  Triangle,
  Tv,
  Upload,
  Waypoints,
  Webhook,
  Wifi,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const CONNECTION_ICON_CATEGORIES = [
  "remote-protocols",
  "servers-devices",
  "network",
  "cloud",
  "databases",
  "devops-monitoring",
  "security",
  "files",
  "communication",
  "generic-shapes",
] as const;

export type ConnectionIconCategory =
  (typeof CONNECTION_ICON_CATEGORIES)[number];

export interface ConnectionIconDefinition<Key extends string = string> {
  /** Stable persisted value. Never derive this from a component name. */
  key: Key;
  label: string;
  category: ConnectionIconCategory;
  icon: LucideIcon;
  /** Screen-reader label suitable for an icon-only control. */
  ariaLabel: string;
  description: string;
  keywords: readonly string[];
}

function defineIcon<const Key extends string>(
  key: Key,
  label: string,
  category: ConnectionIconCategory,
  icon: LucideIcon,
  keywords: readonly string[],
  description = `${label} connection icon`,
): ConnectionIconDefinition<Key> {
  return {
    key,
    label,
    category,
    icon,
    ariaLabel: `${label} icon`,
    description,
    keywords,
  };
}

/**
 * Broad, categorized catalog of string-keyed connection icons.
 *
 * The original ten saved keys (`monitor`, `terminal`, `globe`, `database`,
 * `server`, `shield`, `cloud`, `folder`, `star`, `drive`) retain their exact
 * key/component pairing for backward compatibility.
 */
export const CONNECTION_ICON_CATALOG = [
  // Remote protocols
  defineIcon("monitor", "Desktop", "remote-protocols", Monitor, [
    "rdp",
    "desktop",
    "remote",
    "screen",
  ]),
  defineIcon("terminal", "Terminal", "remote-protocols", Terminal, [
    "ssh",
    "shell",
    "console",
  ]),
  defineIcon("eye", "Viewer", "remote-protocols", Eye, [
    "vnc",
    "ard",
    "apple remote desktop",
    "macos screen sharing",
    "view",
  ]),
  defineIcon("phone", "Legacy terminal", "remote-protocols", Phone, [
    "telnet",
    "rlogin",
  ]),
  defineIcon(
    "monitor-play",
    "Remote session",
    "remote-protocols",
    MonitorPlay,
    ["remote", "session", "vmware"],
  ),
  defineIcon("keyboard", "Keyboard", "remote-protocols", Keyboard, [
    "input",
    "console",
  ]),
  defineIcon("pointer", "Pointer", "remote-protocols", MousePointer2, [
    "mouse",
    "remote control",
  ]),

  // Servers and devices
  defineIcon("server", "Server", "servers-devices", Server, [
    "host",
    "machine",
  ]),
  defineIcon("server-cog", "Managed server", "servers-devices", ServerCog, [
    "admin",
    "management",
  ]),
  defineIcon("cpu", "Compute", "servers-devices", Cpu, [
    "processor",
    "hardware",
  ]),
  defineIcon("drive", "Drive", "servers-devices", HardDrive, [
    "disk",
    "storage",
  ]),
  defineIcon("laptop", "Laptop", "servers-devices", Laptop, [
    "computer",
    "workstation",
  ]),
  defineIcon("smartphone", "Phone device", "servers-devices", Smartphone, [
    "mobile",
    "device",
  ]),
  defineIcon("tablet", "Tablet", "servers-devices", Tablet, ["device"]),
  defineIcon("television", "Display", "servers-devices", Tv, [
    "screen",
    "display",
  ]),
  defineIcon("printer", "Printer", "servers-devices", Printer, [
    "print",
    "device",
  ]),
  defineIcon("camera", "Camera", "servers-devices", Camera, [
    "surveillance",
    "video",
  ]),
  defineIcon("container", "Container", "servers-devices", Container, [
    "docker",
    "runtime",
  ]),
  defineIcon("boxes", "Cluster", "servers-devices", Boxes, [
    "lxd",
    "cluster",
    "services",
  ]),

  // Network
  defineIcon("globe", "Web", "network", Globe, ["http", "https", "internet"]),
  defineIcon("network", "Network", "network", Network, [
    "lan",
    "topology",
    "netbox",
  ]),
  defineIcon("router", "Router", "network", Router, ["gateway", "appliance"]),
  defineIcon("wifi", "Wireless", "network", Wifi, ["wifi", "wlan"]),
  defineIcon("cable", "Wired network", "network", Cable, ["ethernet", "wired"]),
  defineIcon("waypoints", "Route", "network", Waypoints, [
    "proxy",
    "traefik",
    "path",
  ]),
  defineIcon("radio-tower", "Radio tower", "network", RadioTower, [
    "wireless",
    "signal",
  ]),
  defineIcon("route", "Network route", "network", Route, ["routing", "path"]),
  defineIcon("link", "Link", "network", Link, ["connection", "chain"]),
  defineIcon("share", "Shared network", "network", Share2, ["share", "smb"]),
  defineIcon("radio", "Radio", "network", Radio, ["wol", "signal"]),

  // Cloud
  defineIcon("cloud", "Cloud", "cloud", Cloud, ["azure", "gcp", "provider"]),
  defineIcon("cloud-cog", "Managed cloud", "cloud", CloudCog, [
    "cloud admin",
    "service",
  ]),
  defineIcon("cloud-upload", "Cloud upload", "cloud", CloudUpload, [
    "upload",
    "sync",
  ]),
  defineIcon("cloud-download", "Cloud download", "cloud", CloudDownload, [
    "download",
    "sync",
  ]),
  defineIcon("cloud-lightning", "Cloud compute", "cloud", CloudLightning, [
    "compute",
    "serverless",
  ]),

  // Databases
  defineIcon("database", "Database", "databases", Database, [
    "sql",
    "mysql",
    "mssql",
  ]),
  defineIcon(
    "database-backup",
    "Database backup",
    "databases",
    DatabaseBackup,
    ["backup", "restore"],
  ),
  defineIcon("database-zap", "Live database", "databases", DatabaseZap, [
    "query",
    "performance",
  ]),
  defineIcon("table", "Data table", "databases", Table2, ["rows", "records"]),

  // DevOps and monitoring
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

  // Security
  defineIcon("shield", "Shield", "security", Shield, [
    "security",
    "protection",
  ]),
  defineIcon("shield-check", "Protected", "security", ShieldCheck, [
    "pfsense",
    "verified",
    "firewall",
  ]),
  defineIcon("shield-alert", "Security alert", "security", ShieldAlert, [
    "warning",
    "threat",
  ]),
  defineIcon("lock", "Locked", "security", Lock, ["secure", "encrypted"]),
  defineIcon("key-round", "Key", "security", KeyRound, [
    "keepass",
    "credential",
  ]),
  defineIcon("fingerprint", "Identity", "security", Fingerprint, [
    "authentication",
    "biometric",
  ]),
  defineIcon("scan-face", "Identity scan", "security", ScanFace, [
    "face",
    "authentication",
  ]),
  defineIcon("file-key", "Key file", "security", FileKey2, [
    "certificate",
    "private key",
  ]),

  // Files
  defineIcon("folder", "Folder", "files", Folder, ["group", "directory"]),
  defineIcon("folder-open", "Open folder", "files", FolderOpen, [
    "directory",
    "browse",
  ]),
  defineIcon("file", "File", "files", File, ["document"]),
  defineIcon("file-text", "Text file", "files", FileText, [
    "document",
    "notes",
  ]),
  defineIcon("archive", "Archive", "files", Archive, ["backup", "compressed"]),
  defineIcon("save", "Saved data", "files", Save, ["disk", "persist"]),
  defineIcon("upload", "Upload", "files", Upload, ["transfer", "send"]),
  defineIcon("download", "Download", "files", Download, [
    "transfer",
    "receive",
  ]),

  // Communication
  defineIcon("mail", "Mail", "communication", Mail, ["exchange", "email"]),
  defineIcon("mailbox", "Mailbox", "communication", Mailbox, [
    "mailcow",
    "email",
  ]),
  defineIcon("message", "Message", "communication", MessageSquare, [
    "chat",
    "comment",
  ]),
  defineIcon("messages", "Messages", "communication", MessagesSquare, [
    "chat",
    "conversation",
  ]),
  defineIcon("send", "Send", "communication", Send, ["message", "outbound"]),
  defineIcon("bell", "Notification", "communication", Bell, [
    "alert",
    "notification",
  ]),
  defineIcon("life-buoy", "Support", "communication", LifeBuoy, [
    "osticket",
    "helpdesk",
  ]),
  defineIcon("at-sign", "Account", "communication", AtSign, [
    "email",
    "identity",
  ]),

  // Generic shapes and markers
  defineIcon("star", "Star", "generic-shapes", Star, ["favorite", "important"]),
  defineIcon("heart", "Heart", "generic-shapes", Heart, ["favorite", "health"]),
  defineIcon("circle", "Circle", "generic-shapes", Circle, ["shape"]),
  defineIcon("circle-dot", "Dot", "generic-shapes", CircleDot, [
    "status",
    "shape",
  ]),
  defineIcon("square", "Square", "generic-shapes", Square, ["shape"]),
  defineIcon("triangle", "Triangle", "generic-shapes", Triangle, [
    "shape",
    "warning",
  ]),
  defineIcon("diamond", "Diamond", "generic-shapes", Diamond, ["shape"]),
  defineIcon("hexagon", "Hexagon", "generic-shapes", Hexagon, ["shape"]),
  defineIcon("bookmark", "Bookmark", "generic-shapes", Bookmark, [
    "saved",
    "marker",
  ]),
  defineIcon("tag", "Tag", "generic-shapes", Tag, ["label", "organize"]),
  defineIcon("flag", "Flag", "generic-shapes", Flag, ["marker", "important"]),
] as const;

export type ConnectionIconKey = (typeof CONNECTION_ICON_CATALOG)[number]["key"];

const CONNECTION_ICON_BY_KEY = new Map<
  ConnectionIconKey,
  ConnectionIconDefinition<ConnectionIconKey>
>(CONNECTION_ICON_CATALOG.map((definition) => [definition.key, definition]));

export const CONNECTION_ICON_REGISTRY = Object.freeze(
  Object.fromEntries(
    CONNECTION_ICON_CATALOG.map(({ key, icon }) => [key, icon]),
  ),
) as Readonly<Record<ConnectionIconKey, LucideIcon>>;

export function normalizeConnectionIconKey(key: string | undefined): string {
  return key?.trim().toLowerCase() ?? "";
}

export function isConnectionIconKey(key: string | undefined): boolean {
  return CONNECTION_ICON_BY_KEY.has(
    normalizeConnectionIconKey(key) as ConnectionIconKey,
  );
}

export function getConnectionIconDefinition(
  key: string | undefined,
): ConnectionIconDefinition<ConnectionIconKey> | undefined {
  return CONNECTION_ICON_BY_KEY.get(
    normalizeConnectionIconKey(key) as ConnectionIconKey,
  );
}

export function getConnectionIconsByCategory(
  category: ConnectionIconCategory,
): readonly ConnectionIconDefinition<ConnectionIconKey>[] {
  return CONNECTION_ICON_CATALOG.filter(
    (definition) => definition.category === category,
  );
}

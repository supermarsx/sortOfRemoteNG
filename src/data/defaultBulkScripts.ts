export interface SavedBulkScript {
  id: string;
  name: string;
  description: string;
  script: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export const defaultBulkScripts: SavedBulkScript[] = [
  {
    id: "default-1",
    name: "System Info",
    description: "Get basic system information",
    script:
      "uname -a && cat /etc/os-release 2>/dev/null || cat /etc/redhat-release 2>/dev/null",
    category: "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-2",
    name: "Disk Usage",
    description: "Check disk space usage",
    script: "df -h",
    category: "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-3",
    name: "Memory Usage",
    description: "Check memory usage",
    script: "free -h",
    category: "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-4",
    name: "Running Processes",
    description: "List top processes by CPU",
    script: "ps aux --sort=-%cpu | head -10",
    category: "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-5",
    name: "Network Connections",
    description: "Show active network connections",
    script: "netstat -tuln 2>/dev/null || ss -tuln",
    category: "Network",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "default-6",
    name: "Uptime",
    description: "Show system uptime",
    script: "uptime",
    category: "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

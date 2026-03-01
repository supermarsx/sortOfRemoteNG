
export const getProtocolIcon = (protocol: string) => {
  switch (protocol) {
    case "rdp": return Monitor;
    case "ssh": return Terminal;
    case "vnc": return Eye;
    case "http": case "https": return Globe;
    case "telnet": case "rlogin": return Phone;
    case "mysql": return Database;
    default: return Monitor;
  }
};

export const iconRegistry: Record<string, typeof Monitor> = {
  monitor: Monitor, terminal: Terminal, globe: Globe, database: Database,
  server: Server, shield: Shield, cloud: Cloud, folder: Folder,
  star: Star, drive: HardDrive,
};

export const getConnectionIcon = (connection: Connection) => {
  const key = (connection.icon || "").toLowerCase();
  if (key && iconRegistry[key]) return iconRegistry[key];
  return getProtocolIcon(connection.protocol);
};

export const getStatusColor = (status?: string) => {
  switch (status) {
    case "connected": return "text-green-400";
    case "connecting": return "text-yellow-400";
    case "error": return "text-red-400";
    default: return "text-[var(--color-textSecondary)]";
  }
};

/* ── ConnectionTreeItem ────────────────────────────────────────── */

export interface ConnectionTreeItemProps {
  connection: Connection;
  level: number;
  onConnect: (connection: Connection) => void;
  onDisconnect: (connection: Connection) => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onCopyHostname: (connection: Connection) => void;
  onRename: (connection: Connection) => void;
  onExport: (connection: Connection) => void;
  onConnectWithOptions: (connection: Connection) => void;
  onConnectWithoutCredentials: (connection: Connection) => void;
  onExecuteScripts: (connection: Connection, sessionId?: string) => void;
  onDiagnostics: (connection: Connection) => void;
  onDetachSession: (sessionId: string) => void;
  onDuplicate: (connection: Connection) => void;
  enableReorder: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  dropPosition: "before" | "after" | "inside" | null;
  onDragStart: (connectionId: string) => void;
  onDragOver: (connectionId: string, position: "before" | "after" | "inside") => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: (connectionId: string, position: "before" | "after" | "inside") => void;
  singleClickConnect?: boolean;
  singleClickDisconnect?: boolean;
  doubleClickRename?: boolean;
}


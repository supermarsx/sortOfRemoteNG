import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Search, RefreshCw, Loader2, AlertCircle, Download,
  ChevronRight, ChevronDown, FolderOpen, Folder,
  FileText, Hash, Binary,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { WinmgmtContext } from "../WinmgmtWrapper";
import type {
  RegistryHive,
  RegistryExportFormat,
  RegistryValue,
  RegistryValueType,
  RegistrySearchResult,
  RegistrySearchFilter,
} from "../../../types/windows/winmgmt";

const HIVES: { id: RegistryHive; label: string; short: string }[] = [
  { id: "hkeyLocalMachine", label: "HKEY_LOCAL_MACHINE", short: "HKLM" },
  { id: "hkeyCurrentUser", label: "HKEY_CURRENT_USER", short: "HKCU" },
  { id: "hkeyClassesRoot", label: "HKEY_CLASSES_ROOT", short: "HKCR" },
  { id: "hkeyUsers", label: "HKEY_USERS", short: "HKU" },
  { id: "hkeyCurrentConfig", label: "HKEY_CURRENT_CONFIG", short: "HKCC" },
];

const VALUE_TYPE_ICON: Record<RegistryValueType, React.ReactNode> = {
  string: <FileText size={10} className="text-blue-400" />,
  expandString: <FileText size={10} className="text-cyan-400" />,
  multiString: <FileText size={10} className="text-teal-400" />,
  dWord: <Hash size={10} className="text-orange-400" />,
  qWord: <Hash size={10} className="text-yellow-400" />,
  binary: <Binary size={10} className="text-purple-400" />,
  unknown: <FileText size={10} className="text-[var(--color-textMuted)]" />,
};

interface TreeNode {
  name: string;
  path: string;
  expanded: boolean;
  children: TreeNode[] | null; // null = not loaded
  loading: boolean;
}

interface VisibleTreeNode {
  node: TreeNode;
  depth: number;
  parentPath: string | null;
}

const flattenVisibleNodes = (
  nodes: TreeNode[],
  depth = 1,
  parentPath: string | null = null,
): VisibleTreeNode[] => nodes.flatMap((node) => {
  const current: VisibleTreeNode = { node, depth, parentPath };
  if (!node.expanded || !node.children?.length) return [current];
  return [current, ...flattenVisibleNodes(node.children, depth + 1, node.path)];
});

interface RegistryPanelProps {
  ctx: WinmgmtContext;
}

const RegistryPanel: React.FC<RegistryPanelProps> = ({ ctx }) => {
  const [hive, setHive] = useState<RegistryHive>("hkeyLocalMachine");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [values, setValues] = useState<RegistryValue[]>([]);
  const [subkeys, setSubkeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RegistrySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [focusedNodePath, setFocusedNodePath] = useState<string | null>(null);
  const treeItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const loadKeys = useCallback(
    async (path: string): Promise<string[]> => {
      return ctx.cmd<string[]>("winmgmt_registry_enum_keys", {
        hive,
        path,
      });
    },
    [ctx, hive],
  );

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const keys = await loadKeys("");
      setTree(
        keys.map((k) => ({
          name: k,
          path: k,
          expanded: false,
          children: null,
          loading: false,
        })),
      );
      setTreeLoaded(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loadKeys]);

  const toggleNode = useCallback(
    async (path: string) => {
      const updateTree = (
        nodes: TreeNode[],
        targetPath: string,
      ): TreeNode[] => {
        return nodes.map((node) => {
          if (node.path === targetPath) {
            return { ...node, expanded: !node.expanded };
          }
          if (node.children) {
            return { ...node, children: updateTree(node.children, targetPath) };
          }
          return node;
        });
      };

      const setNodeLoading = (
        nodes: TreeNode[],
        targetPath: string,
        isLoading: boolean,
      ): TreeNode[] => {
        return nodes.map((node) => {
          if (node.path === targetPath) {
            return { ...node, loading: isLoading };
          }
          if (node.children) {
            return {
              ...node,
              children: setNodeLoading(node.children, targetPath, isLoading),
            };
          }
          return node;
        });
      };

      const setNodeChildren = (
        nodes: TreeNode[],
        targetPath: string,
        children: TreeNode[],
      ): TreeNode[] => {
        return nodes.map((node) => {
          if (node.path === targetPath) {
            return {
              ...node,
              children,
              expanded: true,
              loading: false,
            };
          }
          if (node.children) {
            return {
              ...node,
              children: setNodeChildren(node.children, targetPath, children),
            };
          }
          return node;
        });
      };

      // Find the node
      const findNode = (
        nodes: TreeNode[],
        targetPath: string,
      ): TreeNode | null => {
        for (const n of nodes) {
          if (n.path === targetPath) return n;
          if (n.children) {
            const found = findNode(n.children, targetPath);
            if (found) return found;
          }
        }
        return null;
      };

      const node = findNode(tree, path);
      if (!node) return;

      if (node.expanded) {
        setTree((t) => updateTree(t, path));
        return;
      }

      if (node.children !== null) {
        setTree((t) => updateTree(t, path));
        return;
      }

      // Load children
      setTree((t) => setNodeLoading(t, path, true));
      try {
        const keys = await loadKeys(path);
        const children = keys.map((k) => ({
          name: k,
          path: `${path}\\${k}`,
          expanded: false,
          children: null as TreeNode[] | null,
          loading: false,
        }));
        setTree((t) => setNodeChildren(t, path, children));
      } catch {
        setTree((t) => setNodeLoading(t, path, false));
      }
    },
    [tree, loadKeys],
  );

  const selectKey = useCallback(
    async (path: string) => {
      setSelectedPath(path);
      setLoading(true);
      try {
        const info = await ctx.cmd<{ subkeys: string[]; values: RegistryValue[] }>(
          "winmgmt_registry_get_key_info",
          { hive, path },
        );
        setValues(info.values);
        setSubkeys(info.subkeys);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [ctx, hive],
  );

  const doSearch = useCallback(async () => {
    if (!searchQuery) return;
    setSearching(true);
    setError(null);
    try {
      const filter: RegistrySearchFilter = {
        hive,
        rootPath: selectedPath || "",
        pattern: searchQuery,
        isRegex: false,
        searchKeys: true,
        searchValueNames: true,
        searchValueData: true,
        maxDepth: 5,
        maxResults: 100,
      };
      const results = await ctx.cmd<RegistrySearchResult[]>(
        "winmgmt_registry_search",
        { filter },
      );
      setSearchResults(results);
    } catch (err) {
      setError(String(err));
    } finally {
      setSearching(false);
    }
  }, [ctx, hive, selectedPath, searchQuery]);

  const visibleNodes = useMemo(() => flattenVisibleNodes(tree), [tree]);

  useEffect(() => {
    if (visibleNodes.length === 0) {
      setFocusedNodePath(null);
      return;
    }

    if (!focusedNodePath || !visibleNodes.some((item) => item.node.path === focusedNodePath)) {
      setFocusedNodePath(visibleNodes[0].node.path);
    }
  }, [visibleNodes, focusedNodePath]);

  const focusTreeItem = useCallback((path: string) => {
    setFocusedNodePath(path);
    requestAnimationFrame(() => {
      treeItemRefs.current[path]?.focus();
    });
  }, []);

  const exportRegistry = useCallback(async (format: RegistryExportFormat) => {
    if (!selectedPath) return;

    try {
      const exported = await ctx.cmd<string>("winmgmt_registry_export", {
        hive,
        path: selectedPath,
        format,
      });

      const extension = format === "json" ? "json" : "reg";
      const baseName = selectedPath.split("\\").pop() || "registry";
      const targetPath = await save({
        defaultPath: `${baseName}.${extension}`,
        filters: [
          {
            name: format === "json" ? "JSON Files" : "Registry Files",
            extensions: [extension],
          },
        ],
      });

      if (targetPath) {
        await writeTextFile(targetPath, exported);
      }
    } catch (err) {
      setError(String(err));
    }
  }, [ctx, hive, selectedPath]);

  const handleTreeKeyDown = useCallback(async (
    event: React.KeyboardEvent<HTMLButtonElement>,
    node: TreeNode,
    parentPath: string | null,
  ) => {
    const currentIndex = visibleNodes.findIndex((item) => item.node.path === node.path);
    if (currentIndex < 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (currentIndex < visibleNodes.length - 1) {
          focusTreeItem(visibleNodes[currentIndex + 1].node.path);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (currentIndex > 0) {
          focusTreeItem(visibleNodes[currentIndex - 1].node.path);
        }
        break;
      case "ArrowRight":
        event.preventDefault();
        if (node.expanded && node.children && node.children.length > 0) {
          focusTreeItem(node.children[0].path);
        } else {
          await toggleNode(node.path);
          focusTreeItem(node.path);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (node.expanded) {
          await toggleNode(node.path);
          focusTreeItem(node.path);
        } else if (parentPath) {
          focusTreeItem(parentPath);
        }
        break;
      case "Home":
        event.preventDefault();
        focusTreeItem(visibleNodes[0].node.path);
        break;
      case "End":
        event.preventDefault();
        focusTreeItem(visibleNodes[visibleNodes.length - 1].node.path);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        await selectKey(node.path);
        await toggleNode(node.path);
        focusTreeItem(node.path);
        break;
      default:
        break;
    }
  }, [focusTreeItem, selectKey, toggleNode, visibleNodes]);

  // Render tree node recursively
  const renderNode = (node: TreeNode, depth: number, parentPath: string | null) => (
    <div key={node.path}>
      <button
        type="button"
        ref={(element) => {
          treeItemRefs.current[node.path] = element;
        }}
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={node.expanded}
        aria-selected={selectedPath === node.path}
        tabIndex={focusedNodePath === node.path ? 0 : -1}
        className={`flex items-center gap-1 px-2 py-0.5 cursor-pointer text-xs hover:bg-[var(--color-surfaceHover)] transition-colors ${
          selectedPath === node.path
            ? "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-accent)]"
            : "text-[var(--color-text)]"
        } focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={async () => {
          setFocusedNodePath(node.path);
          await selectKey(node.path);
          await toggleNode(node.path);
        }}
        onFocus={() => setFocusedNodePath(node.path)}
        onKeyDown={(event) => {
          void handleTreeKeyDown(event, node, parentPath);
        }}
      >
        {node.loading ? (
          <Loader2 size={12} className="animate-spin shrink-0" />
        ) : node.expanded ? (
          <ChevronDown size={12} className="shrink-0 text-[var(--color-textMuted)]" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-[var(--color-textMuted)]" />
        )}
        {node.expanded ? (
          <FolderOpen size={12} className="shrink-0 text-yellow-400" />
        ) : (
          <Folder size={12} className="shrink-0 text-yellow-400" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {node.expanded &&
        node.children?.map((child) => renderNode(child, depth + 1, node.path))}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <select
          value={hive}
          onChange={(e) => {
            setHive(e.target.value as RegistryHive);
            setTree([]);
            setTreeLoaded(false);
            setSelectedPath(null);
            setValues([]);
          }}
          className="text-xs px-2 py-1.5 rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)]"
        >
          {HIVES.map((h) => (
            <option key={h.id} value={h.id}>
              {h.short}
            </option>
          ))}
        </select>

        <div className="relative flex-1 max-w-xs">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search registry…"
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-textMuted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        <button
          onClick={doSearch}
          disabled={searching || !searchQuery}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          aria-label="Search registry"
        >
          {searching ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
        </button>

        <button
          onClick={() => {
            setTree([]);
            setTreeLoaded(false);
            loadRoot();
          }}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>

        <button
          type="button"
          onClick={() => void exportRegistry("regFile")}
          disabled={!selectedPath}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={14} />
          Export .reg
        </button>

        <button
          type="button"
          onClick={() => void exportRegistry("json")}
          disabled={!selectedPath}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={14} />
          Export JSON
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-[var(--color-error)] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] flex items-center gap-1.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {/* Path breadcrumb */}
      {selectedPath && (
        <div className="px-3 py-1.5 text-xs font-mono text-[var(--color-textSecondary)] border-b border-[var(--color-border)] bg-[var(--color-background)] truncate">
          {HIVES.find((h) => h.id === hive)?.label}\{selectedPath}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Tree */}
        <div className="w-64 border-r border-[var(--color-border)] overflow-auto bg-[var(--color-background)]">
          {!treeLoaded ? (
            <div className="flex items-center justify-center h-full">
              <button
                onClick={loadRoot}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-accent)] text-white hover:opacity-90"
              >
                Load Registry
              </button>
            </div>
          ) : (
            <div role="tree" aria-label="Registry keys">
              {tree.map((node) => renderNode(node, 0, null))}
            </div>
          )}
        </div>

        {/* Values */}
        <div className="flex-1 overflow-auto">
          {searchResults.length > 0 ? (
            <div className="p-3">
              <h4 className="text-xs font-medium text-[var(--color-textMuted)] mb-2">
                Search Results ({searchResults.length})
              </h4>
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  className="block w-full text-left text-xs p-2 border-b border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
                  onClick={async () => {
                    setSearchResults([]);
                    await selectKey(r.path);
                    focusTreeItem(r.path);
                  }}
                >
                  <div className="text-[var(--color-text)] font-mono text-[10px] truncate">
                    {r.path}
                  </div>
                  <div className="text-[var(--color-textSecondary)]">
                    {r.matchType}: {r.matchedText}
                  </div>
                </button>
              ))}
            </div>
          ) : selectedPath ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface)] z-10">
                <tr className="text-left text-[var(--color-textSecondary)]">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium w-20">Type</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {values.map((v) => (
                  <tr
                    key={v.name}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
                  >
                    <td className="px-3 py-1.5 text-[var(--color-text)] flex items-center gap-1.5">
                      {VALUE_TYPE_ICON[v.valueType] || VALUE_TYPE_ICON.unknown}
                      {v.name || "(Default)"}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textMuted)]">
                      {v.valueType}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--color-textSecondary)] font-mono truncate max-w-[300px]">
                      {formatValue(v.data)}
                    </td>
                  </tr>
                ))}
                {values.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-8 text-center text-[var(--color-textMuted)]"
                    >
                      No values
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-[var(--color-textMuted)]">
              Select a registry key
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function formatValue(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  if (typeof data === "number") return `0x${data.toString(16)} (${data})`;
  if (Array.isArray(data)) return data.join(", ");
  return JSON.stringify(data);
}

export default RegistryPanel;

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  TopologyGraph,
  TopologyNode,
  TopologyEdge,
  TopologyGroup,
  TopologyStats,
  BlastRadiusResult,
  PathResult,
  BottleneckResult,
  TopologySnapshot,
  LayoutAlgorithm,
} from "../../types/network/topology";

export function useTopology() {
  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [stats, setStats] = useState<TopologyStats | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [blastRadius, setBlastRadius] = useState<BlastRadiusResult | null>(null);
  const [path, setPath] = useState<PathResult | null>(null);
  const [bottlenecks, setBottlenecks] = useState<BottleneckResult[]>([]);
  const [snapshots, setSnapshots] = useState<TopologySnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildFromConnections = useCallback(async (connections: Array<{ id: string; name: string; hostname: string; protocol: string; security?: { tunnelChain?: unknown[] } }>) => {
    setLoading(true);
    try {
      const g = await invoke<TopologyGraph>("topo_build_from_connections", { connections });
      setGraph(g);
      return g;
    } catch (e) { setError(String(e)); return null; }
    finally { setLoading(false); }
  }, []);

  const fetchGraph = useCallback(async () => {
    try {
      const g = await invoke<TopologyGraph>("topo_get_graph");
      setGraph(g);
      return g;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const addNode = useCallback(async (node: Omit<TopologyNode, 'id'>) => {
    try {
      const id = await invoke<string>("topo_add_node", { node });
      await fetchGraph();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchGraph]);

  const removeNode = useCallback(async (nodeId: string) => {
    try {
      await invoke("topo_remove_node", { nodeId });
      await fetchGraph();
    } catch (e) { setError(String(e)); }
  }, [fetchGraph]);

  const updateNode = useCallback(async (nodeId: string, updates: Partial<TopologyNode>) => {
    try {
      await invoke("topo_update_node", { nodeId, updates });
      await fetchGraph();
    } catch (e) { setError(String(e)); }
  }, [fetchGraph]);

  const addEdge = useCallback(async (edge: Omit<TopologyEdge, 'id'>) => {
    try {
      const id = await invoke<string>("topo_add_edge", { edge });
      await fetchGraph();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchGraph]);

  const removeEdge = useCallback(async (edgeId: string) => {
    try {
      await invoke("topo_remove_edge", { edgeId });
      await fetchGraph();
    } catch (e) { setError(String(e)); }
  }, [fetchGraph]);

  const applyLayout = useCallback(async (algorithm: LayoutAlgorithm) => {
    setLoading(true);
    try {
      const g = await invoke<TopologyGraph>("topo_apply_layout", { algorithm });
      setGraph(g);
      return g;
    } catch (e) { setError(String(e)); return null; }
    finally { setLoading(false); }
  }, []);

  const getBlastRadius = useCallback(async (nodeId: string, maxDepth?: number) => {
    try {
      const r = await invoke<BlastRadiusResult>("topo_get_blast_radius", { nodeId, maxDepth: maxDepth ?? 5 });
      setBlastRadius(r);
      return r;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const findBottlenecks = useCallback(async () => {
    try {
      const b = await invoke<BottleneckResult[]>("topo_find_bottlenecks");
      setBottlenecks(b);
      return b;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const findPath = useCallback(async (sourceId: string, targetId: string) => {
    try {
      const p = await invoke<PathResult>("topo_get_path", { sourceId, targetId });
      setPath(p);
      return p;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const getNeighbors = useCallback(async (nodeId: string, depth?: number) => {
    try {
      return await invoke<string[]>("topo_get_neighbors", { nodeId, depth: depth ?? 1 });
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const getConnectedComponents = useCallback(async () => {
    try {
      return await invoke<string[][]>("topo_get_connected_components");
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<TopologyStats>("topo_get_stats");
      setStats(s);
      return s;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const listSnapshots = useCallback(async () => {
    try {
      const s = await invoke<TopologySnapshot[]>("topo_list_snapshots");
      setSnapshots(s);
      return s;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const createSnapshot = useCallback(async (name: string) => {
    try {
      const id = await invoke<string>("topo_create_snapshot", { name });
      await listSnapshots();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [listSnapshots]);

  const addGroup = useCallback(async (group: Omit<TopologyGroup, 'id'>) => {
    try {
      const id = await invoke<string>("topo_add_group", { group });
      await fetchGraph();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchGraph]);

  const removeGroup = useCallback(async (groupId: string) => {
    try {
      await invoke("topo_remove_group", { groupId });
      await fetchGraph();
    } catch (e) { setError(String(e)); }
  }, [fetchGraph]);

  return {
    graph, stats, selectedNode, blastRadius, path, bottlenecks, snapshots,
    loading, error, setSelectedNode,
    buildFromConnections, fetchGraph, addNode, removeNode, updateNode,
    addEdge, removeEdge, applyLayout, getBlastRadius, findBottlenecks,
    findPath, getNeighbors, getConnectedComponents, fetchStats,
    createSnapshot, listSnapshots, addGroup, removeGroup,
  };
}

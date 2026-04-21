// Connection Topology / Network Map types

export type NodeKind = 'connection' | 'gateway' | 'bastion' | 'proxy' | 'vpn' | 'group' | 'external';
export type EdgeKind = 'direct' | 'tunnel' | 'proxy_chain' | 'vpn' | 'jump_host' | 'dependency';
export type LayoutAlgorithm = 'force_directed' | 'hierarchical' | 'circular' | 'grid' | 'radial';

export interface TopologyNode {
  id: string;
  label: string;
  kind: NodeKind;
  connectionId: string | null;
  x: number;
  y: number;
  status: 'online' | 'offline' | 'unknown';
  protocol: string | null;
  hostname: string | null;
  metadata: Record<string, unknown>;
  group: string | null;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string | null;
  weight: number;
  bidirectional: boolean;
  metadata: Record<string, unknown>;
}

export interface TopologyGroup {
  id: string;
  label: string;
  color: string;
  nodeIds: string[];
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  groups: TopologyGroup[];
}

export interface TopologyStats {
  nodeCount: number;
  edgeCount: number;
  connectedComponents: number;
  avgDegree: number;
  density: number;
  hasCycles: boolean;
}

export interface BlastRadiusResult {
  affectedNodes: string[];
  affectedEdges: string[];
  impactScore: number;
  depth: number;
}

export interface PathResult {
  path: string[];
  totalWeight: number;
  hops: number;
}

export interface BottleneckResult {
  nodeId: string;
  label: string;
  degree: number;
  betweenness: number;
  isCutVertex: boolean;
}

export interface TopologySnapshot {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}

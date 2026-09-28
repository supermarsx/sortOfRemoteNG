import type { NetworkDiscoveryConfig } from "../../types/settings/settings";
import { DISCOVERY_SERVICE_PRESETS } from "./discoveryPresets";
import { createDiscoveryTargetPlan } from "./discoveryTargetPlan";
import {
  DISCOVERY_PING_METHODS,
  isDiscoveryProbeMethods,
} from "./discoveryPing";

export interface SavedDiscoveryPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  config: NetworkDiscoveryConfig;
}

export const DISCOVERY_PRESET_NAME_MAX_LENGTH = 80;
export const DISCOVERY_PRESET_LIMIT = 50;
export const DISCOVERY_PRESET_STORAGE_KEY = "sorng.discovery.presets.v1";
export const DISCOVERY_PRESET_CHANGED_EVENT = "sorng:discovery-presets-changed";
/** Conservative UTF-16 byte budget, below typical localStorage quotas. */
export const DISCOVERY_PRESET_MAX_BYTES = 2 * 1024 * 1024;

const serviceIds = DISCOVERY_SERVICE_PRESETS.map(({ id }) => id);
const strategyIds = [
  ...new Set([
    "default",
    ...serviceIds,
    ...DISCOVERY_SERVICE_PRESETS.map(({ protocol }) => protocol),
  ]),
];

function invalid(message: string): never {
  throw new Error(`Discovery presets: ${message}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function integer(
  value: unknown,
  min: number,
  max: number,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    invalid(`${field} must be an integer between ${min} and ${max}.`);
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(`${field} must be a boolean.`);
  return value;
}

function array(value: unknown, max: number, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    invalid(`${field} must be an array with at most ${max} entries.`);
  // Array.from also visits holes, so sparse arrays cannot bypass validation.
  return Array.from(value);
}

function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T))
    invalid(`${field} contains an unsupported value.`);
  return value as T;
}

/** A detached allowlisted snapshot: never serialize arbitrary config extensions. */
export function cloneDiscoveryPresetConfig(
  config: NetworkDiscoveryConfig,
): NetworkDiscoveryConfig {
  const input = record(config, "config");
  if (typeof input.ipRange !== "string" || input.ipRange.length > 256 * 1024)
    invalid("targets must be a string of at most 256 KiB.");
  // Empty targets are useful for reusable settings; nonempty plans must be valid
  // and bounded to the scanner's 10,000-host limit. Keep original target text.
  if (input.ipRange.trim()) createDiscoveryTargetPlan(input.ipRange);
  const custom = record(input.customPorts, "customPorts");
  const strategies = record(input.probeStrategies, "probeStrategies");
  const customPorts: NetworkDiscoveryConfig["customPorts"] = {};
  const probeStrategies: NetworkDiscoveryConfig["probeStrategies"] = {};
  for (const id of serviceIds) {
    if (Object.prototype.hasOwnProperty.call(custom, id))
      customPorts[id] = array(custom[id], 1024, `customPorts.${id}`).map(
        (port) => integer(port, 1, 65535, `customPorts.${id}`),
      );
  }
  for (const id of strategyIds) {
    if (Object.prototype.hasOwnProperty.call(strategies, id))
      probeStrategies[id] = array(
        strategies[id],
        3,
        `probeStrategies.${id}`,
      ).map((strategy) =>
        choice(
          strategy,
          ["websocket", "http", "rfb"] as const,
          `probeStrategies.${id}`,
        ),
      );
  }
  const result: NetworkDiscoveryConfig = {
    enabled: boolean(input.enabled, "enabled"),
    ipRange: input.ipRange,
    portRanges: array(input.portRanges, 1024, "portRanges").map((range) => {
      if (typeof range !== "string" || !/^\d{1,5}(?:-\d{1,5})?$/.test(range))
        invalid("portRanges must contain TCP ports or ranges.");
      const [start, end = start] = range.split("-").map(Number);
      integer(start, 1, 65535, "range start");
      integer(end, start, Math.min(65535, start + 1023), "range end");
      return range;
    }),
    protocols: array(input.protocols, serviceIds.length, "protocols").map(
      (id) => choice(id, serviceIds, "protocols"),
    ),
    timeout: integer(input.timeout, 1, 300000, "timeout"),
    maxConcurrent: integer(input.maxConcurrent, 1, 512, "maxConcurrent"),
    maxPortConcurrent: integer(
      input.maxPortConcurrent,
      1,
      1024,
      "maxPortConcurrent",
    ),
    customPorts,
    probeStrategies,
    cacheTTL: integer(input.cacheTTL, 0, 2_147_483_647, "cacheTTL"),
    hostnameTtl: integer(input.hostnameTtl, 0, 2_147_483_647, "hostnameTtl"),
    macTtl: integer(input.macTtl, 0, 2_147_483_647, "macTtl"),
  };
  for (const key of [
    "identifyServices",
    "hostDiscoveryEnabled",
    "serviceScanEnabled",
    "pauseOnHighLoad",
    "scanUnresponsiveHosts",
    "adaptiveConcurrency",
    "nativeBatchProbes",
    "resolveHostnames",
  ] as const) {
    if (input[key] !== undefined) result[key] = boolean(input[key], key);
  }
  if (input.pingMethod !== undefined)
    result.pingMethod = choice(
      input.pingMethod,
      DISCOVERY_PING_METHODS,
      "pingMethod",
    );
  if (input.pingMethods !== undefined) {
    if (!isDiscoveryProbeMethods(input.pingMethods))
      invalid("pingMethods must contain 1–7 distinct supported methods.");
    result.pingMethods = [...input.pingMethods];
  }
  const numericFields = [
    ["pingTimeout", 1, 300000],
    ["pingPort", 1, 65535],
    ["pingUdpPort", 1, 65535],
    ["absoluteMaxProbes", 1, 1024],
    ["maxCpuPercent", 1, 100],
    ["maxNetworkUtilizationPercent", 1, 100],
    ["workerLaunchIntervalMs", 0, 5000],
    ["probeLaunchIntervalMs", 0, 5000],
  ] as const;
  for (const [key, min, max] of numericFields) {
    if (input[key] !== undefined)
      result[key] = integer(input[key], min, max, key);
  }
  return result;
}

export function normalizeDiscoveryPresetName(name: string): string {
  if (typeof name !== "string") invalid("name must be text.");
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > DISCOVERY_PRESET_NAME_MAX_LENGTH)
    invalid(
      `name must contain 1–${DISCOVERY_PRESET_NAME_MAX_LENGTH} characters.`,
    );
  if (
    [...trimmed].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    invalid("name cannot contain control characters.");
  return trimmed;
}

function normalizePresets(value: unknown): SavedDiscoveryPreset[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  return array(value, DISCOVERY_PRESET_LIMIT, "saved presets").map((entry) => {
    const item = record(entry, "saved preset");
    if (
      typeof item.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) ||
      ids.has(item.id)
    )
      invalid("saved preset IDs are invalid or duplicated.");
    ids.add(item.id);
    const name = normalizeDiscoveryPresetName(item.name as string);
    const nameKey = name.toLowerCase();
    if (names.has(nameKey))
      invalid("a saved preset with that name already exists.");
    names.add(nameKey);
    const createdAt = integer(
      item.createdAt,
      0,
      Number.MAX_SAFE_INTEGER,
      "createdAt",
    );
    return {
      id: item.id,
      name,
      createdAt,
      updatedAt: integer(
        item.updatedAt,
        createdAt,
        Number.MAX_SAFE_INTEGER,
        "updatedAt",
      ),
      config: cloneDiscoveryPresetConfig(item.config as NetworkDiscoveryConfig),
    };
  });
}

function storage(): Storage {
  if (typeof window === "undefined") invalid("local storage is unavailable.");
  return window.localStorage;
}

function checkBytes(serialized: string): void {
  if (serialized.length * 2 > DISCOVERY_PRESET_MAX_BYTES)
    invalid("saved presets exceed the 2 MiB storage limit.");
}

export function readDiscoveryPresets(): SavedDiscoveryPreset[] {
  const raw = storage().getItem(DISCOVERY_PRESET_STORAGE_KEY);
  if (raw === null) return [];
  checkBytes(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid("saved storage is unreadable; existing data has been preserved.");
  }
  const envelope = record(parsed, "saved storage");
  if (envelope.version !== 1)
    invalid(
      "saved storage version is unsupported; existing data has been preserved.",
    );
  return normalizePresets(envelope.presets);
}

/** Reread for every mutation, including when the caller's rendered list is stale.
 * localStorage has no cross-window compare-and-swap: truly simultaneous writes
 * can still race. Storage events converge mounted hooks to the persisted value.
 */
export function mutateDiscoveryPresets<T>(
  change: (presets: SavedDiscoveryPreset[]) => T,
): { presets: SavedDiscoveryPreset[]; value: T } {
  const latest = readDiscoveryPresets();
  const value = change(latest);
  const presets = normalizePresets(latest);
  const serialized = JSON.stringify({ version: 1, presets });
  checkBytes(serialized);
  storage().setItem(DISCOVERY_PRESET_STORAGE_KEY, serialized);
  window.dispatchEvent(new Event(DISCOVERY_PRESET_CHANGED_EVENT));
  return { presets, value };
}

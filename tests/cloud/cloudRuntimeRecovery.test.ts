import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../src/types/connection/connection";
import {
  inspectOvhCloudCredentialBundle,
  normalizeCloudConnectionForEditor,
} from "../../src/utils/connection/cloudConnectionContract";
import {
  claimBuiltInCloudRuntime,
  connectBuiltInCloudRuntime,
  resetBuiltInCloudRuntimeLeasesForTests,
  teardownBuiltInCloudRuntime,
} from "../../src/utils/session/builtInCloudRuntimeRegistry";
import {
  digitalOceanRuntimeAdapter,
  gcpRuntimeAdapter,
  ovhCloudRuntimeAdapter,
} from "../../src/utils/session/cloudRuntimeAdapters";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const connection = (
  protocol: Connection["protocol"],
  overrides: Partial<Connection> = {},
): Connection =>
  ({
    id: `recovery-${protocol}`,
    name: "Recovery fixture",
    protocol,
    hostname: "",
    port: 0,
    isGroup: false,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  }) as Connection;

describe("cloud runtime recovery", () => {
  beforeEach(() => {
    resetBuiltInCloudRuntimeLeasesForTests();
    invokeMock.mockReset();
  });

  it("releases a lease after connect and disconnect both reject", async () => {
    expect(claimBuiltInCloudRuntime("gcp", "failed-session")).toBe(true);

    await expect(
      connectBuiltInCloudRuntime("gcp", "failed-session", async () => {
        throw new Error("connect failed");
      }),
    ).rejects.toThrow("connect failed");

    const disconnect = vi.fn(async () => {
      throw new Error("disconnect failed");
    });
    await expect(
      teardownBuiltInCloudRuntime(
        "gcp",
        "failed-session",
        disconnect,
      ),
    ).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledWith(undefined);

    expect(claimBuiltInCloudRuntime("gcp", "failed-session")).toBe(true);
    await teardownBuiltInCloudRuntime(
      "gcp",
      "failed-session",
      async () => undefined,
    );
  });

  it("releases an authenticated handle after disconnect failure and reopens", async () => {
    expect(claimBuiltInCloudRuntime("azure", "azure-first")).toBe(true);
    expect(claimBuiltInCloudRuntime("azure", "azure-blocked")).toBe(false);

    await connectBuiltInCloudRuntime(
      "azure",
      "azure-first",
      async () => ({ backendSessionId: "azure-handle" }),
    );
    const disconnect = vi.fn(async () => {
      throw new Error("token cleanup failed");
    });
    await expect(
      teardownBuiltInCloudRuntime("azure", "azure-first", disconnect),
    ).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledWith({
      backendSessionId: "azure-handle",
    });

    expect(claimBuiltInCloudRuntime("azure", "azure-reopened")).toBe(true);
    await teardownBuiltInCloudRuntime(
      "azure",
      "azure-reopened",
      async () => undefined,
    );
  });

  it("drops malformed legacy values instead of coercing them into settings", () => {
    const normalized = normalizeCloudConnectionForEditor(
      connection("gcp", {
        password: "",
        cloudProvider: {
          provider: "gcp",
          projectId: 57,
          serviceAccountKey: {
            private_key: "T57_MALFORMED_LEGACY_SECRET",
          },
        } as unknown as NonNullable<Connection["cloudProvider"]>,
      }),
    );

    expect(normalized.cloudProvider).toBeUndefined();
    expect(normalized.gcpSettings?.projectId).toBe("");
    expect(normalized.password).toBe("");
    expect(JSON.stringify(normalized)).not.toContain(
      "T57_MALFORMED_LEGACY_SECRET",
    );
    expect(gcpRuntimeAdapter.validate(normalized)).toMatch(/project ID/);
  });

  it("rejects malformed and incomplete OVH bundles before native invocation", () => {
    const malformed = connection("ovhcloud", {
      password: "{T57_MALFORMED_OVH_JSON",
      ovhCloudSettings: { region: "GRA11" },
    });
    expect(inspectOvhCloudCredentialBundle(malformed.password).status).toBe(
      "malformed",
    );
    expect(ovhCloudRuntimeAdapter.validate(malformed)).toMatch(
      /apiKey, appSecret, and consumerKey/,
    );
    expect(() => ovhCloudRuntimeAdapter.connect(malformed)).toThrow(
      /apiKey, appSecret, and consumerKey/,
    );

    const incomplete = normalizeCloudConnectionForEditor(
      connection("ovhcloud", {
        password: "",
        cloudProvider: {
          provider: "ovhcloud",
          apiKey: "T57_PARTIAL_OVH_KEY",
          serviceId: "service-a",
        },
      }),
    );
    expect(inspectOvhCloudCredentialBundle(incomplete.password).status).toBe(
      "incomplete",
    );
    expect(incomplete.cloudProvider).toBeUndefined();
    expect(JSON.stringify(incomplete.ovhCloudSettings)).not.toContain(
      "T57_PARTIAL_OVH_KEY",
    );
    expect(
      JSON.stringify({ ...incomplete, password: undefined }),
    ).not.toContain("T57_PARTIAL_OVH_KEY");
    expect(ovhCloudRuntimeAdapter.validate(incomplete)).toMatch(
      /apiKey, appSecret, and consumerKey/,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reopens a migrated saved record without restoring legacy secret fields", () => {
    const migrated = normalizeCloudConnectionForEditor(
      connection("digital-ocean", {
        password: "",
        cloudProvider: {
          provider: "digital-ocean",
          apiKey: "T57_REOPENED_TOKEN",
          region: "lon1",
        },
      }),
    );
    const reopened = normalizeCloudConnectionForEditor({
      ...migrated,
    });

    expect(reopened.cloudProvider).toBeUndefined();
    expect(reopened.digitalOceanSettings).toEqual({ region: "lon1" });
    expect(reopened.password).toBe("T57_REOPENED_TOKEN");
    expect(
      JSON.stringify({ ...reopened, password: undefined }),
    ).not.toContain("T57_REOPENED_TOKEN");
    expect(digitalOceanRuntimeAdapter.validate(reopened)).toBeNull();
  });
});

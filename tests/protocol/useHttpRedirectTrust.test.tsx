import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Connection,
  ConnectionSession,
} from "../../src/types/connection/connection";
import { useHttpRedirectTrust } from "../../src/hooks/protocol/useHttpRedirectTrust";
import {
  anonymousRedirectConnection,
  type HttpRedirectReview,
} from "../../src/utils/protocol/httpRedirectReview";
import {
  httpRedirectConnectionOrigin,
  httpRedirectTrustIdentity,
} from "../../src/utils/protocol/httpRedirectTrustIdentity";
import {
  clearRuntimeConnectionsForTests,
  registerRuntimeConnection,
} from "../../src/utils/session/runtimeConnectionRegistry";

const h = vi.hoisted(() => ({
  context: null as unknown,
  manager: null as unknown,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => h.context,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: { getInstance: () => h.manager },
}));

const source: Connection = {
  id: "saved-source",
  name: "Original NAS",
  protocol: "https",
  hostname: "source.invalid",
  port: 443,
  isGroup: false,
  createdAt: "2026-09-10",
  updatedAt: "2026-09-10",
  basicAuthUsername: "private-user",
  basicAuthPassword: "private-password",
};
const session: ConnectionSession = {
  id: "tab",
  connectionId: source.id,
  name: source.name,
  protocol: "https",
  hostname: source.hostname,
  status: "connected",
  startTime: new Date("2026-09-10"),
  ownerDatabaseId: "db-a",
};
const review: HttpRedirectReview = {
  receiptId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  sessionId: "proxy",
  sourceOrigin: "https://source.invalid",
  destinationUrl: "https://destination.invalid/login/",
  navigationToken: "a".repeat(32),
  documentSequence: 1,
  removedQuery: true,
};
const grant = (
  origins = ["https://destination.invalid"],
  autoContinue?: boolean,
) => ({
  version: 1 as const,
  origins,
  ...(autoContinue === undefined ? {} : { autoContinue }),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(saved: Connection = structuredClone(source)) {
  let databaseId = "db-a",
    epoch = 1;
  let persisted = { connections: [structuredClone(saved)] };
  const readCurrent = vi.fn(async () => structuredClone(persisted));
  const flush = vi.fn(async (): Promise<void> => undefined);
  const context = {
    state: { connections: [saved] },
    databaseAvailability: { status: "ready", databaseId, generation: 1 },
    flushPendingSave: flush,
    dispatchAndFlush: vi.fn(
      async (action: { type: string; payload: Connection }) => {
        context.state.connections = context.state.connections.map((item) =>
          item.id === action.payload.id ? action.payload : item,
        );
        persisted = { connections: structuredClone(context.state.connections) };
      },
    ),
  };
  const manager = {
    getCurrentDatabase: () => ({ id: databaseId }),
    captureCurrentDatabaseDataTarget: vi.fn(() => {
      const capturedId = databaseId,
        capturedEpoch = epoch;
      return {
        databaseId: capturedId,
        assertAccessible: () => {
          if (capturedId !== databaseId || capturedEpoch !== epoch)
            throw new Error("private backend lock diagnostic");
        },
        readCurrent,
      };
    }),
  };
  h.context = context;
  h.manager = manager;
  const initialProps = { connection: saved, session };
  const hook = renderHook(
    (props = initialProps) =>
      useHttpRedirectTrust(props.session, props.connection),
    { initialProps },
  );
  return {
    ...hook,
    context,
    manager,
    readCurrent,
    flush,
    get persisted() {
      return persisted;
    },
    set persisted(next) {
      persisted = next;
    },
    changeLease: (nextId = databaseId) => {
      databaseId = nextId;
      epoch++;
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  clearRuntimeConnectionsForTests();
});
afterEach(cleanup);

describe("database-owned trusted HTTP redirect preferences", () => {
  it("matches hydrated creation timestamps without dropping creation identity or invalid distinctions", () => {
    const original = httpRedirectTrustIdentity(source);
    for (const createdAt of [
      "2026-09-10T00:00:00.000Z",
      "2026-09-10T01:00:00+01:00",
      new Date("2026-09-10"),
    ]) {
      expect(
        httpRedirectTrustIdentity({ ...source, createdAt } as Connection),
      ).toBe(original);
    }
    const distinct = [
      "2026-09-11",
      "invalid-creation-one",
      "invalid-creation-two",
      undefined,
      null,
    ].map((createdAt) =>
      httpRedirectTrustIdentity({ ...source, createdAt } as Connection),
    );
    expect(new Set([original, ...distinct]).size).toBe(distinct.length + 1);
  });
  it("establishes reference-only original provenance even with no trusted destinations", async () => {
    const view = fixture();
    const result = await view.result.current.inspect(review, vi.fn());
    expect(result).toMatchObject({
      trusted: false,
      provenance: {
        databaseId: "db-a",
        savedConnectionId: source.id,
        originalOrigin: "https://source.invalid",
      },
    });
    expect(result.assertCurrent).not.toThrow();
    expect(JSON.stringify(result.provenance)).not.toContain("private-");
    expect(view.result.current.revision).toMatch(/^\d+$/);
    expect(view.result.current.canRemember).toBe(true);
    expect(view.readCurrent).toHaveBeenCalledOnce();
    expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
  });

  it.each([undefined, false, true])(
    "requires exact persisted membership and ignores legacy automatic setting %s",
    async (autoContinue) => {
      const view = fixture({
        ...source,
        httpTrustedRedirectDestinations: grant(undefined, autoContinue),
      });
      expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
        trusted: true,
      });
      expect(
        await view.result.current.inspect(
          { ...review, destinationUrl: "https://other.invalid/" },
          vi.fn(),
        ),
      ).toMatchObject({ trusted: false });
      view.persisted.connections[0].httpTrustedRedirectDestinations = grant(
        undefined,
        false,
      );
      view.context.state.connections[0] = {
        ...source,
        httpTrustedRedirectDestinations: grant(undefined, false),
      };
      expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
        trusted: true,
      });
    },
  );

  it("does not approve optimistic additions or pending revocations that disagree with durable storage", async () => {
    const view = fixture({
      ...source,
      httpTrustedRedirectDestinations: grant(),
    });
    view.persisted.connections[0].httpTrustedRedirectDestinations = grant(
      [],
      false,
    );
    expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
      trusted: false,
    });
    view.persisted.connections[0].httpTrustedRedirectDestinations = grant();
    view.context.state.connections[0] = {
      ...source,
      httpTrustedRedirectDestinations: grant([], false),
    };
    expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
      trusted: false,
    });
  });

  it("revokes a captured inspection synchronously when the grant list changes", async () => {
    const view = fixture({
      ...source,
      httpTrustedRedirectDestinations: grant(),
    });
    const inspection = await view.result.current.inspect(review, vi.fn());
    const revision = view.result.current.revision;
    view.context.state.connections[0] = {
      ...source,
      httpTrustedRedirectDestinations: grant([], false),
    };
    expect(inspection.assertCurrent).toThrow(
      "Trusted redirect preferences are unavailable",
    );
    view.rerender({ connection: view.context.state.connections[0], session });
    expect(view.result.current.revision).not.toBe(revision);
  });

  it.each(["lease", "grant", "credential", "runtime", "database-generation"])(
    "allows an intentional transport stop but rejects later %s changes before launch",
    async (change) => {
      const saved = { ...source, httpTrustedRedirectDestinations: grant() };
      const view = fixture(saved);
      let stopped = false;
      const transport = () => {
        if (stopped) throw new Error("proxy stopped");
      };
      const inspection = await view.result.current.inspect(review, transport);
      stopped = true;
      expect(inspection.assertCurrent).toThrow("proxy stopped");
      expect(inspection.assertLaunchCurrent).toBeTypeOf("function");
      expect(inspection.assertLaunchCurrent).not.toThrow();
      if (change === "lease") view.changeLease();
      if (change === "grant")
        view.context.state.connections[0] = {
          ...source,
          httpTrustedRedirectDestinations: grant([], false),
        };
      if (change === "credential")
        view.context.state.connections[0] = {
          ...saved,
          basicAuthPassword: "changed",
        };
      if (change === "runtime")
        view.rerender({
          connection: { ...saved, id: "another-runtime" },
          session,
        });
      if (change === "database-generation") {
        view.context.databaseAvailability = {
          ...view.context.databaseAvailability,
          generation: 2,
        };
        view.rerender({ connection: saved, session });
      }
      expect(inspection.assertLaunchCurrent).toThrow();
    },
  );

  it.each([false, true])(
    "flushes, appends only to the original saved source, and discards legacy autoContinue=%s in both stores",
    async (autoContinue) => {
      const view = fixture({
        ...source,
        httpTrustedRedirectDestinations: grant(
          ["https://existing.invalid"],
          autoContinue,
        ),
      });
      await act(() => view.result.current.remember(review, vi.fn()));
      expect(view.flush).toHaveBeenCalledOnce();
      expect(view.flush.mock.invocationCallOrder[0]).toBeLessThan(
        view.context.dispatchAndFlush.mock.invocationCallOrder[0],
      );
      expect(view.context.dispatchAndFlush).toHaveBeenCalledWith({
        type: "UPDATE_CONNECTION",
        payload: {
          ...source,
          httpTrustedRedirectDestinations: grant([
            "https://existing.invalid",
            "https://destination.invalid",
          ]),
        },
      });
      expect(view.persisted.connections[0].basicAuthPassword).toBe(
        source.basicAuthPassword,
      );
      expect(view.readCurrent).toHaveBeenCalledTimes(3);
    },
  );

  it("denies automatic launch after unmount even if the old immutable Context snapshot survives", async () => {
    const saved = { ...source, httpTrustedRedirectDestinations: grant() };
    const view = fixture(saved);
    const inspection = await view.result.current.inspect(review, vi.fn());
    expect(inspection.assertLaunchCurrent).not.toThrow();
    view.unmount();
    h.context = {
      ...view.context,
      state: {
        connections: [
          { ...source, httpTrustedRedirectDestinations: grant([], false) },
        ],
      },
    };
    expect(
      view.context.state.connections[0].httpTrustedRedirectDestinations
        ?.origins,
    ).toEqual(["https://destination.invalid"]);
    expect(inspection.assertLaunchCurrent).toThrow(
      "Trusted redirect preferences are unavailable",
    );
    // Later legitimate hops must re-read this source through their own adapter;
    // source unmount is not a database lease revocation.
    expect(inspection.provenance?.assertOwner).not.toThrow();
    expect(() => inspection.provenance?.assertIdentity(saved)).not.toThrow();
  });

  it("reports failed durable saves without granting from the retained optimistic state", async () => {
    const view = fixture();
    view.context.dispatchAndFlush.mockImplementationOnce(async (action) => {
      view.context.state.connections = [action.payload];
      throw new Error("private password-bearing storage diagnostic");
    });
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "could not be verified as saved",
    );
    expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
      trusted: false,
    });
    expect(
      view.persisted.connections[0].httpTrustedRedirectDestinations,
    ).toBeUndefined();
  });

  it("requires authoritative readback even when the write reports success", async () => {
    const view = fixture();
    view.context.dispatchAndFlush.mockImplementationOnce(async (action) => {
      view.context.state.connections = [action.payload];
    });
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "could not be verified as saved",
    );
  });

  it("offers actionable full-list guidance without changing automatic continuation", async () => {
    const origins = Array.from(
      { length: 32 },
      (_, index) => `https://destination${index}.invalid`,
    );
    const view = fixture({
      ...source,
      httpTrustedRedirectDestinations: grant(origins, false),
    });
    expect(view.result.current.canRemember).toBe(false);
    expect(view.result.current.unavailableReason).toContain(
      "Remove an unused destination",
    );
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "32 trusted redirect destinations",
    );
    expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
    expect(
      view.persisted.connections[0].httpTrustedRedirectDestinations
        ?.autoContinue,
    ).toBe(false);
  });

  it.each(["remove", "add"])(
    "does not acknowledge a concurrent renderer grant %s during readback",
    async (change) => {
      const view = fixture();
      const originalRead = view.readCurrent.getMockImplementation()!;
      view.readCurrent.mockImplementation(async () => {
        const data = await originalRead();
        if (view.context.dispatchAndFlush.mock.calls.length) {
          view.context.state.connections = [
            {
              ...source,
              httpTrustedRedirectDestinations: grant(
                change === "remove"
                  ? []
                  : [
                      "https://destination.invalid",
                      "https://concurrent.invalid",
                    ],
                false,
              ),
            },
          ];
        }
        return data;
      });
      await expect(
        view.result.current.remember(review, vi.fn()),
      ).rejects.toThrow("could not be verified as saved");
    },
  );

  it("single-flights a separate Remember action and cancels on the original lease ABA", async () => {
    const view = fixture();
    const flush = deferred<void>();
    view.flush.mockImplementationOnce(() => flush.promise);
    const pending = view.result.current.remember(review, vi.fn());
    await vi.waitFor(() => expect(view.flush).toHaveBeenCalledOnce());
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "already in progress",
    );
    view.changeLease("db-b");
    view.changeLease("db-a");
    flush.resolve();
    await expect(pending).rejects.toThrow("could not be verified as saved");
    expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
  });

  it.each(["lease", "credential", "navigation"])(
    "refuses stale %s after an awaited persisted read",
    async (change) => {
      const view = fixture();
      let navigated = false;
      const assertCurrent = () => {
        if (navigated) throw new Error("stale receipt");
      };
      const read = deferred<{ connections: Connection[] }>();
      view.readCurrent.mockImplementationOnce(() => read.promise);
      const pending = view.result.current.inspect(review, assertCurrent);
      if (change === "lease") view.changeLease();
      if (change === "credential")
        view.context.state.connections[0] = {
          ...source,
          basicAuthPassword: "replacement-secret",
        };
      if (change === "navigation") navigated = true;
      read.resolve(view.persisted);
      await expect(pending).rejects.toThrow(
        "Trusted redirect preferences are unavailable",
      );
      expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
    },
  );

  it("retains the first saved source across later anonymous hops without freezing its old grant list", async () => {
    const view = fixture();
    const first = await view.result.current.inspect(review, vi.fn());
    const middle = anonymousRedirectConnection(source, review);
    registerRuntimeConnection(middle, {
      initialUrl: review.destinationUrl,
      redirectHops: 1,
      assertCurrent: vi.fn(),
      trustedRedirectSource: first.provenance!,
    });
    const laterReview = {
      ...review,
      sourceOrigin: "https://destination.invalid",
      destinationUrl: "https://last.invalid/ui/",
    };
    const middleSession = {
      ...session,
      connectionId: middle.id,
      hostname: middle.hostname,
    };
    view.unmount();
    const later = renderHook(() => useHttpRedirectTrust(middleSession, middle));
    view.persisted.connections[0].httpTrustedRedirectDestinations = grant(
      ["https://last.invalid"],
      false,
    );
    view.context.state.connections[0] = structuredClone(
      view.persisted.connections[0],
    );
    expect(
      await later.result.current.inspect(laterReview, vi.fn()),
    ).toMatchObject({
      trusted: true,
      provenance: first.provenance,
    });
    await later.result.current.remember(
      { ...laterReview, destinationUrl: "https://new.invalid/" },
      vi.fn(),
    );
    expect(view.context.dispatchAndFlush.mock.calls[0][0].payload.id).toBe(
      source.id,
    );
    expect(view.persisted.connections).toHaveLength(1);
    expect(
      view.persisted.connections[0].httpTrustedRedirectDestinations?.origins,
    ).toEqual(["https://last.invalid", "https://new.invalid"]);
    view.changeLease();
    await expect(
      later.result.current.inspect(laterReview, vi.fn()),
    ).rejects.toThrow("Trusted redirect preferences are unavailable");
  });

  it("does not infer a saved source for Quick Connect by matching hostname or active database", async () => {
    const view = fixture();
    const quick = { ...source, id: "runtime-quick" };
    registerRuntimeConnection(quick);
    view.rerender({
      connection: quick,
      session: { ...session, connectionId: quick.id },
    });
    expect(view.result.current.canRemember).toBe(false);
    expect(view.result.current.unavailableReason).toContain(
      "Save this connection",
    );
    expect(await view.result.current.inspect(review, vi.fn())).toMatchObject({
      trusted: false,
      provenance: null,
    });
    await expect(view.result.current.remember(review, vi.fn())).rejects.toThrow(
      "Save this connection",
    );
    expect(view.readCurrent).not.toHaveBeenCalled();
    expect(view.context.dispatchAndFlush).not.toHaveBeenCalled();
  });

  it("rejects a same-ID source from a different owner and malformed persisted preferences", async () => {
    const view = fixture();
    view.changeLease("db-b");
    await expect(view.result.current.inspect(review, vi.fn())).rejects.toThrow(
      "Trusted redirect preferences are unavailable",
    );
    view.changeLease("db-a");
    view.persisted.connections[0].httpTrustedRedirectDestinations = {
      ...grant(),
      untrusted: "private-secret",
    } as ReturnType<typeof grant>;
    await expect(view.result.current.inspect(review, vi.fn())).rejects.toThrow(
      /^Trusted redirect preferences are unavailable/,
    );
  });

  it("compares canonical persisted identities without exposing secrets or reacting to bookkeeping", async () => {
    const view = fixture();
    const inspection = await view.result.current.inspect(review, vi.fn());
    const revision = view.result.current.revision;
    const reordered = {
      ...source,
      hostname: "https://SOURCE.invalid:443",
      lastConnected: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11",
      connectionCount: 7,
    };
    expect(httpRedirectTrustIdentity(reordered)).toBe(
      httpRedirectTrustIdentity(source),
    );
    view.context.state.connections[0] = reordered;
    view.rerender({ connection: reordered, session });
    expect(inspection.assertCurrent).not.toThrow();
    expect(view.result.current.revision).toBe(revision);
    expect(() => httpRedirectConnectionOrigin({ ...source, port: 0 })).toThrow(
      "port",
    );
    expect(() =>
      httpRedirectConnectionOrigin({
        ...source,
        hostname: "http://source.invalid",
      }),
    ).toThrow("origin");
  });
});

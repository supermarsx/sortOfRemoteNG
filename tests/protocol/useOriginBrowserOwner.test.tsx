import { useRef } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOriginBrowserOwner } from "../../src/hooks/protocol/useOriginBrowserOwner";
import type { DatabaseAvailability } from "../../src/contexts/ConnectionContextTypes";
import type {
  ConnectionDatabase,
  ConnectionSession,
} from "../../src/types/connection/connection";
import type { DatabaseAccessState } from "../../src/types/encryption/databaseProtection";
import type { CurrentDatabaseChange } from "../../src/utils/connection/databaseManager";

const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  capture: vi.fn(),
  database: (() => {}) as (change: unknown) => void,
  access: (() => {}) as (state: unknown) => void,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: mocks.current,
      captureOriginBrowserOwnerProof: mocks.capture,
      onCurrentDatabaseChange: (callback: (change: unknown) => void) => {
        mocks.database = callback;
        return () => {
          mocks.database = () => {};
        };
      },
      onDatabaseAccessChange: (callback: (state: unknown) => void) => {
        mocks.access = callback;
        return () => {
          mocks.access = () => {};
        };
      },
    }),
  },
}));

const OWNER = "owner-db";
const OTHER = "other-db";
const THIRD = "third-db";
const database = (id: string) => ({ id }) as ConnectionDatabase;
const session = (patch: Partial<ConnectionSession> = {}) =>
  ({
    id: "tab",
    connectionId: "website",
    ownerDatabaseId: OWNER,
    ...patch,
  }) as ConnectionSession;
const ready = (generation = 1): DatabaseAvailability => ({
  status: "ready",
  databaseId: OWNER,
  generation,
});
/** Mirrors the manager: every capture returns a new proof object. */
function grant(patch: { revision?: string; unlock?: string } = {}) {
  return {
    ownerDatabaseId: OWNER,
    expectedSecurityRevision: patch.revision ?? "revision-1",
    sourceSessionId: patch.unlock ?? "native-unlock-1",
    assertCurrent: vi.fn(),
  };
}
const lapse = (proof: ReturnType<typeof grant>) =>
  proof.assertCurrent.mockImplementation(() => {
    throw new Error("expired");
  });
const unavailable = () =>
  mocks.capture.mockReset().mockImplementation(() => {
    throw new Error("locked");
  });
/** Payloads as `DatabaseManager.announceDatabaseChange` builds them. */
const change = (
  patch: Partial<CurrentDatabaseChange> = {},
): CurrentDatabaseChange => ({
  reason: "unlock",
  database: database(OWNER),
  databaseId: OWNER,
  previousDatabaseId: OWNER,
  connectionIds: [],
  trustActivation: Promise.resolve(),
  ...patch,
});
const access = (
  patch: Partial<DatabaseAccessState> = {},
): DatabaseAccessState => ({
  databaseId: OWNER,
  securityRevision: "revision-1",
  accessEpoch: "0:0",
  status: "ready",
  reason: "unlocked",
  ...patch,
});

function mount(
  initial: {
    session?: ConnectionSession;
    availability?: DatabaseAvailability;
  } = {},
) {
  const close = vi.fn(async () => {});
  const view = renderHook(
    (props: {
      session: ConnectionSession;
      availability: DatabaseAvailability;
    }) => {
      const closeRef = useRef<(() => Promise<void>) | null>(close);
      return useOriginBrowserOwner(props.session, props.availability, closeRef);
    },
    {
      initialProps: {
        session: initial.session ?? session(),
        availability: initial.availability ?? ready(),
      },
    },
  );
  // Mounting revokes whatever an earlier owner left behind.
  close.mockClear();
  return { ...view, close };
}

let first: ReturnType<typeof grant>;
beforeEach(() => {
  vi.clearAllMocks();
  first = grant();
  mocks.current.mockReturnValue(database(OWNER));
  mocks.capture.mockReturnValueOnce(first).mockImplementation(() => grant());
});
afterEach(cleanup);

describe("native browser owner proof", () => {
  it("captures the proof of the ready, current owner", () => {
    const view = mount();
    expect(view.result.current).toBe(first);
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(OWNER);
  });

  it.each(["create", "unlock", "lock", "close", "delete"] as const)(
    "ignores a %s event about another database",
    (reason) => {
      const view = mount();
      act(() => mocks.database(change({ reason, databaseId: OTHER })));
      expect(view.close).not.toHaveBeenCalled();
      expect(view.result.current).toBe(first);
      expect(mocks.capture).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      "a third database is created",
      change({
        reason: "create",
        database: database(OTHER),
        databaseId: THIRD,
        previousDatabaseId: OTHER,
      }),
    ],
    [
      // A null id names the selection the event ended, here not the owner.
      "the selected database is locked",
      change({
        reason: "lock",
        database: null,
        databaseId: null,
        previousDatabaseId: OTHER,
      }),
    ],
  ])("ignores that %s while its owner is not selected", (_, payload) => {
    mocks.current.mockReturnValue(database(OTHER));
    unavailable();
    const view = mount({
      availability: { status: "ready", databaseId: OTHER, generation: 1 },
    });
    expect(view.result.current).toBeNull();
    act(() => mocks.database(payload));
    expect(view.close).not.toHaveBeenCalled();
    expect(view.result.current).toBeNull();
  });

  it.each([
    ["an owner event", () => mocks.database(change({ reason: "unlock" }))],
    ["an owner access event", () => mocks.access(access())],
  ])("keeps the tab when %s re-captures an equivalent proof", (_, emit) => {
    const view = mount();
    act(() => emit());
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(view.close).not.toHaveBeenCalled();
    // The held proof still verifies, so its identity (an effect dependency of
    // the browser component) must not change either.
    expect(view.result.current).toBe(first);
  });

  it("adopts an equivalent proof without closing once the held one lapsed", () => {
    const view = mount();
    const next = grant();
    mocks.capture.mockReturnValueOnce(next);
    lapse(first);
    act(() => mocks.database(change({ reason: "unlock" })));
    expect(view.close).not.toHaveBeenCalled();
    expect(view.result.current).toBe(next);
  });

  it.each([
    ["security revision", { revision: "revision-2" }],
    ["native unlock session", { unlock: "native-unlock-2" }],
  ])("closes before adopting a proof with another %s", (_, patch) => {
    const view = mount();
    const next = grant(patch);
    mocks.capture.mockReturnValueOnce(next);
    act(() => mocks.database(change({ reason: "security-change" })));
    expect(view.close).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBe(next);
  });

  it.each([
    [
      "locked",
      change({
        reason: "lock",
        database: null,
        databaseId: null,
        previousDatabaseId: OWNER,
      }),
      null,
    ],
    [
      "closed",
      change({
        reason: "close",
        database: null,
        databaseId: null,
        previousDatabaseId: OWNER,
      }),
      null,
    ],
    [
      // The payload names the incoming database, not the owner it replaces.
      "switched away from",
      change({
        reason: "switch",
        database: database(OTHER),
        databaseId: OTHER,
        previousDatabaseId: OWNER,
      }),
      OTHER,
    ],
  ] as const)("closes when its owner is %s", (_, payload, selected) => {
    const view = mount();
    mocks.current.mockReturnValue(selected ? database(selected) : null);
    unavailable();
    // Not lapsed: the payload alone must be enough to re-check the owner.
    act(() => mocks.database(payload));
    expect(view.close).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBeNull();
  });

  it("closes when the owner's access is suspended and ignores another database's access", () => {
    const view = mount();
    act(() => mocks.access(access({ databaseId: OTHER, status: "suspended" })));
    expect(view.close).not.toHaveBeenCalled();
    expect(view.result.current).toBe(first);
    unavailable();
    lapse(first);
    act(() => mocks.access(access({ status: "suspended", reason: "locked" })));
    expect(view.close).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBeNull();
  });

  it("never keeps a lapsed proof because the event named another database", () => {
    const view = mount();
    unavailable();
    lapse(first);
    act(() => mocks.database(change({ reason: "unlock", databaseId: OTHER })));
    expect(view.close).toHaveBeenCalledTimes(1);
    expect(view.result.current).toBeNull();
  });

  it("captures a proof on the owner's next event when none is held", () => {
    unavailable();
    const view = mount();
    expect(view.result.current).toBeNull();
    const next = grant();
    mocks.capture.mockImplementation(() => next);
    act(() => mocks.database(change({ reason: "unlock" })));
    expect(view.result.current).toBe(next);
  });

  it("still closes when the access lease generation or the tab identity changes", () => {
    const view = mount();
    view.rerender({ session: session(), availability: ready(2) });
    expect(view.close).toHaveBeenCalled();
    expect(view.result.current).not.toBe(first);
    view.close.mockClear();
    view.rerender({
      session: session({ connectionId: "another-website" }),
      availability: ready(2),
    });
    expect(view.close).toHaveBeenCalled();
  });

  it("closes on unmount and stops listening", () => {
    const view = mount();
    view.unmount();
    expect(view.close).toHaveBeenCalledTimes(1);
    view.close.mockClear();
    mocks.database(
      change({ reason: "lock", database: null, databaseId: null }),
    );
    mocks.access(access({ status: "suspended" }));
    expect(view.close).not.toHaveBeenCalled();
  });
});

import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import { useCacheScope } from "../../src/hooks/perf/useCacheScope";
import { queryStore } from "../../src/utils/perf/queryStore";
import { setCacheScope } from "../../src/utils/perf/cachedInvoke";
import { useConnectionsSelector } from "../../src/contexts/useConnectionsSelector";

const ctx = (databaseId?: string) =>
  ({
    state: { selectedConnectionIds: new Set(), sessions: [] },
    databaseAvailability: databaseId
      ? { status: "ready", databaseId, generation: 1 }
      : undefined,
  }) as unknown as ConnectionContextType;

function Scope() {
  useCacheScope();
  return null;
}

afterEach(() => {
  cleanup();
  setCacheScope("");
  queryStore.clearAll();
});

describe("A1 shell wiring", () => {
  it("clears the query cache when the active database changes", () => {
    const view = render(
      <ConnectionContext.Provider value={ctx("db-a")}>
        <Scope />
      </ConnectionContext.Provider>,
    );
    queryStore.set("t:x", 1);
    expect(queryStore.peek("t:x")).toBeDefined();
    view.rerender(
      <ConnectionContext.Provider value={ctx("db-b")}>
        <Scope />
      </ConnectionContext.Provider>,
    );
    expect(queryStore.peek("t:x")).toBeUndefined();
  });

  it("useConnectionsSelector falls back to the context outside a provider store", () => {
    let seen: string | undefined;
    function Reader() {
      seen = useConnectionsSelector((c) => c.databaseAvailability?.databaseId);
      return null;
    }
    render(
      <ConnectionContext.Provider value={ctx("db-z")}>
        <Reader />
      </ConnectionContext.Provider>,
    );
    expect(seen).toBe("db-z");
  });
});

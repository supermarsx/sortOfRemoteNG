import { describe, expect, it, vi } from "vitest";
import { createDetachedDatabaseHandoff } from "../../src/utils/session/detachedDatabaseHandoff";

const grant = {
  databaseId: "database-a",
  sessionId: "target-window-token",
  securityRevision: "revision-a",
  sessionExpiresAt: null,
};
function fixture() {
  const deps = {
    adopt: vi.fn().mockResolvedValue(undefined),
    adoptPlain: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
  };
  return { deps, handoff: createDetachedDatabaseHandoff(deps) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("detached database grant handoff", () => {
  it("loads a plain owner locally without using a managed grant", async () => {
    const { deps, handoff } = fixture();
    const owner = {
      databaseId: "plain",
      securityRevision: "plain-r1",
      kind: "plain" as const,
    };
    await handoff.update(null, owner);
    await handoff.update(null, owner);
    expect(deps.adoptPlain).toHaveBeenCalledExactlyOnceWith(
      "plain",
      "plain-r1",
      { isCurrent: expect.any(Function) },
    );
    expect(deps.adopt).not.toHaveBeenCalled();
    expect(deps.load).toHaveBeenCalledExactlyOnceWith("plain");
    await handoff.dispose();
    expect(deps.release).toHaveBeenCalledWith("plain");
  });

  it("refreshes committed content on the same grant without re-adoption", async () => {
    const { deps, handoff } = fixture();
    const revision = (n: number) => ({
      databaseId: grant.databaseId,
      revision: n,
    });
    await handoff.update(grant, null, revision(1));
    await handoff.update(grant, null, revision(2));
    await handoff.update(grant, null, revision(2));
    await handoff.update(grant, null, revision(1));
    await handoff.update(grant, null, { databaseId: "foreign", revision: 100 });
    await handoff.update(grant, null, revision(NaN));
    expect(deps.load).toHaveBeenCalledTimes(2);
    expect(deps.adopt).toHaveBeenCalledOnce();
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("serializes revisions received while the previous refresh is pending", async () => {
    const { deps, handoff } = fixture();
    await handoff.update(grant);
    const loading = deferred<boolean>();
    deps.load.mockReturnValueOnce(loading.promise);
    const first = handoff.update(grant, null, {
      databaseId: grant.databaseId,
      revision: 1,
    });
    await vi.waitFor(() => expect(deps.load).toHaveBeenCalledTimes(2));
    const second = handoff.update(grant, null, {
      databaseId: grant.databaseId,
      revision: 2,
    });
    expect(deps.load).toHaveBeenCalledTimes(2);
    loading.resolve(true);
    await Promise.all([first, second]);
    expect(deps.load).toHaveBeenCalledTimes(3);
    expect(deps.adopt).toHaveBeenCalledOnce();
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("retains the owner after a pending-edit conflict and retries the refresh", async () => {
    const { deps, handoff } = fixture();
    await handoff.update(grant);
    deps.load.mockRejectedValueOnce(new Error("pending local edits"));
    const revision = { databaseId: grant.databaseId, revision: 1 };
    await handoff.update(grant, null, revision);
    expect(deps.release).not.toHaveBeenCalled();
    expect(deps.onError).toHaveBeenCalledExactlyOnceWith(true);
    await handoff.update(grant, null, revision);
    expect(deps.adopt).toHaveBeenCalledOnce();
    expect(deps.load).toHaveBeenCalledTimes(3);
  });

  it("adopts the exact target grant before loading once across status syncs", async () => {
    const { deps, handoff } = fixture();
    await Promise.all([handoff.update(grant), handoff.update({ ...grant })]);
    await handoff.update(grant);
    expect(deps.adopt).toHaveBeenCalledExactlyOnceWith("database-a", grant, {
      isCurrent: expect.any(Function),
    });
    expect(deps.load).toHaveBeenCalledExactlyOnceWith("database-a");
    expect(deps.adopt.mock.invocationCallOrder[0]).toBeLessThan(
      deps.load.mock.invocationCallOrder[0],
    );
    expect(deps.release).not.toHaveBeenCalled();
  });

  it.each([null, undefined])(
    "releases only the local grant when the next snapshot has %s",
    async (missing) => {
      const { deps, handoff } = fixture();
      await handoff.update(grant);
      const complete = handoff.update(missing);
      expect(deps.release).toHaveBeenCalledExactlyOnceWith("database-a");
      await complete;
      expect(deps.load).toHaveBeenCalledOnce();
    },
  );

  it("cancels a pending adoption before a newer missing grant can revive it", async () => {
    const { deps, handoff } = fixture();
    const adoption = deferred<void>();
    deps.adopt.mockReturnValueOnce(adoption.promise);
    const pending = handoff.update(grant);
    await Promise.resolve();
    const current = deps.adopt.mock.calls[0][2].isCurrent;
    expect(current()).toBe(true);
    const cleared = handoff.update(null);
    expect(current()).toBe(false);
    expect(deps.release).toHaveBeenCalledWith("database-a");
    adoption.resolve();
    await Promise.all([pending, cleared]);
    expect(deps.load).not.toHaveBeenCalled();
  });

  it("revokes a pending provider load immediately, before the stale load settles", async () => {
    const { deps, handoff } = fixture();
    const loading = deferred<boolean>();
    deps.load.mockReturnValueOnce(loading.promise);
    const pending = handoff.update(grant);
    await vi.waitFor(() => expect(deps.load).toHaveBeenCalledOnce());
    const cleared = handoff.update(null);
    expect(deps.release).toHaveBeenCalledExactlyOnceWith("database-a");
    loading.resolve(false);
    await Promise.all([pending, cleared]);
    expect(deps.onError).not.toHaveBeenCalled();
    await handoff.update(grant);
    expect(deps.load).toHaveBeenCalledTimes(2);
  });

  it("never revalidates an old capture when the same token returns after revocation", async () => {
    const { deps, handoff } = fixture();
    const adoption = deferred<void>();
    deps.adopt.mockReturnValueOnce(adoption.promise);
    const first = handoff.update(grant);
    await Promise.resolve();
    const oldCurrent = deps.adopt.mock.calls[0][2].isCurrent;
    const cleared = handoff.update(null);
    const resumed = handoff.update(grant);
    expect(oldCurrent()).toBe(false);
    adoption.resolve();
    await Promise.all([first, cleared, resumed]);
    expect(deps.adopt).toHaveBeenCalledTimes(2);
    expect(deps.load).toHaveBeenCalledOnce();
  });

  it("waits for the old grant's cleanup before adopting another owner", async () => {
    const { deps, handoff } = fixture();
    await handoff.update(grant);
    const release = deferred<void>();
    deps.release.mockReturnValueOnce(release.promise);
    const next = {
      ...grant,
      databaseId: "database-b",
      sessionId: "other-target-token",
    };
    const changing = handoff.update(next);
    await Promise.resolve();
    expect(deps.adopt).toHaveBeenCalledOnce();
    release.resolve();
    await changing;
    expect(deps.load.mock.calls).toEqual([["database-a"], ["database-b"]]);
  });

  it("does not publish authority when native adoption fails", async () => {
    const { deps, handoff } = fixture();
    deps.adopt.mockRejectedValueOnce(new Error("fixture revoked grant"));
    await handoff.update(grant);
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.release).toHaveBeenCalledWith("database-a");
    expect(deps.onError).toHaveBeenCalledOnce();
  });

  it("releases local access on unmount and cancels a pending load", async () => {
    const { deps, handoff } = fixture();
    const loading = deferred<boolean>();
    deps.load.mockReturnValueOnce(loading.promise);
    const pending = handoff.update(grant);
    await vi.waitFor(() => expect(deps.load).toHaveBeenCalledOnce());
    const disposed = handoff.dispose();
    expect(deps.release).toHaveBeenCalledExactlyOnceWith("database-a");
    loading.resolve(false);
    await Promise.all([pending, disposed]);
    await handoff.update(grant);
    expect(deps.adopt).toHaveBeenCalledOnce();
    expect(deps.onError).not.toHaveBeenCalled();
  });
});

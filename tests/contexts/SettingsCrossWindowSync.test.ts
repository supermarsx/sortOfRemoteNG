import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import {
  SettingsManager,
  SettingsSyncRevisionTracker,
  type SettingsSyncPayload,
  type SettingsSyncRuntime,
  _resetInMemorySettingsStore,
} from "../../src/utils/settings/settingsManager";

type SyncHandler = (payload: unknown) => Promise<void>;

class DeterministicSettingsBus {
  readonly emitted: SettingsSyncPayload[] = [];
  private readonly listeners = new Map<number, SyncHandler>();
  private nextListenerId = 1;

  runtime(source: string): SettingsSyncRuntime {
    return {
      getSource: async () => source,
      emit: async (payload) => {
        this.emitted.push(payload);
        await this.dispatch(payload);
      },
      listen: async (handler) => {
        const id = this.nextListenerId++;
        this.listeners.set(id, handler);
        return () => this.listeners.delete(id);
      },
    };
  }

  async dispatch(payload: unknown): Promise<void> {
    await Promise.all(
      [...this.listeners.values()].map((handler) => handler(payload)),
    );
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

const withRestApiSecrets = (
  settings: GlobalSettings,
  apiKey: string,
  jwtSecret: string,
): GlobalSettings =>
  ({
    ...settings,
    restApi: {
      ...settings.restApi,
      apiKey,
      jwtSecret,
    },
  }) as GlobalSettings;

describe("SettingsManager cross-window synchronization", () => {
  beforeEach(() => {
    _resetInMemorySettingsStore();
    SettingsManager.resetInstance();
  });

  it("syncs both directions in commit order without persist or emit echoes", async () => {
    const bus = new DeterministicSettingsBus();
    const main = new SettingsManager({
      settingsSyncRuntime: bus.runtime("main"),
      settingsSyncWriterId: "writer-main",
      now: () => 1_000,
    });
    const detached = new SettingsManager({
      settingsSyncRuntime: bus.runtime("detached-1"),
      settingsSyncWriterId: "writer-detached",
      now: () => 1_000,
    });
    await main.loadSettings();
    await detached.loadSettings();

    const mainPersist = vi
      .spyOn(main as any, "persistSettings")
      .mockResolvedValueOnce(1);
    const detachedPersist = vi
      .spyOn(detached as any, "persistSettings")
      .mockResolvedValueOnce(2);
    const mainUpdates = vi.fn();
    const detachedUpdates = vi.fn();
    const unlistenMain = await main.listenForSettingsSync(mainUpdates);
    const unlistenDetached =
      await detached.listenForSettingsSync(detachedUpdates);

    await main.saveSettings({
      sshTrustPolicy: "strict",
      autoReconnectOnDisconnect: false,
      warnOnDetachClose: false,
    });

    expect(detached.getSettings()).toMatchObject({
      sshTrustPolicy: "strict",
      autoReconnectOnDisconnect: false,
      warnOnDetachClose: false,
    });
    expect(detachedUpdates).toHaveBeenCalledOnce();
    expect(mainUpdates).not.toHaveBeenCalled();
    expect(mainPersist).toHaveBeenCalledOnce();
    expect(detachedPersist).not.toHaveBeenCalled();
    expect(bus.emitted).toHaveLength(1);
    expect(bus.emitted[0]).toMatchObject({
      source: "main",
      writerId: "writer-main",
      commitGeneration: 1,
    });

    await detached.saveSettings({ confirmCloseActiveTab: false });

    expect(main.getSettings().confirmCloseActiveTab).toBe(false);
    expect(mainUpdates).toHaveBeenCalledOnce();
    expect(mainPersist).toHaveBeenCalledOnce();
    expect(detachedPersist).toHaveBeenCalledOnce();
    expect(bus.emitted).toHaveLength(2);
    expect(bus.emitted[1]).toMatchObject({
      source: "detached-1",
      writerId: "writer-detached",
      commitGeneration: 2,
    });

    unlistenMain();
    unlistenDetached();
    expect(bus.listenerCount).toBe(0);
  });

  it("rejects stale and malformed snapshots and strips sync secrets", async () => {
    const bus = new DeterministicSettingsBus();
    const main = new SettingsManager({
      settingsSyncRuntime: bus.runtime("main"),
      settingsSyncWriterId: "writer-main",
      now: () => 2_000,
    });
    const detached = new SettingsManager({
      settingsSyncRuntime: bus.runtime("detached-1"),
      settingsSyncWriterId: "writer-detached",
      now: () => 2_000,
    });
    await main.loadSettings();
    await detached.loadSettings();

    const mainPersist = vi
      .spyOn(main as any, "persistSettings")
      .mockResolvedValueOnce(10);
    const detachedPersist = vi.spyOn(detached as any, "persistSettings");
    const detachedUpdates = vi.fn();
    await main.listenForSettingsSync(vi.fn());
    const unlistenDetached =
      await detached.listenForSettingsSync(detachedUpdates);

    await main.saveSettings(
      withRestApiSecrets(main.getSettings(), "origin-api-key", "origin-jwt"),
    );
    const committed = bus.emitted[0];

    expect(committed.settings.restApi).not.toHaveProperty("apiKey");
    expect(committed.settings.restApi).not.toHaveProperty("jwtSecret");
    expect(main.getSettings().restApi).not.toHaveProperty("apiKey");
    expect(main.getSettings().restApi).not.toHaveProperty("jwtSecret");
    expect(detached.getSettings().restApi).not.toHaveProperty("apiKey");
    expect(detached.getSettings().restApi).not.toHaveProperty("jwtSecret");
    expect(detachedPersist).not.toHaveBeenCalled();

    const attacker = new SettingsSyncRevisionTracker(
      "writer-attacker",
      () => 2_000,
    );
    const malicious = attacker.next(
      "attacker",
      withRestApiSecrets(
        { ...detached.getSettings(), language: "fr" },
        "injected-api-key",
        "injected-jwt",
      ),
      11,
    );
    await bus.dispatch(malicious);

    expect(detached.getSettings().language).toBe("fr");
    expect(detached.getSettings().restApi).not.toHaveProperty("apiKey");
    expect(detached.getSettings().restApi).not.toHaveProperty("jwtSecret");

    await bus.dispatch(committed);
    await bus.dispatch({
      ...malicious,
      writerId: "writer-malformed",
      revision: malicious.revision + 1,
      commitGeneration: 12,
      settings: { language: "de" },
    });

    expect(detached.getSettings().language).toBe("fr");
    expect(detachedUpdates).toHaveBeenCalledTimes(2);
    expect(mainPersist).toHaveBeenCalledOnce();
    expect(detachedPersist).not.toHaveBeenCalled();
    expect(bus.emitted).toHaveLength(1);

    unlistenDetached();
    const afterCleanup = attacker.next(
      "attacker",
      { ...detached.getSettings(), language: "de" },
      13,
    );
    await bus.dispatch(afterCleanup);
    expect(detached.getSettings().language).toBe("fr");
  });

  it("returns a failed save without emitting at the frontend sync boundary", async () => {
    const bus = new DeterministicSettingsBus();
    const manager = new SettingsManager({
      settingsSyncRuntime: bus.runtime("main"),
      settingsSyncWriterId: "writer-main",
      now: () => 4_000,
    });
    await manager.loadSettings();
    vi.spyOn(manager as any, "persistSettings").mockRejectedValue(
      new Error("disk unavailable"),
    );

    await expect(manager.saveSettings({ language: "fr" })).rejects.toThrow(
      "disk unavailable",
    );

    expect(bus.emitted).toHaveLength(0);
  });

  it("drops a local completion older than an observed native commit", async () => {
    const bus = new DeterministicSettingsBus();
    const manager = new SettingsManager({
      settingsSyncRuntime: bus.runtime("main"),
      settingsSyncWriterId: "writer-main",
      now: () => 5_000,
    });
    await manager.loadSettings();
    const base = manager.getSettings();
    const updates = vi.fn();
    await manager.listenForSettingsSync(updates);

    let finishPersist!: (generation: number) => void;
    const pendingPersist = new Promise<number>((resolve) => {
      finishPersist = resolve;
    });
    const persist = vi
      .spyOn(manager as any, "persistSettings")
      .mockReturnValue(pendingPersist);
    const save = manager.saveSettings({ language: "de" });
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());

    const remote = new SettingsSyncRevisionTracker(
      "writer-detached",
      () => 5_000,
    );
    await bus.dispatch(
      remote.next(
        "detached-1",
        { ...base, language: "fr", warnOnDetachClose: false },
        2,
      ),
    );
    finishPersist(1);
    await save;

    expect(manager.getSettings()).toMatchObject({
      language: "fr",
      warnOnDetachClose: false,
    });
    expect(updates).toHaveBeenCalledOnce();
    expect(bus.emitted).toHaveLength(0);
  });

  it("merges a newer local completion onto the latest observed snapshot", async () => {
    const bus = new DeterministicSettingsBus();
    const manager = new SettingsManager({
      settingsSyncRuntime: bus.runtime("main"),
      settingsSyncWriterId: "writer-main",
      now: () => 6_000,
    });
    await manager.loadSettings();
    const base = manager.getSettings();
    await manager.listenForSettingsSync(vi.fn());

    let finishPersist!: (generation: number) => void;
    const pendingPersist = new Promise<number>((resolve) => {
      finishPersist = resolve;
    });
    const persist = vi
      .spyOn(manager as any, "persistSettings")
      .mockReturnValue(pendingPersist);
    const save = manager.saveSettings({ language: "de" });
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());

    const remote = new SettingsSyncRevisionTracker(
      "writer-detached",
      () => 6_000,
    );
    await bus.dispatch(
      remote.next(
        "detached-1",
        { ...base, language: "fr", warnOnDetachClose: false },
        2,
      ),
    );
    finishPersist(3);
    await save;

    expect(manager.getSettings()).toMatchObject({
      language: "de",
      warnOnDetachClose: false,
    });
    expect(bus.emitted).toHaveLength(1);
    expect(bus.emitted[0]).toMatchObject({
      commitGeneration: 3,
      settings: { language: "de", warnOnDetachClose: false },
    });
  });

  it("converges deterministically for same-tick fallback revisions", () => {
    const lowerWriter = new SettingsSyncRevisionTracker(
      "writer-a",
      () => 5_000,
    );
    const higherWriter = new SettingsSyncRevisionTracker(
      "writer-z",
      () => 5_000,
    );
    const base = new SettingsManager().getSettings();
    const lower = lowerWriter.next("main", {
      ...base,
      language: "de",
    });
    const higher = higherWriter.next("detached", {
      ...base,
      language: "fr",
    });

    expect(
      lowerWriter.accept(higher, (settings) => settings as GlobalSettings).kind,
    ).toBe("accepted");
    expect(
      higherWriter.accept(lower, (settings) => settings as GlobalSettings).kind,
    ).toBe("stale");
  });
});

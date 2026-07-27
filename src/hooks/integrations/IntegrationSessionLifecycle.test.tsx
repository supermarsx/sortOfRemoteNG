import React, { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  IntegrationSessionLifecycleProvider,
  disconnectIntegrationSession,
  reconnectIntegrationSession,
  useIntegrationConnectionLifecycle,
  type IntegrationSessionStateEvent,
} from "./IntegrationSessionLifecycle";

type LifecycleApi = ReturnType<typeof useIntegrationConnectionLifecycle>;

function Probe({ ready }: { ready: (api: LifecycleApi) => void }) {
  const api = useIntegrationConnectionLifecycle();
  useEffect(() => {
    ready(api);
  }, [api, ready]);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("IntegrationSessionLifecycle", () => {
  it("never treats an adopted handle without a reconnect operation as reconnected", async () => {
    let api!: LifecycleApi;
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const events: IntegrationSessionStateEvent[] = [];
    render(
      <IntegrationSessionLifecycleProvider
        sessionId="adopted"
        onStateChange={(event) => events.push(event)}
      >
        <Probe
          ready={(value) => {
            api = value;
          }}
        />
      </IntegrationSessionLifecycleProvider>,
    );
    await waitFor(() => expect(api).toBeTruthy());

    act(() => api.adoptConnection("provider", disconnect));
    await waitFor(() =>
      expect(events[events.length - 1]?.status).toBe("connected"),
    );

    await act(async () => {
      await expect(reconnectIntegrationSession("adopted")).resolves.toBe(false);
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(events[events.length - 1]?.status).toBe("disconnected");
  });

  it("rejects adoption of process-global handles without invoking foreign teardown", async () => {
    let api!: LifecycleApi;
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const events: IntegrationSessionStateEvent[] = [];
    render(
      <IntegrationSessionLifecycleProvider
        sessionId="cold-global-adopter"
        onStateChange={(event) => events.push(event)}
      >
        <Probe
          ready={(value) => {
            api = value;
          }}
        />
      </IntegrationSessionLifecycleProvider>,
    );
    await waitFor(() => expect(api).toBeTruthy());

    act(() => api.adoptConnection("exchange:global", disconnect));

    expect(disconnect).not.toHaveBeenCalled();
    expect(events[events.length - 1]).toMatchObject({
      status: "error",
      errorMessage: expect.stringMatching(/process-global.*cannot be adopted/i),
    });
    await act(async () => {
      await expect(
        disconnectIntegrationSession("cold-global-adopter"),
      ).resolves.toBe(false);
    });
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("retains the exact plan across disconnect and retries it after an initial failure", async () => {
    let api!: LifecycleApi;
    let shouldFail = true;
    const connect = vi.fn(async () => {
      if (shouldFail) throw new Error("offline");
      return "connected";
    });
    const disconnect = vi.fn().mockResolvedValue(undefined);
    render(
      <IntegrationSessionLifecycleProvider sessionId="retry">
        <Probe
          ready={(value) => {
            api = value;
          }}
        />
      </IntegrationSessionLifecycleProvider>,
    );
    await waitFor(() => expect(api).toBeTruthy());

    await act(async () => {
      await expect(
        api.trackConnect("provider", connect, disconnect),
      ).rejects.toThrow("offline");
    });
    shouldFail = false;
    await act(async () => {
      await expect(reconnectIntegrationSession("retry")).resolves.toBe(true);
      await expect(disconnectIntegrationSession("retry")).resolves.toBe(true);
      await expect(reconnectIntegrationSession("retry")).resolves.toBe(true);
    });

    expect(connect).toHaveBeenCalledTimes(3);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("serializes same-key connects and cleans a superseded handle before replacement", async () => {
    let api!: LifecycleApi;
    const first = deferred<string>();
    const calls: string[] = [];
    const firstDisconnect = vi.fn(async () => {
      calls.push("disconnect:first");
    });
    const secondDisconnect = vi.fn(async () => {
      calls.push("disconnect:second");
    });
    render(
      <IntegrationSessionLifecycleProvider sessionId="race">
        <Probe
          ready={(value) => {
            api = value;
          }}
        />
      </IntegrationSessionLifecycleProvider>,
    );
    await waitFor(() => expect(api).toBeTruthy());

    let firstConnect!: Promise<string>;
    let secondConnect!: Promise<string>;
    act(() => {
      firstConnect = api.trackConnect(
        "provider",
        async () => {
          calls.push("connect:first");
          return first.promise;
        },
        firstDisconnect,
      );
      secondConnect = api.trackConnect(
        "provider",
        async () => {
          calls.push("connect:second");
          return "second";
        },
        secondDisconnect,
      );
    });
    await waitFor(() => expect(calls).toEqual(["connect:first"]));

    first.resolve("first");
    await act(async () => {
      await firstConnect;
      await secondConnect;
    });

    expect(calls).toEqual([
      "connect:first",
      "disconnect:first",
      "connect:second",
    ]);
    expect(firstDisconnect).toHaveBeenCalledTimes(1);
    expect(secondDisconnect).not.toHaveBeenCalled();
  });

  it("a disconnect racing an in-flight connect cleans it once and never emits connected", async () => {
    let api!: LifecycleApi;
    const pending = deferred<string>();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const events: IntegrationSessionStateEvent[] = [];
    render(
      <IntegrationSessionLifecycleProvider
        sessionId="connect-close"
        onStateChange={(event) => events.push(event)}
      >
        <Probe
          ready={(value) => {
            api = value;
          }}
        />
      </IntegrationSessionLifecycleProvider>,
    );
    await waitFor(() => expect(api).toBeTruthy());

    let connecting!: Promise<string>;
    let closing!: Promise<boolean>;
    act(() => {
      connecting = api.trackConnect(
        "provider",
        () => pending.promise,
        disconnect,
      );
      closing = disconnectIntegrationSession("connect-close");
    });
    pending.resolve("late");
    await act(async () => {
      await connecting;
      await closing;
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.status === "connected")).toBe(false);
    expect(events[events.length - 1]?.status).toBe("disconnected");
  });

  it("attempts every provider teardown, rejects on one failure, and stays retryable", async () => {
    let api!: LifecycleApi;
    let rejectFirst = true;
    const firstDisconnect = vi.fn(async () => {
      if (rejectFirst) throw new Error("provider one refused cleanup");
    });
    const secondDisconnect = vi.fn().mockResolvedValue(undefined);
    const events: IntegrationSessionStateEvent[] = [];
    render(
      <IntegrationSessionLifecycleProvider
        sessionId="aggregate-disconnect"
        onStateChange={(event) => events.push(event)}
      >
        <Probe
          ready={(value) => {
            api = value;
          }}
        />
      </IntegrationSessionLifecycleProvider>,
    );
    await waitFor(() => expect(api).toBeTruthy());

    await act(async () => {
      await api.trackConnect(
        "provider-one",
        async () => "one",
        firstDisconnect,
      );
      await api.trackConnect(
        "provider-two",
        async () => "two",
        secondDisconnect,
      );
    });
    events.length = 0;

    await act(async () => {
      await expect(
        disconnectIntegrationSession("aggregate-disconnect"),
      ).rejects.toThrow("provider one refused cleanup");
    });

    expect(firstDisconnect).toHaveBeenCalledTimes(1);
    expect(secondDisconnect).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.status === "error")).toBe(true);
    expect(events[events.length - 1]?.status).toBe("error");

    rejectFirst = false;
    await act(async () => {
      await expect(
        disconnectIntegrationSession("aggregate-disconnect"),
      ).resolves.toBe(true);
    });
    expect(firstDisconnect).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]?.status).toBe("disconnected");
  });

  it("reserves a process-global provider before native staging and promotes it without a connected event", async () => {
    let firstApi!: LifecycleApi;
    let secondApi!: LifecycleApi;
    const firstDisconnect = vi.fn().mockResolvedValue(undefined);
    const secondDisconnect = vi.fn().mockResolvedValue(undefined);
    const firstEvents: IntegrationSessionStateEvent[] = [];
    render(
      <>
        <IntegrationSessionLifecycleProvider
          sessionId="reserved-global-first"
          onStateChange={(event) => firstEvents.push(event)}
        >
          <Probe
            ready={(value) => {
              firstApi = value;
            }}
          />
        </IntegrationSessionLifecycleProvider>
        <IntegrationSessionLifecycleProvider sessionId="reserved-global-second">
          <Probe
            ready={(value) => {
              secondApi = value;
            }}
          />
        </IntegrationSessionLifecycleProvider>
      </>,
    );
    await waitFor(() => {
      expect(firstApi).toBeTruthy();
      expect(secondApi).toBeTruthy();
    });

    await act(async () => {
      await firstApi.reserveConnection("gdrive:global", firstDisconnect);
      await expect(
        secondApi.reserveConnection("gdrive:global", secondDisconnect),
      ).rejects.toThrow(/already owned by another active integration session/i);
    });
    expect(firstEvents[firstEvents.length - 1]?.status).toBe("connecting");
    expect(firstEvents.some((event) => event.status === "connected")).toBe(
      false,
    );
    expect(secondDisconnect).not.toHaveBeenCalled();

    await act(async () => {
      await firstApi.trackConnect(
        "gdrive:global",
        async () => "authenticated",
        firstDisconnect,
      );
    });
    expect(firstDisconnect).not.toHaveBeenCalled();
    expect(firstEvents[firstEvents.length - 1]?.status).toBe("connected");

    await act(async () => {
      await disconnectIntegrationSession("reserved-global-first");
      await secondApi.reserveConnection("gdrive:global", secondDisconnect);
      await disconnectIntegrationSession("reserved-global-second");
    });
    expect(firstDisconnect).toHaveBeenCalledTimes(1);
    expect(secondDisconnect).toHaveBeenCalledTimes(1);
  });

  it("arbitrates process-global providers across session hosts without foreign teardown", async () => {
    let firstApi!: LifecycleApi;
    let secondApi!: LifecycleApi;
    const firstDisconnect = vi.fn().mockResolvedValue(undefined);
    const secondDisconnect = vi.fn().mockResolvedValue(undefined);
    render(
      <>
        <IntegrationSessionLifecycleProvider sessionId="global-first">
          <Probe
            ready={(value) => {
              firstApi = value;
            }}
          />
        </IntegrationSessionLifecycleProvider>
        <IntegrationSessionLifecycleProvider sessionId="global-second">
          <Probe
            ready={(value) => {
              secondApi = value;
            }}
          />
        </IntegrationSessionLifecycleProvider>
      </>,
    );
    await waitFor(() => {
      expect(firstApi).toBeTruthy();
      expect(secondApi).toBeTruthy();
    });

    await act(async () => {
      await firstApi.trackConnect(
        "gdrive:global",
        async () => "first",
        firstDisconnect,
      );
      await expect(
        secondApi.trackConnect(
          "gdrive:global",
          async () => "second",
          secondDisconnect,
        ),
      ).rejects.toThrow(/already owned by another active integration session/i);
    });
    expect(secondDisconnect).not.toHaveBeenCalled();

    await act(async () => {
      await disconnectIntegrationSession("global-first");
      await expect(
        secondApi.trackConnect(
          "gdrive:global",
          async () => "second",
          secondDisconnect,
        ),
      ).resolves.toBe("second");
      await disconnectIntegrationSession("global-second");
    });
    expect(firstDisconnect).toHaveBeenCalledTimes(1);
    expect(secondDisconnect).toHaveBeenCalledTimes(1);
  });
});

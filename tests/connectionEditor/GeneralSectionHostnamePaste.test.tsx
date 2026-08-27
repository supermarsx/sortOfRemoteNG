import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import GeneralSection from "../../src/components/connectionEditor/GeneralSection";
import { ToastContext } from "../../src/contexts/ToastContext";
import type { Connection } from "../../src/types/connection/connection";

// ── Mocks (same shape as GeneralSection.test.tsx) ──

vi.mock("../../src/hooks/runtime/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({
    cloud: true,
    ops: true,
    rdp: true,
    serial: true,
    mysql: true,
    postgresql: true,
    source: "native" as const,
  }),
}));

vi.mock("../../src/utils/window/dragDropManager", () => ({
  getConnectionDepth: () => 0,
  getMaxDescendantDepth: () => 0,
  MAX_NESTING_DEPTH: 5,
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({ state: { tabGroups: [] } }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, vars?: Record<string, unknown>) =>
      (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (_m, k) =>
        String(vars?.[k] ?? ""),
      ),
  }),
}));

const toastInfo = vi.fn();

/** Stateful harness so setFormData(prev => …) actually applies. */
function Harness({
  initial,
  onChange,
}: {
  initial: Partial<Connection>;
  onChange: (fd: Partial<Connection>) => void;
}) {
  const [formData, setFormData] = React.useState<Partial<Connection>>(initial);
  React.useEffect(() => onChange(formData), [formData, onChange]);
  return (
    <ToastContext.Provider
      value={
        {
          toast: {
            info: toastInfo,
            success: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
          },
        } as unknown as React.ContextType<typeof ToastContext>
      }
    >
      <GeneralSection
        formData={formData}
        setFormData={setFormData}
        availableGroups={[]}
        allConnections={[]}
      />
    </ToastContext.Provider>
  );
}

function renderWith(initial: Partial<Connection>) {
  let latest: Partial<Connection> = initial;
  const onChange = (fd: Partial<Connection>) => {
    latest = fd;
  };
  render(<Harness initial={initial} onChange={onChange} />);
  return { get: () => latest };
}

const NEW_RDP: Partial<Connection> = {
  name: "",
  hostname: "",
  port: 3389,
  protocol: "rdp",
};

describe("GeneralSection — protocol inferred from pasted URL (t71 RC4)", () => {
  beforeEach(() => {
    toastInfo.mockReset();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it("switches rdp → https and takes the URL port on blur", () => {
    const h = renderWith(NEW_RDP);
    const input = screen.getByTestId("editor-hostname");
    fireEvent.change(input, {
      target: { value: "https://portal.example.com:8443/login" },
    });
    fireEvent.blur(input, {
      target: { value: "https://portal.example.com:8443/login" },
    });

    expect(h.get().protocol).toBe("https");
    expect(h.get().port).toBe(8443);
    expect(h.get().hostname).toBe("portal.example.com");
    expect(h.get().authType).toBe("basic");
    expect(screen.getByTestId("editor-protocol")).toHaveTextContent("HTTPS");
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo.mock.calls[0][0]).toContain(
      "Switched protocol to HTTPS because the pasted address starts with https://",
    );
    expect(toastInfo.mock.calls[0][0]).toContain("Moved port 8443");
  });

  it("uses the scheme's default port when the URL has none", () => {
    const h = renderWith(NEW_RDP);
    const input = screen.getByTestId("editor-hostname");
    fireEvent.blur(input, { target: { value: "https://portal.example.com" } });
    expect(h.get().protocol).toBe("https");
    expect(h.get().port).toBe(443);
    expect(h.get().hostname).toBe("portal.example.com");
  });

  it("maps http:// with the path discarded", () => {
    const a = renderWith(NEW_RDP);
    fireEvent.blur(screen.getByTestId("editor-hostname"), {
      target: { value: "http://router.local/admin" },
    });
    expect(a.get().protocol).toBe("http");
    expect(a.get().port).toBe(80);
    expect(a.get().hostname).toBe("router.local");
  });

  it("infers ssh:// as well", () => {
    const h = renderWith(NEW_RDP);
    fireEvent.blur(screen.getByTestId("editor-hostname"), {
      target: { value: "ssh://box.lan:2222" },
    });
    expect(h.get().protocol).toBe("ssh");
    expect(h.get().port).toBe(2222);
  });

  it("works on paste (deferred one frame)", () => {
    const h = renderWith(NEW_RDP);
    const input = screen.getByTestId("editor-hostname");
    act(() => {
      fireEvent.paste(input, {
        clipboardData: { getData: () => "https://host.example:9443/x" },
      });
    });
    expect(h.get().protocol).toBe("https");
    expect(h.get().port).toBe(9443);
    expect(h.get().hostname).toBe("host.example");
  });

  it("keeps a deliberately set non-default port", () => {
    const h = renderWith({ ...NEW_RDP, port: 3390 });
    fireEvent.blur(screen.getByTestId("editor-hostname"), {
      target: { value: "https://portal.example.com:8443" },
    });
    expect(h.get().protocol).toBe("https");
    expect(h.get().port).toBe(3390);
  });

  it("does not switch when the scheme matches the current protocol", () => {
    const h = renderWith({ ...NEW_RDP, protocol: "https", port: 443 });
    fireEvent.blur(screen.getByTestId("editor-hostname"), {
      target: { value: "https://portal.example.com/x" },
    });
    expect(h.get().protocol).toBe("https");
    expect(h.get().port).toBe(443);
    expect(toastInfo.mock.calls[0][0]).toContain(
      "Removed the `https://` prefix",
    );
    expect(toastInfo.mock.calls[0][0]).not.toContain("Switched protocol");
  });

  it("leaves protocol alone for a plain hostname", () => {
    const h = renderWith(NEW_RDP);
    fireEvent.blur(screen.getByTestId("editor-hostname"), {
      target: { value: "server01" },
    });
    expect(h.get().protocol).toBe("rdp");
    expect(toastInfo).not.toHaveBeenCalled();
  });
});

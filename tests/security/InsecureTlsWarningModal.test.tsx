import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { InsecureTlsWarningModal } from "../../src/components/security/InsecureTlsWarningModal";
import { useInsecureTlsAck } from "../../src/hooks/security/useInsecureTlsAck";
import { renderHook, act } from "@testing-library/react";

describe("InsecureTlsWarningModal", () => {
  it("renders the warning with endpoint and kind label when open", () => {
    render(
      <InsecureTlsWarningModal
        isOpen
        kind="k8s"
        endpoint="https://cluster.lab:6443"
        connectionName="lab-cluster"
        onAcknowledge={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /insecure tls connection/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/kubernetes/i)).toBeInTheDocument();
    expect(screen.getByText(/lab-cluster/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/https:\/\/cluster\.lab:6443/).length,
    ).toBeGreaterThan(0);
  });

  it("disables continue until the user checks 'I understand'", () => {
    const onAck = vi.fn();
    render(
      <InsecureTlsWarningModal
        isOpen
        kind="cicd"
        endpoint="https://ci.lab"
        onAcknowledge={onAck}
        onCancel={() => {}}
      />,
    );

    const continueBtn = screen.getByRole("button", {
      name: /continue insecurely/i,
    });
    expect(continueBtn).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/i understand the risks/i));
    expect(continueBtn).toBeEnabled();

    fireEvent.click(continueBtn);
    expect(onAck).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <InsecureTlsWarningModal
        isOpen={false}
        kind="bmc"
        endpoint="https://bmc.lab"
        onAcknowledge={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("useInsecureTlsAck", () => {
  it("reports needsAck=true for insecure configs with no persisted ack", () => {
    window.localStorage.clear();
    const { result } = renderHook(() =>
      useInsecureTlsAck({ configId: "cfg-1", insecure: true }),
    );
    expect(result.current.needsAck).toBe(true);
    expect(result.current.acknowledged).toBe(false);
  });

  it("persists the ack and flips needsAck to false", () => {
    window.localStorage.clear();
    const { result } = renderHook(() =>
      useInsecureTlsAck({ configId: "cfg-2", insecure: true }),
    );
    act(() => result.current.acknowledge());
    expect(result.current.acknowledged).toBe(true);
    expect(result.current.needsAck).toBe(false);
    expect(
      window.localStorage.getItem("insecure-tls-ack:cfg-2"),
    ).not.toBeNull();
  });

  it("reports needsAck=false when insecure=false even without ack", () => {
    window.localStorage.clear();
    const { result } = renderHook(() =>
      useInsecureTlsAck({ configId: "cfg-3", insecure: false }),
    );
    expect(result.current.needsAck).toBe(false);
  });
});

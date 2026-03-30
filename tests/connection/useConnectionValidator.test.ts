import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useConnectionValidator } from "../../src/hooks/connection/useConnectionValidator";

describe("useConnectionValidator", () => {
  it("returns valid for complete connection", () => {
    const { result } = renderHook(() =>
      useConnectionValidator({ name: "My Server", hostname: "192.168.1.1", port: 22, protocol: "ssh" }),
    );
    expect(result.current.isValid).toBe(true);
    expect(result.current.errors).toHaveLength(0);
  });

  it("returns error for missing name", () => {
    const { result } = renderHook(() =>
      useConnectionValidator({ name: "", hostname: "host", port: 22, protocol: "ssh" }),
    );
    expect(result.current.isValid).toBe(false);
    expect(result.current.errors).toContainEqual({ field: "name", message: "Connection name is required" });
  });

  it("returns error for missing hostname", () => {
    const { result } = renderHook(() =>
      useConnectionValidator({ name: "Test", hostname: "", port: 22, protocol: "ssh" }),
    );
    expect(result.current.isValid).toBe(false);
    expect(result.current.errors).toContainEqual({ field: "hostname", message: "Hostname is required" });
  });

  it("returns error for hostname with spaces", () => {
    const { result } = renderHook(() =>
      useConnectionValidator({ name: "Test", hostname: "my host", port: 22, protocol: "ssh" }),
    );
    expect(result.current.isValid).toBe(false);
    expect(result.current.errors).toContainEqual({ field: "hostname", message: "Hostname cannot contain spaces" });
  });

  it("returns error for port out of range", () => {
    const { result } = renderHook(() =>
      useConnectionValidator({ name: "Test", hostname: "host", port: 70000, protocol: "ssh" }),
    );
    expect(result.current.isValid).toBe(false);
    expect(result.current.errors).toContainEqual({ field: "port", message: "Port must be between 1 and 65535" });
  });

  it("returns error for port below 1", () => {
    const { result } = renderHook(() =>
      useConnectionValidator({ name: "Test", hostname: "host", port: 0, protocol: "ssh" }),
    );
    expect(result.current.isValid).toBe(false);
    expect(result.current.errors).toContainEqual({ field: "port", message: "Port must be between 1 and 65535" });
  });

  it("returns error for missing protocol", () => {
    const { result } = renderHook(() =>
      useConnectionValidator({ name: "Test", hostname: "host", port: 22, protocol: "" }),
    );
    expect(result.current.isValid).toBe(false);
    expect(result.current.errors).toContainEqual({ field: "protocol", message: "Protocol is required" });
  });

  it("returns multiple errors for multiple issues", () => {
    const { result } = renderHook(() =>
      useConnectionValidator({ name: "", hostname: "", port: -1, protocol: "" }),
    );
    expect(result.current.isValid).toBe(false);
    expect(result.current.errors.length).toBeGreaterThanOrEqual(3);
  });
});

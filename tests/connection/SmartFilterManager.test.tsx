import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      if (opts && typeof opts === "object" && "count" in opts)
        return `${key} ${(opts as Record<string, unknown>).count}`;
      return key;
    },
  }),
}));

import { SmartFilterManager } from "../../src/components/connection/SmartFilterManager";

/* Render with isOpen=true and flush all async effects so loading settles */
async function renderOpen(onClose = vi.fn()) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<SmartFilterManager isOpen={true} onClose={onClose} />);
  });
  return result;
}

describe("SmartFilterManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "filter_list":
          return Promise.resolve([]);
        case "filter_list_smart_groups":
          return Promise.resolve([]);
        case "filter_get_presets":
          return Promise.resolve([]);
        case "filter_get_stats":
          return Promise.resolve({
            totalFilters: 0,
            totalSmartGroups: 0,
            cacheHitRate: 0,
            lastEvaluationTimeMs: 0,
          });
        default:
          return Promise.resolve(null);
      }
    });
  });

  it("renders the title", async () => {
    await renderOpen();
    expect(screen.getByText("smartFilter.title")).toBeInTheDocument();
  });

  it("shows smart groups sidebar", async () => {
    await renderOpen();
    expect(screen.getByText("smartFilter.smartGroups")).toBeInTheDocument();
  });

  it("shows filter name label", async () => {
    await renderOpen();
    expect(screen.getByText("smartFilter.filterName")).toBeInTheDocument();
  });

  it("shows presets section", async () => {
    await renderOpen();
    expect(screen.getByText("smartFilter.presets")).toBeInTheDocument();
  });

  it("shows save filter button", async () => {
    await renderOpen();
    expect(screen.getByText("smartFilter.saveFilter")).toBeInTheDocument();
  });

  it("shows add condition button", async () => {
    await renderOpen();
    expect(screen.getByText(/smartFilter\.addCondition/)).toBeInTheDocument();
  });

  it("shows AND/OR logic toggle", async () => {
    await renderOpen();
    expect(screen.getByText("AND")).toBeInTheDocument();
  });

  it("adds a condition row when add button clicked", async () => {
    await renderOpen();
    const addBtn = screen.getByText(/smartFilter\.addCondition/);
    await act(async () => {
      fireEvent.click(addBtn);
    });
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThan(0);
  });

  it("shows empty state for smart groups", async () => {
    await renderOpen();
    expect(screen.getByText("smartFilter.noGroupsYet")).toBeInTheDocument();
  });

  it("shows match logic label", async () => {
    await renderOpen();
    expect(screen.getByText("smartFilter.matchLogic")).toBeInTheDocument();
  });

  it("renders filter name input", async () => {
    await renderOpen();
    const input = screen.getByPlaceholderText(
      "smartFilter.filterNamePlaceholder",
    );
    expect(input).toBeInTheDocument();
  });

  it("shows preview button", async () => {
    await renderOpen();
    expect(screen.getByText("smartFilter.preview")).toBeInTheDocument();
  });

  it("fetches filters on mount", async () => {
    await renderOpen();
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
  });
});

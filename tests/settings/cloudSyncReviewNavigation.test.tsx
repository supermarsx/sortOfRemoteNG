import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsDialog } from "../../src/hooks/settings/useSettingsDialog";
import ConflictResolutionSection from "../../src/components/SettingsDialog/sections/cloudSync/ConflictResolutionSection";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import { defaultCloudSyncConfig } from "../../src/types/settings/cloudSyncSettings";
import {
  openCloudSyncConflictReview,
  finishCloudSyncReviewNavigation,
  useCloudSyncReviewNavigation,
} from "../../src/utils/settings/cloudSyncReviewNavigation";

const mocks = vi.hoisted(() => ({
  settings: {},
  manager: { applyInMemory: vi.fn(), saveSettings: vi.fn() },
  theme: {},
  open: vi.fn(),
  toast: {},
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: mocks.settings, settingsReady: true }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: mocks.toast }),
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => mocks.manager },
}));
vi.mock("../../src/utils/settings/themeManager", () => ({
  ThemeManager: { getInstance: () => mocks.theme },
}));
vi.mock("../../src/components/ui/InfoTooltip", () => ({
  InfoTooltip: () => null,
}));

const reviewMgr = {
  cloudSync: defaultCloudSyncConfig,
  syncTargets: [],
  conflictReview: null,
  reviewRequestSequence: 0,
} as unknown as Mgr;

function Harness({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const mgr = useSettingsDialog(open, () => {}, "general");
  return (
    <>
      <button
        onClick={() =>
          openCloudSyncConflictReview((tab) => {
            mocks.open(tab);
            setOpen(true);
          })
        }
      >
        Alert action
      </button>
      {open && (
        <>
          <output aria-label="Active section">{mgr.activeTab}</output>
          <button onClick={() => mgr.setActiveTab("general")}>
            General section
          </button>
          {mgr.activeTab === "cloudSync" && (
            <ConflictResolutionSection mgr={reviewMgr} />
          )}
        </>
      )}
    </>
  );
}

beforeEach(() => {
  mocks.open.mockClear();
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    configurable: true,
  });
});
afterEach(() => {
  const { result, unmount } = renderHook(useCloudSyncReviewNavigation);
  act(() => finishCloudSyncReviewNavigation(result.current));
  unmount();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("alert conflict subsection navigation", () => {
  it.each([false, true])(
    "selects Cloud Sync before focusing review (already open: %s), including repeated links",
    async (initiallyOpen) => {
      render(<Harness initiallyOpen={initiallyOpen} />);
      for (let index = 0; index < 2; index++) {
        fireEvent.click(screen.getByRole("button", { name: "Alert action" }));
        await waitFor(() =>
          expect(
            screen.getByRole("region", { name: "Conflict Resolution" }),
          ).toHaveFocus(),
        );
        expect(screen.getByLabelText("Active section")).toHaveTextContent(
          "cloudSync",
        );
        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({
          block: "start",
        });
        fireEvent.click(
          screen.getByRole("button", { name: "General section" }),
        );
        expect(
          screen.queryByRole("region", { name: "Conflict Resolution" }),
        ).not.toBeInTheDocument();
      }
      expect(mocks.open.mock.calls).toEqual([["cloudSync"], ["cloudSync"]]);
    },
  );

  it("does not focus a hidden panel or reuse the consumed intent on a later mount", async () => {
    vi.mocked(HTMLElement.prototype.getClientRects).mockReturnValue(
      [] as unknown as DOMRectList,
    );
    const view = render(<Harness initiallyOpen />);
    fireEvent.click(screen.getByRole("button", { name: "Alert action" }));
    const section = await screen.findByRole("region", {
      name: "Conflict Resolution",
    });
    expect(section).not.toHaveFocus();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    vi.mocked(HTMLElement.prototype.getClientRects).mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    await waitFor(() => expect(section).toHaveFocus());
    view.unmount();
    render(<Harness initiallyOpen />);
    expect(screen.getByLabelText("Active section")).toHaveTextContent(
      "general",
    );
    expect(
      screen.queryByRole("region", { name: "Conflict Resolution" }),
    ).not.toBeInTheDocument();
  });
});

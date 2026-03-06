import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DdnsManager } from "../src/components/DdnsManager";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("../src/utils/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../src/utils/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue("dark"),
    }),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

// Hook mock matching the exact return shape of useDdnsManager
const makeHookReturn = () => ({
  // state
  profiles: [] as any[],
  selectedProfile: null as any,
  updateResults: [] as any[],
  ipResult: null as any,
  currentIps: [null, null] as [string | null, string | null],
  healthList: [] as any[],
  systemStatus: null as any,
  providers: [] as any[],
  schedulerStatus: null as any,
  config: null as any,
  auditLog: [] as any[],
  cfZones: [] as any[],
  cfRecords: [] as any[],
  loading: false,
  error: null as string | null,

  // profile CRUD
  listProfiles: vi.fn(),
  getProfile: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  enableProfile: vi.fn(),
  disableProfile: vi.fn(),

  // updates
  triggerUpdate: vi.fn(),
  triggerUpdateAll: vi.fn(),

  // IP
  detectIp: vi.fn(),
  getCurrentIps: vi.fn(),

  // scheduler
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  getSchedulerStatus: vi.fn(),

  // health
  getAllHealth: vi.fn(),
  getProfileHealth: vi.fn(),
  getSystemStatus: vi.fn(),

  // provider info
  listProviders: vi.fn(),
  getProviderCapabilities: vi.fn(),

  // cloudflare
  cfListZones: vi.fn(),
  cfListRecords: vi.fn(),
  cfCreateRecord: vi.fn(),
  cfDeleteRecord: vi.fn(),

  // config
  getConfig: vi.fn(),
  updateConfig: vi.fn(),

  // audit
  getAuditLog: vi.fn(),
  getAuditForProfile: vi.fn(),
  exportAudit: vi.fn(),
  clearAudit: vi.fn(),

  // import / export
  exportProfiles: vi.fn(),
  importProfiles: vi.fn(),
});

let hookReturn = makeHookReturn();

vi.mock("../src/hooks/useDdnsManager", () => ({
  useDdnsManager: () => hookReturn,
}));

const mockOnClose = vi.fn();
const defaultProps = { isOpen: true, onClose: mockOnClose };

const renderComponent = (props = {}) =>
  render(<DdnsManager {...defaultProps} {...props} />);

describe("DdnsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookReturn = makeHookReturn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic Rendering ────────────────────────────────────────────

  describe("Basic Rendering", () => {
    it("should not render when isOpen is false", () => {
      renderComponent({ isOpen: false });
      expect(screen.queryByText("DDNS Manager")).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", () => {
      renderComponent();
      expect(screen.getByText("DDNS Manager")).toBeInTheDocument();
    });

    it("should display all tab labels", () => {
      renderComponent();
      const tabLabels = [
        "PROFILES",
        "HEALTH",
        "CLOUDFLARE",
        "IP",
        "SCHEDULER",
        "CONFIG",
        "AUDIT",
      ];
      for (const label of tabLabels) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    });

    it("should render the Update All button in footer", () => {
      renderComponent();
      expect(screen.getByText("Update all")).toBeInTheDocument();
    });

    it("should render the Export button in footer", () => {
      renderComponent();
      expect(screen.getByText("Export")).toBeInTheDocument();
    });

    it("should render the Close button in footer", () => {
      renderComponent();
      expect(screen.getByText("Close")).toBeInTheDocument();
    });
  });

  // ── Tab Switching ──────────────────────────────────────────────

  describe("Tab Switching", () => {
    it("should show empty state on Profiles tab by default", () => {
      renderComponent();
      expect(screen.getByText("No DDNS profiles")).toBeInTheDocument();
    });

    it("should switch to Health tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("HEALTH"));
      // Health tab fires getAllHealth and getSystemStatus on mount
      expect(hookReturn.getAllHealth).toHaveBeenCalled();
    });

    it("should switch to Cloudflare tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("CLOUDFLARE"));
      expect(screen.getByText("No Cloudflare profiles")).toBeInTheDocument();
    });

    it("should switch to IP Detection tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("IP"));
      expect(screen.getByText("Detect public IP")).toBeInTheDocument();
    });

    it("should switch to Scheduler tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("SCHEDULER"));
      expect(hookReturn.getSchedulerStatus).toHaveBeenCalled();
    });

    it("should switch to Config tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("CONFIG"));
      expect(hookReturn.getConfig).toHaveBeenCalled();
    });

    it("should switch to Audit tab", () => {
      renderComponent();
      fireEvent.click(screen.getByText("AUDIT"));
      expect(hookReturn.getAuditLog).toHaveBeenCalled();
    });
  });

  // ── Error State ────────────────────────────────────────────────

  describe("Error State", () => {
    it("should display error banner when error is set", () => {
      hookReturn = { ...makeHookReturn(), error: "Connection failed" };
      renderComponent();
      expect(screen.getByText("Connection failed")).toBeInTheDocument();
    });

    it("should not display error banner when error is null", () => {
      hookReturn = { ...makeHookReturn(), error: null };
      renderComponent();
      expect(screen.queryByText("Connection failed")).not.toBeInTheDocument();
    });
  });

  // ── Profiles Tab ───────────────────────────────────────────────

  describe("Profiles Tab", () => {
    it("should show empty state when no profiles exist", () => {
      renderComponent();
      expect(screen.getByText("No DDNS profiles")).toBeInTheDocument();
      expect(screen.getByText("Create a profile to start managing dynamic DNS records")).toBeInTheDocument();
    });

    it("should display profile list when profiles exist", () => {
      hookReturn = {
        ...makeHookReturn(),
        profiles: [
          {
            id: "p1",
            name: "Home Cloudflare",
            enabled: true,
            provider: "Cloudflare",
            auth: { ApiToken: { token: "xxx" } },
            domain: "example.com",
            hostname: "home",
            ip_version: "V4Only",
            update_interval_secs: 300,
            provider_settings: "None",
            tags: [],
            notes: null,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
      };
      renderComponent();
      expect(screen.getByText("Home Cloudflare")).toBeInTheDocument();
      expect(screen.getByText("Cloudflare")).toBeInTheDocument();
    });

    it("should show Enabled badge for enabled profiles", () => {
      hookReturn = {
        ...makeHookReturn(),
        profiles: [
          {
            id: "p1",
            name: "Test",
            enabled: true,
            provider: "DuckDns",
            auth: { ApiToken: { token: "t" } },
            domain: "myhost",
            hostname: "",
            ip_version: "Auto",
            update_interval_secs: 600,
            provider_settings: "None",
            tags: [],
            notes: null,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
      };
      renderComponent();
      expect(screen.getByText("Enabled")).toBeInTheDocument();
    });

    it("should call triggerUpdateAll when footer button clicked", () => {
      renderComponent();
      fireEvent.click(screen.getByText("Update all"));
      expect(hookReturn.triggerUpdateAll).toHaveBeenCalled();
    });
  });

  // ── Health Tab ─────────────────────────────────────────────────

  describe("Health Tab", () => {
    it("should show empty state when no health data", () => {
      renderComponent();
      fireEvent.click(screen.getByText("HEALTH"));
      expect(screen.getByText("No health data")).toBeInTheDocument();
    });

    it("should show system status overview", () => {
      hookReturn = {
        ...makeHookReturn(),
        systemStatus: {
          total_profiles: 5,
          enabled_profiles: 4,
          healthy_profiles: 3,
          error_profiles: 1,
          current_ipv4: "1.2.3.4",
          current_ipv6: null,
          scheduler_running: true,
          last_ip_check: "2024-01-01T00:00:00Z",
          uptime_secs: 3600,
        },
      };
      renderComponent();
      fireEvent.click(screen.getByText("HEALTH"));
      expect(screen.getByText("5")).toBeInTheDocument();
      expect(screen.getByText("1.2.3.4")).toBeInTheDocument();
    });

    it("should show per-profile health entries", () => {
      hookReturn = {
        ...makeHookReturn(),
        systemStatus: {
          total_profiles: 1,
          enabled_profiles: 1,
          healthy_profiles: 1,
          error_profiles: 0,
          current_ipv4: "1.2.3.4",
          current_ipv6: null,
          scheduler_running: false,
          last_ip_check: null,
          uptime_secs: 0,
        },
        healthList: [
          {
            profile_id: "p1",
            profile_name: "My Profile",
            enabled: true,
            provider: "NoIp",
            fqdn: "home.example.com",
            current_ipv4: "1.2.3.4",
            current_ipv6: null,
            last_success: "2024-01-01T00:00:00Z",
            last_failure: null,
            last_error: null,
            success_count: 10,
            failure_count: 0,
            consecutive_failures: 0,
            next_update: null,
            is_healthy: true,
          },
        ],
      };
      renderComponent();
      fireEvent.click(screen.getByText("HEALTH"));
      expect(screen.getByText("My Profile")).toBeInTheDocument();
      expect(screen.getByText(/home\.example\.com/)).toBeInTheDocument();
    });
  });

  // ── IP Detection Tab ───────────────────────────────────────────

  describe("IP Detection Tab", () => {
    it("should call detectIp when Detect button clicked", () => {
      renderComponent();
      fireEvent.click(screen.getByText("IP"));
      fireEvent.click(screen.getByText("Detect public IP"));
      expect(hookReturn.detectIp).toHaveBeenCalled();
    });

    it("should call getCurrentIps when Show cached clicked", () => {
      renderComponent();
      fireEvent.click(screen.getByText("IP"));
      fireEvent.click(screen.getByText("Show cached"));
      expect(hookReturn.getCurrentIps).toHaveBeenCalled();
    });

    it("should display IP detection result", () => {
      hookReturn = {
        ...makeHookReturn(),
        ipResult: {
          ipv4: "100.200.50.25",
          ipv6: null,
          service_used: "Ipify",
          latency_ms: 42,
          timestamp: "2024-01-01T00:00:00Z",
        },
      };
      renderComponent();
      fireEvent.click(screen.getByText("IP"));
      expect(screen.getByText("100.200.50.25")).toBeInTheDocument();
      expect(screen.getByText("Ipify")).toBeInTheDocument();
      expect(screen.getByText("42ms")).toBeInTheDocument();
    });
  });

  // ── Scheduler Tab ──────────────────────────────────────────────

  describe("Scheduler Tab", () => {
    it("should call startScheduler when Start clicked", () => {
      renderComponent();
      fireEvent.click(screen.getByText("SCHEDULER"));
      fireEvent.click(screen.getByText("Start"));
      expect(hookReturn.startScheduler).toHaveBeenCalled();
    });

    it("should call stopScheduler when Stop clicked", () => {
      renderComponent();
      fireEvent.click(screen.getByText("SCHEDULER"));
      fireEvent.click(screen.getByText("Stop"));
      expect(hookReturn.stopScheduler).toHaveBeenCalled();
    });

    it("should display scheduler status", () => {
      hookReturn = {
        ...makeHookReturn(),
        schedulerStatus: {
          running: true,
          total_entries: 3,
          active_entries: 2,
          paused_entries: 1,
          entries: [
            {
              profile_id: "abc12345-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
              interval_secs: 300,
              next_run: "2024-01-01T01:00:00Z",
              last_run: null,
              paused: false,
              backoff_factor: 1.0,
            },
          ],
        },
      };
      renderComponent();
      fireEvent.click(screen.getByText("SCHEDULER"));
      expect(screen.getByText("Running")).toBeInTheDocument();
      expect(screen.getByText(/2 active/)).toBeInTheDocument();
    });
  });

  // ── Config Tab ─────────────────────────────────────────────────

  describe("Config Tab", () => {
    it("should display config values when loaded", () => {
      hookReturn = {
        ...makeHookReturn(),
        config: {
          ip_detect_services: ["Ipify"],
          ip_check_interval_secs: 300,
          http_timeout_secs: 15,
          max_retries: 3,
          retry_backoff_base_secs: 60,
          retry_backoff_max_secs: 3600,
          retry_jitter: true,
          max_audit_entries: 1000,
          auto_start_scheduler: false,
          notify_on_ip_change: true,
          notify_on_failure: true,
          failure_threshold: 3,
        },
        providers: [
          {
            provider: "Cloudflare",
            display_name: "Cloudflare DNS",
            supports_ipv4: true,
            supports_ipv6: true,
            supports_wildcard: true,
            supports_mx: false,
            supports_txt: true,
            supports_proxy: true,
            supports_ttl: true,
            supports_multi_host: false,
            requires_zone_id: false,
            max_update_frequency_secs: 0,
            website_url: "https://cloudflare.com",
            free_tier: true,
            notes: "",
          },
        ],
      };
      renderComponent();
      fireEvent.click(screen.getByText("CONFIG"));
      expect(screen.getByText("300s")).toBeInTheDocument();
      expect(screen.getByText("15s")).toBeInTheDocument();
      expect(screen.getByText("Cloudflare DNS")).toBeInTheDocument();
    });
  });

  // ── Audit Tab ──────────────────────────────────────────────────

  describe("Audit Tab", () => {
    it("should show empty state when no audit entries", () => {
      renderComponent();
      fireEvent.click(screen.getByText("AUDIT"));
      expect(screen.getByText("No audit entries")).toBeInTheDocument();
      expect(screen.getByText("Actions will be logged here")).toBeInTheDocument();
    });

    it("should display audit entries", () => {
      hookReturn = {
        ...makeHookReturn(),
        auditLog: [
          {
            id: "a1",
            timestamp: "2024-01-01T12:00:00Z",
            action: "UpdateSuccess",
            profile_id: "p1",
            profile_name: "Home",
            provider: "Cloudflare",
            detail: "Updated home.example.com to 1.2.3.4",
            success: true,
            error: null,
          },
        ],
      };
      renderComponent();
      fireEvent.click(screen.getByText("AUDIT"));
      expect(screen.getByText("UpdateSuccess")).toBeInTheDocument();
      expect(screen.getByText(/Updated home\.example\.com/)).toBeInTheDocument();
    });

    it("should call clearAudit after confirm", () => {
      hookReturn = {
        ...makeHookReturn(),
        auditLog: [
          {
            id: "a1",
            timestamp: "2024-01-01T12:00:00Z",
            action: "ProfileCreated",
            profile_id: null,
            profile_name: null,
            provider: null,
            detail: "Test",
            success: true,
            error: null,
          },
        ],
      };
      renderComponent();
      fireEvent.click(screen.getByText("AUDIT"));
      fireEvent.click(screen.getByText("Clear"));
      // Should show confirm dialog
      expect(screen.getByText(/clear the audit log/)).toBeInTheDocument();
      fireEvent.click(screen.getByText("Confirm"));
      expect(hookReturn.clearAudit).toHaveBeenCalled();
    });
  });

  // ── Cloudflare Tab ─────────────────────────────────────────────

  describe("Cloudflare Tab", () => {
    it("should show empty state when no Cloudflare profiles", () => {
      renderComponent();
      fireEvent.click(screen.getByText("CLOUDFLARE"));
      expect(screen.getByText("No Cloudflare profiles")).toBeInTheDocument();
    });

    it("should show profile selector when CF profiles exist", () => {
      hookReturn = {
        ...makeHookReturn(),
        profiles: [
          {
            id: "cf1",
            name: "My CF",
            enabled: true,
            provider: "Cloudflare",
            auth: { ApiToken: { token: "xxx" } },
            domain: "example.com",
            hostname: "@",
            ip_version: "Auto",
            update_interval_secs: 300,
            provider_settings: "None",
            tags: [],
            notes: null,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          },
        ],
      };
      renderComponent();
      fireEvent.click(screen.getByText("CLOUDFLARE"));
      expect(screen.getByText("List zones")).toBeInTheDocument();
    });
  });

  // ── Footer actions ─────────────────────────────────────────────

  describe("Footer Actions", () => {
    it("should call onClose when Close button clicked", () => {
      renderComponent();
      fireEvent.click(screen.getByText("Close"));
      expect(mockOnClose).toHaveBeenCalled();
    });

    it("should call triggerUpdateAll when Update all clicked", () => {
      renderComponent();
      fireEvent.click(screen.getByText("Update all"));
      expect(hookReturn.triggerUpdateAll).toHaveBeenCalled();
    });

    it("should call exportProfiles when Export clicked", async () => {
      hookReturn = {
        ...makeHookReturn(),
      };
      hookReturn.exportProfiles.mockResolvedValue(undefined);
      renderComponent();
      fireEvent.click(screen.getByText("Export"));
      expect(hookReturn.exportProfiles).toHaveBeenCalled();
    });
  });
});

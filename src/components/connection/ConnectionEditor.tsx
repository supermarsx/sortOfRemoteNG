import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Save,
  Check,
  Plus,
  Sparkles,
  ChevronDown,
  Cloud,
  Folder as FolderIcon,
  Star,
  Zap,
  Settings2,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  isIntegrationConnectionProtocol,
  type Connection,
  type IntegrationConnectionSettings,
} from "../../types/connection/connection";
import {
  useConnectionEditor,
  PROTOCOL_OPTIONS,
  INTEGRATION_PROTOCOL_OPTIONS,
  CLOUD_OPTIONS,
  PROTOCOL_COLOR_MAP,
  getIntegrationKeyFromProtocol,
  type ConnectionEditorMgr,
} from "../../hooks/connection/useConnectionEditor";
import {
  EXCHANGE_AUTH_METHODS,
  EXCHANGE_ENVIRONMENTS,
  EXCHANGE_INTEGRATION_KEY,
  exchangeConnectionHost,
  exchangeConnectionTimeout,
  exchangeConnectionUsername,
  normalizeExchangeConnectionFields,
  toExchangeProviderFields,
  type ExchangeConnectionProviderFields,
} from "../../utils/integrations/exchangeConnectionFields";
import { Checkbox, NumberInput, PasswordInput } from "../ui/forms";
import { InfoTooltip } from "../ui/InfoTooltip";
import { BehaviorSection } from "./editor/BehaviorSection";
import {
  getConnectionEditorSearchDescriptors,
  getConnectionEditorTabs,
  type ConnectionEditorTabDescriptor,
  type ConnectionEditorTabId,
} from "./editor/editorRegistry";
import { ConnectionEditorSearchBar } from "./editor/ConnectionEditorSearchBar";
import { NotesSection } from "./editor/NotesSection";
import { OrganizeSection } from "./editor/OrganizeSection";
import { ParentSelector } from "./editor/ParentSelector";
import { ProtocolSections } from "./editor/ProtocolSections";
import { useConnectionEditorSearch } from "./editor/useConnectionEditorSearch";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface ConnectionEditorProps {
  connection?: Connection;
  isOpen: boolean;
  onClose: () => void;
}

/* ═══════════════════════════════════════════════════════════════
   EditorHeader
   ═══════════════════════════════════════════════════════════════ */

const EditorHeader: React.FC<{
  mgr: ConnectionEditorMgr;
  onClose: () => void;
  searchBar: React.ReactNode;
}> = ({ mgr, onClose, searchBar }) => (
  <div
    className="relative border-b border-[var(--color-border)] px-5 py-3"
    style={{
      background: mgr.isNewConnection
        ? "linear-gradient(to right, rgb(var(--color-success-rgb) / 0.15), var(--color-surface))"
        : "linear-gradient(to right, rgb(var(--color-primary-rgb) / 0.15), var(--color-surface))",
    }}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={`p-2 rounded-lg ${
            mgr.isNewConnection ? "bg-success/20" : "bg-primary/20"
          }`}
        >
          {mgr.isNewConnection ? (
            <Plus size={18} className="text-success" />
          ) : (
            <Settings2 size={18} className="text-primary" />
          )}
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text)] flex items-center gap-2">
            {mgr.isNewConnection ? "New Connection" : "Edit Connection"}
            {mgr.isNewConnection && (
              <Sparkles size={14} className="text-success" />
            )}
          </h2>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {mgr.isNewConnection
              ? "Add a new server or service"
              : `Editing "${mgr.formData.name || "connection"}"`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {searchBar}
        {mgr.connection && mgr.settings.autoSaveEnabled && (
          <div className="flex items-center gap-1.5 text-xs mr-2">
            {mgr.autoSaveStatus === "pending" && (
              <span className="text-warning flex items-center gap-1 bg-warning/10 px-2 py-1 rounded-full">
                <span className="w-1.5 h-1.5 bg-warning rounded-full animate-pulse" />
                Saving...
              </span>
            )}
            {mgr.autoSaveStatus === "saved" && (
              <span className="text-success flex items-center gap-1 bg-success/10 px-2 py-1 rounded-full">
                <Check size={12} />
                Saved
              </span>
            )}
          </div>
        )}
        {!mgr.isNewConnection && (
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Reset all fields to their default values? This will preserve the connection name and protocol but reset everything else.",
                )
              ) {
                mgr.handleResetToDefaults();
              }
            }}
            className="px-3 py-2 rounded-lg font-medium transition-all flex items-center gap-2 border border-[var(--color-border)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            title="Reset to Defaults"
          >
            <RotateCcw size={16} />
            Reset
          </button>
        )}
        <button
          type="submit"
          data-testid="editor-save"
          className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
            mgr.isNewConnection
              ? "bg-success hover:bg-success/80 text-[var(--color-text)] shadow-lg shadow-success/20"
              : "bg-primary hover:bg-primary/80 text-[var(--color-text)] shadow-lg shadow-primary/20"
          }`}
        >
          <Save size={16} />
          {mgr.isNewConnection ? "Create" : "Save"}
        </button>
      </div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   QuickToggles — Group / Favorite toggle chips
   ═══════════════════════════════════════════════════════════════ */

const QuickToggles: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div
    data-editor-search-section="general-basics"
    className="flex flex-wrap gap-3"
  >
    <label
      data-editor-search-field="isGroup"
      className={`sor-option-chip ${
        mgr.formData.isGroup
          ? "sor-option-chip-active bg-primary/20 border-accent/50 text-primary"
          : ""
      }`}
    >
      <Checkbox
        checked={!!mgr.formData.isGroup}
        onChange={(v: boolean) =>
          mgr.setFormData({ ...mgr.formData, isGroup: v })
        }
        className="sr-only"
      />
      <FolderIcon size={16} />
      <span className="text-sm font-medium">Folder/Group</span>
    </label>
    {!mgr.formData.isGroup && (
      <label
        data-editor-search-field="favorite"
        className={`sor-option-chip ${
          mgr.formData.favorite
            ? "sor-option-chip-active bg-warning/20 border-warning/50 text-warning"
            : ""
        }`}
      >
        <Checkbox
          checked={!!mgr.formData.favorite}
          onChange={(v: boolean) =>
            mgr.setFormData({ ...mgr.formData, favorite: v })
          }
          className="sr-only"
        />
        <Star
          size={16}
          className={mgr.formData.favorite ? "fill-yellow-400" : ""}
        />
        <span className="text-sm font-medium">Favorite</span>
      </label>
    )}
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   NameInput
   ═══════════════════════════════════════════════════════════════ */

const NameInput: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div data-editor-search-field="name">
    <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
      {mgr.formData.isGroup ? "Folder Name" : "Connection Name"}{" "}
      <span className="text-error">*</span>
    </label>
    <input
      type="text"
      required
      data-testid="editor-name"
      value={mgr.formData.name || ""}
      onChange={(e) =>
        mgr.setFormData({ ...mgr.formData, name: e.target.value })
      }
      className="sor-form-input text-sm"
      placeholder={mgr.formData.isGroup ? "My Servers" : "Production Server"}
      autoFocus
    />
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   ProtocolSelector — dropdown with icons
   ═══════════════════════════════════════════════════════════════ */

const ALL_PROTOCOL_OPTIONS = [
  ...PROTOCOL_OPTIONS.map((p) => ({ ...p, group: "protocol" as const })),
  ...CLOUD_OPTIONS.map((c) => ({
    value: c.value,
    label: c.label,
    desc: c.desc,
    icon: Cloud,
    color: "info",
    group: "cloud" as const,
  })),
  ...INTEGRATION_PROTOCOL_OPTIONS.map((p) => ({
    ...p,
    group: "integration" as const,
  })),
];

type ProtocolPickerOption = (typeof ALL_PROTOCOL_OPTIONS)[number];

const PROTOCOL_GROUP_SEARCH_TERMS: Record<
  ProtocolPickerOption["group"],
  string
> = {
  protocol: "protocol protocols",
  cloud: "cloud clouds provider providers cloud provider cloud providers",
  integration: "integration integrations",
};

const matchesProtocolSearch = (
  option: ProtocolPickerOption,
  normalizedQuery: string,
) =>
  `${option.label} ${option.desc} ${option.value} ${PROTOCOL_GROUP_SEARCH_TERMS[option.group]}`
    .toLowerCase()
    .includes(normalizedQuery);

const ProtocolGrid: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => {
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleOptions = React.useMemo(() => {
    if (!normalizedQuery) return ALL_PROTOCOL_OPTIONS;
    return ALL_PROTOCOL_OPTIONS.filter((option) =>
      matchesProtocolSearch(option, normalizedQuery),
    );
  }, [normalizedQuery]);

  const firstVisibleGroup = (
    ["protocol", "cloud", "integration"] as const
  ).find((group) => visibleOptions.some((option) => option.group === group));

  const closeDropdown = React.useCallback((restoreFocus = false) => {
    setOpen(false);
    setSearchQuery("");
    setActiveIndex(0);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const openDropdown = React.useCallback(() => {
    const selectedIndex = ALL_PROTOCOL_OPTIONS.findIndex(
      (option) => option.value === mgr.formData.protocol,
    );
    setSearchQuery("");
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [mgr.formData.protocol]);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        closeDropdown();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, closeDropdown]);

  React.useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  React.useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  const current = ALL_PROTOCOL_OPTIONS.find(
    (p) => p.value === mgr.formData.protocol,
  );
  const CurrentIcon = current?.icon ?? Cloud;

  const selectProtocol = React.useCallback(
    (value: string) => {
      mgr.handleProtocolChange(value);
      closeDropdown(true);
    },
    [mgr, closeDropdown],
  );

  const updateSearchQuery = (nextQuery: string) => {
    const nextNormalizedQuery = nextQuery.trim().toLowerCase();
    const hasMatches =
      !nextNormalizedQuery ||
      ALL_PROTOCOL_OPTIONS.some((option) =>
        matchesProtocolSearch(option, nextNormalizedQuery),
      );
    setSearchQuery(nextQuery);
    setActiveIndex(hasMatches ? 0 : -1);
  };

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown(true);
      return;
    }

    if (visibleOptions.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((currentIndex) => {
        const start = currentIndex < 0 ? 0 : currentIndex;
        return (start + delta + visibleOptions.length) % visibleOptions.length;
      });
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : visibleOptions.length - 1);
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectProtocol(visibleOptions[activeIndex].value);
    }
  };

  const renderProtocolGroup = (
    group: "protocol" | "cloud" | "integration",
    label: string,
  ) => {
    const options = visibleOptions.filter((option) => option.group === group);
    if (options.length === 0) return null;

    return (
      <div
        key={group}
        role="group"
        aria-label={label}
        className={`${group === firstVisibleGroup ? "" : "border-t border-[var(--color-border)]"} py-1`}
      >
        <p className="px-3 py-1 text-[10px] font-semibold text-[var(--color-textMuted)] uppercase tracking-wider">
          {label}
        </p>
        {options.map(({ value, label: optionLabel, desc, icon: Icon }) => {
          const optionIndex = visibleOptions.findIndex(
            (option) => option.value === value,
          );
          const isSelected = mgr.formData.protocol === value;
          const isHighlighted = activeIndex === optionIndex;
          return (
            <button
              key={value}
              ref={(node) => {
                optionRefs.current[optionIndex] = node;
              }}
              id={`editor-protocol-option-${optionIndex}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(optionIndex)}
              onClick={() => selectProtocol(value)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                isSelected
                  ? "bg-primary/15 text-primary"
                  : isHighlighted
                    ? "bg-[var(--color-surfaceHover)] text-[var(--color-text)]"
                    : "text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
              }`}
            >
              <Icon
                size={16}
                className={`flex-shrink-0 ${
                  isSelected
                    ? "text-primary"
                    : "text-[var(--color-textSecondary)]"
                }`}
              />
              <span
                className="min-w-0 flex-1 truncate"
                title={`${optionLabel} — ${desc}`}
              >
                <span className="font-medium">{optionLabel}</span>{" "}
                <span
                  className={`text-xs ${isSelected ? "text-primary/70" : "text-[var(--color-textMuted)]"}`}
                >
                  {desc}
                </span>
              </span>
              {isSelected && (
                <Check
                  size={14}
                  className="ml-auto flex-shrink-0 text-primary"
                />
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      data-editor-search-section="general-connection"
      data-editor-search-field="protocol"
      className="relative"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && !event.currentTarget.contains(nextTarget)) {
          closeDropdown();
        }
      }}
    >
      <label
        id="editor-protocol-label"
        className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1"
      >
        Protocol
      </label>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeDropdown() : openDropdown())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openDropdown();
          }
        }}
        data-testid="editor-protocol"
        aria-labelledby="editor-protocol-label editor-protocol-value"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? "editor-protocol-options" : undefined}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm hover:border-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50 transition-all"
      >
        <CurrentIcon
          size={16}
          className="text-[var(--color-textSecondary)] flex-shrink-0"
        />
        <span
          id="editor-protocol-value"
          className="min-w-0 flex-1 truncate text-left"
          title={
            current ? `${current.label} — ${current.desc}` : "Select protocol"
          }
        >
          <span className="font-medium">{current?.label ?? "Select"}</span>{" "}
          <span className="text-xs text-[var(--color-textMuted)]">
            {current?.desc ?? ""}
          </span>
        </span>
        <ChevronDown
          size={14}
          className="ml-auto text-[var(--color-textMuted)] flex-shrink-0 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
        />
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 flex max-h-72 flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <Search
              size={15}
              aria-hidden="true"
              className="flex-shrink-0 text-[var(--color-textMuted)]"
            />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(event) => updateSearchQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              data-testid="editor-protocol-search"
              role="combobox"
              aria-label="Search protocols"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="editor-protocol-options"
              aria-activedescendant={
                activeIndex >= 0
                  ? `editor-protocol-option-${activeIndex}`
                  : undefined
              }
              autoComplete="off"
              placeholder="Search protocols, clouds, integrations…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder:text-[var(--color-textMuted)] focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  updateSearchQuery("");
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear protocol search"
                className="rounded p-0.5 text-[var(--color-textMuted)] transition-colors hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)]"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              id="editor-protocol-options"
              role="listbox"
              aria-label="Available protocols"
            >
              {visibleOptions.length > 0 && (
                <>
                  {renderProtocolGroup("protocol", "Protocols")}
                  {renderProtocolGroup("cloud", "Cloud Providers")}
                  {renderProtocolGroup("integration", "Integrations")}
                </>
              )}
            </div>
            {visibleOptions.length === 0 && (
              <div
                role="status"
                className="flex flex-col items-center gap-1 px-4 py-6 text-center"
              >
                <Search
                  size={20}
                  aria-hidden="true"
                  className="text-[var(--color-textMuted)]"
                />
                <span className="text-sm font-medium text-[var(--color-textSecondary)]">
                  No protocols found
                </span>
                <span className="text-xs text-[var(--color-textMuted)]">
                  Try a protocol name or description.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   ConnectionFields — hostname / port inputs
   ═══════════════════════════════════════════════════════════════ */

const IntegrationConnectionFields: React.FC<{ mgr: ConnectionEditorMgr }> = ({
  mgr,
}) => {
  const protocol = mgr.formData.protocol as string | undefined;
  type IntegrationConnectionFormSettings = IntegrationConnectionSettings & {
    authToken?: string;
    apiKey?: string;
    password?: string;
    providerSecrets?: Record<string, string>;
  };
  const integration: IntegrationConnectionFormSettings = {
    descriptorKey:
      mgr.formData.integration?.descriptorKey ||
      getIntegrationKeyFromProtocol(protocol) ||
      "",
    ...mgr.formData.integration,
  };

  const updateIntegration = (
    patch: Partial<IntegrationConnectionFormSettings>,
  ) => {
    const nextIntegration: IntegrationConnectionFormSettings = {
      ...integration,
      ...patch,
      descriptorKey:
        integration.descriptorKey ||
        getIntegrationKeyFromProtocol(protocol) ||
        "",
    };
    const mirrored: Partial<Connection> = {};

    if ("host" in patch) mirrored.hostname = patch.host || "";
    if ("username" in patch) mirrored.username = patch.username || "";
    if ("timeout" in patch) mirrored.timeout = patch.timeout;

    mgr.setFormData({
      ...mgr.formData,
      ...mirrored,
      integration: nextIntegration,
    });
  };

  const descriptorKey =
    integration.descriptorKey || getIntegrationKeyFromProtocol(protocol) || "";
  const isExchange = descriptorKey === EXCHANGE_INTEGRATION_KEY;
  const exchangeFields = normalizeExchangeConnectionFields(
    integration.providerFields,
    {
      host: integration.host || mgr.formData.hostname,
      username: integration.username || mgr.formData.username,
      timeout: integration.timeout ?? mgr.formData.timeout,
    },
  );
  const exchangeSecrets = integration.providerSecrets ?? {};
  const showExchangeOnline =
    exchangeFields.environment === "online" ||
    exchangeFields.environment === "hybrid";
  const showExchangeOnPrem =
    exchangeFields.environment === "onPremises" ||
    exchangeFields.environment === "hybrid";

  const updateExchangeFields = (
    patch: Partial<ExchangeConnectionProviderFields>,
  ) => {
    const nextFields: ExchangeConnectionProviderFields = {
      ...exchangeFields,
      ...patch,
    };
    updateIntegration({
      providerFields: toExchangeProviderFields(nextFields),
      host: exchangeConnectionHost(nextFields),
      username: exchangeConnectionUsername(nextFields),
      timeout: exchangeConnectionTimeout(nextFields, integration.timeout ?? 30),
    });
  };

  const updateExchangeSecret = (
    key: "clientSecret" | "password",
    value: string,
  ) => {
    updateIntegration({
      providerSecrets: {
        ...exchangeSecrets,
        [key]: value,
      },
    });
  };

  if (isExchange) {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
              Instance ID
            </label>
            <input
              type="text"
              data-testid="editor-integration-instance-id"
              value={integration.instanceId || ""}
              onChange={(e) =>
                updateIntegration({ instanceId: e.target.value })
              }
              className="sor-form-input text-sm font-mono"
              placeholder="optional saved instance id"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
              Instance Name
            </label>
            <input
              type="text"
              data-testid="editor-integration-instance-name"
              value={integration.instanceName || ""}
              onChange={(e) =>
                updateIntegration({ instanceName: e.target.value })
              }
              className="sor-form-input text-sm"
              placeholder="Corporate Exchange"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
              Environment
            </label>
            <select
              data-testid="editor-exchange-environment"
              value={exchangeFields.environment}
              onChange={(e) =>
                updateExchangeFields({
                  environment: e.target
                    .value as ExchangeConnectionProviderFields["environment"],
                })
              }
              className="sor-form-input text-sm"
            >
              {EXCHANGE_ENVIRONMENTS.map((environment) => (
                <option key={environment} value={environment}>
                  {environment === "online"
                    ? "Exchange Online"
                    : environment === "onPremises"
                      ? "Exchange Server"
                      : "Hybrid"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
              Timeout (s)
            </label>
            <input
              type="text"
              inputMode="numeric"
              data-testid="editor-exchange-timeout"
              value={exchangeFields.timeoutSecs}
              onChange={(e) =>
                updateExchangeFields({ timeoutSecs: e.target.value })
              }
              className="sor-form-input text-sm"
              placeholder="120"
            />
          </div>
        </div>

        {showExchangeOnline && (
          <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                  Tenant ID
                </label>
                <input
                  type="text"
                  data-testid="editor-exchange-tenant-id"
                  value={exchangeFields.tenantId}
                  onChange={(e) =>
                    updateExchangeFields({ tenantId: e.target.value })
                  }
                  className="sor-form-input text-sm font-mono"
                  placeholder="contoso.onmicrosoft.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                  Client ID
                </label>
                <input
                  type="text"
                  data-testid="editor-exchange-client-id"
                  value={exchangeFields.clientId}
                  onChange={(e) =>
                    updateExchangeFields({ clientId: e.target.value })
                  }
                  className="sor-form-input text-sm font-mono"
                  placeholder="00000000-0000-0000-0000-000000000000"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                  Client Secret
                </label>
                <PasswordInput
                  data-testid="editor-exchange-client-secret"
                  value={exchangeSecrets.clientSecret || ""}
                  onChange={(e) =>
                    updateExchangeSecret("clientSecret", e.target.value)
                  }
                  isSaved={false}
                  className="sor-form-input text-sm"
                  placeholder="client secret"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                  Online Username
                </label>
                <input
                  type="text"
                  data-testid="editor-exchange-online-username"
                  value={exchangeFields.onlineUsername}
                  onChange={(e) =>
                    updateExchangeFields({ onlineUsername: e.target.value })
                  }
                  className="sor-form-input text-sm"
                  placeholder="admin@contoso.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                Organization
              </label>
              <input
                type="text"
                data-testid="editor-exchange-organization"
                value={exchangeFields.organization}
                onChange={(e) =>
                  updateExchangeFields({ organization: e.target.value })
                }
                className="sor-form-input text-sm font-mono"
                placeholder="contoso.onmicrosoft.com"
              />
            </div>
          </div>
        )}

        {showExchangeOnPrem && (
          <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
            <div className="grid grid-cols-[1fr_100px] gap-2">
              <div>
                <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                  Server
                </label>
                <input
                  type="text"
                  data-testid="editor-exchange-server"
                  value={exchangeFields.server}
                  onChange={(e) =>
                    updateExchangeFields({ server: e.target.value })
                  }
                  className="sor-form-input text-sm font-mono"
                  placeholder="mail01.contoso.local"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                  Port
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  data-testid="editor-exchange-port"
                  value={exchangeFields.port}
                  onChange={(e) =>
                    updateExchangeFields({ port: e.target.value })
                  }
                  className="sor-form-input text-sm"
                  placeholder="443"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                  On-prem Username
                </label>
                <input
                  type="text"
                  data-testid="editor-exchange-onprem-username"
                  value={exchangeFields.onPremUsername}
                  onChange={(e) =>
                    updateExchangeFields({ onPremUsername: e.target.value })
                  }
                  className="sor-form-input text-sm"
                  placeholder="CONTOSO\\administrator"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                  Password
                </label>
                <PasswordInput
                  data-testid="editor-exchange-password"
                  value={exchangeSecrets.password || ""}
                  onChange={(e) =>
                    updateExchangeSecret("password", e.target.value)
                  }
                  isSaved={false}
                  className="sor-form-input text-sm"
                  placeholder="password"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
                  Auth Method
                </label>
                <select
                  data-testid="editor-exchange-auth-method"
                  value={exchangeFields.authMethod}
                  onChange={(e) =>
                    updateExchangeFields({
                      authMethod: e.target
                        .value as ExchangeConnectionProviderFields["authMethod"],
                    })
                  }
                  className="sor-form-input text-sm"
                >
                  {EXCHANGE_AUTH_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method.charAt(0).toUpperCase() + method.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm text-[var(--color-text)]">
                <Checkbox
                  checked={exchangeFields.useSsl}
                  onChange={(checked) =>
                    updateExchangeFields({ useSsl: checked })
                  }
                  variant="form"
                  data-testid="editor-exchange-use-ssl"
                />
                <span>Use SSL</span>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm text-[var(--color-text)]">
                <Checkbox
                  checked={exchangeFields.skipCertCheck}
                  onChange={(checked) =>
                    updateExchangeFields({ skipCertCheck: checked })
                  }
                  variant="form"
                  data-testid="editor-exchange-skip-cert-check"
                />
                <span>Skip Cert</span>
              </label>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Instance ID
          </label>
          <input
            type="text"
            data-testid="editor-integration-instance-id"
            value={integration.instanceId || ""}
            onChange={(e) => updateIntegration({ instanceId: e.target.value })}
            className="sor-form-input text-sm font-mono"
            placeholder="optional saved instance id"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Instance Name
          </label>
          <input
            type="text"
            data-testid="editor-integration-instance-name"
            value={integration.instanceName || ""}
            onChange={(e) =>
              updateIntegration({ instanceName: e.target.value })
            }
            className="sor-form-input text-sm"
            placeholder="Production"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Host <span className="text-error">*</span>
          </label>
          <input
            type="text"
            data-testid="editor-hostname"
            value={integration.host || ""}
            onChange={(e) => updateIntegration({ host: e.target.value })}
            className="sor-form-input text-sm font-mono"
            placeholder="service.example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Base URL
          </label>
          <input
            type="text"
            data-testid="editor-integration-base-url"
            value={integration.baseUrl || ""}
            onChange={(e) => updateIntegration({ baseUrl: e.target.value })}
            className="sor-form-input text-sm font-mono"
            placeholder="https://service.example.com"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Auth Token
          </label>
          <PasswordInput
            data-testid="editor-integration-auth-token"
            value={integration.authToken || ""}
            onChange={(e) => updateIntegration({ authToken: e.target.value })}
            isSaved={false}
            className="sor-form-input text-sm"
            placeholder="token"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            API Key
          </label>
          <PasswordInput
            data-testid="editor-integration-api-key"
            value={integration.apiKey || ""}
            onChange={(e) => updateIntegration({ apiKey: e.target.value })}
            isSaved={false}
            className="sor-form-input text-sm"
            placeholder="api key"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Username
          </label>
          <input
            type="text"
            data-testid="editor-username"
            value={integration.username || ""}
            onChange={(e) => updateIntegration({ username: e.target.value })}
            className="sor-form-input text-sm"
            placeholder="admin"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Password
          </label>
          <PasswordInput
            data-testid="editor-password"
            value={integration.password || ""}
            onChange={(e) => updateIntegration({ password: e.target.value })}
            isSaved={false}
            className="sor-form-input text-sm"
            placeholder="password"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2 text-sm text-[var(--color-text)]">
          <Checkbox
            checked={integration.tlsVerify ?? true}
            onChange={(checked) => updateIntegration({ tlsVerify: checked })}
            variant="form"
            data-testid="editor-integration-tls-verify"
          />
          <span>TLS Verify</span>
        </label>
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Timeout (s)
          </label>
          <NumberInput
            value={integration.timeout ?? 30}
            onChange={(value: number) => updateIntegration({ timeout: value })}
            variant="form"
            min={1}
            max={3600}
            data-testid="editor-integration-timeout"
          />
        </div>
      </div>
    </div>
  );
};

const ConnectionFields: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => {
  const p = mgr.formData.protocol || "";
  if (isIntegrationConnectionProtocol(p)) {
    return <IntegrationConnectionFields mgr={mgr} />;
  }

  return (
    <div className="space-y-2">
      {/* Hostname + Port row */}
      <div className="grid grid-cols-[1fr_100px] gap-2">
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Hostname / IP <span className="text-error">*</span>
          </label>
          <input
            type="text"
            required
            data-testid="editor-hostname"
            value={mgr.formData.hostname || ""}
            onChange={(e) =>
              mgr.setFormData({ ...mgr.formData, hostname: e.target.value })
            }
            className="sor-form-input text-sm font-mono"
            placeholder={
              p === "http" || p === "https"
                ? "example.com"
                : p === "ssh"
                  ? "192.168.1.100 or server.example.com"
                  : "192.168.1.100"
            }
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1">
            Port
          </label>
          <NumberInput
            value={mgr.formData.port || 0}
            onChange={(v: number) =>
              mgr.setFormData({
                ...mgr.formData,
                port: v,
              })
            }
            variant="form"
            min={1}
            max={65535}
            data-testid="editor-port"
          />
        </div>
      </div>
      {p !== "ssh" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
              Username
              <InfoTooltip
                text={
                  p === "rdp"
                    ? "Windows account name. For domain accounts, set the Domain field below (DOMAIN\\user is built automatically)."
                    : p === "winrm"
                      ? "Account for WinRM Basic auth. Domain accounts use the Domain field below."
                      : p === "vnc"
                        ? "VNC authentication usually only needs a password, not a username."
                        : "Username for authentication with the remote service."
                }
              />
            </label>
            <input
              type="text"
              data-testid="editor-username"
              value={mgr.formData.username || ""}
              onChange={(e) =>
                mgr.setFormData({ ...mgr.formData, username: e.target.value })
              }
              className="sor-form-input text-sm"
              placeholder={
                p === "rdp"
                  ? "Administrator"
                  : p === "winrm"
                    ? "Administrator"
                    : p === "vnc"
                      ? "(optional)"
                      : "admin"
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-textSecondary)] mb-1 flex items-center gap-1">
              Password
              <InfoTooltip
                text={
                  p === "rdp"
                    ? "Windows account password. Sent via CredSSP/NLA during the RDP handshake."
                    : p === "winrm"
                      ? "Password for WinRM authentication. Sent Base64-encoded (use HTTPS for security)."
                      : p === "vnc"
                        ? "VNC server password. Most VNC servers only use password authentication."
                        : "Password for authentication with the remote service."
                }
              />
            </label>
            <PasswordInput
              data-testid="editor-password"
              value={mgr.formData.password || ""}
              onChange={(e) =>
                mgr.setFormData({ ...mgr.formData, password: e.target.value })
              }
              isSaved={!mgr.isNewConnection && !!mgr.formData.password}
              className="sor-form-input text-sm"
              placeholder="••••••••"
            />
          </div>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   EditorFooter
   ═══════════════════════════════════════════════════════════════ */

const EditorFooter: React.FC<{ mgr: ConnectionEditorMgr }> = ({ mgr }) => (
  <div className="border-t border-[var(--color-border)] px-6 py-3 bg-[var(--color-surface)]">
    <div className="flex items-center justify-between text-xs text-[var(--color-textSecondary)]">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <Zap size={12} />
          Press{" "}
          <kbd className="px-1.5 py-0.5 bg-[var(--color-surfaceHover)] rounded text-[var(--color-textSecondary)]">
            Enter
          </kbd>{" "}
          to save
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-[var(--color-surfaceHover)] rounded text-[var(--color-textSecondary)]">
            Esc
          </kbd>{" "}
          to cancel
        </span>
      </div>
      {mgr.connection && mgr.settings.autoSaveEnabled && (
        <span className="text-[var(--color-textMuted)]">Auto-save enabled</span>
      )}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   EditorTabs
   ═══════════════════════════════════════════════════════════════ */

const EditorTabs: React.FC<{
  tabs: readonly ConnectionEditorTabDescriptor[];
  activeTab: ConnectionEditorTabId;
  onTabChange: (tab: ConnectionEditorTabId) => void;
}> = ({ tabs, activeTab, onTabChange }) => (
  <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5">
    <div
      role="tablist"
      aria-label="Connection editor sections"
      className="max-w-2xl mx-auto flex items-center gap-1 overflow-x-auto py-2"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`connection-editor-tab-${tab.id}`}
            aria-controls={`connection-editor-panel-${tab.id}`}
            aria-selected={isActive}
            data-testid={`connection-editor-tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            className={`h-9 px-3 rounded-lg flex items-center gap-2 text-sm font-medium whitespace-nowrap transition-colors ${
              isActive
                ? "bg-primary/15 text-primary"
                : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
            }`}
          >
            <Icon size={15} />
            {tab.label}
          </button>
        );
      })}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════ */

export const ConnectionEditor: React.FC<ConnectionEditorProps> = ({
  connection,
  isOpen,
  onClose,
}) => {
  const mgr = useConnectionEditor(connection, isOpen, onClose);
  const [activeTab, setActiveTab] = useState<ConnectionEditorTabId>("general");
  const tabs = React.useMemo(
    () => getConnectionEditorTabs(!!mgr.formData.isGroup),
    [mgr.formData.isGroup],
  );
  const searchDescriptors = React.useMemo(
    () => getConnectionEditorSearchDescriptors(!!mgr.formData.isGroup),
    [mgr.formData.isGroup],
  );
  const formContentRef = useRef<HTMLDivElement>(null);
  const { query, setQuery, matchCount, currentIndex, goNext, goPrev } =
    useConnectionEditorSearch(formContentRef, activeTab, {
      descriptors: searchDescriptors,
      activateTab: setActiveTab,
      expandSection: mgr.expandSection,
    });

  useEffect(() => {
    if (isOpen) setActiveTab("general");
  }, [connection?.id, isOpen]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("general");
    }
  }, [activeTab, tabs]);

  if (!isOpen) return null;

  return (
    <form
      data-testid="connection-editor"
      onSubmit={mgr.handleSubmit}
      className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden"
    >
      <EditorHeader
        mgr={mgr}
        onClose={onClose}
        searchBar={
          <ConnectionEditorSearchBar
            query={query}
            setQuery={setQuery}
            matchCount={matchCount}
            currentIndex={currentIndex}
            goNext={goNext}
            goPrev={goPrev}
          />
        }
      />
      <EditorTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        <div ref={formContentRef} className="max-w-2xl mx-auto w-full p-6">
          <div
            role="tabpanel"
            id={`connection-editor-panel-${activeTab}`}
            aria-labelledby={`connection-editor-tab-${activeTab}`}
            data-testid={`connection-editor-panel-${activeTab}`}
            data-editor-search-tab={activeTab}
            className="flex flex-col gap-4"
          >
            {activeTab === "general" && (
              <>
                <QuickToggles mgr={mgr} />
                <NameInput mgr={mgr} />
                <ParentSelector mgr={mgr} />

                {!mgr.formData.isGroup && (
                  <>
                    <ProtocolGrid mgr={mgr} />
                    <ConnectionFields mgr={mgr} />
                  </>
                )}
              </>
            )}

            {activeTab === "protocol" && !mgr.formData.isGroup && (
              <ProtocolSections mgr={mgr} />
            )}

            {activeTab === "behavior" && !mgr.formData.isGroup && (
              <BehaviorSection mgr={mgr} />
            )}

            {activeTab === "organize" && <OrganizeSection mgr={mgr} />}

            {activeTab === "notes" && <NotesSection mgr={mgr} />}
          </div>
        </div>
      </div>
      <EditorFooter mgr={mgr} />
    </form>
  );
};

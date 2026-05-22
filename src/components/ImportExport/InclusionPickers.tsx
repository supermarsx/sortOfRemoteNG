import React, { useMemo, useState } from "react";
import {
  FolderTree,
  Palette,
  Search as SearchIcon,
  Server,
  Tag as TagIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Connection } from "../../types/connection/connection";
import type { ExportInclusionConfig } from "./types";
import { Checkbox } from "../ui/forms";
import { AccordionSection } from "./AccordionSection";

export type InclusionPickerSection =
  | "connections"
  | "folders"
  | "textTags"
  | "colorTags"
  | "proxyProfiles"
  | "proxyChains"
  | "vpnConnections";

export interface InclusionConnectionOption {
  id: string;
  name: string;
  protocol: Connection["protocol"];
  hostname?: string;
  sourcePath?: string;
  databaseId?: string;
  databaseName?: string;
}

export interface InclusionFolderOption {
  id: string;
  name: string;
  sourcePath?: string;
  databaseId?: string;
  databaseName?: string;
}

export interface InclusionListOption {
  id: string;
  key?: string;
  name: string;
  kind?: string;
  description?: string;
  searchText?: string;
}

interface InclusionProtocolFilterProps {
  inclusion: ExportInclusionConfig;
  updateInclusion: (updates: Partial<ExportInclusionConfig>) => void;
  availableProtocols: Connection["protocol"][];
  disabled?: boolean;
  dataTestId?: string;
}

const nextSelection = (
  selectedIds: string[] | undefined,
  allIds: string[],
  id: string,
  checked: boolean,
): string[] => {
  const current =
    selectedIds && selectedIds.length > 0
      ? new Set(selectedIds)
      : new Set(allIds);

  if (checked) current.add(id);
  else current.delete(id);

  return current.size === allIds.length ? [] : Array.from(current);
};

const selectedBadge = (count: number) =>
  count > 0 ? (
    <span className="rounded-sm bg-primary/15 px-2 py-0.5 text-primary">
      {count}
    </span>
  ) : (
    <span className="text-[var(--color-textMuted)]">all</span>
  );

export const InclusionProtocolFilter: React.FC<InclusionProtocolFilterProps> = ({
  inclusion,
  updateInclusion,
  availableProtocols,
  disabled = false,
  dataTestId = "export-protocol-filter",
}) => {
  const { t } = useTranslation();

  const toggleProtocol = (
    protocol: Connection["protocol"],
    checked: boolean,
  ) => {
    const current =
      inclusion.includedProtocols.length > 0
        ? new Set(inclusion.includedProtocols)
        : new Set(availableProtocols);

    if (checked) current.add(protocol);
    else current.delete(protocol);

    updateInclusion({
      includedProtocols:
        current.size === availableProtocols.length
          ? []
          : Array.from(current).sort(),
    });
  };

  return (
    <div className="space-y-2" data-testid={dataTestId}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium text-[var(--color-text)]">
          {t("exportTab.protocolFilterTitle", { defaultValue: "Protocols" })}
        </div>
        <button
          type="button"
          className="self-start text-xs text-primary hover:text-primary/80 disabled:text-[var(--color-textMuted)]"
          disabled={disabled || inclusion.includedProtocols.length === 0}
          onClick={() => updateInclusion({ includedProtocols: [] })}
        >
          {t("exportTab.protocolFilterAll", {
            defaultValue: "Include all protocols",
          })}
        </button>
      </div>
      {availableProtocols.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {availableProtocols.map((protocol) => {
            const checked =
              inclusion.includedProtocols.length === 0 ||
              inclusion.includedProtocols.includes(protocol);
            return (
              <label
                key={protocol}
                className={`inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs ${
                  disabled ? "opacity-60" : "cursor-pointer"
                }`}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onChange={(value: boolean) => toggleProtocol(protocol, value)}
                  className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                  aria-label={protocol.toUpperCase()}
                />
                <span className="font-medium text-[var(--color-textSecondary)]">
                  {protocol.toUpperCase()}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-[var(--color-textMuted)]">
          {t("exportTab.protocolFilterEmpty", {
            defaultValue: "No protocols are visible in the open database yet.",
          })}
        </p>
      )}
    </div>
  );
};

interface InclusionItemPickersProps {
  inclusion: ExportInclusionConfig;
  updateInclusion: (updates: Partial<ExportInclusionConfig>) => void;
  sectionsOpen: Partial<Record<InclusionPickerSection, boolean>>;
  onToggleSection: (section: InclusionPickerSection) => void;
  visibleSections?: InclusionPickerSection[];
  connections?: InclusionConnectionOption[];
  folders?: InclusionFolderOption[];
  textTags?: string[];
  colorTagIds?: string[];
  proxyProfiles?: InclusionListOption[];
  proxyChains?: InclusionListOption[];
  vpnConnections?: InclusionListOption[];
  testIdPrefix?: string;
  connectionEmptyLabel?: string;
  folderEmptyLabel?: string;
}

export const InclusionItemPickers: React.FC<InclusionItemPickersProps> = ({
  inclusion,
  updateInclusion,
  sectionsOpen,
  onToggleSection,
  visibleSections = [
    "connections",
    "folders",
    "textTags",
    "colorTags",
    "proxyProfiles",
    "proxyChains",
    "vpnConnections",
  ],
  connections = [],
  folders = [],
  textTags = [],
  colorTagIds = [],
  proxyProfiles = [],
  proxyChains = [],
  vpnConnections = [],
  testIdPrefix = "export",
  connectionEmptyLabel,
  folderEmptyLabel,
}) => {
  const { t } = useTranslation();
  const [connectionsSearch, setConnectionsSearch] = useState("");
  const [foldersSearch, setFoldersSearch] = useState("");
  const [textTagsSearch, setTextTagsSearch] = useState("");
  const [colorTagsSearch, setColorTagsSearch] = useState("");
  const [proxyProfilesSearch, setProxyProfilesSearch] = useState("");
  const [proxyChainsSearch, setProxyChainsSearch] = useState("");
  const [vpnSearch, setVpnSearch] = useState("");

  const selectedConnectionIdSet = new Set(inclusion.includedConnectionIds ?? []);
  const selectedFolderIdSet = new Set(inclusion.includedFolderIds ?? []);
  const selectedTextTagSet = new Set(inclusion.includedTextTags ?? []);
  const selectedColorTagIdSet = new Set(inclusion.includedColorTagIds ?? []);
  const selectedProxyProfileIdSet = new Set(
    inclusion.includedProxyProfileIds ?? [],
  );
  const selectedProxyChainIdSet = new Set(
    inclusion.includedProxyChainIds ?? [],
  );
  const selectedVpnConnectionIdSet = new Set(
    inclusion.includedVpnConnectionIds ?? [],
  );

  const connectionIds = useMemo(
    () => connections.map((connection) => connection.id),
    [connections],
  );
  const folderIds = useMemo(
    () => folders.map((folder) => folder.id),
    [folders],
  );
  const proxyProfileIds = useMemo(
    () => proxyProfiles.map((profile) => profile.id),
    [proxyProfiles],
  );
  const proxyChainIds = useMemo(
    () => Array.from(new Set(proxyChains.map((chain) => chain.id))),
    [proxyChains],
  );
  const vpnConnectionIds = useMemo(
    () => vpnConnections.map((connection) => connection.id),
    [vpnConnections],
  );

  const show = (section: InclusionPickerSection) =>
    visibleSections.includes(section);

  const updateConnectionId = (id: string, checked: boolean) => {
    updateInclusion({
      includedConnectionIds: nextSelection(
        inclusion.includedConnectionIds,
        connectionIds,
        id,
        checked,
      ),
    });
  };

  const updateFolderId = (id: string, checked: boolean) => {
    updateInclusion({
      includedFolderIds: nextSelection(
        inclusion.includedFolderIds,
        folderIds,
        id,
        checked,
      ),
    });
  };

  const updateTextTag = (tag: string, checked: boolean) => {
    updateInclusion({
      includedTextTags: nextSelection(
        inclusion.includedTextTags,
        textTags,
        tag,
        checked,
      ),
    });
  };

  const updateColorTag = (id: string, checked: boolean) => {
    updateInclusion({
      includedColorTagIds: nextSelection(
        inclusion.includedColorTagIds,
        colorTagIds,
        id,
        checked,
      ),
    });
  };

  const updateProxyProfile = (id: string, checked: boolean) => {
    updateInclusion({
      includedProxyProfileIds: nextSelection(
        inclusion.includedProxyProfileIds,
        proxyProfileIds,
        id,
        checked,
      ),
    });
  };

  const updateProxyChain = (id: string, checked: boolean) => {
    updateInclusion({
      includedProxyChainIds: nextSelection(
        inclusion.includedProxyChainIds,
        proxyChainIds,
        id,
        checked,
      ),
    });
  };

  const updateVpnConnection = (id: string, checked: boolean) => {
    updateInclusion({
      includedVpnConnectionIds: nextSelection(
        inclusion.includedVpnConnectionIds,
        vpnConnectionIds,
        id,
        checked,
      ),
    });
  };

  const filteredConnections = useMemo(() => {
    const query = connectionsSearch.trim().toLowerCase();
    if (!query) return connections;
    return connections.filter((connection) =>
      [
        connection.name,
        connection.protocol,
        connection.hostname,
        connection.sourcePath,
        connection.databaseName,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [connections, connectionsSearch]);

  const filteredFolders = useMemo(() => {
    const query = foldersSearch.trim().toLowerCase();
    if (!query) return folders;
    return folders.filter((folder) =>
      [folder.name, folder.sourcePath, folder.databaseName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [folders, foldersSearch]);

  const connectionGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      label?: string;
      items: InclusionConnectionOption[];
    }> = [];
    const byDatabase = new Map<string, InclusionConnectionOption[]>();

    filteredConnections.forEach((connection) => {
      const key = connection.databaseId ?? "__single";
      const list = byDatabase.get(key) ?? [];
      list.push(connection);
      byDatabase.set(key, list);
    });

    byDatabase.forEach((items, key) => {
      groups.push({
        key,
        label: items[0]?.databaseName,
        items,
      });
    });

    return groups;
  }, [filteredConnections]);

  const folderGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      label?: string;
      items: InclusionFolderOption[];
    }> = [];
    const byDatabase = new Map<string, InclusionFolderOption[]>();

    filteredFolders.forEach((folder) => {
      const key = folder.databaseId ?? "__single";
      const list = byDatabase.get(key) ?? [];
      list.push(folder);
      byDatabase.set(key, list);
    });

    byDatabase.forEach((items, key) => {
      groups.push({
        key,
        label: items[0]?.databaseName,
        items,
      });
    });

    return groups;
  }, [filteredFolders]);

  return (
    <>
      {show("connections") && (
        <AccordionSection
          id={`${testIdPrefix}-connections`}
          title={t("exportTab.connectionsTitle", {
            defaultValue: "Specific connections",
          })}
          description={t("exportTab.connectionsDescription", {
            defaultValue:
              "Restrict the export to specific connections. Leave the list empty to include every connection that matches the other filters.",
          })}
          icon={Server}
          open={Boolean(sectionsOpen.connections)}
          onToggle={() => onToggleSection("connections")}
          dataTestId={`${testIdPrefix}-connections-section`}
          badge={selectedBadge(selectedConnectionIdSet.size)}
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
              />
              <input
                type="text"
                value={connectionsSearch}
                onChange={(e) => setConnectionsSearch(e.target.value)}
                placeholder={
                  t("exportTab.connectionsSearch", {
                    defaultValue: "Search connections...",
                  }) as string
                }
                className="sor-form-input-xs sor-form-input-xs-icon-left w-full"
              />
            </div>
            <button
              type="button"
              className="flex-shrink-0 text-xs text-primary hover:text-primary/80 disabled:text-[var(--color-textMuted)]"
              disabled={selectedConnectionIdSet.size === 0}
              onClick={() => updateInclusion({ includedConnectionIds: [] })}
            >
              {t("exportTab.connectionsClear", {
                defaultValue: "Include all connections",
              })}
            </button>
          </div>
          {connections.length === 0 ? (
            <p className="text-xs text-[var(--color-textMuted)]">
              {connectionEmptyLabel ??
                t("exportTab.connectionsEmpty", {
                  defaultValue: "No connections in the open database yet.",
                })}
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
              {connectionGroups.map((group) => (
                <div key={group.key}>
                  {group.label && (
                    <div className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1.5 text-[10px] font-medium uppercase text-[var(--color-textMuted)]">
                      {group.label}
                    </div>
                  )}
                  {group.items.map((connection) => {
                    const checked =
                      selectedConnectionIdSet.size === 0 ||
                      selectedConnectionIdSet.has(connection.id);
                    return (
                      <label
                        key={connection.id}
                        className="flex cursor-pointer items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0 hover:bg-[var(--color-surfaceHover)]"
                      >
                        <Checkbox
                          checked={checked}
                          onChange={(value: boolean) =>
                            updateConnectionId(connection.id, value)
                          }
                          className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                          aria-label={connection.name}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[var(--color-text)]">
                            {connection.name}
                          </span>
                          <span className="block truncate text-[10px] text-[var(--color-textMuted)]">
                            {connection.protocol.toUpperCase()}
                            {connection.hostname
                              ? ` - ${connection.hostname}`
                              : ""}
                            {connection.sourcePath
                              ? ` - ${connection.sourcePath}`
                              : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </AccordionSection>
      )}

      {show("folders") && (
        <AccordionSection
          id={`${testIdPrefix}-folders`}
          title={t("exportTab.foldersTitle", {
            defaultValue: "Specific folders",
          })}
          description={t("exportTab.foldersDescription", {
            defaultValue:
              "Restrict the export to specific folders and their contents. Leave empty to include every folder that matches the other filters.",
          })}
          icon={FolderTree}
          open={Boolean(sectionsOpen.folders)}
          onToggle={() => onToggleSection("folders")}
          dataTestId={`${testIdPrefix}-folders-section`}
          badge={selectedBadge(selectedFolderIdSet.size)}
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <SearchIcon
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
              />
              <input
                type="text"
                value={foldersSearch}
                onChange={(e) => setFoldersSearch(e.target.value)}
                placeholder={
                  t("exportTab.foldersSearch", {
                    defaultValue: "Search folders...",
                  }) as string
                }
                className="sor-form-input-xs sor-form-input-xs-icon-left w-full"
              />
            </div>
            <button
              type="button"
              className="flex-shrink-0 text-xs text-primary hover:text-primary/80 disabled:text-[var(--color-textMuted)]"
              disabled={selectedFolderIdSet.size === 0}
              onClick={() => updateInclusion({ includedFolderIds: [] })}
            >
              {t("exportTab.foldersClear", {
                defaultValue: "Include all folders",
              })}
            </button>
          </div>
          {folders.length === 0 ? (
            <p className="text-xs text-[var(--color-textMuted)]">
              {folderEmptyLabel ??
                t("exportTab.foldersEmpty", {
                  defaultValue: "No folders in the open database yet.",
                })}
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
              {folderGroups.map((group) => (
                <div key={group.key}>
                  {group.label && (
                    <div className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1.5 text-[10px] font-medium uppercase text-[var(--color-textMuted)]">
                      {group.label}
                    </div>
                  )}
                  {group.items.map((folder) => {
                    const checked =
                      selectedFolderIdSet.size === 0 ||
                      selectedFolderIdSet.has(folder.id);
                    return (
                      <label
                        key={folder.id}
                        className="flex cursor-pointer items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0 hover:bg-[var(--color-surfaceHover)]"
                      >
                        <Checkbox
                          checked={checked}
                          onChange={(value: boolean) =>
                            updateFolderId(folder.id, value)
                          }
                          className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                          aria-label={folder.name}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[var(--color-text)]">
                            {folder.name}
                          </span>
                          <span className="block truncate text-[10px] text-[var(--color-textMuted)]">
                            {folder.sourcePath || folder.name}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </AccordionSection>
      )}

      {show("textTags") && (
        <AccordionSection
          id={`${testIdPrefix}-text-tags`}
          title={t("exportTab.textTagsTitle", {
            defaultValue: "Specific text tags",
          })}
          description={t("exportTab.textTagsDescription", {
            defaultValue:
              "Restrict the export to connections carrying any of these text tags. Leave empty to include connections with or without tags.",
          })}
          icon={TagIcon}
          open={Boolean(sectionsOpen.textTags)}
          onToggle={() => onToggleSection("textTags")}
          dataTestId={`${testIdPrefix}-text-tags-section`}
          badge={selectedBadge(selectedTextTagSet.size)}
        >
          <PickerSearch
            value={textTagsSearch}
            onChange={setTextTagsSearch}
            placeholder={
              t("exportTab.textTagsSearch", {
                defaultValue: "Search tags...",
              }) as string
            }
            clearLabel={t("exportTab.textTagsClear", {
              defaultValue: "Include all tags",
            })}
            clearDisabled={selectedTextTagSet.size === 0}
            onClear={() => updateInclusion({ includedTextTags: [] })}
          />
          {textTags.length === 0 ? (
            <p className="text-xs text-[var(--color-textMuted)]">
              {t("exportTab.textTagsEmpty", {
                defaultValue:
                  "No text tags are used in the open database yet.",
              })}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {textTags
                .filter((tag) =>
                  tag.toLowerCase().includes(textTagsSearch.trim().toLowerCase()),
                )
                .map((tag) => {
                  const checked =
                    selectedTextTagSet.size === 0 ||
                    selectedTextTagSet.has(tag);
                  return (
                    <label
                      key={tag}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs"
                    >
                      <Checkbox
                        checked={checked}
                        onChange={(value: boolean) =>
                          updateTextTag(tag, value)
                        }
                        className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                        aria-label={tag}
                      />
                      <span className="font-medium text-[var(--color-textSecondary)]">
                        {tag}
                      </span>
                    </label>
                  );
                })}
            </div>
          )}
        </AccordionSection>
      )}

      {show("colorTags") && (
        <AccordionSection
          id={`${testIdPrefix}-color-tags`}
          title={t("exportTab.colorTagsTitle", {
            defaultValue: "Specific color tags",
          })}
          description={t("exportTab.colorTagsDescription", {
            defaultValue:
              "Restrict the export to connections tagged with a chosen color. Leave empty to ignore color when filtering.",
          })}
          icon={Palette}
          open={Boolean(sectionsOpen.colorTags)}
          onToggle={() => onToggleSection("colorTags")}
          dataTestId={`${testIdPrefix}-color-tags-section`}
          badge={selectedBadge(selectedColorTagIdSet.size)}
        >
          <PickerSearch
            value={colorTagsSearch}
            onChange={setColorTagsSearch}
            placeholder={
              t("exportTab.colorTagsSearch", {
                defaultValue: "Search color tags...",
              }) as string
            }
            clearLabel={t("exportTab.colorTagsClear", {
              defaultValue: "Include all colors",
            })}
            clearDisabled={selectedColorTagIdSet.size === 0}
            onClear={() => updateInclusion({ includedColorTagIds: [] })}
          />
          {colorTagIds.length === 0 ? (
            <p className="text-xs text-[var(--color-textMuted)]">
              {t("exportTab.colorTagsEmpty", {
                defaultValue:
                  "No color tags are used in the open database yet.",
              })}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {colorTagIds
                .filter((id) =>
                  id
                    .toLowerCase()
                    .includes(colorTagsSearch.trim().toLowerCase()),
                )
                .map((colorTagId) => {
                  const checked =
                    selectedColorTagSetSize(selectedColorTagIdSet) === 0 ||
                    selectedColorTagIdSet.has(colorTagId);
                  return (
                    <label
                      key={colorTagId}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs"
                    >
                      <Checkbox
                        checked={checked}
                        onChange={(value: boolean) =>
                          updateColorTag(colorTagId, value)
                        }
                        className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                        aria-label={colorTagId}
                      />
                      <span
                        className="h-3 w-3 rounded-sm border border-[var(--color-border)]"
                        style={{ backgroundColor: colorTagId }}
                        aria-hidden="true"
                      />
                      <span className="font-mono text-[var(--color-textSecondary)]">
                        {colorTagId}
                      </span>
                    </label>
                  );
                })}
            </div>
          )}
        </AccordionSection>
      )}

      {show("proxyProfiles") && (
        <ListPickerSection
          id={`${testIdPrefix}-proxy-profiles`}
          title={t("exportTab.proxyProfilesTitle", {
            defaultValue: "Specific proxy profiles",
          })}
          description={t("exportTab.proxyProfilesDescription", {
            defaultValue:
              "Restrict the export to specific saved proxy profiles. Leave empty to include them all.",
          })}
          icon={Server}
          open={Boolean(sectionsOpen.proxyProfiles)}
          onToggle={() => onToggleSection("proxyProfiles")}
          dataTestId={`${testIdPrefix}-proxy-profiles-section`}
          selectedIds={selectedProxyProfileIdSet}
          search={proxyProfilesSearch}
          setSearch={setProxyProfilesSearch}
          searchPlaceholder={
            t("exportTab.proxyProfilesSearch", {
              defaultValue: "Search proxy profiles...",
            }) as string
          }
          clearLabel={t("exportTab.proxyProfilesClear", {
            defaultValue: "Include all profiles",
          })}
          emptyLabel={t("exportTab.proxyProfilesEmpty", {
            defaultValue: "No saved proxy profiles yet.",
          })}
          options={proxyProfiles}
          onClear={() => updateInclusion({ includedProxyProfileIds: [] })}
          onToggleOption={updateProxyProfile}
        />
      )}

      {show("proxyChains") && (
        <ListPickerSection
          id={`${testIdPrefix}-proxy-chains`}
          title={t("exportTab.proxyChainsTitle", {
            defaultValue: "Specific proxy/tunnel chains",
          })}
          description={t("exportTab.proxyChainsDescription", {
            defaultValue:
              "Restrict the export to specific saved proxy chains or tunnel chain templates. Leave empty to include them all.",
          })}
          icon={FolderTree}
          open={Boolean(sectionsOpen.proxyChains)}
          onToggle={() => onToggleSection("proxyChains")}
          dataTestId={`${testIdPrefix}-proxy-chains-section`}
          selectedIds={selectedProxyChainIdSet}
          search={proxyChainsSearch}
          setSearch={setProxyChainsSearch}
          searchPlaceholder={
            t("exportTab.proxyChainsSearch", {
              defaultValue: "Search proxy or tunnel chains...",
            }) as string
          }
          clearLabel={t("exportTab.proxyChainsClear", {
            defaultValue: "Include all chains",
          })}
          emptyLabel={t("exportTab.proxyChainsEmpty", {
            defaultValue: "No saved proxy or tunnel chains yet.",
          })}
          options={proxyChains}
          onClear={() => updateInclusion({ includedProxyChainIds: [] })}
          onToggleOption={updateProxyChain}
        />
      )}

      {show("vpnConnections") && (
        <ListPickerSection
          id={`${testIdPrefix}-vpn-connections`}
          title={t("exportTab.vpnConnectionsTitle", {
            defaultValue: "Specific VPN connections",
          })}
          description={t("exportTab.vpnConnectionsDescription", {
            defaultValue:
              "Restrict the export to specific OpenVPN, WireGuard, Tailscale, or ZeroTier connections. Leave empty to include them all.",
          })}
          icon={Server}
          open={Boolean(sectionsOpen.vpnConnections)}
          onToggle={() => onToggleSection("vpnConnections")}
          dataTestId={`${testIdPrefix}-vpn-connections-section`}
          selectedIds={selectedVpnConnectionIdSet}
          search={vpnSearch}
          setSearch={setVpnSearch}
          searchPlaceholder={
            t("exportTab.vpnConnectionsSearch", {
              defaultValue: "Search VPN connections...",
            }) as string
          }
          clearLabel={t("exportTab.vpnConnectionsClear", {
            defaultValue: "Include all VPN connections",
          })}
          emptyLabel={t("exportTab.vpnConnectionsEmpty", {
            defaultValue: "No VPN connections saved yet.",
          })}
          options={vpnConnections}
          onClear={() => updateInclusion({ includedVpnConnectionIds: [] })}
          onToggleOption={updateVpnConnection}
        />
      )}
    </>
  );
};

const selectedColorTagSetSize = (set: Set<string>): number => set.size;

const PickerSearch: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: React.ReactNode;
  clearDisabled: boolean;
  onClear: () => void;
}> = ({ value, onChange, placeholder, clearLabel, clearDisabled, onClear }) => (
  <div className="flex items-center gap-2">
    <div className="relative flex-1">
      <SearchIcon
        size={14}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="sor-form-input-xs sor-form-input-xs-icon-left w-full"
      />
    </div>
    <button
      type="button"
      className="flex-shrink-0 text-xs text-primary hover:text-primary/80 disabled:text-[var(--color-textMuted)]"
      disabled={clearDisabled}
      onClick={onClear}
    >
      {clearLabel}
    </button>
  </div>
);

const ListPickerSection: React.FC<{
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  open: boolean;
  onToggle: () => void;
  dataTestId: string;
  selectedIds: Set<string>;
  search: string;
  setSearch: (value: string) => void;
  searchPlaceholder: string;
  clearLabel: React.ReactNode;
  emptyLabel: React.ReactNode;
  options: InclusionListOption[];
  onClear: () => void;
  onToggleOption: (id: string, checked: boolean) => void;
}> = ({
  id,
  title,
  description,
  icon,
  open,
  onToggle,
  dataTestId,
  selectedIds,
  search,
  setSearch,
  searchPlaceholder,
  clearLabel,
  emptyLabel,
  options,
  onClear,
  onToggleOption,
}) => {
  const filteredOptions = options.filter((option) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [option.name, option.kind, option.description, option.searchText]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return (
    <AccordionSection
      id={id}
      title={title}
      description={description}
      icon={icon}
      open={open}
      onToggle={onToggle}
      dataTestId={dataTestId}
      badge={selectedBadge(selectedIds.size)}
    >
      <PickerSearch
        value={search}
        onChange={setSearch}
        placeholder={searchPlaceholder}
        clearLabel={clearLabel}
        clearDisabled={selectedIds.size === 0}
        onClear={onClear}
      />
      {options.length === 0 ? (
        <p className="text-xs text-[var(--color-textMuted)]">{emptyLabel}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
          {filteredOptions.map((option) => {
            const checked =
              selectedIds.size === 0 || selectedIds.has(option.id);
            return (
              <label
                key={option.key ?? option.id}
                className="flex cursor-pointer items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 last:border-b-0 hover:bg-[var(--color-surfaceHover)]"
              >
                <Checkbox
                  checked={checked}
                  onChange={(value: boolean) =>
                    onToggleOption(option.id, value)
                  }
                  className="rounded border-[var(--color-border)] bg-[var(--color-input)] text-primary"
                  aria-label={option.name}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--color-text)]">
                    {option.name}
                  </span>
                  <span className="block truncate text-[10px] text-[var(--color-textMuted)]">
                    {[option.kind, option.description].filter(Boolean).join(" - ")}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </AccordionSection>
  );
};

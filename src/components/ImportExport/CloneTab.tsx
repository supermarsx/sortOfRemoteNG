/**
 * CloneTab — third sub-tab of the Import/Export tool.
 *
 * Runs the same source/filter pipeline as ExportTab but writes the
 * filtered connections into one or more *other* databases instead of
 * a file. The "what to clone" controls intentionally mirror Export
 * (same scope semantics, same inclusion filter shape) so users don't
 * need to learn a new mental model; the "where to put it" controls
 * mirror Import (conflict policy, addTags, preserveFolders) for the
 * same reason.
 *
 * Sidecars (VPN / proxy / tunnel chain templates) are app-global, so
 * the clone action copies selected definitions once and remaps cloned
 * connections to the copied definition ids.
 */

import React, { useMemo, useState } from "react";
import { Copy, Database, Tags, ArrowRight, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CloneSourceCatalogItem,
  ExportDatabaseOption,
  ExportInclusionConfig,
  ExportScopeMode,
  ImportOptions,
  CloneResult,
} from "./types";
import { AccordionSection } from "./AccordionSection";
import { DatabasePickerRow } from "./DatabasePickerRow";
import {
  InclusionItemPickers,
  InclusionProtocolFilter,
  type InclusionConnectionOption,
  type InclusionFolderOption,
  type InclusionListOption,
} from "./InclusionPickers";
import { Select } from "../ui/forms";
import { proxyCollectionManager } from "../../utils/connection/proxyCollectionManager";
import { ProxyOpenVPNManager } from "../../utils/network/proxyOpenVPNManager";
import { Wizard, WizardTemplateCard } from "./Wizard";
import { useWizardNavigation, type WizardStep } from "./useWizardNavigation";

interface CloneTabProps {
  // Source half
  sourceMode: ExportScopeMode;
  setSourceMode: (mode: ExportScopeMode) => void;
  selectedSourceDatabaseIds: string[];
  setSelectedSourceDatabaseIds: (ids: string[]) => void;
  inclusion: ExportInclusionConfig;
  updateInclusion: (updates: Partial<ExportInclusionConfig>) => void;
  sourceCatalog: CloneSourceCatalogItem[];
  isSourceCatalogLoading?: boolean;

  // Destination half
  targetDatabaseIds: string[];
  setTargetDatabaseIds: (ids: string[]) => void;
  conflictPolicy: ImportOptions["conflictPolicy"];
  setConflictPolicy: (policy: ImportOptions["conflictPolicy"]) => void;
  addTags: string;
  setAddTags: (tags: string) => void;
  preserveFolders: boolean;
  setPreserveFolders: (value: boolean) => void;
  includeCredentials: boolean;
  setIncludeCredentials: (value: boolean) => void;
  switchToTargetAfterClone: boolean;
  setSwitchToTargetAfterClone: (value: boolean) => void;

  // Action
  databaseOptions: ExportDatabaseOption[];
  isCloning: boolean;
  cloneResult: CloneResult | null;
  onClone: () => void;
  onClearResult: () => void;
  /** Inline-unlock handler. Locked rows in both the source and
   *  target pickers render a "Unlock…" button that calls this. */
  onUnlockDatabase?: (databaseId: string) => Promise<boolean> | void;
}

const CloneTab: React.FC<CloneTabProps> = ({
  sourceMode,
  setSourceMode,
  selectedSourceDatabaseIds,
  setSelectedSourceDatabaseIds,
  inclusion,
  updateInclusion,
  sourceCatalog,
  isSourceCatalogLoading = false,
  targetDatabaseIds,
  setTargetDatabaseIds,
  conflictPolicy,
  setConflictPolicy,
  addTags,
  setAddTags,
  preserveFolders,
  setPreserveFolders,
  includeCredentials,
  setIncludeCredentials,
  switchToTargetAfterClone,
  setSwitchToTargetAfterClone,
  databaseOptions,
  isCloning,
  cloneResult,
  onClone,
  onClearResult,
  onUnlockDatabase,
}) => {
  const { t } = useTranslation();
  const [openSections, setOpenSections] = useState({
    source: true,
    filter: false,
    connections: false,
    folders: false,
    textTags: false,
    colorTags: false,
    proxyProfiles: false,
    proxyChains: false,
    vpnConnections: false,
    destination: true,
    preview: true,
  });
  const [vpnConnections, setVpnConnections] = useState<
    Array<{ id: string; name: string; kind: string }>
  >([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mgr = ProxyOpenVPNManager.getInstance();
        const [ovpn, wg, tailscale, zerotier] = await Promise.all([
          mgr.listOpenVPNConnections().catch(() => [] as any[]),
          mgr.listWireGuardConnections().catch(() => [] as any[]),
          mgr.listTailscaleConnections().catch(() => [] as any[]),
          mgr.listZeroTierConnections().catch(() => [] as any[]),
        ]);
        if (cancelled) return;
        setVpnConnections([
          ...ovpn.map((c) => ({ id: c.id, name: c.name, kind: "OpenVPN" })),
          ...wg.map((c) => ({ id: c.id, name: c.name, kind: "WireGuard" })),
          ...tailscale.map((c) => ({
            id: c.id,
            name: c.name,
            kind: "Tailscale",
          })),
          ...zerotier.map((c) => ({
            id: c.id,
            name: c.name,
            kind: "ZeroTier",
          })),
        ]);
      } catch {
        // Keep the picker empty if the native VPN bridge is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (key: keyof typeof openSections) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // ─── Derived: effective source ids ──────────────────────────────
  const effectiveSourceIds = useMemo(() => {
    const exportable = new Set(
      databaseOptions
        .filter((option) => option.isExportable)
        .map((option) => option.id),
    );
    if (sourceMode === "current") {
      const current = databaseOptions.find(
        (option) => option.isCurrent && option.isExportable,
      );
      return current ? [current.id] : [];
    }
    if (sourceMode === "all") {
      return [...exportable];
    }
    return selectedSourceDatabaseIds.filter((id) => exportable.has(id));
  }, [databaseOptions, sourceMode, selectedSourceDatabaseIds]);

  const effectiveSourceSet = useMemo(
    () => new Set(effectiveSourceIds),
    [effectiveSourceIds],
  );

  // Target options exclude any source-selected database — we never
  // want the user to clone a database onto itself.
  const targetOptions = useMemo(
    () =>
      databaseOptions.filter((option) => !effectiveSourceSet.has(option.id)),
    [databaseOptions, effectiveSourceSet],
  );

  // Resolve target option lookups for the action button label.
  const targetOptionsById = useMemo(
    () => new Map(databaseOptions.map((option) => [option.id, option])),
    [databaseOptions],
  );

  const leafSourceCatalog = useMemo(
    () => sourceCatalog.filter((item) => !item.isGroup),
    [sourceCatalog],
  );

  const folderSourceCatalog = useMemo(
    () => sourceCatalog.filter((item) => item.isGroup),
    [sourceCatalog],
  );

  const cloneConnectionOptions: InclusionConnectionOption[] = useMemo(
    () =>
      leafSourceCatalog.map((item) => ({
        id: item.key,
        name: item.name,
        protocol: item.protocol,
        protocolLabel: item.protocolLabel,
        hostname: item.hostname,
        sourcePath: item.path,
        databaseId: item.sourceDatabaseId,
        databaseName: item.sourceDatabaseName,
      })),
    [leafSourceCatalog],
  );

  const cloneFolderOptions: InclusionFolderOption[] = useMemo(
    () =>
      folderSourceCatalog.map((item) => ({
        id: item.key,
        name: item.name,
        sourcePath: item.path,
        databaseId: item.sourceDatabaseId,
        databaseName: item.sourceDatabaseName,
      })),
    [folderSourceCatalog],
  );

  const availableProtocols = useMemo(
    () =>
      Array.from(
        new Set(leafSourceCatalog.map((item) => item.protocol)),
      ).sort(),
    [leafSourceCatalog],
  );

  const availableTextTags = useMemo(() => {
    const tags = new Set<string>();
    leafSourceCatalog.forEach((item) => {
      item.tags.forEach((tag) => {
        if (tag) tags.add(tag);
      });
    });
    return Array.from(tags).sort();
  }, [leafSourceCatalog]);

  const availableColorTagIds = useMemo(() => {
    const colorTags = new Set<string>();
    leafSourceCatalog.forEach((item) => {
      if (item.colorTag) colorTags.add(item.colorTag);
    });
    return Array.from(colorTags).sort();
  }, [leafSourceCatalog]);

  const proxyProfiles = useMemo(() => proxyCollectionManager.getProfiles(), []);
  const proxyChains = useMemo(() => proxyCollectionManager.getChains(), []);
  const tunnelChains = useMemo(
    () => proxyCollectionManager.getTunnelChains(),
    [],
  );

  const proxyProfileOptions: InclusionListOption[] = useMemo(
    () =>
      proxyProfiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        kind: (profile.config?.type ?? "").toUpperCase(),
        description: profile.config?.host,
        searchText: [
          profile.name,
          profile.config?.type,
          profile.config?.host,
          profile.description,
        ]
          .filter(Boolean)
          .join(" "),
      })),
    [proxyProfiles],
  );

  const proxyChainOptions: InclusionListOption[] = useMemo(
    () => [
      ...proxyChains.map((chain) => ({
        id: chain.id,
        key: `proxy:${chain.id}`,
        name: chain.name,
        kind: t("importExport.clone.sidecars.proxyChainKind", {
          defaultValue: "Proxy chain",
        }),
        description: t(
          (chain.layers?.length ?? 0) === 1
            ? "importExport.clone.sidecars.layerCount.one"
            : "importExport.clone.sidecars.layerCount.other",
          {
            defaultValue:
              (chain.layers?.length ?? 0) === 1
                ? "{{count}} layer"
                : "{{count}} layers",
            count: chain.layers?.length ?? 0,
          },
        ),
        searchText: [chain.name, chain.description, ...(chain.tags ?? [])]
          .filter(Boolean)
          .join(" "),
      })),
      ...tunnelChains.map((chain) => ({
        id: chain.id,
        key: `tunnel:${chain.id}`,
        name: chain.name,
        kind: t("importExport.clone.sidecars.tunnelChainKind", {
          defaultValue: "Tunnel chain",
        }),
        description: t(
          (chain.layers?.length ?? 0) === 1
            ? "importExport.clone.sidecars.layerCount.one"
            : "importExport.clone.sidecars.layerCount.other",
          {
            defaultValue:
              (chain.layers?.length ?? 0) === 1
                ? "{{count}} layer"
                : "{{count}} layers",
            count: chain.layers?.length ?? 0,
          },
        ),
        searchText: [chain.name, chain.description, ...(chain.tags ?? [])]
          .filter(Boolean)
          .join(" "),
      })),
    ],
    [proxyChains, t, tunnelChains],
  );

  const vpnConnectionOptions: InclusionListOption[] = useMemo(
    () =>
      vpnConnections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        kind: connection.kind,
        searchText: `${connection.name} ${connection.kind}`,
      })),
    [vpnConnections],
  );

  const proxyProfilePreviewCount = useMemo(() => {
    if (!inclusion.includeTunnelChains) return 0;
    const selected = inclusion.includedProxyProfileIds ?? [];
    return selected.length > 0 ? selected.length : proxyProfileOptions.length;
  }, [
    inclusion.includeTunnelChains,
    inclusion.includedProxyProfileIds,
    proxyProfileOptions.length,
  ]);

  const proxyChainPreviewCount = useMemo(() => {
    if (!inclusion.includeTunnelChains) return 0;
    const selected = inclusion.includedProxyChainIds ?? [];
    if (selected.length === 0) return proxyChainOptions.length;
    const selectedSet = new Set(selected);
    return proxyChainOptions.filter((option) => selectedSet.has(option.id))
      .length;
  }, [
    inclusion.includeTunnelChains,
    inclusion.includedProxyChainIds,
    proxyChainOptions,
  ]);

  const vpnPreviewCount = useMemo(() => {
    if (!inclusion.includeVpnData) return 0;
    const selected = inclusion.includedVpnConnectionIds ?? [];
    return selected.length > 0 ? selected.length : vpnConnectionOptions.length;
  }, [
    inclusion.includeVpnData,
    inclusion.includedVpnConnectionIds,
    vpnConnectionOptions.length,
  ]);

  const sidecarPreviewCount =
    proxyProfilePreviewCount + proxyChainPreviewCount + vpnPreviewCount;

  const previewLeafItems = useMemo(() => {
    if (!inclusion.includeConnections) return [];
    const includedProtocolSet =
      inclusion.includedProtocols.length > 0
        ? new Set(inclusion.includedProtocols)
        : null;
    const includedIdSet =
      (inclusion.includedConnectionIds ?? []).length > 0
        ? new Set(inclusion.includedConnectionIds)
        : null;
    const includedTextTagSet =
      (inclusion.includedTextTags ?? []).length > 0
        ? new Set(inclusion.includedTextTags)
        : null;
    const includedColorSet =
      (inclusion.includedColorTagIds ?? []).length > 0
        ? new Set(inclusion.includedColorTagIds)
        : null;
    const includedFolderSet =
      (inclusion.includedFolderIds ?? []).length > 0
        ? new Set(inclusion.includedFolderIds)
        : null;

    return leafSourceCatalog.filter((connection) => {
      if (
        includedProtocolSet &&
        !includedProtocolSet.has(connection.protocol)
      ) {
        return false;
      }
      if (includedIdSet && !includedIdSet.has(connection.key)) return false;
      if (
        includedFolderSet &&
        !connection.ancestorKeys.some((key) => includedFolderSet.has(key))
      ) {
        return false;
      }
      if (
        includedTextTagSet &&
        !(connection.tags ?? []).some((tag) => includedTextTagSet.has(tag))
      ) {
        return false;
      }
      if (
        includedColorSet &&
        (connection.colorTag == null ||
          !includedColorSet.has(connection.colorTag))
      ) {
        return false;
      }
      return true;
    });
  }, [leafSourceCatalog, inclusion]);

  const previewCount = previewLeafItems.length;

  const folderPreviewCount = useMemo(() => {
    if (!inclusion.includeConnections || !inclusion.includeFolderItems)
      return 0;
    const includedFolderSet =
      (inclusion.includedFolderIds ?? []).length > 0
        ? new Set(inclusion.includedFolderIds)
        : null;

    if (inclusion.includeEmptyFolders) {
      const selectedFolderAncestorKeys = new Set<string>();
      if (includedFolderSet) {
        folderSourceCatalog.forEach((folder) => {
          if (includedFolderSet.has(folder.key)) {
            folder.ancestorKeys.forEach((key) =>
              selectedFolderAncestorKeys.add(key),
            );
          }
        });
      }

      return folderSourceCatalog.filter((folder) => {
        if (!includedFolderSet) return true;
        return (
          includedFolderSet.has(folder.key) ||
          selectedFolderAncestorKeys.has(folder.key) ||
          folder.ancestorKeys.some((key) => includedFolderSet.has(key))
        );
      }).length;
    }

    const ancestorKeys = new Set<string>();
    previewLeafItems.forEach((connection) => {
      connection.ancestorKeys.forEach((key) => ancestorKeys.add(key));
    });
    return folderSourceCatalog.filter((folder) => ancestorKeys.has(folder.key))
      .length;
  }, [folderSourceCatalog, inclusion, previewLeafItems]);

  const previewItemCount = previewCount + folderPreviewCount;
  const previewItemLabel =
    [
      previewCount > 0
        ? t("importExport.clone.preview.connectionCount", {
            defaultValue: "{{count}} connection(s)",
            count: previewCount,
          })
        : null,
      folderPreviewCount > 0
        ? t("importExport.clone.preview.folderCount", {
            defaultValue: "{{count}} folder(s)",
            count: folderPreviewCount,
          })
        : null,
    ]
      .filter(Boolean)
      .join(", ") ||
    t("importExport.clone.preview.zeroItems", {
      defaultValue: "0 items",
    });

  // Validation gates for the action button.
  const targetOverlapsSource = targetDatabaseIds.some((id) =>
    effectiveSourceSet.has(id),
  );
  const hasEnabledTarget = targetDatabaseIds.some((id) => {
    const option = targetOptionsById.get(id);
    return option?.isExportable;
  });
  const canClone =
    !isCloning &&
    effectiveSourceIds.length > 0 &&
    targetDatabaseIds.length > 0 &&
    !targetOverlapsSource &&
    hasEnabledTarget &&
    (previewItemCount > 0 || sidecarPreviewCount > 0);

  const buttonLabel = (() => {
    if (isCloning) {
      return t("importExport.clone.action.cloning", {
        defaultValue: "Cloning…",
      });
    }
    if (effectiveSourceIds.length === 0) {
      return t("importExport.clone.action.pickSource", {
        defaultValue: "Pick a source database",
      });
    }
    if (targetDatabaseIds.length === 0) {
      return t("importExport.clone.action.pickTarget", {
        defaultValue: "Pick a target database",
      });
    }
    if (previewItemCount === 0 && sidecarPreviewCount === 0) {
      return t("importExport.clone.action.nothingToClone", {
        defaultValue: "Nothing to clone with this filter",
      });
    }
    if (targetOverlapsSource) {
      return t("importExport.clone.action.targetOverlap", {
        defaultValue: "Target overlaps with source",
      });
    }
    if (!hasEnabledTarget) {
      return t("importExport.clone.action.unlockTarget", {
        defaultValue: "Unlock target database to clone",
      });
    }
    const items =
      previewItemCount > 0
        ? previewItemLabel
        : t("importExport.clone.action.sidecarDefinitionCount", {
            defaultValue: "{{count}} sidecar definition(s)",
            count: sidecarPreviewCount,
          });
    if (targetDatabaseIds.length === 1) {
      const targetName =
        targetOptionsById.get(targetDatabaseIds[0])?.name ??
        t("importExport.clone.action.targetFallback", {
          defaultValue: "target",
        });
      return t("importExport.clone.action.cloneToTarget", {
        defaultValue: "Clone {{items}} to {{target}}",
        items,
        target: targetName,
      });
    }
    return t("importExport.clone.action.cloneToDatabases", {
      defaultValue: "Clone {{items}} to {{count}} databases",
      items,
      count: targetDatabaseIds.length,
    });
  })();

  const wizardSteps = useMemo<WizardStep[]>(
    () => [
      {
        id: "template-source",
        label: t("importExport.clone.steps.templateSource.label", {
          defaultValue: "Template & Source",
        }),
        description: t(
          "importExport.clone.steps.templateSource.description",
          {
            defaultValue:
              "Start from a useful preset, then choose the source database collection.",
          },
        ),
      },
      {
        id: "target",
        label: t("importExport.clone.steps.target.label", {
          defaultValue: "Target",
        }),
        description: t("importExport.clone.steps.target.description", {
          defaultValue: "Choose one or more eligible destination databases.",
        }),
      },
      {
        id: "scope-content",
        label: t("importExport.clone.steps.scopeContent.label", {
          defaultValue: "Scope & Content",
        }),
        description: t("importExport.clone.steps.scopeContent.description", {
          defaultValue:
            "Choose the connections, groups, tags, and sidecars to copy.",
        }),
      },
      {
        id: "options",
        label: t("importExport.clone.steps.options.label", {
          defaultValue: "Options",
        }),
        description: t("importExport.clone.steps.options.description", {
          defaultValue:
            "Set conflict handling, credentials, folders, and post-clone behavior.",
        }),
      },
      {
        id: "review",
        label: t("importExport.clone.steps.review.label", {
          defaultValue: "Preview & Confirm",
        }),
        description: t("importExport.clone.steps.review.description", {
          defaultValue:
            "Review the exact source, targets, and item counts before cloning.",
        }),
      },
    ],
    [t],
  );

  const validateWizardStep = React.useCallback(
    (stepId: string): string | undefined => {
      if (stepId === "template-source" && effectiveSourceIds.length === 0) {
        return t("importExport.clone.validation.sourceRequired", {
          defaultValue:
            "Choose at least one unlocked source database before continuing.",
        });
      }
      if (stepId === "target") {
        if (targetDatabaseIds.length === 0) {
          return t("importExport.clone.validation.targetRequired", {
            defaultValue:
              "Choose at least one target database before continuing.",
          });
        }
        if (targetOverlapsSource) {
          return t("importExport.clone.validation.targetOverlap", {
            defaultValue:
              "A target database cannot also be one of the clone sources.",
          });
        }
        if (!hasEnabledTarget) {
          return t("importExport.clone.validation.targetLocked", {
            defaultValue:
              "Unlock an eligible target database before continuing.",
          });
        }
      }
      if (
        stepId === "scope-content" &&
        !isSourceCatalogLoading &&
        previewItemCount === 0 &&
        sidecarPreviewCount === 0
      ) {
        return t("importExport.clone.validation.contentEmpty", {
          defaultValue: "The current content filters leave nothing to clone.",
        });
      }
      return undefined;
    },
    [
      effectiveSourceIds.length,
      hasEnabledTarget,
      isSourceCatalogLoading,
      previewItemCount,
      sidecarPreviewCount,
      t,
      targetDatabaseIds.length,
      targetOverlapsSource,
    ],
  );
  const wizard = useWizardNavigation(wizardSteps, validateWizardStep);

  const applyCloneTemplate = (template: "exact" | "clean") => {
    if (template === "exact") {
      updateInclusion({
        includeConnections: true,
        includeCredentials: true,
        includeFolderItems: true,
        includeEmptyFolders: true,
        includeTunnelChains: true,
        includeVpnData: true,
        includedProtocols: [],
        includedConnectionIds: [],
        includedFolderIds: [],
        includedTextTags: [],
        includedColorTagIds: [],
        includedProxyProfileIds: [],
        includedProxyChainIds: [],
        includedVpnConnectionIds: [],
      });
      setPreserveFolders(true);
      setIncludeCredentials(true);
      setConflictPolicy("duplicate");
      setAddTags("");
    } else {
      updateInclusion({
        includeConnections: true,
        includeCredentials: false,
        includeFolderItems: true,
        includeEmptyFolders: false,
        includeTunnelChains: false,
        includeVpnData: false,
        includedProtocols: [],
        includedConnectionIds: [],
        includedFolderIds: [],
        includedTextTags: [],
        includedColorTagIds: [],
        includedProxyProfileIds: [],
        includedProxyChainIds: [],
        includedVpnConnectionIds: [],
      });
      setPreserveFolders(true);
      setIncludeCredentials(false);
      setConflictPolicy("rename");
      setAddTags("cloned");
    }
    wizard.clearStepError("template-source");
  };

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[var(--color-text)] mb-4">
          {t("importExport.clone.title", { defaultValue: "Clone" })}
        </h3>
        <p className="text-[var(--color-textSecondary)] mb-4">
          {t("importExport.clone.description", {
            defaultValue:
              "Copy connections from one or more source databases into another database (or several) in this app. Same filters as Export — but the result lands in another database instead of a file. Proxy, VPN, and tunnel-chain definitions can be copied with the clone and cloned connections will point to the copied definitions.",
          })}
        </p>
      </div>

      <Wizard
        id="clone"
        steps={wizardSteps}
        navigation={wizard}
        finalAction={
          <button
            type="button"
            onClick={onClone}
            disabled={!canClone}
            data-testid="clone-action-button"
            className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              canClone
                ? "bg-primary text-[var(--color-text)] hover:bg-primary/90"
                : "cursor-not-allowed bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)]"
            }`}
          >
            <Copy size={16} />
            {buttonLabel}
          </button>
        }
      >
        {/* ── Source ────────────────────────────────────────────── */}
        {wizard.currentStepId === "template-source" && (
          <div className="space-y-4">
            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              aria-label={t("importExport.clone.templates.ariaLabel", {
                defaultValue: "Clone templates",
              })}
            >
              <WizardTemplateCard
                title={t("importExport.clone.templates.exact.title", {
                  defaultValue: "Exact copy",
                })}
                description={t(
                  "importExport.clone.templates.exact.description",
                  {
                    defaultValue:
                      "Carry all connections, folder structure, credentials, VPN, proxy, and tunnel definitions. Duplicate conflicts safely.",
                  },
                )}
                onApply={() => applyCloneTemplate("exact")}
                testId="clone-template-exact"
              />
              <WizardTemplateCard
                title={t("importExport.clone.templates.clean.title", {
                  defaultValue: "Clean migration",
                })}
                description={t(
                  "importExport.clone.templates.clean.description",
                  {
                    defaultValue:
                      "Copy connections and used folders without credentials or sidecars, rename conflicts, and tag the result as cloned.",
                  },
                )}
                onApply={() => applyCloneTemplate("clean")}
                testId="clone-template-clean"
              />
            </div>
            <AccordionSection
              id="clone-source"
              title={t("importExport.clone.source.title", {
                defaultValue: "Source",
              })}
              description={t("importExport.clone.source.description", {
                defaultValue: "Pick which database(s) to clone connections from.",
              })}
              icon={Database}
              open={openSections.source}
              onToggle={() => toggle("source")}
              dataTestId="clone-source-section"
              badge={
                <span className="text-[var(--color-textMuted)]">
                  {t(
                    effectiveSourceIds.length === 1
                      ? "importExport.clone.source.databaseCount.one"
                      : "importExport.clone.source.databaseCount.other",
                    {
                      defaultValue:
                        effectiveSourceIds.length === 1
                          ? "{{count}} database"
                          : "{{count}} databases",
                      count: effectiveSourceIds.length,
                    },
                  )}
                </span>
              }
            >
              {/*
          Button-card row, mirroring ExportTab's scope picker so the
          two halves of the tool feel consistent. Each card is a
          `role=radio` button with a label + a one-line description
          underneath; the active card lights up in the primary colour.
        */}
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                role="radiogroup"
                aria-label={t("importExport.clone.source.scopeAriaLabel", {
                  defaultValue: "Clone source scope",
                })}
              >
                {(
                  [
                    {
                      value: "current",
                      label: t(
                        "importExport.clone.source.modes.current.label",
                        { defaultValue: "Current database" },
                      ),
                      description: t(
                        "importExport.clone.source.modes.current.description",
                        {
                          defaultValue:
                            "Just the database that's open right now.",
                        },
                      ),
                    },
                    {
                      value: "selected",
                      label: t(
                        "importExport.clone.source.modes.selected.label",
                        { defaultValue: "Selected databases" },
                      ),
                      description: t(
                        "importExport.clone.source.modes.selected.description",
                        {
                          defaultValue:
                            "Pick one or more from the list below.",
                        },
                      ),
                    },
                    {
                      value: "all",
                      label: t("importExport.clone.source.modes.all.label", {
                        defaultValue: "All databases",
                      }),
                      description: t(
                        "importExport.clone.source.modes.all.description",
                        {
                          defaultValue: "Every unlocked exportable database.",
                        },
                      ),
                    },
                  ] as Array<{
                    value: ExportScopeMode;
                    label: string;
                    description: string;
                  }>
                ).map((option) => {
                  const active = sourceMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid={`clone-source-mode-${option.value}`}
                      onClick={() => setSourceMode(option.value)}
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${
                        active
                          ? "border-primary bg-primary/15 text-[var(--color-text)]"
                          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-textSecondary)] hover:border-primary/60 hover:text-[var(--color-text)]"
                      }`}
                    >
                      <span className="block text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--color-textMuted)]">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
              {sourceMode === "selected" && (
                <div className="mt-2 space-y-2 max-h-72 overflow-y-auto">
                  {databaseOptions.length === 0 ? (
                    <p className="text-xs text-[var(--color-textMuted)]">
                      {t("importExport.clone.source.noDatabases", {
                        defaultValue: "No databases available.",
                      })}
                    </p>
                  ) : (
                    databaseOptions.map((option) => (
                      <DatabasePickerRow
                        key={option.id}
                        option={option}
                        dataTestId={`clone-source-option-${option.id}`}
                        onUnlock={onUnlockDatabase}
                        control={
                          <input
                            type="checkbox"
                            checked={selectedSourceDatabaseIds.includes(
                              option.id,
                            )}
                            disabled={!option.isExportable}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedSourceDatabaseIds([
                                  ...selectedSourceDatabaseIds,
                                  option.id,
                                ]);
                              } else {
                                setSelectedSourceDatabaseIds(
                                  selectedSourceDatabaseIds.filter(
                                    (id) => id !== option.id,
                                  ),
                                );
                              }
                            }}
                            aria-label={option.name}
                          />
                        }
                      />
                    ))
                  )}
                </div>
              )}
            </AccordionSection>
          </div>
        )}

        {/* ── Filter ──────────────────────────────────────────── */}
        {wizard.currentStepId === "scope-content" && (
          <AccordionSection
            id="clone-filter"
            title={t("importExport.clone.filter.title", {
              defaultValue: "Filter",
            })}
            description={t("importExport.clone.filter.description", {
              defaultValue:
                "Optionally narrow what gets cloned by protocol, folder, tag, color, proxy, chain, or VPN.",
            })}
            icon={Tags}
            open={openSections.filter}
            onToggle={() => toggle("filter")}
            dataTestId="clone-filter-section"
            badge={
              <span className="text-[var(--color-textMuted)]">
                {isSourceCatalogLoading
                  ? t("importExport.clone.filter.loading", {
                      defaultValue: "loading",
                    })
                  : `${previewItemCount} of ${sourceCatalog.length}`}
              </span>
            }
          >
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={inclusion.includeFolderItems}
                  onChange={(e) =>
                    updateInclusion({ includeFolderItems: e.target.checked })
                  }
                />
                {t("importExport.clone.filter.carryFolders", {
                  defaultValue: "Carry folder structure across",
                })}
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={inclusion.includeEmptyFolders}
                  disabled={!inclusion.includeFolderItems}
                  onChange={(e) =>
                    updateInclusion({ includeEmptyFolders: e.target.checked })
                  }
                />
                {t("importExport.clone.filter.includeEmptyFolders", {
                  defaultValue: "Include empty folders",
                })}
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={inclusion.includeTunnelChains}
                  onChange={(e) =>
                    updateInclusion({ includeTunnelChains: e.target.checked })
                  }
                />
                {t("importExport.clone.filter.includeChains", {
                  defaultValue:
                    "Clone proxy profiles, proxy chains, and tunnel chains",
                })}
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={inclusion.includeVpnData}
                  onChange={(e) =>
                    updateInclusion({ includeVpnData: e.target.checked })
                  }
                />
                {t("importExport.clone.filter.includeVpn", {
                  defaultValue: "Clone VPN connections",
                })}
              </label>
              <InclusionProtocolFilter
                inclusion={inclusion}
                updateInclusion={updateInclusion}
                availableProtocols={availableProtocols}
                disabled={!inclusion.includeConnections}
                dataTestId="clone-protocol-filter"
              />
              {isSourceCatalogLoading && (
                <p className="text-xs text-[var(--color-textMuted)]">
                  {t("importExport.clone.filter.loadingItems", {
                    defaultValue: "Loading source database items...",
                  })}
                </p>
              )}
              <InclusionItemPickers
                inclusion={inclusion}
                updateInclusion={updateInclusion}
                sectionsOpen={openSections}
                onToggleSection={(section) => {
                  if (
                    section === "connections" ||
                    section === "folders" ||
                    section === "textTags" ||
                    section === "colorTags" ||
                    section === "proxyProfiles" ||
                    section === "proxyChains" ||
                    section === "vpnConnections"
                  ) {
                    toggle(section);
                  }
                }}
                visibleSections={[
                  "connections",
                  "folders",
                  "textTags",
                  "colorTags",
                  "proxyProfiles",
                  "proxyChains",
                  "vpnConnections",
                ]}
                connections={cloneConnectionOptions}
                folders={cloneFolderOptions}
                textTags={availableTextTags}
                colorTagIds={availableColorTagIds}
                proxyProfiles={
                  inclusion.includeTunnelChains ? proxyProfileOptions : []
                }
                proxyChains={
                  inclusion.includeTunnelChains ? proxyChainOptions : []
                }
                vpnConnections={
                  inclusion.includeVpnData ? vpnConnectionOptions : []
                }
                testIdPrefix="clone"
                connectionEmptyLabel={t(
                  "importExport.clone.filter.connectionsEmpty",
                  {
                    defaultValue:
                      "No source connections are available for the selected source scope.",
                  },
                )}
                folderEmptyLabel={t(
                  "importExport.clone.filter.foldersEmpty",
                  {
                    defaultValue:
                      "No source folders are available for the selected source scope.",
                  },
                )}
              />
            </div>
          </AccordionSection>
        )}

        {/* ── Destination ─────────────────────────────────────── */}
        {(wizard.currentStepId === "target" ||
          wizard.currentStepId === "options") && (
          <AccordionSection
            id="clone-destination"
            title={
              wizard.currentStepId === "target"
                ? t("importExport.clone.destination.targetTitle", {
                    defaultValue: "Target databases",
                  })
                : t("importExport.clone.destination.optionsTitle", {
                    defaultValue: "Clone options",
                  })
            }
            description={
              wizard.currentStepId === "target"
                ? t("importExport.clone.destination.targetDescription", {
                    defaultValue:
                      "Pick where the cloned connections should land.",
                  })
                : t("importExport.clone.destination.optionsDescription", {
                    defaultValue:
                      "Choose how collisions, folders, credentials, and navigation are handled.",
                  })
            }
            icon={ArrowRight}
            open={openSections.destination}
            onToggle={() => toggle("destination")}
            dataTestId="clone-destination-section"
            badge={
              <span
                className={
                  targetDatabaseIds.length > 0
                    ? "text-[var(--color-textMuted)]"
                    : "text-warning"
                }
              >
                {t(
                  targetDatabaseIds.length === 1
                    ? "importExport.clone.destination.targetCount.one"
                    : "importExport.clone.destination.targetCount.other",
                  {
                    defaultValue:
                      targetDatabaseIds.length === 1
                        ? "{{count}} target database"
                        : "{{count}} target databases",
                    count: targetDatabaseIds.length,
                  },
                )}
              </span>
            }
          >
            {wizard.currentStepId === "target" && (
              <div>
                <label className="block text-xs text-[var(--color-textSecondary)] mb-1.5">
                  {t("importExport.clone.destination.targetTitle", {
                    defaultValue: "Target databases",
                  })}
                </label>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {targetOptions.length === 0 ? (
                    <p className="text-xs text-[var(--color-textMuted)]">
                      {t("importExport.clone.destination.noEligibleTargets", {
                        defaultValue:
                          "No eligible target databases. Configure another database first, or pick fewer sources.",
                      })}
                    </p>
                  ) : (
                    targetOptions.map((option) => (
                      <DatabasePickerRow
                        key={option.id}
                        option={option}
                        dataTestId={`clone-target-option-${option.id}`}
                        onUnlock={onUnlockDatabase}
                        control={
                          <input
                            type="checkbox"
                            checked={targetDatabaseIds.includes(option.id)}
                            disabled={!option.isExportable}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setTargetDatabaseIds([
                                  ...targetDatabaseIds,
                                  option.id,
                                ]);
                              } else {
                                setTargetDatabaseIds(
                                  targetDatabaseIds.filter(
                                    (id) => id !== option.id,
                                  ),
                                );
                              }
                            }}
                            aria-label={option.name}
                          />
                        }
                      />
                    ))
                  )}
                </div>
              </div>
            )}

            {wizard.currentStepId === "options" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="clone-conflict-policy"
                    className="block text-xs text-[var(--color-textSecondary)]"
                  >
                    {t("importExport.clone.options.conflictPolicy", {
                      defaultValue: "Conflict policy",
                    })}
                  </label>
                  <Select
                    value={conflictPolicy}
                    onChange={(value: string) =>
                      setConflictPolicy(
                        value as ImportOptions["conflictPolicy"],
                      )
                    }
                    options={[
                      {
                        value: "duplicate",
                        label: t(
                          "importExport.clone.options.conflict.duplicate",
                          {
                            defaultValue:
                              "Duplicate — write with fresh ids on collision",
                          },
                        ),
                      },
                      {
                        value: "rename",
                        label: t(
                          "importExport.clone.options.conflict.rename",
                          {
                            defaultValue:
                              "Rename — suffix every conflict, keep both",
                          },
                        ),
                      },
                      {
                        value: "skip",
                        label: t("importExport.clone.options.conflict.skip", {
                          defaultValue: "Skip — drop colliding connections",
                        }),
                      },
                    ]}
                    variant="form"
                    aria-label={t(
                      "importExport.clone.options.conflictPolicy",
                      {
                        defaultValue: "Conflict policy",
                      },
                    )}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="clone-add-tags"
                    className="block text-xs text-[var(--color-textSecondary)]"
                  >
                    {t("importExport.clone.options.addTags", {
                      defaultValue: "Add tags to cloned connections",
                    })}
                  </label>
                  <input
                    id="clone-add-tags"
                    value={addTags}
                    onChange={(e) => setAddTags(e.target.value)}
                    placeholder={t(
                      "importExport.clone.options.tagsPlaceholder",
                      {
                        defaultValue: "comma-separated tags",
                      },
                    )}
                    className="sor-form-input-xs w-full"
                  />
                </div>

                <div className="grid gap-2 text-xs text-[var(--color-textSecondary)] sm:grid-cols-2">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={preserveFolders}
                      onChange={(e) => setPreserveFolders(e.target.checked)}
                    />
                    {t("importExport.clone.options.preserveFolders", {
                      defaultValue: "Preserve folders",
                    })}
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeCredentials}
                      onChange={(e) => setIncludeCredentials(e.target.checked)}
                    />
                    {t("importExport.clone.options.includeCredentials", {
                      defaultValue: "Include credentials",
                    })}
                  </label>
                  <label className="inline-flex items-center gap-2 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={switchToTargetAfterClone}
                      onChange={(e) =>
                        setSwitchToTargetAfterClone(e.target.checked)
                      }
                    />
                    {t("importExport.clone.options.switchAfterClone", {
                      defaultValue:
                        "Switch to the first target database after the clone finishes",
                    })}
                  </label>
                </div>
                {inclusion.includeVpnData && !includeCredentials && (
                  <p className="text-xs text-warning">
                    {t("importExport.clone.options.vpnCredentialsWarning", {
                      defaultValue:
                        "VPN profiles cannot be cloned without their private material. They will be omitted, affected associations will be removed, and dependent chains will be skipped with warnings.",
                    })}
                  </p>
                )}
              </div>
            )}
          </AccordionSection>
        )}

        {/* ── Preview + action ────────────────────────────────── */}
        {wizard.currentStepId === "review" && (
          <AccordionSection
            id="clone-preview"
            title={t("importExport.clone.preview.title", {
              defaultValue: "Preview",
            })}
            description={t("importExport.clone.preview.description", {
              defaultValue: "What this clone will land on each target.",
            })}
            icon={Server}
            open={openSections.preview}
            onToggle={() => toggle("preview")}
            dataTestId="clone-preview-section"
            badge={
              <span className="text-[var(--color-textMuted)]">
                {previewItemLabel}
              </span>
            }
          >
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-textSecondary)] space-y-1">
              <div>
                <span className="text-[var(--color-text)]">
                  {t("importExport.clone.source.title", {
                    defaultValue: "Source",
                  })}
                </span>
                :{" "}
                {effectiveSourceIds.length === 0 ? (
                  <span className="text-warning">
                    {t("importExport.clone.preview.none", {
                      defaultValue: "none",
                    })}
                  </span>
                ) : (
                  effectiveSourceIds
                    .map((id) => targetOptionsById.get(id)?.name ?? id)
                    .join(", ")
                )}
              </div>
              <div>
                <span className="text-[var(--color-text)]">
                  {t("importExport.clone.preview.targetsLabel", {
                    defaultValue: "Target(s)",
                  })}
                </span>
                :{" "}
                {targetDatabaseIds.length === 0 ? (
                  <span className="text-warning">
                    {t("importExport.clone.preview.none", {
                      defaultValue: "none",
                    })}
                  </span>
                ) : (
                  targetDatabaseIds
                    .map((id) => targetOptionsById.get(id)?.name ?? id)
                    .join(", ")
                )}
              </div>
              <div>
                <span className="text-[var(--color-text)]">
                  {t("importExport.clone.preview.filterResultLabel", {
                    defaultValue: "Filter result",
                  })}
                </span>
                :{" "}
                {previewItemLabel}
              </div>
              <div>
                <span className="text-[var(--color-text)]">
                  {t("importExport.clone.preview.sidecarsLabel", {
                    defaultValue: "Sidecars",
                  })}
                </span>
                :{" "}
                {t("importExport.clone.preview.definitionCount", {
                  defaultValue: "{{count}} definition(s)",
                  count: sidecarPreviewCount,
                })}
              </div>
            </div>

            {cloneResult && (
              <div
                className={`rounded border p-3 text-xs ${
                  cloneResult.success
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-error/30 bg-error/10 text-error"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">
                    {cloneResult.success
                      ? t("importExport.clone.result.complete", {
                          defaultValue: "Clone complete",
                        })
                      : t("importExport.clone.result.failed", {
                          defaultValue: "Clone failed",
                        })}
                  </span>
                  <button
                    type="button"
                    onClick={onClearResult}
                    className="text-[10px] underline opacity-70 hover:opacity-100"
                  >
                    {t("importExport.clone.result.dismiss", {
                      defaultValue: "Dismiss",
                    })}
                  </button>
                </div>
                <ul className="space-y-0.5">
                  {cloneResult.perTarget.map((row) => (
                    <li key={row.databaseId}>
                      {row.databaseName}:{" "}
                      {t("importExport.clone.result.clonedCount", {
                        defaultValue: "{{count}} cloned",
                        count: row.cloned,
                      })}
                      {row.error
                        ? t("importExport.clone.result.errorSuffix", {
                            defaultValue: " — error: {{error}}",
                            error: row.error,
                          })
                        : ""}
                    </li>
                  ))}
                </ul>
                {(cloneResult.renamed > 0 || cloneResult.skipped > 0) && (
                  <div className="mt-1 text-[10px] opacity-80">
                    {cloneResult.renamed > 0 &&
                      t("importExport.clone.result.renamedCount", {
                        defaultValue: "{{count}} renamed",
                        count: cloneResult.renamed,
                      })}
                    {cloneResult.renamed > 0 && cloneResult.skipped > 0 && ", "}
                    {cloneResult.skipped > 0 &&
                      t("importExport.clone.result.skippedCount", {
                        defaultValue: "{{count}} skipped",
                        count: cloneResult.skipped,
                      })}
                  </div>
                )}
                {cloneResult.sidecarsCloned &&
                  cloneResult.sidecarsCloned.total > 0 && (
                    <div className="mt-1 text-[10px] opacity-80">
                      {t("importExport.clone.result.sidecarsCloned", {
                        defaultValue:
                          "{{count}} sidecar definition(s) cloned",
                        count: cloneResult.sidecarsCloned.total,
                      })}
                    </div>
                  )}
                {cloneResult.warnings && cloneResult.warnings.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[10px] text-warning">
                    {cloneResult.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </AccordionSection>
        )}
      </Wizard>
    </div>
  );
};

export default CloneTab;

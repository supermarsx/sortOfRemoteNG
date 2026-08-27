// Proxmox VE integration panel adapter (t67-e4, plan §3 D2).
//
// Bridges `IntegrationPanelProps` (saved instance + vault secrets) to the
// existing `ProxmoxPanel` rendered in embedded mode. Hydration reads the
// instance's non-secret `fields` and its named vault secrets
// (`password` / `apiKey` / `totpSecret`) through `useIntegrationConfigStore`,
// so a saved connection opens without retyping anything. After a successful
// connect the panel writes back `fields.fingerprint` / `fields.realm` /
// `fields.insecure` (never secrets — the host already stored those).
//
// Editor mapping (generic integration fields, see descriptor.ts):
//   username `root@pam`            → password auth (realm inside the username)
//   username `user@realm!tokenname` → API token; `apiKey` secret = token secret
//   tlsVerify=false                → insecure; pin captured by the TOFU probe

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { IntegrationPanelProps } from "../../../types/integrations/registry";
import {
  useIntegrationConfigStore,
  type IntegrationInstance,
} from "../../../hooks/integrations/useIntegrationConfigStore";
import type {
  ProxmoxInitialConfig,
  ProxmoxPersistedFields,
} from "../../../types/hardware/proxmox";
import { isApiTokenUsername } from "../../../hooks/proxmox/useProxmoxManager";
import ProxmoxPanel from "../../proxmox/ProxmoxPanel";
import { launchProxmoxWebUi, openProxmoxWebUiExternal } from "./webUiLaunch";

/** Split `host[:port]` (IPv6 `[::1]:8006` supported). */
export function parseHostPort(
  raw: string | undefined,
  fallbackPort = 8006,
): { host: string; port: number } {
  const value = (raw ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  if (!value) return { host: "", port: fallbackPort };
  const bracket = value.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracket) {
    return {
      host: bracket[1],
      port: bracket[2] ? Number(bracket[2]) : fallbackPort,
    };
  }
  const parts = value.split(":");
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { host: parts[0], port: Number(parts[1]) };
  }
  return { host: value, port: fallbackPort };
}

const truthy = (v: string | undefined): boolean =>
  v === "true" || v === "1" || v === "yes";

export interface HydratedProxmoxInstance {
  initial: ProxmoxInitialConfig;
  name: string;
}

/** Pure mapping from a saved instance (+ resolved secrets) to the seed config. */
export function hydrateProxmoxInstance(
  inst: IntegrationInstance,
  secrets: {
    password?: string | null;
    apiKey?: string | null;
    totpSecret?: string | null;
    primary?: string | null;
  },
): HydratedProxmoxInstance {
  const fields = inst.fields ?? {};
  const explicitPort = Number(fields.port);
  const { host, port } = parseHostPort(
    inst.host ?? fields.host,
    Number.isInteger(explicitPort) && explicitPort > 0 ? explicitPort : 8006,
  );
  const username = (fields.username ?? "").trim();
  const useApiToken =
    fields.authMode === "apitoken" ||
    fields.authMode === "apiKey" ||
    isApiTokenUsername(username);
  const insecure =
    fields.insecure !== undefined
      ? truthy(fields.insecure)
      : fields.tlsVerify !== undefined
        ? !truthy(fields.tlsVerify)
        : truthy(fields.skipTlsVerify) || truthy(fields.tlsSkipVerify);
  const timeoutRaw = Number(fields.timeoutSecs ?? fields.timeout);
  const initial: ProxmoxInitialConfig = {
    host,
    port,
    username: useApiToken ? undefined : username || undefined,
    realm: fields.realm?.trim() || undefined,
    useApiToken,
    insecure,
    fingerprint: fields.fingerprint?.trim() || undefined,
    timeoutSecs:
      Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined,
  };
  if (useApiToken) {
    initial.tokenId = username || undefined;
    initial.tokenSecret = secrets.apiKey ?? secrets.primary ?? undefined;
  } else {
    initial.password = secrets.password ?? secrets.primary ?? undefined;
    initial.totpSecret = secrets.totpSecret ?? undefined;
  }
  return { initial, name: inst.name };
}

export default function ProxmoxIntegrationPanel({
  isOpen,
  onClose,
  instanceId,
}: IntegrationPanelProps) {
  const { t } = useTranslation();
  const { instances, isLoading, readSecret, readNamedSecret, updateInstance } =
    useIntegrationConfigStore();
  const [hydrated, setHydrated] = useState<HydratedProxmoxInstance | null>(
    null,
  );
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [hydrationError, setHydrationError] = useState<string | null>(null);

  const instance = useMemo(
    () => (instanceId ? instances.find((i) => i.id === instanceId) : undefined),
    [instances, instanceId],
  );

  // Hydrate once per instance id (secrets are read exactly once; later field
  // updates we write ourselves must not re-seed the live form).
  useEffect(() => {
    if (!isOpen || !instance || hydratedFor === instance.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [password, apiKey, totpSecret, primary] = await Promise.all([
          readNamedSecret(instance, "password"),
          readNamedSecret(instance, "apiKey"),
          readNamedSecret(instance, "totpSecret"),
          readSecret(instance),
        ]);
        if (cancelled) return;
        setHydrated(
          hydrateProxmoxInstance(instance, {
            password,
            apiKey,
            totpSecret,
            primary,
          }),
        );
        setHydratedFor(instance.id);
        setHydrationError(null);
      } catch (e) {
        if (!cancelled) {
          setHydrationError(
            typeof e === "string" ? e : ((e as Error).message ?? String(e)),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, instance, hydratedFor, readNamedSecret, readSecret]);

  const persistFields = useCallback(
    (fields: ProxmoxPersistedFields) => {
      if (!instance) return;
      const current = instance.fields ?? {};
      if (
        current.fingerprint === fields.fingerprint &&
        current.realm === fields.realm &&
        current.insecure === fields.insecure
      ) {
        return;
      }
      void updateInstance(instance.id, {
        fields: { ...current, ...fields },
      }).catch(() => {
        /* persistence is best-effort; the live session is unaffected */
      });
    },
    [instance, updateInstance],
  );

  const managerOptions = useMemo(
    () =>
      hydrated
        ? {
            initial: hydrated.initial,
            autoConnect: true,
            onPersistFields: persistFields,
          }
        : undefined,
    [hydrated, persistFields],
  );

  const openWebUi = useCallback(() => {
    if (!hydrated) return;
    const { initial, name } = hydrated;
    launchProxmoxWebUi({
      host: initial.host,
      port: initial.port,
      authMode: initial.useApiToken ? "apitoken" : "password",
      username: initial.username,
      realm: initial.realm,
      password: initial.password,
      insecure: initial.insecure,
      name: `${name} — ${t("proxmox.webUi", "Web UI")}`,
    });
  }, [hydrated, t]);

  const openWebUiExternal = useCallback(() => {
    if (!hydrated) return;
    void openProxmoxWebUiExternal(hydrated.initial.host, hydrated.initial.port);
  }, [hydrated]);

  if (!isOpen) return null;

  if (instanceId && !instance && isLoading) {
    return (
      <div
        className="flex h-full items-center justify-center gap-2 text-sm text-[var(--color-textSecondary)]"
        data-testid="proxmox-integration-panel"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("proxmox.loadingInstance", "Loading saved connection…")}
      </div>
    );
  }

  if (instanceId && instance && !hydrated && !hydrationError) {
    return (
      <div
        className="flex h-full items-center justify-center gap-2 text-sm text-[var(--color-textSecondary)]"
        data-testid="proxmox-integration-panel"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("proxmox.loadingInstance", "Loading saved connection…")}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="proxmox-integration-panel"
    >
      {hydrationError && (
        <div
          className="border-b border-error/30 bg-error/10 px-4 py-2 text-xs text-error"
          data-testid="proxmox-hydration-error"
        >
          {t(
            "proxmox.hydrationFailed",
            "Could not read the saved credentials from the vault: {{error}}",
            { error: hydrationError },
          )}
        </div>
      )}
      <ProxmoxPanel
        isOpen
        onClose={onClose}
        embedded
        title={hydrated?.name ?? instance?.name}
        managerOptions={managerOptions}
        onOpenWebUi={hydrated ? openWebUi : undefined}
        onOpenWebUiExternal={hydrated ? openWebUiExternal : undefined}
      />
    </div>
  );
}

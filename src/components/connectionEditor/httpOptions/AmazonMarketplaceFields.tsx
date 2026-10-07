import React from "react";
import { Select } from "../../ui/forms";
import {
  AMAZON_SHOPPING_MARKETS,
  detectAmazonShoppingMarket,
  getAmazonShoppingMarket,
} from "../../../utils/connection/amazonProfiles";
import { normalizeHttpApplicationSettings } from "../../../utils/connection/httpApplicationProfiles";
import type { Mgr } from "./types";

export default function AmazonMarketplaceFields({ mgr }: { mgr: Mgr }) {
  const settings = normalizeHttpApplicationSettings(
    mgr.formData.httpApplication,
  );
  const detected = detectAmazonShoppingMarket(mgr.formData.hostname ?? "");
  const value = settings?.amazonMarketplace ?? "auto";
  const selected = value === "auto" ? detected : getAmazonShoppingMarket(value);
  const apply = (marketplace: string, useAddress = false) =>
    mgr.setFormData((previous) => {
      const current = normalizeHttpApplicationSettings(
        previous.httpApplication,
      );
      if (current?.id !== "amazon-shopping" || current.invalid) return previous;
      const market = getAmazonShoppingMarket(marketplace);
      if (marketplace !== "auto" && !market) return previous;
      const destination =
        market ??
        (useAddress
          ? (detectAmazonShoppingMarket(previous.hostname ?? "") ??
            getAmazonShoppingMarket("US"))
          : undefined);
      return {
        ...previous,
        ...(destination
          ? { protocol: "https", hostname: destination.hostname, port: 443 }
          : {}),
        httpApplication: { ...current, amazonMarketplace: marketplace },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      };
    });
  return (
    <div className="max-w-2xl space-y-3 rounded border border-[var(--color-border)] p-3">
      <label htmlFor="amazon-marketplace" className="block text-sm font-medium">
        Amazon marketplace
      </label>
      <Select
        id="amazon-marketplace"
        variant="form"
        value={value}
        disabled={settings?.invalid}
        searchable
        searchPlaceholder="Search countries or storefronts…"
        onChange={(next) => apply(next)}
        options={[
          { value: "auto", label: "Auto-detect from URL" },
          ...AMAZON_SHOPPING_MARKETS.map((market) => ({
            value: market.code,
            label: market.country,
            description: market.hostname,
          })),
        ]}
      />
      <p className="text-xs text-[var(--color-textSecondary)]" role="status">
        {selected
          ? `${value === "auto" ? "Detected" : "Selected"}: ${selected.country} · ${selected.hostname}`
          : "No recognized marketplace in this URL. Enter an Amazon storefront URL or choose a marketplace."}
        {value !== "auto" && detected?.code !== selected?.code
          ? " The saved URL does not match this selection; apply the marketplace address before connecting."
          : ""}
      </p>
      <p className="text-xs text-[var(--color-textMuted)]">
        Choosing a marketplace updates this connection’s address. Auto-detect
        leaves an existing URL unchanged; blank connections start at the United
        States / International store. Login remains interactive and proxy
        permissions are unchanged.
      </p>
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        disabled={settings?.invalid}
        onClick={() => apply(value, true)}
      >
        Use Amazon Shopping login address
      </button>
    </div>
  );
}

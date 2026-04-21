import React, { useState } from "react";
import {
  Plus,
  Trash2,
  Copy,
  Fingerprint,
  Clock,
  Eye,
  EyeOff,
  Timer,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../ui/display";
import { PasswordInput, Select } from "../../ui/forms";
import { DangerConfirm } from "./helpers";
import type { Mgr } from "./types";

export const OathTab: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const { t } = useTranslation();
  const serial = mgr.selectedDevice?.serial;
  const [showSecret, setShowSecret] = useState(false);
  const [oathPw, setOathPw] = useState("");
  const [addForm, setAddForm] = useState({
    issuer: "",
    name: "",
    secret: "",
    type: "TOTP" as string,
    algorithm: "SHA1" as string,
    digits: 6,
    period: 30,
    touch: false,
  });

  return (
    <div className="sor-yk-oath space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Timer className="w-4 h-4" />
          {t("yubikey.oath.accounts", "OATH Accounts")} (
          {mgr.oathAccounts.length})
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => mgr.fetchOathAccounts(serial)}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3 h-3 ${mgr.loading ? "animate-spin" : ""}`}
            />
            {t("yubikey.oath.refresh", "Refresh")}
          </button>
          <button
            onClick={() => mgr.oathCalculateAll(serial)}
            disabled={mgr.loading}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
          >
            <RefreshCw className="w-3 h-3" />
            {t("yubikey.oath.calcAll", "Calculate All")}
          </button>
        </div>
      </div>

      {/* Account List */}
      {mgr.oathAccounts.length === 0 ? (
        <EmptyState
          icon={Timer}
          message={t("yubikey.oath.empty", "No OATH Accounts")}
          hint={t(
            "yubikey.oath.emptyDesc",
            "Add an account to store TOTP/HOTP credentials.",
          )}
        />
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {mgr.oathAccounts.map((acct, idx) => {
            const code = mgr.oathCodes[acct.credential_id];
            return (
              <div
                key={`${acct.credential_id}-${idx}`}
                className="bg-card border border-border rounded-lg p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {acct.issuer && (
                        <span className="text-xs font-medium">
                          {acct.issuer}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {acct.name}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          acct.oath_type === "Totp"
                            ? "bg-primary/10 text-primary"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {acct.oath_type}
                      </span>
                      <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                        {acct.algorithm}
                      </span>
                      <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                        {acct.digits}d
                      </span>
                      {acct.oath_type === "Totp" && (
                        <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] text-muted-foreground">
                          {acct.period}s
                        </span>
                      )}
                      {acct.touch_required && (
                        <span className="px-1.5 py-0.5 bg-warning/10 text-warning rounded text-[10px]">
                          <Fingerprint className="w-3 h-3 inline" /> Touch
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() =>
                        mgr.oathCalculate(serial, acct.credential_id)
                      }
                      disabled={mgr.loading}
                      className="px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                    >
                      {t("yubikey.oath.calculate", "Calc")}
                    </button>
                    <button
                      onClick={() =>
                        mgr.oathDeleteAccount(serial, acct.credential_id)
                      }
                      disabled={mgr.loading}
                      className="p-1 text-error hover:bg-error/10 rounded disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {code && (
                  <div className="flex items-center gap-2 bg-muted/50 rounded p-2">
                    <span className="text-lg font-mono font-bold tracking-wider">
                      {code.code}
                    </span>
                    {code.valid_to && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {Math.max(
                          0,
                          Math.round(code.valid_to - Date.now() / 1000),
                        )}
                        s
                      </span>
                    )}
                    <button
                      onClick={() => navigator.clipboard.writeText(code.code)}
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Account Form */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Plus className="w-4 h-4" />
          {t("yubikey.oath.addAccount", "Add Account")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={addForm.issuer}
            onChange={(e) =>
              setAddForm((f) => ({ ...f, issuer: e.target.value }))
            }
            placeholder={t("yubikey.oath.issuer", "Issuer")}
            className="sor-form-input-xs"
          />
          <input
            value={addForm.name}
            onChange={(e) =>
              setAddForm((f) => ({ ...f, name: e.target.value }))
            }
            placeholder={t("yubikey.oath.name", "Account Name")}
            className="sor-form-input-xs"
          />
        </div>
        <div className="relative">
          <input
            type={showSecret ? "text" : "password"}
            value={addForm.secret}
            onChange={(e) =>
              setAddForm((f) => ({ ...f, secret: e.target.value }))
            }
            placeholder={t("yubikey.oath.secret", "Secret (Base32)")}
            className="sor-form-input-xs w-full pr-8"
          />
          <button
            onClick={() => setShowSecret(!showSecret)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {showSecret ? (
              <EyeOff className="w-3 h-3" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Select
            value={addForm.type}
            onChange={(v) =>
              setAddForm((f) => ({ ...f, type: v }))
            }
            variant="form-sm"
            options={[
              { value: "TOTP", label: "TOTP" },
              { value: "HOTP", label: "HOTP" },
            ]}
          />
          <Select
            value={addForm.algorithm}
            onChange={(v) =>
              setAddForm((f) => ({ ...f, algorithm: v }))
            }
            variant="form-sm"
            options={[
              { value: "SHA1", label: "SHA1" },
              { value: "SHA256", label: "SHA256" },
              { value: "SHA512", label: "SHA512" },
            ]}
          />
          <input
            type="number"
            value={addForm.digits}
            onChange={(e) =>
              setAddForm((f) => ({ ...f, digits: Number(e.target.value) }))
            }
            min={6}
            max={8}
            className="sor-form-input-xs"
          />
          <input
            type="number"
            value={addForm.period}
            onChange={(e) =>
              setAddForm((f) => ({ ...f, period: Number(e.target.value) }))
            }
            min={15}
            max={60}
            className="sor-form-input-xs"
          />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={addForm.touch}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, touch: e.target.checked }))
              }
              className="rounded"
            />
            <Fingerprint className="w-3 h-3" />
            {t("yubikey.oath.touchRequired", "Require Touch")}
          </label>
          <button
            onClick={() => {
              mgr.oathAddAccount(
                serial,
                addForm.issuer,
                addForm.name,
                addForm.secret,
                addForm.type as never,
                addForm.algorithm as never,
                addForm.digits,
                addForm.period,
                addForm.touch,
              );
              setAddForm({
                issuer: "",
                name: "",
                secret: "",
                type: "TOTP",
                algorithm: "SHA1",
                digits: 6,
                period: 30,
                touch: false,
              });
            }}
            disabled={!addForm.name || !addForm.secret || mgr.loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="w-3 h-3" />
            {t("yubikey.oath.add", "Add")}
          </button>
        </div>
      </div>

      {/* OATH Password */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-medium">
          {t("yubikey.oath.password", "OATH Applet Password")}
        </h3>
        <div className="flex gap-2 items-center">
          <PasswordInput
            value={oathPw}
            onChange={(e) => setOathPw(e.target.value)}
            placeholder={t("yubikey.oath.passwordPlaceholder", "Password")}
            className="flex-1"
          />
          <button
            onClick={() => {
              mgr.oathSetPassword(serial, oathPw);
              setOathPw("");
            }}
            disabled={!oathPw || mgr.loading}
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {t("yubikey.oath.setPassword", "Set")}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="border border-error/20 rounded-lg p-3">
        <h4 className="text-xs text-error font-medium mb-2">
          {t("yubikey.dangerZone", "Danger Zone")}
        </h4>
        <DangerConfirm
          label={t("yubikey.oath.reset", "Reset OATH Applet")}
          onConfirm={() => mgr.oathReset(serial)}
          disabled={mgr.loading}
        />
      </div>
    </div>
  );
};

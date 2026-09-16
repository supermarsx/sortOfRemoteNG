import React, { useId } from "react";
import {
  LogIn,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Info,
  ShieldOff,
} from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "../../ui/overlays/Modal";
import { DialogHeader } from "../../ui/overlays/DialogHeader";
import { PasswordInput } from "../../ui/forms/PasswordInput";
import { TextInput } from "../../ui/forms/TextInput";
import type { Mgr, SubProps } from "./types";
import SynologyInitializationStatus from "./SynologyInitializationStatus";
import SynologyApiFailure from "./SynologyApiFailure";
import {
  acceptsSynologyOtp,
  SYNOLOGY_API_SIGNIN_FALLBACK,
  SYNOLOGY_AUTH_METHOD_LABELS,
} from "../../../hooks/synology/useSynologyFileConnection";

const inputClass = "sor-form-input text-sm";
const challengeTitles = {
  otp_required: "Two-factor authentication",
  otp_invalid: "Two-factor authentication",
  otp_enrollment_required: "Two-factor setup required",
  unsupported_mfa: "Sign-in method not supported",
};
const ConnectionForm: React.FC<
  SubProps & { runtimeVerified?: boolean; isActive?: boolean }
> = ({ mgr, runtimeVerified = false, isActive = true }) => {
  const id = useId();
  const connecting = mgr.connectionStatus === "connecting";
  const disabled = connecting || !!mgr.challenge;
  const acceptsCode = acceptsSynologyOtp(mgr.challenge);
  const methods =
    mgr.challenge?.status === "otp_required" ||
    mgr.challenge?.status === "unsupported_mfa"
      ? mgr.challenge.methods
      : undefined;
  // Managers built without trusted-device support render no trust controls.
  const trust: Partial<Mgr["deviceTrust"]> = mgr.deviceTrust ?? {};
  const trustNotice = trust.notice && (
    <p
      role="status"
      className="flex items-start gap-2 break-words text-sm text-[var(--color-textSecondary)]"
      data-testid="synology-device-trust-notice"
    >
      <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      {trust.notice}
    </p>
  );
  return (
    <>
      {mgr.targetLocked && connecting && !mgr.challenge ? (
        <div className="flex flex-1 min-h-0 items-center justify-center overflow-auto p-6">
          <SynologyInitializationStatus
            isActive={isActive}
            phase="signin"
            completed={[
              ...(runtimeVerified ? ["Desktop capabilities verified"] : []),
            ]}
            onCancel={mgr.cancelChallenge}
          />
        </div>
      ) : mgr.targetLocked ? (
        <div className="flex flex-1 min-h-0 items-center justify-center overflow-auto p-6">
          <section
            className="w-full max-w-lg space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
            role={mgr.connectionError ? "alert" : "status"}
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="text-warning" size={24} />
              <div>
                <p className="text-xs text-[var(--color-textSecondary)]">
                  Synology NAS API
                </p>
                <h2 className="text-lg font-semibold">
                  {mgr.challenge
                    ? "Authentication requires your attention"
                    : "NAS connection unavailable"}
                </h2>
              </div>
            </div>
            {mgr.connectionError ? (
              <SynologyApiFailure error={mgr.connectionError} alert={false} />
            ) : (
              <p className="break-words text-sm text-[var(--color-textSecondary)]">
                {mgr.challenge?.message ?? "The NAS session is disconnected."}
              </p>
            )}
            {!mgr.challenge && trustNotice}
            <div className="flex flex-wrap justify-end gap-2">
              {trust.remembered && (
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={!!mgr.challenge || trust.forgetting}
                  onClick={() => void trust.forget?.()}
                >
                  <ShieldOff size={14} />
                  {trust.forgetting ? "Forgetting…" : "Forget trusted device"}
                </button>
              )}
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={!!mgr.challenge}
                onClick={() => void mgr.connect()}
              >
                <RefreshCw size={14} />
                Retry
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-8">
          <form
            className="mx-auto w-full max-w-md space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void mgr.connect();
            }}
          >
            <div className="mb-6 text-center">
              <LogIn className="mx-auto mb-3 h-8 w-8 text-[var(--color-primary)]" />
              <h2 className="text-xl font-semibold">Connect to Synology NAS</h2>
              <p className="mt-1 text-sm text-[var(--color-textSecondary)]">
                Use File Station and supported NAS administration tools with
                your DSM account. A one-time code will be requested if the NAS
                requires it.
              </p>
            </div>
            {mgr.connectionError && !mgr.challenge && (
              <SynologyApiFailure error={mgr.connectionError} />
            )}
            <div className="flex gap-3">
              <label
                className="min-w-0 flex-1 space-y-1 text-xs"
                htmlFor={`${id}-host`}
              >
                Host
                <input
                  id={`${id}-host`}
                  className={inputClass}
                  placeholder="nas.example.com"
                  autoComplete="off"
                  value={mgr.host}
                  onChange={(e) => mgr.setHost(e.target.value)}
                  disabled={disabled || mgr.targetLocked}
                />
              </label>
              <label
                className="w-24 shrink-0 space-y-1 text-xs"
                htmlFor={`${id}-port`}
              >
                Port
                <input
                  id={`${id}-port`}
                  type="number"
                  min={1}
                  max={65535}
                  className={inputClass}
                  value={mgr.port || ""}
                  onChange={(e) => mgr.setPort(Number(e.target.value))}
                  disabled={disabled || mgr.targetLocked}
                />
              </label>
            </div>
            <label className="block space-y-1 text-xs" htmlFor={`${id}-user`}>
              Username
              <TextInput
                id={`${id}-user`}
                autoComplete="username"
                className={inputClass}
                value={mgr.username}
                onChange={mgr.setUsername}
                disabled={disabled || mgr.credentialsLocked}
              />
            </label>
            <div className="space-y-1 text-xs">
              <label className="block" htmlFor={`${id}-password`}>
                Password
              </label>
              <PasswordInput
                id={`${id}-password`}
                autoComplete="current-password"
                className={inputClass}
                value={mgr.password}
                onChange={(e) => mgr.setPassword(e.target.value)}
                disabled={disabled || mgr.credentialsLocked}
                revealable={
                  disabled || mgr.credentialsLocked ? false : undefined
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={mgr.useHttps}
                onChange={(e) => mgr.setUseHttps(e.target.checked)}
                disabled={disabled || mgr.targetLocked}
              />
              HTTPS
            </label>
            <p
              className={`text-xs ${mgr.useHttps ? "text-[var(--color-textSecondary)]" : "text-warning"}`}
            >
              {mgr.useHttps
                ? "HTTPS verifies the NAS certificate. Use its certificate hostname and a trusted certificate chain; certificate errors are never bypassed. The usual HTTPS port is 5001."
                : "HTTP sends your password and one-time code without TLS encryption. Use HTTPS whenever possible. Changing this option does not change the port."}
            </p>
            <button
              type="submit"
              className="sor-btn sor-btn-primary w-full justify-center"
              disabled={
                disabled ||
                !mgr.host.trim() ||
                (!mgr.credentialsLocked &&
                  (!mgr.username.trim() || !mgr.password))
              }
            >
              <LogIn className="h-4 w-4" />
              {connecting ? "Connecting…" : "Connect"}
            </button>
            {connecting && !mgr.challenge && (
              <SynologyInitializationStatus
                isActive={isActive}
                phase="signin"
                onCancel={mgr.cancelChallenge}
                compact
              />
            )}
            <p className="text-xs text-[var(--color-textSecondary)]">
              Credentials are used for this session, not saved by this form. The
              NAS API accepts DSM one-time codes from an authenticator app or
              Synology Secure SignIn. {SYNOLOGY_API_SIGNIN_FALLBACK}
            </p>
          </form>
        </div>
      )}
      <Modal
        isOpen={!!mgr.challenge}
        ariaLabel="Synology two-factor authentication"
        onClose={mgr.cancelChallenge}
        panelClassName="max-w-md max-h-[calc(100dvh-2rem)] overflow-hidden"
        contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
      >
        <DialogHeader
          title={
            mgr.challenge
              ? challengeTitles[mgr.challenge.status]
              : "Two-factor authentication"
          }
          icon={ShieldCheck}
          variant="compact"
          onClose={mgr.cancelChallenge}
        />
        <ModalBody className="min-h-0 overflow-y-auto space-y-4 p-5">
          <p className="text-sm break-words">{mgr.challenge?.message}</p>
          {acceptsCode && mgr.automaticCode && (
            <p
              role="status"
              className="flex items-start gap-2 break-words text-sm text-warning"
              data-testid="synology-automatic-code-notice"
            >
              <AlertCircle
                size={14}
                className="mt-0.5 shrink-0"
                aria-hidden="true"
              />
              {mgr.automaticCode.message}
            </p>
          )}
          {trustNotice}
          {methods && (
            <p
              className="text-xs text-[var(--color-textSecondary)]"
              data-testid="synology-auth-methods"
            >
              Sign-in methods DSM reported for this account:{" "}
              {methods
                .map((method) => SYNOLOGY_AUTH_METHOD_LABELS[method])
                .join(", ")}
            </p>
          )}
          {connecting && acceptsCode && (
            <SynologyInitializationStatus
              isActive={isActive}
              phase="verification"
              completed={["DSM requested a one-time code"]}
              compact
            />
          )}
          {mgr.challenge?.status === "otp_enrollment_required" ? (
            <p className="text-sm text-[var(--color-textSecondary)]">
              No one-time code can finish this sign-in until setup is complete.
              Nothing was retried automatically.
            </p>
          ) : !acceptsCode ? (
            <p className="text-sm text-[var(--color-textSecondary)]">
              Approving a sign-in in a browser does not authorize this NAS API
              session. Nothing was retried automatically.
            </p>
          ) : (
            <>
              <label htmlFor={`${id}-otp`} className="block space-y-1 text-sm">
                One-time code
                <TextInput
                  id={`${id}-otp`}
                  className={inputClass}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="123456"
                  value={mgr.otpCode}
                  onChange={mgr.setOtpCode}
                  disabled={connecting}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void mgr.submitOtp();
                    }
                  }}
                />
              </label>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Enter the current code from the authenticator enrolled with DSM.
                The code is cleared after every attempt.
              </p>
              {(trust.available || trust.unavailableReason) && (
                <div className="space-y-1">
                  <label
                    htmlFor={`${id}-trust`}
                    className="flex items-start gap-2 text-sm"
                  >
                    <input
                      id={`${id}-trust`}
                      type="checkbox"
                      className="mt-0.5"
                      checked={!!(trust.available && trust.enabled)}
                      disabled={connecting || !trust.available}
                      aria-describedby={`${id}-trust-help`}
                      onChange={(e) => trust.setEnabled?.(e.target.checked)}
                    />
                    Trust this device for this NAS account
                  </label>
                  <p
                    id={`${id}-trust-help`}
                    className="pl-6 text-xs text-[var(--color-textSecondary)]"
                  >
                    {trust.available
                      ? "After this code is accepted, DSM remembers this computer, so later sign-ins from it skip the code. The device token is kept in this connection's vault entry, never in the connection itself, and you can forget it at any time."
                      : trust.unavailableReason}
                  </p>
                </div>
              )}
            </>
          )}
          {mgr.connectionError && (
            <SynologyApiFailure error={mgr.connectionError} />
          )}
        </ModalBody>
        <ModalFooter className="shrink-0 gap-2 px-5 py-3">
          <button
            className="sor-btn sor-btn-secondary"
            onClick={mgr.cancelChallenge}
          >
            {acceptsCode ? "Cancel sign-in" : "Dismiss"}
          </button>
          {acceptsCode && (
            <button
              className="sor-btn sor-btn-primary"
              disabled={connecting || !/^[0-9]{6,8}$/.test(mgr.otpCode.trim())}
              onClick={() => void mgr.submitOtp()}
            >
              {connecting ? "Verifying…" : "Verify code"}
            </button>
          )}
        </ModalFooter>
      </Modal>
    </>
  );
};
export default ConnectionForm;

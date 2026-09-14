import React, { useId } from "react";
import { LogIn, ShieldCheck, AlertCircle, RefreshCw } from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "../../ui/overlays/Modal";
import { DialogHeader } from "../../ui/overlays/DialogHeader";
import type { SubProps } from "./types";
import SynologyInitializationStatus from "./SynologyInitializationStatus";
import SynologyApiFailure from "./SynologyApiFailure";

const inputClass =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-3 py-2 text-sm text-[var(--color-text)]";
const ConnectionForm: React.FC<
  SubProps & { runtimeVerified?: boolean; isActive?: boolean }
> = ({ mgr, runtimeVerified = false, isActive = true }) => {
  const id = useId();
  const connecting = mgr.connectionStatus === "connecting";
  const disabled = connecting || !!mgr.challenge;
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
            <div className="flex justify-end">
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
              <input
                id={`${id}-user`}
                autoComplete="username"
                className={inputClass}
                value={mgr.username}
                onChange={(e) => mgr.setUsername(e.target.value)}
                disabled={disabled || mgr.credentialsLocked}
              />
            </label>
            <label
              className="block space-y-1 text-xs"
              htmlFor={`${id}-password`}
            >
              Password
              <input
                id={`${id}-password`}
                type="password"
                autoComplete="current-password"
                className={inputClass}
                value={mgr.password}
                onChange={(e) => mgr.setPassword(e.target.value)}
                disabled={disabled || mgr.credentialsLocked}
              />
            </label>
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
              Credentials are used for this session, not saved by this form. API
              login supports DSM one-time codes; Approve sign-in and
              security-key prompts require the DSM website.
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
          title="Two-factor authentication"
          icon={ShieldCheck}
          variant="compact"
          onClose={mgr.cancelChallenge}
        />
        <ModalBody className="min-h-0 overflow-y-auto space-y-4 p-5">
          <p className="text-sm break-words">{mgr.challenge?.message}</p>
          {connecting && (
            <SynologyInitializationStatus
              isActive={isActive}
              phase="verification"
              completed={["DSM requested a one-time code"]}
              compact
            />
          )}
          {mgr.challenge?.status === "unsupported_mfa" ? (
            <p className="text-sm text-[var(--color-textSecondary)]">
              This NAS login requires a method the File Station API cannot
              complete here. Sign in to DSM in your browser to review available
              one-time-code methods. Browser approval does not authenticate this
              API session.
            </p>
          ) : (
            <>
              <label htmlFor={`${id}-otp`} className="block space-y-1 text-sm">
                One-time code
                <input
                  id={`${id}-otp`}
                  className={inputClass}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="123456"
                  value={mgr.otpCode}
                  onChange={(e) => mgr.setOtpCode(e.target.value)}
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
                The code is cleared after every attempt. This does not remember
                a device or bypass future 2FA.
              </p>
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
            Cancel sign-in
          </button>
          {mgr.challenge?.status !== "unsupported_mfa" && (
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

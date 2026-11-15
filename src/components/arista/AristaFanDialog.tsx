import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import Modal, { ModalHeader } from "../ui/overlays/Modal";
import AristaFanPanel from "./AristaFanPanel";
import { closeAristaFans, useAristaFansTarget } from "./aristaLauncher";
import type { Connection } from "../../types/connection/connection";
import type { AristaConfig } from "../../types/hardware/arista";

function AristaFanDialogBody({ connection }: { connection: Connection }) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(connection.username ?? "");
  const [password, setPassword] = useState(connection.password ?? "");
  const [port, setPort] = useState("");
  // Credentials live only in this component's state and are passed per call.
  const [config, setConfig] = useState<AristaConfig | null>(null);
  const title = t("arista.title", "Arista fan speeds");
  const verifyOff = connection.httpVerifySsl === false;

  const start = () => {
    const parsedPort = Number.parseInt(port, 10);
    setConfig({
      host: connection.hostname,
      port:
        Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : undefined,
      username,
      password,
      useHttps: true,
      insecureTls: verifyOff,
    });
  };

  return (
    <Modal
      isOpen
      onClose={closeAristaFans}
      panelClassName="max-w-3xl mx-4"
      dataTestId="arista-fan-dialog"
      ariaLabel={title}
    >
      <div className="bg-[var(--color-surface)] rounded-lg shadow-xl w-full relative">
        <ModalHeader
          onClose={closeAristaFans}
          title={`${title} - ${connection.name || connection.hostname}`}
        />
        {config ? (
          <>
            <AristaFanPanel config={config} />
            <div className="px-4 pb-4">
              <button
                type="button"
                className="px-3 py-1 rounded border"
                onClick={() => setConfig(null)}
              >
                {t("arista.changeCredentials", "Change credentials")}
              </button>
            </div>
          </>
        ) : (
          <form
            className="p-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <div className="text-sm opacity-80">
              {t(
                "arista.eapiHint",
                "Reads fan speeds over the switch's HTTPS eAPI. Credentials are used for this request only and are not saved.",
              )}
            </div>
            <label className="block text-sm">
              {t("arista.username", "Username")}
              <input
                className="sor-form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block text-sm">
              {t("arista.password", "Password")}
              <input
                className="sor-form-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block text-sm">
              {t("arista.eapiPort", "eAPI port (optional, default 443)")}
              <input
                className="sor-form-input"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="px-3 py-1 rounded border"
              disabled={!username}
            >
              {t("arista.readFans", "Read fan speeds")}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}

const AristaFanDialog: React.FC = () => {
  const target = useAristaFansTarget();
  if (!target) return null;
  return <AristaFanDialogBody key={target.id} connection={target} />;
};

export default AristaFanDialog;

import StatusBadge from "./StatusBadge";
import ErrorMsg from "./ErrorMsg";
import LoadingSpinner from "./LoadingSpinner";

const SettingsTab: React.FC<{ wa: ReturnType<typeof useWhatsApp> }> = ({
  wa,
}) => {
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [apiVersion, setApiVersion] = useState("v21.0");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState("");
  const [appSecret, setAppSecret] = useState("");

  const handleSave = async () => {
    const config: WaConfig = {
      accessToken,
      phoneNumberId,
      businessAccountId,
      apiVersion,
      webhookVerifyToken: webhookVerifyToken || undefined,
      appSecret: appSecret || undefined,
    };
    await wa.configure.execute(config);
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Settings size={16} />
        <span>WhatsApp Cloud API Configuration</span>
      </h3>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-[var(--color-textSecondary)]">Access Token</span>
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className="sor-input mt-1 w-full"
            placeholder="EAAx..."
          />
        </label>

        <label className="block">
          <span className="text-xs text-[var(--color-textSecondary)]">Phone Number ID</span>
          <input
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            className="sor-input mt-1 w-full"
            placeholder="1234567890"
          />
        </label>

        <label className="block">
          <span className="text-xs text-[var(--color-textSecondary)]">Business Account ID</span>
          <input
            value={businessAccountId}
            onChange={(e) => setBusinessAccountId(e.target.value)}
            className="sor-input mt-1 w-full"
            placeholder="1234567890"
          />
        </label>

        <label className="block">
          <span className="text-xs text-[var(--color-textSecondary)]">API Version</span>
          <input
            value={apiVersion}
            onChange={(e) => setApiVersion(e.target.value)}
            className="sor-input mt-1 w-full"
          />
        </label>

        <label className="block">
          <span className="text-xs text-[var(--color-textSecondary)]">Webhook Verify Token (optional)</span>
          <input
            value={webhookVerifyToken}
            onChange={(e) => setWebhookVerifyToken(e.target.value)}
            className="sor-input mt-1 w-full"
          />
        </label>

        <label className="block">
          <span className="text-xs text-[var(--color-textSecondary)]">App Secret (optional)</span>
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            className="sor-input mt-1 w-full"
          />
        </label>
      </div>

      <div className="flex space-x-3">
        <button
          onClick={handleSave}
          disabled={wa.configure.loading || !accessToken || !phoneNumberId || !businessAccountId}
          className="sor-btn-primary flex items-center space-x-2"
        >
          {wa.configure.loading ? <LoadingSpinner /> : <CheckCircle size={14} />}
          <span>Save Configuration</span>
        </button>
      </div>

      <ErrorMsg msg={wa.configure.error} />

      {wa.configured && (
        <div className="flex items-center space-x-2 text-green-400 text-sm">
          <CheckCircle size={14} />
          <span>Cloud API configured</span>
        </div>
      )}

      <hr className="border-[var(--color-border)]" />

      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Smartphone size={16} />
        <span>Active Sessions</span>
      </h3>

      <div className="space-y-2">
        {wa.sessions.length === 0 && (
          <p className="text-xs text-[var(--color-textSecondary)]">No active sessions.</p>
        )}
        {wa.sessions.map((s) => (
          <div
            key={s.sessionId}
            className="flex items-center justify-between p-2 bg-[var(--color-border)] rounded text-sm"
          >
            <div className="flex items-center space-x-2">
              <StatusBadge state={s.state} />
              <span className="text-[var(--color-text)]">
                {s.phoneDisplay ?? s.phoneNumberId}
              </span>
            </div>
            <span className="text-[var(--color-textSecondary)] text-xs">
              ↑{s.messagesSent} ↓{s.messagesReceived}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SettingsTab;

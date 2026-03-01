import ErrorMsg from "./ErrorMsg";
import LoadingSpinner from "./LoadingSpinner";

const PairingTab: React.FC<{ wa: ReturnType<typeof useWhatsApp> }> = ({
  wa,
}) => {
  const [qrData, setQrData] = useState<QrCodeData | null>(null);
  const [currentPairingState, setCurrentPairingState] = useState<PairingState | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode] = useState("");

  const handleStartQr = async () => {
    const data = await wa.pairingStartQr.execute();
    if (data) setQrData(data);
  };

  const handleRefreshQr = async () => {
    const data = await wa.pairingRefreshQr.execute();
    if (data) setQrData(data);
  };

  const handleStartPhone = async () => {
    const code = await wa.pairingStartPhone.execute(phoneInput);
    if (code) setPhoneCode(code);
  };

  const handleCheckState = async () => {
    const s = await wa.pairingState.execute();
    if (s) setCurrentPairingState(s);
  };

  const handleCancel = async () => {
    await wa.pairingCancel.execute();
    setQrData(null);
    setCurrentPairingState(null);
  };

  // Unofficial connection
  const handleConnect = async () => {
    await wa.unofficialConnect.execute();
  };

  const handleDisconnect = async () => {
    await wa.unofficialDisconnect.execute();
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <QrCode size={16} />
        <span>QR Code Pairing</span>
      </h3>

      <div className="flex flex-wrap gap-2">
        <button onClick={handleStartQr} className="sor-btn flex items-center space-x-1">
          {wa.pairingStartQr.loading ? <LoadingSpinner /> : <QrCode size={14} />}
          <span>Start QR</span>
        </button>
        <button onClick={handleRefreshQr} className="sor-btn flex items-center space-x-1">
          {wa.pairingRefreshQr.loading ? <LoadingSpinner /> : <RefreshCw size={14} />}
          <span>Refresh QR</span>
        </button>
        <button onClick={handleCheckState} className="sor-btn flex items-center space-x-1">
          <CheckCircle size={14} />
          <span>Check State</span>
        </button>
        <button onClick={handleCancel} className="sor-btn flex items-center space-x-1 text-red-400">
          <X size={14} />
          <span>Cancel</span>
        </button>
      </div>

      <ErrorMsg msg={wa.pairingStartQr.error ?? wa.pairingRefreshQr.error} />

      {qrData && (
        <div className="p-4 bg-white rounded-lg inline-block">
          <div className="text-center text-xs text-[var(--color-textMuted)] mb-2">
            Scan with WhatsApp
          </div>
          <div className="text-center font-mono text-xs break-all text-[var(--color-textMuted)] max-w-[200px]">
            {qrData.qrString.substring(0, 60)}...
          </div>
        </div>
      )}

      {currentPairingState && (
        <div className="text-sm text-[var(--color-textSecondary)]">
          Pairing state: <span className="font-medium text-[var(--color-text)]">{currentPairingState}</span>
        </div>
      )}

      <hr className="border-[var(--color-border)]" />

      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Phone size={16} />
        <span>Phone Number Pairing</span>
      </h3>

      <div className="flex space-x-2">
        <input
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          className="sor-input flex-1"
          placeholder="+1234567890"
        />
        <button
          onClick={handleStartPhone}
          disabled={wa.pairingStartPhone.loading || !phoneInput}
          className="sor-btn-primary px-3"
        >
          {wa.pairingStartPhone.loading ? <LoadingSpinner /> : <Phone size={14} />}
        </button>
      </div>

      <ErrorMsg msg={wa.pairingStartPhone.error} />

      {phoneCode && (
        <div className="text-sm text-[var(--color-textSecondary)]">
          Pairing code: <span className="font-mono text-green-400">{phoneCode}</span>
        </div>
      )}

      <hr className="border-[var(--color-border)]" />

      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Smartphone size={16} />
        <span>Unofficial (WA Web) Connection</span>
      </h3>

      <div className="flex flex-wrap gap-2">
        <button onClick={handleConnect} className="sor-btn flex items-center space-x-1">
          {wa.unofficialConnect.loading ? <LoadingSpinner /> : <CheckCircle size={14} />}
          <span>Connect</span>
        </button>
        <button onClick={handleDisconnect} className="sor-btn flex items-center space-x-1 text-red-400">
          {wa.unofficialDisconnect.loading ? <LoadingSpinner /> : <X size={14} />}
          <span>Disconnect</span>
        </button>
      </div>

      <ErrorMsg msg={wa.unofficialConnect.error ?? wa.unofficialDisconnect.error} />
    </div>
  );
};

export default PairingTab;

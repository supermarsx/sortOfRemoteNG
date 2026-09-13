import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { loadRuntimeCapabilities } from "../../utils/runtime/runtimeCapabilities";

const YubiKeyManager = dynamic(
  () =>
    import("../ssh/yubiKey/YubiKeyManager").then(
      (module) => module.YubiKeyManager,
    ),
  { ssr: false },
);

/** Device management is independent of database unlock; native support is not. */
export default function HardwareKeysTab() {
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<
    "checking" | "ready" | "unsupported" | "failed"
  >("checking");
  useEffect(() => {
    let current = true;
    void loadRuntimeCapabilities().then(
      (capabilities) => {
        if (current)
          setStatus(
            capabilities.source === "native" && capabilities.ops
              ? "ready"
              : "unsupported",
          );
      },
      () => {
        if (current) setStatus("failed");
      },
    );
    return () => {
      current = false;
    };
  }, [retry]);
  if (status === "ready")
    return <YubiKeyManager isOpen embedded onClose={() => {}} />;
  return (
    <section className="p-6 text-sm space-y-3" aria-label="Hardware keys">
      <h2 className="font-semibold">Hardware Keys</h2>
      <p role={status === "checking" ? "status" : "alert"}>
        {status === "checking"
          ? "Checking desktop hardware-key support…"
          : status === "unsupported"
            ? "YubiKey management requires the full desktop build and YubiKey Manager (ykman). PIN and touch requirements remain enforced by the device."
            : "Unable to check desktop hardware-key support. Try again or restart the desktop app."}
      </p>
      {status !== "checking" && (
        <button
          type="button"
          className="sor-btn-secondary-sm"
          onClick={() => {
            setStatus("checking");
            setRetry((value) => value + 1);
          }}
        >
          Retry hardware support check
        </button>
      )}
    </section>
  );
}

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../ui/forms";
import {
  isBrowserProtocol,
  type BrowserProtocol,
} from "../../utils/connection/browserConnectionType";

export function BrowserProtocolSelect({
  value,
  onChange,
}: {
  value: BrowserProtocol;
  onChange: (value: BrowserProtocol) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const label = t("connectionEditor.protocol", "Protocol");
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-[var(--color-textSecondary)]"
      >
        {label}
      </label>
      <Select
        id={id}
        label={label}
        value={value}
        onChange={(next) => {
          if (isBrowserProtocol(next)) onChange(next);
        }}
        data-testid="editor-browser-protocol"
        variant="form-sm"
        className="w-full"
        options={[
          {
            value: "https",
            label: t("connectionEditor.browserHttps", "HTTPS (secure)"),
          },
          {
            value: "http",
            label: t("connectionEditor.browserHttp", "HTTP (not secure)"),
          },
        ]}
      />
    </div>
  );
}

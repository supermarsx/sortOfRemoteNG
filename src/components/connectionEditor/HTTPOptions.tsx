import React from "react";
import { isSynologyFileConnection } from "../../types/protocols/synology";
import { useHTTPOptions } from "../../hooks/connection/useHTTPOptions";
import { HTTPOptionsProps } from "./httpOptions/types";
import AuthTypeSection from "./httpOptions/AuthTypeSection";
import BasicAuthFields from "./httpOptions/BasicAuthFields";
import AutoLoginSection from "./httpOptions/AutoLoginSection";
import TlsVerifySection from "./httpOptions/TlsVerifySection";
import TrustPolicySection from "./httpOptions/TrustPolicySection";
import CustomHeadersSection from "./httpOptions/CustomHeadersSection";
import { ConnectionFavoritesSection } from "./ConnectionFavoritesSection";
import HeaderModal from "./httpOptions/HeaderModal";
import ApplicationSection from "./httpOptions/ApplicationSection";
import SynologyOptions from "./SynologyOptions";
import { SessionQuickActionsSection } from "./SessionQuickActionsSection";
import ProxyPolicySection from "./httpOptions/ProxyPolicySection";
import FormAutomationSection from "./httpOptions/FormAutomationSection";
import BrowserSessionSection from "./httpOptions/BrowserSessionSection";

export const HTTPOptions: React.FC<HTTPOptionsProps> = ({
  formData,
  setFormData,
  sections,
  retentionCapabilities,
  credentialSourceManaged = false,
}) => {
  const mgr = useHTTPOptions(formData, setFormData);
  const shows = (section: NonNullable<HTTPOptionsProps["sections"]>[number]) =>
    !sections || sections.includes(section);

  if (formData.isGroup || !mgr.isHttpProtocol) return null;

  return (
    <>
      {shows("application") && (
        <ApplicationSection mgr={mgr} view="application" />
      )}
      {shows("application") &&
        formData.httpApplication?.id === "synology-dsm" && (
          <SynologyOptions
            section="connection"
            formData={formData}
            setFormData={setFormData}
          />
        )}
      {shows("authentication") &&
        (formData.httpApplication !== undefined ? (
          <>
            <ApplicationSection
              mgr={mgr}
              view="authentication"
              showCredentialSource={!credentialSourceManaged}
            />
            {isSynologyFileConnection(formData) && (
              <SynologyOptions
                section="authentication"
                formData={formData}
                setFormData={setFormData}
              />
            )}
          </>
        ) : (
          <>
            <AuthTypeSection mgr={mgr} />
            <BasicAuthFields mgr={mgr} />
            <CustomHeadersSection mgr={mgr} />
            <HeaderModal mgr={mgr} />
            <AutoLoginSection mgr={mgr} />
          </>
        ))}
      {shows("security") && (
        <>
          <TlsVerifySection mgr={mgr} />
          <TrustPolicySection mgr={mgr} />
        </>
      )}
      {shows("advanced") && (
        <>
          <ProxyPolicySection mgr={mgr} />
          <BrowserSessionSection
            mgr={mgr}
            retentionCapabilities={retentionCapabilities}
          />
          <FormAutomationSection mgr={mgr} />
          <SessionQuickActionsSection
            protocol="http"
            view="permissions"
            formData={formData}
            setFormData={setFormData}
          />
        </>
      )}
      {!sections && (
        <ConnectionFavoritesSection
          formData={formData}
          setFormData={setFormData}
        />
      )}
    </>
  );
};

export default HTTPOptions;

/** Inline nickname edit button for trust record rows */

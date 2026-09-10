import React from "react";
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

export const HTTPOptions: React.FC<HTTPOptionsProps> = ({
  formData,
  setFormData,
  sections,
}) => {
  const mgr = useHTTPOptions(formData, setFormData);
  const shows = (section: NonNullable<HTTPOptionsProps["sections"]>[number]) =>
    !sections || sections.includes(section);

  if (formData.isGroup || !mgr.isHttpProtocol) return null;

  return (
    <>
      {shows("application") && <ApplicationSection mgr={mgr} />}
      {shows("application") &&
        formData.httpApplication?.id === "synology-dsm" && (
          <SynologyOptions formData={formData} setFormData={setFormData} />
        )}
      {shows("authentication") &&
        (formData.httpApplication !== undefined ? (
          <p className="text-sm text-[var(--color-textSecondary)]">
            This website profile uses the login mode and credentials in the
            Application subtab. TLS and trust remain in Security.
          </p>
        ) : (
          <>
            <AuthTypeSection mgr={mgr} />
            <BasicAuthFields mgr={mgr} />
            <CustomHeadersSection mgr={mgr} />
            <HeaderModal mgr={mgr} />
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
          <SessionQuickActionsSection
            protocol="http"
            view="permissions"
            formData={formData}
            setFormData={setFormData}
          />
          {formData.httpApplication === undefined && (
            <AutoLoginSection mgr={mgr} />
          )}
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

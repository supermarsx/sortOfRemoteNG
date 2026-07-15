import React from "react";
import { useHTTPOptions } from "../../hooks/connection/useHTTPOptions";
import { HTTPOptionsProps } from "./httpOptions/types";
import AuthTypeSection from "./httpOptions/AuthTypeSection";
import BasicAuthFields from "./httpOptions/BasicAuthFields";
import AutoLoginSection from "./httpOptions/AutoLoginSection";
import TlsVerifySection from "./httpOptions/TlsVerifySection";
import TrustPolicySection from "./httpOptions/TrustPolicySection";
import CustomHeadersSection from "./httpOptions/CustomHeadersSection";
import BookmarksSection from "./httpOptions/BookmarksSection";
import BookmarkModal from "./httpOptions/BookmarkModal";
import HeaderModal from "./httpOptions/HeaderModal";

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
      {shows("authentication") && (
        <>
          <AuthTypeSection mgr={mgr} />
          <BasicAuthFields mgr={mgr} />
          <CustomHeadersSection mgr={mgr} />
          <HeaderModal mgr={mgr} />
        </>
      )}
      {shows("security") && (
        <>
          <TlsVerifySection mgr={mgr} />
          <TrustPolicySection mgr={mgr} />
        </>
      )}
      {shows("advanced") && (
        <>
          <AutoLoginSection mgr={mgr} />
          <BookmarksSection mgr={mgr} />
          <BookmarkModal mgr={mgr} />
        </>
      )}
    </>
  );
};

export default HTTPOptions;

/** Inline nickname edit button for trust record rows */

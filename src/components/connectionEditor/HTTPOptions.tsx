import { HTTPOptionsProps } from "./httpOptions/types";
import AuthTypeSection from "./httpOptions/AuthTypeSection";
import BasicAuthFields from "./httpOptions/BasicAuthFields";
import TlsVerifySection from "./httpOptions/TlsVerifySection";
import TrustPolicySection from "./httpOptions/TrustPolicySection";
import CustomHeadersSection from "./httpOptions/CustomHeadersSection";
import BookmarksSection from "./httpOptions/BookmarksSection";
import BookmarkModal from "./httpOptions/BookmarkModal";
import HeaderModal from "./httpOptions/HeaderModal";
import NicknameEditButton from "./httpOptions/NicknameEditButton";

export const HTTPOptions: React.FC<HTTPOptionsProps> = ({
  formData,
  setFormData,
}) => {
  const mgr = useHTTPOptions(formData, setFormData);

  if (formData.isGroup || !mgr.isHttpProtocol) return null;

  return (
    <>
      <AuthTypeSection mgr={mgr} />
      <BasicAuthFields mgr={mgr} />
      <TlsVerifySection mgr={mgr} />
      <TrustPolicySection mgr={mgr} />
      <CustomHeadersSection mgr={mgr} />
      <BookmarksSection mgr={mgr} />
      <BookmarkModal mgr={mgr} />
      <HeaderModal mgr={mgr} />
    </>
  );
};

/** Inline nickname edit button for trust record rows */

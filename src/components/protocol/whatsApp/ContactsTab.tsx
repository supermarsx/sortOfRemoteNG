import ErrorMsg from "./ErrorMsg";
import LoadingSpinner from "./LoadingSpinner";
import React, { useState } from "react";
import { AlertCircle, Building2, Check, CheckCircle, Link, Phone, PhoneCall, Users } from "lucide-react";

const ContactsTab: React.FC<{ wa: ReturnType<typeof useWhatsApp> }> = ({
  wa,
}) => {
  const [phone, setPhone] = useState("");
  const [checkResult, setCheckResult] = useState<boolean | null>(null);
  const [link, setLink] = useState("");

  const handleCheck = async () => {
    setCheckResult(null);
    const res = await wa.checkContact.execute(phone);
    if (res !== undefined) setCheckResult(res);
  };

  const handleLink = async () => {
    const url = await wa.meLink.execute(phone);
    if (url) setLink(url);
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Users size={16} />
        <span>Contacts</span>
      </h3>

      <label className="block">
        <span className="text-xs text-[var(--color-textSecondary)]">Phone Number (E.164)</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="sor-input mt-1 w-full"
          placeholder="+1234567890"
        />
      </label>

      <div className="flex space-x-2">
        <button
          onClick={handleCheck}
          disabled={wa.checkContact.loading || !phone}
          className="sor-btn flex items-center space-x-1"
        >
          {wa.checkContact.loading ? <LoadingSpinner /> : <Phone size={14} />}
          <span>Check WhatsApp</span>
        </button>
        <button
          onClick={handleLink}
          disabled={!phone}
          className="sor-btn flex items-center space-x-1"
        >
          <Link size={14} />
          <span>wa.me Link</span>
        </button>
      </div>

      <ErrorMsg msg={wa.checkContact.error} />

      {checkResult !== null && (
        <div
          className={`text-sm flex items-center space-x-2 ${
            checkResult ? "text-green-400" : "text-yellow-400"
          }`}
        >
          {checkResult ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          <span>
            {checkResult ? "Number is on WhatsApp" : "Number not found on WhatsApp"}
          </span>
        </div>
      )}

      {link && (
        <div className="text-xs text-[var(--color-textSecondary)] break-all">
          Link: {link}
        </div>
      )}

      <hr className="border-[var(--color-border)]" />

      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Building2 size={16} />
        <span>Business Profile</span>
      </h3>
      <button
        onClick={() => wa.getBusinessProfile.execute()}
        disabled={wa.getBusinessProfile.loading}
        className="sor-btn flex items-center space-x-1"
      >
        {wa.getBusinessProfile.loading ? <LoadingSpinner /> : <Building2 size={14} />}
        <span>Get Profile</span>
      </button>

      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2 mt-3">
        <PhoneCall size={16} />
        <span>Phone Numbers</span>
      </h3>
      <button
        onClick={() => wa.listPhoneNumbers.execute()}
        disabled={wa.listPhoneNumbers.loading}
        className="sor-btn flex items-center space-x-1"
      >
        {wa.listPhoneNumbers.loading ? <LoadingSpinner /> : <PhoneCall size={14} />}
        <span>List Numbers</span>
      </button>
    </div>
  );
};

export default ContactsTab;

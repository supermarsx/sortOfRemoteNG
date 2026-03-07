
import React from "react";
import { AlertCircle } from "lucide-react";
const ErrorMsg: React.FC<{ msg: string | null }> = ({ msg }) =>
  msg ? (
    <div className="flex items-center space-x-2 text-error text-sm mt-2">
      <AlertCircle size={14} />
      <span>{msg}</span>
    </div>
  ) : null;

export default ErrorMsg;

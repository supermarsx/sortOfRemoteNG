import { CheckCircle, XCircle, Loader2 } from "lucide-react";

const StatusIcon = ({
  status,
}: {
  status: "pending" | "success" | "failed";
}) => {
  switch (status) {
    case "pending":
      return (
        <Loader2
          size={16}
          className="text-[var(--color-textMuted)] animate-spin"
        />
      );
    case "success":
      return <CheckCircle size={16} className="text-green-500" />;
    case "failed":
      return <XCircle size={16} className="text-red-500" />;
  }
};

export default StatusIcon;

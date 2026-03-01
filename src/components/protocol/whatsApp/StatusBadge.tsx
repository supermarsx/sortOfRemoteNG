
const StatusBadge: React.FC<{ state: string }> = ({ state }) => {
  const colors: Record<string, string> = {
    active: "bg-green-500",
    tokenExpired: "bg-yellow-500",
    disconnected: "bg-[var(--color-secondary)]",
    error: "bg-red-500",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[state] ?? "bg-[var(--color-secondary)]"}`}
      title={state}
    />
  );
};

export default StatusBadge;

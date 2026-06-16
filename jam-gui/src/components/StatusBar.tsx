import React from "react";

interface StatusBarProps {
  status: "idle" | "joining" | "connected" | "disconnected" | "error";
}

const statusText: Record<string, string> = {
  idle: "Ready",
  joining: "Establishing Connection",
  connected: "Live Session",
  disconnected: "Disconnected — tap Reconnect",
  error: "Connection Failed",
};

const StatusBar = React.memo(function StatusBar({ status }: StatusBarProps) {
  const quality = status === "connected" ? "good" : "poor";

  return (
    <div className="status-indicator">
      <div className={`status-dot status-${status}`} />
      <span className={`status-text status-${status}`}>
        {statusText[status]}
      </span>
      {status === "connected" && (
        <div
          className={`quality-badge quality-${quality}`}
          title="Connection quality"
        >
          ● GOOD
        </div>
      )}
    </div>
  );
});

export default StatusBar;

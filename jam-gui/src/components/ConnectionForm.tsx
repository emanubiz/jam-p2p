import React from "react";

interface ConnectionFormProps {
  server: string;
  room: string;
  status: string;
  onServerChange: (value: string) => void;
  onRoomChange: (value: string) => void;
  onConnect: () => void;
}

const ConnectionForm = React.memo(function ConnectionForm({
  server,
  room,
  status,
  onServerChange,
  onRoomChange,
  onConnect,
}: ConnectionFormProps) {
  const buttonLabel =
    status === "joining"
      ? "Connecting"
      : status === "disconnected"
      ? "Reconnect"
      : "Connect to Session";

  return (
    <div className="connection-form">
      <div className="input-group">
        <label className="input-label">Server Endpoint</label>
        <input
          className="input-field input-mono"
          value={server}
          onChange={(e) => onServerChange(e.target.value)}
          disabled={status === "joining"}
        />
      </div>

      <div className="input-group">
        <label className="input-label">Room ID</label>
        <input
          className="input-field"
          value={room}
          onChange={(e) => onRoomChange(e.target.value)}
          disabled={status === "joining"}
        />
      </div>

      <button
        className={`connect-btn ${status === "joining" ? "connecting" : ""}`}
        onClick={onConnect}
        disabled={status === "joining"}
      >
        {status === "joining" ? (
          <>
            <span className="spinner" />
            Connecting
          </>
        ) : (
          buttonLabel
        )}
      </button>
    </div>
  );
});

export default ConnectionForm;

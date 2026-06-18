import React from "react";

export type AppStatus =
  | "idle"
  | "joining"
  | "connected"
  | "reconnecting"
  | "error";

interface ConnectionFormProps {
  server: string;
  room: string;
  name: string;
  status: AppStatus;
  onServerChange: (value: string) => void;
  onRoomChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onConnect: () => void;
}

const ConnectionForm = React.memo(function ConnectionForm({
  server,
  room,
  name,
  status,
  onServerChange,
  onRoomChange,
  onNameChange,
  onConnect,
}: ConnectionFormProps) {
  const buttonLabel =
    status === "joining" ? "Connecting" : "Connect to Session";

  return (
    <div className="connection-form">
      <div className="input-group">
        <label className="input-label">Display Name</label>
        <input
          className="input-field"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Anonymous"
          maxLength={32}
          disabled={status === "joining"}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

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

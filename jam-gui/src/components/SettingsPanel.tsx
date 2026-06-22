import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./SettingsPanel.css";

interface AudioDeviceEntry {
  name: string;
  is_default: boolean;
}

interface AudioDeviceList {
  inputs: AudioDeviceEntry[];
  outputs: AudioDeviceEntry[];
}

interface SettingsPanelProps {
  bitrate: number;
  isOpen: boolean;
  onBitrateChange: (value: number) => void;
}

const SettingsPanel = React.memo(function SettingsPanel({
  bitrate,
  isOpen,
  onBitrateChange,
}: SettingsPanelProps) {
  const [devices, setDevices] = useState<AudioDeviceList | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    invoke<AudioDeviceList>("list_audio_devices")
      .then(setDevices)
      .catch(() => setDevices(null));
  }, [isOpen]);

  const activeIn =
    devices?.inputs.find((d) => d.is_default)?.name ??
    devices?.inputs[0]?.name;
  const activeOut =
    devices?.outputs.find((d) => d.is_default)?.name ??
    devices?.outputs[0]?.name;

  return (
    <div className={`settings-panel ${isOpen ? "open" : ""}`}>
      <div className="settings-group">
        <label className="settings-label">
          Opus Bitrate
          <span className="settings-value">{bitrate} kbps</span>
        </label>
        <div className="bitrate-control">
          <span className="bitrate-range-label">16</span>
          <input
            type="range"
            className="bitrate-slider"
            min={16}
            max={192}
            step={1}
            value={bitrate}
            onChange={(e) => onBitrateChange(Number(e.target.value))}
          />
          <span className="bitrate-range-label">192</span>
        </div>
      </div>
      {isOpen && devices && (
        <div className="settings-group settings-devices">
          <div className="settings-label">Audio devices (read-only)</div>
          <div className="device-row">
            <span className="device-kind">In</span>
            <span className="device-name">{activeIn ?? "—"}</span>
          </div>
          <div className="device-row">
            <span className="device-kind">Out</span>
            <span className="device-name">{activeOut ?? "—"}</span>
          </div>
          <p className="device-hint">
            Device selection at runtime is planned; restart the app to change the
            system default.
          </p>
        </div>
      )}
    </div>
  );
});

export default SettingsPanel;

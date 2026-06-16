import React from "react";

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
    </div>
  );
});

export default SettingsPanel;

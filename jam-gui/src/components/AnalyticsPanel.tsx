import React from "react";
import type { SessionAnalytics } from "../hooks/useSessionAnalytics";
import "./AnalyticsPanel.css";

interface AnalyticsPanelProps {
  analytics: SessionAnalytics;
  isOpen: boolean;
}

/** Render seconds as H:MM:SS (dropping the hour segment when under an hour). */
function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const AnalyticsPanel = React.memo(function AnalyticsPanel({
  analytics,
  isOpen,
}: AnalyticsPanelProps) {
  const { elapsedSec, participants, peakParticipants, peerJoins, reconnects } =
    analytics;

  return (
    <div className={`analytics-panel ${isOpen ? "open" : ""}`}>
      <div className="analytics-grid">
        <div className="analytics-stat">
          <div className="analytics-value analytics-mono">
            {formatDuration(elapsedSec)}
          </div>
          <div className="analytics-label">Session</div>
        </div>
        <div className="analytics-stat">
          <div className="analytics-value">{participants}</div>
          <div className="analytics-label">Live</div>
        </div>
        <div className="analytics-stat">
          <div className="analytics-value">{peakParticipants}</div>
          <div className="analytics-label">Peak</div>
        </div>
        <div className="analytics-stat">
          <div className="analytics-value">{peerJoins}</div>
          <div className="analytics-label">Joins</div>
        </div>
        <div className="analytics-stat">
          <div
            className={`analytics-value ${
              reconnects > 0 ? "analytics-warn" : ""
            }`}
          >
            {reconnects}
          </div>
          <div className="analytics-label">Reconnects</div>
        </div>
      </div>
    </div>
  );
});

export default AnalyticsPanel;

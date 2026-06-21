import React from "react";
import VuMeter from "./VuMeter";
import "./LocalMicCard.css";

interface LocalMicCardProps {
  level: number;
}

const LocalMicCard = React.memo(function LocalMicCard({
  level,
}: LocalMicCardProps) {
  return (
    <div className="local-mic-card">
      <div className="peer-header">
        <div className="peer-info">
          <div className="peer-avatar local">🎤</div>
          <div className="peer-details">
            <div className="peer-name">Local Mic</div>
            <div className="peer-id">MY INPUT</div>
          </div>
        </div>
      </div>
      <VuMeter level={level} variant="blue" />
      <div className="local-level-label">
        LEVEL: {Math.round(level * 100)}%
      </div>
    </div>
  );
});

export default LocalMicCard;

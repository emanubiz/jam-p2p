import React from "react";
import VuMeter from "./VuMeter";
import { Peer } from "../types";

interface PeerCardProps {
  peer: Peer;
  onVolumeChange: (peerId: string, volume: number) => void;
}

const PeerCard = React.memo(function PeerCard({
  peer,
  onVolumeChange,
}: PeerCardProps) {
  return (
    <div className="peer-card">
      <div className="peer-header">
        <div className="peer-info">
          <div className="peer-avatar">🎵</div>
          <div className="peer-details">
            <div className="peer-name">{peer.name}</div>
            <div className="peer-id">{peer.id.slice(0, 8)}</div>
          </div>
        </div>
      </div>

      <div className="volume-control">
        <div className="volume-label">VOL</div>
        <div className="volume-slider-wrapper">
          <div className="volume-track">
            <div
              className="volume-fill"
              style={{ width: `${peer.volume * 100}%` }}
            />
          </div>
          <input
            type="range"
            className="volume-input"
            min={0}
            max={1}
            step={0.01}
            value={peer.volume}
            onChange={(e) =>
              onVolumeChange(peer.id, Number(e.target.value))
            }
          />
        </div>
        <div className="volume-value">{Math.round(peer.volume * 100)}%</div>
      </div>

      <VuMeter level={peer.level ?? 0} variant="green" />
    </div>
  );
});

export default PeerCard;

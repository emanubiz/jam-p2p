import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AnalyticsPanel from "./AnalyticsPanel";
import type { SessionAnalytics } from "../hooks/useSessionAnalytics";

const sample: SessionAnalytics = {
  elapsedSec: 125, // 2:05
  participants: 3,
  peakParticipants: 4,
  peerJoins: 5,
  reconnects: 2,
};

describe("AnalyticsPanel", () => {
  it("renders all five session stats with their labels", () => {
    render(<AnalyticsPanel analytics={sample} isOpen />);
    expect(screen.getByText("Session")).toBeTruthy();
    expect(screen.getByText("02:05")).toBeTruthy(); // mm:ss duration
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("Peak")).toBeTruthy();
    expect(screen.getByText("Joins")).toBeTruthy();
    expect(screen.getByText("Reconnects")).toBeTruthy();
  });

  it("formats durations over an hour as H:MM:SS", () => {
    render(
      <AnalyticsPanel analytics={{ ...sample, elapsedSec: 3661 }} isOpen />
    );
    expect(screen.getByText("1:01:01")).toBeTruthy();
  });

  it("is collapsed (no .open) when isOpen is false", () => {
    const { container } = render(
      <AnalyticsPanel analytics={sample} isOpen={false} />
    );
    const panel = container.querySelector(".analytics-panel");
    expect(panel?.classList.contains("open")).toBe(false);
  });
});

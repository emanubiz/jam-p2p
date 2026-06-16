import React from "react";

const BAR_COUNT = 20;
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => i);

interface VuMeterProps {
  level: number;
  variant?: "green" | "blue";
}

function getBarClass(
  index: number,
  active: boolean,
  variant: "green" | "blue"
): string {
  if (!active) return "";
  if (variant === "blue") {
    if (index < 14) return "blue-low";
    if (index < 18) return "blue-mid";
    return "blue-high";
  }
  if (index < 14) return "green";
  if (index < 18) return "yellow";
  return "red";
}

const VuMeter = React.memo(function VuMeter({
  level,
  variant = "green",
}: VuMeterProps) {
  const meterClass = variant === "blue" ? "local-level-meter" : "level-meter";
  const barClass = variant === "blue" ? "local-level-bar" : "level-bar";

  return (
    <div className={meterClass}>
      {BARS.map((i) => (
        <div
          key={i}
          className={`${barClass} ${getBarClass(i, i < level * 20, variant)}`}
        />
      ))}
    </div>
  );
});

export default VuMeter;

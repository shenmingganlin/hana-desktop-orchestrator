export function buildCursorOverlay({ from = null, to, durationMs = 520, dwellMs = 160, label = "target" } = {}) {
  if (!to || typeof to.x !== "number" || typeof to.y !== "number") {
    throw new Error("cursor overlay requires numeric target coordinates");
  }

  const start = from && typeof from.x === "number" && typeof from.y === "number"
    ? from
    : { x: to.x, y: to.y };

  return {
    kind: "cursor-overlay",
    version: 1,
    intent: "preview-click-target",
    cursor: {
      shape: "arrow",
      hotspot: { x: 4, y: 4 },
      theme: "hana-glow",
    },
    motion: {
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      durationMs,
      dwellMs,
      keyframes: [
        { t: 0, x: start.x, y: start.y, opacity: 0.72, scale: 0.96 },
        { t: 0.78, x: to.x, y: to.y, opacity: 1, scale: 1 },
        { t: 1, x: to.x, y: to.y, opacity: 1, scale: 1.04 },
      ],
    },
    target: {
      label,
      center: { x: to.x, y: to.y },
      pulse: true,
    },
  };
}

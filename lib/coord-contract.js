// coord-contract.js — builds an explicit image→physical-pixel coordinate contract
// that travels with every screenshot a tool hands to the model.
//
// THE PROBLEM IT SOLVES:
//   The plugin captures DPI-aware PHYSICAL-pixel screenshots (1:1 with the screen).
//   But the model's vision layer may DOWNSCALE the image before the model "sees" it
//   (e.g. a 2560-wide capture shown to the model at 2000 wide), and the model is not
//   told the scale factor. If the model measures a pixel on the scaled image and
//   feeds it straight to mouse-click-at, the click lands too far up-left.
//
// THE FIX:
//   Never ask the model for absolute pixels off the image it sees. Ask for a RATIO
//   (target is at rx% of width, ry% of height). Ratios are invariant under any
//   uniform vision-layer rescale. Then map ratio → physical pixel using the TRUE
//   physical region this tool captured. That physical pixel is directly clickable.
//
//   physicalX = region.left + rx * region.width
//   physicalY = region.top  + ry * region.height

/**
 * @param {object} region  The TRUE physical region the screenshot covers.
 *   { left, top, width, height } in physical pixels.
 * @param {object} [opts]
 * @param {string} [opts.kind]  e.g. "full-screen" | "region-preview"
 * @returns {object} a contract block to embed in the tool's text return.
 */
export function buildCoordinateContract(region, opts = {}) {
  const left = Math.round(Number(region?.left) || 0);
  const top = Math.round(Number(region?.top) || 0);
  const width = Math.max(1, Math.round(Number(region?.width) || 1));
  const height = Math.max(1, Math.round(Number(region?.height) || 1));

  return {
    coordinateContract: {
      kind: opts.kind || "screenshot",
      // The image you (the model) see is 1:1 with these physical pixels AT CAPTURE
      // TIME, but the vision layer may have rescaled it before you saw it.
      physicalRegion: { left, top, width, height },
      pixelsAreDirectlyClickable: true,
      visionLayerMayRescale: true,
      // HOW TO PICK A CLICK POINT (do this, not absolute-pixel guessing):
      howToTarget: [
        "Locate the target in the image you see.",
        "Express its position as a RATIO of the image you see: rx = targetX / imageWidthYouSee, ry = targetY / imageHeightYouSee. Ratios survive any vision-layer rescale.",
        `Map ratio to a directly-clickable physical pixel: physicalX = ${left} + rx * ${width}, physicalY = ${top} + ry * ${height}.`,
        "Pass that physicalX/physicalY to mouse-click-at / mouse-wheel (they consume physical pixels).",
        "Do NOT read absolute pixels off the image and click them — the image may be scaled and you are not told the factor.",
      ],
      // Convenience: the exact formula as a string the model can apply.
      formula: {
        physicalX: `${left} + rx * ${width}`,
        physicalY: `${top} + ry * ${height}`,
      },
    },
  };
}

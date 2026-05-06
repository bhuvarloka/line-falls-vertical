export const config = {
  // ---- Type ---- //
  fontSize: 48,
  fontFamily: 'Georgia, "Times New Roman", serif',
  textColor: "#000000",

  // ---- Physics ---- //
  gravity: 0.1, // ↓ floaty · ↑ heavy
  damping: 0.995, // ↓ draggy · ↑ bouncy (1 = none)
  constraintIterations: 12, // ↓ wobbly · ↑ stiff

  // ---- Rope (pull-only links) ---- //
  linkStiffness: 1.0, // ↓ stretchy · ↑ rigid
  linkSlack: 0.0, // ↓ taut · ↑ loose

  // ---- Letter collisions ---- //
  collisionRadius: 0.3, // hit radius ÷ fontSize · ↓ overlap · ↑ loose pile
  collisionStiffness: 0.5, // ↓ squishy · ↑ hard

  buckleJitter: 0.75, // ↓ straight column · ↑ chaotic pile

  // ---- Spin on impact ---- //
  impactSpin: Math.PI, // rotation range on landing · 0 = upright · π = ±90°
  spinEase: 0.12, // ↓ slow rotate · ↑ snap

  // ---- Settle (pinning) ---- //
  settleFrames: 30, // frames still before pin · ↓ snappy · ↑ patient
  settleSlack: 2.0, // px drift allowed · ↓ strict · ↑ lenient

  // ---- Resting (sleeping) ---- //
  restingFrames: 8, // frames supported before sleep
  restingSupportDot: 0.6, // ↓ sides count · ↑ only directly under
  restingWakeVelocity: 1.5, // ↓ wakes easily · ↑ ignores nudges

  // ---- Layout ---- //
  chainX: 0.5, // 0 = left · 0.5 = center · 1 = right
  floorY: 0.95, // 0 = top · 1 = bottom
  floorFriction: 0.6, // ↓ slidey · ↑ grippy

  // ---- Colors ---- //
  backgroundColor: "#ffffff",
  floorColor: "#E8392A",
};

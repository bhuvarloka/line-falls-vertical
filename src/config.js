export const config = {
  fontSize: 28,
  fontFamily: 'Georgia, "Times New Roman", serif',
  textColor: "#000000",

  // physics
  gravity: 0.1,
  damping: 0.995,
  constraintIterations: 12,

  // rope: links act like inextensible string (pull only, no push)
  linkStiffness: 1.0,
  linkSlack: 0.0,

  // letter-letter collision (sphere radius as fraction of fontSize)
  collisionRadius: 0.3,
  collisionStiffness: 0.8,

  // small lateral jitter applied during fall so the rope buckles
  // instead of falling perfectly straight onto a single point
  buckleJitter: 0.6,

  // random rotation range (radians) locked at floor contact. π = ±90°
  impactSpin: Math.PI,

  // pin a letter once it has drifted less than `settleSlack` px over `settleFrames` frames
  settleFrames: 30,
  settleSlack: 2.0,

  chainX: 0.5,
  floorY: 0.95,
  floorFriction: 0.6,

  backgroundColor: "#ffffff",
  floorColor: "#E8392A",
};

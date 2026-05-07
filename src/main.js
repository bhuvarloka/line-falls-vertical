import { config } from "./config.js";
import textSource from "./text.txt?raw";

const phrases = textSource
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
document.getElementById("canvas-container").appendChild(canvas);

// Baked (static) layer: once a phrase is no longer the active chain,
// its letters never animate again — we can draw it once and then blit.
const bakedCanvas = document.createElement("canvas");
const bakedCtx = bakedCanvas.getContext("2d");
let bakedChainCount = 0;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  bakedCanvas.width = canvas.width;
  bakedCanvas.height = canvas.height;
}
resize();
window.addEventListener("resize", () => {
  resize();
  init();
});

// ---- Physics ---- //

class Point {
  constructor(x, y, radius) {
    this.x = x;
    this.y = y;
    this.px = x;
    this.py = y;
    this.r = radius;
    this.onFloor = false;
    this.wasOnFloor = false;
    this.pinned = false;
    this.restFrames = 0;
    this.spin = -Math.PI / 2;
    this.rot = -Math.PI / 2;
    this.resting = false;
    this.supportFrames = 0;
  }
  integrate(gravity, damping) {
    if (this.pinned || this.resting) {
      this.px = this.x;
      this.py = this.y;
      return;
    }
    const vx = (this.x - this.px) * damping;
    const vy = (this.y - this.py) * damping;
    this.px = this.x;
    this.py = this.y;
    this.x += vx;
    this.y += vy + gravity;
  }
}

class VerticalChain {
  constructor(text, x, topY) {
    // chars[0] is the falling tip — start of text lands first
    this.chars = text.split("").reverse();
    this.points = [];
    this.restLengths = [];

    const r = config.fontSize * config.collisionRadius;

    let y = topY;
    for (let i = 0; i < this.chars.length; i++) {
      // perfectly aligned x collapses to a single column — seed the buckle
      const jitter = (Math.random() - 0.5) * 0.5;
      this.points.push(new Point(x + jitter, y, r));
      if (i < this.chars.length - 1) {
        const wA = ctx.measureText(this.chars[i]).width;
        const wB = ctx.measureText(this.chars[i + 1]).width;
        const rest = (wA + wB) * 0.5;
        this.restLengths.push(rest);
        y += rest;
      }
    }
  }

  draw(ctx) {
    ctx.font = `${config.fontSize}px ${config.fontFamily}`;
    ctx.fillStyle = config.textColor;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillText(this.chars[i], 0, 0);
      ctx.restore();
    }
  }
}

const TAU = Math.PI * 2;
function wrapAngle(a) {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function updateRotations(chains) {
  const ease = config.spinEase;
  const vertical = -Math.PI / 2;
  for (const chain of chains) {
    for (const p of chain.points) {
      if (!p.wasOnFloor) {
        p.rot = vertical;
        continue;
      }
      const d = wrapAngle(p.spin - p.rot);
      p.rot = wrapAngle(p.rot + d * ease);
      if (Math.abs(d) < 1e-4) p.rot = p.spin;
    }
  }
}

// ---- Solver ---- //

function solveLinks(chains) {
  // pull-only: links slack under compression so the rope can fold
  const k = config.linkStiffness;
  for (const chain of chains) {
    const pts = chain.points;
    const rests = chain.restLengths;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      const aFixed = a.pinned || a.resting;
      const bFixed = b.pinned || b.resting;
      if (aFixed && bFixed) continue;
      const rest = rests[i] * (1 + config.linkSlack);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      if (dist <= rest) continue;
      const wA = aFixed ? 0 : 1;
      const wB = bFixed ? 0 : 1;
      const diff = (((dist - rest) / dist) * k) / (wA + wB);
      a.x += dx * diff * wA;
      a.y += dy * diff * wA;
      b.x -= dx * diff * wB;
      b.y -= dy * diff * wB;
    }
  }
}

function solveCollisions(chains) {
  const k = config.collisionStiffness;
  const wakeV = config.restingWakeVelocity;
  for (const chain of chains) {
    const pts = chain.points;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      for (let j = i + 2; j < n; j++) {
        const b = pts[j];
        let aFixed = a.pinned || a.resting;
        let bFixed = b.pinned || b.resting;
        if (aFixed && bFixed) continue;
        const minD = a.r + b.r;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 === 0) continue;

        if (a.resting && !b.pinned) {
          const v = Math.abs(b.y - b.py) + Math.abs(b.x - b.px);
          if (v > wakeV) {
            a.resting = false;
            a.supportFrames = 0;
            aFixed = a.pinned;
          }
        }
        if (b.resting && !a.pinned) {
          const v = Math.abs(a.y - a.py) + Math.abs(a.x - a.px);
          if (v > wakeV) {
            b.resting = false;
            b.supportFrames = 0;
            bFixed = b.pinned;
          }
        }
        if (aFixed && bFixed) continue;

        const d = Math.sqrt(d2);
        const wA = aFixed ? 0 : 1;
        const wB = bFixed ? 0 : 1;
        const overlap = (((minD - d) / d) * k) / (wA + wB);
        const ox = dx * overlap;
        const oy = dy * overlap;
        a.x -= ox * wA;
        a.y -= oy * wA;
        b.x += ox * wB;
        b.y += oy * wB;
      }
    }
  }
}

function solveFloor(chains, floorY) {
  const friction = config.floorFriction;
  for (const chain of chains) {
    for (const p of chain.points) {
      if (p.pinned || p.resting) continue;
      const limit = floorY - p.r;
      if (p.y > limit) {
        p.y = limit;
        p.px = p.x - (p.x - p.px) * (1 - friction);
        p.py = p.y;
        p.onFloor = true;
        if (!p.wasOnFloor) {
          p.spin = -Math.PI / 2 + (Math.random() - 0.5) * config.impactSpin;
          p.wasOnFloor = true;
        }
      } else {
        p.onFloor = false;
      }
    }
  }
}

let allPoints = [];
function solveRestingContact() {
  const dotMin = config.restingSupportDot;
  const need = config.restingFrames;
  const all = allPoints;

  for (const p of all) {
    if (p.pinned || p.resting) continue;
    let supported = p.onFloor;
    if (!supported) {
      for (const q of all) {
        if (q === p) continue;
        if (!(q.pinned || q.resting || q.onFloor)) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const minD = p.r + q.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > minD * minD * 1.05) continue;
        const d = Math.sqrt(d2) || 0.0001;
        if (dy / d >= dotMin) {
          supported = true;
          break;
        }
      }
    }
    if (supported) {
      if (p.supportFrames === 0 && !p.wasOnFloor) {
        p.spin = -Math.PI / 2 + (Math.random() - 0.5) * config.impactSpin;
        p.wasOnFloor = true;
      }
      p.supportFrames++;
      if (p.supportFrames >= need) {
        p.resting = true;
        p.px = p.x;
        p.py = p.y;
      }
    } else {
      p.supportFrames = 0;
    }
  }
}

function settleLanded(chains) {
  const frames = config.settleFrames;
  const slack2 = config.settleSlack * config.settleSlack;
  for (const chain of chains) {
    for (const p of chain.points) {
      if (p.pinned) continue;
      if (p.restFrames === 0) {
        p.refX = p.x;
        p.refY = p.y;
      }
      const dx = p.x - p.refX;
      const dy = p.y - p.refY;
      if (dx * dx + dy * dy < slack2) {
        p.restFrames++;
        if (p.restFrames >= frames) {
          p.pinned = true;
          p.px = p.x;
          p.py = p.y;
        }
      } else {
        // resnapshot and start a fresh window
        p.restFrames = 1;
        p.refX = p.x;
        p.refY = p.y;
      }
    }
  }
}

function applyBuckleJitter(chains) {
  // nudges still-falling letters whose neighbour below has jammed
  const j = config.buckleJitter;
  if (j <= 0) return;
  for (const chain of chains) {
    const pts = chain.points;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.wasOnFloor || p.pinned || p.resting) continue;
      const vy = p.y - p.py;
      if (vy <= config.gravity * 2) continue;
      const below = pts[i - 1];
      if (Math.abs(p.y - below.y) < p.r * 1.8) {
        p.x += (Math.random() - 0.5) * j;
      }
    }
  }
}

// ---- Scene ---- //

let chains = [];
let settled = false;
let phraseQueue = [];
let phraseIndex = 0;
let nextPhraseTimer = null;

function resetBakedLayer() {
  bakedChainCount = 0;
  bakedCtx.clearRect(0, 0, bakedCanvas.width, bakedCanvas.height);
}

function chainIsSimStatic(chain) {
  // Only bake chains that won't move in future simulation steps.
  return chain.points.every((p) => p.pinned || p.resting);
}

function bakeInactiveChains() {
  // Never bake the active (last) chain: its rotations can still ease while active.
  const bakeLimit = Math.max(0, chains.length - 1);
  while (bakedChainCount < bakeLimit) {
    const chain = chains[bakedChainCount];
    if (!chainIsSimStatic(chain)) break;
    chain.draw(bakedCtx);
    bakedChainCount++;
  }
}

function rebuildAllPoints() {
  // only simulate the active chain + the one just before it (for landing support)
  const live = chains.slice(-2);
  allPoints = live.flatMap((c) => c.points);
}

function dropNextPhrase() {
  if (phraseIndex >= phraseQueue.length) return;

  const text = phraseQueue[phraseIndex++];
  ctx.font = `${config.fontSize}px ${config.fontFamily}`;
  const totalHeight = text
    .split("")
    .reduce((s, c) => s + ctx.measureText(c).width, 0);
  const topY = -(totalHeight + config.fontSize * 2);

  // slight random x offset so phrases don't stack in one column
  const spread = canvas.width * config.chainXSpread;
  const x = canvas.width * config.chainX + (Math.random() - 0.5) * spread;

  const chain = new VerticalChain(text, x, topY);
  chains.push(chain);
  rebuildAllPoints();
  settled = false;
}

function scheduleNext() {
  if (phraseIndex >= phraseQueue.length) return;
  const delay = 4000 + Math.random() * 8000; // 4–12 s
  nextPhraseTimer = setTimeout(() => {
    // wait until the active chain is fully pinned before dropping the next
    const active = chains[chains.length - 1];
    const ready = !active || active.points.every((p) => p.pinned);
    if (ready) {
      dropNextPhrase();
      scheduleNext();
    } else {
      // poll until pinned, then schedule the next interval
      const poll = setInterval(() => {
        if (active.points.every((p) => p.pinned)) {
          clearInterval(poll);
          dropNextPhrase();
          scheduleNext();
        }
      }, 200);
    }
  }, delay);
}

function init() {
  clearTimeout(nextPhraseTimer);
  chains = [];
  allPoints = [];
  settled = false;
  phraseIndex = 0;
  phraseQueue = [...phrases];

  resetBakedLayer();

  dropNextPhrase();
  scheduleNext();
}

init();
// remeasure once webfont swaps in — fallback metrics differ from Playfair
if (document.fonts) document.fonts.ready.then(init);

let frozen = false;
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    frozen = !frozen;
  }
  if (e.code === "KeyR") {
    frozen = true;
    init();
  }
});

// ---- Loop ---- //

function loop() {
  const W = canvas.width;
  const H = canvas.height;
  const floor = H * config.floorY;

  if (!frozen && !settled) {
    // only the active chain (last) needs integration and constraint solving
    const activeChains = chains.slice(-1);

    for (const p of allPoints) p.integrate(config.gravity, config.damping);

    applyBuckleJitter(activeChains);

    for (let i = 0; i < config.constraintIterations; i++) {
      solveLinks(activeChains);
      solveCollisions(activeChains);
      solveFloor(activeChains, floor);
    }

    solveRestingContact();
    settleLanded(activeChains);
    updateRotations(activeChains);

    settled =
      phraseIndex >= phraseQueue.length && allPoints.every((p) => p.pinned);
  }

  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = config.floorColor;
  ctx.fillRect(0, floor, W, H - floor);

  bakeInactiveChains();
  ctx.drawImage(bakedCanvas, 0, 0);
  for (let i = bakedChainCount; i < chains.length; i++) chains[i].draw(ctx);

  requestAnimationFrame(loop);
}

loop();

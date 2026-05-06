import { config } from "./config.js";
import textSource from "./text.txt?raw";

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
document.getElementById("canvas-container").appendChild(canvas);

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
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
    if (this.pinned) {
      this.px = this.x;
      this.py = this.y;
      return;
    }
    if (this.resting) {
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
    // reversed: chars[0] at bottom = falling tip (start of text falls first)
    this.chars = text.split("").reverse();
    this.points = [];
    this.restLengths = [];

    ctx.font = `${config.fontSize}px ${config.fontFamily}`;

    const r = config.fontSize * config.collisionRadius;

    let y = topY;
    for (let i = 0; i < this.chars.length; i++) {
      // seed buckling — perfectly aligned x collapses to a single column
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
    const pts = this.points;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const angle = p.rot;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.fillText(this.chars[i], 0, 0);
      ctx.restore();
    }
    ctx.textAlign = "left";
  }
}

function wrapAngle(a) {
  const tau = Math.PI * 2;
  return ((((a + Math.PI) % tau) + tau) % tau) - Math.PI;
}

function angleDelta(from, to) {
  return wrapAngle(to - from);
}

function updateRotations(chains) {
  const ease = config.spinEase ?? 0.12;
  const vertical = -Math.PI / 2;
  for (const chain of chains) {
    for (const p of chain.points) {
      if (!p.wasOnFloor) {
        p.rot = vertical;
        continue;
      }
      const target = p.spin;
      const d = angleDelta(p.rot, target);
      p.rot = wrapAngle(p.rot + d * ease);
      if (Math.abs(d) < 1e-4) p.rot = target;
    }
  }
}

// ---- Solver ---- //

function solveLinks(chains) {
  // pull-only: links go slack under compression so the rope can fold
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
      const wSum = wA + wB;
      const diff = (((dist - rest) / dist) * k) / wSum;
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

function solveRestingContact(chains) {
  const dotMin = config.restingSupportDot;
  const need = config.restingFrames;
  const all = [];
  for (const c of chains) for (const p of c.points) all.push(p);

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
  // pin any point whose net displacement stays below `settleSlack` for
  // `settleFrames` consecutive frames. works for floor-resters and for
  // letters piled on top of others — anything that has stopped traveling.
  const frames = config.settleFrames;
  const slack = config.settleSlack;
  const slack2 = slack * slack;
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
        // moved too far — resnapshot from here and start a fresh window
        p.restFrames = 1;
        p.refX = p.x;
        p.refY = p.y;
      }
    }
  }
}

function applyBuckleJitter(chains, floorY) {
  // only nudges still-falling letters whose neighbour below has jammed
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

function init() {
  const W = canvas.width;
  const x = W * config.chainX;
  const text = textSource.replace(/\n/g, " ").trim();

  ctx.font = `${config.fontSize}px ${config.fontFamily}`;
  const totalHeight = text
    .split("")
    .reduce((s, c) => s + ctx.measureText(c).width, 0);
  const topY = -(totalHeight + config.fontSize * 2);

  chains = [new VerticalChain(text, x, topY)];
}

init();

let frozen = true;
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

  if (!frozen) {
    for (const chain of chains)
      for (const p of chain.points) p.integrate(config.gravity, config.damping);

    applyBuckleJitter(chains, floor);

    const iters = config.constraintIterations;
    for (let i = 0; i < iters; i++) {
      solveLinks(chains);
      solveCollisions(chains);
      solveFloor(chains, floor);
    }

    solveRestingContact(chains);
    settleLanded(chains);

    updateRotations(chains);
  }

  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = config.floorColor;
  ctx.fillRect(0, floor, W, H - floor);

  for (const chain of chains) chain.draw(ctx);

  requestAnimationFrame(loop);
}

loop();

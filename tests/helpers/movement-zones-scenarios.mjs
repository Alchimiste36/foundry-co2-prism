import { performance } from "node:perf_hooks";

/** Doubles reproductibles : ces mesures ne remplacent pas une scène Foundry réelle. */
export function movementScenario(Engine, { kind = "open", cells = 5, alternating = false } = {}) {
  class Container {
    constructor() { this.children = []; }
    addChild(child) { child.parent = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter(item => item !== child); }
    destroy() { this.destroyed = true; this.children.length = 0; }
  }
  class Text extends Container {
    constructor(text, style) {
      super(); Object.assign(this, { text, style });
      this.anchor = { set() {} }; this.position = { set: (x, y) => Object.assign(this, { x, y }) };
    }
  }
  const profile = { constrainMs: 0, measureMs: 0, queueMs: 0, pauses: 0 };
  const scene = { id: "benchmark", grid: { type: 1 }, tokens: new Map() };
  const canvas = { ready: true, scene, interface: new Container(), dimensions: { rect: { contains: (x, y) => x >= 0 && y >= 0 && x < 10100 && y < 10100 } },
    grid: { size: 100, distance: 2, getOffset: point => ({ i: point.y / 100, j: point.x / 100 }),
      getAdjacentOffsets: ({ i, j }) => [-1, 0, 1].flatMap(di => [-1, 0, 1].filter(dj => di || dj).map(dj => ({ i: i + di, j: j + dj }))),
      getTopLeftPoint: ({ i, j }) => ({ x: j * 100, y: i * 100 }),
      getCenterPoint: ({ i, j }) => ({ x: j * 100 + 50, y: i * 100 + 50 }) } };
  const state = { sessionId: 1, start: { x: 5000, y: 5000, elevation: 0, width: 1, height: 1, depth: 1, shape: 1, level: "level" } };
  const token = { id: "token", parent: scene, movementAction: "walk", object: {
    constrainMovementPath(path) {
      const began = performance.now();
      try {
        for (let index = 1; index < path.length; index++) {
          const a = path[index - 1], b = path[index];
          const corridor = kind === "corridor" && b.y !== 5000;
          // Mur vertical et porte au nord de l'origine, avec contournement possible.
          const crosses = (a.x <= 5100) !== (b.x <= 5100);
          const wall = kind === "walls" && crosses && !(a.y === 4800 && b.y === 4800);
          if (corridor || wall) return [path.slice(0, index), true];
        }
        return [path, false];
      } finally { profile.constrainMs += performance.now() - began; }
    },
    measureMovementPath(path) {
      const began = performance.now();
      try {
        let diagonals = 0;
        for (let index = 1; index < path.length; index++) if (path[index].x !== path[index - 1].x && path[index].y !== path[index - 1].y) diagonals++;
        return { cost: (path.length - 1 + (alternating ? Math.floor(diagonals / 2) : 0)) * 2, diagonals };
      } finally { profile.measureMs += performance.now() - began; }
    }
  } };
  scene.tokens.set(token.id, token);
  const zones = new Engine({ getCanvas: () => canvas, getPIXI: () => ({ Container, Text }),
    getAction: () => ({ walls: "move", measure: true }), yieldFrame: async () => { profile.pauses++; } });
  const range = { cellsPerActionRaw: cells, rounding: "nearest" };
  const markers = () => (zones.container?.children ?? []).map(({ x, y, text, style }) => [x, y, text, style.fill])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { zones, token, state, range, profile, markers };
}

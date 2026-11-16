import test from "node:test";
import assert from "node:assert/strict";
import { MovementZones } from "../module/movement/movement-zones.mjs";

const DEFAULT_RANGE = Object.freeze({ cellsPerActionRaw: 2.5, rounding: "nearest", actions: 2 });

function setup() {
  class Container {
    constructor() { this.children = []; }
    addChild(child) { child.parent = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
    destroy({ children }) { this.destroyed = true; if (children) for (const child of this.children) child.destroy?.({ children: true }); this.children = []; }
  }
  class Text extends Container {
    constructor(text, style) { super(); Object.assign(this, { text, style,
      anchor: { set: value => { this.centered = value; } }, position: { set: (x, y) => { this.x = x; this.y = y; } } }); }
  }
  const scene = { id: "scene", grid: { type: 1, distance: 2 }, tokens: new Map() };
  const canvas = { ready: true, scene, interface: new Container(),
    dimensions: { rect: { contains: (x, y) => x >= 0 && y >= 0 && x <= 2000 && y <= 2000 } },
    grid: { size: 100, distance: 2, getOffset: p => ({ i: p.y / 100, j: p.x / 100 }),
      getAdjacentOffsets: ({ i, j }) => [-1, 0, 1].flatMap(di => [-1, 0, 1].filter(dj => di || dj).map(dj => ({ i: i + di, j: j + dj }))),
      getTopLeftPoint: p => ({ x: p.j * 100, y: p.i * 100 }),
      getCenterPoint: p => ({ x: p.j * 100 + 50, y: p.i * 100 + 50 }) } };
  const start = { x: 500, y: 500, elevation: 0, width: 1, height: 1, depth: 1, shape: 1, level: "l" };
  const calls = [], behavior = {};
  const token = { id: "token", parent: scene, x: 999, y: 999, movementAction: "walk", update: () => assert.fail("Pas de modification de token"),
    object: {
      constrainMovementPath: (path, options) => {
        assert.equal(options.ignoreWalls, false); assert.equal(options.history, false);
        calls.push({ path: structuredClone(path), options });
        return behavior.constrain ? behavior.constrain(path) : [path, false];
      },
      measureMovementPath: path => {
        if (behavior.measure) return behavior.measure(path);
        let steps = 0, diagonals = 0;
        for (let index = 1; index < path.length; index++) {
          const dx = Math.abs(path[index].x - path[index - 1].x) / 100;
          const dy = Math.abs(path[index].y - path[index - 1].y) / 100;
          assert.ok(Math.max(dx, dy) === 1);
          steps++; if (dx && dy) diagonals++;
        }
        return { cost: steps * canvas.grid.distance, diagonals };
      }
    } };
  scene.tokens.set(token.id, token);
  const zones = new MovementZones({ getCanvas: () => canvas, getPIXI: () => ({ Container, Text }),
    getAction: () => ({ walls: "move", measure: true }), yieldFrame: async () => {} });
  return { zones, canvas, token, start, state: { sessionId: 1, start }, behavior, calls };
}

test("zones : origine de session, plafond 120 et classifications natives 3/5", async () => {
  const { zones, token, state, calls, canvas } = setup();
  const result = await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(result.success, true); assert.ok(calls.length > 120 && calls.length <= 32000);
  assert.ok(calls.every(call => call.path[0].x === 500 && call.path[0].y === 500 && call.options.ignoreWalls === false));
  assert.equal(zones.container.children.length, 120);
  assert.ok(zones.container.children.some(text => text.text === "1" && text.style.fill === 0xffe100));
  assert.ok(zones.container.children.some(text => text.text === "2" && text.style.fill === 0xff2438));
  assert.equal(zones.container.eventMode, "none");
  assert.equal(zones.container.children.some(text => text.x === 550 && text.y === 550), false);
  token.x = 1500;
  zones.sync(token, state, true);
  assert.equal(calls.length, zones.stats.examined); assert.equal(zones.container.children.length, 120);
  const container = zones.container;
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(zones.visible, false); assert.equal(container.destroyed, true); assert.equal(canvas.interface.children.length, 0);
});

test("zones : trajet partiel ou contraint avant destination rejeté, pas de proximité approximative", async () => {
  const { zones, token, state, behavior } = setup();
  behavior.constrain = path => [[path[0]], true];
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(zones.stats.partial, 8); assert.equal(zones.stats.marked, 0);
  zones.clear();
  behavior.constrain = path => [[path[0]], true];
  await zones.toggle(token, state, DEFAULT_RANGE); assert.equal(zones.stats.marked, 0);
});

test("zones : seuils 3/4/5 et aucun marqueur au-delà", async () => {
  const { zones, token, state } = setup(); await zones.toggle(token, state, DEFAULT_RANGE);
  const at = x => zones.container.children.find(marker => marker.x === x + 50 && marker.y === 550);
  assert.equal(at(800).text, "1"); assert.equal(at(900).text, "2"); assert.equal(at(1000).text, "2");
  assert.equal(at(1100), undefined); zones.clear();
});

test("zones : extinction pendant une pause ignore les résultats tardifs", async () => {
  const { zones, token, state, canvas } = setup();
  let resume;
  zones.yieldFrame = () => new Promise(resolve => { resume = resolve; });
  const pending = zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(zones.busy, true); assert.equal(typeof resume, "function");
  await zones.toggle(token, state, DEFAULT_RANGE); resume();
  assert.equal((await pending).reason, "cancelled");
  assert.equal(canvas.interface.children.length, 0); assert.equal(zones.visible, false);
  zones.yieldFrame = async () => {}; await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(zones.visible, true); zones.clear();
});

test("zones : nettoyage token/session/panneau/scène et API indisponible sans repli", async () => {
  for (const changed of ["token", "session", "panel", "scene"]) {
    const { zones, token, state, canvas } = setup(); await zones.toggle(token, state, DEFAULT_RANGE);
    if (changed === "scene") canvas.scene = {};
    zones.sync(changed === "token" ? {} : token, changed === "session" ? { ...state, sessionId: 2 } : state, changed !== "panel");
    assert.equal(zones.visible, false); assert.equal(canvas.interface.children.length, 0);
  }
  const { zones, token, state, behavior } = setup();
  behavior.measure = () => ({ cost: NaN, diagonals: 0 });
  assert.equal((await zones.toggle(token, state, DEFAULT_RANGE)).success, false);
  assert.equal(zones.diagnostic, "Unavailable"); assert.equal(zones.visible, false);
  token.object.constrainMovementPath = undefined;
  assert.equal((await zones.toggle(token, state, DEFAULT_RANGE)).reason, "Unavailable");
  token.object.constrainMovementPath = () => { throw "native-error"; };
  assert.equal((await zones.toggle(token, state, DEFAULT_RANGE)).reason, "Unavailable");
});

// Graphe de réponses natives simulées, sans prétendre reproduire les murs Foundry.
function graph(env, edges) {
  const pointKey = point => `${point.x},${point.y}`;
  const key = (a, b) => [pointKey(a), pointKey(b)].sort().join("|");
  const links = new Map(edges.map(([a, b, cost = 1]) => [key({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }), cost]));
  env.behavior.constrain = path => {
    for (let index = 1; index < path.length; index++) if (!links.has(key(path[index - 1], path[index]))) return [path.slice(0, index), true];
    return [path, false];
  };
  env.behavior.measure = path => {
    let cost = 0, diagonals = 0;
    for (let index = 1; index < path.length; index++) {
      cost += links.get(key(path[index - 1], path[index]));
      if (path[index].x !== path[index - 1].x && path[index].y !== path[index - 1].y) diagonals++;
    }
    return { cost: cost * env.canvas.grid.distance, diagonals };
  };
  return links;
}

const markerAt = (zones, x, y) => zones.container.children.find(marker => marker.x === x + 50 && marker.y === y + 50);

test("zones : angle contourné par transitions intermédiaires, diagonale bloquée rejetée", async () => {
  const env = setup(), { zones, token, state, calls } = env;
  graph(env, [[[500, 500], [500, 400]], [[500, 400], [600, 400]], [[600, 400], [600, 500]]]);
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(markerAt(zones, 600, 500)?.text, "1");
  assert.equal(markerAt(zones, 700, 500), undefined);
  assert.ok(calls.some(({ path }) => path.at(-2).x === 600 && path.at(-2).y === 400 && path.at(-1).y === 500));
  assert.ok(calls.every(({ path }) => path.every((p, index) => !index || Math.max(Math.abs(p.x - path[index - 1].x), Math.abs(p.y - path[index - 1].y)) === 100)));
});

test("zones : mur infranchissable, porte ouverte/fermée et nouveau calcul explicite", async () => {
  const env = setup(), { zones, token, state, behavior } = env;
  behavior.constrain = path => {
    for (let index = 1; index < path.length; index++) {
      if ((path[index - 1].x <= 500) !== (path[index].x <= 500)) return [path.slice(0, index), true];
    }
    return [path, false];
  };
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.ok(zones.container.children.every(marker => marker.x <= 550));
  zones.clear();
  graph(env, []); await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(markerAt(zones, 600, 500), undefined);
  zones.clear();
  graph(env, [[[500, 500], [600, 500]]]); await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(markerAt(zones, 600, 500)?.text, "1");
});

test("zones : plusieurs chemins, un coût inférieur remplace une découverte plus longue", async () => {
  const env = setup(), { zones, token, state, behavior } = env;
  graph(env, [[[500, 500], [600, 500]], [[600, 500], [700, 500], 4],
    [[500, 500], [500, 400]], [[500, 400], [600, 400]], [[600, 400], [700, 500]]]);
  const measure = behavior.measure, seen = [];
  behavior.measure = path => {
    const result = measure(path);
    if (path.at(-1).x === 700 && path.at(-1).y === 500) seen.push(result.cost / env.canvas.grid.distance);
    return result;
  };
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.ok(seen.includes(5) && seen.includes(3));
  assert.equal(markerAt(zones, 700, 500)?.text, "1");
});

test("zones : mesure du chemin entier, alternance diagonale et distances non uniformes", async () => {
  const { zones, token, state, behavior, canvas } = setup();
  behavior.measure = path => {
    let steps = 0, diagonals = 0;
    for (let index = 1; index < path.length; index++) {
      steps++;
      if (path[index].x !== path[index - 1].x && path[index].y !== path[index - 1].y) diagonals++;
    }
    return { cost: (steps + Math.floor(diagonals / 2)) * canvas.grid.distance, diagonals };
  };
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(markerAt(zones, 700, 700)?.text, "1"); // Deux diagonales : 1 + 2 = 3.
  assert.equal(markerAt(zones, 800, 800)?.text, "2"); // Trois diagonales : 1 + 2 + 1 = 4.
  assert.equal(markerAt(zones, 900, 900), undefined); // Quatre diagonales coûtent 6.
});

test("zones : adjacence native sans diagonales, coût nul et régions refusés explicitement", async () => {
  const { zones, token, state, behavior, canvas } = setup();
  const adjacent = canvas.grid.getAdjacentOffsets;
  canvas.grid.getAdjacentOffsets = offset => adjacent(offset).filter(p => p.i === offset.i || p.j === offset.j);
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(markerAt(zones, 800, 800), undefined);
  zones.clear(); behavior.measure = () => ({ cost: 0, diagonals: 0 });
  assert.equal((await zones.toggle(token, state, DEFAULT_RANGE)).success, false);
  assert.equal(zones.visible, false);
  canvas.scene.regions = new Map([["region", {}]]);
  assert.equal(zones.supported(token, state.start), "Unsupported");
});

test("zones : deux phases diagonales au même coût restent explorées", async () => {
  const env = setup(), { zones, token, state, behavior, canvas } = env;
  graph(env, [[[500, 500], [600, 600]], [[600, 600], [700, 500]], [[600, 600], [700, 600]],
    [[700, 600], [700, 500]], [[700, 500], [800, 400]], [[800, 400], [900, 400]]]);
  const phases = new Set();
  behavior.measure = path => {
    let diagonals = 0;
    for (let index = 1; index < path.length; index++) if (path[index].x !== path[index - 1].x && path[index].y !== path[index - 1].y) diagonals++;
    if (path.at(-2).x === 700 && path.at(-2).y === 500 && path.at(-1).x === 800) {
      phases.add((diagonals - 1) % 2);
    }
    return { spaces: path.length - 1, cost: (path.length - 1 + Math.floor(diagonals / 2)) * canvas.grid.distance, diagonals };
  };
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.deepEqual([...phases].sort(), [0, 1]);
  assert.equal(markerAt(zones, 900, 400)?.text, "2");
});

function corridor(env, length) {
  graph(env, Array.from({ length }, (_, index) => [[500 + index * 100, 500], [600 + index * 100, 500]]));
}

test("zone tactique : deux actions réelles à cinq cases, détour et seuils 5/10", async () => {
  const env = setup(), { zones, token, state } = env;
  graph(env, [[[500, 500], [500, 400]], [[500, 400], [600, 400]], [[600, 400], [600, 500]],
    ...Array.from({ length: 8 }, (_, i) => [[600 + i * 100, 500], [700 + i * 100, 500]])]);
  const result = await zones.toggle(token, state, { cellsPerActionRaw: 5, rounding: "nearest", actions: 2 });
  assert.equal(result.success, true); assert.deepEqual(zones.range.thresholds, [5, 10]);
  assert.equal(markerAt(zones, 600, 500)?.text, "1");
  assert.equal(markerAt(zones, 800, 500)?.text, "1");
  assert.equal(markerAt(zones, 900, 500)?.text, "2");
  assert.equal(markerAt(zones, 1300, 500)?.text, "2");
  assert.equal(markerAt(zones, 1400, 500), undefined);
});

test("zone tactique : 3,5 cases et trois actions donnent 4/7/11 et numéros 1/2/3", async () => {
  const env = setup(), { zones, token, state } = env; corridor(env, 12);
  await zones.toggle(token, state, { cellsPerActionRaw: 3.5, rounding: "nearest", actions: 3 });
  assert.deepEqual(zones.range.thresholds, [4, 7, 11]);
  assert.equal(markerAt(zones, 900, 500)?.text, "1");
  assert.equal(markerAt(zones, 1000, 500)?.text, "2");
  assert.equal(markerAt(zones, 1200, 500)?.text, "2");
  assert.equal(markerAt(zones, 1300, 500)?.text, "3");
  assert.equal(markerAt(zones, 1600, 500)?.text, "3");
  assert.equal(markerAt(zones, 1700, 500), undefined);
  assert.equal(markerAt(zones, 1300, 500)?.style.fill, 0xff2438);
});

test("zone tactique : seuils répétés, trois arrondis et zéro action sans exploration", async () => {
  const env = setup(), { zones, token, state, calls } = env; corridor(env, 3);
  for (const [rounding, thresholds] of [["nearest", [0, 1, 1]], ["up", [1, 1, 2]], ["down", [0, 0, 1]]]) {
    await zones.toggle(token, state, { cellsPerActionRaw: 0.4, rounding, actions: 3 });
    assert.deepEqual(zones.range.thresholds, thresholds);
    assert.equal(markerAt(zones, 600, 500)?.text, String(thresholds.findIndex(value => value >= 1) + 1));
    zones.clear();
  }
  const before = calls.length;
  for (const range of [{ cellsPerActionRaw: 5, rounding: "nearest", actions: 0 }, { cellsPerActionRaw: 0.1, rounding: "down", actions: 3 }]) {
    assert.equal((await zones.toggle(token, state, range)).success, true);
    assert.equal(zones.visible, true); assert.equal(zones.diagnostic, "Done");
    assert.equal(zones.stats.examined, 0); assert.equal(zones.container.children.length, 0);
    await zones.toggle(token, state, range); assert.equal(zones.visible, false);
  }
  assert.equal(calls.length, before);
});

test("zone tactique : instantané figé, nouvelle activation, nouvelle session sans fuite", async () => {
  const env = setup(), { zones, token, state, canvas } = env; corridor(env, 12);
  const range = { cellsPerActionRaw: 5, rounding: "nearest", actions: 2 };
  let resume; zones.yieldFrame = () => new Promise(resolve => { resume = resolve; });
  const pending = zones.toggle(token, state, range);
  range.actions = 1; range.cellsPerActionRaw = 3; token.x = 800;
  zones.yieldFrame = async () => {}; resume(); await pending;
  assert.deepEqual(zones.range.thresholds, [5, 10]); assert.equal(markerAt(zones, 1500, 500)?.text, "2");
  zones.sync(token, state, true); assert.deepEqual(zones.range.thresholds, [5, 10]);
  await zones.toggle(token, state, range); await zones.toggle(token, state, range);
  assert.deepEqual(zones.range.thresholds, [3]); assert.equal(markerAt(zones, 900, 500), undefined);
  zones.sync(token, { ...state, sessionId: 2 }, true); assert.equal(canvas.interface.children.length, 0);
  const next = { sessionId: 2, start: { ...state.start, x: 800 } };
  await zones.toggle(token, next, range);
  assert.ok(zones.container.children.every(marker => marker.x !== 850 || marker.y !== 550));
  assert.equal(canvas.interface.children.length, 1); zones.clear(); assert.equal(canvas.interface.children.length, 0);
});

test("zone tactique : données invalides refusées et actions nombreuses évaluées sans allocation massive", async () => {
  const { zones, token, state, calls } = setup();
  for (const range of [null, { cellsPerActionRaw: 0, rounding: "nearest", actions: 1 },
    { cellsPerActionRaw: Infinity, rounding: "nearest", actions: 1 }, { cellsPerActionRaw: 5, rounding: "nearest", actions: -1 },
    { cellsPerActionRaw: 5, rounding: "nearest", actions: 1.5 }, { cellsPerActionRaw: 5, rounding: "unknown", actions: 1 },
    { cellsPerActionRaw: Number.MAX_VALUE, rounding: "nearest", actions: 2 }]) {
    assert.equal((await zones.toggle(token, state, range)).reason, "InvalidRange");
    assert.equal(zones.visible, false);
  }
  assert.equal((await zones.toggle(token, state, { cellsPerActionRaw: Number.MIN_VALUE, rounding: "down", actions: Number.MAX_SAFE_INTEGER })).success, true);
  assert.equal(zones.range.thresholds, null); assert.equal(zones.stats.marked, 0);
  assert.equal(calls.length, 0);
});

test("zone tactique : seuils paresseux et premier indice correct pour 5 000 actions", async () => {
  const env = setup(), { zones, token, state } = env; corridor(env, 2);
  assert.equal((await zones.toggle(token, state, { cellsPerActionRaw: 0.0002, rounding: "down", actions: 5000 })).success, true);
  assert.equal(zones.range.thresholds, null); assert.equal(zones.range.maxCost, 1);
  assert.equal(markerAt(zones, 600, 500)?.text, "5000");
  assert.equal(markerAt(zones, 700, 500), undefined);
});

test("zone tactique : limites temps/états/transitions explicites, aucun rendu partiel", async () => {
  for (const kind of ["time", "states", "transitions"]) {
    const { zones, token, state, canvas } = setup();
    zones.now = () => kind === "time" && zones.stats?.examined > 100 ? 16000 : 0;
    zones.yieldFrame = async () => {
      assert.equal(zones.container.visible, false);
      if (kind === "states") zones.stats.maximumStates = zones.stats.states;
      if (kind === "transitions") zones.stats.maximumTransitions = zones.stats.examined;
    };
    const result = await zones.toggle(token, state, DEFAULT_RANGE);
    assert.equal(result.reason, kind === "time" ? "TimeLimit" : "Limit");
    assert.equal(result.stats.stopReason, result.reason);
    assert.equal(zones.visible, false); assert.equal(canvas.interface.children.length, 0);
  }
});

test("zone tactique : annulation pendant le rendu et invalidation directe du contexte", async () => {
  for (const kind of ["render", "session", "scene", "token"]) {
    const { zones, token, state, canvas } = setup();
    zones.yieldFrame = async () => {
      if (kind === "render") { if (zones.stats.marked > 0) zones.clear(); }
      else if (kind === "session") zones.sessionId++;
      else if (kind === "scene") canvas.scene = {};
      else canvas.scene.tokens.delete(token.id);
    };
    const result = await zones.toggle(token, state, DEFAULT_RANGE);
    assert.equal(result.reason, "cancelled");
    assert.equal(zones.visible, false); assert.equal(canvas.interface.children.length, 0);
  }
});

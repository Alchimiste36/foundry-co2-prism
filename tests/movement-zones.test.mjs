import test from "node:test";
import assert from "node:assert/strict";
import { MovementZones } from "../module/movement/movement-zones.mjs";

const DEFAULT_RANGE = Object.freeze({ cellsPerActionRaw: 5, rounding: "nearest" });

function setup() {
  class Container {
    constructor() { this.children = []; }
    addChild(child) { child.parent = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter(item => item !== child); child.parent = null; }
    destroy({ children }) { this.destroyed = true; if (children) for (const child of this.children) child.destroy?.({ children: true }); this.children = []; }
  }
  class Graphics extends Container {
    constructor() { super(); this.position = { set: (x, y) => Object.assign(this, { x, y }) }; }
    beginFill(fill, alpha) { this.style = { fill, alpha }; return this; }
    drawRect(x, y, width, height) { this.rectangle = { x, y, width, height }; return this; }
    endFill() { return this; }
  }
  const scene = { id: "scene", grid: { type: 1, distance: 2 }, tokens: new Map() };
  const canvas = { ready: true, scene, interface: new Container(),
    dimensions: { rect: { contains: (x, y) => x >= 0 && y >= 0 && x <= 2000 && y <= 2000 } },
    grid: { size: 100, distance: 2, getOffset: p => ({ i: Math.floor(p.y / 100), j: Math.floor(p.x / 100) }),
      getAdjacentOffsets: ({ i, j }) => [-1, 0, 1].flatMap(di => [-1, 0, 1].filter(dj => di || dj).map(dj => ({ i: i + di, j: j + dj }))),
      getTopLeftPoint: p => ({ x: p.j * 100, y: p.i * 100 }),
      getCenterPoint: p => ({ x: p.j * 100 + 50, y: p.i * 100 + 50 }) } };
  const start = { x: 500, y: 500, elevation: 0, width: 1, height: 1, depth: 1, shape: 1, level: "l" };
  const calls = [], behavior = {};
  const token = { id: "token", parent: scene, x: 999, y: 999, movementAction: "walk", update: () => assert.fail("Pas de modification de token"),
    getMovementOrigin: point => ({ x: point.x + point.width * 50, y: point.y + point.height * 50 }),
    getCompleteMovementPath: path => behavior.complete ? behavior.complete(path) : path,
    object: {
      createTerrainMovementPath: path => behavior.terrain ? behavior.terrain(path) : path.map(point => ({ ...point, terrain: null })),
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
  const zones = new MovementZones({ getCanvas: () => canvas, getPIXI: () => ({ Container, Graphics }),
    getAction: () => ({ walls: "move", measure: true }), yieldFrame: async () => {} });
  return { zones, canvas, token, start, state: { sessionId: 1, start }, behavior, calls };
}

test("zones : origine de session, plafond 120 et carrés bleus translucides centrés", async () => {
  const { zones, token, state, calls, canvas } = setup();
  const result = await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(result.success, true); assert.ok(calls.length > 120 && calls.length <= 32000);
  assert.ok(calls.every(call => call.path[0].x === 500 && call.path[0].y === 500 && call.options.ignoreWalls === false));
  assert.equal(zones.container.children.length, 121);
  assert.equal(zones.stats.marked, zones.container.children.length - 1);
  assert.ok(zones.container.children.every(marker => marker instanceof Object && marker.text === undefined
    && [0x357cbb, 0xd84b4b].includes(marker.style.fill) && marker.style.alpha === 0.4 && marker.eventMode === "none"
    && marker.rectangle.x === -17.5 && marker.rectangle.y === -17.5
    && marker.rectangle.width === 35 && marker.rectangle.height === 35
    && marker.x % 100 === 50 && marker.y % 100 === 50));
  assert.equal(zones.container.interactiveChildren, false);
  assert.equal(zones.container.eventMode, "none");
  assert.equal(zones.container.children.filter(marker => marker.x === 550 && marker.y === 550).length, 1);
  token.x = 1500;
  zones.sync(token, state, true);
  assert.equal(calls.length, zones.stats.examined); assert.equal(zones.container.children.length, 121);
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
  assert.equal(at(800).style.fill, 0x357cbb); assert.equal(at(900).style.fill, 0x357cbb); assert.equal(at(1000).style.fill, 0x357cbb);
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
  assert.equal(markerAt(zones, 600, 500)?.style.fill, 0x357cbb);
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
  assert.equal(markerAt(zones, 600, 500)?.style.fill, 0x357cbb);
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
  assert.equal(markerAt(zones, 700, 500)?.style.fill, 0x357cbb);
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
  assert.equal(markerAt(zones, 700, 700)?.style.fill, 0x357cbb); // Deux diagonales : 1 + 2 = 3.
  assert.equal(markerAt(zones, 800, 800)?.style.fill, 0x357cbb); // Trois diagonales : 1 + 2 + 1 = 4.
  assert.equal(markerAt(zones, 900, 900), undefined); // Quatre diagonales coûtent 6.
});

test("zones : adjacence native sans diagonales, coût nul refusé et régions acceptées", async () => {
  const { zones, token, state, behavior, canvas } = setup();
  const adjacent = canvas.grid.getAdjacentOffsets;
  canvas.grid.getAdjacentOffsets = offset => adjacent(offset).filter(p => p.i === offset.i || p.j === offset.j);
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(markerAt(zones, 800, 800), undefined);
  zones.clear(); behavior.measure = () => ({ cost: 0, diagonals: 0 });
  assert.equal((await zones.toggle(token, state, DEFAULT_RANGE)).success, false);
  assert.equal(zones.visible, false);
  canvas.scene.regions = new Map([["region", {}]]);
  assert.equal(zones.supported(token, state.start), null);
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
  assert.equal(markerAt(zones, 900, 400)?.style.fill, 0x357cbb);
});

function corridor(env, length) {
  graph(env, Array.from({ length }, (_, index) => [[500 + index * 100, 500], [600 + index * 100, 500]]));
}

test("zone tactique : réserve ignorée, portée de cinq cases avec détour", async () => {
  const env = setup(), { zones, token, state } = env;
  graph(env, [[[500, 500], [500, 400]], [[500, 400], [600, 400]], [[600, 400], [600, 500]],
    ...Array.from({ length: 8 }, (_, i) => [[600 + i * 100, 500], [700 + i * 100, 500]])]);
  await zones.toggle(token, state, { cellsPerActionRaw: 5, rounding: "nearest" });
  assert.equal(zones.range.maxCost, 5);
  assert.equal(markerAt(zones, 800, 500)?.style.fill, 0x357cbb);
  assert.equal(markerAt(zones, 900, 500), undefined);
  assert.ok(zones.container.children.every(m => m.text === undefined && [0x357cbb, 0xd84b4b].includes(m.style.fill)));
});

test("zone tactique : capacité fractionnaire, trois arrondis et seuil nul", async () => {
  const env = setup(), { zones, token, state } = env; corridor(env, 12);
  for (const [rounding, capacity] of [["nearest", 4], ["up", 4], ["down", 3]]) {
    await zones.toggle(token, state, { cellsPerActionRaw: 3.5, rounding });
    assert.equal(zones.range.maxCost, capacity); assert.equal(zones.stats.marked, capacity);
    assert.equal(markerAt(zones, 500 + capacity * 100, 500)?.style.fill, 0x357cbb);
    assert.equal(markerAt(zones, 600 + capacity * 100, 500), undefined); zones.clear();
  }
  await zones.toggle(token, state, { cellsPerActionRaw: 0.1, rounding: "down" });
  assert.equal(zones.visible, true); assert.equal(zones.stats.examined, 0); assert.equal(zones.stats.marked, 0);
});

test("zone tactique : données invalides et absence de multiplication par la réserve", async () => {
  const { zones, token, state, calls } = setup();
  for (const range of [null, { cellsPerActionRaw: 0, rounding: "nearest" },
    { cellsPerActionRaw: Infinity, rounding: "nearest" }, { cellsPerActionRaw: 5, rounding: "unknown" },
    { cellsPerActionRaw: Number.MAX_VALUE, rounding: "nearest" }]) {
    assert.equal((await zones.toggle(token, state, range)).reason, "InvalidRange");
    assert.equal(zones.visible, false);
  }
  assert.equal(calls.length, 0);
  for (const capacity of [1, 2, 3]) {
    await zones.toggle(token, state, { cellsPerActionRaw: capacity, rounding: "nearest" });
    assert.equal(zones.range.maxCost, capacity); assert.equal(zones.stats.marked, (2 * capacity + 1) ** 2 - 1);
    assert.ok(zones.container.children.every(m => m.text === undefined)); zones.clear();
  }
});

test("zone tactique : instantané figé, nouvelle activation, nouvelle session sans fuite", async () => {
  const env = setup(), { zones, token, state, canvas } = env; corridor(env, 12);
  const range = { cellsPerActionRaw: 5, rounding: "nearest" };
  let ticks = 0; zones.now = () => ticks += 9;
  let resume; zones.yieldFrame = () => new Promise(resolve => { resume = resolve; });
  const pending = zones.toggle(token, state, range);
  range.cellsPerActionRaw = 3; token.x = 800;
  zones.yieldFrame = async () => {}; resume(); await pending;
  assert.equal(zones.range.maxCost, 5); assert.equal(markerAt(zones, 1000, 500)?.style.fill, 0x357cbb);
  const markers = [...zones.container.children], measured = env.calls.length;
  zones.sync(token, state, true); assert.equal(zones.range.maxCost, 5);
  assert.deepEqual(zones.container.children, markers); assert.equal(env.calls.length, measured);
  await zones.toggle(token, state, range); await zones.toggle(token, state, range);
  assert.equal(zones.range.maxCost, 3); assert.equal(markerAt(zones, 900, 500), undefined);
  zones.sync(token, { ...state, sessionId: 2 }, true); assert.equal(canvas.interface.children.length, 0);
  const next = { sessionId: 2, start: { ...state.start, x: 800 } };
  await zones.toggle(token, next, range);
  assert.ok(zones.container.children.filter(marker => marker.x === 850 && marker.y === 550).every(marker => marker.style.fill === 0xd84b4b));
  assert.equal(canvas.interface.children.length, 1); zones.clear(); assert.equal(canvas.interface.children.length, 0);
});

test("zone tactique : dimensions invalides ou supérieures à 1 × 1 refusées avant toute exploration", async () => {
  for (const dimensions of [{ width: 2 }, { height: 2 }, { width: 0 }, { height: -1 }, { width: NaN }, { height: Infinity }]) {
    const { zones, token, state, calls } = setup(); Object.assign(state.start, dimensions);
    assert.equal((await zones.toggle(token, state, DEFAULT_RANGE)).reason, "Unsupported");
    assert.equal(calls.length, 0); assert.equal(zones.visible, false);
  }
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


test("régions : terrain neutre, surcoût et réduction positive par la préparation native", async () => {
  for (const [rate, count] of [[1, 2], [2, 1], [0.5, 4]]) {
    const env = setup(), { zones, token, state, behavior, canvas } = env;
    canvas.scene.regions = new Map([["region", {}]]);
    corridor(env, 6);
    let prepared = 0, measured = 0;
    behavior.terrain = path => {
      prepared++;
      const result = [{ ...path[0], terrain: null }];
      for (const point of path.slice(1)) {
        const prior = result.at(-1);
        result.push({ ...point, x: (prior.x + point.x) / 2, y: (prior.y + point.y) / 2,
          intermediate: true, terrain: { nativeRate: rate } });
        result.push({ ...point, terrain: { nativeRate: rate } });
      }
      return result;
    };
    behavior.constrain = path => {
      assert.ok(path.slice(1).every(point => point.terrain?.nativeRate === rate));
      // Couloir borné avec une frontière régionale à mi-case.
      return path.some(point => point.y !== 500 || point.x < 500 || point.x > 1100) ? [[path[0]], true] : [path, false];
    };
    behavior.measure = path => {
      measured++;
      assert.ok(path.some(point => point.intermediate));
      return { cost: path.slice(1).reduce((sum, point, index) =>
        sum + Math.abs(point.x - path[index].x) / 100 * canvas.grid.distance * point.terrain.nativeRate, 0), diagonals: 0 };
    };
    assert.equal(zones.supported(token, state.start), null);
    const result = await zones.toggle(token, state, { cellsPerActionRaw: 2, rounding: "nearest" });
    assert.equal(result.success, true);
    assert.ok(prepared > 0 && measured > 0);
    assert.equal(result.stats.marked, count);
    assert.ok(markerAt(zones, 500 + count * 100, 500));
    assert.equal(markerAt(zones, 600 + count * 100, 500), undefined);
  }
});

test("régions : données natives absentes ou altérées sans résultat partiel", async () => {
  for (const kind of ["absent", "terrain", "vertices"]) {
    const { zones, token, state, canvas, behavior } = setup();
    canvas.scene.regions = new Map([["region", {}]]);
    if (kind === "absent") token.object.createTerrainMovementPath = undefined;
    else if (kind === "terrain") behavior.terrain = path => path;
    else behavior.terrain = path => path.slice(0, 1);
    assert.equal((await zones.toggle(token, state, DEFAULT_RANGE)).reason, "TerrainUnavailable");
    assert.equal(canvas.interface.children.length, 0);
    assert.equal(zones.visible, false);
  }
});

test("coûts : nul, négatif ou quasi nul refusés ; non fini sans marqueurs", async () => {
  for (const cost of [0, -1, 1e-12, NaN]) {
    const { zones, token, state, behavior, canvas } = setup();
    behavior.measure = () => ({ cost, diagonals: 0 });
    const result = await zones.toggle(token, state, DEFAULT_RANGE);
    assert.equal(result.reason, Number.isNaN(cost) ? "Unavailable" : "NonpositiveCost");
    assert.equal(zones.visible, false);
    assert.equal(canvas.interface.children.length, 0);
  }
});

test("petits tokens : destinations réelles translatées, une case par état, aucun redimensionnement", async () => {
  for (const [width, height] of [[0.5, 0.5], [0.5, 1], [1, 0.5], [1, 1]]) {
    for (const inset of (width === 1 && height === 1 ? [0] : [0, 25, 75])) {
      const { zones, token, state, canvas, calls } = setup();
      Object.assign(state.start, { width, height, x: 500 + inset, y: 500 + inset });
      Object.assign(token, state.start);
      const before = JSON.stringify(state.start), position = { x: token.x, y: token.y, width: token.width, height: token.height };
      const origin = canvas.grid.getOffset(token.getMovementOrigin(state.start));
      const result = await zones.toggle(token, state, { cellsPerActionRaw: 1, rounding: "nearest" });
      assert.equal(result.success, true);
      assert.equal(result.stats.marked, 8);
      assert.equal(JSON.stringify(state.start), before);
      assert.deepEqual({ x: token.x, y: token.y, width: token.width, height: token.height }, position);
      assert.ok(calls.every(({ path }) => path[0].x === state.start.x && path[0].y === state.start.y
        && path.every(point => point.width === width && point.height === height
          && (point.x - state.start.x) % 100 === 0 && (point.y - state.start.y) % 100 === 0)));
      assert.equal(zones.container.children.filter(marker => marker.x === origin.j * 100 + 50 && marker.y === origin.i * 100 + 50 && marker.style.fill === 0xd84b4b).length, 1);
      assert.ok(zones.container.children.some(marker => marker.x === (origin.j + 1) * 100 + 50 && marker.y === origin.i * 100 + 50));
    }
  }
});

test("régions : réduction très faible toujours bornée sans marqueurs partiels", async () => {
  const { zones, token, state, behavior, canvas } = setup();
  canvas.scene.regions = new Map([["region", {}]]);
  behavior.measure = path => ({ cost: (path.length - 1) * 0.01, diagonals: 0 });
  zones.yieldFrame = async () => { zones.stats.maximumStates = zones.stats.states; };
  const result = await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(result.reason, "Limit");
  assert.equal(canvas.interface.children.length, 0);
});


test("origine rouge : unique, identique aux carrés bleus et figée sur la session", async () => {
  const { zones, token, state, canvas } = setup();
  Object.assign(state.start, { width: 0.5, height: 0.5, x: 525, y: 575 });
  token.x = 1500; token.y = 1500;
  assert.equal((await zones.toggle(token, state, DEFAULT_RANGE)).success, true);
  const origin = canvas.grid.getCenterPoint(canvas.grid.getOffset(token.getMovementOrigin(state.start)));
  const red = zones.container.children.filter(marker => marker.style.fill === 0xd84b4b);
  const blue = zones.container.children.filter(marker => marker.style.fill === 0x357cbb);
  assert.equal(red.length, 1);
  assert.equal(red[0].x, origin.x); assert.equal(red[0].y, origin.y);
  assert.equal(red[0].style.alpha, blue[0].style.alpha);
  assert.deepEqual(red[0].rectangle, blue[0].rectangle);
  assert.equal(red[0].eventMode, "none"); assert.equal(red[0].text, undefined);
  assert.ok(blue.every(marker => marker.x !== origin.x || marker.y !== origin.y));
  assert.equal(blue.length, zones.stats.marked);
  token.x = 1800; zones.sync(token, state, true);
  assert.equal(red[0].x, origin.x); assert.equal(red[0].y, origin.y);
  const container = zones.container;
  await zones.toggle(token, state, DEFAULT_RANGE);
  assert.equal(container.destroyed, true); assert.equal(canvas.interface.children.length, 0);
});

test("mesure : complétion native, coûts historiques retirés et sections vérifiées", async () => {
  const { zones, token, state, behavior, canvas } = setup();
  canvas.scene.regions = new Map([["region", {}]]);
  let completions = 0, measurements = 0;
  behavior.complete = path => {
    completions++;
    return path.map(point => ({ ...point, cost: 0 }));
  };
  behavior.measure = path => {
    measurements++;
    assert.ok(path.every(point => !("cost" in point)));
    const waypoints = path.map((_point, index) => ({ backward: index ? { cost: 4 } : null }));
    return { cost: (path.length - 1) * 4, diagonals: 0, waypoints };
  };
  const result = await zones.toggle(token, state, { cellsPerActionRaw: 1, rounding: "nearest" });
  assert.equal(result.success, true);
  assert.ok(completions > 0 && measurements > 0);
  assert.equal(result.stats.marked, 0); // Le coût natif de 4 dépasse les 2 unités autorisées.
  assert.equal(zones.container.children.length, 1);
  assert.equal(zones.container.children[0].style.fill, 0xd84b4b);
});

test("mesure : total incohérent, sections négatives et terrains perdus refusés", async () => {
  for (const kind of ["sum", "negative", "terrain", "action", "complete"]) {
    const { zones, token, state, behavior, canvas } = setup();
    canvas.scene.regions = new Map([["region", {}]]);
    if (kind === "terrain") {
      behavior.terrain = path => path.map(point => ({ ...point, terrain: { difficulty: 2 } }));
      behavior.constrain = path => [path.map(point => ({ ...point, terrain: null })), false];
    } else if (kind === "action") behavior.constrain = path => [path.map(point => ({ ...point, action: "displace" })), false];
    else if (kind === "complete") token.getCompleteMovementPath = undefined;
    else behavior.measure = path => ({ cost: 2, diagonals: 0,
      waypoints: path.map((_point, index) => ({ backward: index ? { cost: kind === "sum" ? 3 : -1 } : null })) });
    const result = await zones.toggle(token, state, DEFAULT_RANGE);
    assert.equal(result.reason, ["sum", "negative"].includes(kind) ? "Unavailable" : "TerrainUnavailable");
    assert.equal(canvas.interface.children.length, 0);
    assert.equal(zones.visible, false);
  }
});


test("région : contournement natif moins coûteux retenu seulement dans le budget", async () => {
  for (const budget of [2, 3]) {
    const env = setup(), { zones, token, state, canvas } = env;
    canvas.scene.regions = new Map([["region", {}]]);
    graph(env, [[[500, 500], [600, 500], 2], [[600, 500], [700, 500], 2],
      [[500, 500], [500, 400]], [[500, 400], [600, 400]], [[600, 400], [700, 500]]]);
    const result = await zones.toggle(token, state, { cellsPerActionRaw: budget, rounding: "nearest" });
    assert.equal(result.success, true);
    assert.equal(Boolean(markerAt(zones, 700, 500)), budget === 3);
  }
});

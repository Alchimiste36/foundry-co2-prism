import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { MovementZones } from "../module/movement/movement-zones.mjs";
import { movementScenario } from "./helpers/movement-zones-scenarios.mjs";
import { MovementTracker, roundMovementCells } from "../module/movement/movement-tracker.mjs";

const nativePath = process.env.CO2PRISM_FOUNDRY_SCRIPT ?? "F:/FVTT_V14/public/scripts/foundry.mjs";
const available = existsSync(nativePath);
const source = available ? readFileSync(nativePath, "utf8") : "";
const method = (signature, offset = 0) => {
  const start = source.indexOf(signature, offset), end = source.indexOf("\n  }\n", start);
  assert.ok(start >= 0 && end > start, `Méthode native introuvable : ${signature}`);
  return source.slice(start, end + 5);
};
let native;
if (available) {
  const enumStart = source.indexOf("const GRID_DIAGONALS = Object.freeze("), enumEnd = source.indexOf("\n});", enumStart);
  const code = source.slice(enumStart, enumEnd + 4);
  const context = vm.createContext({});
  vm.runInContext(`Math.SQRT3 = Math.sqrt(3);
    Number.prototype.almostEqual = function(n) { return Math.abs(this - n) < 1e-8; };
    ${code}
    class NativeGrid {
      constructor(diagonals, distance) { this.diagonals = diagonals; this.distance = distance; this.size = 100; }
      getOffset(p) { return p.i !== undefined ? p : { i: Math.floor(p.y / 100), j: Math.floor(p.x / 100), k: Math.floor((p.elevation ?? 0) / this.distance) }; }
      getCenterPoint(p) { return { x: p.j * 100 + 50, y: p.i * 100 + 50 }; }
      ${method("  #calculateCost(from, to, cost, diagonals, segment) {", source.indexOf("class SquareGrid "))}
      ${method("  getDirectPath(waypoints) {", source.indexOf("class SquareGrid "))}
      ${method("  #getDirectPath2D(waypoints) {", source.indexOf("class SquareGrid "))}
      ${method("  #getDirectPath3D(waypoints) {", source.indexOf("class SquareGrid "))}
      ${method("  measurePath(waypoints, options={}) {")}
      ${method("  _measurePath(waypoints, {cost}, result) {", source.indexOf("class SquareGrid "))}
    }
    class NativeToken {
      ${method("  async clearMovementHistory() {", source.indexOf("class TokenDocument "))}
    }
    globalThis.native = { NativeGrid, NativeToken, rules: GRID_DIAGONALS };`, context);
  native = context.native;
}

function session(rule, distance = 2) {
  const grid = new native.NativeGrid(rule, distance), user = { isGM: true };
  const scene = { id: "s", grid: { type: 1, distance, units: "m", diagonals: rule }, tokens: new Map() };
  const token = { id: "t", parent: scene, x: 300, y: 300, elevation: 0, width: 1, height: 1, depth: 0,
    shape: 1, level: "l", movementAction: "walk", movementHistory: [], canUserModify: () => true,
    clearMovementHistory() { assert.fail("L'historique partagé ne doit pas être effacé"); },
    async update(data) { const { action, ...position } = data; Object.assign(this, position); return this; } };
  scene.tokens.set(token.id, token);
  let extra = 0;
  const measure = path => grid.measurePath(path, { cost: (_from, _to, base, point) => base + (point.terrain?.supplement ?? extra) });
  token.object = { measureMovementPath: measure };
  const tracker = new MovementTracker({ getUser: () => user, readMovement: () => ({ cells: 1 }), getRounding: () => "nearest" });
  const prior = [{ x: 0, y: 0, elevation: 0 }, { x: 100, y: 100, elevation: 0 },
    { x: 200, y: 200, elevation: 0 }, { x: 300, y: 300, elevation: 0 }];
  token.movementHistory = prior.map(point => ({ ...point, movementId: "prior" }));
  const beforeHistory = JSON.stringify(token.movementHistory);
  const raw = [];
  let serial = 0, previousGlobalCost = measure(prior).cost;
  const begin = () => {
    raw.length = 0;
    const result = tracker.start(token);
    raw.push({ ...result.state.start, action: "walk", terrain: null });
    return result;
  };
  const move = (dx = 100, dy = 100, terrain = null) => {
    const origin = { x: token.x, y: token.y, elevation: 0 };
    token.x += dx; token.y += dy;
    const point = { x: token.x, y: token.y, elevation: 0, action: "walk", terrain };
    raw.push(point);
    const globalCost = measure([...prior, ...raw.slice(1)]).cost;
    const reported = globalCost - previousGlobalCost; previousGlobalCost = globalCost;
    return tracker.update(token, { id: String(++serial), origin,
      passed: { waypoints: [{ ...point, cost: reported }], cost: reported, distance: 2, spaces: 1 },
      history: { distance: serial * 2, spaces: serial } });
  };
  return { tracker, token, scene, grid, begin, move, measure, raw, beforeHistory, setExtra: value => { extra = value; } };
}

for (const [name, rule] of Object.entries(native?.rules ?? { "source absente": 0 })) {
  test(`coût natif Core v14.370 : ${name}, historique antérieur et nouvelle session`, { skip: !available }, () => {
    const env = session(rule), { tracker, token, begin, move, measure, raw, beforeHistory } = env;
    assert.equal(begin().state.cellsUsed, 0);
    for (let index = 0; index < 3; index++) {
      const state = move().state, expected = measure(raw);
      assert.equal(state.cost, expected.cost);
      assert.equal(state.costCellsRaw, expected.cost / 2);
      assert.equal(state.cellsUsed, roundMovementCells(expected.cost / 2));
    }
    tracker.finish(token); assert.equal(begin().state.cost, 0);
    const next = move().state;
    assert.equal(next.cost, measure(raw).cost);
    assert.equal(JSON.stringify(token.movementHistory), beforeHistory);
  });
}

test("coût natif : région simulée, supplément retourné par l'oracle, unités de grille", { skip: !available }, () => {
  const { tracker, begin, move, token, raw, measure } = session(native.rules.RECTILINEAR, 5);
  token.parent.regions = new Map([["r", {}]]);
  begin();
  const state = move(100, 100, { supplement: 5 }).state;
  assert.equal(state.cost, measure(raw).cost); assert.equal(state.cost, 15);
  assert.equal(state.costCellsRaw, 3); assert.equal(state.spaces, 1);
  assert.equal(state.cellsPerAction, 1); assert.equal(tracker.getSnapshot(token).state.cellsUsed, 3);
});

test("coût natif : reset local remet la continuité à zéro sans effacer l'historique partagé", { skip: !available }, async () => {
  const { tracker, token, begin, move, measure, raw, beforeHistory } = session(native.rules.ALTERNATING_1);
  const origin = begin().state.start;
  move(); move();
  const result = await tracker.reset(token);
  assert.equal(result.success, true); assert.equal(result.state.cost, 0);
  assert.equal(token.x, origin.x); assert.equal(token.y, origin.y);
  raw.splice(1); assert.equal(move().state.cost, measure(raw).cost);
  assert.equal(JSON.stringify(token.movementHistory), beforeHistory);
});

test("contrat source clearMovementHistory : aucune coordonnée dans la mutation", { skip: !available }, async () => {
  const token = new native.NativeToken(), calls = [];
  token._source = { _movementHistory: [{ x: 0, y: 0 }], x: 100, y: 200, elevation: 3 };
  token.update = async (changed, options) => {
    calls.push({ changed, options });
    if (options._clearMovementHistory) token._source._movementHistory = [];
  };
  await token.clearMovementHistory();
  assert.equal(Object.keys(calls[0].changed).length, 0);
  assert.equal(calls[0].options._clearMovementHistory, true);
  assert.deepEqual([token._source.x, token._source.y, token._source.elevation], [100, 200, 3]);
  assert.equal(token._source._movementHistory.length, 0);
});

test("coût natif : coûts déjà appliqués figés, contexte diagonal conservé", { skip: !available }, () => {
  const { token, tracker, begin, move, setExtra } = session(native.rules.ALTERNATING_1);
  begin(); const first = move().state.cost;
  const measure = token.object.measureMovementPath;
  let lastPath;
  token.object.measureMovementPath = path => { lastPath = path; return measure(path); };
  setExtra(5); const second = move().state;
  assert.equal(lastPath[1].cost, first);
  assert.equal(lastPath[2].cost, undefined);
  assert.equal(second.cost, token.object.measureMovementPath(lastPath).cost);
  assert.ok(second.cost > first + 5);
});


for (const name of ["EQUIDISTANT", "EXACT", "APPROXIMATE", "RECTILINEAR", "ALTERNATING_1", "ALTERNATING_2", "ILLEGAL"]) {
  test("zone tactique : grille native v14, diagonales " + name, { skip: !available }, async () => {
    const env = movementScenario(MovementZones, { cells: 3 }), grid = new native.NativeGrid(native.rules[name], 2);
    const origin = env.state.start;
    env.token.object.measureMovementPath = path => grid.measurePath(path);
    const result = await env.zones.toggle(env.token, env.state, env.range);
    assert.equal(result.success, true);
    const expected = [];
    for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) {
      if (!di && !dj) continue;
      const target = { ...origin, x: origin.x + dj * 100, y: origin.y + di * 100 };
      const path = name === "ILLEGAL" ? [origin, { ...origin, x: target.x }, target] : [origin, target];
      if (grid.measurePath(path).cost <= 6 + 1e-8) expected.push([target.x + 50, target.y + 50]);
    }
    expected.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    assert.deepEqual(env.markers().filter(marker => marker[3] === 0x357cbb).map(marker => marker.slice(0, 2)), expected);
    env.zones.clear();
  });
}

test("contrat natif v14 : préparation régionale avant contrainte et mesure", { skip: !available }, () => {
  const context = vm.createContext({
    canvas: { visibility: { tokenVision: false } },
    CONFIG: { Token: { movement: { TerrainData: { resolveTerrainEffects: effects =>
      effects.length ? { difficulty: effects[0].difficulty, equals(other) { return this.difficulty === other.difficulty; } } : null } } } },
    REGION_MOVEMENT_SEGMENTS: { MOVE: 0 },
    TokenDocument: { arePositionsEqual: (a, b) => a.x === b.x && a.y === b.y && a.elevation === b.elevation }
  });
  vm.runInContext("class NativeTerrainToken { " + method("  createTerrainMovementPath(waypoints, options={}) {") +
    " }; globalThis.NativeTerrainToken = NativeTerrainToken;", context);
  const token = new context.NativeTerrainToken();
  const start = { x: 500, y: 500, elevation: 0, width: 1, height: 1, depth: 0, shape: 1, level: "l" };
  token.document = { _source: start, movementAction: "walk",
    getMovementOrigin: point => ({ x: point.x + 50, y: point.y + 50, elevation: point.elevation }),
    testInsideRegion: (_region, point) => point.x >= 550,
    segmentizeRegionMovementPath: (_region, [from, to]) =>
      from.x < 550 && to.x >= 550 ? [{ type: 1, from: { ...from, x: 550 } }] : [] };
  const behavior = { disabled: false, system: { _getTerrainEffects: () => [{ difficulty: 2 }] } };
  const region = { hidden: false, includedInLevel: () => true, behaviors: [behavior] };
  token.scene = { regions: [region], dimensions: { distancePixels: 50 } };
  const path = token.createTerrainMovementPath([start, { ...start, x: 600 }], { preview: false });
  assert.equal(path.length, 3);
  assert.equal(path[1].x, 550);
  assert.equal(path[1].intermediate, true);
  assert.equal(path[1].terrain, null);
  assert.equal(path[2].terrain.difficulty, 2);
  behavior.system._getTerrainEffects = () => [];
  const neutral = token.createTerrainMovementPath([start, { ...start, x: 600 }], { preview: false });
  assert.equal(neutral.length, 2);
  assert.equal(neutral[1].terrain, null);
});


test("contrat v14 : une case en terrain natif difficulté 2, zone et tracker concordants", { skip: !available }, async () => {
  const context = vm.createContext({
    canvas: { visibility: { tokenVision: false } }, NativeGrid: native.NativeGrid,
    CONFIG: { Token: { movement: { costAggregator: results => results[0].cost,
      actions: { walk: { walls: "move", teleport: false, measure: true, getCostFunction: () => cost => cost } } } } }
  });
  vm.runInContext(
    "class TerrainData { constructor(data) { Object.assign(this, data); } clone() { return new TerrainData(this); } " +
    method("  static resolveTerrainEffects(effects, options) {", source.indexOf("class TerrainData ")) +
    method("  static getMovementCostFunction(token, options) {", source.indexOf("class TerrainData ")) +
    method("  equals(other) {", source.indexOf("class TerrainData ")) + " };" +
    "CONFIG.Token.movement.TerrainData = TerrainData;" +
    "class TokenDocument { " +
    method("  measureMovementPath(waypoints, {cost, aggregator}={}) {", source.indexOf("class TokenDocument ")) +
    method("  static #removeResizeSegmentsFromMeasurementResult(path, result) {") +
    method("  static #createMovementCostFunction(grid, cost, aggregator, width, height, depth, shape) {") +
    method("  static #createSquareMovementCostFunction(cost, aggregator, width, height, depth) {") +
    method("  static #createHexagonalMovementCostFunction(grid, cost, aggregator, width, height, depth, shape) {") +
    method("  getCompleteMovementPath(waypoints) {") + " };" +
    "class NativeObject { " +
    method("  measureMovementPath(waypoints, options) {", source.indexOf("class Token extends ")) +
    method("  _getMovementCostFunction(options) {", source.indexOf("class Token extends ")) +
    method("  createTerrainMovementPath(waypoints, options={}) {") + " };" +
    "globalThis.NativeObject = NativeObject; globalThis.NativeDocument = TokenDocument;", context);
  const env = movementScenario(MovementZones, { cells: 1 });
  const grid = new native.NativeGrid(native.rules.EQUIDISTANT, 1.5);
  grid.isSquare = true; grid.type = 1;
  const start = { x: 3100, y: 2000, elevation: 0, width: 1, height: 1, depth: 1, shape: 1, level: "l" };
  const document = new context.NativeDocument();
  const object = new context.NativeObject();
  const scene = env.token.parent;
  scene.grid = grid;
  scene.regions = [{ hidden: false, includedInLevel: () => true,
    behaviors: [{ disabled: false, system: { _getTerrainEffects: () => [{ name: "difficulty", difficulty: 2 }] } }] }];
  scene.regions.size = 1;
  scene.dimensions = { distancePixels: 100 / 1.5 };
  Object.assign(document, { _source: start, movementAction: "walk", parent: scene });
  Object.assign(object, { document, scene });
  // Géométrie régionale simulée ; les fonctions de coût et de mesure sont celles du Core.
  document.getMovementOrigin = point => ({ x: point.x + 50, y: point.y + 50, elevation: point.elevation + 0.75 });
  document.testInsideRegion = () => true;
  document.segmentizeRegionMovementPath = () => [];
  document.getSnappedPosition = point => point;
  document._positionToGridOffset = point => grid.getOffset({ ...point, x: point.x + 50, y: point.y + 50 });
  document._gridOffsetToPosition = offset => ({ x: offset.j * 100, y: offset.i * 100, elevation: offset.k * 1.5 });
  const input = [start, { ...start, x: 3200 }];
  const regional = object.createTerrainMovementPath(input, { preview: false });
  const completed = document.getCompleteMovementPath(regional);
  const nativeMeasurement = object.measureMovementPath(completed, { preview: false });
  assert.equal(object.measureMovementPath(regional, { preview: false }).cost, 3);
  assert.equal(nativeMeasurement.cost, 3);
  assert.equal(nativeMeasurement.waypoints[1].backward.cost, 3);
  const originalConstraint = env.token.object.constrainMovementPath;
  Object.assign(env.token, start, { getCompleteMovementPath: path => document.getCompleteMovementPath(path) });
  Object.assign(env.token.object, { createTerrainMovementPath: path => object.createTerrainMovementPath(path, { preview: false }),
    measureMovementPath: path => object.measureMovementPath(path, { preview: false }),
    constrainMovementPath: path => originalConstraint(path) });
  env.state.start = start;
  // Le canvas du scénario utilise aussi 1,5 unité par case.
  const localCanvas = env.zones.getCanvas(); localCanvas.grid.distance = 1.5;
  const zone = await env.zones.toggle(env.token, env.state, env.range);
  assert.equal(zone.success, true);
  assert.equal(zone.stats.marked, 0);
  const tracker = new MovementTracker({ getUser: () => ({ isGM: true }), readMovement: () => ({ cells: 1 }) });
  assert.equal(tracker.start(env.token).success, true);
  const actual = tracker.update(env.token, { id: "native", origin: start,
    passed: { waypoints: completed.slice(1), cost: nativeMeasurement.cost } });
  assert.equal(actual.state.cost, nativeMeasurement.cost);
  assert.equal(actual.state.costCellsRaw, 2);
});

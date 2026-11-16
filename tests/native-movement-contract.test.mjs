import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
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

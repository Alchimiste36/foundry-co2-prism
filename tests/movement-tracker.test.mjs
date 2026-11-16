import test from "node:test";
import assert from "node:assert/strict";
import { MovementTracker, movementThreshold } from "../module/movement/movement-tracker.mjs";
import { measureRecordedPath } from "./helpers/native-movement-double.mjs";

function setup() {
  const user = { isGM: false }, updates = [];
  let rounding = "nearest";
  const scene = { id: "scene", tokens: new Map(), grid: { type: 1, distance: 2, units: "m" } };
  const actor = { speedCells: 5, setFlag() { assert.fail("Pas de budget ni de flag"); } };
  const tracker = new MovementTracker({ getUser: () => user, readMovement: token => ({ cells: token.actor.speedCells }),
    getRounding: () => rounding });
  const create = (id, parent = scene) => {
    const token = { id, parent, actor, x: 0, y: 0, elevation: 3, width: 2, height: 2, depth: 1, shape: 1, level: "level",
      movementHistory: [], testUserPermission: () => true, canUserModify: () => true,
      object: { measureMovementPath: measureRecordedPath },
      async update(data) {
        updates.push(data); Object.assign(this, Object.fromEntries(Object.entries(data).filter(([key]) => key !== "action")));
        tracker.update(this, { id: "return", origin: { x: 100, y: 0 }, passed: { waypoints: [{ x: 0, y: 0 }], distance: 100, spaces: 50 } });
        return this;
      } };
    parent.tokens.set(id, token); return token;
  };
  let serial = 0;
  const move = (token, { x = token.x + 100, y = token.y, distance = 2, spaces = 1, cost = spaces * token.parent.grid.distance,
    method = "dragging", id = String(++serial), waypoints } = {}) => {
    const origin = { x: token.x, y: token.y, elevation: token.elevation };
    token.x = x; token.y = y;
    const points = waypoints ?? [{ x, y, elevation: token.elevation }];
    const native = points.map(point => ({ elevation: token.elevation, ...point,
      terrain: { testCost: cost / points.length, testDistance: distance / points.length, testSpaces: spaces / points.length } }));
    const movement = { id, origin, method, passed: { waypoints: native, distance, spaces, cost },
      history: { distance: serial * 2, spaces: serial } };
    return { result: tracker.update(token, movement), movement };
  };
  const token = create("one");
  return { user, updates, scene, actor, tracker, token, create, move, setRounding: mode => { rounding = mode; } };
}

test("15B démarrage : token existant, permissions, modes, doublons et snapshot isolé", () => {
  const { tracker, token } = setup();
  assert.equal(tracker.start(null).reason, "invalid-token");
  token.testUserPermission = () => false;
  assert.equal(tracker.start(token).reason, "forbidden");
  token.testUserPermission = () => true;
  token.movement = { state: "pending" };
  assert.equal(tracker.start(token).reason, "movement-in-progress");
  token.movement.state = "completed";
  const result = tracker.start(token);
  assert.equal(result.success, true); assert.equal(result.state.mode, "exact");
  assert.equal(result.state.start.elevation, 3); assert.equal(result.state.start.width, 2);
  result.state.start.x = 99;
  assert.equal(tracker.getSnapshot(token).state.start.x, 0);
  assert.equal(tracker.start(token).reason, "already-active");
});

test("15B sessions distinctes par scène/token, même acteur et mêmes IDs sur deux scènes", () => {
  const { tracker, token, create, move } = setup();
  const second = create("two"), third = create("one", { id: "other", tokens: new Map(), grid: token.parent.grid });
  for (const t of [token, second, third]) assert.equal(tracker.start(t).success, true);
  move(token); move(second, { spaces: 4 });
  assert.deepEqual([token, second, third].map(t => tracker.getSnapshot(t).state.spaces), [1, 4, 0]);
});

test("15B sections natives : clavier/drag, détours, multi-waypoints et phases sans double comptage", () => {
  const { tracker, token, move } = setup();
  tracker.start(token);
  const first = move(token, { method: "keyboard" });
  assert.equal(tracker.update(token, structuredClone(first.movement)).reason, "already-counted");
  tracker.refresh(token); tracker.refresh(token);
  move(token, { x: 0, waypoints: [{ x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }], distance: 6, spaces: 3 });
  const state = tracker.getSnapshot(token).state;
  assert.equal(state.current.x, state.start.x);
  assert.equal(state.distance, 8); assert.equal(state.spaces, 4); assert.equal(state.cost, 8);
  assert.equal(state.segmentCount, 2);
});

test("15B suivi exact, mesures brutes, arrondi final et vitesse relue", () => {
  const { tracker, token, actor, move, setRounding } = setup();
  tracker.start(token);
  move(token, { spaces: 2.6, distance: 5.2 });
  move(token, { spaces: 2.6, distance: 5.2 });
  const state = tracker.getSnapshot(token).state;
  assert.equal(state.spaces, 5.2); assert.equal(state.cellsUsed, 5); assert.equal(state.theoreticalActions, 1);
  setRounding("up");
  assert.equal(tracker.getSnapshot(token).state.cellsUsed, 6);
  assert.equal(tracker.getSnapshot(token).state.theoreticalActions, 2);
  actor.speedCells = 10;
  assert.equal(tracker.getSnapshot(token).state.theoreticalActions, 1);
  assert.equal(token.x, 200);
});

test("15B historique effacé entre mouvements : trajet conservé, retour contrôlé sans clear", async () => {
  const { tracker, token, move, updates } = setup();
  token.movementHistory = [{ x: -100, y: 0, movementId: "old" }];
  tracker.start(token); move(token); token.movementHistory = []; move(token);
  assert.equal(tracker.getSnapshot(token).state.spaces, 2);
  const result = await tracker.reset(token);
  assert.equal(result.success, true); assert.equal(result.state.spaces, 0);
  assert.equal(result.state.active, true); assert.equal(result.state.mode, "exact");
  assert.equal(result.state.resetting, false); assert.equal(token.x, 0); assert.equal(token.elevation, 3);
  assert.equal(updates[0]._movementHistory, undefined);
  move(token); assert.equal(tracker.getSnapshot(token).state.spaces, 1);
});

test("15B retour natif : préserver le préfixe historique et annuler plusieurs mouvements", async () => {
  const { tracker, token, move, updates } = setup();
  const start = { ...token }; delete start.parent; delete start.actor;
  const old = { x: -100, y: 0, movementId: "old" }, before = { ...start, movementId: "old" };
  token.movementHistory = [old, before];
  tracker.start(token); move(token); move(token);
  token.movementHistory.push({ x: 100, y: 0, movementId: "first" }, { x: 200, y: 0, movementId: "second" });
  token.revertRecordedMovement = async id => {
    assert.equal(id, "first"); token.movementHistory = [old, before];
    await token.update({ x: 0, y: 0, elevation: 3 }); return true;
  };
  assert.equal((await tracker.reset(token)).success, true);
  assert.equal(token.movementHistory.length, 2); assert.equal(updates.length, 1);
});

test("15B échec/permissions du retour : compteur conservé, concurrence protégée", async () => {
  const { tracker, token, move } = setup();
  tracker.start(token); move(token);
  token.canUserModify = () => false;
  assert.equal((await tracker.reset(token)).reason, "forbidden");
  token.canUserModify = () => true;
  token.update = async () => { throw Error("server"); };
  assert.equal((await tracker.reset(token)).reason, "return-failed");
  assert.equal(tracker.getSnapshot(token).state.spaces, 1);
  token.update = async () => token;
  assert.equal((await tracker.reset(token)).success, false);
  let release;
  token.update = () => new Promise(resolve => { release = resolve; });
  const pending = tracker.reset(token);
  assert.equal((await tracker.reset(token)).reason, "movement-in-progress");
  assert.equal(tracker.finish(token).success, false); assert.equal(tracker.cancel(token).success, false);
  release(false); await pending;
});

test("15B finish/cancel : aucune mutation, destination conservée et session libérée", () => {
  const { tracker, token, move, updates } = setup();
  tracker.start(token); move(token);
  const final = tracker.finish(token);
  assert.equal(final.state.active, false); assert.equal(final.state.spaces, 1);
  assert.equal(token.x, 100); assert.equal(tracker.getSnapshot(token).reason, "no-session");
  tracker.start(token); move(token);
  assert.equal(tracker.cancel(token).success, true); assert.equal(token.x, 200);
  assert.deepEqual(updates, []);
});

test("15B invalidité explicite : sans grille, mesure absente, coût distinct, téléportation native", () => {
  const { tracker, token, scene, move } = setup();
  scene.grid.type = 0; tracker.start(token); move(token);
  assert.equal(tracker.getSnapshot(token).state.measurementReason, "grid-unavailable");
  assert.equal(tracker.getSnapshot(token).state.cellsUsed, null);
  scene.grid.type = 1;
  move(token, { x: 9999, distance: 0, spaces: 0, cost: 0 });
  assert.equal(tracker.getSnapshot(token).state.spaces, 1);
  move(token, { distance: NaN });
  assert.equal(tracker.getSnapshot(token).state.measurementValid, false);
  assert.equal(tracker.update(token, {}).reason, "invalid-movement");
});

test("15B nettoyage ciblé : suppression du token et fermeture de scène", () => {
  const { tracker, token, create, scene } = setup();
  const second = create("two"), other = create("one", { id: "other", tokens: new Map(), grid: scene.grid });
  for (const t of [token, second, other]) tracker.start(t);
  tracker.deleteToken(token);
  assert.equal(tracker.getSnapshot(token).success, false);
  assert.equal(tracker.getSnapshot(second).success, true);
  tracker.closeScene(scene);
  assert.equal(tracker.getSnapshot(second).success, false);
  assert.equal(tracker.getSnapshot(other).success, true);
});

test("15B identifiant partagé : deux checkpoints sont cumulés, pas leurs doublons", () => {
  const { tracker, token, move } = setup();
  tracker.start(token);
  const first = move(token, { id: "same", spaces: 1 });
  const second = move(token, { id: "same", spaces: 2 });
  tracker.update(token, first.movement); tracker.update(token, second.movement);
  assert.equal(tracker.getSnapshot(token).state.spaces, 3);
});

test("15B historique vide initial : revert natif revient au premier waypoint, zéro action", async () => {
  const { tracker, token, move } = setup();
  tracker.start(token);
  const origin = { ...tracker.getSnapshot(token).state.start, movementId: "new" };
  move(token);
  token.movementHistory = [origin, { ...origin, x: 100 }];
  token.revertRecordedMovement = async id => {
    assert.equal(id, "new");
    token.x = origin.x; token.movementHistory = []; return true;
  };
  const result = await tracker.reset(token);
  assert.equal(result.success, true); assert.equal(result.state.theoreticalActions, 0);
});

test("Session exacte unique, indépendante par token", () => {
  const { tracker, token, create } = setup();
  assert.equal(tracker.start(token).state.mode, "exact");
  const second = create("second");
  assert.equal(tracker.start(second).state.mode, "exact");
  assert.equal(tracker.getSnapshot(token).state.mode, "exact");
  tracker.finish(token);
  assert.equal(tracker.start(token).state.mode, "exact");
});

test("Sans activation : aucun suivi implicite ; démarrage exact à la position courante", () => {
  const { tracker, token, move, updates } = setup();
  assert.equal(move(token).result.reason, "no-session");
  assert.equal(move(token).result.reason, "no-session");
  assert.equal(tracker.getSnapshot(token).reason, "no-session");
  assert.equal(tracker.sessions.size, 0); assert.deepEqual(updates, []);
  const state = tracker.start(token).state;
  assert.equal(state.mode, "exact"); assert.equal(state.start.x, 200); assert.equal(state.spaces, 0);
  assert.equal(typeof tracker.setMode, "undefined");
  move(token);
  assert.equal(tracker.getSnapshot(token).state.spaces, 1);
});

test("Archive6 seuils 4 puis 7 : vitesse brute conservée et plus petit coût suffisant", () => {
  const { tracker, actor, token, move } = setup();
  actor.speedCells = 3.6;
  const thresholds = [0, 1, 2, 3, 4, 5].map(n => movementThreshold(3.6, n, "nearest"));
  assert.deepEqual(thresholds, [0, 4, 7, 11, 14, 18]);
  assert.deepEqual(thresholds.slice(1).map((value, index) => value - thresholds[index]), [4, 3, 4, 3, 4]);
  for (const [used, expected] of [[0, 0], [1, 1], [4, 1], [5, 2], [6, 2], [7, 2], [8, 3], [11, 3], [12, 4]]) {
    tracker.start(token); move(token, { spaces: used });
    const state = tracker.getSnapshot(token).state;
    assert.equal(state.cellsPerActionRaw, 3.6); assert.equal(state.cellsPerAction, 4);
    assert.equal(state.theoreticalActions, expected);
    tracker.cancel(token);
  }
});

test("Archive6 trois arrondis : seuils cumulatifs, blocs alternés et coût minimal", () => {
  const { tracker, actor, token, move, setRounding } = setup();
  actor.speedCells = 10 / 3;
  for (const [mode, expected] of [["nearest", [0, 3, 7, 10, 13, 17]], ["up", [0, 4, 7, 10, 14, 17]],
    ["down", [0, 3, 6, 10, 13, 16]]]) {
    setRounding(mode);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(n => movementThreshold(actor.speedCells, n, mode)), expected);
    for (let used = 1; used <= 20; used++) {
      tracker.start(token); move(token, { spaces: used });
      const n = tracker.getSnapshot(token).state.theoreticalActions;
      assert.ok(movementThreshold(actor.speedCells, n, mode) >= used);
      assert.ok(movementThreshold(actor.speedCells, n - 1, mode) < used);
      tracker.cancel(token);
    }
  }
});

test("Archive6 vitesse fractionnaire : blocs nuls, recherche bornée et invalidité", () => {
  const { tracker, actor, token, move, setRounding } = setup();
  actor.speedCells = 0.2;
  for (const [mode, expected] of [["down", 5], ["nearest", 3], ["up", 1]]) {
    setRounding(mode); tracker.start(token); move(token, { spaces: 1 });
    assert.equal(tracker.getSnapshot(token).state.theoreticalActions, expected);
    tracker.cancel(token);
  }
  for (const raw of [0, null, NaN, Infinity, -1, Number.MIN_VALUE]) {
    actor.speedCells = raw; tracker.start(token); move(token, { spaces: 1 });
    assert.equal(tracker.getSnapshot(token).state.theoreticalActions, null);
    tracker.cancel(token);
  }
});

test("coût natif : conversion en cases après cumul, distinct des espaces géométriques", () => {
  const { tracker, token, move, setRounding } = setup();
  tracker.start(token);
  move(token, { spaces: 1, cost: 2.8 }); move(token, { spaces: 1, cost: 2.8 });
  const state = tracker.getSnapshot(token).state;
  assert.equal(state.spaces, 2); assert.equal(state.cost, 5.6); assert.equal(state.costCellsRaw, 2.8);
  assert.equal(state.cellsUsed, 3);
  setRounding("down"); assert.equal(tracker.getSnapshot(token).state.cellsUsed, 2);
});

test("coût natif : préfixes chevauchants du même mouvement comptés une seule fois", () => {
  const { tracker, token, move } = setup();
  tracker.start(token);
  const first = move(token, { id: "checkpoints" });
  const second = { ...first.movement, passed: { ...first.movement.passed,
    waypoints: [...first.movement.passed.waypoints, { x: 200, y: 0, elevation: 3,
      terrain: { testCost: 4, testDistance: 2, testSpaces: 1 } }], cost: 6 }, history: { spaces: 99 } };
  token.x = 200;
  tracker.update(token, second);
  assert.equal(tracker.getSnapshot(token).state.cost, 6);
  tracker.update(token, { ...second, history: { spaces: 100 } });
  assert.equal(tracker.getSnapshot(token).state.cost, 6);
  assert.equal(tracker.getSnapshot(token).state.segmentCount, 2);
});

test("coût natif : API/cout/terrain manquant, jamais de repli sur spaces", () => {
  for (const invalidate of [token => { token.object = null; },
    token => { token.object.measureMovementPath = () => ({ spaces: 10, distance: 20, cost: NaN, waypoints: [] }); },
    token => { token.parent.regions = new Map([["r", {}]]); }]) {
    const { tracker, token } = setup(); tracker.start(token); invalidate(token);
    tracker.update(token, { id: "invalid", origin: { x: 0, y: 0, elevation: 3 },
      passed: { waypoints: [{ x: 100, y: 0, elevation: 3 }], spaces: 10, distance: 20, cost: 20 } });
    const state = tracker.getSnapshot(token).state;
    assert.equal(state.cellsUsed, null); assert.equal(state.measurementValid, false);
  }
});

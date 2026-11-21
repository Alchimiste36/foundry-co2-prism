import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

function setup() {
  const hooks = new Map(), writes = [];
  const actor = uuid => ({ uuid });
  const a = actor("Actor.a"), b = actor("Actor.b"), synthetic = actor("Scene.s.Token.t.Actor.a");
  const combat = { started: true, current: { round: 0, turn: null, combatantId: null },
    combatants: new Map([["a", { actor: a }], ["b", { actor: b }], ["c", { actor: a }], ["t", { actor: synthetic }]]) };
  // Une Collection Foundry itère ses documents.
  combat.combatants[Symbol.iterator] = function* () { yield* this.values(); };
  const context = vm.createContext({ console, game: { system: { id: "co2" }, user: { isActiveGM: true }, combats: [combat] },
    Hooks: { once: (name, fn) => hooks.set(name, fn), on: (name, fn) => hooks.set(name, fn) },
    ActionEconomy: class { constructor(actor) { this.actor = actor; } async reset({ beforeReset } = {}) { writes.push(this.actor); await beforeReset?.(); return { success: true }; } } });
  vm.runInContext(readFileSync(new URL("../module/combat/defense.mjs", import.meta.url), "utf8").replace(/export /g, ""), context);
  vm.runInContext(readFileSync(new URL("../module/combat/combat-lifecycle.mjs", import.meta.url), "utf8")
    .replace(/import[^;]+;/g, ""), context);
  hooks.get("ready")();
  const turn = (round, index, id) => {
    const previous = combat.current;
    combat.current = { round, turn: index, combatantId: id };
    hooks.get("combatTurnChange")(combat, previous, combat.current);
  };
  return { hooks, context, combat, writes, a, b, synthetic, turn };
}

test("13 cycle : premier tour, changement réel, doublons et acteurs effectifs", async () => {
  const { hooks, combat, writes, a, b, synthetic, turn } = setup();
  turn(1, 0, "a");
  turn(1, 0, "a");
  hooks.get("updateCombat")(combat, { name: "Combat" });
  turn(1, 1, "b"); turn(1, 2, "c"); turn(1, 3, "t");
  assert.deepEqual(writes, [a, b, a, synthetic]);
  hooks.get("ready")(); turn(1, 3, "t");
  assert.equal(writes.length, 4);
});

test("13 fin : suppression, participants seulement, déduplication et MJ actif", async () => {
  const { hooks, context, combat, writes, a, b, synthetic } = setup();
  context.game.user.isActiveGM = false;
  hooks.get("combatTurnChange")(combat, combat.current, { round: 1, turn: 0, combatantId: "a" });
  assert.equal(writes.length, 0);
  context.game.user.isActiveGM = true;
  combat.previous = { round: 1 };
  hooks.get("updateCombat")(combat, { round: 0 });
  await new Promise(resolve => setImmediate(resolve));
  hooks.get("deleteCombat")(combat);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [a, b, synthetic]);
});

test("13 suppression directe sans interface et sans changement de tour", async () => {
  const { hooks, combat, writes, a, b, synthetic } = setup();
  hooks.get("deleteCombat")(combat);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [a, b, synthetic]);
});

test("Defense reset targets the incoming actor on the existing turn hook", async () => {
  const { hooks, context, combat, a, b, turn } = setup();
  context.game.settings = { get: () => false };
  context.game.system.CONST = { defenseStances: [{ id: "partialDef" }, { id: "fullDef" }] };
  const removed = [];
  for (const [actor, id] of [[a, "partialDef"], [b, "fullDef"]]) {
    const statuses = new Set([id]);
    actor.hasEffect = status => statuses.has(status);
    actor.toggleStatusEffect = async (status, options) => {
      assert.equal(options.active, false);
      removed.push([actor.uuid, status]); statuses.delete(status);
      return false;
    };
  }
  hooks.get("updateCombat")(combat, { name: "Edited" });
  assert.deepEqual(removed, []);
  turn(1, 0, "a"); turn(1, 0, "a");
  assert.deepEqual(removed, [[a.uuid, "partialDef"]]);
  assert.equal(b.hasEffect("fullDef"), true);
  turn(1, 1, "b");
  assert.deepEqual(removed, [[a.uuid, "partialDef"], [b.uuid, "fullDef"]]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { ActionEconomy } from "../module/combat/action-economy.mjs";

function setup(flags = {}) {
  const writes = [];
  const user = { isGM: false };
  const actor = {
    flags: structuredClone(flags), owner: true,
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    testUserPermission(who, level) { assert.equal(who, user); assert.equal(level, "OWNER"); return this.owner; },
    async setFlag(scope, key, value) {
      await Promise.resolve();
      writes.push({ scope, key, value: structuredClone(value) });
      this.flags[scope] ??= {}; this.flags[scope][key] = structuredClone(value);
    }
  };
  const engine = new ActionEconomy(actor, { getUser: () => user });
  return { engine, actor, writes, user };
}

test("état initial alternatif, lectures indépendantes et aucune écriture", () => {
  const { engine, writes } = setup();
  const state = engine.getSnapshot();
  assert.equal(state.branch, "undecided");
  assert.deepEqual(state.normalAlternatives, [["l"], ["m", "am"]]);
  assert.deepEqual(state.normal, { l: true, m: true, am: true });
  assert.deepEqual(state.canSpend, { l: true, a: true, am: true, m: true });
  assert.equal(state.movementsRemaining, 2); assert.equal(state.movementsMaximum, 2);
  state.normal.m = false; state.bonus.m = 9; state.granted.am = 7;
  assert.equal(engine.getSnapshot().movementsRemaining, 2);
  assert.equal(writes.length, 0);
});

test("15D règlement atomique : priorités identiques à spend(m), une seule écriture", async () => {
  const { engine, writes } = setup();
  await engine.grant("m"); await engine.grant("am");
  const before = writes.length;
  const result = await engine.spendMovements(7);
  assert.equal(result.success, true); assert.equal(result.consumedCount, 4); assert.equal(result.missingCount, 3);
  assert.deepEqual(result.consumedSlots, [{ pool: "bonus", slot: "m" }, { pool: "normal", slot: "m" },
    { pool: "bonus", slot: "am" }, { pool: "normal", slot: "am" }]);
  assert.equal(writes.length, before + 1); assert.equal(engine.getSnapshot().movementsRemaining, 0);
  const empty = await engine.spendMovements(2);
  assert.equal(empty.consumedCount, 0); assert.equal(empty.missingCount, 2); assert.equal(writes.length, before + 1);
});

test("15D erreur atomique : aucun débit partiel, réessai et garde dans la file", async () => {
  const { engine, actor, writes } = setup();
  const save = actor.setFlag;
  actor.setFlag = async () => { throw Error("save failed"); };
  const result = await engine.spendMovements(2);
  assert.equal(result.reason, "persistence-failed"); assert.equal(result.consumedCount, 0);
  assert.equal(engine.getSnapshot().movementsRemaining, 2);
  actor.setFlag = save;
  const version = engine.getResetVersion();
  const queued = engine.spendMovements(2, { validate: () => engine.getResetVersion() === version });
  const reset = engine.reset();
  assert.equal((await queued).reason, "context-changed"); await reset;
  assert.equal(writes.length, 0);
  assert.equal((await engine.spendMovements(2)).consumedCount, 2);
  assert.equal(writes.length, 1);
});

test("15D règlement sérialisé : deux tokens/instances partagent la réserve courante", async () => {
  const { engine, actor, user } = setup();
  const other = new ActionEconomy(actor, { getUser: () => user });
  const results = await Promise.all([engine.spendMovements(1), other.spendMovements(2)]);
  assert.deepEqual(results.map(result => result.consumedCount), [1, 1]);
  assert.equal(results[1].availableBefore, 1); assert.equal(results[1].missingCount, 1);
  assert.equal(engine.getSnapshot().movementsRemaining, 0);
});

test("A normal choisit split, consomme AM et laisse M", async () => {
  const { engine } = setup();
  const result = await engine.spend("a");
  assert.equal(result.success, true); assert.equal(result.changed, true);
  assert.deepEqual(result.consumed, { pool: "normal", slot: "am" });
  assert.equal(result.state.branch, "split");
  assert.deepEqual(result.state.normal, { l: false, m: true, am: false });
  assert.equal(result.state.movementsRemaining, 1);
  assert.equal(result.state.canSpend.l, false);
});

test("deux M normaux : M puis AM, épuisement sans négatif ni écriture supplémentaire", async () => {
  const { engine, writes } = setup();
  const first = await engine.spend("m"), second = await engine.spend("m");
  assert.deepEqual(first.consumed, { pool: "normal", slot: "m" });
  assert.equal(first.state.movementsRemaining, 1);
  assert.deepEqual(second.consumed, { pool: "normal", slot: "am" });
  assert.equal(second.state.movementsRemaining, 0);
  const before = engine.getSnapshot();
  for (const type of ["m", "a", "l", "am"]) {
    const result = await engine.spend(type);
    assert.equal(result.success, false); assert.equal(result.reason, "unavailable");
    assert.equal(result.changed, false); assert.equal(result.consumed, null);
    assert.deepEqual(result.state, before);
  }
  assert.equal(writes.length, 2);
});

test("L normal ferme M et AM ; les bonus indépendants restent utilisables", async () => {
  const { engine } = setup();
  const limited = await engine.spend("l");
  assert.deepEqual(limited.consumed, { pool: "normal", slot: "l" });
  assert.equal(limited.state.branch, "limited");
  assert.deepEqual(limited.state.normal, { l: false, m: false, am: false });
  assert.equal(limited.state.movementsRemaining, 0);
  await engine.grant("m"); await engine.grant("a");
  assert.deepEqual((await engine.spend("m")).consumed, { pool: "bonus", slot: "m" });
  assert.deepEqual((await engine.spend("a")).consumed, { pool: "bonus", slot: "a" });
  assert.equal(engine.getSnapshot().branch, "limited");
});

test("M bonus avant M normal, puis AM bonus avant AM normal", async () => {
  const { engine } = setup();
  await engine.grant("m"); await engine.grant("am");
  assert.equal(engine.getSnapshot().movementsRemaining, 4);
  const first = await engine.spend("m");
  assert.deepEqual(first.consumed, { pool: "bonus", slot: "m" });
  assert.equal(first.state.branch, "undecided");
  assert.deepEqual(first.state.normal, { l: true, m: true, am: true });
  assert.equal(first.state.movementsRemaining, 3);
  for (const [pool, slot] of [["normal", "m"], ["bonus", "am"], ["normal", "am"]]) {
    assert.deepEqual((await engine.spend("m")).consumed, { pool, slot });
  }
  assert.equal(engine.getSnapshot().movementsRemaining, 0);
  assert.equal(engine.getSnapshot().movementsMaximum, 4);
});

test("M bonus seul donne trois mouvements et ne choisit aucune branche", async () => {
  const { engine } = setup();
  const result = await engine.grant("m");
  assert.equal(result.state.movementsRemaining, 3);
  assert.equal(result.state.movementsMaximum, 3);
  assert.equal((await engine.spend("m")).state.branch, "undecided");
  assert.equal(engine.getSnapshot().movementsRemaining, 2);
});

test("A spécialisé avant AM bonus puis AM normal ; pas de mouvement pour bonus A/L", async () => {
  const { engine } = setup();
  await engine.grant("a"); await engine.grant("l"); await engine.grant("am");
  assert.equal(engine.getSnapshot().movementsRemaining, 3);
  const first = await engine.spend("a");
  assert.deepEqual(first.consumed, { pool: "bonus", slot: "a" });
  assert.equal(first.state.branch, "undecided");
  assert.deepEqual((await engine.spend("a")).consumed, { pool: "bonus", slot: "am" });
  assert.deepEqual((await engine.spend("a")).consumed, { pool: "normal", slot: "am" });
  assert.equal(engine.getSnapshot().movementsRemaining, 1);
});

test("L bonus avant L normal sans fermer les alternatives", async () => {
  const { engine } = setup();
  await engine.grant("l");
  const first = await engine.spend("l");
  assert.deepEqual(first.consumed, { pool: "bonus", slot: "l" });
  assert.equal(first.state.branch, "undecided");
  assert.equal(first.state.movementsRemaining, 2);
  assert.deepEqual((await engine.spend("l")).consumed, { pool: "normal", slot: "l" });
});

test("AM explicite ne consomme ni A ni M spécialisés", async () => {
  const { engine } = setup();
  await engine.grant("m", 2); await engine.grant("a", 2); await engine.grant("am");
  assert.deepEqual((await engine.spend("am")).consumed, { pool: "bonus", slot: "am" });
  assert.deepEqual((await engine.spend("am")).consumed, { pool: "normal", slot: "am" });
  assert.equal((await engine.spend("am")).success, false);
  assert.deepEqual(engine.getSnapshot().bonus, { l: 0, a: 2, am: 0, m: 2 });
});

test("incompatibilité : M/L ne financent pas A ; A/L ne financent pas M", async () => {
  for (const [granted, requested] of [["m", "a"], ["a", "m"], ["l", "m"], ["l", "a"]]) {
    const { engine, writes } = setup(); await engine.spend("l"); await engine.grant(granted);
    const before = engine.getSnapshot(), count = writes.length;
    assert.equal((await engine.spend(requested)).success, false);
    assert.deepEqual(engine.getSnapshot(), before); assert.equal(writes.length, count);
  }
});

test("f/none sans dépense et reset complet avec signal de changement", async () => {
  const { engine, writes } = setup();
  const initial = engine.getSnapshot();
  assert.equal((await engine.reset()).changed, false);
  for (const type of ["f", "none"]) {
    const result = await engine.spend(type);
    assert.equal(result.success, true); assert.equal(result.changed, false); assert.equal(result.consumed, null);
    assert.deepEqual(result.state, initial);
  }
  assert.equal(writes.length, 0);
  await engine.grant("am", 2); await engine.spend("m");
  assert.equal((await engine.reset()).changed, true);
  assert.deepEqual(engine.getSnapshot(), initial);
});

test("types, quantités et dépassements invalides sans effet secondaire", async () => {
  const { engine, writes } = setup();
  for (const type of ["", "A", "attack", null, undefined, {}, "__proto__"]) {
    assert.equal((await engine.spend(type)).reason, "invalid-type");
    assert.equal((await engine.grant(type)).reason, "invalid-type");
  }
  for (const count of [-1, .5, NaN, Infinity, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await engine.grant("m", count)).reason, "invalid-count");
  }
  assert.equal((await engine.grant("m", 0)).changed, false);
  assert.equal(writes.length, 0);
  assert.equal((await engine.grant("m", Number.MAX_SAFE_INTEGER)).reason, "overflow");
  await engine.grant("m", Number.MAX_SAFE_INTEGER - 2);
  assert.equal((await engine.grant("am")).reason, "overflow");
  assert.equal(writes.length, 1);
});

test("persistance, rechargement, acteurs effectifs et presets isolés", async () => {
  const unrelated = { activePreset: 2, presets: { 1: { slots: {} }, 2: { slots: { custom: 3 } } }, panels: { combat: true } };
  const { engine, actor, user, writes } = setup({ co2prism: unrelated, other: { flag: 1 } });
  await engine.grant("am", 2); await engine.spend("l");
  const reloaded = new ActionEconomy(actor, { getUser: () => user });
  assert.deepEqual(reloaded.getSnapshot(), engine.getSnapshot());
  const copy = setup(actor.flags); assert.deepEqual(copy.engine.getSnapshot(), engine.getSnapshot());
  const second = setup(); assert.equal(second.engine.getSnapshot().branch, "undecided");
  const saved = structuredClone(actor.flags); delete saved.co2prism.actionEconomy;
  assert.deepEqual(saved, { co2prism: unrelated, other: { flag: 1 } });
  assert.ok(writes.every(write => write.scope === "co2prism" && write.key === "actionEconomy"));
  const base = setup(); actor.baseActor = base.actor;
  await reloaded.grant("m"); assert.equal(base.writes.length, 0);
});

test("file partagée entre instances : mutations rapides sans perte", async () => {
  const { actor, engine, user } = setup();
  const second = new ActionEconomy(actor, { getUser: () => user });
  const grants = Array.from({ length: 30 }, (_, i) => (i % 2 ? engine : second).grant("m"));
  await Promise.all(grants);
  assert.equal(engine.getSnapshot().bonus.m, 30);
  const results = await Promise.all(Array.from({ length: 33 }, (_, i) => (i % 2 ? engine : second).spend("m")));
  assert.equal(results.filter(result => result.success).length, 32);
  assert.equal(engine.getSnapshot().movementsRemaining, 0);
  assert.equal(engine.getSnapshot().granted.m, 30);
});

test("autorisation vérifiée dans la file ; MJ et absence d'acteur", async () => {
  const { engine, actor, user, writes } = setup();
  const denied = engine.grant("m"); actor.owner = false;
  assert.equal((await denied).reason, "forbidden"); assert.equal(writes.length, 0);
  assert.equal((await engine.spend("m")).reason, "forbidden");
  assert.equal((await engine.reset()).reason, "forbidden");
  user.isGM = true; assert.equal((await engine.grant("m")).success, true);
  assert.equal((await new ActionEconomy(null).spend("m")).reason, "invalid-actor");
});

test("flag invalide/incomplet : repli sans écriture, prochaine mutation valide", async () => {
  for (const flag of [null, {}, { version: 99 }, { version: 1, branch: "split" },
    { version: 1, branch: "limited", normal: { m: true, am: true }, bonus: {}, granted: {} }]) {
    const { engine, writes } = setup({ co2prism: { actionEconomy: flag } });
    assert.equal(engine.getSnapshot().movementsRemaining, 2); assert.equal(writes.length, 0);
    await engine.spend("m"); assert.equal(engine.getSnapshot().branch, "split");
    assert.equal(writes[0].value.version, 1);
  }
});

test("échec de persistance : pas de mutation optimiste, file récupérable", async () => {
  const { engine, actor } = setup();
  const save = actor.setFlag, before = engine.getSnapshot();
  actor.setFlag = async () => { throw Error("offline"); };
  const result = await engine.spend("m");
  assert.equal(result.reason, "persistence-failed"); assert.equal(result.changed, false);
  assert.deepEqual(result.state, before); assert.deepEqual(engine.getSnapshot(), before);
  actor.setFlag = save;
  assert.equal((await engine.spend("m")).success, true);
});

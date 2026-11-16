import test from "node:test";
import assert from "node:assert/strict";
import { MovementZones } from "../module/movement/movement-zones.mjs";
import { MovementZones as ReferenceZones } from "../benchmarks/reference/movement-zones-step1.mjs";
import { movementScenario } from "./helpers/movement-zones-scenarios.mjs";

for (const spec of [
  { kind: "open", cells: 5, actions: 1 }, { kind: "open", cells: 5, actions: 2 },
  { kind: "walls", cells: 5, actions: 2 }, { kind: "corridor", cells: 5, actions: 2 },
  { kind: "walls", cells: 5, actions: 2, alternating: true }, { kind: "open", cells: 12, actions: 2 }
]) {
  test(`zones identiques à la référence : ${JSON.stringify(spec)}`, async () => {
    const reference = movementScenario(ReferenceZones, spec), current = movementScenario(MovementZones, spec);
    // Pour la grande portée, comparer l'algorithme complet de référence, sans son ancien plafond trop bas.
    const before = await reference.zones.toggle(reference.token, reference.state, reference.range, () => {
      if (reference.zones.stats) { reference.zones.stats.maximumStates = 50000; reference.zones.stats.maximumTransitions = 400000; }
    });
    const after = await current.zones.toggle(current.token, current.state, current.range);
    assert.equal(before.success, true); assert.equal(after.success, true);
    assert.deepEqual(current.markers(), reference.markers());
    assert.equal(current.zones.stats.states, reference.zones.stats.states);
    assert.equal(current.zones.stats.examined, reference.zones.stats.examined);
    if (spec.cells === 12) assert.ok(current.zones.stats.states > 4000);
    reference.zones.clear(); current.zones.clear();
  });
}

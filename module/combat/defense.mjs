export const DEFENSE_COSTS = Object.freeze({ partialDef: "a", fullDef: "l" });

export function defenseStances() {
  return game.system?.CONST?.defenseStances ?? [];
}

export async function clearDefenseStances(actor) {
  for (const { id } of defenseStances()) {
    if (!Object.hasOwn(DEFENSE_COSTS, id) || !actor.hasEffect?.(id)) continue;
    try {
      await actor.toggleStatusEffect(id, { active: false });
      if (actor.hasEffect(id)) console.warn("co2prism | Defense reset refused", actor.uuid, id);
    } catch (error) { console.error("co2prism | Defense reset", actor.uuid, id, error); }
  }
}

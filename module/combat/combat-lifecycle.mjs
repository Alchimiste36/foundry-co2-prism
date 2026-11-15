import { ActionEconomy } from "./action-economy.mjs";

const turns = new WeakMap();
const ended = new WeakSet();
const identity = state => JSON.stringify([state?.round, state?.turn, state?.combatantId]);

async function resetActors(actors) {
  if (game.system.id !== "co2" || !game.user.isActiveGM) return;
  for (const actor of new Set(actors.filter(Boolean))) {
    try {
      const result = await new ActionEconomy(actor).reset();
      if (!result.success) console.warn("co2prism | Combat reset refused", actor.uuid, result.reason);
    } catch (error) { console.error("co2prism | Combat reset", error); }
  }
}

Hooks.once("ready", () => {
  for (const combat of game.combats ?? []) turns.set(combat, identity(combat.current));
});

Hooks.on("combatTurnChange", (combat, previous, current) => {
  const key = identity(current);
  if (!combat.started || !current?.combatantId || identity(previous) === key || turns.get(combat) === key) return;
  turns.set(combat, key);
  ended.delete(combat);
  void resetActors([combat.combatants.get(current.combatantId)?.actor]);
});

function finish(combat) {
  if (ended.has(combat)) return;
  ended.add(combat);
  turns.delete(combat);
  // Les combattants restent accessibles dans le document supprimé.
  void resetActors(Array.from(combat.combatants, combatant => combatant.actor));
}

Hooks.on("deleteCombat", finish);
Hooks.on("updateCombat", (combat, changed) => {
  if (changed.round === 0 && combat.previous?.round > 0) finish(combat);
});

const MODULE = "co2prism";
const FLAG = "actionEconomy";
const TYPES = ["l", "a", "am", "m"];
const queues = new WeakMap();
const resetVersions = new WeakMap();
const emptyBonus = () => Object.fromEntries(TYPES.map(type => [type, 0]));
const initialState = () => ({ version: 1, branch: "undecided", normal: { m: true, am: true },
  bonus: emptyBonus(), granted: emptyBonus() });

function readState(actor) {
  const value = actor?.getFlag?.(MODULE, FLAG);
  const validCounts = counts => counts && TYPES.every(type => Number.isSafeInteger(counts[type]) && counts[type] >= 0);
  const valid = value?.version === 1 && ["undecided", "limited", "split"].includes(value.branch)
    && typeof value.normal?.m === "boolean" && typeof value.normal?.am === "boolean"
    && (value.branch !== "undecided" || (value.normal.m && value.normal.am))
    && (value.branch !== "limited" || (!value.normal.m && !value.normal.am))
    && (value.branch !== "split" || !value.normal.m || !value.normal.am)
    && validCounts(value.bonus) && validCounts(value.granted)
    && TYPES.every(type => value.granted[type] >= value.bonus[type])
    && Number.isSafeInteger(TYPES.reduce((sum, type) => sum + value.granted[type], 2));
  if (!valid) return initialState();
  return { version: 1, branch: value.branch, normal: { m: value.normal.m, am: value.normal.am },
    bonus: Object.fromEntries(TYPES.map(type => [type, value.bonus[type]])),
    granted: Object.fromEntries(TYPES.map(type => [type, value.granted[type]])) };
}

function candidates(state, type) {
  const normal = type => type === "l" ? state.branch === "undecided" : state.normal[type];
  const priorities = {
    m: [["bonus", "m"], ["normal", "m"], ["bonus", "am"], ["normal", "am"]],
    a: [["bonus", "a"], ["bonus", "am"], ["normal", "am"]],
    l: [["bonus", "l"], ["normal", "l"]],
    am: [["bonus", "am"], ["normal", "am"]]
  };
  return (priorities[type] ?? []).filter(([pool, slot]) => pool === "bonus" ? state.bonus[slot] > 0 : normal(slot));
}

function snapshot(state) {
  const normal = { l: state.branch === "undecided", ...state.normal };
  return { ...state, normal,
    // Ces branches sont alternatives, jamais cumulables.
    normalAlternatives: state.branch === "undecided" ? [["l"], ["m", "am"]]
      : state.branch === "split" && (state.normal.m || state.normal.am)
        ? [Object.keys(state.normal).filter(type => state.normal[type])] : [],
    canSpend: Object.fromEntries(TYPES.map(type => [type, candidates(state, type).length > 0])),
    movementsRemaining: Number(state.normal.m) + Number(state.normal.am) + state.bonus.m + state.bonus.am,
    movementsMaximum: 2 + state.granted.m + state.granted.am
  };
}

function spendFromState(state, type) {
  if (["f", "none"].includes(type)) return { success: true, changed: false };
  if (!TYPES.includes(type)) return { success: false, reason: "invalid-type" };
  const selected = candidates(state, type)[0];
  if (!selected) return { success: false, reason: "unavailable" };
  const [pool, slot] = selected;
  if (pool === "bonus") state.bonus[slot]--;
  else if (slot === "l") {
    state.branch = "limited"; state.normal = { m: false, am: false };
  } else { state.branch = "split"; state.normal[slot] = false; }
  return { success: true, changed: true, consumed: { pool, slot } };
}

/** Budget de l'acteur effectif du token, indépendant des presets et du Combat. */
export class ActionEconomy {
  constructor(actor, { getUser = () => globalThis.game?.user } = {}) {
    this.actor = actor;
    this.getUser = getUser;
  }

  getSnapshot() {
    return snapshot(readState(this.actor));
  }

  spend(type, { validate, confirm, rollback } = {}) {
    return this.#mutate(state => spendFromState(state, type), validate, { confirm, rollback });
  }

  getResetVersion() { return resetVersions.get(this.actor) ?? 0; }

  /** Même consommation que spend("m"), groupée dans une seule écriture pour éviter les débits partiels. */
  spendMovements(count, { validate = () => true } = {}) {
    return this.#mutate(state => {
      if (!Number.isSafeInteger(count) || count < 0) return { success: false, reason: "invalid-count" };
      const available = snapshot(state).movementsRemaining;
      const consumedSlots = [];
      for (let index = 0; index < Math.min(count, available); index++) consumedSlots.push(spendFromState(state, "m").consumed);
      return { success: true, changed: consumedSlots.length > 0, requiredCount: count,
        availableBefore: available, consumedCount: consumedSlots.length, missingCount: Math.max(0, count - consumedSlots.length), consumedSlots };
    }, validate);
  }

  grant(type, count = 1) {
    return this.#mutate(state => {
      if (!TYPES.includes(type)) return { success: false, reason: "invalid-type" };
      if (!Number.isSafeInteger(count) || count < 0) return { success: false, reason: "invalid-count" };
      if (!Number.isSafeInteger(TYPES.reduce((sum, type) => sum + state.granted[type], 2) + count)) {
        return { success: false, reason: "overflow" };
      }
      state.bonus[type] += count;
      state.granted[type] += count;
      return { success: true, changed: count > 0 };
    });
  }

  reset({ beforeReset } = {}) {
    if (this.actor && typeof this.actor === "object") resetVersions.set(this.actor, this.getResetVersion() + 1);
    return this.#mutate(state => {
      const initial = initialState();
      const changed = JSON.stringify(state) !== JSON.stringify(initial);
      Object.assign(state, initial);
      return { success: true, changed };
    }, undefined, { before: beforeReset });
  }

  #mutate(operation, validate = () => true, { before: prepare, confirm, rollback } = {}) {
    const actor = this.actor;
    if (!actor || typeof actor !== "object") return Promise.resolve({ success: false, changed: false,
      consumed: null, reason: "invalid-actor", state: this.getSnapshot() });
    // File partagée entre toutes les instances du moteur pour ce même acteur.
    const pending = (queues.get(actor) ?? Promise.resolve()).then(async () => {
      const before = readState(actor);
      const result = (success, reason, extra = {}, state = before) => ({ success, changed: false,
        consumed: null, reason, ...extra, state: snapshot(state) });
      const user = this.getUser();
      if (!user || typeof actor.setFlag !== "function" || typeof actor.getFlag !== "function"
        || !(user.isGM || actor.testUserPermission?.(user, "OWNER"))) return result(false, "forbidden");
      if (!validate()) return result(false, "context-changed");
      if (prepare) await prepare();
      const next = structuredClone(before);
      const outcome = operation(next);
      if (!outcome.success || !outcome.changed) return result(outcome.success, outcome.reason ?? null, outcome);
      if (confirm && !await confirm()) return result(false, "unconfirmed");
      try {
        await actor.setFlag(MODULE, FLAG, next);
        return result(true, null, outcome, next);
      } catch {
        if (rollback) await rollback();
        return result(false, "persistence-failed", outcome.requiredCount === undefined ? {} : { consumedCount: 0, requiredCount: outcome.requiredCount });
      }
    });
    // Une erreur inattendue ne doit pas bloquer les opérations suivantes.
    queues.set(actor, pending.catch(() => {}));
    return pending;
  }
}

import { ActionEconomy } from "../combat/action-economy.mjs";

import { MovementTracker, roundMovementCells, movementThreshold } from "../movement/movement-tracker.mjs";
import { MovementNotifications } from "../movement/movement-notifications.mjs";
import { MovementZones } from "../movement/movement-zones.mjs";

const MODULE = "co2prism";
const WIDTHS = { S: 300, M: 430, L: 600, XL: 780 };
const ABILITIES = ["for", "agi", "con", "cha", "int", "vol", "per"];
const COMBAT_ROW_ORIGINS = [522, 731];
const BUDGET_ORIGIN = 522;
const BASE_BOTTOM = 569;
let bar;

function economyEnabled() {
  const mode = game.settings?.get(MODULE, "economyMode");
  return mode === "always" || (mode !== "off" && game.combats?.active?.started === true);
}

Hooks.once("init", () => {
  if (game.system.id !== "co2") return;
  game.settings.register(MODULE, "movementRounding", {
    name: "CO2PRISM.MovementRounding", hint: "CO2PRISM.MovementRoundingHint", scope: "world", config: true,
    type: String, default: "nearest", choices: {
      nearest: "CO2PRISM.MovementRoundingNearest", up: "CO2PRISM.MovementRoundingUp", down: "CO2PRISM.MovementRoundingDown"
    }, onChange: () => bar?.refreshActor()
  });
  game.settings.register(MODULE, "economyMode", {
    name: "CO2PRISM.EconomyMode", hint: "CO2PRISM.EconomyModeHint", scope: "user", config: true,
    type: String, default: "combat", choices: {
      always: "CO2PRISM.EconomyAlways", combat: "CO2PRISM.EconomyCombat", off: "CO2PRISM.EconomyOff"
    }, onChange: () => bar?.refreshActor()
  });
  game.settings.register(MODULE, "size", {
    name: "CO2PRISM.Size", hint: "CO2PRISM.SizeHint", scope: "user", config: true,
    type: String, default: "M", choices: { S: "S", M: "M", L: "L", XL: "XL" },
    onChange: () => bar?.layout()
  });
  game.settings.register(MODULE, "position", {
    scope: "user", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE, "locked", {
    name: "CO2PRISM.Locked", hint: "CO2PRISM.LockedHint", scope: "user", config: true,
    type: Boolean, default: true, onChange: () => bar?.updateLock()
  });
});

Hooks.once("ready", async () => {
  if (game.system.id !== "co2" || bar) return;
  bar = new PrismBar();
  await bar.render();
});

class PrismBar {
  constructor() {
    this.movementTracker = new MovementTracker({ readMovement: token => this.readCombatData(token.actor, token.parent) });
    this.movementErrors = new WeakMap();
    this.movementResets = new WeakSet();
    this.movementValidations = new WeakSet();
    this.movementResults = new WeakMap();
    this.movementNotifications = new MovementNotifications();
    this.movementContextVersion = 0;
    this.movementZones = new MovementZones();
  }

  async render() {
    if (document.getElementById("co2prism-bar")) return;
    const markup = await foundry.applications.handlebars.renderTemplate(
      "modules/co2prism/templates/bar.hbs", {}
    );
    document.body.insertAdjacentHTML("beforeend", markup);
    this.element = document.getElementById("co2prism-bar");
    this.handle = this.element.querySelector(".co2prism-portrait");
    this.lock = this.element.querySelector(".co2prism-lock");
    this.art = this.element.querySelector(".co2prism-art");
    this.portrait = this.element.querySelector(".co2prism-portrait");
    this.name = this.element.querySelector(".co2prism-name");
    this.combatPanel = this.element.querySelector(".co2prism-combat");
    this.combatValues = Object.fromEntries(["meters", "cells", "def", "dr"].map(key =>
      [key, this.element.querySelector(`[data-co2prism-combat-value="${key}"]`)]));
    this.combatEffects = this.element.querySelector(".co2prism-effects");
    this.combatSlots = this.element.querySelector(".co2prism-combat-slots");
    this.combatRows = [...this.combatSlots.querySelectorAll(".co2prism-combat-row")];
    this.combatLine = this.element.querySelector(".co2prism-combat-line");
    this.combatArrow = this.element.querySelector(".co2prism-combat-arrow");
    this.budgetScroll = this.element.querySelector(".co2prism-budget-scroll");
    this.budgetContent = this.element.querySelector(".co2prism-budget-content");
    this.budgetBar = this.element.querySelector(".co2prism-time-bar");
    this.budgetCommands = [...this.element.querySelectorAll("[data-co2prism-time]")];
    this.budgetReset = this.element.querySelector(".co2prism-budget-reset");
    this.movementToggle = this.element.querySelector(".co2prism-movement-toggle");
    this.movementPanel = this.element.querySelector(".co2prism-movement-panel");
    this.movementReset = this.movementPanel.querySelector(".co2prism-movement-reset");
    this.movementZonesButton = this.movementPanel.querySelector(".co2prism-movement-zones-toggle");
    this.movementZonesButton.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); void this.toggleMovementZones();
    });
    this.movementZonesObserver = new MutationObserver(() => {
      if (!this.element.isConnected) { this.movementZones.clear(); this.movementZonesObserver.disconnect(); }
    });
    this.movementZonesObserver.observe(document.body, { childList: true });
    this.movementToggle.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      if (event.detail > 1) return;
      void this.toggleMovement();
    });
    this.movementReset.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); void this.resetMovement();
    });
    for (const button of this.budgetCommands) {
      for (const eventName of ["click", "contextmenu"]) button.addEventListener(eventName, event => {
        event.preventDefault(); event.stopPropagation();
        if (eventName === "click" && button.dataset.co2prismTime === "am") return;
        void this.changeEconomy(eventName === "contextmenu" ? "grant" : "spend", button.dataset.co2prismTime);
      });
    }
    this.budgetReset.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); void this.changeEconomy("reset");
    });
    // Observer le début/la fin du drag, sans intercepter les dépôts hors Prism.
    document.addEventListener("dragstart", event => {
      if (this.combatSlots.contains(event.target)) return;
      this.refreshActor();
      this.slotDrag = { actor: this.actor, token: this.token, preset: this.configuration.activePreset };
    });
    document.addEventListener("dragend", () => {
      this.slotDrag = null;
      setTimeout(() => { this.suppressShortcutClick = false; }, 0);
      this.combatSlots.querySelectorAll(".co2prism-drop-target, .co2prism-drop-candidate, .co2prism-drop-insert")
        .forEach(node => node.classList.remove("co2prism-drop-target", "co2prism-drop-candidate", "co2prism-drop-insert"));
    });
    this.skillsPanel = this.element.querySelector(".co2prism-skills");
    this.skillsToggle = this.element.querySelector(".co2prism-skills-toggle");
    this.skillsToggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      void this.writeConfiguration("panels.competences", value => !value);
    });
    this.skillNodes = ABILITIES.map(key => {
      const button = this.element.querySelector(`[data-co2prism-ability="${key}"]`);
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void this.performAction(`skill:${key}`);
      });
      return { key, button, value: button.querySelector(".co2prism-skill-value"),
        count: button.querySelector(".co2prism-skill-count") };
    });
    this.presetButtons = [...this.element.querySelectorAll("[data-co2prism-preset]")];
    for (const button of this.presetButtons) {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void this.selectCombatPreset(Number(button.dataset.co2prismPreset));
      });
    }
    this.actions = [...this.element.querySelectorAll("[data-co2prism-action]")];
    for (const button of this.actions) {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void this.performAction(button.dataset.co2prismAction);
      });
    }
    this.gauges = Object.fromEntries(["recovery", "fortune", "mana", "hp"].map(key => [key, {
      fill: this.element.querySelector(`[data-co2prism-gauge="${key}"]`),
      text: this.element.querySelector(`[data-co2prism-value="${key}"]`)
    }]));
    this.position = game.settings.get(MODULE, "position");
    this.lock.addEventListener("click", () => {
      void game.settings.set(MODULE, "locked", !game.settings.get(MODULE, "locked"));
    });
    this.handle.addEventListener("pointerdown", event => this.startDrag(event));
    this.handle.addEventListener("pointermove", event => this.moveDrag(event));
    this.handle.addEventListener("pointerup", event => this.endDrag(event));
    this.handle.addEventListener("pointercancel", event => this.endDrag(event));
    this.handle.addEventListener("lostpointercapture", event => this.endDrag(event));
    window.addEventListener("resize", () => this.layout());
    this.updateLock();
    this.layout();
    this.connectActor();
  }

  connectActor() {
    this.movementNotifications.connect();
    for (const event of ["createCombat", "updateCombat", "deleteCombat", "combatTurnChange"]) {
      Hooks.on(event, (combat, changed) => {
        if (event !== "createCombat" && (event !== "updateCombat" || ["round", "turn", "active"].some(key => key in (changed ?? {})))) this.movementContextVersion++;
        this.refreshActor();
      });
    }
    // L'instance vit avec le monde ; ces hooks ne sont installés qu'au premier rendu.
    Hooks.on("controlToken", () => this.refreshActor());
    Hooks.on("canvasReady", () => this.refreshActor());
    Hooks.on("canvasTearDown", canvas => {
      this.movementZones.clear();
      this.movementTracker.closeScene(canvas?.scene ?? globalThis.canvas?.scene);
      this.refreshActor(false);
    });
    Hooks.on("moveToken", (token, movement) => {
      this.movementTracker.update(token, movement);
      if (token === this.token?.document) this.refreshActor();
    });
    Hooks.on("recordToken", token => {
      this.movementTracker.refresh(token);
      if (token === this.token?.document) this.refreshActor();
    });
    Hooks.on("deleteScene", scene => {
      if (scene === this.movementZones.token?.parent) this.movementZones.clear();
      this.movementTracker.closeScene(scene);
      if (scene === this.token?.document?.parent) this.refreshActor(false);
    });
    Hooks.on("updateScene", (scene, changed) => {
      if (scene === globalThis.canvas?.scene && Object.keys(changed).some(key => key === "grid" || key.startsWith("grid."))) {
        this.refreshActor();
      }
    });
    Hooks.on("updateActor", (actor, changed) => {
      if (Object.keys(changed).some(key => key === "flags" || key.startsWith("flags.co2prism"))) {
        const budget = new ActionEconomy(actor).getSnapshot();
        if (budget.branch === "undecided" && Object.values(budget.granted).every(value => value === 0)) this.movementContextVersion++;
      }
      const relevant = Object.keys(changed).some(key => ["system", "img", "name", "ownership", "flags"].includes(key)
        || key.startsWith("system.") || key.startsWith("ownership.")
        || key === "flags.co2prism" || key === "flags.-=co2prism" || key.startsWith("flags.co2prism."));
      if (relevant && this.concernsActor(actor)) this.refreshActor();
    });
    Hooks.on("deleteActor", actor => {
      if (this.concernsActor(actor)) this.refreshActor(false);
    });
    Hooks.on("updateToken", (token, changed) => {
      const relevant = Object.keys(changed).some(key => ["actorId", "actorLink", "delta", "ownership"].includes(key)
        || key.startsWith("delta."));
      if (relevant && token === this.token?.document) this.refreshActor();
    });
    Hooks.on("deleteToken", token => {
      if (token === this.movementZones.token) this.movementZones.clear();
      this.movementTracker.deleteToken(token);
      if (token === this.token?.document) this.refreshActor(false);
    });
    // Les objets et effets peuvent modifier les valeurs préparées sans updateActor.
    for (const type of ["Item", "ActiveEffect"]) {
      for (const event of ["create", "update", "delete"]) {
        Hooks.on(`${event}${type}`, document => {
          const parent = document.parent?.documentName === "Item" ? document.parent.parent : document.parent;
          if (this.concernsActor(parent)) this.refreshActor();
        });
      }
    }
    this.refreshActor();
  }

  concernsActor(actor) {
    return Boolean(actor && this.token && (actor === this.token.actor
      || actor.uuid === this.token.actor?.uuid || actor === this.token.document.baseActor));
  }

  refreshActor(useCanvas = true) {
    const controlled = useCanvas && globalThis.canvas?.ready ? canvas.tokens?.controlled : null;
    const token = controlled?.length === 1 ? controlled[0] : null;
    const candidate = token?.actor;
    // Comme les feuilles CO2, réserver les statistiques aux observateurs autorisés.
    const actor = candidate?.testUserPermission(game.user, "OBSERVER") ? candidate : null;
    this.token = token;
    this.actor = actor;
    if (this.slotDrag && (this.slotDrag.actor !== actor || this.slotDrag.token !== token)) this.slotDrag.cancelled = true;
    const unavailable = game.i18n.localize("CO2PRISM.Unavailable");
    const summaries = [];
    for (const [key, nodes] of Object.entries(this.gauges)) {
      const resource = this.getResource(actor, key);
      const current = Number.isFinite(resource?.value) ? resource.value : null;
      const maximum = Number.isFinite(resource?.max) && resource.max > 0 ? resource.max : null;
      const text = current === null && maximum === null ? unavailable
        : `${current ?? unavailable} / ${maximum ?? unavailable}`;
      const fill = current !== null && maximum !== null
        ? Math.max(0, Math.min(100, current / maximum * 100)) : 0;
      if (nodes.text.textContent !== text) nodes.text.textContent = text;
      nodes.fill.style.setProperty("--fill", `${fill}%`);
      // Réduire seulement les longues valeurs pour les garder dans leur zone.
      const width = 110;
      nodes.text.style.setProperty("--text-size", Math.min(36, width / (text.length * 0.58)));
      const label = `${game.i18n.localize(`CO2PRISM.Gauges.${key}`)} : ${text}`;
      nodes.fill.title = label;
      summaries.push(label);
    }
    this.name.textContent = actor?.name || unavailable;
    this.name.title = actor?.name || game.i18n.localize("CO2PRISM.NoActor");
    const portrait = actor?.img || "icons/svg/mystery-man.svg";
    if (this.portrait.getAttribute("src") !== portrait) this.portrait.setAttribute("src", portrait);
    this.art.setAttribute("aria-label", actor ? `${actor.name}. ${summaries.join(". ")}`
      : game.i18n.localize("CO2PRISM.NoActor"));
    this.updateActions();
    this.configuration = this.readConfiguration(actor);
    if (this.slotDrag && this.slotDrag.preset !== this.configuration.activePreset) this.slotDrag.cancelled = true;
    this.updatePresets();
    const skillsChanged = this.updateSkills();
    const combatChanged = this.updateCombat();
    const movementChanged = this.updateMovementPanel();
    if (skillsChanged || combatChanged || movementChanged) this.layout({ preserveAnchor: true });
  }

  movementToken() {
    const token = this.token?.document;
    return this.actor && token?.parent === globalThis.canvas?.scene && token?.parent?.tokens?.get(token.id) === token
      && token.canUserModify?.(game.user, "update") ? token : null;
  }

  movementView(token) {
    const state = this.movementTracker.getSnapshot(token).state;
    if (!state) return null;
    const budgetActive = economyEnabled();
    const available = budgetActive ? new ActionEconomy(token.actor).getSnapshot().movementsRemaining : null;
    let valid = state.measurementValid && Number.isFinite(state.cellsPerActionRaw) && state.cellsPerActionRaw > 0
      && Number.isSafeInteger(state.cellsPerAction) && state.cellsPerAction >= 0
      && Number.isSafeInteger(state.cellsUsed) && Number.isSafeInteger(state.theoreticalActions);
    let capacity = valid && budgetActive ? movementThreshold(state.cellsPerActionRaw, available, state.rounding) : null;
    if (budgetActive && !Number.isSafeInteger(capacity)) { valid = false; capacity = null; }
    return { state, budgetActive, available, valid, capacity,
      blocks: valid ? budgetActive ? available : 1 : 0,
      excess: valid && budgetActive ? Math.max(0, state.cellsUsed - capacity) : 0 };
  }

  toggleMovement() {
    this.refreshActor();
    const token = this.movementToken();
    if (!token || !this.configuration.panels.combat || this.movementResets.has(token) || this.movementValidations.has(token)) return false;
    const active = this.movementTracker.getSnapshot(token).success;
    if (active) return this.validateMovement(token);
    this.movementResults.delete(token);
    const result = this.movementTracker.start(token);
    if (result.success) this.movementErrors.delete(token);
    else this.movementErrors.set(token, result.reason);
    this.refreshActor();
    return result.success;
  }

  async validateMovement(token) {
    if (this.movementValidations.has(token)) return false;
    if (token === this.movementZones.token) this.movementZones.clear();
    this.movementValidations.add(token);
    this.movementErrors.delete(token);
    this.refreshActor();
    const actor = token.actor, engine = new ActionEconomy(actor);
    let result = this.movementResults.get(token);
    if (result?.success && result.sessionId !== this.movementTracker.getSnapshot(token).state?.sessionId) {
      this.movementResults.delete(token); result = null;
    }
    if (result?.success === false) result = null;
    try {
      if (!result) {
        const view = this.movementView(token);
        if (!view) return false;
        const state = view.state;
        if (["pending", "paused", "planned"].includes(token.movement?.state)) {
          this.movementErrors.set(token, "movement-in-progress"); return false;
        }
        if (view.budgetActive && !view.valid) {
          this.movementErrors.set(token, "invalid-measurement"); return false;
        }
        const required = view.budgetActive ? state.theoreticalActions : 0;
        const version = this.movementContextVersion, resetVersion = engine.getResetVersion();
        const valid = () => {
          const current = this.movementTracker.getSnapshot(token).state;
          return current && token.parent?.tokens?.get(token.id) === token && token.actor === actor
            && (!game.scenes || game.scenes.get(token.parent.id) === token.parent)
            && token.canUserModify?.(game.user, "update") && (required === 0 || game.user.isGM || actor?.testUserPermission?.(game.user, "OWNER"))
            && this.movementContextVersion === version && engine.getResetVersion() === resetVersion
            && economyEnabled() === view.budgetActive && current.sessionId === state.sessionId && current.mode === state.mode
            && current.segmentCount === state.segmentCount && current.cellsUsed === state.cellsUsed
            && current.cellsPerActionRaw === state.cellsPerActionRaw && current.gridSignature === state.gridSignature
            && current.rounding === state.rounding && !["pending", "paused", "planned"].includes(token.movement?.state);
        };
        if (!valid()) { this.movementErrors.set(token, "context-changed"); return false; }
        result = required > 0 ? await engine.spendMovements(required, { validate: valid })
          : { success: true, consumedCount: 0, missingCount: 0, availableBefore: view.available };
        if (!result.success) {
          this.movementErrors.set(token, result.reason === "context-changed" ? "context-changed" : "validation-failed");
          this.movementResults.set(token, { ...result, consumedCount: 0 });
          return false;
        }
        result = { ...result, requiredCount: required,
          sessionId: state.sessionId,
          excess: required > 0 ? Math.max(0, state.cellsUsed - movementThreshold(state.cellsPerActionRaw, result.availableBefore, state.rounding)) : 0,
          notified: false };
        // Conserver le règlement confirmé si la fermeture devient impossible après l'écriture.
        this.movementResults.set(token, result);
      }
      const finished = this.movementTracker.finish(token);
      if (!finished.success) { this.movementErrors.set(token, "closure-pending"); return false; }
      if (result.excess > 0 && !result.notified) {
        result.notified = true;
        if (!this.movementNotifications.broadcast(token, result.excess)) {
          ui.notifications.warn(game.i18n.localize("CO2PRISM.Movement.NotificationFailed"));
        }
      }
      return true;
    } catch {
      this.movementErrors.set(token, "validation-failed"); return false;
    } finally {
      this.movementValidations.delete(token); this.refreshActor();
    }
  }

  async resetMovement() {
    this.refreshActor();
    const token = this.movementToken();
    if (!token || this.movementResets.has(token) || this.movementValidations.has(token) || this.movementResults.get(token)?.success || !this.movementTracker.getSnapshot(token).success) return false;
    if (token === this.movementZones.token) this.movementZones.clear();
    this.movementResets.add(token); this.movementErrors.delete(token); this.refreshActor();
    try {
      const result = await this.movementTracker.reset(token);
      if (!result.success) this.movementErrors.set(token, result.reason);
      return result.success;
    } catch {
      this.movementErrors.set(token, "return-failed"); return false;
    } finally {
      this.movementResets.delete(token); this.refreshActor();
    }
  }

  updateMovementPanel() {
    if (!this.movementPanel) return false;
    const token = this.movementToken(), view = token ? this.movementView(token) : null;
    const open = Boolean(view && this.configuration.panels.combat);
    this.movementZones.sync(token, view?.state, open);
    const validating = Boolean(token && this.movementValidations.has(token));
    const settled = Boolean(token && this.movementResults.get(token)?.success);
    const busy = Boolean(token && (this.movementResets.has(token) || validating));
    const error = token ? this.movementErrors.get(token) : null;
    const signature = JSON.stringify([open, token?.uuid ?? token?.id, view, busy, settled, validating, error,
      this.movementZones.visible, this.movementZones.busy, this.movementZones.diagnostic, this.movementZones.stats]);
    if (signature === this.movementSignature) return false;
    this.movementSignature = signature;
    const localize = key => game.i18n.localize(`CO2PRISM.Movement.${key}`);
    const format = (key, data) => game.i18n.format(`CO2PRISM.Movement.${key}`, data);
    this.movementPanel.hidden = !open;
    this.movementToggle.disabled = !token || busy;
    this.movementToggle.textContent = view ? localize("Validate") : game.i18n.localize("CO2PRISM.Combat.Movement");
    this.movementToggle.setAttribute("aria-pressed", String(Boolean(view)));
    this.movementToggle.setAttribute("aria-expanded", String(open));
    this.movementToggle.title = localize(validating ? "Validating" : !view && error ? error === "movement-in-progress" ? "Busy" : "ReturnFailed" : view ? "Finish" : "Start");
    if (!open) return true;
    const { state, valid, budgetActive, available, capacity, blocks, excess } = view;
    this.movementReset.disabled = busy || settled;
    if (this.movementZonesButton) {
      this.movementZonesButton.disabled = busy || settled || (!this.movementZones.visible && Boolean(this.movementZones.supported(token, state.start)));
      this.movementZonesButton.setAttribute("aria-pressed", String(this.movementZones.visible));
      this.movementZonesButton.title = localize(this.movementZones.visible ? "ZonesHide" : "ZonesShow");
      this.movementZonesButton.setAttribute("aria-label", this.movementZonesButton.title);
      const diagnostic = this.movementPanel.querySelector(".co2prism-movement-zones-status");
      const reason = this.movementZones.diagnostic ?? this.movementZones.supported(token, state.start);
      diagnostic.hidden = !reason && !this.movementZones.busy;
      diagnostic.textContent = this.movementZones.busy ? localize("ZonesBusy") : reason === "Done"
        ? format("ZonesDone", this.movementZones.stats) : reason ? localize(`Zones${reason}`) : "";
    }
    const query = selector => this.movementPanel.querySelector(`.co2prism-movement-${selector}`);
    const data = { used: state.cellsUsed, capacity, actions: state.theoreticalActions, available, cells: state.cellsPerAction, excess };
    query("summary").textContent = !valid ? localize("Unavailable") : format(budgetActive ? "ExactSummary" : "InformativeSummary", data);
    query("speed").textContent = Number.isFinite(state.cellsPerActionRaw) && state.cellsPerActionRaw > 0 ? format("Speed", data) : localize("SpeedUnavailable");
    const message = query("message");
    message.textContent = !valid ? localize("Unavailable")
      : format(!budgetActive ? "InformativeNotice" : excess > 0 ? "Excess" : "WithinCapacity", data);
    message.classList.toggle("co2prism-movement-excess", excess > 0);
    query("error").hidden = !error;
    const errorKey = { "movement-in-progress": "Busy", "invalid-measurement": "InvalidValidation", "context-changed": "ContextChanged", "validation-failed": "ValidationFailed", "closure-pending": "ClosurePending" }[error] ?? "ReturnFailed";
    query("error").textContent = error ? format(errorKey, { consumed: this.movementResults.get(token)?.consumedCount ?? 0 }) : "";
    const nodes = [];
    // Les valeurs extrêmes restent représentées par des groupes étiquetés, sans millions de nœuds.
    const renderedBlocks = Math.min(blocks, 120);
    for (let blockIndex = 0; blockIndex < renderedBlocks; blockIndex++) {
      const lower = movementThreshold(state.cellsPerActionRaw, blockIndex, state.rounding);
      const upper = movementThreshold(state.cellsPerActionRaw, blockIndex + 1, state.rounding);
      const size = upper - lower;
      const stride = Math.max(1, Math.ceil(size / 60));
      const block = document.createElement("div"); block.className = "co2prism-movement-block";
      block.dataset.cells = String(size);
      if (size === 0) block.textContent = format("ZeroBlock", { action: blockIndex + 1 });
      for (let index = 0; index < size; index += stride) {
        const count = Math.min(stride, size - index);
        const used = Math.max(0, Math.min(count, state.cellsUsed - lower - index));
        const cell = document.createElement("span"); cell.className = "co2prism-movement-cell";
        cell.style.setProperty("--co2prism-used", `${100 * used / count}%`);
        cell.dataset.used = String(used); cell.dataset.count = String(count);
        if (count > 1) cell.textContent = String(count);
        block.append(cell);
      }
      nodes.push(block);
    }
    if (blocks > renderedBlocks) {
      const remainder = document.createElement("span"); remainder.className = "co2prism-movement-more";
      remainder.textContent = format("MoreBlocks", { count: blocks - renderedBlocks }); nodes.push(remainder);
    }
    query("blocks").replaceChildren(...nodes);
    return true;
  }

  async toggleMovementZones() {
    this.refreshActor();
    const token = this.movementToken(), view = token && this.movementView(token);
    if (!view || !this.configuration.panels.combat || this.movementValidations.has(token) || this.movementResets.has(token)) return false;
    const state = { ...view.state, start: { ...view.state.start } };
    const range = { cellsPerActionRaw: state.cellsPerActionRaw, rounding: state.rounding,
      actions: view.budgetActive ? view.available : 1 };
    const result = await this.movementZones.toggle(token, state, range, () => this.refreshActor());
    return result.success;
  }

  destroy() {
    this.movementZones.clear(); this.movementZonesObserver?.disconnect();
  }

  updateSkills() {
    if (!this.skillsPanel) return;
    const open = Boolean(this.actor && this.configuration.panels.competences);
    const changed = this.skillsPanel.hidden === open;
    this.skillsPanel.hidden = !open;
    this.skillsToggle.disabled = !this.canConfigure();
    this.skillsToggle.setAttribute("aria-expanded", String(open));
    this.skillsToggle.setAttribute("aria-disabled", String(this.skillsToggle.disabled));
    this.skillsToggle.title = game.i18n.localize(open ? "CO2PRISM.CloseSkills" : "CO2PRISM.OpenSkills");
    this.skillsToggle.setAttribute("aria-label", this.skillsToggle.title);
    if (!open) return changed;
    const unavailable = game.i18n.localize("CO2PRISM.Unavailable");
    for (const { key, button, value, count } of this.skillNodes) {
      const modifier = this.actor.system?.abilities?.[key]?.value;
      value.textContent = Number.isFinite(modifier) ? `${modifier >= 0 ? "+" : ""}${modifier}` : unavailable;
      value.style.setProperty("--co2prism-skill-size", Math.min(52, 90 / (value.textContent.length * 0.55)));
      // Le système inclut déjà les bonus généraux et conditionnels.
      let bonuses = null;
      try {
        if (typeof this.actor.getSkillBonuses === "function") bonuses = this.actor.getSkillBonuses(key);
      } catch (error) {
        console.warn("co2prism | Skill bonuses", key, error);
      }
      const list = Array.isArray(bonuses) ? bonuses : null;
      count.textContent = `(${list ? list.length : unavailable})`;
      const label = game.i18n.localize(`CO2PRISM.Abilities.${key}`);
      const lines = list?.map(bonus => {
        const number = Number.isFinite(bonus?.value) ? `${bonus.value >= 0 ? "+" : ""}${bonus.value}` : unavailable;
        return [this.plainText(bonus?.name), number, this.plainText(bonus?.description), this.plainText(bonus?.additionalInfos)].filter(Boolean).join(" — ");
      });
      button.title = `${label} : ${value.textContent}\n${game.i18n.localize("CO2PRISM.SkillBonuses")} ${count.textContent}`
        + (lines?.length ? `\n${lines.join("\n")}` : "");
      button.setAttribute("aria-label", button.title);
      button.disabled = Boolean(this.busyAction) || !this.canUseAction(`skill:${key}`);
    }
    return changed;
  }

  readCombatData(actor = this.actor, scene = globalThis.canvas?.ready ? canvas.scene : null) {
    const movement = actor?.system?.attributes?.movement;
    const unitFactor = unit => {
      const name = typeof unit === "string" ? unit.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
      if (["m", "metre", "metres", "meter", "meters"].includes(name)) return 1;
      if (["ft", "foot", "feet", "pied", "pieds"].includes(name)) return 0.3048;
      return null;
    };
    const factor = unitFactor(movement?.unit);
    const meters = Number.isFinite(movement?.value) && movement.value >= 0 && factor !== null ? movement.value * factor : null;
    const grid = scene?.grid;
    const gridFactor = unitFactor(grid?.units);
    const cells = meters !== null && Number.isInteger(grid?.type) && grid.type > 0
      && Number.isFinite(grid.distance) && grid.distance > 0 && gridFactor !== null
      ? meters / (grid.distance * gridFactor) : null;
    const def = actor?.system?.combat?.def?.value;
    const dr = actor?.system?.combat?.dr?.value;
    return { meters, cells, def: Number.isFinite(def) ? def : null, dr: Number.isFinite(dr) ? dr : null };
  }

  readCombatEffects(actor = this.actor) {
    if (!actor) return [];
    const entries = [], statuses = new Set();
    for (const effect of actor.appliedEffects ?? []) {
      entries.push({ name: effect.name, img: effect.img });
      for (const id of effect.statuses ?? []) statuses.add(id);
    }
    for (const effect of actor.system?.currentEffects ?? []) {
      // Le modèle CO2 expose l'Item source des effets personnalisés.
      let img;
      try { img = effect.sourceParts?.item?.img; } catch { /* Source supprimée ou inaccessible. */ }
      entries.push({ name: effect.name, img });
    }
    for (const id of actor.statuses ?? []) {
      if (statuses.has(id)) continue;
      const status = globalThis.CONFIG?.statusEffects?.find(entry => entry.id === id);
      entries.push({ name: status ? game.i18n.localize(status.name) : id, img: status?.img });
    }
    return entries;
  }

  updateCombat() {
    if (!this.combatPanel) return false;
    const open = Boolean(this.actor && this.configuration.panels.combat);
    const changed = this.combatPanel.hidden === open;
    this.combatPanel.hidden = !open;
    if (!open) return changed;
    const unavailable = game.i18n.localize("CO2PRISM.Unavailable");
    const economy = new ActionEconomy(this.actor).getSnapshot();
    for (const [key, value] of Object.entries(this.readCombatData())) {
      const node = this.combatValues[key];
      const format = number => {
        if (!Number.isFinite(number) || (key === "cells" && number < 0)) return unavailable;
        if (key !== "cells") return String(Math.round(number * 100) / 100);
        return String(roundMovementCells(number, game.settings?.get(MODULE, "movementRounding")));
      };
      node.textContent = economyEnabled() && ["meters", "cells"].includes(key) && value !== null
        ? `${format(value * economy.movementsRemaining)} / ${format(value * economy.movementsMaximum)}` : format(value);
      node.style.setProperty("--co2prism-combat-size", Math.min(key === "def" ? 68 : 48, 115 / (node.textContent.length * 0.58)));
    }
    const effects = this.readCombatEffects();
    const elements = effects.map(effect => {
      const element = document.createElement("span");
      element.className = "co2prism-effect";
      element.title = typeof effect.name === "string" ? effect.name : unavailable;
      if (typeof effect.img === "string" && effect.img) {
        const img = document.createElement("img");
        img.src = effect.img; img.alt = element.title; img.draggable = false;
        element.append(img);
      } else element.textContent = element.title;
      return element;
    });
    this.combatEffects.replaceChildren(...elements);
    this.combatPanel.dataset.co2prismPreset = String(this.configuration.activePreset);
    const budgetChanged = this.renderEconomy(economy);
    const resized = this.renderCombatSlots();
    return changed || resized || budgetChanged;
  }

  async changeEconomy(operation, type) {
    if (!economyEnabled() || this.busyAction || (operation === "spend" && type === "am")) return false;
    this.refreshActor();
    const actor = this.actor;
    if (!this.canConfigure(actor) || !this.configuration.panels.combat
      || !["spend", "grant", "reset"].includes(operation)) return false;
    try {
      const engine = new ActionEconomy(actor);
      const result = await engine[operation](type);
      if (!result.success && result.reason !== "unavailable") ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.EconomyError"));
      return result.success;
    } catch (error) {
      console.error("co2prism | Action economy", error);
      ui.notifications.error(game.i18n.localize("CO2PRISM.Combat.EconomyError"));
      return false;
    } finally { this.refreshActor(); }
  }

  updateEconomyCommands(state) {
    const canEdit = economyEnabled() && this.canConfigure();
    for (const button of this.budgetCommands ?? []) {
      const type = button.dataset.co2prismTime;
      button.disabled = !canEdit;
      button.setAttribute("aria-disabled", String(!canEdit));
      button.parentElement.classList.toggle("co2prism-time-available", type !== "am" && canEdit && !this.busyAction && state.canSpend[type]);
      button.title = `${type.toUpperCase()} — ${game.i18n.localize(type === "am" ? "CO2PRISM.Combat.MixedTimeControls" : "CO2PRISM.Combat.TimeControls")}`
        + (type !== "am" && !state.canSpend[type] ? `\n${game.i18n.localize("CO2PRISM.Combat.TimeUnavailable")}` : "");
      button.setAttribute("aria-label", button.title);
    }
    if (this.budgetReset) this.budgetReset.disabled = !canEdit;
  }

  renderEconomy(state) {
    if (!this.budgetBar) return false;
    const scroll = this.budgetBar.closest?.(".co2prism-budget-scroll");
    const hidden = !economyEnabled();
    const visibilityChanged = scroll && scroll.hidden !== hidden;
    if (scroll) scroll.hidden = hidden;
    this.updateEconomyCommands(state);
    if (hidden) return Boolean(visibilityChanged);
    const labels = { l: "L", a: "A", am: "AM", m: "M" };
    const colors = { l: "limited", a: "attack", am: "mixed", m: "move" };
    const nodes = [], widths = [];
    const add = (type, bonus = false, count = 1) => {
      const node = document.createElement("span");
      node.className = `co2prism-time-indicator co2prism-time-${colors[type]}${bonus ? " co2prism-time-bonus" : ""}`;
      node.textContent = `${bonus ? "+" : ""}${labels[type]}${count > 1 ? ` ×${count}` : ""}`;
      node.title = `${game.i18n.localize(bonus ? "CO2PRISM.Combat.BonusTime" : "CO2PRISM.Combat.NormalTime")} : ${labels[type]}${count > 1 ? ` ×${count}` : ""}`;
      node.dataset.co2prismBudgetType = type;
      if (bonus) node.dataset.co2prismBonus = String(count);
      const width = count > 1 ? Math.max(88, node.textContent.length * 13) : 40;
      node.style.setProperty("--budget-icon-width", width);
      nodes.push(node); widths.push(width);
    };
    state.normalAlternatives.forEach((branch, index) => {
      if (index) {
        const separator = document.createElement("span"); separator.className = "co2prism-time-separator";
        separator.textContent = game.i18n.localize("CO2PRISM.Combat.TimeOr"); nodes.push(separator); widths.push(36);
      }
      branch.forEach(type => add(type));
    });
    for (const type of ["l", "a", "m", "am"]) {
      const count = state.bonus[type];
      // Les très grandes quantités restent lisibles sans créer des milliers de nœuds.
      if (count > 24) add(type, true, count);
      else for (let index = 0; index < count; index++) add(type, true);
    }
    if (!nodes.length) {
      const empty = document.createElement("span"); empty.textContent = game.i18n.localize("CO2PRISM.Unavailable");
      nodes.push(empty); widths.push(40);
    }
    const barWidth = widths.reduce((sum, width) => sum + width, 16) + (nodes.length - 1) * 8;
    this.budgetBar.replaceChildren(...nodes);
    this.budgetBar.style.setProperty("--w", barWidth);
    this.budgetReset.style.setProperty("--x", 235 + barWidth + 6);
    const width = Math.max(492, 235 + barWidth + 48);
    const changed = width !== this.budgetWidth;
    this.budgetWidth = width;
    this.budgetContent.style.setProperty("--budget-width", width);
    return changed || Boolean(visibilityChanged);
  }

  slotRows(actor = this.actor, preset = this.configuration.activePreset) {
    const slots = this.readConfiguration(actor).presets[preset].slots;
    const rows = [[], []];
    for (const [key, reference] of Object.entries(slots)) {
      if (["left-hand", "right-hand"].includes(key)) continue;
      const row = reference?.row === 2 ? 2 : 1;
      rows[row - 1].push({ key, reference, row, order: Number.isSafeInteger(reference?.order) ? reference.order : 0 });
    }
    for (const row of rows) row.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    rows[0].unshift(...["left", "right"].map(hand => ({ key: `${hand}-hand`, hand, row: 1,
      order: hand === "left" ? 0 : 1, reference: slots[`${hand}-hand`] })));
    rows.forEach((row, index) => row.push({ row: index + 1, order: 1 + Math.max(-1,
      ...row.filter(slot => !slot.hand).map(slot => slot.order)), terminal: true }));
    return rows;
  }

  resolveShortcut(actor, reference) {
    if (!actor || !reference || typeof reference.source !== "string" || !Number.isSafeInteger(reference.indice)
      || reference.indice < 0) return null;
    try {
      const item = reference.itemId ? actor.items?.get(reference.itemId) : null;
      if (reference.itemId && (!item || (item.testUserPermission && !item.testUserPermission(game.user, "OBSERVER")))) return null;
      const actions = item ? item.actions : actor.actions;
      const matches = actions?.filter(entry => entry.indice === reference.indice
        && (item || entry.source === reference.source)) ?? [];
      if (matches.length !== 1) return null;
      const action = matches[0];
      const support = item ?? [...(actor.items?.values() ?? [])].find(entry => entry.actions?.includes(action));
      // activateAction indexe le tableau natif : ne jamais lancer une autre entrée déplacée.
      if (support && support.actions[reference.indice] !== action) return null;
      return { action, item: support };
    } catch { return null; }
  }

  shortcutFromDrop(actor, data) {
    try {
      if (data?.type === "co.attack") {
        const item = [...(actor.items?.values() ?? [])].find(entry => entry.uuid === data.uuid && entry.type === "attack");
        const action = item?.actions?.[0];
        if (!action) return null;
        data = { type: "co.action", source: action.source, indice: action.indice };
      }
      if (data?.type !== "co.action" || typeof data.source !== "string" || !Number.isSafeInteger(data.indice)) return null;
      // La collection native de l'acteur agrège aussi les actions de ses Items.
      const matches = actor.actions?.filter(entry => entry.source === data.source && entry.indice === data.indice) ?? [];
      if (matches.length !== 1) return null;
      const action = matches[0];
      const item = [...(actor.items?.values() ?? [])].find(entry => entry.actions?.includes(action));
      if (!item && action.source !== actor.uuid) return null;
      if (item?.testUserPermission && !item.testUserPermission(game.user, "OBSERVER")) return null;
      return { source: action.source, indice: action.indice, itemId: item?.id ?? null };
    } catch { return null; }
  }

  plainText(html) {
    const template = document.createElement("template");
    template.innerHTML = typeof html === "string" ? html : "";
    template.content.querySelectorAll("script, style").forEach(node => node.remove());
    return template.content.textContent.replace(/\s+/g, " ").trim();
  }

  pruneShortcuts(rows) {
    const actor = this.actor, token = this.token, preset = this.configuration.activePreset;
    if (!this.canConfigure(actor) || !globalThis.canvas?.ready || !actor.items || actor.invalid) return;
    const missing = reference => {
      try {
        if (!reference || typeof reference.source !== "string" || !Number.isSafeInteger(reference.indice) || reference.indice < 0) return true;
        const item = reference.itemId ? actor.items.get(reference.itemId) : null;
        if (reference.itemId && !item) return true;
        if (item?.testUserPermission && !item.testUserPermission(game.user, "OBSERVER")) return false;
        // Sans tableau natif chargé, l'absence n'est pas une preuve de suppression.
        const actions = item ? item.system?.actions : reference.source === actor.uuid ? actor.system?.actions : null;
        if (!Array.isArray(actions)) return false;
        const matches = actions.filter(action => action.indice === reference.indice);
        return matches.length === 0 || (matches.length === 1 && actions[reference.indice] !== matches[0]);
      } catch { return false; }
    };
    const invalid = rows.flat().filter(slot => !slot.terminal && slot.reference !== undefined && missing(slot.reference));
    if (!invalid.length) return;
    this.prunedSignatures ??= new WeakMap();
    const signature = JSON.stringify([preset, invalid.map(slot => [slot.key, slot.reference])]);
    if (this.prunedSignatures.get(actor) === signature) return;
    this.prunedSignatures.set(actor, signature);
    void this.queueConfiguration(actor, async () => {
      const config = this.readConfiguration(actor);
      if (this.actor !== actor || this.token !== token || config.activePreset !== preset || !this.canConfigure(actor)) {
        this.prunedSignatures.delete(actor); return false;
      }
      const slots = config.presets[preset].slots;
      const keys = invalid.filter(slot => JSON.stringify(slots[slot.key]) === JSON.stringify(slot.reference)
        && missing(slots[slot.key])).map(slot => slot.key);
      if (!keys.length) { this.prunedSignatures.delete(actor); return false; }
      for (const key of keys) delete slots[key];
      for (const row of this.slotRows(actor, preset)) row.filter(slot => !slot.hand && !slot.terminal && !keys.includes(slot.key))
        .forEach((slot, order) => { slots[slot.key] = { ...slots[slot.key], order }; });
      for (const key of keys) slots[`-=${key}`] = null;
      await actor.setFlag(MODULE, `presets.${preset}.slots`, slots);
      this.prunedSignatures.delete(actor);
      return true;
    });
  }

  renderCombatSlots() {
    const editable = !game.settings.get(MODULE, "locked") && this.canConfigure();
    const generation = this.conditionRender = {};
    const allRows = this.slotRows();
    this.pruneShortcuts(allRows);
    const rows = allRows.map(row => row.filter(slot => !game.settings.get(MODULE, "locked")
      || slot.hand || (slot.reference !== undefined && this.resolveShortcut(this.actor, slot.reference))));
    for (const [index, row] of rows.entries()) {
      const scroll = this.combatRows[index].scrollLeft;
      const nodes = row.map(slot => {
        const node = document.createElement("div");
        node.className = "co2prism-combat-slot";
        node.dataset.co2prismRow = String(slot.row);
        if (slot.hand) node.dataset.co2prismHand = slot.hand;
        node.setAttribute("role", "group");
        const label = game.i18n.localize(slot.hand === "left" ? "CO2PRISM.Combat.LeftHand"
          : slot.hand === "right" ? "CO2PRISM.Combat.RightHand" : "CO2PRISM.Combat.EmptySlot");
        const resolved = slot.reference !== undefined ? this.resolveShortcut(this.actor, slot.reference) : null;
        const add = (tag, cls, text) => {
          const child = document.createElement(tag); child.className = cls;
          if (text !== undefined) child.textContent = text;
          node.append(child); return child;
        };
        node.title = label;
        if (slot.hand && !resolved && game.settings.get(MODULE, "locked")) {
          node.classList.add("co2prism-hand-empty");
          node.setAttribute("role", "img");
          node.setAttribute("aria-label", label);
          const icon = add("i", "fa-solid fa-hand");
          icon.setAttribute("aria-hidden", "true");
          return node;
        }
        if (slot.reference !== undefined && !resolved) {
          node.classList.add("co2prism-slot-unavailable");
          add("span", "co2prism-slot-empty", game.i18n.localize("CO2PRISM.Combat.UnavailableSlot"));
          node.title = game.i18n.localize("CO2PRISM.Combat.UnavailableSlot");
        } else if (resolved) {
          const { action, item } = resolved;
          const read = key => { try { return action[key]; } catch { return undefined; } };
          const image = read("actionImg") || read("img") || item?.img;
          if (typeof image === "string" && image) {
            const img = add("img", "co2prism-slot-image"); img.src = image; img.alt = read("actionName") || item?.name || ""; img.draggable = false;
          }
          const icon = read("iconFA");
          if (typeof icon === "string" && icon) add("i", "co2prism-slot-type fa-solid "
            + icon.split(/\s+/).filter(cls => /^fa-[a-z0-9-]+$/.test(cls) && cls !== "fa-solid").join(" "));
          const time = { l: "L", a: "A", m: "M", f: "G" }[read("actionTypeFinal")];
          if (time) add("span", `co2prism-slot-time co2prism-slot-time-${time}`, time);
          const uses = this.shortcutUses(action, item);
          if (uses) {
            const badge = add("span", "co2prism-slot-uses", `${uses.value} `);
            badge.title = game.i18n.localize(`CO2PRISM.Combat.Uses_${uses.type}`);
            const icon = document.createElement("i");
            icon.className = `fa-solid fa-${uses.icon}`; badge.append(icon);
            if (uses.value === 0) node.classList.add("co2prism-action-exhausted");
          }
          const cost = read("manaCost");
          if (Number.isFinite(cost) && cost > 0) {
            const badge = add("span", "co2prism-slot-cost", `${cost} `);
            const bolt = document.createElement("i"); bolt.className = "fa-solid fa-bolt"; badge.append(bolt);
          }
          node.title = [read("actionName") || item?.name, this.plainText(item?.system?.description)].filter(Boolean).join("\n");
          node.title += `\n${game.i18n.localize("CO2PRISM.Combat.ShortcutControls")}`;
          if (economyEnabled() && new ActionEconomy(this.actor).getSnapshot().canSpend[read("actionTypeFinal")] === false) {
            node.classList.add("co2prism-time-insufficient");
            node.title += `\n${game.i18n.localize("CO2PRISM.Combat.InsufficientTimeHint")}`;
          }
          node.classList.add("co2prism-slot-executable");
          node.setAttribute("role", "button");
          if (action.properties?.activable === true) {
            node.setAttribute("aria-pressed", String(action.properties.enabled === true));
            node.title += `\n${game.i18n.localize(action.properties.enabled ? "CO2PRISM.Combat.Active" : "CO2PRISM.Combat.Inactive")}`;
            if (action.properties.temporary === true && action.properties.enabled === true) node.classList.add("co2prism-action-active");
          }
          const disabled = Boolean(this.busyAction) || !(game.user.isGM || this.actor.testUserPermission(game.user, "OWNER"));
          node.setAttribute("aria-disabled", String(disabled));
          node.tabIndex = disabled ? -1 : 0;
          const context = { actor: this.actor, token: this.token, preset: this.configuration.activePreset,
            key: slot.key, reference: slot.reference };
          if (typeof action.isVisible === "function") {
            node.classList.add("co2prism-condition-pending");
            node.setAttribute("aria-disabled", "true");
            Promise.resolve().then(() => action.isVisible(item, context.actor)).then(available => {
              if (this.conditionRender !== generation || !node.isConnected || this.actor !== context.actor
                || this.token !== context.token || this.configuration.activePreset !== context.preset) return;
              node.classList.remove("co2prism-condition-pending");
              node.classList.toggle("co2prism-condition-unavailable", !available);
              node.setAttribute("aria-disabled", String(disabled || !available));
              if (!available) node.title += `\n${game.i18n.localize("CO2PRISM.Combat.ConditionsUnavailable")}`;
              node.setAttribute("aria-label", slot.hand ? `${label}\n${node.title}` : node.title);
            }).catch(error => {
              if (this.conditionRender !== generation || !node.isConnected) return;
              node.classList.remove("co2prism-condition-pending");
              node.classList.add("co2prism-condition-unavailable");
              node.title += `\n${game.i18n.localize("CO2PRISM.Combat.ConditionsUnknown")}`;
              node.setAttribute("aria-label", node.title);
              console.warn("co2prism | Conditions", error);
            });
          }
          node.addEventListener("click", event => { void this.executeShortcut(event, context); });
          node.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") void this.executeShortcut(event, context);
          });
        } else add("span", "co2prism-slot-empty", game.i18n.localize("CO2PRISM.Combat.EmptySlot"));
        if (slot.hand) add("span", "co2prism-slot-hand", game.i18n.localize(`CO2PRISM.Combat.Hand_${slot.hand}`));
        if (editable && slot.reference !== undefined) {
          const context = { actor: this.actor, token: this.token, preset: this.configuration.activePreset,
            key: slot.key, reference: slot.reference };
          const remove = add("button", "co2prism-slot-remove");
          remove.type = "button";
          remove.title = game.i18n.localize("CO2PRISM.Combat.RemoveShortcut");
          remove.setAttribute("aria-label", remove.title);
          const icon = document.createElement("i"); icon.className = "fa-solid fa-trash"; remove.append(icon);
          for (const type of ["pointerdown", "mousedown", "dragstart", "keydown"]) remove.addEventListener(type, event => event.stopPropagation());
          remove.addEventListener("dragstart", event => event.preventDefault());
          remove.addEventListener("click", event => {
            event.preventDefault(); event.stopPropagation(); void this.manageShortcut(context);
          });
          if (!slot.hand) {
            node.draggable = true;
            node.addEventListener("dragstart", event => {
              event.stopPropagation();
              if (event.target.closest?.(".co2prism-slot-remove") || !this.validShortcutContext(context)) { event.preventDefault(); return; }
              this.slotDrag = { ...context, internal: true };
              this.suppressShortcutClick = true;
              event.dataTransfer.setData("text/plain", JSON.stringify({ type: "co2prism.shortcut", key: slot.key }));
              event.dataTransfer.effectAllowed = "move";
            });
            node.addEventListener("dragend", () => { setTimeout(() => { this.suppressShortcutClick = false; }, 0); });
          }
        }
        node.setAttribute("aria-label", slot.hand ? `${label}\n${node.title}` : node.title);
        node.addEventListener("dragenter", event => this.hoverSlot(event, slot, node));
        node.addEventListener("dragover", event => this.hoverSlot(event, slot, node));
        node.addEventListener("dragleave", () => node.classList.remove("co2prism-drop-target", "co2prism-drop-candidate", "co2prism-drop-insert"));
        node.addEventListener("drop", event => { void this.dropSlot(event, slot, node); });
        return node;
      });
      this.combatRows[index].replaceChildren(...nodes);
      this.combatRows[index].scrollLeft = scroll;
    }
    const widths = rows.map(row => Math.max(0, row.length * 209 - 11));
    const extent = Math.max(economyEnabled() ? BUDGET_ORIGIN + (this.budgetWidth ?? 492) : 0,
      ...widths.map((width, index) => COMBAT_ROW_ORIGINS[index] + width)) + 121;
    // Une ligne peut grandir sans changer l'extrémité globale du volet.
    const resized = extent !== this.combatExtent || widths.some((width, index) => width !== this.combatRowWidths?.[index]);
    this.combatExtent = extent;
    this.combatRowWidths = widths;
    return resized;
  }

  hoverSlot(event, slot, node) {
    node.classList.remove("co2prism-drop-target", "co2prism-drop-candidate", "co2prism-drop-insert");
    if (!this.slotDrag) {
      this.slotDrag = { actor: this.actor, token: this.token, preset: this.configuration.activePreset };
    }
    const context = this.slotDrag;
    if (context.internal) {
      if (slot.hand || !this.validShortcutContext(context)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
      node.classList.add("co2prism-drop-insert"); return;
    }
    if (game.settings.get(MODULE, "locked") || context.cancelled || !this.canConfigure(context.actor) || !this.configuration.panels.combat) return;
    const raw = event.dataTransfer?.getData("text/plain");
    if (raw) {
      try { if (!this.shortcutFromDrop(context.actor, JSON.parse(raw))) return; } catch { return; }
    } else if (!Array.from(event.dataTransfer?.types ?? []).includes("text/plain")) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    node.classList.add(raw ? "co2prism-drop-target" : "co2prism-drop-candidate");
  }

  async executeShortcut(event, context) {
    event.preventDefault(); event.stopPropagation();
    if ((event.button !== undefined && event.button !== 0) || event.detail > 1 || event.repeat
      || this.busyAction || this.slotDrag || this.suppressShortcutClick) return false;
    const mode = event.shiftKey ? "sheet" : event.ctrlKey ? "chat" : event.altKey ? "damage" : "use";
    const warn = key => {
      if (this.shortcutWarning?.key !== key || Date.now() - this.shortcutWarning.time > 1500) {
        ui.notifications.warn(game.i18n.localize(key)); this.shortcutWarning = { key, time: Date.now() };
      }
      return false;
    };
    if (event.currentTarget?.isConnected === false) return warn("CO2PRISM.Combat.UnavailableSlot");
    this.refreshActor();
    const { actor, token, preset, key, reference } = context;
    const current = this.configuration.presets[preset]?.slots[key];
    if (actor !== this.actor || token !== this.token || preset !== this.configuration.activePreset
      || !this.configuration.panels.combat || !current
      || ["source", "indice", "itemId"].some(field => current[field] !== reference?.[field])
      || !(game.user.isGM || actor?.testUserPermission(game.user, "OWNER"))) {
      return warn("CO2PRISM.CommandUnavailable");
    }
    const resolved = this.resolveShortcut(actor, current);
    if (!resolved) return warn("CO2PRISM.Combat.UnavailableSlot");
    const { action, item } = resolved;
    // Les API macros CO2 installées ciblent un Item, jamais un faux support acteur.
    if (!item && (mode !== "sheet" || current.source !== actor.uuid || typeof actor.sheet?.render !== "function")) {
      return warn("CO2PRISM.Combat.ActorActionUnsupported");
    }
    if (item && actor.items?.get(item.id) !== item) return warn("CO2PRISM.Combat.UnavailableSlot");
    const api = game.system?.api?.macros;
    const toggle = mode === "use" && action.properties?.activable === true && action.properties?.temporary === true;
    if (toggle && typeof actor.activateAction !== "function") return warn("CO2PRISM.Combat.UnavailableSlot");
    if (item && !toggle && typeof api?.[mode === "sheet" ? "openSheet" : mode === "chat" ? "sendToChat" : "useAction"] !== "function") {
      return warn("CO2PRISM.Combat.UnavailableSlot");
    }
    this.busyAction = "shortcut";
    this.updateActions();
    let beforeActivation, afterActivation;
    try {
      if (["use", "damage"].includes(mode) && typeof action.isVisible === "function"
        && !await action.isVisible(item, actor)) return warn("CO2PRISM.Combat.ConditionsUnavailable");
      // Une condition asynchrone ne doit pas poursuivre une commande sur une ancienne sélection.
      const latest = this.readConfiguration(actor);
      if (this.actor !== actor || this.token !== token || latest.activePreset !== preset || !latest.panels.combat
        || !(game.user.isGM || actor.testUserPermission(game.user, "OWNER"))
        || ["source", "indice", "itemId"].some(field => latest.presets[preset].slots[key]?.[field] !== reference?.[field])
        || this.resolveShortcut(actor, latest.presets[preset].slots[key])?.action !== action) return warn("CO2PRISM.CommandUnavailable");
      // UUID actuel du support, notamment pour les Items d'un acteur synthétique.
      const source = item?.uuid;
      const indice = action.indice;
      const deactivating = toggle && action.properties.enabled === true;
      const time = action.actionTypeFinal;
      const activationState = [action.properties?.activable, action.properties?.temporary, action.properties?.enabled];
      const charged = mode === "use" && !deactivating && economyEnabled() && ["l", "a", "m"].includes(time);
      let forced = false;
      const economy = new ActionEconomy(actor);
      const ready = () => {
        this.refreshActor();
        const config = this.readConfiguration(actor);
        return this.actor === actor && this.token === token && config.activePreset === preset && config.panels.combat
          && (game.user.isGM || actor.testUserPermission(game.user, "OWNER"))
          && ["source", "indice", "itemId"].every(field => config.presets[preset].slots[key]?.[field] === reference?.[field])
          && this.resolveShortcut(actor, config.presets[preset].slots[key])?.action === action
          && (!item || actor.items?.get(item.id) === item)
          && [action.properties?.activable, action.properties?.temporary, action.properties?.enabled].every((value, index) => value === activationState[index])
          && action.actionTypeFinal === time && !(toggle && action.properties.enabled === true)
          && this.shortcutUses(action, item)?.value !== 0;
      };
      if (mode === "use" && !deactivating) {
        if (!["l", "a", "m", "f", "none"].includes(time)) return warn("CO2PRISM.Combat.UnknownActionTime");
        if (this.shortcutUses(action, item)?.value === 0) return warn("CO2PRISM.Combat.ActionExhausted");
        if (charged && !economy.getSnapshot().canSpend[time]) {
          const accepted = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("CO2PRISM.Combat.InsufficientTimeTitle") },
            content: `<p>${game.i18n.localize("CO2PRISM.Combat.InsufficientTimeConfirm")}</p>`,
            yes: { label: game.i18n.localize("CO2PRISM.Combat.Yes") },
            no: { label: game.i18n.localize("CO2PRISM.Combat.No"), default: true }, rejectClose: false
          });
          if (accepted !== true) return false;
          if (typeof action.isVisible === "function" && !await action.isVisible(item, actor)) return warn("CO2PRISM.Combat.ConditionsUnavailable");
          if (!ready()) return warn("CO2PRISM.CommandUnavailable");
          forced = economyEnabled() && !economy.getSnapshot().canSpend[time];
        }
      }
      let confirmed = false, rejected = false, starts = 0, ambiguous = false, expectedType;
      if (charged) {
        const matches = (target, details) => target === actor && details.item === item
          && details.indice === indice && details.state === true && details.type === expectedType;
        beforeActivation = (target, details) => {
          if (!matches(target, details)) return;
          if (++starts > 1) ambiguous = true;
          details.guard((async () => {
            if (typeof action.isVisible === "function" && !await action.isVisible(item, actor)) {
              rejected = "CO2PRISM.Combat.ConditionsUnavailable"; return false;
            }
            if (!ready()) { rejected = "CO2PRISM.CommandUnavailable"; return false; }
            if (economyEnabled() && !forced && !economy.getSnapshot().canSpend[time]) { rejected = "CO2PRISM.Combat.NoActionTime"; return false; }
            if (forced && economy.getSnapshot().canSpend[time]) forced = false;
            return true;
          })());
        };
        afterActivation = (target, details) => {
          if (matches(target, details) && starts === 1 && !ambiguous && details.success === true) confirmed = true;
        };
        // Le wrapper macro renvoie undefined, même si un resolver est annulé.
        Hooks.on("co2.preActivateAction", beforeActivation);
        Hooks.on("co2.postActivateAction", afterActivation);
      }
      let nativeResult;
      if (mode === "sheet") {
        if (item) await api.openSheet(source);
        else await actor.sheet.render({ force: true });
      } else if (mode === "chat") {
        // Sans nom de repli : une disparition ne doit pas cibler un autre Item par homonymie.
        await api.sendToChat(source, undefined, indice);
      } else {
        const temporary = action.properties?.temporary === true;
        const auto = action.autoAttack === true;
        const attack = ["melee", "ranged", "magical", "spell"].includes(action.type) && !auto && !temporary;
        expectedType = temporary ? (toggle ? undefined : "attack") : attack ? "attack" : item.type === "attack" && auto ? "auto" : action.type;
        if (mode === "damage") {
          if (!(attack && action.hasResolversWithDomage === true)) return warn("CO2PRISM.Combat.DamageUnavailable");
          await api.useAction(source, indice, "damage");
        } else if (toggle) {
          // Comme la feuille CO2 : pas de type attaque/dommages pour une bascule temporaire.
          nativeResult = await actor.activateAction({ state: !action.properties.enabled, source, indice, type: undefined });
        } else if (temporary) nativeResult = await api.useAction(source, indice);
        else nativeResult = await api.useAction(source, indice, expectedType);
      }
      if (rejected) return warn(rejected);
      if (mode === "use" && nativeResult === false) return false;
      if (charged) {
        if (!confirmed || ambiguous) {
          if (starts === 0 || ambiguous) warn("CO2PRISM.Combat.ExecutionUnconfirmed");
          return false;
        }
        // Dépense après confirmation, toujours sur l'acteur qui a exécuté l'action.
        if (economyEnabled() && !forced) {
          const spent = await economy.spend(time);
          if (!spent.success) return warn("CO2PRISM.Combat.ActionTimeConflict");
        }
      }
      return true;
    } catch (error) {
      console.error("co2prism | Shortcut", error);
      ui.notifications.error(game.i18n.localize("CO2PRISM.ActionError"));
      return false;
    } finally {
      if (beforeActivation) Hooks.off("co2.preActivateAction", beforeActivation);
      if (afterActivation) Hooks.off("co2.postActivateAction", afterActivation);
      this.busyAction = null;
      this.refreshActor();
    }
  }

  shortcutUses(action, item) {
    const model = item?.system;
    if (!model) return null;
    // La résolution consomme l'Item, indépendamment du type d'action ou du sous-type.
    if (item.type === "equipment" && Array.isArray(action.resolvers)
      && action.resolvers.some(resolver => resolver?.type === "consumable")
      && Number.isFinite(model.quantity?.current) && model.quantity.current >= 0) {
      return { value: model.quantity.current, type: "consumable", icon: "flask-round-potion" };
    }
    let value, type, icon;
    if (item.type === "capacity" && ["daily", "combat"].includes(model.frequency)
      && action.properties?.noChargesUsed !== true) {
      value = model.charges?.current; type = model.frequency;
      icon = type === "daily" ? "sun" : "swords";
    } else if (item.type === "equipment" && model.subtype === "consumable" && action.type === "consumable") {
      value = model.quantity?.current; type = "quantity"; icon = "sack";
    } else if (["equipment", "attack"].includes(item.type) && model.properties?.reloadable === true
      && (["melee", "ranged", "magical", "spell"].includes(action.type) || action.autoAttack === true)) {
      value = model.charges?.current; type = "quantity"; icon = "sack";
    }
    return Number.isFinite(value) && value >= 0 ? { value, type, icon } : null;
  }

  validShortcutContext(context) {
    const current = this.readConfiguration(context.actor);
    const reference = current.presets[context.preset]?.slots[context.key];
    return !context.cancelled && context.actor === this.actor && context.token === this.token
      && context.preset === current.activePreset && current.panels.combat
      && !game.settings.get(MODULE, "locked") && this.canConfigure(context.actor)
      && reference && ["source", "indice", "itemId", "row", "order"].every(key => reference[key] === context.reference?.[key]);
  }

  manageShortcut(context, target) {
    this.refreshActor();
    if (!this.validShortcutContext(context) || (target && (target.hand || ["left-hand", "right-hand"].includes(context.key)))) return Promise.resolve(false);
    return this.queueConfiguration(context.actor, async () => {
      this.refreshActor();
      if (!this.validShortcutContext(context)) return false;
      const slots = this.readConfiguration(context.actor).presets[context.preset].slots;
      const rows = this.slotRows(context.actor, context.preset).map(row => row.filter(slot => !slot.hand && !slot.terminal));
      if (target) {
        if (![1, 2].includes(target.row)) return false;
        const source = rows.flat().find(slot => slot.key === context.key);
        const destination = rows[target.row - 1];
        if (!source || (!target.terminal && !destination.some(slot => slot.key === target.key))) return false;
        if (target.key === context.key) return false;
        for (const row of rows) { const index = row.indexOf(source); if (index >= 0) row.splice(index, 1); }
        const index = target.terminal ? destination.length : destination.findIndex(slot => slot.key === target.key);
        destination.splice(index, 0, source);
      } else delete slots[context.key];
      rows.forEach((row, index) => row.filter(slot => target || slot.key !== context.key).forEach((slot, order) => {
        slots[slot.key] = { ...slots[slot.key], row: index + 1, order };
      }));
      // Une seule écriture native ; la clé de suppression Foundry évite la fusion résiduelle.
      if (!target) slots[`-=${context.key}`] = null;
      await context.actor.setFlag(MODULE, `presets.${context.preset}.slots`, slots);
      return true;
    });
  }

  async dropSlot(event, slot, node) {
    event.preventDefault(); event.stopPropagation();
    node.classList.remove("co2prism-drop-target", "co2prism-drop-candidate", "co2prism-drop-insert");
    const context = this.slotDrag ?? { actor: this.actor, token: this.token, preset: this.configuration.activePreset };
    this.slotDrag = null;
    this.refreshActor();
    if (context.internal) return this.manageShortcut(context, slot);
    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { /* Dépôt non CO2. */ }
    if (game.settings.get(MODULE, "locked") || context.cancelled || context.actor !== this.actor || context.token !== this.token
      || context.preset !== this.configuration.activePreset || !this.configuration.panels.combat || !this.canConfigure(context.actor)) {
      ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.InvalidDrop")); return false;
    }
    const reference = this.shortcutFromDrop(context.actor, data);
    if (!reference) { ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.InvalidDrop")); return false; }
    const saved = await this.saveShortcut(context.actor, context.preset, slot, reference);
    if (saved && slot.terminal && this.actor === context.actor && this.configuration.activePreset === context.preset) {
      const row = this.combatRows?.[slot.row - 1];
      if (row) row.scrollLeft = row.scrollWidth > row.clientWidth ? row.scrollWidth : 0;
    }
    return saved;
  }

  saveShortcut(actor, preset, slot, reference) {
    if (game.settings.get(MODULE, "locked") || !this.canConfigure(actor) || ![1, 2, 3].includes(preset) || ![1, 2].includes(slot?.row)
      || (slot.key && (!/^[A-Za-z0-9_-]+$/.test(slot.key) || ["__proto__", "constructor", "prototype"].includes(slot.key)))) {
      ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.InvalidDrop")); return Promise.resolve(false);
    }
    return this.queueConfiguration(actor, async () => {
      if (game.settings.get(MODULE, "locked") || !this.canConfigure(actor) || !this.resolveShortcut(actor, reference)) {
        ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.InvalidDrop")); return false;
      }
      const rows = this.slotRows(actor, preset);
      const terminal = rows[slot.row - 1].at(-1);
      const key = slot.key ?? `slot-${foundry.utils.randomID()}`;
      const value = { ...reference, row: slot.row, order: slot.terminal ? terminal.order : slot.order, hand: slot.hand ?? null };
      await actor.setFlag(MODULE, `presets.${preset}.slots.${key}`, value);
      return true;
    });
  }

  readConfiguration(actor = this.actor) {
    const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
    // getFlag de Foundry attend un objet dans l'espace de noms.
    const read = key => isObject(actor?.flags?.[MODULE]) ? actor.getFlag?.(MODULE, key) : undefined;
    const active = read("activePreset");
    const panels = read("panels");
    const presets = read("presets");
    return {
      activePreset: [1, 2, 3].includes(active) ? active : 1,
      panels: Object.fromEntries(["combat", "competences", "equipements"].map(key =>
        [key, isObject(panels) && panels[key] === true])),
      presets: Object.fromEntries([1, 2, 3].map(number => {
        const slots = isObject(presets) && isObject(presets[number]) ? presets[number].slots : null;
        return [number, { slots: isObject(slots) ? foundry.utils.deepClone(slots) : {} }];
      }))
    };
  }

  canConfigure(actor = this.actor) {
    return Boolean(actor && typeof actor.getFlag === "function" && typeof actor.setFlag === "function"
      && (game.user.isGM || actor.testUserPermission(game.user, "OWNER")));
  }

  updatePresets() {
    for (const button of this.presetButtons) {
      const number = Number(button.dataset.co2prismPreset);
      const active = Boolean(this.actor && this.configuration.activePreset === number);
      button.disabled = !this.canConfigure();
      button.setAttribute("aria-disabled", String(button.disabled));
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-controls", "co2prism-combat");
      button.setAttribute("aria-expanded", String(active && this.configuration.panels.combat));
      const label = `${game.i18n.localize("CO2PRISM.Preset")} ${number}`;
      button.setAttribute("aria-label", label);
      button.title = button.disabled ? `${label} — ${game.i18n.localize("CO2PRISM.ConfigUnavailable")}` : label;
    }
  }

  setActivePreset(number) {
    if (![1, 2, 3].includes(number)) return Promise.resolve(false);
    return this.writeConfiguration("activePreset", number);
  }

  selectCombatPreset(number) {
    if (![1, 2, 3].includes(number)) return Promise.resolve(false);
    return this.writeConfiguration("activePreset", number, { combat: true });
  }

  setPanelState(panel, open) {
    if (!["combat", "competences", "equipements"].includes(panel) || typeof open !== "boolean") {
      return Promise.resolve(false);
    }
    return this.writeConfiguration(`panels.${panel}`, open);
  }

  writeConfiguration(path, value, { combat = false } = {}) {
    const toggle = path === "panels.competences" && typeof value === "function";
    // Seuls ces champs sont modifiables à cette étape.
    if (!(path === "activePreset" && [1, 2, 3].includes(value))
      && !(["panels.combat", "panels.competences", "panels.equipements"].includes(path) && typeof value === "boolean") && !toggle) {
      return Promise.resolve(false);
    }
    this.refreshActor();
    const actor = this.actor;
    if (!this.canConfigure(actor)) return Promise.resolve(false);
    // Capturer l'acteur du clic ; une autre sélection ne doit jamais recevoir cette écriture.
    return this.queueConfiguration(actor, async () => {
      if (!this.canConfigure(actor)) return false;
      const config = this.readConfiguration(actor);
      const previous = path === "activePreset" ? config.activePreset : config.panels[path.split(".")[1]];
      const next = toggle ? value(previous) : value;
      if (toggle && typeof next !== "boolean") return false;
      if (combat && path === "activePreset") {
        const open = config.activePreset !== value || !config.panels.combat;
        if (previous !== value) await actor.setFlag(MODULE, path, value);
        if (!this.canConfigure(actor)) return false;
        if (config.panels.combat !== open) await actor.setFlag(MODULE, "panels.combat", open);
        return true;
      }
      if (previous === next) return false;
      // Un chemin précis préserve les autres presets, volets et champs inconnus.
      await actor.setFlag(MODULE, path, next);
      return true;
    });
  }

  queueConfiguration(actor, operation) {
    this.configWrites ??= new WeakMap();
    const pending = (this.configWrites.get(actor) ?? Promise.resolve()).then(operation).catch(error => {
      console.error("co2prism | Configuration", error);
      ui.notifications.error(game.i18n.localize("CO2PRISM.ConfigError"));
      return false;
    }).finally(() => this.refreshActor());
    this.configWrites.set(actor, pending);
    return pending;
  }

  getResource(actor, key) {
    return key === "hp" ? actor?.system?.attributes?.hp : actor?.system?.resources?.[key];
  }

  getRest(action) {
    // Identifiants vérifiés dans cof2-base ; aucune récupération de remplacement.
    const entries = game.system?.CONST?.restActions;
    if (!["fastRest", "fullRest"].includes(action) || !Array.isArray(entries)) return null;
    const matches = entries.filter(entry => entry?.id === action);
    return matches.length === 1 && typeof matches[0].handler === "function" ? matches[0] : null;
  }

  canUseAction(action, actor = this.actor) {
    if (!actor) return false;
    if (action === "sheet") return typeof actor.sheet?.render === "function";
    if (!(game.user.isGM || actor.testUserPermission(game.user, "OWNER"))) return false;
    if (!["character", "encounter"].includes(actor.type)) return false;
    if (action.startsWith("skill:")) {
      const key = action.slice(6);
      return ABILITIES.includes(key) && this.configuration?.panels.competences === true
        && Number.isFinite(actor.system?.abilities?.[key]?.value) && typeof actor.rollSkill === "function";
    }
    if (action === "fortune") {
      return actor.type === "character" && typeof actor.system.rollFortune === "function"
        && Number.isFinite(this.getResource(actor, "fortune")?.value);
    }
    if (action === "hp" || action === "mana") {
      const resource = this.getResource(actor, action);
      return typeof actor.update === "function" && Number.isFinite(resource?.value)
        && Number.isFinite(resource?.max) && resource.max >= 0;
    }
    if (action === "fastRest" || action === "fullRest") {
      return actor.type === "character" && Boolean(this.getRest(action))
        && typeof actor.system.useRecovery === "function"
        && ["hp", "mana", "recovery"].every(key => {
          const resource = this.getResource(actor, key);
          return Number.isFinite(resource?.value) && Number.isFinite(resource?.max) && resource.max >= 0;
        });
    }
    return false;
  }

  updateActions() {
    if (this.budgetBar) this.updateEconomyCommands(new ActionEconomy(this.actor).getSnapshot());
    for (const node of this.combatSlots?.querySelectorAll(".co2prism-slot-executable") ?? []) {
      const disabled = Boolean(this.busyAction) || !this.actor
        || !(game.user.isGM || this.actor.testUserPermission(game.user, "OWNER"));
      node.setAttribute("aria-disabled", String(disabled));
      node.tabIndex = disabled ? -1 : 0;
    }
    for (const { key, button } of this.skillNodes ?? []) {
      button.disabled = Boolean(this.busyAction) || !this.canUseAction(`skill:${key}`);
    }
    for (const button of this.actions) {
      const action = button.dataset.co2prismAction;
      button.disabled = Boolean(this.busyAction) || !this.canUseAction(action);
      button.setAttribute("aria-disabled", String(button.disabled));
      const missingRest = ["fastRest", "fullRest"].includes(action) && !this.getRest(action);
      const label = game.i18n.localize(`CO2PRISM.Actions.${action}`);
      button.setAttribute("aria-label", label);
      button.title = missingRest ? game.i18n.localize("CO2PRISM.RestUnavailable")
        : button.disabled ? `${label} — ${game.i18n.localize("CO2PRISM.CommandUnavailable")}` : label;
    }
  }

  async performAction(action) {
    if (this.busyAction) return;
    // Relire la sélection et les droits au clic, y compris pour un token non lié.
    this.refreshActor();
    const actor = this.actor;
    const token = this.token;
    if (!this.canUseAction(action, actor)) return;
    const isRest = action === "fastRest" || action === "fullRest";
    if (isRest && this.lastRest?.actor === actor && Date.now() - this.lastRest.at < 500) return;
    if (isRest) this.lastRest = { actor, at: Date.now() };
    this.busyAction = action;
    this.updateActions();
    try {
      if (action === "sheet") await actor.sheet.render({ force: true });
      else if (action === "fortune") await actor.system.rollFortune();
      else if (action === "hp" || action === "mana") await this.editResource(actor, token, action);
      else if (action.startsWith("skill:")) await actor.rollSkill(action.slice(6), { withDialog: true });
      else if (isRest) await this.getRest(action).handler(actor);
    } catch (error) {
      console.error("co2prism | Action", action, error);
      ui.notifications.error(game.i18n.localize("CO2PRISM.ActionError"));
    } finally {
      this.busyAction = null;
      this.refreshActor();
    }
  }

  async editResource(actor, token, key) {
    const resource = this.getResource(actor, key);
    const label = foundry.utils.escapeHTML(game.i18n.localize(`CO2PRISM.Gauges.${key}`));
    const value = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${actor.name} — ${game.i18n.localize(`CO2PRISM.Actions.${key}`)}` },
      position: { width: 300 }, modal: false, rejectClose: false,
      content: `<div class="form-group co2prism-edit-resource"><label for="co2prism-current">${label}</label>
        <input id="co2prism-current" name="co2prism-current" type="number" step="1" min="0"
          max="${resource.max}" value="${resource.value}" required autofocus></div>`,
      ok: { label: game.i18n.localize("CO2PRISM.Save"),
        callback: (_event, button) => button.form.elements.namedItem("co2prism-current").value }
    });
    if (value === null || value === undefined) return;
    this.refreshActor();
    // Un dialogue ouvert ne doit pas modifier un acteur quitté ou devenu interdit.
    if (this.token !== token || this.actor !== actor || !this.canUseAction(key, actor)) return;
    const current = this.getResource(actor, key);
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || number < 0 || number > current.max) {
      ui.notifications.warn(game.i18n.localize("CO2PRISM.InvalidValue"));
      return;
    }
    const path = key === "hp" ? "system.attributes.hp.value" : "system.resources.mana.value";
    // Actor.update conserve les validations, statuts et hooks natifs de CO2.
    await actor.update({ [path]: number });
  }

  updateLock() {
    const locked = game.settings.get(MODULE, "locked");
    this.endDrag();
    this.handle.classList.toggle("co2prism-draggable", !locked);
    this.handle.title = game.i18n.localize(locked ? "CO2PRISM.Locked" : "CO2PRISM.Move");
    this.lock.setAttribute("aria-pressed", String(locked));
    const label = game.i18n.localize(locked ? "CO2PRISM.Unlock" : "CO2PRISM.Lock");
    this.lock.title = label;
    this.lock.setAttribute("aria-label", label);
    if (this.slotDrag) this.slotDrag.cancelled = true;
    if (this.actor && this.combatRows) this.refreshActor();
  }

  layout({ preserveAnchor = false } = {}) {
    if (!this.element) return;
    this.endDrag();
    const previous = this.element.getBoundingClientRect();
    const anchor = { x: previous.left + (this.panelOffset?.x ?? 0), y: previous.top + (this.panelOffset?.y ?? 0) };
    // Le même dessin conserve ses proportions, même dans une petite fenêtre.
    const open = Boolean(this.actor && this.configuration?.panels.competences);
    const combat = Boolean(this.actor && this.configuration?.panels.combat);
    let top = open ? 237 : combat && economyEnabled() ? 32 : 0;
    const left = open ? 168 : combat ? 122 : 0;
    const movementOpen = this.movementPanel?.hidden === false;
    const reserve = movementOpen ? Math.min(180, (window.innerHeight - 8) * 0.4) : 0;
    const width = Math.max(1, Math.min(WIDTHS[game.settings.get(MODULE, "size")] ?? WIDTHS.M,
      (window.innerWidth - 8) * 724 / ((combat ? 732 : 724) + left),
      (window.innerHeight - 8 - reserve) * 724 / (BASE_BOTTOM + Math.max(top, movementOpen ? 44 : 0))));
    // Les réserves haute et basse suivent l'ancrage du dessin d'origine.
    const scale = width / 724;
    const right = combat ? Math.min(this.combatExtent ?? 1344,
      Math.max(732, (window.innerWidth - width * left / 724 - 8) / scale)) : 724;
    this.element.style.setProperty("--co2prism-unit", `${scale}px`);
    if (movementOpen) {
      this.movementPanel.style.width = `${Math.min(940, Math.max(1, right - 319)) * scale}px`;
      this.movementPanel.style.maxHeight = `${Math.max(1, window.innerHeight - 8 - (BASE_BOTTOM + 44) * scale)}px`;
      top = Math.max(top, this.movementPanel.getBoundingClientRect().height / scale + 44);
    }
    this.panelOffset = { x: width * left / 724, y: width * top / 724 };
    for (const [index, row] of (this.combatRows ?? []).entries()) {
      row.style.setProperty("--w", Math.min(this.combatRowWidths?.[index] ?? 198, Math.max(1, right - COMBAT_ROW_ORIGINS[index])));
    }
    this.budgetScroll?.style.setProperty("--w", Math.min(this.budgetWidth ?? 492, Math.max(1, right - BUDGET_ORIGIN - 8)));
    this.combatEffects?.style.setProperty("--w", Math.min(824, Math.max(1, right - 731)));
    this.combatLine?.style.setProperty("--w", Math.max(0, right - 480 - 60));
    this.combatArrow?.style.setProperty("--x", right - 93);
    this.element.style.setProperty("--co2prism-base-width", `${width}px`);
    this.element.style.setProperty("--co2prism-base-height", `${width * 515 / 724}px`);
    this.element.style.setProperty("--co2prism-offset-x", `${this.panelOffset.x}px`);
    this.element.style.setProperty("--co2prism-offset-y", `${this.panelOffset.y}px`);
    this.element.style.width = `${width * right / 724 + this.panelOffset.x}px`;
    this.element.style.height = `${width * BASE_BOTTOM / 724 + this.panelOffset.y}px`;
    const saved = this.position;
    const valid = Number.isFinite(saved?.x) && Number.isFinite(saved?.y);
    const x = preserveAnchor ? anchor.x : valid ? saved.x : 40;
    const y = preserveAnchor ? anchor.y : valid ? saved.y : window.innerHeight - width * BASE_BOTTOM / 724 - 40;
    // Le maintien du portrait ne peut pas laisser le volet déplié hors écran.
    this.place(x - this.panelOffset.x, y - this.panelOffset.y);
    for (const row of this.combatRows ?? []) {
      if (row.scrollWidth <= row.clientWidth) row.scrollLeft = 0;
    }
    // Mémoriser aussi le retour à l'écran après un changement de taille.
    const placed = this.element.getBoundingClientRect();
    if ((valid || preserveAnchor) && (Math.abs(placed.left + this.panelOffset.x - x) > 0.5
      || Math.abs(placed.top + this.panelOffset.y - y) > 0.5)) {
      this.position = { x: placed.left + this.panelOffset.x, y: placed.top + this.panelOffset.y };
      void game.settings.set(MODULE, "position", this.position);
    }
  }

  place(x, y, clamp = true) {
    const bounds = this.element.getBoundingClientRect();
    this.element.style.left = `${clamp ? Math.max(0, Math.min(x, window.innerWidth - bounds.width)) : x}px`;
    this.element.style.top = `${clamp ? Math.max(0, Math.min(y, window.innerHeight - bounds.height)) : y}px`;
  }

  startDrag(event) {
    if (this.drag || event.button !== 0 || game.settings.get(MODULE, "locked")) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = this.element.getBoundingClientRect();
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      left: bounds.left, top: bounds.top, moved: false };
    this.handle.setPointerCapture(event.pointerId);
  }

  moveDrag(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    this.place(drag.left + dx, drag.top + dy);
  }

  endDrag(event) {
    const drag = this.drag;
    if (!drag || (event && event.pointerId !== drag.id)) return;
    this.drag = null;
    if (this.handle.hasPointerCapture(drag.id)) this.handle.releasePointerCapture(drag.id);
    if (!drag.moved) return;
    const bounds = this.element.getBoundingClientRect();
    this.position = { x: bounds.left + (this.panelOffset?.x ?? 0), y: bounds.top + (this.panelOffset?.y ?? 0) };
    void game.settings.set(MODULE, "position", this.position);
  }
}

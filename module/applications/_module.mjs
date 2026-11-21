import { ActionEconomy } from "../combat/action-economy.mjs";
import { DEFENSE_COSTS, defenseStances } from "../combat/defense.mjs";

import { MovementTracker, roundMovementCells } from "../movement/movement-tracker.mjs";
import { MovementNotifications } from "../movement/movement-notifications.mjs";
import { MovementZones } from "../movement/movement-zones.mjs";

const MODULE = "co2prism";
const TEMPLATE_ROOT = `modules/${MODULE}/templates`;
const PARTIALS = { core: "core", inventory: "inventory", movement: "movement", skills: "skills",
  effects: "effects", combat: "combat", combatActions: "combat-actions" };
const WIDTHS = { S: 300, M: 430, L: 600, XL: 780 };
const MODE_CHOICES = { always: "CO2PRISM.ModeAlways", combat: "CO2PRISM.ModeInCombat", off: "CO2PRISM.ModeNever" };
const ABILITIES = ["for", "agi", "con", "cha", "int", "vol", "per"];
const MAX_SHORTCUT_ACTIONS = 4;
const SHORTCUT_PREVIEW_DELAY = 350;
const PANELS = ["combat", "competences", "equipements", "voies"];
const EXCLUSIVE_PANELS = { equipements: "voies", voies: "equipements" };
// Depuis le portrait vers l'extérieur du volet.
const EQUIPMENT_GROUPS = [
  ["weapon", "fa-axe", ["weapon"]],
  ["protection", "fa-helmet-battle", ["armor", "shield"]],
  ["consumable", "fa-flask-round-potion", ["consumable"]],
  ["misc", "fa-backpack", ["misc"]],
  ["containers", "fa-treasure-chest", []]
];
let bar;
let visibilityOverride;
let visibilityWrite = Promise.resolve();

function prismVisible() {
  return visibilityOverride ?? (game.settings?.get(MODULE, "visible") !== false);
}

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
    type: String, default: "combat", choices: MODE_CHOICES, onChange: () => bar?.refreshActor()
  });
  game.settings.register(MODULE, "movementMode", {
    name: "CO2PRISM.MovementMode", scope: "user", config: true, type: String, default: "always",
    choices: MODE_CHOICES,
    onChange: () => bar?.refreshActor()
  });
  game.settings.register(MODULE, "size", {
    scope: "user", config: false, type: String, default: "M"
  });
  game.settings.register(MODULE, "sizeWidth", {
    scope: "user", config: false, type: Number, default: 0,
    onChange: () => bar?.layout()
  });
  game.settings.register(MODULE, "visible", {
    scope: "user", config: false, type: Boolean, default: true
  });
  game.settings.register(MODULE, "position", {
    scope: "user", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE, "locked", {
    name: "CO2PRISM.Locked", hint: "CO2PRISM.LockedHint", scope: "user", config: false,
    type: Boolean, default: true, onChange: () => bar?.updateLock()
  });
});

Hooks.on("getSceneControlButtons", controls => {
  if (game.system.id !== "co2" || !controls.tokens?.tools) return;
  const { tools } = controls.tokens;
  tools.co2prism = {
    name: "co2prism", title: "CO2PRISM.SceneVisibility", icon: "fa-solid fa-gem",
    order: Math.max(0, ...Object.values(tools).map(tool => tool.order ?? 0)) + 1,
    toggle: true, active: prismVisible(),
    onChange: (_event, active) => {
      visibilityOverride = active;
      bar?.refreshActor();
      const write = visibilityWrite.then(() => game.settings.set(MODULE, "visible", active)).then(() => {
        if (visibilityWrite === write) visibilityOverride = undefined;
      }).catch(error => console.error("co2prism | Visibility preference", error));
      visibilityWrite = write;
    }
  };
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
    this.movementClosures = new WeakMap();
    this.movementResults = new WeakMap();
    this.movementNotifications = new MovementNotifications();
    this.movementContextVersion = 0;
    this.movementZones = new MovementZones({ getPalette: () => {
      if (this.element?.nodeType !== 1) return undefined;
      const style = getComputedStyle(this.element);
      const move = Number.parseInt(style.getPropertyValue("--prism-move").trim().slice(1), 16);
      const origin = Number.parseInt(style.getPropertyValue("--prism-origin").trim().slice(1), 16);
      return Number.isFinite(move) && Number.isFinite(origin) ? { move, origin } : undefined;
    } });
    this.changingHands = new WeakSet();
  }

  async render() {
    if (document.getElementById("co2prism-bar")) return;
    const { renderTemplate } = foundry.applications.handlebars;
    // Seuls les fragments statiques rendus par Handlebars sont insérés dans bar.hbs.
    const sections = await Promise.all(Object.entries(PARTIALS).map(async ([key, name]) =>
      [key, await renderTemplate(`${TEMPLATE_ROOT}/partials/${name}.hbs`, {})]));
    const markup = await renderTemplate(`${TEMPLATE_ROOT}/bar.hbs`, Object.fromEntries(sections));
    document.body.insertAdjacentHTML("beforeend", markup);
    this.element = document.getElementById("co2prism-bar");
    this.handle = this.element.querySelector(".co2prism-portrait");
    this.anchor = this.element.querySelector(".co2prism-portrait-zone");
    this.targetStrip = this.anchor.querySelector(".co2prism-targets");
    this.lock = this.element.querySelector(".co2prism-lock");
    this.sizeSlider = this.element.querySelector(".co2prism-size-slider");
    this.sizeSlider.min = WIDTHS.S;
    this.sizeSlider.max = WIDTHS.XL;
    this.art = this.element.querySelector(".co2prism-art");
    this.portrait = this.element.querySelector(".co2prism-portrait");
    this.name = this.element.querySelector(".co2prism-name");
    this.combatPanel = this.element.querySelector(".co2prism-combat");
    this.budgetBand = this.element.querySelector(".co2prism-budget-band");
    this.defenseButtons = [...this.combatPanel.querySelectorAll("[data-co2prism-defense]")];
    for (const button of this.defenseButtons) button.addEventListener("click", () => {
      void this.toggleDefense(button.dataset.co2prismDefense);
    });
    this.combatToggle = this.element.querySelector(".co2prism-combat-toggle");
    this.combatToggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      void this.writeConfiguration("panels.combat", value => !value);
    });
    this.combatValues = Object.fromEntries(["meters", "cells", "def", "dr"].map(key =>
      [key, this.element.querySelector(`[data-co2prism-combat-value="${key}"]`)]));
    this.combatEffects = this.element.querySelector(".co2prism-effects");
    this.bindDescriptiveTooltips();
    this.combatEffects.addEventListener("wheel", event => {
      if (event.ctrlKey || event.shiftKey || event.deltaX || !event.deltaY) return;
      const band = this.combatEffects;
      const before = band.scrollLeft;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? band.clientWidth : 1;
      band.scrollLeft += event.deltaY * unit;
      if (band.scrollLeft !== before) event.preventDefault();
    }, { passive: false });
    this.combatSlots = this.element.querySelector(".co2prism-combat-slots");
    this.combatRows = [...this.combatSlots.querySelectorAll(".co2prism-combat-row")];
    this.conditionalZone = this.combatSlots.querySelector(".co2prism-conditional-zone");
    this.shortcutPreview = this.element.querySelector(".co2prism-shortcut-preview");
    this.presetActionMenu = this.element.querySelector(".co2prism-preset-action-menu");
    this.combatSlots.addEventListener("scroll", () => {
      this.clearShortcutPreview();
      this.closePresetActionMenu();
    }, { capture: true });
    this.combatHands = Object.fromEntries([...this.combatPanel.querySelectorAll("[data-co2prism-hand-container]")]
      .map(node => [node.dataset.co2prismHandContainer, node]));
    this.budgetScroll = this.element.querySelector(".co2prism-budget-scroll");
    this.timeCommands = this.element.querySelector(".co2prism-time-commands");
    this.budgetBar = this.element.querySelector(".co2prism-time-bar");
    this.budgetCommands = [...this.element.querySelectorAll("[data-co2prism-time]")];
    this.budgetReset = this.element.querySelector(".co2prism-budget-reset");
    this.upperLine = this.element.querySelector(".co2prism-upper-line");
    this.movementPanel = this.element.querySelector(".co2prism-movement-panel");
    this.movementValidate = this.movementPanel.querySelector(".co2prism-movement-validate");
    this.movementValidate.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      if (event.detail > 1) return;
      void this.validateMovement(this.movementToken());
    });
    this.movementReset = this.movementPanel.querySelector(".co2prism-movement-reset");
    this.movementZonesButton = this.movementPanel.querySelector(".co2prism-movement-zones-toggle");
    this.movementZonesButton.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); void this.toggleMovementZones();
    });
    this.movementZonesObserver = new MutationObserver(() => {
      if (this.shortcutHover && (this.element.hidden || !this.element.getClientRects().length)) this.clearShortcutPreview();
      if (!this.element.isConnected) {
        this.movementZones.clear();
        this.movementZonesObserver.disconnect();
        this.presentationObserver?.disconnect();
        this.disconnectInventoryScroll();
        this.tooltipListeners?.abort();
        this.tooltipObserver?.disconnect();
        this.clearDescriptiveTooltip();
        if (this.onWindowResize) window.removeEventListener("resize", this.onWindowResize);
      }
    });
    this.movementZonesObserver.observe(document.body, { childList: true });
    this.movementZonesObserver.observe(this.element, { attributes: true, attributeFilter: ["hidden", "style", "class"] });
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
      this.clearShortcutPreview();
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
    this.connectEquipment();
    this.connectPaths();
    this.connectInventoryScroll();
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
        void this.setActivePreset(Number(button.dataset.co2prismPreset), event.shiftKey);
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
      text: this.element.querySelector(`[data-co2prism-value="${key}"]`),
      encounterText: this.element.querySelector(`[data-co2prism-gauge="${key}"] > .co2prism-encounter-value`)
    }]));
    this.position = game.settings.get(MODULE, "position");
    this.lock.addEventListener("click", () => { void this.toggleLock(); });
    this.sizeSlider.addEventListener("input", () => {
      if (this.lockChangePending || game.settings.get(MODULE, "locked")) return;
      this.previewWidth = this.sizeSlider.valueAsNumber;
      this.layout();
    });
    this.handle.addEventListener("pointerdown", event => {
      if (event.button === 0) this.portraitMoved = false;
      this.startDrag(event);
    });
    this.handle.addEventListener("pointermove", event => this.moveDrag(event));
    this.handle.addEventListener("pointerup", event => this.endDrag(event));
    this.handle.addEventListener("pointercancel", event => this.endDrag(event));
    this.handle.addEventListener("lostpointercapture", event => this.endDrag(event));
    this.portrait.addEventListener("click", event => {
      if (event.detail === 1) this.portraitFirstClickMoved = this.portraitMoved;
    });
    this.portrait.addEventListener("dblclick", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (!this.portraitFirstClickMoved && !this.portraitMoved) void this.performAction("sheet");
    });
    this.onWindowResize = () => this.layout();
    window.addEventListener("resize", this.onWindowResize);
    this.presentationObserver = new ResizeObserver(() => this.layout({ preserveAnchor: true }));
    this.presentationObserver.observe(this.art);
    this.updateLock();
    this.layout();
    this.connectActor();
    this.targetScene = globalThis.canvas?.ready ? canvas.scene : null;
    this.renderTargets();
  }

  renderTargets(excluded = null) {
    if (!this.targetStrip) return;
    const scene = this.targetScene;
    const targets = scene ? Array.from(game.user.targets ?? []).filter(({ document: token }) =>
      token && token !== excluded && token.parent === scene && scene.tokens?.get(token.id) === token) : [];
    this.targetStrip.hidden = targets.length === 0;
    if (targets.length > 10) {
      this.targetStrip.textContent = game.i18n.localize("CO2PRISM.ManyTargets");
      return;
    }
    const rows = [];
    for (let start = 0; start < targets.length; start += 5) {
      const row = document.createElement("div");
      row.className = "co2prism-target-row";
      for (const token of targets.slice(start, start + 5)) {
        const image = document.createElement("img");
        image.alt = "";
        image.draggable = false;
        image.src = token.document.texture?.src || "icons/svg/mystery-man.svg";
        image.addEventListener("contextmenu", event => {
          event.preventDefault();
          event.stopPropagation();
          if (this.targetScene === token.document.parent && game.user.targets?.has(token)) {
            token.setTarget(false, { releaseOthers: false });
          }
        });
        image.addEventListener("pointerenter", () => {
          const modes = globalThis.CONST?.TOKEN_DISPLAY_MODES;
          const { displayName, isSecret, name } = token.document;
          if (!modes || isSecret !== false || token.isVisible !== true) return;
          const visible = displayName === modes.HOVER || (displayName === modes.OWNER_HOVER && token.isOwner)
            || token._canViewMode?.(displayName) === true;
          if (visible && name) image.title = name;
        });
        image.addEventListener("pointerleave", () => image.removeAttribute("title"));
        row.append(image);
      }
      rows.push(row);
    }
    this.targetStrip.replaceChildren(...rows);
  }

  connectActor() {
    this.movementNotifications.connect();
    for (const event of ["createCombat", "updateCombat", "deleteCombat", "combatTurnChange"]) {
      Hooks.on(event, (combat, changed) => {
        if (event !== "createCombat" && (event !== "updateCombat" || ["round", "turn", "active"].some(key => key in (changed ?? {})))) this.movementContextVersion++;
        this.refreshActor();
      });
    }
    for (const event of ["createCombatant", "updateCombatant", "deleteCombatant"]) {
      Hooks.on(event, combatant => {
        if (game.settings.get(MODULE, "movementMode") === "combat" && combatant.parent === game.combats?.active) {
          this.refreshActor();
        }
      });
    }
    // L'instance vit avec le monde ; ces hooks ne sont installés qu'au premier rendu.
    Hooks.on("controlToken", () => {
      this.renderTargets();
      this.refreshActor();
    });
    Hooks.on("updateUser", (user, changes) => {
      if (user.id === game.user.id && "character" in changes) this.refreshActor();
      if (user.id === game.user.id && "role" in changes) this.renderTargets();
    });
    this.onTargetToken = user => { if (user === game.user) this.renderTargets(); };
    Hooks.on("targetToken", this.onTargetToken);
    Hooks.on("canvasReady", () => {
      this.targetScene = globalThis.canvas?.scene;
      this.renderTargets();
      this.refreshActor();
    });
    Hooks.on("canvasTearDown", canvas => {
      this.targetScene = null;
      this.renderTargets();
      this.movementZones.clear();
      this.movementTracker.closeScene(canvas?.scene ?? globalThis.canvas?.scene);
      this.refreshActor(false);
    });
    Hooks.on("moveToken", (token, movement) => {
      if (this.movementTrackingAllowed(token)) this.movementTracker.update(token, movement);
      if (token === this.token?.document) this.refreshActor();
    });
    Hooks.on("recordToken", token => {
      if (this.movementTrackingAllowed(token)) this.movementTracker.refresh(token);
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
      if (Object.keys(changed).some(key => key === "ownership" || key.startsWith("ownership."))
        && Array.from(game.user.targets ?? []).some(token => token.actor === actor)) this.renderTargets();
      if (Object.keys(changed).some(key => key === "flags" || key.startsWith("flags.co2prism"))) {
        const budget = new ActionEconomy(actor).getSnapshot();
        if (budget.branch === "undecided" && Object.values(budget.granted).every(value => value === 0)) this.movementContextVersion++;
      }
      const relevant = Object.keys(changed).some(key => ["system", "img", "name", "ownership", "flags"].includes(key)
        || key.startsWith("system.") || key.startsWith("ownership.")
        || key === "flags.co2prism" || key === "flags.-=co2prism" || key.startsWith("flags.co2prism."));
      if (relevant && this.concernsActor(actor)) {
        if (Object.keys(changed).some(key => /^(system|ownership)(\.|$)/.test(key))) this.invalidateShortcutVisibility();
        this.refreshActor();
      }
    });
    Hooks.on("deleteActor", actor => {
      if (this.concernsActor(actor)) this.refreshActor(false);
    });
    Hooks.on("updateToken", (token, changed) => {
      if (game.user.targets?.has(token.object)) this.renderTargets();
      const relevant = Object.keys(changed).some(key => ["actorId", "actorLink", "delta", "ownership"].includes(key)
        || key.startsWith("delta."));
      if (relevant && token === this.token?.document) {
        this.invalidateShortcutVisibility();
        this.refreshActor();
      }
    });
    Hooks.on("deleteToken", token => {
      if (token.parent === this.targetScene) this.renderTargets(token);
      if (token === this.movementZones.token) this.movementZones.clear();
      this.movementTracker.deleteToken(token);
      if (token === this.token?.document) this.refreshActor(false);
    });
    // Les objets et effets peuvent modifier les valeurs préparées sans updateActor.
    for (const type of ["Item", "ActiveEffect"]) {
      for (const event of ["create", "update", "delete"]) {
        Hooks.on(`${event}${type}`, document => {
          const parent = document.parent?.documentName === "Item" ? document.parent.parent : document.parent;
          if (this.concernsActor(parent)) {
            this.invalidateShortcutVisibility();
            this.refreshActor();
          }
        });
      }
    }
    this.refreshActor();
  }

  concernsActor(actor) {
    const selected = this.token?.actor ?? this.actor;
    return Boolean(actor && selected && (actor === selected || actor.uuid === selected.uuid
      || actor === this.token?.document?.baseActor));
  }

  refreshActor(useCanvas = true) {
    const controlled = useCanvas && globalThis.canvas?.ready ? canvas.tokens?.controlled ?? [] : [];
    const token = controlled.length === 1 ? controlled[0] : null;
    const mainCharacter = controlled.length === 0 && !game.user.isGM ? game.user.character : null;
    const candidate = token ? token.actor : mainCharacter;
    // Comme les feuilles CO2, réserver les statistiques aux observateurs autorisés.
    const actor = candidate?.testUserPermission(game.user, "OBSERVER") ? candidate : null;
    if (actor !== this.actor || token !== this.token) {
      this.shortcutVisibilityCache = null;
      this.clearDescriptiveTooltip();
      this.tooltipHover = null;
    }
    this.token = token;
    this.actor = actor;
    this.actorWithoutToken = Boolean(actor && !token);
    const encounter = actor?.type === "encounter";
    const isCompanion = encounter && actor.system?.companion?.isCompanion === true;
    this.element?.classList?.toggle("co2prism-encounter", encounter);
    this.element?.classList?.toggle("co2prism-companion", isCompanion);
    const rendered = this.element?.nodeType === 1;
    const visible = Boolean(actor && (!rendered || prismVisible()));
    if (this.slotDrag && (!visible || this.slotDrag.actor !== actor || this.slotDrag.token !== token)) this.slotDrag.cancelled = true;
    const wasHidden = this.element?.hidden;
    if (rendered) {
      if (!visible && !wasHidden) {
        this.endDrag();
        this.clearDescriptiveTooltip();
        this.tooltipHover = null;
        this.clearShortcutPreview();
        this.closeEquipmentMenu();
        this.closePresetActionMenu();
      }
      this.element.hidden = !visible;
      if (!visible) {
        this.configuration = this.readConfiguration(actor);
        this.updateMovementPanel();
        return;
      }
    }
    const unavailable = game.i18n.localize("CO2PRISM.Unavailable");
    const details = actor?.system?.details;
    const localizeDetail = (prefix, value) => {
      if (typeof value !== "string" || !value) return unavailable;
      const key = `${prefix}.${value}`;
      const label = game.i18n.localize(key);
      return label === key ? unavailable : label;
    };
    const summaries = [];
    for (const [key, nodes] of Object.entries(this.gauges)) {
      if (encounter && nodes.encounterText) {
        delete nodes.fill.dataset.co2prismTooltipText;
        let label;
        if (key === "recovery") label = localizeDetail("CO.encounter.category", details?.category);
        else if (key === "fortune") label = localizeDetail("CO.size", details?.size);
        else {
          const html = typeof details?.properties === "string" ? foundry.utils.cleanHTML(details.properties) : "";
          const hasProperties = Boolean(html && this.plainText(html));
          label = game.i18n.localize(hasProperties ? "CO2PRISM.Encounter.Properties" : "CO2PRISM.Encounter.NoProperties");
          if (hasProperties && nodes.fill.dataset.co2prismImmediateHtml !== html) nodes.fill.dataset.co2prismImmediateHtml = html;
          else if (!hasProperties) delete nodes.fill.dataset.co2prismImmediateHtml;
        }
        nodes.encounterText.textContent = label;
        summaries.push(label);
        continue;
      }
      if (nodes.fill.dataset.co2prismImmediateHtml) delete nodes.fill.dataset.co2prismImmediateHtml;
      const resource = this.getResource(actor, key);
      const current = Number.isFinite(resource?.value) ? resource.value : null;
      const maximum = Number.isFinite(resource?.max) && resource.max > 0 ? resource.max : null;
      const text = current === null && maximum === null ? unavailable
        : `${current ?? unavailable} / ${maximum ?? unavailable}`;
      const fill = current !== null && maximum !== null
        ? Math.max(0, Math.min(100, current / maximum * 100)) : 0;
      if (nodes.text.textContent !== text) nodes.text.textContent = text;
      nodes.fill.style.setProperty("--fill", `${fill}%`);

      const label = `${game.i18n.localize(`CO2PRISM.Gauges.${key}`)} : ${text}`;
      nodes.fill.dataset.co2prismTooltipText = label;
      summaries.push(label);
    }
    const nc = actor?.system?.attributes?.nc;
    const name = encounter && Number.isFinite(nc) ? game.i18n.format("CO2PRISM.Encounter.Name", { name: actor.name, nc }) : actor?.name;
    this.name.textContent = name || unavailable;
    this.name.dataset.co2prismTooltipText = name || game.i18n.localize("CO2PRISM.NoActor");
    const portrait = actor?.img || "icons/svg/mystery-man.svg";
    if (this.portrait.getAttribute("src") !== portrait) this.portrait.setAttribute("src", portrait);
    this.art.setAttribute("aria-label", actor ? `${name}. ${summaries.join(". ")}`
      : game.i18n.localize("CO2PRISM.NoActor"));
    this.updateActions();
    this.configuration = this.readConfiguration(actor);
    this.updatePresets();
    const panels = [this.skillsPanel, this.combatPanel, this.movementPanel, this.equipmentPanel, this.pathsPanel];
    const visibility = panels.map(panel => panel?.hidden);
    this.updateSkills();
    // Fermer d'abord le volet qui partage la même zone.
    if (this.configuration.panels.voies) {
      this.updateEquipment();
      this.updatePaths();
    } else {
      this.updatePaths();
      this.updateEquipment();
    }
    const combatChanged = this.updateCombat();
    this.updateMovementPanel();
    if (this.anchor && (wasHidden || combatChanged || panels.some((panel, index) => panel?.hidden !== visibility[index]))) {
      this.layout({ preserveAnchor: !wasHidden });
    }
  }

  readPathGroups(actor) {
    // Les groupes de la feuille enrichissent aussi les capacités liées. Prism ne lit que les Items embarqués.
    const paths = [...(actor.paths ?? [])].sort((a, b) => a.sort - b.sort);
    const groups = new Map(paths.map(path => [path.id, { path, capacities: [] }]));
    const resolve = (uuid, type) => {
      if (!uuid || typeof uuid !== "string") return null;
      const item = actor.getEmbeddedItemByUuid(uuid);
      const base = actor.isToken ? this.token?.document.baseActor : null;
      if (item?.type !== type || (item.uuid !== uuid && base?.items.get(item.id)?.uuid !== uuid)) return null;
      return item;
    };
    const seen = new Set();
    const add = (group, capacity) => {
      if (seen.has(capacity.id)) return;
      seen.add(capacity.id);
      group.capacities.push(capacity);
    };
    for (const group of groups.values()) {
      for (const uuid of group.path.system.capacities) {
        const capacity = resolve(uuid, "capacity");
        // Un détachement explicite prime sur une ancienne liste de la voie.
        if (!capacity || capacity.system.path === null || capacity.system.path === "") continue;
        const linkedPath = resolve(capacity.system.path, "path");
        if (!linkedPath || linkedPath.id === group.path.id) add(group, capacity);
      }
    }
    const offPaths = { path: null, capacities: [] };
    for (const capacity of actor.capacities ?? []) {
      const path = resolve(capacity.system.path, "path");
      const group = groups.get(path?.id);
      if (group) add(group, capacity);
      // Un lien encore non résolu reste distinct d'une capacité sans voie.
      else if (!capacity.system.path) add(offPaths, capacity);
    }
    const result = [...groups.values()];
    if (offPaths.capacities.length) result.push(offPaths);
    for (const group of result) group.capacities.sort((a, b) => a.system.rank - b.system.rank);
    return result;
  }

  connectInventoryScroll() {
    const panels = [this.equipmentPanel, this.pathsPanel];
    const update = panel => {
      const { clientHeight, clientWidth, scrollHeight, scrollTop } = panel;
      const overflow = clientHeight > 0 ? scrollHeight - clientHeight : 0;
      panel.toggleAttribute("data-scroll-above", overflow > .5 && scrollTop > .5);
      panel.toggleAttribute("data-scroll-below", overflow - scrollTop > .5);
      panel.parentElement.style.setProperty("--inventory-scroll-width", clientWidth + "px");
    };
    const refresh = () => panels.forEach(update);
    this.inventoryScrollListeners = new AbortController();
    this.inventoryScrollResize = new ResizeObserver(refresh);
    this.inventoryScrollContent = new MutationObserver(refresh);
    for (const panel of panels) {
      panel.addEventListener("scroll", () => update(panel), { passive: true, signal: this.inventoryScrollListeners.signal });
      this.inventoryScrollResize.observe(panel);
      this.inventoryScrollContent.observe(panel, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "data-collapsed", "style"]
      });
    }
    refresh();
  }

  disconnectInventoryScroll() {
    this.inventoryScrollListeners?.abort();
    this.inventoryScrollResize?.disconnect();
    this.inventoryScrollContent?.disconnect();
  }

  connectPaths() {
    this.pathsPanel = this.element.querySelector(".co2prism-paths");
    this.pathsToggle = this.element.querySelector(".co2prism-paths-toggle");
    this.pathsToggle.addEventListener("click", event => {
      event.stopPropagation();
      void this.writeConfiguration("panels.voies", value => !value);
    });
    this.pathsToggle.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();
      void this.togglePathGroups();
    });
    this.pathsPanel.addEventListener("click", event => {
      if (event.button !== 0 || this.pathsPanel.hidden) return;
      const header = event.target.closest(".co2prism-path-header");
      if (header && this.canConfigure(this.actor) && !event.ctrlKey && !event.metaKey) {
        event.stopPropagation();
        void this.togglePathGroups(header.closest(".co2prism-path-group").dataset.pathKey);
        return;
      }
      const tile = event.target.closest(".co2prism-path-tile[data-item-id]");
      if (!tile) return;
      event.stopPropagation();
      const item = this.actor?.items.get(tile.dataset.itemId);
      if (item?.uuid === tile.dataset.itemUuid && ["path", "capacity"].includes(item.type)) void this.openItemSheet(item);
    });
    this.pathsPanel.addEventListener("contextmenu", event => {
      const header = event.target.closest(".co2prism-path-header");
      if (!header || this.pathsPanel.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      void this.togglePathGroups(header.closest(".co2prism-path-group").dataset.pathKey);
    });
  }

  togglePathGroups(key) {
    const { actor, token } = this;
    if (!this.canConfigure(actor)) return Promise.resolve(false);
    return this.queueConfiguration(actor, async () => {
      if (this.actor !== actor || this.token !== token || !this.canConfigure(actor)) return false;
      const keys = this.readPathGroups(actor).map(({ path }) => path?.id ?? "off-paths");
      const targets = key === undefined ? keys : keys.filter(id => id === key);
      if (!targets.length) return false;
      const { pathCollapsed } = this.readConfiguration(actor);
      const next = !targets.every(id => pathCollapsed.has(id));
      if (key === undefined) {
        const states = Object.fromEntries([...pathCollapsed].map(id => [id, true]));
        for (const id of targets) states[id] = next;
        await actor.setFlag(MODULE, "pathCollapsed", states);
      } else await actor.setFlag(MODULE, `pathCollapsed.${key}`, next);
      return true;
    });
  }

  updatePaths() {
    if (!this.pathsPanel) return;
    const open = Boolean(this.actor && this.configuration.panels.voies);
    this.pathsPanel.hidden = !open;
    this.pathsToggle.disabled = !this.canConfigure();
    this.pathsToggle.setAttribute("aria-expanded", String(open));
    const label = game.i18n.localize(open ? "CO2PRISM.Paths.Close" : "CO2PRISM.Paths.Open");
    this.pathsToggle.setAttribute("aria-label", label);
    this.pathsToggle.dataset.co2prismTooltipText = this.pathsToggle.disabled ? label
      : `${label}\n${game.i18n.localize("CO2PRISM.Paths.ToggleAllHint")}`;
    const dismissTooltip = () => {
      if (game.tooltip?.element && this.pathsPanel.contains(game.tooltip.element)) this.clearDescriptiveTooltip();
    };
    if (!open) {
      dismissTooltip();
      return;
    }

    const groups = this.readPathGroups(this.actor);
    const canConfigure = this.canConfigure();
    const itemSignature = item => [item.uuid, item.name, item.img, this.itemTooltipDescription(item), item.isOwner];
    const signature = JSON.stringify([canConfigure, groups.map(({ path, capacities }) => [
      path && itemSignature(path), capacities.map(capacity => [...itemSignature(capacity), capacity.system.learned]),
      this.configuration.pathCollapsed.has(path?.id ?? "off-paths")
    ])]);
    if (signature === this.pathsSignature) return;
    this.pathsSignature = signature;
    dismissTooltip();
    const scroll = this.pathsPanel.scrollTop;
    const active = this.pathsPanel.contains(document.activeElement) ? document.activeElement : null;
    const disclosureKey = active?.classList.contains("co2prism-path-header")
      ? active.closest(".co2prism-path-group").dataset.pathKey : null;
    let nextFocus;
    this.pathsPanel.replaceChildren(...groups.map(({ path, capacities }, index) => {
      const key = path?.id ?? "off-paths";
      const collapsed = this.configuration.pathCollapsed.has(key);
      const group = document.createElement("section");
      group.className = "co2prism-path-group";
      group.dataset.pathKey = key;
      group.dataset.collapsed = String(collapsed);
      const title = document.createElement("span");
      title.className = "co2prism-path-label";
      title.textContent = path?.name ?? game.i18n.localize("CO2PRISM.Paths.OffPaths");
      group.setAttribute("aria-label", title.textContent);
      const tile = item => {
        const node = document.createElement("button");
        node.type = "button";
        node.className = "co2prism-path-tile";
        node.dataset.itemId = item.id;
        node.dataset.itemUuid = item.uuid;
        const image = document.createElement("img");
        image.src = item.img || "icons/svg/item-bag.svg";
        image.alt = item.name;
        image.draggable = false;
        node.append(image);
        void this.prepareItemTooltip(node, item, this.itemTooltipDescription(item));
        return node;
      };
      const header = path ? tile(path) : document.createElement("button");
      header.classList.add("co2prism-path-header");
      if (!path) {
        header.type = "button";
        header.classList.add("co2prism-path-off", "co2prism-path-tile");
        const icon = document.createElement("i");
        icon.className = "fa-solid fa-circle-star";
        icon.setAttribute("aria-hidden", "true");
        header.append(icon);
        header.setAttribute("aria-label", title.textContent);
        header.dataset.co2prismTooltipText = title.textContent;
        header.disabled = !canConfigure;
      }
      if (canConfigure) header.setAttribute("aria-expanded", String(!collapsed));
      const items = document.createElement("div");
      items.className = "co2prism-path-items";
      items.id = `co2prism-path-items-${index}`;
      items.hidden = collapsed;
      if (canConfigure) header.setAttribute("aria-controls", items.id);
      if (key === disclosureKey) nextFocus = header;
      title.hidden = collapsed;
      group.append(header);
      if (path) group.append(title);
      group.append(items);
      if (!collapsed) capacities.forEach(capacity => {
        const node = tile(capacity);
        node.dataset.learned = String(capacity.system.learned === true);
        items.append(node);
      });
      if (!collapsed && !capacities.length) {
        const empty = document.createElement("span");
        empty.className = "co2prism-inventory-empty";
        empty.textContent = game.i18n.localize("CO2PRISM.Paths.Empty");
        items.append(empty);
      }
      return group;
    }));
    this.pathsPanel.scrollTop = scroll;
    nextFocus?.focus({ preventScroll: true });
  }

  connectEquipment() {
    this.equipmentPanel = this.element.querySelector(".co2prism-equipment");
    this.equipmentToggle = this.element.querySelector(".co2prism-equipment-toggle");
    this.equipmentMenu = this.element.querySelector(".co2prism-equipment-menu");
    this.equipmentPanel.addEventListener("scroll", () => this.closeEquipmentMenu());
    this.equipmentToggle.addEventListener("click", event => {
      event.stopPropagation();
      void this.writeConfiguration("panels.equipements", value => !value);
    });
    this.equipmentToggle.addEventListener("contextmenu", event => {
      if (!this.canConfigure()) return;
      event.preventDefault();
      event.stopPropagation();
      void this.writeConfiguration("equipmentCollapsed", states => !Object.values(states).every(Boolean));
    });
    this.equipmentPanel.addEventListener("click", event => {
      const item = this.equipmentItem(event);
      if (!item || event.button !== 0) return;
      event.stopPropagation();
      void this.openItemSheet(item);
    });
    this.equipmentPanel.addEventListener("contextmenu", event => {
      const actor = this.actor;
      const item = this.equipmentItem(event);
      if (!item) return;
      if (game.settings.get(MODULE, "locked")) {
        this.openEquipmentMenu(event, item);
        return;
      }
      if (!this.canConfigure(actor)) return;
      event.preventDefault();
      event.stopPropagation();
      void this.queueConfiguration(actor, async () => {
        if (game.settings.get(MODULE, "locked") || !this.canConfigure(actor) || actor.items.get(item.id) !== item) return false;
        const path = `hiddenEquipment.${item.id}`;
        if (this.readConfiguration(actor).hiddenEquipment.has(item.id)) await actor.unsetFlag(MODULE, path);
        else await actor.setFlag(MODULE, path, true);
        return true;
      });
    });
    this.equipmentGroups = [...EQUIPMENT_GROUPS].reverse().map(([key, glyph, subtypes]) => {
      const group = document.createElement("section");
      group.className = "co2prism-equipment-group";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "co2prism-equipment-category";
      const icon = document.createElement("i");
      icon.className = `fa-solid ${glyph}`;
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
      const items = document.createElement("div");
      items.className = "co2prism-equipment-items";
      items.id = `co2prism-equipment-${key}`;
      items.setAttribute("role", "group");
      button.setAttribute("aria-controls", items.id);
      button.addEventListener("click", event => {
        event.stopPropagation();
        void this.writeConfiguration(`equipmentCollapsed.${key}`, value => !value);
      });
      group.append(button, items);
      this.equipmentPanel.append(group);
      return { key, subtypes, group, button, items };
    });
  }

  equipmentItem(event) {
    const tile = event.target.closest(".co2prism-equipment-tile[data-item-id]");
    if (!tile || !this.equipmentPanel.contains(tile) || this.equipmentPanel.hidden || tile.closest("[hidden]")) return null;
    return this.actor?.items.get(tile.dataset.itemId);
  }

  equipmentOperationItem({ actor, token, itemId }, config = this.readConfiguration(actor)) {
    if (this.actor !== actor || this.token !== token || !game.settings.get(MODULE, "locked")
      || !config.panels.equipements || config.hiddenEquipment.has(itemId)) return null;
    const item = actor.items?.get(itemId);
    if (!item || !["equipment", "container"].includes(item.type) || actor.containedItemUuids?.has(item.uuid)
      || !(game.user.isGM || actor.testUserPermission(game.user, "OWNER"))
      || !item.canUserModify?.(game.user, "update")) return null;
    return item;
  }

  equipmentOperations(actor, item) {
    const operations = [];
    const { properties, quantity, equipped, actions } = item.system;
    if (properties?.stackable === true && Number.isSafeInteger(quantity?.current) && quantity.current >= 0
      && typeof item.update === "function") {
      if (quantity.current > 0) operations.push({ key: "Decrease", quantity: quantity.current - 1 });
      // CO2 n'affiche un plafond que lorsqu'il est strictement positif.
      if (quantity.current < Number.MAX_SAFE_INTEGER && (!(quantity.max > 0) || quantity.current < quantity.max)) {
        operations.push({ key: "Increase", quantity: quantity.current + 1 });
      }
    }
    if (Array.isArray(actions)) for (const action of actions) {
      if (typeof action?.type !== "string" || !action.type.trim()
        || (!action.hasConditions && action.properties?.visible === false)) continue;
      const reference = { itemId: item.id, source: item.uuid, indice: action.indice };
      if (this.resolveShortcut(actor, reference)?.action !== action) continue;
      const toggle = this.shortcutCanToggle(action);
      if (toggle ? typeof actor.activateAction !== "function" : typeof game.system.api?.macros?.useAction !== "function") continue;
      operations.push({ key: "Action", name: action.actionName || item.name, action, reference });
    }
    if (item.type === "equipment" && properties?.equipable === true && typeof equipped === "boolean"
      && typeof actor.toggleEquipmentEquipped === "function") {
      operations.push({ key: equipped ? "Unequip" : "Equip" });
    }
    return operations;
  }

  closeEquipmentMenu() {
    if (this.equipmentMenu?.matches(":popover-open")) this.equipmentMenu.hidePopover();
  }

  openEquipmentMenu(event, item) {
    this.closeEquipmentMenu();
    const context = { actor: this.actor, token: this.token, itemId: item.id, equipment: true };
    if (this.busyEquipment || this.busyAction || this.equipmentOperationItem(context) !== item) return;
    const operations = this.equipmentOperations(context.actor, item);
    if (!operations.length) return;
    event.preventDefault();
    event.stopPropagation();
    game.tooltip?.deactivate();
    const menu = this.equipmentMenu;
    menu.replaceChildren(...operations.map(operation => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = game.i18n.format(`CO2PRISM.Equipment.Operations.${operation.key}`, { action: operation.name });
      button.addEventListener("click", event => {
        if (!menu.matches(":popover-open") || event.detail > 1) return;
        this.closeEquipmentMenu();
        void this.runEquipmentOperation(event, context, operation);
      });
      return button;
    }));
    this.showActionPopover(menu, event, event.target.closest(".co2prism-equipment-tile"));
  }

  showActionPopover(menu, event, anchor) {
    const tile = anchor.getBoundingClientRect();
    const x = event.clientX || tile.left;
    const y = event.clientY || tile.bottom;
    menu.showPopover();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
    menu.firstElementChild.focus({ preventScroll: true });
  }

  async runEquipmentOperation(event, context, chosen) {
    if (this.busyEquipment || this.busyAction) return;
    const item = this.equipmentOperationItem(context);
    const operation = item && this.equipmentOperations(context.actor, item)
      .find(entry => entry.key === chosen.key && entry.action === chosen.action);
    if (!operation) return;
    if (operation.action) {
      await this.executeShortcut(event, { ...context, ...operation });
      return;
    }
    this.busyEquipment = true;
    try {
      if (operation.quantity !== undefined) await item.update({ "system.quantity.current": operation.quantity });
      else await context.actor.toggleEquipmentEquipped(item.id, event.shiftKey);
    } catch (error) {
      console.error("co2prism | Equipment operation", item.uuid, error);
      ui.notifications.error(game.i18n.localize("CO2PRISM.ActionError"));
    } finally {
      this.busyEquipment = false;
      this.refreshActor();
    }
  }

  async openItemSheet(item) {
    try {
      if (!item.testUserPermission(game.user, "LIMITED")) return;
      const sheet = item.sheet;
      if (sheet?.isVisible !== false) await sheet?.render?.(true);
    } catch (error) {
      console.warn("co2prism | Item sheet", item.uuid, error);
    }
  }

  bindDescriptiveTooltips() {
    this.tooltipListeners = new AbortController();
    const { signal } = this.tooltipListeners;
    const hover = event => {
      this.tooltipHover = event.target instanceof Element ? event.target : null;
      this.syncDescriptiveTooltip(event.shiftKey);
    };
    this.element.addEventListener("pointerover", hover, { signal });
    this.element.addEventListener("pointermove", hover, { signal });
    this.element.addEventListener("pointerout", event => {
      if (this.element.contains(event.relatedTarget)) return;
      this.tooltipHover = null;
      this.clearDescriptiveTooltip();
    }, { signal });
    for (const type of ["keydown", "keyup"]) window.addEventListener(type, event => {
      if (event.key === "Shift") this.syncDescriptiveTooltip(event.shiftKey);
    }, { capture: true, signal });
    window.addEventListener("blur", () => this.syncDescriptiveTooltip(false), { signal });
    this.tooltipObserver = new MutationObserver(() => this.syncDescriptiveTooltip());
    this.tooltipObserver.observe(this.element, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["hidden", "data-co2prism-description", "data-co2prism-description-html",
        "data-co2prism-tooltip-text", "data-co2prism-action-summary", "data-co2prism-action-summary-html", "data-co2prism-immediate-html"]
    });
  }

  clearDescriptiveTooltip() {
    const manager = globalThis.game?.tooltip;
    if (this.descriptiveTooltip && manager?.element === this.descriptiveTooltip.node) manager.deactivate();
    this.descriptiveTooltip = null;
    for (const tooltip of globalThis.document?.querySelectorAll?.(".locked-tooltip.co2prism-description") ?? []) {
      manager?.dismissLockedTooltip?.(tooltip);
    }
  }

  syncDescriptiveTooltip(shift = this.tooltipShift) {
    this.tooltipShift = shift;
    const node = this.tooltipHover?.closest("[data-co2prism-action-summary], [data-co2prism-description], "
      + "[data-co2prism-description-html], [data-co2prism-tooltip-text], [data-co2prism-immediate-html]");
    const manager = game.tooltip;
    const summary = node?.dataset.co2prismActionSummary;
    const text = shift ? (summary === undefined ? node?.dataset.co2prismDescription ?? node?.dataset.co2prismTooltipText : "") : summary;
    const html = node?.dataset.co2prismImmediateHtml
      ?? (shift ? node?.dataset.co2prismDescriptionHtml : node?.dataset.co2prismActionSummaryHtml);
    if ((!text && !html) || !node?.isConnected || !this.element.contains(node) || !node.getClientRects().length) {
      if (this.descriptiveTooltip) this.clearDescriptiveTooltip();
      return;
    }
    if (!manager) return;
    const previous = this.descriptiveTooltip;
    if (previous?.node === node && previous.text === text && previous.html === html && manager.element === node) return;
    if (previous?.node !== node) this.clearDescriptiveTooltip();
    manager.activate(node, { ...(html ? { html } : { text }), cssClass: "co2prism-tooltip co2prism-description" });
    this.descriptiveTooltip = { node, text, html };
  }

  itemTooltipDescription(item) {
    return item.testUserPermission(game.user, "OBSERVER") ? item.system.description : "";
  }

  async prepareItemTooltip(tile, item, description, label = item.name) {
    const name = `<strong>${foundry.utils.escapeHTML(label)}</strong>`;
    tile.dataset.co2prismDescriptionHtml = name;
    if (!description) return;
    try {
      const editor = foundry.applications.ux.TextEditor.implementation;
      const html = await editor.enrichHTML(description, { relativeTo: item, secrets: item.isOwner });
      tile.dataset.co2prismDescriptionHtml = `${name}${foundry.utils.cleanHTML(html)}`;
    } catch (error) {
      console.warn("co2prism | Item tooltip", item.uuid, error);
    }
  }

  updateEquipment() {
    if (!this.equipmentPanel) return;
    this.closeEquipmentMenu();
    const open = Boolean(this.actor && this.configuration.panels.equipements);
    const canConfigure = this.canConfigure();
    this.equipmentPanel.hidden = !open;
    this.equipmentToggle.disabled = !canConfigure;
    this.equipmentToggle.setAttribute("aria-expanded", String(open));
    const label = game.i18n.localize(open ? "CO2PRISM.Equipment.Close" : "CO2PRISM.Equipment.Open");
    this.equipmentToggle.setAttribute("aria-label", label);
    this.equipmentToggle.dataset.co2prismTooltipText = canConfigure
      ? `${label}\n${game.i18n.localize("CO2PRISM.Equipment.ToggleAllHint")}` : label;
    if (!open) return;

    const inventory = new Map((this.actor.inventory ?? []).map(({ category, items }) => [category, items]));
    const seen = new Set(this.actor.containedItemUuids);
    const locked = game.settings.get(MODULE, "locked");
    const { hiddenEquipment } = this.configuration;
    for (const entry of this.equipmentGroups) {
      const { key, subtypes, group, button, items } = entry;
      const expanded = !this.configuration.equipmentCollapsed[key];
      group.dataset.collapsed = String(!expanded);
      const label = game.i18n.localize(`CO2PRISM.Equipment.Groups.${key}`);
      button.disabled = !canConfigure;
      button.setAttribute("aria-expanded", String(expanded));
      button.setAttribute("aria-label", label);
      button.dataset.co2prismTooltipText = game.i18n.format(expanded ? "CO2PRISM.Equipment.Collapse" : "CO2PRISM.Equipment.Expand", { category: label });
      items.setAttribute("aria-label", label);
      items.hidden = !expanded;
      const source = key === "containers" ? this.actor.containers ?? []
        : subtypes.flatMap(subtype => inventory.get(subtype) ?? []);
      // Le tri stable conserve l'ordre natif à sort égal au sein d'un sous-type.
      const displayed = [...source].sort((a, b) => a.sort - b.sort).filter(item => {
        if (seen.has(item.uuid)) return false;
        seen.add(item.uuid);
        return expanded && (!locked || !hiddenEquipment.has(item.id));
      });
      const descriptions = displayed.map(item => this.itemTooltipDescription(item));
      const signature = JSON.stringify(displayed.map((item, index) =>
        [item.uuid, item.name, item.img, hiddenEquipment.has(item.id), descriptions[index], item.isOwner]));
      if (signature === entry.signature) continue;
      entry.signature = signature;
      items.replaceChildren(...displayed.map((item, index) => {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "co2prism-equipment-tile";
        tile.dataset.itemId = item.id;
        if (hiddenEquipment.has(item.id)) {
          tile.classList.add("co2prism-equipment-masked");
          tile.setAttribute("aria-label", game.i18n.format("CO2PRISM.Equipment.HiddenItem", { item: item.name }));
        }
        const image = document.createElement("img");
        image.src = item.img || "icons/svg/item-bag.svg";
        image.alt = item.name;
        image.draggable = false;
        tile.append(image);
        void this.prepareItemTooltip(tile, item, descriptions[index]);
        return tile;
      }));
    }
  }

  movementTrackingAllowed(token = this.token?.document) {
    const mode = game.settings?.get(MODULE, "movementMode");
    if (mode !== "combat") return mode !== "off";
    const combat = game.combats?.active;
    return Boolean(token && combat?.started && (!combat.scene || combat.scene === token.parent)
      && combat.getCombatantsByToken(token.id).some(combatant => combatant.token === token));
  }

  movementToken() {
    const token = this.token?.document;
    return this.actor && token && token.parent === globalThis.canvas?.scene && token?.parent?.tokens?.get(token.id) === token
      && token.canUserModify?.(game.user, "update") && this.movementTrackingAllowed(token) ? token : null;
  }

  movementView(token) {
    const state = this.movementTracker.getSnapshot(token).state;
    if (!state) return null;
    const budgetActive = economyEnabled();
    const available = budgetActive ? new ActionEconomy(token.actor).getSnapshot().movementsRemaining : 2;
    const valid = state.measurementValid && Number.isFinite(state.cellsPerActionRaw) && state.cellsPerActionRaw > 0
      && Number.isSafeInteger(state.cellsPerAction) && state.cellsPerAction >= 0
      && Number.isSafeInteger(state.cellsUsed);
    const capacity = valid ? state.cellsPerAction : null;
    return { state, budgetActive, available, valid, capacity,
      remaining: valid ? Math.max(0, capacity - state.cellsUsed) : null,
      excess: valid ? Math.max(0, state.cellsUsed - capacity) : 0 };
  }

  async toggleMovement() {
    this.refreshActor();
    const token = this.movementToken();
    if (!token || this.movementDestroyed || this.movementClosures.has(token) || !this.configuration.panels.combat || this.movementResets.has(token) || this.movementValidations.has(token)) return false;
    const active = this.movementTracker.getSnapshot(token).success;
    if (active || this.movementOpenToken === token) {
      const state = this.movementTracker.getSnapshot(token).state;
      if (state?.segmentCount > 0) {
        const context = { actor: token.actor, scene: token.parent, sessionId: state.sessionId,
          version: this.movementContextVersion, nextSessionId: null };
        const sameContext = () => !this.movementDestroyed && this.element?.isConnected !== false
          && this.movementToken() === token && token.actor === context.actor && token.parent === context.scene
          && globalThis.canvas?.scene === context.scene && this.movementOpenToken === token
          && this.configuration.panels.combat && this.movementContextVersion === context.version;
        this.movementClosures.set(token, context);
        this.refreshActor();
        try {
          const localize = key => game.i18n.localize(`CO2PRISM.Movement.${key}`);
          const choice = await foundry.applications.api.DialogV2.wait({
            window: { title: localize("CloseTitle") },
            content: `<p>${localize("CloseQuestion")}</p>`,
            buttons: [
              { action: "validate", label: localize("CloseValidate"), icon: "fa-solid fa-check" },
              { action: "reset", label: localize("CloseReset"), icon: "fa-solid fa-arrow-rotate-left" }
            ],
            rejectClose: false
          });
          const current = this.movementTracker.getSnapshot(token).state;
          if (!["validate", "reset"].includes(choice) || !sameContext()
            || current?.sessionId !== context.sessionId || !current.segmentCount) return false;
          const success = choice === "validate" ? await this.validateMovement(token, context) : await this.resetMovement(context);
          if (!success || !sameContext()) return false;
          const remaining = this.movementTracker.getSnapshot(token).state;
          // Ne fermer que la session remise à zéro ou créée par cette validation.
          const expected = choice === "reset" ? context.sessionId : context.nextSessionId;
          if (remaining && (remaining.sessionId !== expected || remaining.segmentCount !== 0)) return false;
          if (remaining && !this.movementTracker.cancel(token).success) return false;
          this.movementZones.clear();
          this.movementOpenToken = null; this.movementOpenActor = null;
          this.movementErrors.delete(token);
          return true;
        } catch {
          if (sameContext()) this.movementErrors.set(token, "validation-failed");
          return false;
        } finally {
          if (this.movementClosures.get(token) === context) this.movementClosures.delete(token);
          if (!this.movementDestroyed && this.element?.isConnected !== false) this.refreshActor();
        }
      }
      this.movementTracker.cancel(token);
      this.movementZones.clear();
      this.movementOpenToken = null; this.movementOpenActor = null;
      this.movementErrors.delete(token);
      this.refreshActor(); return true;
    }
    const success = this.startMovement(token, !economyEnabled() || new ActionEconomy(token.actor).getSnapshot().movementsRemaining > 0);
    this.refreshActor();
    return success;
  }

  startMovement(token, available) {
    if (!this.movementTrackingAllowed(token)) return false;
    this.movementOpenToken = token;
    this.movementOpenActor = token.actor;
    if (!available) return true;
    this.movementResults.delete(token);
    const result = this.movementTracker.start(token);
    if (result.success) this.movementErrors.delete(token);
    else this.movementErrors.set(token, result.reason);
    return result.success;
  }

  async validateMovement(token, closure = null) {
    if (!token || (this.movementClosures.has(token) && this.movementClosures.get(token) !== closure) || this.movementToken() !== token || this.movementResets.has(token) || this.movementValidations.has(token)) return false;
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
        if (!view || !view.state.segmentCount || view.available <= 0) return false;
        const state = view.state;
        if (["pending", "paused", "planned"].includes(token.movement?.state)) {
          this.movementErrors.set(token, "movement-in-progress"); return false;
        }
        if (view.budgetActive && !view.valid) {
          this.movementErrors.set(token, "invalid-measurement"); return false;
        }
        const required = view.budgetActive ? 1 : 0;
        const version = this.movementContextVersion, resetVersion = engine.getResetVersion();
        const valid = () => {
          const current = this.movementTracker.getSnapshot(token).state;
          return current && this.movementTrackingAllowed(token)
            && (required === 0 || engine.getSnapshot().movementsRemaining > 0) && token.parent?.tokens?.get(token.id) === token && token.actor === actor
            && (!closure || (!this.movementDestroyed && this.element?.isConnected !== false
              && this.movementToken() === token && this.movementOpenToken === token && globalThis.canvas?.scene === closure.scene))
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
        if (!result.success || result.missingCount > 0 || result.consumedCount !== required) {
          this.movementErrors.set(token, result.reason === "context-changed" ? "context-changed" : "validation-failed");
          this.movementResults.set(token, { ...result, success: false, consumedCount: 0 });
          return false;
        }
        result = { ...result, requiredCount: required,
          sessionId: state.sessionId,
          excess: required > 0 ? view.excess : 0,
          notified: false };
        // Conserver le règlement confirmé si la fermeture devient impossible après l'écriture.
        this.movementResults.set(token, result);
      }
      if (this.movementTracker.getSnapshot(token).state?.sessionId !== result.sessionId) {
        this.movementErrors.set(token, "context-changed"); return false;
      }
      const finished = this.movementTracker.finish(token);
      if (!finished.success) { this.movementErrors.set(token, "closure-pending"); return false; }
      if (result.excess > 0 && !result.notified) {
        result.notified = true;
        if (!this.movementNotifications.broadcast(token, result.excess)) {
          ui.notifications.warn(game.i18n.localize("CO2PRISM.Movement.NotificationFailed"));
        }

      }
      if (!this.movementDestroyed && this.element?.isConnected !== false && this.movementToken() === token && this.configuration.panels.combat
        && (!closure || (token.actor === closure.actor && token.parent === closure.scene && this.movementContextVersion === closure.version))) {
        this.movementOpenToken = token;
        this.movementOpenActor = token.actor;
        if (!economyEnabled() || engine.getSnapshot().movementsRemaining > 0) {
          const restarted = this.movementTracker.start(token);
          if (closure && restarted.success) closure.nextSessionId = restarted.state.sessionId;
          if (!restarted.success) this.movementErrors.set(token, restarted.reason);
        }
      }
      return true;
    } catch {
      this.movementErrors.set(token, "validation-failed"); return false;
    } finally {
      this.movementValidations.delete(token);
      if (!this.movementTrackingAllowed(token)) {
        this.movementTracker.deleteToken(token);
        this.movementResults.delete(token);
        this.movementErrors.delete(token);
      }
      this.refreshActor();
    }
  }

  async resetMovement(closure = null) {
    this.refreshActor();
    const token = this.movementToken();
    if (!token || (this.movementClosures.has(token) && this.movementClosures.get(token) !== closure) || this.movementResets.has(token) || this.movementValidations.has(token) || (this.movementResults.get(token)?.success && this.movementResults.get(token).sessionId === this.movementTracker.getSnapshot(token).state?.sessionId) || !(this.movementTracker.getSnapshot(token).state?.segmentCount > 0)) return false;
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
    const token = this.movementToken();
    if (this.movementOpenToken && (this.movementOpenToken !== token || this.movementOpenActor !== token?.actor || !this.configuration.panels.combat)) {
      const previous = this.movementOpenToken;
      if (!this.movementTrackingAllowed(previous)) {
        this.movementTracker.deleteToken(previous);
        this.movementResults.delete(previous);
        this.movementClosures.delete(previous);
      } else if (!this.movementValidations.has(previous) && !(this.movementResults.get(previous)?.success && this.movementResults.get(previous).sessionId === this.movementTracker.getSnapshot(previous).state?.sessionId)) this.movementTracker.cancel(previous);
      this.movementOpenToken = null;
      this.movementErrors.delete(previous);
      this.movementZones.clear();
    }
    const combatOpen = Boolean(this.actor && this.configuration.panels.combat);
    const open = combatOpen && this.movementTrackingAllowed();
    const showBudget = combatOpen && Boolean(this.budgetBand) && economyEnabled();
    const available = token ? (economyEnabled() ? new ActionEconomy(token.actor).getSnapshot().movementsRemaining : 2) : 0;
    if (open && !this.element?.hidden && token && !this.movementDestroyed && !this.movementValidations.has(token) && !this.movementClosures.has(token)
      && (!this.movementOpenToken || (available > 0 && !this.movementErrors.has(token) && !this.movementTracker.getSnapshot(token).state))) {
      this.startMovement(token, available > 0);
    }
    const view = token ? this.movementView(token) : null;
    this.movementZones.sync(token, view?.state, open && !this.element?.hidden && available > 0);
    const validating = Boolean(token && this.movementValidations.has(token));
    const settled = Boolean(token && this.movementResults.get(token)?.success && this.movementResults.get(token).sessionId === view?.state.sessionId);
    const busy = Boolean(token && (this.movementResets.has(token) || validating || this.movementClosures.has(token)));
    const error = token ? this.movementErrors.get(token) : null;
    const signature = JSON.stringify([open, combatOpen, showBudget, available, token?.uuid ?? token?.id, view, busy, settled, validating, error,
      this.movementZones.visible, this.movementZones.busy, this.movementZones.diagnostic, this.movementZones.stats]);
    if (signature === this.movementSignature) return false;
    this.movementSignature = signature;
    const localize = key => game.i18n.localize(`CO2PRISM.Movement.${key}`);
    const format = (key, data) => game.i18n.format(`CO2PRISM.Movement.${key}`, data);
    this.upperLine.hidden = !(open || showBudget);
    this.movementPanel.hidden = !open;
    if (!open) return true;
    const query = selector => this.movementPanel.querySelector(".co2prism-movement-" + selector);
    query("empty").hidden = !token || available > 0;
    query("empty").textContent = localize("NoActionAvailable");
    this.movementReset.disabled = busy || settled || !view?.state.segmentCount || available <= 0;
    if (this.movementValidate) this.movementValidate.disabled = busy || !view?.state.segmentCount || (available <= 0 && !settled);
    if (available <= 0 || !view) {
      this.movementZonesButton.disabled = true;
      this.movementZonesButton.setAttribute("aria-pressed", "false");
      this.movementZonesButton.dataset.co2prismTooltipText = localize(token && available <= 0 ? "NoActionAvailable" : "Unavailable");
      const summary = query("summary");
      summary.textContent = this.actorWithoutToken || (token && available <= 0) ? "0" : game.i18n.localize("CO2PRISM.Unavailable");
      summary.dataset.co2prismTooltipText = this.movementZonesButton.dataset.co2prismTooltipText;
      summary.setAttribute("aria-label", this.actorWithoutToken ? format("CellsAvailable", { cells: 0 }) : summary.dataset.co2prismTooltipText);
      delete summary.dataset.negative;
      const blocks = query("blocks");
      blocks.replaceChildren();
      blocks.tabIndex = -1;
      blocks.removeAttribute("aria-label");
      query("message").textContent = "";
      query("error").hidden = true;
      return true;
    }
    const { state, valid, remaining, excess } = view;
    if (this.movementZonesButton) {
      const unsupported = this.movementZones.supported(token, state.start);
      this.movementZonesButton.disabled = busy || settled || (!this.movementZones.visible && Boolean(unsupported));
      this.movementZonesButton.setAttribute("aria-pressed", String(this.movementZones.visible));
      const diagnostic = this.movementZones.diagnostic === "Done" ? null : this.movementZones.diagnostic;
      this.movementZonesButton.dataset.co2prismTooltipText = localize(diagnostic || unsupported ? `Zones${diagnostic ?? unsupported}` : this.movementZones.visible ? "ZonesHide" : "ZonesShow");
      this.movementZonesButton.setAttribute("aria-label", this.movementZonesButton.dataset.co2prismTooltipText);
    }
    const summary = query("summary");
    summary.textContent = valid ? String(remaining - excess) : game.i18n.localize("CO2PRISM.Unavailable");
    summary.dataset.negative = String(valid && excess > 0);
    summary.setAttribute("aria-label", valid
      ? format(remaining === 1 && !excess ? "CellsAvailableOne" : "CellsAvailable", { cells: remaining - excess })
      : localize("SpeedUnavailable"));
    const message = query("message");
    message.textContent = !valid ? localize("Unavailable") : !state.segmentCount ? localize("NoMovement")
      : excess > 0 ? format(excess === 1 ? "ExcessOne" : "Excess", { excess }) : localize("Normal");
    message.classList.toggle("co2prism-movement-excess", excess > 0);
    query("error").hidden = !error;
    const errorKey = { "movement-in-progress": "Busy", "invalid-measurement": "InvalidValidation", "context-changed": "ContextChanged", "validation-failed": "ValidationFailed", "closure-pending": "ClosurePending" }[error] ?? "ReturnFailed";
    query("error").textContent = error ? format(errorKey, { consumed: this.movementResults.get(token)?.consumedCount ?? 0 }) : "";
    summary.dataset.co2prismTooltipText = error ? query("error").textContent : message.textContent;
    const blocks = query("blocks");
    const nodes = [];
    blocks.tabIndex = valid && state.cellsPerAction > 0 ? 0 : -1;
    blocks.setAttribute("aria-label", valid
      ? format("CellsProgress", { used: state.cellsUsed, capacity: state.cellsPerAction })
      : localize("SpeedUnavailable"));
    // Les valeurs extrêmes restent représentées par des groupes étiquetés, sans millions de nœuds.
    if (valid) {
      const size = state.cellsPerAction;
      const stride = Math.max(1, Math.ceil(size / 60));
      const block = document.createElement("div"); block.className = "co2prism-movement-block";
      block.setAttribute("aria-hidden", String(size > 0));
      block.dataset.cells = String(size);
      for (let index = 0; index < size; index += stride) {
        const count = Math.min(stride, size - index);
        const used = Math.max(0, Math.min(count, state.cellsUsed - index));
        const cell = document.createElement("span"); cell.className = "co2prism-movement-cell";
        cell.style.setProperty("--co2prism-used", `${100 * used / count}%`);
        cell.dataset.used = String(used); cell.dataset.count = String(count);
        if (count > 1) cell.textContent = String(count);
        block.append(cell);
      }
      nodes.push(block);
    }
    blocks.replaceChildren(...nodes);
    return true;
  }

  async toggleMovementZones() {
    this.refreshActor();
    const token = this.movementToken(), view = token && this.movementView(token);
    if (!view || this.movementClosures.has(token) || view.available <= 0 || !this.configuration.panels.combat || this.movementValidations.has(token) || this.movementResets.has(token)) return false;
    const state = { ...view.state, start: { ...view.state.start } };
    const range = { cellsPerActionRaw: state.cellsPerActionRaw, rounding: state.rounding };
    const result = await this.movementZones.toggle(token, state, range, () => this.refreshActor());
    return result.success;
  }

  destroy() {
    if (this.onTargetToken) Hooks.off("targetToken", this.onTargetToken);
    this.targetScene = null;
    this.renderTargets();
    this.targetStrip = null;
    this.disconnectInventoryScroll();
    this.tooltipListeners?.abort();
    this.tooltipObserver?.disconnect();
    this.clearDescriptiveTooltip();
    this.conditionRender = null;
    this.conditionalActionGroups = [];
    this.renderConditionalRows([]);
    this.clearShortcutPreview();
    this.closePresetActionMenu();
    this.closeEquipmentMenu();
    this.presentationObserver?.disconnect();
    if (this.onWindowResize) window.removeEventListener("resize", this.onWindowResize);
    this.movementDestroyed = true;
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
    this.skillsToggle.dataset.co2prismTooltipText = game.i18n.localize(open ? "CO2PRISM.CloseSkills" : "CO2PRISM.OpenSkills");
    this.skillsToggle.setAttribute("aria-label", this.skillsToggle.dataset.co2prismTooltipText);
    if (!open) return changed;
    const unavailable = game.i18n.localize("CO2PRISM.Unavailable");
    for (const { key, button, value, count } of this.skillNodes) {
      const ability = this.actor.system?.abilities?.[key];
      button.classList.toggle("co2prism-skill-superior", ability?.superior === true);
      const modifier = ability?.value;
      value.textContent = Number.isFinite(modifier) ? `${modifier >= 0 ? "+" : ""}${modifier}` : unavailable;
      value.style.setProperty("--co2prism-skill-size", Math.min(40, 82 / (value.textContent.length * 0.55)));
      // Le système inclut déjà les bonus généraux et conditionnels.
      let bonuses = null;
      try {
        if (typeof this.actor.getSkillBonuses === "function") bonuses = this.actor.getSkillBonuses(key);
      } catch (error) {
        console.warn("co2prism | Skill bonuses", key, error);
      }
      const list = Array.isArray(bonuses) ? bonuses : null;
      count.textContent = `(${list ? list.length : unavailable})`;
      count.style.setProperty("--co2prism-skill-count-size", Math.min(18, 60 / (count.textContent.length * 0.6)));
      const label = game.i18n.localize(`CO.abilities.long.${key}`);
      const lines = list?.map(bonus => {
        const number = Number.isFinite(bonus?.value) ? `${bonus.value >= 0 ? "+" : ""}${bonus.value}` : unavailable;
        const path = this.plainText(bonus?.pathName) || (bonus?.sourceType === "capacity" ? game.i18n.localize("CO2PRISM.Paths.OffPaths") : "");
        return [number, this.plainText(bonus?.additionalInfos), this.plainText(bonus?.name), path].filter(Boolean).join(" — ");
      });
      const base = game.i18n.format("CO2PRISM.SkillBase", { value: value.textContent });
      button.dataset.co2prismDescription = `${label}\n${base}`
        + (lines?.length ? `\n${lines.map(line => `• ${line}`).join("\n")}` : "");
      button.setAttribute("aria-label", `${label}, ${base}`);
      button.disabled = !this.canUseAction(`skill:${key}`);
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
      const effectStatuses = Array.from(effect.statuses ?? []);
      let description, duration, durationTitle;
      try { description = effect.description; } catch { /* Description indisponible. */ }
      try {
        const nativeDuration = effect.duration;
        duration = nativeDuration?.label;
        if (effectStatuses.length) {
          // Un statut permanent reçoit aussi le libellé natif « Aucun ».
          if ((nativeDuration?.value !== undefined && (!Number.isFinite(nativeDuration.value) || nativeDuration.value <= 0))
            || (nativeDuration?.remaining !== undefined && !Number.isFinite(nativeDuration.remaining))
            || duration === game.i18n.localize("COMMON.None")) duration = undefined;
          durationTitle = game.i18n.localize("EFFECT.DURATION.Label");
          if (durationTitle === "EFFECT.DURATION.Label") durationTitle = game.i18n.localize("CO.ui.duration");
          if (durationTitle === "CO.ui.duration") durationTitle = "";
        }
      } catch { /* Durée native indisponible. */ }
      entries.push({ key: effect.id && `effect:${effect.id}`, name: effect.name, img: effect.img, description, duration, durationTitle });
      for (const id of effectStatuses) statuses.add(id);
    }
    for (const effect of actor.system?.currentEffects ?? []) {
      // Le modèle CO2 expose l'Item source des effets personnalisés.
      let img, description;
      try { img = effect.sourceParts?.item?.img; } catch { /* Source supprimée ou inaccessible. */ }
      try { description = effect.tooltip; } catch { /* Conserver le nom si CO2 ne résout plus la source. */ }
      entries.push({ name: effect.name, img, description, html: true });
    }
    for (const id of actor.statuses ?? []) {
      if (statuses.has(id)) continue;
      const status = globalThis.CONFIG?.statusEffects?.find(entry => entry.id === id);
      let description;
      try { description = status?.description; } catch { /* Configuration tierce inaccessible. */ }
      entries.push({ key: `status:${id}`, name: status ? game.i18n.localize(status.name) : id, img: status?.img, description });
    }
    return entries.map(effect => {
      const name = typeof effect.name === "string" ? effect.name : game.i18n.localize("CO2PRISM.Unavailable");
      const escaped = foundry.utils.escapeHTML(name);
      let description = typeof effect.description === "string" ? effect.description.trim() : "";
      if (description && game.i18n.has?.(description)) description = game.i18n.localize(description);
      const html = effect.html || /<\/?[a-z][^>]*>/i.test(description);
      let details = html ? description : foundry.utils.escapeHTML(description).replace(/\r?\n/g, "<br>");
      try { details = foundry.utils.cleanHTML(details); } catch { details = ""; }
      const firstLine = details.replace(/<br\s*\/?>|<\/(?:p|div|h[1-6])>/gi, "\n")
        .replace(/<[^>]*>/g, "").trim().split("\n")[0].trim();
      const includesName = details && [name, escaped].includes(firstLine);
      let tooltip = includesName ? details : `<strong>${escaped}</strong>${details ? `<br>${details}` : ""}`;
      if (typeof effect.duration === "string" && effect.duration.trim()) {
        const title = effect.durationTitle ?? game.i18n.localize("DURATION.Label");
        tooltip += `<br>${title ? `${foundry.utils.escapeHTML(title)} : ` : ""}${foundry.utils.escapeHTML(effect.duration)}`;
      }
      const img = typeof effect.img === "string" ? effect.img : undefined;
      return { key: effect.key ?? JSON.stringify([name, img]), name, img, tooltip };
    });
  }

  updateCombat() {
    if (!this.combatPanel) return false;
    const open = Boolean(this.actor && this.configuration.panels.combat);
    const changed = this.combatPanel.hidden === open;
    this.combatPanel.hidden = !open;
    if (this.budgetBand) this.budgetBand.hidden = !open;
    if (this.combatSlots) this.combatSlots.hidden = !open;
    if (this.combatToggle) {
      this.combatToggle.disabled = !this.canConfigure();
      this.combatToggle.setAttribute("aria-expanded", String(open));
    }
    this.updateEffects();
    const unavailable = game.i18n.localize("CO2PRISM.Unavailable");
    const economy = new ActionEconomy(this.actor).getSnapshot();
    this.updateDefenseButtons(economy);
    const movements = economyEnabled() ? economy.movementsRemaining : 1;
    for (const [key, value] of Object.entries(this.readCombatData())) {
      const node = this.combatValues[key];
      const isMovement = key === "meters" || key === "cells";
      const format = number => {
        if (!Number.isFinite(number) || (key === "cells" && number < 0)) return unavailable;
        if (key !== "cells") return String(Math.round(number * 100) / 100);
        return String(roundMovementCells(number, game.settings?.get(MODULE, "movementRounding")));
      };
      node.textContent = format(key === "cells" && this.actorWithoutToken ? 0 : isMovement && value !== null ? value * movements : value);
      node.style.setProperty("--co2prism-combat-size", Math.min(isMovement ? 36 : key === "def" ? 52 : 25,
        (isMovement ? 54 : key === "def" ? 88 : 44) / (node.textContent.length * 0.62)));
    }
    if (!open) {
      this.clearShortcutPreview();
      this.closePresetActionMenu();
      this.conditionRender = null;
      this.conditionalActionGroups = [];
      this.renderConditionalRows([]);
      return changed;
    }
    this.combatPanel.dataset.co2prismPreset = String(this.configuration.activePreset);
    this.renderEconomy(economy);
    const resized = this.changingHands.has(this.actor) ? false : this.renderCombatSlots();
    return changed || resized;
  }

  updateEffects() {
    const band = this.combatEffects;
    if (!band) return;
    const sameActor = this.effectsActor === this.actor;
    const scroll = sameActor ? band.scrollLeft : 0;
    this.effectsActor = this.actor;
    const existing = [...band.children];
    const focused = existing.find(node => node === document.activeElement);
    const reusable = new Map();
    if (sameActor) for (const node of existing) {
      const key = node.dataset.effectKey;
      if (!reusable.has(key)) reusable.set(key, []);
      reusable.get(key).push(node);
    }
    const effects = this.readCombatEffects();
    const retained = new Set();
    for (const [index, { key, name, img, tooltip }] of effects.entries()) {
      const node = reusable.get(key)?.shift() ?? document.createElement("span");
      retained.add(node);
      if (!node.parentElement) {
        node.className = "co2prism-effect";
        node.tabIndex = 0;
        node.dataset.effectKey = key;
      }
      if (node.getAttribute("aria-label") !== name) node.setAttribute("aria-label", name);
      if (img) {
        const image = node.firstElementChild ?? document.createElement("img");
        if (image.getAttribute("src") !== img) image.src = img;
        if (image.alt !== name) image.alt = name;
        if (!image.parentElement) {
          image.draggable = false;
          node.replaceChildren(image);
        }
      } else if (node.firstElementChild || node.textContent !== name) node.textContent = name;
      if (node.dataset.co2prismDescriptionHtml !== tooltip) node.dataset.co2prismDescriptionHtml = tooltip;
      if (node !== band.children[index]) band.insertBefore(node, band.children[index] ?? null);
    }
    for (const node of existing) if (!retained.has(node)) {
      if (game.tooltip?.element === node) game.tooltip.deactivate();
      node.remove();
    }
    if (focused && document.activeElement !== focused) {
      const target = retained.has(focused) ? focused : band.children[Math.min(existing.indexOf(focused), effects.length - 1)];
      (target ?? this.lock)?.focus({ preventScroll: true });
    }
    if (band.scrollLeft !== scroll) band.scrollLeft = scroll;
  }

  canControlDefense(actor, id, stances = defenseStances()) {
    return Boolean(actor === this.actor && this.canConfigure(actor) && this.configuration.panels.combat
      && typeof actor.hasEffect === "function" && typeof actor.toggleStatusEffect === "function"
      && stances.some(stance => stance.id === id));
  }

  canUseDefense(actor, id, state, stances = defenseStances()) {
    return this.canControlDefense(actor, id, stances)
      && typeof actor.canActivateDefenseStance === "function" && (!economyEnabled() || state?.canSpend[DEFENSE_COSTS[id]])
      && !stances.some(stance => actor.hasEffect(stance.id));
  }

  updateDefenseButtons(state) {
    if (!this.defenseButtons) return;
    const stances = defenseStances();
    for (const button of this.defenseButtons) {
      const id = button.dataset.co2prismDefense;
      const active = this.actor?.hasEffect?.(id) === true;
      button.setAttribute("aria-pressed", String(active));
      const available = active ? this.canControlDefense(this.actor, id, stances) : this.canUseDefense(this.actor, id, state, stances);
      button.disabled = !available;
    }
  }

  async toggleDefense(id) {
    if (this.busyAction || !Object.hasOwn(DEFENSE_COSTS, id)) return false;
    this.refreshActor();
    const { actor, token } = this;
    if (!this.canControlDefense(actor, id)) return false;
    const active = actor.hasEffect(id);
    const economy = !active && economyEnabled() ? new ActionEconomy(actor) : null;
    const version = economy?.getResetVersion();
    const sameContext = () => this.token === token && this.canControlDefense(actor, id)
      && economyEnabled() === Boolean(economy);
    const validate = () => sameContext() && economy?.getResetVersion() === version
      && this.canUseDefense(actor, id, economy?.getSnapshot());
    if (!active && !validate()) return false;
    const remove = () => actor.toggleStatusEffect(id, { active: false });
    this.busyAction = "defense";
    this.updateActions();
    try {
      if (active) {
        await remove();
        return !actor.hasEffect(id);
      }
      const confirm = async () => {
        if (!actor.canActivateDefenseStance(id)) return false;
        let applied;
        try { applied = await actor.toggleStatusEffect(id, { active: true }); }
        catch (error) {
          if (actor.hasEffect(id)) await remove();
          throw error;
        }
        if (!actor.hasEffect(id)) return false;
        if (applied !== false && (economy || sameContext())
          && !defenseStances().some(stance => stance.id !== id && actor.hasEffect(stance.id))) return true;
        await remove();
        return false;
      };
      if (!economy) return validate() && await confirm();
      const result = await economy.spend(DEFENSE_COSTS[id], { validate, rollback: remove, confirm });
      if (result.reason === "persistence-failed") ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.EconomyError"));
      return result.success;
    } catch (error) {
      console.error("co2prism | Defense", error);
      return false;
    } finally {
      this.busyAction = null;
      this.refreshActor();
    }
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
      button.parentElement.classList.toggle("co2prism-time-available", type !== "am" && canEdit && state.canSpend[type]);
      button.dataset.co2prismTooltipText = `${type.toUpperCase()} — ${game.i18n.localize(type === "am" ? "CO2PRISM.Combat.MixedTimeControls" : "CO2PRISM.Combat.TimeControls")}`
        + (type !== "am" && !state.canSpend[type] ? `\n${game.i18n.localize("CO2PRISM.Combat.TimeUnavailable")}` : "");
      button.setAttribute("aria-label", button.dataset.co2prismTooltipText);
    }
    if (this.budgetReset) this.budgetReset.disabled = !canEdit;
  }

  renderEconomy(state) {
    if (!this.budgetBar) return;
    const hidden = !economyEnabled();
    this.budgetScroll.hidden = hidden;
    if (this.timeCommands) this.timeCommands.hidden = hidden;
    this.updateEconomyCommands(state);
    if (hidden) return;
    const signature = JSON.stringify([state.normalAlternatives, state.bonus]);
    if (signature === this.budgetSignature) return;
    this.budgetSignature = signature;
    const labels = { l: "L", a: "A", am: "AM", m: "M" };
    const colors = { l: "limited", a: "attack", am: "mixed", m: "move" };
    const nodes = [];
    const add = (type, bonus = false, count = 1) => {
      const node = document.createElement("span");
      node.className = `co2prism-time-indicator co2prism-time-${colors[type]}${bonus ? " co2prism-time-bonus" : ""}`;
      node.textContent = `${bonus ? "+" : ""}${labels[type]}${count > 1 ? ` ×${count}` : ""}`;
      node.dataset.co2prismTooltipText = `${game.i18n.localize(bonus ? "CO2PRISM.Combat.BonusTime" : "CO2PRISM.Combat.NormalTime")} : ${labels[type]}${count > 1 ? ` ×${count}` : ""}`;
      node.dataset.co2prismBudgetType = type;
      if (bonus) node.dataset.co2prismBonus = String(count);
      nodes.push(node);
    };
    state.normalAlternatives.forEach((branch, index) => {
      if (index) {
        const separator = document.createElement("span"); separator.className = "co2prism-time-separator";
        separator.setAttribute("aria-label", game.i18n.localize("CO2PRISM.Combat.TimeOr"));
        separator.setAttribute("role", "separator");
        nodes.push(separator);
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
      nodes.push(empty);
    }
    this.budgetBar.replaceChildren(...nodes);
  }

  slotRows(actor = this.actor) {
    const config = this.readConfiguration(actor);
    const slots = config.slots;
    const rows = [[], [], []];
    for (const [key, reference] of Object.entries(slots)) {
      if (["left-hand", "right-hand"].includes(key)) continue;
      const row = [2, 3].includes(reference?.row) ? reference.row : 1;
      rows[row - 1].push({ key, reference, row, order: Number.isSafeInteger(reference?.order) ? reference.order : 0 });
    }
    for (const row of rows) row.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
    const hands = ["left", "right"].map((hand, order) => ({ key: `${hand}-hand`, hand, row: 1,
      order, reference: slots[`${hand}-hand`] ?? undefined }));
    const primary = hands.find(slot => this.handItem(actor, slot.reference)?.system.usage?.twoHand);
    if (primary) {
      const other = hands[1 - primary.order];
      const replaceable = this.isVersatileHandAction(this.handItem(actor, primary.reference), primary.reference);
      if (!other.reference || (!replaceable && other.reference.itemId === primary.reference.itemId)) {
        other.mirror = primary.reference;
        other.mirrorLocked = !replaceable;
        other.reference = undefined;
      }
    }
    rows[0].unshift(...hands);
    rows.forEach((row, index) => row.push({ row: index + 1, order: 1 + Math.max(-1,
      ...row.filter(slot => !slot.hand).map(slot => slot.order)), terminal: true }));
    return rows;
  }

  shortcutReferences(entry) {
    if (entry === undefined) return [];
    if (Array.isArray(entry?.actions)) return entry.actions;
    return [entry];
  }

  shortcutEntry(entry, references) {
    const { actions, source, indice, itemId, ...slot } = entry;
    if (references.length === 1) {
      const { source, indice, itemId } = references[0];
      return { ...slot, source, indice, itemId, ...(actions ? { "-=actions": null } : {}) };
    }
    return { ...slot, actions: references.map(reference =>
      ({ source: reference?.source, indice: reference?.indice, itemId: reference?.itemId })),
      ...(source !== undefined || indice !== undefined || itemId !== undefined
        ? { "-=source": null, "-=indice": null, "-=itemId": null } : {}) };
  }

  sameShortcutReference(a, b) {
    return Boolean(a && b && a.indice === b.indice && (a.itemId || null) === (b.itemId || null)
      && (a.itemId || a.source === b.source));
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

  handKey(key) {
    return key === "left-hand" || key === "right-hand";
  }

  encounterHandAttack(actor, reference) {
    if (actor?.type !== "encounter" || reference?.kind === "equipment" || !reference?.itemId) return null;
    const resolved = this.resolveShortcut(actor, reference);
    return resolved?.item?.type === "attack" && resolved.item.parent === actor && resolved.item.uuid === reference.source ? resolved : null;
  }

  handItem(actor, reference) {
    if (!reference?.itemId) return null;
    const direct = reference.kind === "equipment";
    const item = direct ? actor.items?.get(reference.itemId) : this.resolveShortcut(actor, reference)?.item;
    if (!this.isHandEquipment(actor, item) || item.testUserPermission?.(game.user, "OBSERVER") === false) return null;
    const model = item.system;
    return direct || ((model.isWeapon || model.isShield) && model.useHands) ? item : null;
  }

  isHandEquipment(actor, item) {
    const model = item?.system;
    return item?.type === "equipment" && item.parent === actor
      && model?.properties?.equipable && typeof model.equipped === "boolean";
  }

  isVersatileHandAction(item, reference) {
    const usage = item?.system.usage;
    return reference?.kind !== "equipment" && item?.system.isWeapon && usage?.oneHand === true && usage.twoHand === true;
  }

  async updateHands(actor, config, number, key, reference, bypassChecks = false) {
    const warn = code => { ui.notifications.warn(game.i18n.localize(`CO2PRISM.Combat.${code}`)); return false; };
    if (this.busyAction || this.changingHands.has(actor)) return false;
    const previous = config.handPresets[config.activePreset];
    const incoming = { "left-hand": null, "right-hand": null, ...config.handPresets[number], ...(key ? { [key]: reference } : {}) };
    if (key) {
      const other = key === "left-hand" ? "right-hand" : "left-hand";
      if (this.slotRows(actor)[0].find(slot => slot.key === key)?.mirrorLocked) return warn("HandsConflict");
      const previousItem = this.handItem(actor, previous[key]);
      if (previousItem?.system.usage?.twoHand && !this.isVersatileHandAction(previousItem, previous[key])
        && incoming[other]?.itemId === previous[key]?.itemId) incoming[other] = null;
    }
    const references = Object.entries(incoming).filter(([hand, ref]) => this.handKey(hand) && ref != null).map(([, ref]) => ref);
    const attacks = references.filter(ref => this.encounterHandAttack(actor, ref));
    const items = references.filter(ref => !attacks.includes(ref)).map(ref => this.handItem(actor, ref));
    if (items.includes(null)) return warn("HandsInvalidItem");
    const required = new Set(items);
    const versatile = item => references.filter(ref => ref.itemId === item.id).every(ref => this.isVersatileHandAction(item, ref));
    const hands = item => item.system.usage?.twoHand ? 2 : 1;
    if (items.length !== required.size && [...required].some(item => hands(item) === 1)) return warn("HandsConflict");
    if ([...required].reduce((used, item) => used + (versatile(item) ? 1 : hands(item)), 0) > 2) return warn("HandsConflict");
    const outgoing = new Set(Object.entries(previous).filter(([hand]) => this.handKey(hand))
      .map(([, ref]) => actor.items?.get(ref?.itemId))
      .filter(item => this.isHandEquipment(actor, item) && !required.has(item)));
    const changes = [...[...outgoing].filter(item => item.system.equipped).map(item => [item, false]),
      ...[...required].filter(item => !item.system.equipped).map(item => [item, true])];
    if (changes.length && typeof actor.toggleEquipmentEquipped !== "function") return warn("HandsEquipmentFailed");
    if (!key && number === config.activePreset && !changes.length) return true;
    const token = this.token;
    const attempted = [];
    const apply = async (item, value) => {
      if (actor.items?.get(item.id) !== item) throw Error("Item indisponible");
      if (item.system.equipped !== value) await actor.toggleEquipmentEquipped(item.id, value && bypassChecks);
      if (actor.items?.get(item.id) !== item || item.system.equipped !== value) throw Error("Équipement refusé");
    };
    this.changingHands.add(actor);
    try {
      for (const [item, value] of changes) {
        attempted.push([item, item.system.equipped]);
        await apply(item, value);
      }
      if (this.actor !== actor || this.token !== token || !this.canConfigure(actor)
        || attacks.some(ref => !this.encounterHandAttack(actor, ref))
        || [...required].some(item => actor.items?.get(item.id) !== item || !item.system.equipped)
        || [...outgoing].some(item => item.system.equipped)) throw Error("Contexte d’équipement modifié");
      if (key) {
        await actor.setFlag(MODULE, `hands.presets.${number}`, incoming);
        const saved = this.readConfiguration(actor).handPresets[number][key];
        if (reference ? ["kind", "source", "itemId", "indice"].some(field => saved?.[field] !== reference[field]) : saved != null) {
          throw Error("Preset de mains non enregistré");
        }
      } else if (number !== config.activePreset) {
        await actor.setFlag(MODULE, "hands.active", number);
        if (this.readConfiguration(actor).activePreset !== number) throw Error("Preset actif non enregistré");
      }
      return true;
    } catch {
      let restored = true;
      for (const [item, value] of attempted.reverse()) {
        try { await apply(item, value); } catch { restored = false; }
      }
      return warn(restored ? "HandsEquipmentFailed" : "HandsRestoreFailed");
    } finally {
      this.changingHands.delete(actor);
      if (this.actor === actor && changes.length) this.invalidateShortcutVisibility();
    }
  }

  shortcutFromDrop(actor, data) {
    try {
      if (data?.type === "co.attack") {
        const item = [...(actor.items?.values() ?? [])].find(entry => entry.uuid === data.uuid && entry.type === "attack");
        const action = item?.actions?.[0];
        if (!action || item.parent !== actor
          || !(game.user.isGM || actor.testUserPermission(game.user, "OWNER"))) return null;
        // La source exportée peut être commune à plusieurs attaques : garder le support réel.
        const reference = { source: item.uuid, indice: action.indice, itemId: item.id };
        return this.resolveShortcut(actor, reference) ? reference : null;
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

  slotReferenceFromDrop(actor, data, slot) {
    if (!slot.hand || data?.type !== "Item") return this.shortcutFromDrop(actor, data);
    if (typeof data.uuid !== "string") return null;
    const item = [...(actor.items?.values() ?? [])].find(owned => owned.uuid === data.uuid);
    if (actor.type === "encounter" && item?.type === "attack") return this.shortcutFromDrop(actor, { type: "co.attack", uuid: item.uuid });
    const reference = { kind: "equipment", itemId: item?.id };
    return this.handItem(actor, reference) ? reference : null;
  }

  plainText(html) {
    const template = document.createElement("template");
    template.innerHTML = typeof html === "string" ? html : "";
    template.content.querySelectorAll("script, style").forEach(node => node.remove());
    return template.content.textContent.replace(/\s+/g, " ").trim();
  }

  pruneShortcuts(rows) {
    const actor = this.actor, token = this.token;
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
        return !actions.some(action => action?.indice === reference.indice);
      } catch { return false; }
    };
    const survivors = entry => this.shortcutReferences(entry).filter(reference => !missing(reference));
    const invalid = rows.flat().filter(slot => !slot.hand && !slot.terminal && slot.reference !== undefined
      && (!this.shortcutReferences(slot.reference).length || this.shortcutReferences(slot.reference).some(missing)));
    if (!invalid.length) return;
    this.prunedSignatures ??= new WeakMap();
    const signature = JSON.stringify(invalid.map(slot => [slot.key, slot.reference]));
    if (this.prunedSignatures.get(actor) === signature) return;
    this.prunedSignatures.set(actor, signature);
    void this.queueConfiguration(actor, async () => {
      const config = this.readConfiguration(actor);
      if (this.actor !== actor || this.token !== token || !this.canConfigure(actor)) {
        this.prunedSignatures.delete(actor); return false;
      }
      const slots = config.shortcuts;
      const keys = [];
      let changed = false;
      for (const { key, reference } of invalid) {
        if (JSON.stringify(slots[key]) !== JSON.stringify(reference)) continue;
        const kept = survivors(slots[key]);
        if (!kept.length) keys.push(key);
        else if (kept.length < this.shortcutReferences(slots[key]).length) slots[key] = this.shortcutEntry(slots[key], kept);
        else continue;
        changed = true;
      }
      if (!changed) { this.prunedSignatures.delete(actor); return false; }
      for (const key of keys) delete slots[key];
      if (keys.length) for (const row of this.slotRows(actor)) row.filter(slot => !slot.hand && !slot.terminal && !keys.includes(slot.key))
        .forEach((slot, order) => { slots[slot.key] = { ...slots[slot.key], order }; });
      for (const key of keys) slots[`-=${key}`] = null;
      await actor.setFlag(MODULE, "shortcuts", slots);
      this.prunedSignatures.delete(actor);
      return true;
    });
  }

  async collectConditionalActions(actor, rows, generation) {
    const sources = new Map();
    for (const slot of rows.flat()) {
      if (slot.hand || slot.terminal) continue;
      const references = this.shortcutReferences(slot.reference);
      for (const [actionIndex, reference] of references.entries()) {
        const resolved = this.resolveShortcut(actor, reference);
        const item = resolved?.item;
        const actions = item?.system?.actions;
        if (!Array.isArray(actions) || actor.items?.get(item.id) !== item) continue;
        const index = actions.indexOf(resolved.action);
        if (index < 0) continue;
        const key = `${item.id}:${index}`;
        let source = sources.get(key);
        if (!source) {
          source = { item, action: resolved.action, index, origins: [] };
          sources.set(key, source);
        }
        source.origins.push({ key: slot.key, row: slot.row, actionIndex: references.length > 1 ? actionIndex : undefined });
      }
    }
    const groups = await Promise.all([...sources.values()].map(async ({ item, action, index, origins }) => {
      const source = { itemId: item.id, source: item.uuid, indice: action.indice };
      const dependencies = [];
      const evaluations = [];
      for (const candidate of item.system.actions) {
        if (candidate === action || !this.shortcutDependsOn(candidate, index)) continue;
        const reference = { ...source, indice: candidate.indice };
        if (this.resolveShortcut(actor, reference)?.action !== candidate) continue;
        dependencies.push(reference);
        const visible = action.properties?.enabled === true && typeof candidate.isVisible === "function"
          ? this.shortcutVisibility(candidate, item, actor, generation).catch(() => false) : false;
        evaluations.push(visible);
      }
      if (!dependencies.length) return null;
      const visible = await Promise.all(evaluations);
      return { source, origins, dependencies, available: dependencies.filter((_, index) => visible[index]) };
    }));
    return groups.filter(Boolean);
  }

  shortcutDependsOn(action, index) {
    return index >= 0 && Array.isArray(action?.conditions) && action.conditions.some(condition =>
      condition?.predicate === "isLinkedActionActivated" && String(condition.object) === String(index));
  }

  renderCombatSlots() {
    this.clearShortcutPreview();
    this.closePresetActionMenu();
    const editable = !game.settings.get(MODULE, "locked") && this.canConfigure();
    const disabled = Boolean(this.busyAction) || !(game.user.isGM || this.actor?.testUserPermission(game.user, "OWNER"));
    const { actor, token } = this;
    if (this.conditionRender?.actor !== actor || this.conditionRender?.token !== token) this.renderConditionalRows([]);
    const allRows = this.slotRows();
    const signature = this.combatSlotsSignature(allRows, editable, disabled);
    const reuse = this.conditionRender?.actor === actor && this.conditionRender?.token === token
      && this.conditionRender.signature === signature;
    const originNodes = reuse ? this.conditionRender.originNodes : new Map();
    const bindings = reuse ? this.conditionRender.bindings : [];
    const generation = this.conditionRender = { actor, token, signature, originNodes, bindings, ...this.actionVisibilityCache() };
    this.conditionalActionGroups = [];
    void this.collectConditionalActions(actor, allRows, generation).then(groups => {
      if (this.conditionRender === generation && this.actor === actor && this.token === token) {
        this.conditionalActionGroups = groups;
        this.renderConditionalRows(groups, originNodes);
      }
    }).catch(error => console.warn("co2prism | Dépendances des actions", error));
    this.pruneShortcuts(allRows);
    if (reuse) {
      for (const { node, context, reference, onState } of bindings) {
        const resolved = this.resolveShortcut(actor, reference);
        if (resolved) this.renderShortcutConditions(node, resolved, context, generation, onState);
      }
      return false;
    }
    let resized = false;
    const rows = allRows.map(row => row.filter(slot => !game.settings.get(MODULE, "locked")
      || slot.hand || this.shortcutReferences(slot.reference).some(reference => this.resolveShortcut(this.actor, reference))));
    for (const [index, row] of rows.entries()) {
      const scroll = this.combatRows[index].scrollLeft;
      const nodes = row.flatMap(slot => {
        const node = document.createElement("div");
        node.className = "co2prism-combat-slot";
        if (!slot.hand && slot.key) originNodes.set(slot.key, node);
        node.dataset.co2prismRow = String(slot.row);
        if (slot.hand) node.dataset.co2prismHand = slot.hand;
        node.setAttribute("role", "group");
        const label = game.i18n.localize(slot.hand === "left" ? "CO2PRISM.Combat.LeftHand"
          : slot.hand === "right" ? "CO2PRISM.Combat.RightHand" : "CO2PRISM.Combat.EmptySlot");
        const direct = slot.hand && slot.reference?.kind === "equipment";
        const equipment = direct ? this.handItem(this.actor, slot.reference) : null;
        const references = slot.hand ? [slot.reference] : this.shortcutReferences(slot.reference);
        const group = references.length > 1;
        const editContext = { actor: this.actor, token: this.token, preset: slot.hand ? this.configuration.activePreset : undefined,
          key: slot.key, reference: slot.reference };
        const resolved = references.length === 1 && !direct ? this.resolveShortcut(this.actor, references[0]) : null;
        const add = (tag, cls, text) => {
          const child = document.createElement(tag); child.className = cls;
          if (text !== undefined) child.textContent = text;
          node.append(child); return child;
        };
        const bindDrop = () => {
          node.addEventListener("dragenter", event => this.hoverSlot(event, slot, node));
          node.addEventListener("dragover", event => this.hoverSlot(event, slot, node));
          node.addEventListener("dragleave", () => node.classList.remove("co2prism-drop-target", "co2prism-drop-candidate", "co2prism-drop-insert"));
          node.addEventListener("drop", event => { void this.dropSlot(event, slot, node); });
        };
        node.dataset.co2prismTooltipText = label;
        if (slot.hand) {
          const icon = add("i", "co2prism-slot-hand fa-solid fa-hand");
          icon.setAttribute("aria-hidden", "true");
        }
        if (slot.mirror) {
          const item = this.handItem(this.actor, slot.mirror);
          const resolved = this.resolveShortcut(this.actor, slot.mirror);
          const action = resolved?.action;
          const image = action?.actionImg || action?.img || item?.img;
          node.classList.add("co2prism-hand-mirror");
          const occupied = game.i18n.localize("CO2PRISM.Combat.HandOccupied");
          node.dataset.co2prismTooltipText = occupied;
          node.setAttribute("aria-label", occupied);
          if (resolved) {
            this.describeShortcut(node, resolved, action.actionName || item?.name || occupied);
            node.dataset.co2prismActionSummary = [node.dataset.co2prismActionSummary, occupied].filter(Boolean).join("\n");
            if (node.dataset.co2prismActionSummaryHtml) {
              node.dataset.co2prismActionSummaryHtml += `\n${foundry.utils.escapeHTML(occupied)}`;
            }
            node.removeAttribute("aria-pressed");
          } else if (item) this.describeHandEquipment(node, item, occupied);
          if (image) {
            const img = add("img", "co2prism-slot-image"); img.src = image; img.alt = ""; img.draggable = false;
          }
          if (slot.mirrorLocked) {
            node.addEventListener("dragover", event => event.stopPropagation());
            node.addEventListener("drop", event => { event.preventDefault(); event.stopPropagation(); });
          } else bindDrop();
          this.combatHands[slot.hand].replaceChildren(node);
          return [];
        }
        if (slot.hand && slot.reference === undefined && game.settings.get(MODULE, "locked")) {
          node.classList.add("co2prism-hand-empty");
          node.setAttribute("role", "img");
          node.setAttribute("aria-label", label);
          this.combatHands[slot.hand].replaceChildren(node);
          return [];
        }
        if (group) {
          node.dataset.co2prismTooltipText = game.i18n.format("CO2PRISM.Combat.ShortcutGroup", { count: references.length });
          node.classList.add("co2prism-slot-group");
          node.dataset.co2prismSlotKey = slot.key;
          for (let index = 0; index < MAX_SHORTCUT_ACTIONS; index++) {
            const quadrant = add("div", "co2prism-slot-quadrant");
            if (index >= references.length) {
              quadrant.setAttribute("aria-hidden", "true");
              continue;
            }
            quadrant.dataset.co2prismActionIndex = String(index);
            quadrant.dataset.co2prismSlotKey = slot.key;
            const reference = references[index];
            const context = { ...editContext, actionIndex: index };
            const member = this.resolveShortcut(this.actor, reference);
            if (member) {
              const { action, item } = member;
              const image = this.shortcutImage(action, item);
              if (image) {
                const img = document.createElement("img");
                img.className = "co2prism-slot-image";
                img.src = image;
                img.alt = "";
                img.draggable = false;
                quadrant.append(img);
              }
              const command = document.createElement("div");
              command.className = "co2prism-quadrant-command";
              command.setAttribute("aria-label", action.actionName || item?.name || label);
              command.setAttribute("aria-description", game.i18n.localize("CO2PRISM.Combat.ShortcutControls"));
              if (action.properties?.activable === true) {
                command.setAttribute("aria-pressed", String(action.properties.enabled === true));
              }
              quadrant.append(command);
              this.describeShortcut(quadrant, member, action.actionName || item?.name || label);
              this.bindShortcutInteraction(command, { ...context, reference }, disabled);
              quadrant.classList.toggle("co2prism-action-active", this.shortcutActive(action));
              quadrant.classList.toggle("co2prism-action-exhausted", this.shortcutUses(action, item)?.value === 0);
              quadrant.classList.toggle("co2prism-time-insufficient",
                economyEnabled() && new ActionEconomy(this.actor).getSnapshot().canSpend[action.actionTypeFinal] === false);
              const onState = available => {
                command.setAttribute("aria-disabled", String(disabled || Boolean(this.busyAction) || !available));
                if (this.shortcutHover?.quadrant === quadrant && this.shortcutPreview.firstElementChild) {
                  this.copyShortcutCondition(quadrant, this.shortcutPreview.firstElementChild);
                }
              };
              bindings.push({ node: quadrant, context, reference, onState });
              this.renderShortcutConditions(quadrant, member, context, generation, onState);
              quadrant.addEventListener("pointerenter", event => {
                if (event.pointerType !== "touch") this.scheduleShortcutPreview(quadrant, context);
              });
              quadrant.addEventListener("pointerleave", () => {
                if (this.shortcutHover?.quadrant === quadrant) this.clearShortcutPreview();
              });
              for (const type of ["pointerdown", "pointercancel", "click", "contextmenu"]) {
                quadrant.addEventListener(type, () => this.clearShortcutPreview(), { capture: true });
              }
            } else quadrant.classList.add("co2prism-slot-unavailable");
            if (editable) {
              quadrant.draggable = true;
              this.addShortcutRemove(quadrant, context);
            }
          }
        } else if (equipment) {
          if (equipment.img) {
            const img = add("img", "co2prism-slot-image"); img.src = equipment.img; img.alt = equipment.name; img.draggable = false;
          }
          this.describeHandEquipment(node, equipment);
          if (!equipment.system.equipped) {
            node.classList.add("co2prism-hand-unequipped");
          }
        } else if (slot.reference !== undefined && !resolved) {
          node.classList.add("co2prism-slot-unavailable");
          add("span", "co2prism-slot-empty", game.i18n.localize("CO2PRISM.Combat.UnavailableSlot"));
          node.dataset.co2prismTooltipText = game.i18n.localize("CO2PRISM.Combat.UnavailableSlot");
        } else if (resolved) {
          const { action, item } = resolved;
          const name = this.renderShortcutVisual(node, resolved, references[0]);
          const unequipped = Boolean(slot.hand && !this.encounterHandAttack(this.actor, references[0]) && !item?.system.equipped);
          this.describeShortcut(node, resolved, name, unequipped);
          const context = { actor: this.actor, token: this.token, preset: slot.hand ? this.configuration.activePreset : undefined,
            key: slot.key, reference: references[0] };
          this.bindShortcutInteraction(node, context, disabled, unequipped);
          const title = node.dataset.co2prismTooltipText;
          const onState = (available, error) => {
            node.setAttribute("aria-disabled", String(disabled || Boolean(this.busyAction) || unequipped || !available));
            node.dataset.co2prismTooltipText = title;
            if (!available) node.dataset.co2prismTooltipText += `\n${game.i18n.localize(error
              ? "CO2PRISM.Combat.ConditionsUnknown" : "CO2PRISM.Combat.ConditionsUnavailable")}`;
            node.setAttribute("aria-label", slot.hand ? `${label}\n${node.dataset.co2prismTooltipText}` : node.dataset.co2prismTooltipText);
          };
          bindings.push({ node, context, reference: references[0], onState });
          this.renderShortcutConditions(node, resolved, context, generation, onState);
        } else add("span", "co2prism-slot-empty", game.i18n.localize("CO2PRISM.Combat.EmptySlot"));
        if (editable && slot.reference !== undefined) {
          if (!group) this.addShortcutRemove(node, editContext);
          if (!slot.hand) {
            node.draggable = true;
            node.addEventListener("dragstart", event => {
              this.clearShortcutPreview();
              event.stopPropagation();
              if (event.target.closest?.(".co2prism-slot-remove") || !this.validShortcutContext(editContext)) { event.preventDefault(); return; }
              const actionIndex = this.shortcutActionIndex(event, slot);
              this.slotDrag = { ...editContext, actionIndex, internal: true };
              this.suppressShortcutClick = true;
              event.dataTransfer.setData("text/plain", JSON.stringify({ type: "co2prism.shortcut", key: slot.key, actionIndex }));
              event.dataTransfer.effectAllowed = "move";
            });
            node.addEventListener("dragend", () => { setTimeout(() => { this.suppressShortcutClick = false; }, 0); });
          }
        }
        node.setAttribute("aria-label", slot.hand ? `${label}\n${node.dataset.co2prismTooltipText}` : node.dataset.co2prismTooltipText);
        if (group) node.removeAttribute("title");
        bindDrop();
        if (!slot.hand) return [node];
        this.combatHands[slot.hand].replaceChildren(node);
        return [];
      });
      resized ||= this.combatRows[index].childElementCount !== nodes.length;
      this.combatRows[index].replaceChildren(...nodes);
      this.combatRows[index].scrollLeft = scroll;
    }
    return resized;
  }

  combatSlotsSignature(rows, editable, disabled) {
    const state = new ActionEconomy(this.actor).getSnapshot().canSpend;
    const equipmentVisual = reference => {
      if (reference?.kind !== "equipment") return null;
      const item = this.handItem(this.actor, reference);
      return item && [item.name, item.img, item.system.equipped, item.system.description, item.isOwner];
    };
    const visual = reference => {
      const resolved = this.resolveShortcut(this.actor, reference);
      if (!resolved) return null;
      const { action, item } = resolved;
      try {
        return [this.shortcutImage(action, item), action.actionName, action.label, action.hasLabel, item?.name, item?.system?.description,
          item?.isOwner, item?.system?.equipped, action.iconFA, action.actionTypeFinal, action.manaCost, this.shortcutUses(action, item),
          action.properties?.activable, action.properties?.temporary, action.properties?.enabled,
          this.shortcutCanToggle(action) ? this.presetActionIdentity(this.actor, reference)?.fingerprint : null];
      } catch { return null; }
    };
    return JSON.stringify([editable, disabled, game.settings.get(MODULE, "locked"), this.configuration.activePreset,
      this.configuration.presetActionRules, economyEnabled(), state,
      rows.map(row => row.map(slot => [
        slot, this.shortcutReferences(slot.reference).map(visual), visual(slot.mirror),
        equipmentVisual(slot.reference), equipmentVisual(slot.mirror)
      ]))]);
  }

  renderConditionalRows(groups, originNodes) {
    const zone = this.conditionalZone;
    if (!zone) return;
    const markers = ["co2prism-conditional-halo", "co2prism-linked-origin"];
    for (const origin of originNodes?.values() ?? []) {
      origin.classList.remove(...markers);
      origin.querySelectorAll(".co2prism-conditional-halo, .co2prism-linked-origin")
        .forEach(node => node.classList.remove(...markers));
    }
    const scroll = new Map([...zone.children].map(row => [row.dataset.sourceKey, row.scrollLeft]));
    const verticalScroll = zone.scrollTop;
    const focused = zone.contains(document.activeElement) ? document.activeElement : null;
    const rows = [];
    for (const group of groups) {
      const origins = group.origins.map(({ key, actionIndex }) => {
        const node = originNodes.get(key);
        return actionIndex === undefined ? node : node?.querySelector(`[data-co2prism-action-index="${actionIndex}"]`);
      }).filter(Boolean);
      for (const origin of origins) origin.classList.add("co2prism-linked-origin");
      if (!group.available.length) continue;
      const row = document.createElement("div");
      row.className = "co2prism-combat-row co2prism-conditional-row";
      row.dataset.sourceKey = `${group.source.itemId}:${group.source.indice}`;
      row.tabIndex = 0;
      row.setAttribute("role", "group");
      const source = this.resolveShortcut(this.actor, group.source);
      if (!source) continue;
      row.setAttribute("aria-label", source.action.actionName || source.item?.name || "");
      for (const reference of group.available) {
        const resolved = this.resolveShortcut(this.actor, reference);
        if (!resolved) continue;
        const square = document.createElement("div");
        square.className = "co2prism-combat-slot co2prism-conditional-halo";
        square.dataset.co2prismItemId = reference.itemId;
        square.dataset.co2prismSource = reference.source;
        square.dataset.co2prismIndice = String(reference.indice);
        const name = this.renderShortcutVisual(square, resolved, reference);
        this.describeShortcut(square, resolved, name);
        square.setAttribute("aria-label", square.dataset.co2prismTooltipText);
        this.bindShortcutInteraction(square, { actor: this.actor, token: this.token, reference,
          conditionalSource: group.source, expectedAction: resolved.action },
        Boolean(this.busyAction) || !(game.user.isGM || this.actor.testUserPermission(game.user, "OWNER")));
        row.append(square);
      }
      if (!row.children.length) continue;
      for (const origin of origins) origin.classList.add("co2prism-conditional-halo");
      rows.push(row);
    }
    const wasHidden = zone.hidden;
    zone.hidden = !rows.length;
    zone.replaceChildren(...rows);
    zone.scrollTop = verticalScroll;
    for (const row of rows) row.scrollLeft = scroll.get(row.dataset.sourceKey) ?? 0;
    if (focused) {
      const row = rows.find(row => row.dataset.sourceKey === focused.closest(".co2prism-conditional-row").dataset.sourceKey);
      const target = focused.dataset.co2prismIndice === undefined ? row : [...(row?.children ?? [])]
        .find(square => square.dataset.co2prismIndice === focused.dataset.co2prismIndice);
      target?.focus({ preventScroll: true });
    }
    if (wasHidden !== zone.hidden && this.anchor) this.layout({ preserveAnchor: true });
  }

  shortcutImage(action, item) {
    const read = key => { try { return action[key]; } catch { return undefined; } };
    return read("actionImg") || read("img") || item?.img;
  }

  bindShortcutInteraction(node, context, disabled, unequipped = false) {
    node.classList.add("co2prism-slot-executable");
    node.setAttribute("role", "button");
    node.setAttribute("aria-disabled", String(disabled || unequipped));
    node.tabIndex = disabled ? -1 : 0;
    node.addEventListener("click", event => { void this.executeShortcut(event, context); });
    node.addEventListener("contextmenu", event => {
      if (context.conditionalSource) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      this.openPresetActionMenu(event, context, node);
    });
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") void this.executeShortcut(event, context);
    });
  }

  describeHandEquipment(node, item, occupied = "") {
    const unequipped = !item.system.equipped && game.i18n.localize("CO2PRISM.Combat.HandUnequipped");
    const summary = [item.name, unequipped, occupied].filter(Boolean).join("\n");
    node.dataset.co2prismActionSummary = summary;
    node.dataset.co2prismTooltipText = summary;
    if (item.testUserPermission?.(game.user, "OBSERVER")) {
      void this.prepareItemTooltip(node, item, this.itemTooltipDescription(item));
    }
  }

  describeShortcut(node, { action, item }, name, unequipped = false) {
    const localize = key => game.i18n.localize(`CO2PRISM.Combat.${key}`);
    const format = (key, value) => game.i18n.format(`CO2PRISM.Combat.${key}`, { value });
    const time = { l: "Limited", a: "Attack", m: "Move", f: "Free" }[action.actionTypeFinal];
    const uses = this.shortcutUses(action, item);
    const cost = action.manaCost;
    const activable = this.shortcutCanToggle(action);
    const label = action.hasLabel === false ? "" : action.label || action.actionName;
    const actionName = label !== item?.name ? label : "";
    const details = [time && localize(`ActionTime_${time}`),
      Number.isFinite(cost) && cost > 0 ? format("ActionManaCost", cost) : "",
      uses && ["daily", "combat"].includes(uses.type) ? format(`ActionUses_${uses.type}`, uses.value) : "",
      activable ? localize(action.properties.enabled ? "Active" : "Inactive") : ""];
    node.dataset.co2prismActionSummary = [item?.name, actionName, ...details].filter(Boolean).join("\n");
    delete node.dataset.co2prismActionSummaryHtml;
    if (actionName) {
      const escape = line => line && foundry.utils.escapeHTML(line);
      node.dataset.co2prismActionSummaryHtml = [escape(item?.name), `<em>${escape(actionName)}</em>`, ...details.map(escape)]
        .filter(Boolean).join("\n");
    }
    node.dataset.co2prismTooltipText = node.dataset.co2prismActionSummary || name;
    if (item?.testUserPermission?.(game.user, "OBSERVER")) {
      const description = this.itemTooltipDescription(item);
      if (description) void this.prepareItemTooltip(node, item, description, item.name);
    }
    if (unequipped) {
      node.classList.add("co2prism-hand-unequipped");
      node.dataset.co2prismTooltipText += `\n${localize("HandUnequipped")}`;
    }
    if (action.properties?.activable === true) node.setAttribute("aria-pressed", String(action.properties.enabled === true));
  }

  closePresetActionMenu() {
    if (this.presetActionMenu?.matches(":popover-open")) this.presetActionMenu.hidePopover();
  }

  openPresetActionMenu(event, { actor, token, key, reference, actionIndex }, anchor) {
    this.closePresetActionMenu();
    if (game.settings.get(MODULE, "locked")) {
      event.preventDefault();
      return;
    }
    const preset = this.configuration.activePreset;
    const isCurrent = () => {
      if (!anchor.isConnected || this.actor !== actor || this.token !== token || game.settings.get(MODULE, "locked")
        || !this.canConfigure(actor)) return false;
      const config = this.readConfiguration(actor);
      const current = this.shortcutReferenceAt(config, key, actionIndex);
      return config.panels.combat && config.activePreset === preset && current
        && ["source", "indice", "itemId"].every(field => current[field] === reference[field]);
    };
    if (!isCurrent()) return;
    const identity = this.presetActionIdentity(actor, reference);
    if (!identity) return;
    event.preventDefault();
    event.stopPropagation();
    game.tooltip?.deactivate();
    const menu = this.presetActionMenu;
    const currentRule = this.getPresetActionRule(actor, reference, preset);
    menu.replaceChildren(...["activate", "deactivate", "unchanged"].map(rule => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-pressed", String(rule === currentRule));
      const mark = document.createElement("i");
      mark.className = "fa-solid fa-check";
      mark.setAttribute("aria-hidden", "true");
      button.append(mark, game.i18n.localize(`CO2PRISM.PresetAction.${rule}`));
      button.addEventListener("click", () => {
        if (!menu.matches(":popover-open")) return;
        this.closePresetActionMenu();
        if (this.presetActionIdentity(actor, reference)?.fingerprint !== identity.fingerprint) return;
        void this.setPresetActionRule(actor, reference, preset, rule, isCurrent);
      });
      return button;
    }));
    this.showActionPopover(menu, event, anchor);
  }

  renderShortcutVisual(node, { action, item }, reference) {
    const read = key => { try { return action[key]; } catch { return undefined; } };
    const add = (tag, className, text) => {
      const child = document.createElement(tag);
      child.className = className;
      if (text !== undefined) child.textContent = text;
      node.append(child);
      return child;
    };
    const name = read("actionName") || item?.name || "";
    const image = this.shortcutImage(action, item);
    if (typeof image === "string" && image) {
      const img = add("img", "co2prism-slot-image");
      img.src = image; img.alt = name; img.draggable = false;
    }
    const icon = read("iconFA");
    if (typeof icon === "string" && icon) add("i", "co2prism-slot-type fa-solid "
      + icon.split(/\s+/).filter(cls => /^fa-[a-z0-9-]+$/.test(cls) && cls !== "fa-solid").join(" "));
    const actionTime = read("actionTypeFinal");
    const time = { l: "L", a: "A", am: "AM", m: "M", f: "G" }[actionTime];
    if (time) add("span", `co2prism-slot-time co2prism-slot-time-${time}`, time);
    const uses = this.shortcutUses(action, item);
    if (uses) {
      const badge = add("span", "co2prism-slot-uses", `${uses.value} `);
      badge.dataset.co2prismUses = uses.type;
      badge.dataset.co2prismTooltipText = game.i18n.localize(`CO2PRISM.Combat.Uses_${uses.type}`);
      const icon = document.createElement("i");
      icon.className = `fa-solid fa-${uses.icon}`; badge.append(icon);
      if (uses.value === 0) node.classList.add("co2prism-action-exhausted");
    }
    const cost = read("manaCost");
    if (Number.isFinite(cost) && cost > 0) {
      const badge = add("span", "co2prism-slot-cost", `${cost} `);
      const bolt = document.createElement("i"); bolt.className = "fa-solid fa-bolt"; badge.append(bolt);
    }
    if (this.shortcutActive(action)) node.classList.add("co2prism-action-active");
    if (economyEnabled() && new ActionEconomy(this.actor).getSnapshot().canSpend[actionTime] === false) {
      node.classList.add("co2prism-time-insufficient");
    }
    if (this.shortcutCanToggle(action) && this.presetActionIdentity(this.actor, reference)) {
      const rule = this.getPresetActionRule(this.actor, reference, this.configuration.activePreset, this.configuration);
      if (rule !== "unchanged" || !game.settings.get(MODULE, "locked")) {
        const icon = { activate: "fa-toggle-large-on", deactivate: "fa-toggle-large-off", unchanged: "fa-circle-dashed" }[rule];
        const indicator = add("i", `co2prism-slot-rule co2prism-slot-rule-${rule} fa-solid ${icon}`);
        indicator.setAttribute("role", "img");
        indicator.setAttribute("aria-label", game.i18n.localize(`CO2PRISM.PresetAction.${rule}`));
      }
    }
    return name;
  }

  copyShortcutCondition(quadrant, square) {
    for (const state of ["co2prism-condition-pending", "co2prism-condition-unavailable"]) {
      square.classList.toggle(state, quadrant.classList.contains(state));
    }
  }

  clearShortcutPreview() {
    if (this.shortcutHover) clearTimeout(this.shortcutHover.delay);
    this.shortcutHover = null;
    if (this.shortcutPreview?.matches(":popover-open")) {
      this.shortcutPreview.hidePopover();
      this.shortcutPreview.replaceChildren();
    }
  }

  scheduleShortcutPreview(quadrant, { actor, token, key, actionIndex }) {
    if (this.shortcutHover?.quadrant === quadrant) return;
    this.clearShortcutPreview();
    if (this.slotDrag || !this.shortcutPreview || this.presetActionMenu?.matches(":popover-open")) return;
    const hover = { quadrant };
    this.shortcutHover = hover;
    hover.delay = setTimeout(() => {
      if (this.shortcutHover !== hover) return;
      if (this.element.hidden || !quadrant.getClientRects().length || this.combatPanel.hidden
        || this.actor !== actor || this.token !== token) {
        this.clearShortcutPreview();
        return;
      }
      const entry = this.readConfiguration(actor).shortcuts[key];
      const references = this.shortcutReferences(entry);
      const resolved = references.length > 1 && this.resolveShortcut(actor, references[actionIndex]);
      if (!resolved) {
        this.clearShortcutPreview();
        return;
      }
      const preview = this.shortcutPreview;
      const square = document.createElement("div");
      square.className = "co2prism-combat-slot";
      this.renderShortcutVisual(square, resolved, references[actionIndex]);
      this.copyShortcutCondition(quadrant, square);
      preview.replaceChildren(square);
      preview.showPopover();
      const anchor = quadrant.getBoundingClientRect();
      const bounds = preview.getBoundingClientRect();
      const gap = Math.max(4, anchor.width * 0.12);
      const above = anchor.top - bounds.height - gap;
      const left = (anchor.left + anchor.right - bounds.width) / 2;
      const top = above >= 4 ? above : anchor.bottom + gap;
      preview.style.left = `${Math.max(4, Math.min(left, innerWidth - bounds.width - 4))}px`;
      preview.style.top = `${Math.max(4, Math.min(top, innerHeight - bounds.height - 4))}px`;
    }, SHORTCUT_PREVIEW_DELAY);
  }

  shortcutCanToggle(action) {
    const properties = action?.properties;
    return properties?.activable === true && properties.temporary === true;
  }

  presetActionIdentity(actor, reference) {
    const resolved = this.resolveShortcut(actor, reference);
    const item = resolved?.item;
    const action = resolved?.action;
    if (!item || actor.items.get(item.id) !== item || !/^[A-Za-z0-9_-]+$/.test(item.id)
      || !this.shortcutCanToggle(action) || typeof action.toObject !== "function") return null;
    try {
      const { source, indice, properties, ...definition } = action.toObject();
      const { enabled, ...settings } = properties;
      // L'état actif et l'UUID contextuel ne font pas partie de la définition.
      const serialized = JSON.stringify([item._stats?.createdTime ?? null, definition, settings], (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
      let hash = 0xcbf29ce484222325n;
      for (let index = 0; index < serialized.length; index++) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(serialized.charCodeAt(index))) * 0x100000001b3n);
      }
      return { key: `${item.id}:${action.indice}`, fingerprint: `v1-${hash.toString(16).padStart(16, "0")}` };
    } catch {
      return null;
    }
  }

  getPresetActionRule(actor, reference, preset, configuration) {
    if (![1, 2, 3].includes(preset)) return "unchanged";
    const identity = this.presetActionIdentity(actor, reference);
    const entry = identity && (configuration ?? this.readConfiguration(actor)).presetActionRules[identity.key];
    const rule = entry?.fingerprint === identity?.fingerprint ? entry?.[preset] : undefined;
    return ["activate", "deactivate"].includes(rule) ? rule : "unchanged";
  }

  setPresetActionRule(actor, reference, preset, rule, isCurrent = () => true) {
    if (![1, 2, 3].includes(preset) || !["activate", "deactivate", "unchanged"].includes(rule)
      || !this.canConfigure(actor) || !isCurrent()) return Promise.resolve(false);
    const identity = this.presetActionIdentity(actor, reference);
    if (!identity) return Promise.resolve(false);
    return this.queueConfiguration(actor, async () => {
      const current = this.presetActionIdentity(actor, reference);
      if (!this.canConfigure(actor) || !isCurrent() || current?.key !== identity.key || current.fingerprint !== identity.fingerprint) return false;
      const entry = this.readConfiguration(actor).presetActionRules[identity.key];
      const rules = Object.fromEntries([1, 2, 3].map(number => [number, entry?.[number]])
        .filter(([, previous]) => entry?.fingerprint === identity.fingerprint && ["activate", "deactivate"].includes(previous)));
      if ((rules[preset] ?? "unchanged") === rule) return false;
      if (rule === "unchanged") delete rules[preset];
      else rules[preset] = rule;
      const path = `presetActionRules.${identity.key}`;
      if (!Object.keys(rules).length) await actor.unsetFlag(MODULE, path);
      else {
        const removed = Object.fromEntries([1, 2, 3].filter(number => !(number in rules)).map(number => [`-=${number}`, null]));
        await actor.setFlag(MODULE, path, { fingerprint: identity.fingerprint, ...rules, ...removed });
      }
      return true;
    });
  }

  shortcutActive(action) {
    return this.shortcutCanToggle(action) && action.properties.enabled === true;
  }

  actionVisibilityCache() {
    return this.shortcutVisibilityCache ??= { visibility: new Map(), results: new Map() };
  }

  invalidateShortcutVisibility() {
    if (!this.shortcutVisibilityCache) return;
    this.shortcutVisibilityCache = { visibility: new Map(), results: new Map(this.shortcutVisibilityCache.results) };
  }

  async nativeShortcutVisibility(action, item, actor) {
    // Même filtre d'accès que COActor.getVisibleActions pour les Items qu'il liste.
    if ((item?.type === "capacity" && actor.canUseCapacities === false)
      || (item?.type === "equipment" && item.system?.container)) return false;
    return typeof action.isVisible !== "function" || Boolean(await action.isVisible(item, actor));
  }

  shortcutVisibility(action, item, actor, generation) {
    if (!generation.visibility.has(action)) {
      const key = `${item?.id ?? actor.uuid}:${action.indice}`;
      const evaluation = this.nativeShortcutVisibility(action, item, actor).then(available => {
        generation.results?.set(key, available);
        return available;
      }, error => {
        generation.results?.set(key, false);
        if (generation.results) console.warn("co2prism | Conditions", error);
        throw error;
      });
      generation.visibility.set(action, evaluation);
    }
    return generation.visibility.get(action);
  }

  renderShortcutConditions(node, { action, item }, context, generation, onState) {
    const previous = generation.results.get(`${item?.id ?? context.actor.uuid}:${action.indice}`);
    node.classList.toggle("co2prism-condition-unavailable", previous === false);
    if (previous === undefined && typeof action.isVisible === "function") node.classList.add("co2prism-condition-pending");
    const apply = (available, error = false) => {
      if (this.conditionRender !== generation || !node.isConnected || this.actor !== context.actor
        || this.token !== context.token || (context.preset && this.configuration.activePreset !== context.preset)) return;
      node.classList.remove("co2prism-condition-pending");
      node.classList.toggle("co2prism-condition-unavailable", !available);
      onState?.(available, error);
    };
    this.shortcutVisibility(action, item, context.actor, generation)
      .then(available => apply(available), error => apply(false, error));
  }

  addShortcutRemove(node, context) {
    const remove = document.createElement("button");
    remove.className = "co2prism-slot-remove";
    remove.type = "button";
    remove.dataset.co2prismTooltipText = game.i18n.localize("CO2PRISM.Combat.RemoveShortcut");
    remove.setAttribute("aria-label", remove.dataset.co2prismTooltipText);
    const icon = document.createElement("i"); icon.className = "fa-solid fa-trash"; remove.append(icon);
    for (const type of ["pointerdown", "mousedown", "dragstart", "keydown"]) remove.addEventListener(type, event => event.stopPropagation());
    remove.addEventListener("dragstart", event => event.preventDefault());
    remove.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); void this.manageShortcut(context);
    });
    node.append(remove);
  }

  hoverSlot(event, slot, node) {
    node.classList.remove("co2prism-drop-target", "co2prism-drop-candidate", "co2prism-drop-insert");
    if (!this.slotDrag) {
      this.slotDrag = { actor: this.actor, token: this.token, preset: this.configuration.activePreset };
    }
    const context = this.slotDrag;
    if (context.internal) {
      if (slot.hand || !this.validShortcutContext(context)) return;
      const actionIndex = this.shortcutActionIndex(event, slot);
      if (context.actionIndex !== undefined && (slot.key !== context.key || actionIndex === undefined
        || actionIndex === context.actionIndex)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
      node.classList.add("co2prism-drop-insert"); return;
    }
    if (game.settings.get(MODULE, "locked") || context.cancelled || !this.canConfigure(context.actor) || !this.configuration.panels.combat) return;
    const raw = event.dataTransfer?.getData("text/plain");
    if (raw) {
      try {
        const reference = this.slotReferenceFromDrop(context.actor, JSON.parse(raw), slot);
        if (!reference || (slot.hand && !this.handItem(context.actor, reference) && !this.encounterHandAttack(context.actor, reference))) return;
      } catch { return; }
    } else if (!Array.from(event.dataTransfer?.types ?? []).includes("text/plain")) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    node.classList.add(raw ? "co2prism-drop-target" : "co2prism-drop-candidate");
  }

  shortcutActionIndex(event, slot) {
    const target = event.target?.closest?.("[data-co2prism-action-index]");
    if (slot.hand || !target || !/^\d+$/.test(target.dataset.co2prismActionIndex)) return undefined;
    const index = Number(target.dataset.co2prismActionIndex);
    return index < this.shortcutReferences(slot.reference).length ? index : undefined;
  }

  shortcutReferenceAt(config, key, actionIndex) {
    const entry = config.slots[key];
    const references = this.handKey(key) ? [entry] : this.shortcutReferences(entry);
    if (actionIndex === undefined) return references.length === 1 ? references[0] : null;
    return !this.handKey(key) && references.length > 1 && Number.isInteger(actionIndex)
      && actionIndex >= 0 && actionIndex < MAX_SHORTCUT_ACTIONS ? references[actionIndex] : null;
  }

  conditionalShortcutReference({ actor, token, reference, conditionalSource }, config) {
    if (actor !== this.actor || token !== this.token || !config.panels.combat
      || !(game.user.isGM || actor.testUserPermission(game.user, "OWNER"))) return null;
    const origin = this.resolveShortcut(actor, conditionalSource);
    const dependent = this.resolveShortcut(actor, reference);
    const actions = origin?.item?.system?.actions;
    if (!origin?.item || dependent?.item !== origin.item || origin.action.properties?.enabled !== true
      || typeof dependent.action.isVisible !== "function"
      || !Array.isArray(actions) || !this.shortcutDependsOn(dependent.action, actions.indexOf(origin.action))) return null;
    const hasOrigin = Object.entries(config.shortcuts).some(([key, entry]) => !this.handKey(key)
      && this.shortcutReferences(entry).some(saved => saved?.indice === conditionalSource.indice
        && this.resolveShortcut(actor, saved)?.action === origin.action));
    return hasOrigin ? reference : null;
  }

  async executeShortcut(event, context) {
    const automated = typeof context.desiredState === "boolean";
    if (context.actionIndex !== undefined) this.clearShortcutPreview();
    if (event) {
      event.preventDefault(); event.stopPropagation();
      if ((event.button !== undefined && event.button !== 0) || event.detail > 1 || event.repeat
        || this.slotDrag || this.suppressShortcutClick) return false;
    }
    if (this.busyAction || this.changingHands.has(context.actor)) return false;
    const mode = automated || context.equipment ? "use" : event.shiftKey ? "sheet" : event.ctrlKey ? "chat" : event.altKey ? "damage" : "use";
    const warn = key => {
      if (this.shortcutWarning?.key !== key || Date.now() - this.shortcutWarning.time > 1500) {
        ui.notifications.warn(game.i18n.localize(key)); this.shortcutWarning = { key, time: Date.now() };
      }
      return false;
    };
    if (event?.currentTarget?.isConnected === false) return warn("CO2PRISM.Combat.UnavailableSlot");
    this.refreshActor();
    const { actor, token, preset, key, reference, actionIndex } = context;
    const currentReference = config => {
      if (automated) {
        const rule = context.desiredState ? "activate" : "deactivate";
        return actor === this.actor && token === this.token && config.activePreset === preset && this.canConfigure(actor)
          && this.getPresetActionRule(actor, reference, preset, config) === rule ? reference : null;
      }
      if (context.equipment) return this.equipmentOperationItem(context, config) ? reference : null;
      if (context.conditionalSource) return this.conditionalShortcutReference(context, config);
      const current = this.shortcutReferenceAt(config, key, actionIndex);
      if (actor !== this.actor || token !== this.token || (this.handKey(key) && preset !== config.activePreset)
        || !config.panels.combat || !current
        || ["source", "indice", "itemId"].some(field => current[field] !== reference?.[field])
        || !(game.user.isGM || actor?.testUserPermission(game.user, "OWNER"))) return null;
      return current;
    };
    const current = currentReference(this.configuration);
    if (!current) return warn("CO2PRISM.CommandUnavailable");
    const resolved = this.resolveShortcut(actor, current);
    if (!resolved) return warn("CO2PRISM.Combat.UnavailableSlot");
    const { action, item } = resolved;
    if ((context.equipment && action !== context.action)
      || (context.conditionalSource && action !== context.expectedAction)) return warn("CO2PRISM.CommandUnavailable");
    if (this.handKey(key) && ["use", "damage"].includes(mode) && !this.encounterHandAttack(actor, current) && !item?.system.equipped) {
      return warn("CO2PRISM.Combat.HandUnequipped");
    }
    // Les API macros CO2 installées ciblent un Item, jamais un faux support acteur.
    if (!item && (mode !== "sheet" || current.source !== actor.uuid || typeof actor.sheet?.render !== "function")) {
      return warn("CO2PRISM.Combat.ActorActionUnsupported");
    }
    if (item && actor.items?.get(item.id) !== item) return warn("CO2PRISM.Combat.UnavailableSlot");
    const api = game.system?.api?.macros;
    const toggle = mode === "use" && this.shortcutCanToggle(action);
    if (automated && (!toggle || this.shortcutActive(action) === context.desiredState)) return false;
    if (toggle && typeof actor.activateAction !== "function") return warn("CO2PRISM.Combat.UnavailableSlot");
    if (item && !toggle && typeof api?.[mode === "sheet" ? "openSheet" : mode === "chat" ? "sendToChat" : "useAction"] !== "function") {
      return warn("CO2PRISM.Combat.UnavailableSlot");
    }
    this.busyAction = "shortcut";
    this.updateActions();
    let beforeActivation, afterActivation;
    const checkVisibility = async () => {
      const cache = this.actionVisibilityCache();
      try {
        const visible = await this.nativeShortcutVisibility(action, item, actor);
        if (this.shortcutVisibilityCache === cache) {
          const previous = cache.results.get(`${item?.id ?? actor.uuid}:${action.indice}`);
          if (previous !== undefined && previous !== visible) this.invalidateShortcutVisibility();
          return visible;
        }
      } catch {
        if (this.shortcutVisibilityCache === cache) this.invalidateShortcutVisibility();
      }
      return undefined;
    };
    try {
      if (context.conditionalSource || ["use", "damage"].includes(mode)) {
        const visible = await checkVisibility();
        if (!visible) return warn(visible === false ? "CO2PRISM.Combat.ConditionsUnavailable" : "CO2PRISM.Combat.ConditionsUnknown");
      }
      // Une condition asynchrone ne doit pas poursuivre une commande sur une ancienne sélection.
      const stillAvailable = () => this.resolveShortcut(actor, currentReference(this.readConfiguration(actor)))?.action === action;
      if (!stillAvailable()) return warn("CO2PRISM.CommandUnavailable");
      if (automated && this.shortcutActive(action) === context.desiredState) return false;
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
        return stillAvailable()
          && (!item || actor.items?.get(item.id) === item)
          && [action.properties?.activable, action.properties?.temporary, action.properties?.enabled].every((value, index) => value === activationState[index])
          && action.actionTypeFinal === time && (mode === "damage" || deactivating
            || (!(toggle && action.properties.enabled === true) && this.shortcutUses(action, item)?.value !== 0));
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
          const visible = await checkVisibility();
          if (!visible) return warn(visible === false ? "CO2PRISM.Combat.ConditionsUnavailable" : "CO2PRISM.Combat.ConditionsUnknown");
          if (!ready()) return warn("CO2PRISM.CommandUnavailable");
          forced = economyEnabled() && !economy.getSnapshot().canSpend[time];
        }
      }
      let confirmed = false, rejected = false, starts = 0, ambiguous = false, expectedType;
      if (charged || automated || (context.conditionalSource && ["use", "damage"].includes(mode))) {
        const matches = (target, details) => target === actor && details.item === item
          && details.indice === indice && details.state === !deactivating && details.type === expectedType;
        beforeActivation = (target, details) => {
          if (!matches(target, details)) return;
          if (++starts > 1) ambiguous = true;
          details.guard((async () => {
            const visible = await checkVisibility();
            if (!visible) {
              rejected = visible === false ? "CO2PRISM.Combat.ConditionsUnavailable" : "CO2PRISM.Combat.ConditionsUnknown";
              return false;
            }
            if (!ready()) { rejected = "CO2PRISM.CommandUnavailable"; return false; }
            if (charged && economyEnabled() && !forced && !economy.getSnapshot().canSpend[time]) {
              rejected = "CO2PRISM.Combat.NoActionTime"; return false;
            }
            if (charged && forced && economy.getSnapshot().canSpend[time]) forced = false;
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
          if (context.conditionalSource) expectedType = "damage";
          await api.useAction(source, indice, "damage");
        } else if (toggle) {
          // Comme la feuille CO2 : pas de type attaque/dommages pour une bascule temporaire.
          nativeResult = await actor.activateAction({ state: automated ? context.desiredState : !action.properties.enabled,
            source, indice, type: undefined });
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
    const reference = current.slots[context.key];
    return !context.cancelled && context.actor === this.actor && context.token === this.token
      && (!this.handKey(context.key) || context.preset === current.activePreset) && current.panels.combat
      && !game.settings.get(MODULE, "locked") && this.canConfigure(context.actor)
      && reference && ["kind", "source", "indice", "itemId", "row", "order"].every(key => reference[key] === context.reference?.[key])
      && (this.handKey(context.key) || JSON.stringify(reference.actions) === JSON.stringify(context.reference?.actions));
  }

  manageShortcut(context, target) {
    this.refreshActor();
    if (!this.validShortcutContext(context) || (target && (target.hand || ["left-hand", "right-hand"].includes(context.key)))) return Promise.resolve(false);
    return this.queueConfiguration(context.actor, async () => {
      this.refreshActor();
      if (!this.validShortcutContext(context)) return false;
      const config = this.readConfiguration(context.actor);
      if (this.handKey(context.key)) return this.updateHands(context.actor, config, context.preset, context.key, null);
      const slots = config.shortcuts;
      const rows = this.slotRows(context.actor).map(row => row.filter(slot => !slot.hand && !slot.terminal));
      const references = this.shortcutReferences(slots[context.key]);
      if (context.actionIndex !== undefined) {
        const index = context.actionIndex;
        const destination = target?.actionIndex;
        if (!Number.isInteger(index) || index < 0 || index >= references.length
          || (target && (target.key !== context.key || !Number.isInteger(destination)
            || destination < 0 || destination >= references.length || destination === index))) return false;
        const updated = [...references];
        const [reference] = updated.splice(index, 1);
        if (target) updated.splice(destination, 0, reference);
        if (updated.length) {
          await context.actor.setFlag(MODULE, `shortcuts.${context.key}`, this.shortcutEntry(slots[context.key], updated));
          return true;
        }
      } else if (!target && references.length > 1) return false;
      if (target) {
        if (![1, 2, 3].includes(target.row)) return false;
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
      await context.actor.setFlag(MODULE, "shortcuts", slots);
      return true;
    });
  }

  async dropSlot(event, slot, node) {
    event.preventDefault(); event.stopPropagation();
    node.classList.remove("co2prism-drop-target", "co2prism-drop-candidate", "co2prism-drop-insert");
    const context = this.slotDrag ?? { actor: this.actor, token: this.token, preset: this.configuration.activePreset };
    this.slotDrag = null;
    this.refreshActor();
    if (context.internal) return this.manageShortcut(context, { ...slot, actionIndex: this.shortcutActionIndex(event, slot) });
    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { /* Dépôt non CO2. */ }
    if (game.settings.get(MODULE, "locked") || context.cancelled || context.actor !== this.actor || context.token !== this.token
      || (slot.hand && context.preset !== this.configuration.activePreset) || !this.configuration.panels.combat || !this.canConfigure(context.actor)) {
      ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.InvalidDrop")); return false;
    }
    const reference = this.slotReferenceFromDrop(context.actor, data, slot);
    if (!reference) { ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.InvalidDrop")); return false; }
    const saved = await this.saveShortcut(context.actor, context.preset, slot, reference);
    if (saved && slot.terminal && this.actor === context.actor) {
      const row = this.combatRows?.[slot.row - 1];
      if (row) row.scrollLeft = row.scrollWidth > row.clientWidth ? row.scrollWidth : 0;
    }
    return saved;
  }

  saveShortcut(actor, preset, slot, reference) {
    if (game.settings.get(MODULE, "locked") || !this.canConfigure(actor) || ![1, 2, 3].includes(slot?.row)
      || (slot.key && (!/^[A-Za-z0-9_-]+$/.test(slot.key) || ["__proto__", "constructor", "prototype"].includes(slot.key)))) {
      ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.InvalidDrop")); return Promise.resolve(false);
    }
    const token = this.token;
    return this.queueConfiguration(actor, async () => {
      const resolved = slot.hand ? this.handItem(actor, reference) ?? this.encounterHandAttack(actor, reference) : this.resolveShortcut(actor, reference);
      if (game.settings.get(MODULE, "locked") || this.actor !== actor || this.token !== token || !this.canConfigure(actor) || !resolved) {
        ui.notifications.warn(game.i18n.localize("CO2PRISM.Combat.InvalidDrop")); return false;
      }
      if (slot.hand) {
        const config = this.readConfiguration(actor);
        if (config.activePreset !== preset || !["left", "right"].includes(slot.hand)) return false;
        return this.updateHands(actor, config, preset, slot.hand + "-hand", reference);
      }
      const rows = this.slotRows(actor);
      const terminal = rows[slot.row - 1].at(-1);
      const key = slot.key ?? `slot-${foundry.utils.randomID()}`;
      const existing = this.readConfiguration(actor).shortcuts[key];
      const references = this.shortcutReferences(existing).filter(entry => entry && typeof entry === "object");
      if (references.length >= MAX_SHORTCUT_ACTIONS || references.some(entry => this.sameShortcutReference(entry, reference))) {
        const reason = references.length >= MAX_SHORTCUT_ACTIONS ? "ShortcutGroupFull" : "ShortcutGroupDuplicate";
        ui.notifications.warn(game.i18n.localize(`CO2PRISM.Combat.${reason}`));
        return false;
      }
      const value = references.length ? this.shortcutEntry(existing, [...references, reference])
        : { ...reference, row: slot.row, order: slot.terminal ? terminal.order : slot.order };
      await actor.setFlag(MODULE, `shortcuts.${key}`, value);
      return true;
    });
  }

  readConfiguration(actor = this.actor) {
    const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
    // getFlag de Foundry attend un objet dans l'espace de noms.
    const read = key => isObject(actor?.flags?.[MODULE]) ? actor.getFlag?.(MODULE, key) : undefined;
    const active = read("hands.active");
    const activePreset = [1, 2, 3].includes(active) ? active : 1;
    const panels = read("panels");
    const equipmentCollapsed = read("equipmentCollapsed");
    const pathCollapsed = read("pathCollapsed");
    const hiddenEquipment = read("hiddenEquipment");
    const presets = read("hands.presets");
    const storedShortcuts = read("shortcuts");
    const presetActionRules = read("presetActionRules");
    const shortcuts = isObject(storedShortcuts) ? foundry.utils.deepClone(storedShortcuts) : {};
    const handPresets = Object.fromEntries([1, 2, 3].map(number => [number,
      isObject(presets?.[number]) ? foundry.utils.deepClone(presets[number]) : {}]));
    const panelStates = Object.fromEntries(PANELS.map(key => [key, isObject(panels) && panels[key] === true]));
    if (panelStates.voies) panelStates.equipements = false;
    return {
      activePreset, shortcuts, handPresets, presetActionRules: isObject(presetActionRules) ? presetActionRules : {},
      slots: { ...shortcuts, ...handPresets[activePreset] },
      equipmentCollapsed: Object.fromEntries(EQUIPMENT_GROUPS.map(([key]) =>
        [key, isObject(equipmentCollapsed) && equipmentCollapsed[key] === true])),
      hiddenEquipment: new Set(isObject(hiddenEquipment)
        ? Object.keys(hiddenEquipment).filter(id => hiddenEquipment[id] === true) : []),
      pathCollapsed: new Set(isObject(pathCollapsed)
        ? Object.keys(pathCollapsed).filter(id => pathCollapsed[id] === true) : []),
      panels: panelStates
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
      const hands = this.configuration.handPresets[number];
      button.hidden = game.settings.get(MODULE, "locked") && !hands["left-hand"] && !hands["right-hand"];
      button.disabled = !this.canConfigure();
      button.setAttribute("aria-disabled", String(button.disabled));
      button.setAttribute("aria-pressed", String(active));
      const label = `${game.i18n.localize("CO2PRISM.Preset")} ${number}`;
      button.setAttribute("aria-label", label);
      button.dataset.co2prismTooltipText = button.disabled ? `${label} — ${game.i18n.localize("CO2PRISM.ConfigUnavailable")}` : label;
    }
  }

  setActivePreset(number, bypassChecks = false) {
    this.refreshActor();
    const { actor, token } = this;
    if (![1, 2, 3].includes(number) || !this.canConfigure(actor)) return Promise.resolve(false);
    return this.queueConfiguration(actor, async () => {
      if (this.actor !== actor || this.token !== token || !this.canConfigure(actor)) return false;
      const current = this.readConfiguration(actor);
      if (number === current.activePreset) return true;
      if (!await this.updateHands(actor, current, number, undefined, undefined, bypassChecks === true)) return false;
      const incoming = this.readConfiguration(actor);
      if (incoming.activePreset !== number) return false;
      for (const key of Object.keys(incoming.presetActionRules).sort()) {
        if (this.actor !== actor || this.token !== token || !this.canConfigure(actor)) break;
        const [, itemId, rawIndex] = /^([A-Za-z0-9_-]+):(0|[1-9]\d*)$/.exec(key) ?? [];
        const item = actor.items?.get(itemId);
        if (!item) continue;
        const reference = { itemId, source: item.uuid, indice: Number(rawIndex) };
        const rule = this.getPresetActionRule(actor, reference, number, this.readConfiguration(actor));
        if (rule === "unchanged") continue;
        const desiredState = rule === "activate";
        const action = this.resolveShortcut(actor, reference)?.action;
        if (!action || this.shortcutActive(action) === desiredState) continue;
        await this.executeShortcut(null, { actor, token, preset: number, reference, desiredState });
      }
      return true;
    });
  }

  setPanelState(panel, open) {
    if (!PANELS.includes(panel) || typeof open !== "boolean") {
      return Promise.resolve(false);
    }
    return this.writeConfiguration(`panels.${panel}`, open);
  }

  writeConfiguration(path, value) {
    if (typeof path !== "string") return Promise.resolve(false);
    const [group, key, extra] = path.split(".");
    const panel = group === "panels" && PANELS.includes(key);
    const category = group === "equipmentCollapsed" && EQUIPMENT_GROUPS.some(([id]) => id === key);
    const toggle = typeof value === "function";
    const allCategories = path === "equipmentCollapsed" && toggle;
    if (extra !== undefined || !(panel || category || allCategories) || !(toggle || typeof value === "boolean")) {
      return Promise.resolve(false);
    }
    this.refreshActor();
    const actor = this.actor;
    if (!this.canConfigure(actor)) return Promise.resolve(false);
    // Capturer l'acteur du clic ; une autre sélection ne doit jamais recevoir cette écriture.
    return this.queueConfiguration(actor, async () => {
      if (!this.canConfigure(actor)) return false;
      const config = this.readConfiguration(actor);
      if (allCategories) {
        const next = value(config.equipmentCollapsed);
        if (typeof next !== "boolean") return false;
        await actor.setFlag(MODULE, path, Object.fromEntries(EQUIPMENT_GROUPS.map(([id]) => [id, next])));
        return true;
      }
      const previous = config[group][key];
      const next = toggle ? value(previous) : value;
      if (toggle && typeof next !== "boolean") return false;
      if (previous === next) return false;
      const other = panel && EXCLUSIVE_PANELS[key];
      if (other && actor.getFlag(MODULE, `panels.${other}`) === true) {
        await actor.setFlag(MODULE, "panels", { ...actor.getFlag(MODULE, "panels"), [key]: next, [other]: false });
        return true;
      }
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
    if (this.budgetBar) {
      const state = new ActionEconomy(this.actor).getSnapshot();
      this.updateEconomyCommands(state);
      this.updateDefenseButtons(state);
    }
    for (const node of this.combatSlots?.querySelectorAll(".co2prism-slot-executable") ?? []) {
      const disabled = Boolean(this.busyAction) || !this.actor
        || !(game.user.isGM || this.actor.testUserPermission(game.user, "OWNER"));
      node.setAttribute("aria-disabled", String(disabled));
      node.tabIndex = disabled ? -1 : 0;
    }
    for (const { key, button } of this.skillNodes ?? []) {
      button.disabled = !this.canUseAction(`skill:${key}`);
    }
    for (const button of this.actions) {
      const action = button.dataset.co2prismAction;
      const isRest = action === "fastRest" || action === "fullRest";
      const disableWhileBusy = action !== "fortune" && !isRest;
      button.disabled = (disableWhileBusy && Boolean(this.busyAction)) || !this.canUseAction(action);
      button.setAttribute("aria-disabled", String(button.disabled));
      const missingRest = isRest && !this.getRest(action);
      const label = game.i18n.localize(`CO2PRISM.Actions.${action}`);
      button.setAttribute("aria-label", label);
      button.dataset.co2prismTooltipText = missingRest ? game.i18n.localize("CO2PRISM.RestUnavailable")
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

  savedWidth() {
    const width = game.settings.get(MODULE, "sizeWidth");
    if (Number.isFinite(width) && width >= WIDTHS.S && width <= WIDTHS.XL) return width;
    const legacy = game.settings.get(MODULE, "size");
    return Object.hasOwn(WIDTHS, legacy) ? WIDTHS[legacy] : WIDTHS.M;
  }

  async toggleLock() {
    if (this.lockChangePending) return;
    this.lockChangePending = true;
    this.sizeSlider.disabled = true;
    const locked = game.settings.get(MODULE, "locked");
    const previousWidth = game.settings.get(MODULE, "sizeWidth");
    const width = this.previewWidth;
    let saved = false;
    try {
      if (!locked && width !== undefined && width !== this.savedWidth()) {
        await game.settings.set(MODULE, "sizeWidth", width);
        saved = true;
      }
      await game.settings.set(MODULE, "locked", !locked);
    } catch (error) {
      if (saved) {
        try { await game.settings.set(MODULE, "sizeWidth", previousWidth); }
        catch (restoreError) { console.error("co2prism | Restauration de la taille", restoreError); }
      }
      console.error("co2prism | Verrouillage de Prism", error);
      ui.notifications.error(game.i18n.localize("CO2PRISM.ConfigError"));
    } finally {
      this.lockChangePending = false;
      this.sizeSlider.disabled = game.settings.get(MODULE, "locked");
    }
  }

  updateLock() {
    const locked = game.settings.get(MODULE, "locked");
    if (locked) this.previewWidth = undefined;
    const sliderChanged = this.sizeSlider && this.sizeSlider.hidden !== locked;
    if (this.sizeSlider) {
      this.sizeSlider.hidden = locked;
      this.sizeSlider.disabled = locked || Boolean(this.lockChangePending);
    }
    this.endDrag();
    this.handle.classList.toggle("co2prism-draggable", !locked);
    this.handle.dataset.co2prismTooltipText = game.i18n.localize(locked ? "CO2PRISM.Locked" : "CO2PRISM.Move");
    this.lock.setAttribute("aria-pressed", String(locked));
    const label = game.i18n.localize(locked ? "CO2PRISM.Unlock" : "CO2PRISM.Lock");
    this.lock.dataset.co2prismTooltipText = label;
    this.lock.setAttribute("aria-label", label);
    if (this.slotDrag) this.slotDrag.cancelled = true;
    if (this.actor && this.combatRows) this.refreshActor();
    if (sliderChanged) this.layout({ preserveAnchor: true, persistPosition: false });
  }

  layout({ preserveAnchor = false, persistPosition = true } = {}) {
    if (!this.element || this.element.hidden) return;
    const previous = this.element.getBoundingClientRect();
    const offset = this.panelOffset ?? { x: 0, y: 0 };
    const saved = this.position;
    const valid = Number.isFinite(saved?.x) && Number.isFinite(saved?.y);
    const width = this.previewWidth ?? this.savedWidth();
    if (this.sizeSlider && Number(this.sizeSlider.value) !== width) this.sizeSlider.value = width;
    const nominal = width / 724;
    const unit = Math.max(0.01, Math.min(nominal, (window.innerWidth - 8) / 1060, (window.innerHeight - 8) / 530));
    const scaleChanged = unit !== this.presentationScale;
    if (scaleChanged) {
      this.presentationScale = unit;
      this.element.style.setProperty("--co2prism-unit", unit + "px");
    }
    const bounds = scaleChanged ? this.element.getBoundingClientRect() : previous;
    const portrait = this.anchor.getBoundingClientRect();
    this.panelOffset = { x: portrait.left - bounds.left, y: portrait.top - bounds.top };
    const extent = [bounds.width, bounds.height, this.panelOffset.x, this.panelOffset.y, window.innerWidth, window.innerHeight, this.conditionalZone?.firstElementChild?.offsetHeight ?? 0];
    if (preserveAnchor && !scaleChanged && this.presentationExtent?.every((value, index) => Math.abs(value - extent[index]) < .01)) return;
    this.presentationExtent = extent;
    const x = preserveAnchor ? previous.left + offset.x : valid ? saved.x : 40 + this.panelOffset.x;
    const y = preserveAnchor ? previous.top + offset.y : valid ? saved.y
      : window.innerHeight - bounds.height - 40 + this.panelOffset.y;
    const placed = this.place(x - this.panelOffset.x, y - this.panelOffset.y, true, bounds);
    if (persistPosition && this.previewWidth === undefined && (valid || preserveAnchor) &&
      (Math.abs(placed.left + this.panelOffset.x - x) > 0.5
      || Math.abs(placed.top + this.panelOffset.y - y) > 0.5)) {
      this.position = { x: placed.left + this.panelOffset.x, y: placed.top + this.panelOffset.y };
      void game.settings.set(MODULE, "position", this.position);
    }
  }

  place(x, y, clamp = true, bounds = this.element.getBoundingClientRect()) {
    const left = clamp ? Math.max(0, Math.min(x, window.innerWidth - bounds.width)) : x;
    this.element.style.left = `${left}px`;
    this.element.style.setProperty("--prism-upper-right", `${window.innerWidth - left - (this.panelOffset?.x ?? 0) - 8}px`);
    const offsetY = this.panelOffset?.y ?? 0;
    const zone = this.conditionalZone;
    const row = zone?.firstElementChild;
    const clearance = row && zone.offsetParent ? parseFloat(getComputedStyle(zone).bottom) - zone.offsetParent.offsetHeight : 0;
    const topLimit = Math.max(0, (row?.offsetHeight ?? 0) + clearance - offsetY);
    const top = clamp ? Math.max(0, Math.min(Math.max(y, topLimit), window.innerHeight - bounds.height)) : y;
    this.element.style.top = `${top}px`;
    if (this.conditionalZone) {
      const above = top + (this.panelOffset?.y ?? 0);
      this.conditionalZone.style.setProperty("--conditional-room", `${above}px`);
    }
    return { left, top };
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
    this.portraitMoved = true;
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

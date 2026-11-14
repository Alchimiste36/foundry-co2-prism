const MODULE = "co2prism";
const WIDTHS = { S: 300, M: 430, L: 600, XL: 780 };
const ABILITIES = ["for", "agi", "con", "cha", "int", "vol", "per"];
let bar;

Hooks.once("init", () => {
  if (game.system.id !== "co2") return;
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
    // L'instance vit avec le monde ; ces hooks ne sont installés qu'au premier rendu.
    Hooks.on("controlToken", () => this.refreshActor());
    Hooks.on("canvasReady", () => this.refreshActor());
    Hooks.on("canvasTearDown", () => this.refreshActor(false));
    Hooks.on("updateScene", (scene, changed) => {
      if (scene === globalThis.canvas?.scene && Object.keys(changed).some(key => key === "grid" || key.startsWith("grid."))) {
        this.refreshActor();
      }
    });
    Hooks.on("updateActor", (actor, changed) => {
      const relevant = Object.keys(changed).some(key => ["system", "img", "name", "ownership", "flags"].includes(key)
        || key.startsWith("system.") || key.startsWith("ownership.")
        || key === "flags.co2prism" || key === "flags.-=co2prism" || key.startsWith("flags.co2prism."));
      if (relevant && this.concernsActor(actor)) this.refreshActor();
    });
    Hooks.on("deleteActor", actor => {
      if (this.concernsActor(actor)) this.refreshActor(false);
    });
    Hooks.on("updateToken", (token, changed) => {
      const relevant = Object.keys(changed).some(key => ["actorId", "actorLink", "delta"].includes(key)
        || key.startsWith("delta."));
      if (relevant && token === this.token?.document) this.refreshActor();
    });
    Hooks.on("deleteToken", token => {
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
    this.updatePresets();
    const skillsChanged = this.updateSkills();
    const combatChanged = this.updateCombat();
    if (skillsChanged || combatChanged) this.layout({ preserveAnchor: true });
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
        // Le template reste détaché : aucun HTML de description n'est affiché ni exécuté.
        const plain = text => {
          const template = document.createElement("template");
          template.innerHTML = typeof text === "string" ? text : "";
          template.content.querySelectorAll("script, style").forEach(node => node.remove());
          return template.content.textContent.replace(/\s+/g, " ").trim();
        };
        const number = Number.isFinite(bonus?.value) ? `${bonus.value >= 0 ? "+" : ""}${bonus.value}` : unavailable;
        return [plain(bonus?.name), number, plain(bonus?.description), plain(bonus?.additionalInfos)].filter(Boolean).join(" — ");
      });
      button.title = `${label} : ${value.textContent}\n${game.i18n.localize("CO2PRISM.SkillBonuses")} ${count.textContent}`
        + (lines?.length ? `\n${lines.join("\n")}` : "");
      button.setAttribute("aria-label", button.title);
      button.disabled = Boolean(this.busyAction) || !this.canUseAction(`skill:${key}`);
    }
    return changed;
  }

  readCombatData(actor = this.actor) {
    const movement = actor?.system?.attributes?.movement;
    const unitFactor = unit => {
      const name = typeof unit === "string" ? unit.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
      if (["m", "metre", "metres", "meter", "meters"].includes(name)) return 1;
      if (["ft", "foot", "feet", "pied", "pieds"].includes(name)) return 0.3048;
      return null;
    };
    const factor = unitFactor(movement?.unit);
    const meters = Number.isFinite(movement?.value) && movement.value >= 0 && factor !== null ? movement.value * factor : null;
    const grid = globalThis.canvas?.ready ? canvas.scene?.grid : null;
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
    for (const [key, value] of Object.entries(this.readCombatData())) {
      const node = this.combatValues[key];
      node.textContent = value === null || !Number.isFinite(value) ? unavailable : String(Math.round(value * 100) / 100);
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
    // Le format de référence des raccourcis n'est pas encore défini : aucun mapping inventé.
    const slots = this.configuration.presets[this.configuration.activePreset].slots;
    const count = Object.keys(slots).length;
    this.combatSlots.dataset.co2prismStoredSlots = String(count);
    this.combatSlots.title = count ? game.i18n.localize("CO2PRISM.Combat.UnresolvedSlots") : "";
    return changed;
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
    this.configWrites ??= new WeakMap();
    // Capturer l'acteur du clic ; une autre sélection ne doit jamais recevoir cette écriture.
    const pending = (this.configWrites.get(actor) ?? Promise.resolve()).then(async () => {
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
    }).catch(error => {
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
  }

  layout({ preserveAnchor = false } = {}) {
    if (!this.element) return;
    this.endDrag();
    const previous = this.element.getBoundingClientRect();
    const anchor = { x: previous.left + (this.panelOffset?.x ?? 0), y: previous.top + (this.panelOffset?.y ?? 0) };
    // Le même dessin conserve ses proportions, même dans une petite fenêtre.
    const width = Math.max(1, Math.min(WIDTHS[game.settings.get(MODULE, "size")] ?? WIDTHS.M,
      window.innerWidth - 8, (window.innerHeight - 8) * 724 / 515));
    // Borner explicitement la racine à la barre, sans surface plein écran.
    const open = Boolean(this.actor && this.configuration?.panels.competences);
    const combat = Boolean(this.actor && this.configuration?.panels.combat);
    this.panelOffset = { x: width * (open ? 168 : combat ? 122 : 0) / 724, y: open ? width * 237 / 724 : 0 };
    this.element.style.setProperty("--co2prism-base-width", `${width}px`);
    this.element.style.setProperty("--co2prism-base-height", `${width * 515 / 724}px`);
    this.element.style.setProperty("--co2prism-offset-x", `${this.panelOffset.x}px`);
    this.element.style.setProperty("--co2prism-offset-y", `${this.panelOffset.y}px`);
    this.element.style.width = `${width * (combat ? 1677 : 724) / 724 + this.panelOffset.x}px`;
    this.element.style.height = `${width * 515 / 724 + this.panelOffset.y}px`;
    const saved = this.position;
    const valid = Number.isFinite(saved?.x) && Number.isFinite(saved?.y);
    const x = preserveAnchor ? anchor.x : valid ? saved.x : 40;
    const y = preserveAnchor ? anchor.y : valid ? saved.y : window.innerHeight - width * 515 / 724 - 40;
    this.place(x - this.panelOffset.x, y - this.panelOffset.y, !preserveAnchor);
    // Mémoriser aussi le retour à l'écran après un changement de taille.
    const placed = this.element.getBoundingClientRect();
    if (!preserveAnchor && valid && (Math.abs(placed.left + this.panelOffset.x - saved.x) > 0.5
      || Math.abs(placed.top + this.panelOffset.y - saved.y) > 0.5)) {
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

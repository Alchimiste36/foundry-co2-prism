const MODULE = "co2prism";
const WIDTHS = { S: 300, M: 430, L: 600, XL: 780 };
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
    this.handle = this.element.querySelector(".co2prism-handle");
    this.lock = this.element.querySelector(".co2prism-lock");
    this.art = this.element.querySelector(".co2prism-art");
    this.portrait = this.element.querySelector(".co2prism-portrait");
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
    this.handle.addEventListener("pointerup", () => this.endDrag());
    this.handle.addEventListener("pointercancel", () => this.endDrag());
    this.handle.addEventListener("lostpointercapture", () => this.endDrag());
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
    Hooks.on("updateActor", (actor, changed) => {
      const relevant = Object.keys(changed).some(key => ["system", "img", "name", "ownership"].includes(key)
        || key.startsWith("system.") || key.startsWith("ownership."));
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
    const unavailable = game.i18n.localize("CO2PRISM.Unavailable");
    const summaries = [];
    for (const [key, nodes] of Object.entries(this.gauges)) {
      const resource = key === "hp" ? actor?.system?.attributes?.hp : actor?.system?.resources?.[key];
      const current = Number.isFinite(resource?.value) ? resource.value : null;
      const maximum = Number.isFinite(resource?.max) && resource.max > 0 ? resource.max : null;
      const text = current === null && maximum === null ? unavailable
        : `${current ?? unavailable} / ${maximum ?? unavailable}`;
      const fill = current !== null && maximum !== null
        ? Math.max(0, Math.min(100, current / maximum * 100)) : 0;
      if (nodes.text.textContent !== text) nodes.text.textContent = text;
      nodes.fill.style.setProperty("--fill", `${fill}%`);
      // Réduire seulement les longues valeurs pour les garder dans leur zone.
      const width = key === "hp" || key === "mana" ? 100 : 80;
      nodes.text.style.setProperty("--text-size", Math.min(40, width / (text.length * 0.58)));
      const label = `${game.i18n.localize(`CO2PRISM.Gauges.${key}`)} : ${text}`;
      nodes.fill.title = label;
      summaries.push(label);
    }
    const portrait = actor?.img || "icons/svg/mystery-man.svg";
    if (this.portrait.getAttribute("src") !== portrait) this.portrait.setAttribute("src", portrait);
    this.art.setAttribute("aria-label", actor ? `${actor.name}. ${summaries.join(". ")}`
      : game.i18n.localize("CO2PRISM.NoActor"));
  }

  updateLock() {
    const locked = game.settings.get(MODULE, "locked");
    this.endDrag();
    this.handle.disabled = locked;
    this.lock.setAttribute("aria-pressed", String(locked));
    const label = game.i18n.localize(locked ? "CO2PRISM.Unlock" : "CO2PRISM.Lock");
    this.lock.title = label;
    this.lock.setAttribute("aria-label", label);
    this.lock.innerHTML = `<i class="fa-solid fa-lock${locked ? "" : "-open"}" aria-hidden="true"></i>`;
  }

  layout() {
    if (!this.element) return;
    this.endDrag();
    // Le même dessin conserve ses proportions, même dans une petite fenêtre.
    const width = Math.max(1, Math.min(WIDTHS[game.settings.get(MODULE, "size")] ?? WIDTHS.M,
      window.innerWidth - 8, (window.innerHeight - 8) * 865 / 540));
    // Borner explicitement la racine à la barre, sans surface plein écran.
    this.element.style.width = `${width}px`;
    this.element.style.height = `${width * 540 / 865}px`;
    const bounds = this.element.getBoundingClientRect();
    const saved = this.position;
    const valid = Number.isFinite(saved?.x) && Number.isFinite(saved?.y);
    this.place(valid ? saved.x : 40, valid ? saved.y : window.innerHeight - bounds.height - 40);
  }

  place(x, y) {
    const bounds = this.element.getBoundingClientRect();
    this.element.style.left = `${Math.max(0, Math.min(x, window.innerWidth - bounds.width))}px`;
    this.element.style.top = `${Math.max(0, Math.min(y, window.innerHeight - bounds.height))}px`;
  }

  startDrag(event) {
    if (event.button !== 0 || game.settings.get(MODULE, "locked")) return;
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

  endDrag() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (this.handle.hasPointerCapture(drag.id)) this.handle.releasePointerCapture(drag.id);
    if (!drag.moved) return;
    const bounds = this.element.getBoundingClientRect();
    this.position = { x: bounds.left, y: bounds.top };
    void game.settings.set(MODULE, "position", this.position);
  }
}

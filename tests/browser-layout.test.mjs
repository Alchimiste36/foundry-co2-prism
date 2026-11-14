import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const edge = process.env.CO2PRISM_EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const foundryCSS = process.env.CO2PRISM_FOUNDRY_CSS ?? "F:/FVTT_V14/public/css/foundry2.css";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("boîtes et zones de capture dans Edge avec le CSS Foundry", {
  skip: !existsSync(edge) || !existsSync(foundryCSS), timeout: 30000
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "co2prism-browser-"));
  try {
    const translations = JSON.parse(read("../lang/fr.json"));
    const markup = read("../templates/bar.hbs").replace(/\{\{localize '([^']+)'\}\}/g,
      (_match, key) => key.split(".").reduce((value, part) => value?.[part], translations) ?? key);
    // Un board natif reste derrière Prism ; aucune instance de monde n'est modifiée.
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="${pathToFileURL(foundryCSS).href}">
      <link rel="stylesheet" href="${new URL("../fonts/fontawesome/css/all.min.css", pathToFileURL(foundryCSS)).href}">
      <style>${read("../css/co2prism.css")}</style></head>
      <body class="vtt game"><canvas id="board" aria-label="Canvas Board"></canvas><script>
      const ready = [];
      const Hooks = { once(name, fn) { if (name === "ready") ready.push(fn); }, on() {} };
      const settings = { size: "M", position: {}, locked: true };
      const canvas = globalThis.canvas = { ready: true, tokens: { controlled: [] } };
      const game = { system: { id: "co2" }, user: {},
        settings: { get: (_, key) => settings[key], set: (_, key, value) => settings[key] = value },
        i18n: { localize: key => key } };
      const foundry = { utils: { deepClone: structuredClone },
        applications: { handlebars: { renderTemplate: async () => ${JSON.stringify(markup)} } } };
      ${read("../module/applications/_module.mjs")}
      (async () => {
        const result = { dimensions: [], errors: [] };
        const check = (condition, message) => { if (!condition) result.errors.push(message); };
        try {
          await ready[0]();
          const root = document.getElementById("co2prism-bar");
          check(root.parentElement === document.body, "Parent autre que body");
          check(document.querySelectorAll("#co2prism-bar").length === 1, "Plusieurs barres");
          check(root.querySelectorAll("canvas").length === 0, "Canvas ajouté par Prism");
          check(bar.actions.every(button => button.disabled), "Commandes actives sans acteur");
          const calls = [];
          const actor = { name: "Acteur de test", type: "character", img: "", testUserPermission: () => true,
            flags: {}, getFlag(scope, key) { return key.split(".").reduce((value, part) => value?.[part], this.flags[scope]); },
            async setFlag(scope, key, value) {
              this.flags[scope] ??= {}; let target = this.flags[scope]; const parts = key.split(".");
              for (const part of parts.slice(0, -1)) target = target[part] ??= {};
              target[parts.at(-1)] = value;
            },
            getSkillBonuses: key => key === "for" ? [{ name: "Métier", value: 3,
              description: '<b>Escalade</b><img src="invalid" onerror="globalThis.co2prismInjected=true">',
              additionalInfos: "En montagne" }, { name: "Bonus général", value: 1 }] : [],
            rollSkill: (key, options) => { check(options.withDialog === true, "Dialogue natif absent"); calls.push("skill:" + key); },
            sheet: { render: () => calls.push("sheet") }, update: async () => {},
            appliedEffects: [{ name: "Native effect", img: "file:///F:/FVTT_V14/public/icons/svg/shield.svg", statuses: new Set() }],
            system: { combat: { def: { value: 15 }, dr: { value: 4 } },
              abilities: Object.fromEntries(["for", "agi", "con", "cha", "int", "vol", "per"].map((key, index) =>
                [key, { value: [3, -1, 1, 2, 1, 0, 1][index] }])), attributes: { hp: { value: 24, max: 34 } },
              resources: { fortune: { value: 2, max: 4 }, mana: { value: 18, max: 18 }, recovery: { value: 3, max: 3 } },
              rollFortune: () => calls.push("fortune"), useRecovery() {} } };
          game.system.CONST = { restActions: [
            { id: "fastRest", handler: target => { check(target === actor, "Acteur repos"); calls.push("fastRest"); } },
            { id: "fullRest", handler: target => { check(target === actor, "Acteur repos"); calls.push("fullRest"); } }
          ] };
          canvas.tokens.controlled = [{ actor, document: { baseActor: actor } }];
          bar.refreshActor();
          for (const action of ["sheet", "fortune", "fastRest", "fullRest"]) {
            if (bar.lastRest) bar.lastRest.at -= 1000;
            root.querySelector('[data-co2prism-action="' + action + '"]').click();
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          check(calls.join(",") === "sheet,fortune,fastRest,fullRest", "Raccordement des clics");
          root.querySelector('[data-co2prism-preset="2"]').click();
          await bar.configWrites.get(actor);
          check(actor.flags.co2prism.activePreset === 2 && bar.configuration.activePreset === 2,
            "Preset non enregistré au clic");
          check(actor.flags.co2prism.panels.combat === true && !bar.combatPanel.hidden, "Combat non ouvert par le preset");
          root.querySelector('[data-co2prism-preset="2"]').click(); await bar.configWrites.get(actor);
          check(bar.combatPanel.hidden, "Combat non replié par le preset actif");
          for (const [size, width] of Object.entries({ S: 300, M: 430, L: 600, XL: 780 })) {
            settings.size = size; bar.position = {}; bar.layout();
            const r = root.getBoundingClientRect();
            result.dimensions.push({ size, width: r.width, height: r.height });
            check(Math.abs(r.width - width) < 0.1, size + " largeur");
            check(Math.abs(r.height - width * 515 / 724) < 0.1, size + " hauteur");
            check(Math.abs(r.left - 40) < 0.1 && Math.abs(innerHeight - r.bottom - 40) < 0.1, size + " marges");
            for (const [x, y] of [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2],
              [r.left + r.width / 2, r.top - 10], [r.right + 10, r.top + 10], [r.left - 10, r.bottom - 10]]) {
              check(document.elementFromPoint(x, y)?.id === "board", size + " zone transparente bloquée");
            }
            const portrait = bar.portrait.getBoundingClientRect();
            check(document.elementFromPoint(portrait.x + portrait.width / 2, portrait.y + portrait.height / 2) === bar.portrait,
              size + " portrait inaccessible");
            const gear = bar.lock.getBoundingClientRect();
            check(bar.lock.contains(document.elementFromPoint(gear.x + gear.width / 2, gear.y + gear.height / 2)),
              size + " rouage inaccessible");
            for (const button of bar.actions) {
              const b = button.getBoundingClientRect();
              check(!button.disabled, size + " commande inactive avec acteur propriétaire");
              check(button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
                size + " commande inaccessible " + button.dataset.co2prismAction);
              check(Math.abs(b.width - Number(button.style.getPropertyValue("--w")) * r.width / 724) < 0.1,
                size + " boîte du bouton modifiée");
              const style = getComputedStyle(button);
              check(style.backgroundColor === "rgba(0, 0, 0, 0)" && style.borderTopWidth === "0px" && style.opacity === "1",
                size + " décoration de bouton inattendue");
            }
            for (const button of bar.presetButtons) {
              const b = button.getBoundingClientRect();
              check(!button.disabled && button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
                size + " preset inaccessible");
              const active = button.dataset.co2prismPreset === "2";
              check(button.getAttribute("aria-pressed") === String(active), size + " sélection preset");
              check(!active || getComputedStyle(button).boxShadow !== "none", size + " sélection invisible");
              check(Math.abs(b.width - 47 * r.width / 724) < 0.1 && Math.abs(b.height - 47 * r.width / 724) < 0.1,
                size + " géométrie preset modifiée");
            }
            for (const nodes of Object.values(bar.gauges)) {
              const g = nodes.fill.getBoundingClientRect();
              check(document.elementFromPoint(g.right - 2, g.y + g.height / 2) === nodes.fill, size + " jauge inaccessible");
            }
            bar.position = { x: innerWidth + 200, y: innerHeight + 200 }; bar.layout();
            const bounded = root.getBoundingClientRect();
            check(bounded.right <= innerWidth + 0.1 && bounded.bottom <= innerHeight + 0.1, size + " hors écran");
            check(settings.position.x === bounded.left && settings.position.y === bounded.top, size + " correction non sauvegardée");
            bar.position = settings.position; bar.layout();
            check(Math.abs(root.getBoundingClientRect().left - bounded.left) < 0.1, size + " restauration");
          }
          const skillsDimensions = [];
          for (const [size, width] of Object.entries({ S: 300, M: 430, L: 600, XL: 780 })) {
            settings.size = size; bar.position = { x: 300, y: 350 }; bar.layout();
            const portrait = bar.portrait.getBoundingClientRect();
            const font = getComputedStyle(bar.name).fontSize;
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            const opened = bar.portrait.getBoundingClientRect();
            check(Math.abs(opened.x - portrait.x) < 0.1 && Math.abs(opened.y - portrait.y) < 0.1,
              size + " portrait déplacé à l'ouverture");
            check(getComputedStyle(bar.name).fontSize === font, size + " échelle de base modifiée");
            check(!bar.skillsPanel.hidden && actor.flags.co2prism.panels.competences, size + " ouverture non persistée");
            const r = root.getBoundingClientRect();
            skillsDimensions.push({ size, width: r.width, height: r.height });
            check(Math.abs(r.width - width * 892 / 724) < 0.1 && Math.abs(r.height - width * 752 / 724) < 0.1,
              size + " dimensions volet");
            check(document.elementFromPoint(r.x + 1, r.y + 1)?.id === "board", size + " coin transparent volet");
            check(document.elementFromPoint(r.x + 1, r.bottom - 10)?.id === "board", size + " sous le volet");
            for (const { key, button, value, count } of bar.skillNodes) {
              const b = button.getBoundingClientRect();
              check(button === document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2), size + " losange inaccessible " + key);
              check(Math.abs(b.width - width * 160 / 724) < 0.1, size + " taille losange");
              check(b.x >= r.x - 0.1 && b.y >= r.y - 0.1 && b.right <= r.right + 0.1 && b.bottom <= r.bottom + 0.1,
                size + " losange hors conteneur");
              for (const child of button.children) {
                const c = child.getBoundingClientRect();
                check(c.x >= b.x && c.right <= b.right && c.y >= b.y && c.bottom <= b.bottom, size + " texte déborde");
              }
              check(value.textContent.startsWith(key === "agi" ? "-" : "+"), size + " signe");
              check(count.textContent === (key === "for" ? "(2)" : "(0)"), size + " compte");
              if (key === "for") check(button.title.includes("Escalade") && button.title.includes("En montagne")
                && !button.title.includes("<img") && !globalThis.co2prismInjected, "Description dangereuse");
              button.click(); await new Promise(resolve => setTimeout(resolve, 0));
              check(calls.at(-1) === "skill:" + key, size + " mauvais jet");
            }
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            check(bar.skillsPanel.hidden, size + " fermeture");
            const closed = bar.portrait.getBoundingClientRect();
            check(Math.abs(closed.x - portrait.x) < 0.1 && Math.abs(closed.y - portrait.y) < 0.1,
              size + " portrait déplacé à la fermeture");
          }
          result.skillsDimensions = skillsDimensions;
          const combatDimensions = [];
          actor.system.attributes.movement = { value: 10, unit: "m" };
          canvas.scene = { grid: { type: 1, distance: 2, units: "m" } };
          for (const [size, width] of Object.entries({ S: 300, M: 430, L: 600, XL: 780 })) {
            settings.size = size; bar.position = { x: 300, y: 350 }; bar.layout();
            const before = bar.portrait.getBoundingClientRect();
            root.querySelector('[data-co2prism-preset="1"]').click(); await bar.configWrites.get(actor);
            const r = root.getBoundingClientRect(), after = bar.portrait.getBoundingClientRect();
            combatDimensions.push({ size, width: r.width, height: r.height });
            check(!bar.combatPanel.hidden && actor.flags.co2prism.activePreset === 1, size + " Combat fermé");
            check(Math.abs(r.width - width * 1799 / 724) < 0.1, size + " étendue Combat");
            check(Math.abs(before.x - after.x) < 0.1 && Math.abs(before.y - after.y) < 0.1, size + " base déplacée par Combat");
            check(bar.combatValues.meters.textContent === "10" && bar.combatValues.cells.textContent === "5"
              && bar.combatValues.def.textContent === "15" && bar.combatValues.dr.textContent === "4", "Valeurs Combat");
            const slots = [...root.querySelectorAll(".co2prism-combat-slot")];
            check(slots.length === 8, "Nombre de cases");
            check(slots[0].dataset.co2prismHand === "left" && slots[1].dataset.co2prismHand === "right", "Convention des mains");
            const firstY = slots[0].getBoundingClientRect().y, secondY = slots[5].getBoundingClientRect().y;
            check(slots.slice(0, 5).every(slot => slot.getBoundingClientRect().y === firstY)
              && slots.slice(5).every(slot => slot.getBoundingClientRect().y === secondY) && secondY > firstY, "Disposition 5/3");
            check(bar.combatEffects.children.length === 1 && bar.combatEffects.firstElementChild.title === "Native effect", "Effets réels");
            const count = calls.length, original = JSON.stringify(actor.system);
            for (const node of [...slots, ...root.querySelectorAll(".co2prism-time, .co2prism-defense-control")]) {
              node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
            }
            check(calls.length === count && JSON.stringify(actor.system) === original, "Commande Combat exécutée");
            check([...root.querySelectorAll(".co2prism-time")].map(node => node.textContent).join(",") === "L,AM,A,M", "Ordre des temps");
            for (const button of bar.actions) {
              const b = button.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
              check(button.contains(hit), size + " commande de base recouverte: " + button.dataset.co2prismAction + " par " + hit?.className);
            }
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            check(!bar.skillsPanel.hidden && !bar.combatPanel.hidden, "Volets exclusifs");
            for (const node of [...slots, ...bar.skillNodes.map(skill => skill.button)]) {
              const b = node.getBoundingClientRect();
              check(node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)), size + " collision de volets");
            }
            check(document.elementFromPoint(r.x + 2, r.y + 2)?.id === "board", size + " coin transparent Combat");
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            root.querySelector('[data-co2prism-preset="1"]').click(); await bar.configWrites.get(actor);
          }
          result.combatDimensions = combatDimensions;
          if (${Boolean(process.env.CO2PRISM_SCREENSHOT)}) {
            settings.size = "L"; bar.position = { x: 300, y: 350 }; bar.layout();
            actor.img = "file:///F:/FVTT_V14/public/icons/svg/mystery-man.svg";
            bar.skillsToggle.click(); await bar.configWrites.get(actor);
            root.querySelector('[data-co2prism-preset="1"]').click(); await bar.configWrites.get(actor);
          }
          const board = document.getElementById("board").getBoundingClientRect();
          result.board = { width: board.width, height: board.height };
          check(board.width === innerWidth && board.height === innerHeight, "Board natif modifié");
        } catch (error) { result.errors.push(error.stack); }
        const output = document.createElement("pre"); output.id = "co2prism-browser-result";
        output.textContent = JSON.stringify(result); document.body.append(output);
      })();</script></body></html>`;
    const fixture = join(directory, "layout.html");
    writeFileSync(fixture, html);
    const execution = spawnSync(edge, ["--headless", "--no-sandbox", "--disable-gpu", "--in-process-gpu",
      "--disable-software-rasterizer", "--no-first-run", "--no-default-browser-check",
      "--allow-file-access-from-files", `--user-data-dir=${join(directory, "profile")}`,
      "--window-size=2400,1400", "--virtual-time-budget=4000",
      ...(process.env.CO2PRISM_SCREENSHOT ? [`--screenshot=${process.env.CO2PRISM_SCREENSHOT}`] : []),
      "--dump-dom", pathToFileURL(fixture).href], {
      encoding: "utf8", timeout: 25000, maxBuffer: 2000000, windowsHide: true
    });
    assert.ifError(execution.error);
    assert.equal(execution.status, 0, execution.stderr);
    const output = execution.stdout.match(/<pre id="co2prism-browser-result">([^<]+)<\/pre>/);
    assert.ok(output, "Résultat navigateur manquant");
    const result = JSON.parse(output[1]);
    console.log(JSON.stringify({ dimensions: result.dimensions, skillsDimensions: result.skillsDimensions,
      combatDimensions: result.combatDimensions, board: result.board }));
    assert.deepEqual(result.errors, []);
  } finally {
    // Vérifier la destination avant de supprimer le profil temporaire.
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.split(sep).at(-1).startsWith("co2prism-browser-"));
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

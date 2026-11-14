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
    const markup = read("../templates/bar.hbs").replace(/\{\{localize '[^']+'\}\}/g, "Label");
    // Un board natif reste derrière Prism ; aucune instance de monde n'est modifiée.
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="${pathToFileURL(foundryCSS).href}">
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
            async setFlag(scope, key, value) { this.flags[scope] ??= {}; this.flags[scope][key] = value; },
            sheet: { render: () => calls.push("sheet") }, update: async () => {},
            system: { attributes: { hp: { value: 24, max: 34 } },
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
          check(actor.flags.co2prism.panels === undefined, "Un volet a été ouvert par le preset");
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
      "--window-size=1280,900", "--virtual-time-budget=2000", "--dump-dom", pathToFileURL(fixture).href], {
      encoding: "utf8", timeout: 25000, maxBuffer: 2000000, windowsHide: true
    });
    assert.ifError(execution.error);
    assert.equal(execution.status, 0, execution.stderr);
    const output = execution.stdout.match(/<pre id="co2prism-browser-result">([^<]+)<\/pre>/);
    assert.ok(output, "Résultat navigateur manquant");
    const result = JSON.parse(output[1]);
    console.log(JSON.stringify({ dimensions: result.dimensions, board: result.board }));
    assert.deepEqual(result.errors, []);
  } finally {
    // Vérifier la destination avant de supprimer le profil temporaire.
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.split(sep).at(-1).startsWith("co2prism-browser-"));
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

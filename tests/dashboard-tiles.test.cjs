const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(process.env.GRYFSMART_PLAYWRIGHT || "playwright");

test("Native GRYFSMART dashboard tiles", async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GRYFSMART_CHROME || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent("<main></main>");
    await page.addScriptTag({ path: path.join(__dirname, "../custom_components/gryfsmart/frontend/dashboard-tiles.js") });
    await page.evaluate(() => {
      window.Tiles = customElements.get("gryfsmart-tiles-dialog");
      window.items = ["switch", "number", "binary_sensor", "sensor", "climate", "event", "button", "cover"].map((domain, index) => ({
        entity_id: `${domain}.gryf_${index}`, name: `Aktualna nazwa ${index}`, module: "Pokój", entry: "hub1", hub: "Dom", model: "R0806T", module_id: 2,
      }));
      items.push({ ...items[0], entity_id: "switch.duplicate_module_name", module_id: 3 });
      items.push({ ...items[0], entity_id: "switch.second_hub", entry: "hub2", hub: "Garaż" });
      window.original = { title: "Dom", background: "keep-background", views: [
        { title: "Główna", path: "home", type: "sections", badges: [{ entity: "sensor.outside" }],
          sections: [{ type: "grid", cards: [{ type: "tile", entity: "switch.other", name: "Własna nazwa" }, { type: "custom:gryfsmart-system-card" }] }] },
        { title: "Inna", cards: [{ type: "entities", entities: ["sensor.outside"] }] },
      ] };
      window.reset = () => {
        document.querySelector("gryfsmart-tiles-dialog")?.remove();
        window.stored = structuredClone(original); window.calls = []; window.failSave = false; window.failRead = false;
        window.loseAck = false; window.holdSave = false; window.readAfterSaveFails = false; window.listFail = false;
        window.dialog = document.createElement("gryfsmart-tiles-dialog"); document.body.append(dialog);
        window.hass = { user: { is_admin: true }, async callWS(command) {
          calls.push(structuredClone(command));
          if (command.type === "lovelace/dashboards/list") {
            if (listFail) throw new Error("Lista niedostępna");
            return [{ title: "Garaż", url_path: "dashboard-garage", mode: "storage" }, { title: "YAML", url_path: "dashboard-yaml", mode: "yaml" }];
          }
          if (command.type === "lovelace/config") {
            if (failRead) throw new Error("Odczyt niedostępny");
            return structuredClone(stored);
          }
          if (command.type === "lovelace/config/save") {
            if (holdSave) await new Promise(resolve => window.releaseSave = resolve);
            if (failSave) throw new Error("Zapis odrzucony");
            stored = structuredClone(command.config);
            if (readAfterSaveFails) failRead = true;
            if (loseAck) throw new Error("Utracono potwierdzenie");
            return null;
          }
          throw new Error(`Unexpected request: ${command.type}`);
        }, callService() { throw new Error("Must never control physical devices"); } };
      };
    });
    await t.test("all domains become independent native tiles grouped by stable module IDs", async () => {
      const result = await page.evaluate(() => {
        const plan = Tiles.plan(original, "0", items);
        return { count: plan.count, groups: plan.groups.length, tiles: plan.groups.flatMap(group => group.section.cards.slice(1)),
          retainedSection: JSON.stringify(plan.config.views[0].sections[0]) === JSON.stringify(original.views[0].sections[0]),
          retainedOther: JSON.stringify(plan.config.views[1]) === JSON.stringify(original.views[1]),
          sourceSections: original.views[0].sections.length, background: plan.config.background };
      });
      assert.equal(result.count, 10); assert.equal(result.groups, 3);
      assert(result.retainedSection && result.retainedOther); assert.equal(result.sourceSections, 1);
      assert.equal(result.background, "keep-background");
      assert(result.tiles.every(tile => tile.type === "tile" && !Object.hasOwn(tile, "name")), "Names must continue to follow HA");
      assert.deepEqual(result.tiles.find(tile => tile.entity.startsWith("number.")).features, [{ type: "numeric-input", style: "slider" }]);
      assert.deepEqual(result.tiles.find(tile => tile.entity.startsWith("switch.")).features, [{ type: "toggle" }]);
      assert.deepEqual(result.tiles.find(tile => tile.entity.startsWith("button.")).icon_tap_action, { action: "more-info" });
    });
    await t.test("repeated additions skip displayed entities, including nested native cards", async () => {
      assert(await page.evaluate(() => {
        const first = Tiles.plan(original, "0", items);
        const second = Tiles.plan(first.config, "0", items);
        const nested = structuredClone(original);
        nested.views[0].sections[0].cards.push({ type: "vertical-stack", cards: [{ type: "entities", entities: [items[0].entity_id, { entity: items[1].entity_id }] }] });
        const limited = Tiles.plan(nested, "0", [...items, items[0]]);
        return second.count === 0 && second.skipped === 10 && JSON.stringify(first.config) === JSON.stringify(second.config) && limited.count === 8;
      }));
    });
    await t.test("new views use unique paths and do not convert unsupported layouts", async () => {
      assert(await page.evaluate(() => {
        const first = Tiles.plan(original, "new", items);
        const second = Tiles.plan(first.config, "new", items);
        let badLayout = false, strategy = false;
        try { Tiles.plan(original, "1", items); } catch { badLayout = true; }
        try { Tiles.plan({ strategy: { type: "original-states" } }, "new", items); } catch { strategy = true; }
        return first.path === "gryfsmart-tiles" && second.path === "gryfsmart-tiles-2" && badLayout && strategy;
      }));
    });
    await t.test("preview performs reads only and defaults to the current Sections view", async () => {
      assert(await page.evaluate(async () => {
        reset(); await dialog.configure(hass, items, "/lovelace/home");
        return dialog.$(".view").value === "0" && dialog._plan.count === 10 && calls.every(call => !call.type.endsWith("/save")) &&
          !dialog.$(".dashboard").textContent.includes("YAML") && dialog.$(".preview").children.length === 3;
      }));
    });
    await t.test("save appends once, checks the stored config and preserves existing edits", async () => {
      const result = await page.evaluate(async () => {
        await dialog.save(); await dialog.save();
        return { saves: calls.filter(call => call.type === "lovelace/config/save"), message: dialog.$(".status").textContent,
          retained: JSON.stringify(stored.views[0].sections[0]) === JSON.stringify(original.views[0].sections[0]),
          link: dialog.$(".open").getAttribute("href"), disabled: dialog.$(".save").disabled };
      });
      assert.equal(result.saves.length, 1); assert.equal(result.saves[0].url_path, null);
      assert(result.retained && result.disabled); assert(result.message.startsWith("Gotowe:")); assert.equal(result.link, "/lovelace/home");
    });
    await t.test("concurrent dashboard edits stop the save without overwriting them", async () => {
      assert(await page.evaluate(async () => {
        reset(); await dialog.configure(hass, items, "/lovelace/home");
        stored.views[0].title = "Edytowano w innej karcie";
        await dialog.save();
        return !calls.some(call => call.type.endsWith("/save")) && dialog.$(".status").textContent.includes("zmienił") && dialog.$(".save").disabled;
      }));
    });
    await t.test("failed or lost save acknowledgements never cause an automatic retry", async () => {
      assert(await page.evaluate(async () => {
        reset(); await dialog.configure(hass, items, "/lovelace/home");
        loseAck = true; await dialog.save(); await dialog.save();
        const pending = !dialog.$(".reload").hidden && dialog.$(".save").disabled;
        await dialog.checkSaved();
        return pending && calls.filter(call => call.type.endsWith("/save")).length === 1 && dialog.$(".status").textContent.startsWith("Gotowe:");
      }));
      assert(await page.evaluate(async () => {
        reset(); await dialog.configure(hass, items, "/lovelace/home"); failSave = true;
        await dialog.save(); await dialog.checkSaved(); await dialog.save();
        return calls.filter(call => call.type.endsWith("/save")).length === 1 && dialog.$(".save").disabled && dialog.$(".open").hidden &&
          JSON.stringify(stored) === JSON.stringify(original);
      }));
    });
    await t.test("verification failure is visible and can be resolved with a read-only check", async () => {
      assert(await page.evaluate(async () => {
        reset(); await dialog.configure(hass, items, "/lovelace/home"); readAfterSaveFails = true;
        await dialog.save();
        const warned = dialog.$(".status").textContent.includes("odczyt kontrolny") && dialog.$(".open").hidden;
        failRead = false; await dialog.checkSaved();
        return warned && dialog.$(".status").textContent.startsWith("Gotowe:") && calls.filter(call => call.type.endsWith("/save")).length === 1;
      }));
    });
    await t.test("double clicks are locked while a write is in progress", async () => {
      assert(await page.evaluate(async () => {
        reset(); await dialog.configure(hass, items, "/lovelace/home"); holdSave = true;
        const pending = dialog.save();
        while (!window.releaseSave) await new Promise(resolve => setTimeout(resolve, 1));
        await dialog.save(); const disabled = dialog.$(".save").disabled && dialog.$(".cancel").disabled;
        releaseSave(); await pending;
        return disabled && calls.filter(call => call.type.endsWith("/save")).length === 1;
      }));
    });
    await t.test("admin restrictions and empty/read-error cases cannot save", async () => {
      assert(await page.evaluate(async () => {
        reset(); hass.user.is_admin = false; await dialog.configure(hass, items); await dialog.save();
        const denied = calls.length === 0 && dialog.$(".save").disabled;
        reset(); failRead = true; await dialog.configure(hass, items); await dialog.save();
        const failed = !calls.some(call => call.type.endsWith("/save")) && dialog.$(".save").disabled;
        reset(); await dialog.configure(hass, []); await dialog.save();
        return denied && failed && !calls.some(call => call.type.endsWith("/save"));
      }));
    });
    await t.test("custom dashboards, mobile layout and label text are handled safely", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      assert(await page.evaluate(async () => {
        reset(); const malicious = [{ ...items[0], module: "<img src=x onerror=alert(1)>" }];
        await dialog.configure(hass, malicious, "/dashboard-garage/home");
        const safe = !dialog.shadowRoot.querySelector("img") && dialog.$(".preview").textContent.includes("<img");
        const bounds = dialog.$("dialog").getBoundingClientRect();
        await dialog.save();
        return safe && bounds.left >= 0 && bounds.right <= 390 && calls.find(call => call.type.endsWith("/save")).url_path === "dashboard-garage";
      }));
    });
    await t.test("main card opens the optional exporter without replacing itself or saving", async () => {
      await page.addScriptTag({ path: path.join(__dirname, "../custom_components/gryfsmart/frontend/system-card.js") });
      assert(await page.evaluate(async () => {
        document.querySelector("gryfsmart-tiles-dialog").remove();
        window.mainCard = document.createElement("gryfsmart-system-card");
        const proxy = { ...hass, async callWS(command) { return command.type === "gryfsmart/system_entities" ? items : hass.callWS(command); } };
        mainCard.hass = proxy;
        const before = calls.filter(call => call.type.endsWith("/save")).length;
        await mainCard.openTiles();
        const exporter = document.querySelector("gryfsmart-tiles-dialog");
        return !!exporter && exporter._items.length === 10 && calls.filter(call => call.type.endsWith("/save")).length === before;
      }));
    });
    await t.test("fresh browser loads the exporter module on click and previews without a write", async () => {
      const fresh = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      fresh.on("pageerror", error => errors.push(error.message));
      const loaded = [];
      await fresh.route("http://gryfsmart.test/**", route => {
        const url = new URL(route.request().url());
        const filename = path.basename(url.pathname);
        if (["system-card.js", "dashboard-tiles.js"].includes(filename)) {
          loaded.push(filename);
          return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "../custom_components/gryfsmart/frontend", filename)) });
        }
        return route.fulfill({ contentType: "text/html", body: "<style>body{font:16px Arial;padding:24px}</style><main></main>" });
      });
      await fresh.goto("http://gryfsmart.test/lovelace/0");
      await fresh.addScriptTag({ url: "/gryfsmart-system/system-card.js?v=0.3.5", type: "module" });
      await fresh.evaluate(() => {
        const item = { entity_id: "number.bedroom_pwm", name: "Lampka przy łóżku", module: "Sypialnia", entry: "hub", hub: "Dom", model: "R0806T", module_id: 2 };
        window.writes = 0;
        window.loadCardHelpers = async () => ({ createCardElement() { return document.createElement("section"); } });
        window.card = document.createElement("gryfsmart-system-card");
        card.setConfig({ type: "custom:gryfsmart-system-card" });
        card.hass = { user: { is_admin: true }, async callWS(command) {
          if (command.type === "gryfsmart/system_entities") return [item];
          if (command.type === "lovelace/dashboards/list") return [];
          if (command.type === "lovelace/config") return { views: [{ type: "sections", title: "Dom", sections: [] }] };
          writes++; throw new Error("Unexpected write during preview");
        } };
        document.querySelector("main").append(card);
      });
      await fresh.getByRole("button", { name: "Dodaj osobne kafelki", exact: true }).click();
      await fresh.getByRole("button", { name: "Dodaj kafelki", exact: true }).waitFor();
      await fresh.waitForFunction(() => document.querySelector("gryfsmart-tiles-dialog")?._plan?.count === 1);
      assert(loaded.includes("dashboard-tiles.js"));
      assert.equal(await fresh.evaluate(() => writes), 0);
      assert.equal(await fresh.getByLabel("Zakładka", { exact: true }).inputValue(), "0");
      if (process.env.GRYFSMART_TILES_SCREENSHOT) await fresh.screenshot({ path: process.env.GRYFSMART_TILES_SCREENSHOT });
      await fresh.getByRole("button", { name: "Anuluj", exact: true }).click();
      assert.equal(await fresh.locator("gryfsmart-tiles-dialog").count(), 0);
      await fresh.evaluate(() => history.replaceState(null, "", "/lovelace/0?edit=1"));
      await fresh.getByRole("button", { name: "Dodaj osobne kafelki", exact: true }).click();
      assert(await fresh.getByRole("button", { name: "Dodaj kafelki", exact: true }).isDisabled());
      assert((await fresh.locator("gryfsmart-tiles-dialog .status").innerText()).includes("Gotowe"));
      await fresh.close();
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

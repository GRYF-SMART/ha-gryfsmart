const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require(process.env.GRYFSMART_PLAYWRIGHT || "playwright");

test("GRYFSMART card in a real browser", async (t) => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.GRYFSMART_CHROME || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<style>body{font-family:Arial;margin:20px}</style><main></main>');
    await page.evaluate(() => {
      window.calls = [];
      window.fail = false;
      window.fixture = [
        ["switch", "Wyjścia", "Oświetlenie łazienki"], ["cover", "Rolety", "Roleta wschód"],
        ["number", "PWM", "Światło ściemniane"], ["binary_sensor", "Wejścia", "Przycisk łóżko"],
        ["sensor", "Temperatury", "Temperatura salonu"], ["climate", "Termostaty", "Ogrzewanie"],
        ["event", "Zdarzenia wejść", "Zdarzenia: Przycisk łóżko"], ["sensor", "Diagnostyka", "Firmware"],
        ["button", "Narzędzia", "Zapisz konfigurację w module"],
      ].map(([domain, section, name], i) => ({ entry: "hub1", hub: "Dom", model: "R0806T", module_id: 2,
        module: "Sypialnia", entity_id: `${domain}.gryf_${i}`, name, section, channel: i }));
      window.fixture.push({ ...fixture[0], module_id: 3, entity_id: "switch.module3" });
      window.fixture.push({ ...fixture[0], entry: "hub2", hub: "Garaż", entity_id: "switch.hub2" });
      window.initialFixture = structuredClone(fixture);
      window.loadCardHelpers = async () => ({ createCardElement(config) {
        const card = document.createElement("section");
        card.config = config;
        card.style.cssText = "border:1px solid #ddd;border-radius:12px;padding:12px";
        const title = document.createElement("h3"); title.textContent = config.title; card.append(title);
        for (const row of config.entities) {
          const element = document.createElement(row.type === "section" ? "h4" : "div");
          element.textContent = row.name || row.label; card.append(element);
        }
        return card;
      } });
      window.hassFixture = { user: { is_admin: true }, states: { "switch.module3": { state: "unavailable" } },
        async callWS(command) {
          calls.push(command.type);
          if (window.hold) return await new Promise(resolve => window.release = resolve);
          if (fail) throw new Error("Test utraty połączenia");
          if (command.type === "gryfsmart/refresh_names") {
            fixture[0].name = "Nowa nazwa z EEPROM";
            return { errors: window.nameErrors || [] };
          }
          return structuredClone(fixture);
        },
        callService() { throw new Error("Displaying the card must not control hardware"); },
      };
    });
    await page.addScriptTag({ path: path.join(__dirname, "../custom_components/gryfsmart/frontend/system-card.js") });
    await t.test("picker, standard config, repeated editing and all entity domains", async () => {
      const result = await page.evaluate(async () => {
        window.card = document.createElement("gryfsmart-system-card");
        card.hass = hassFixture; // HA may assign hass before config and attachment.
        card.setConfig({ type: "custom:gryfsmart-system-card", grid_options: { columns: 12 } });
        card.setConfig({ type: "custom:gryfsmart-system-card" });
        document.querySelector("main").append(card);
        while (card._fetching) await new Promise(resolve => setTimeout(resolve, 5));
        window.originalCard = card._cards.values().next().value;
        return { type: customCards[0].type, modules: card._cards.size, rows: originalCard.config.entities,
          unavailable: [...card._cards.values()].some(c => c.hass.states["switch.module3"].state === "unavailable") };
      });
      assert.equal(result.type, "gryfsmart-system-card");
      assert.equal(result.modules, 3, "Duplicate module names and hub IDs remain distinct");
      assert.equal(result.rows.filter(row => row.entity).length, 9);
      assert(result.rows.some(row => row.name === "Przycisk łóżko"));
      assert(result.unavailable);
    });
    await t.test("live states retain controls and do not query hardware", async () => {
      assert(await page.evaluate(() => {
        const before = calls.length;
        for (let i = 0; i < 50; i++) card.hass = { ...hassFixture, tick: i };
        return originalCard === card._cards.values().next().value && calls.length === before && originalCard.hass.tick === 49;
      }));
    });
    await t.test("names refresh updates labels without replacing unaffected modules", async () => {
      assert(await page.evaluate(async () => {
        const unaffected = [...card._cards.values()][1];
        await card.refreshNames();
        return [...card._cards.values()][0].config.entities.some(row => row.name === "Nowa nazwa z EEPROM") &&
          [...card._cards.values()][1] === unaffected && card.shadowRoot.querySelector(".notice").textContent.includes("Odczytano");
      }));
      assert(await page.evaluate(async () => {
        window.nameErrors = ["Moduł ID 3 nie odpowiada"];
        await card.refreshNames();
        return card.shadowRoot.querySelector(".notice").classList.contains("warning");
      }));
    });
    await t.test("failed list refresh keeps cards visible and permits retry", async () => {
      assert(await page.evaluate(async () => {
        fail = true; await card.refresh();
        const retained = card._cards.size === 3 && card.shadowRoot.querySelector(".status").classList.contains("error");
        fail = false; await card.refresh();
        return retained && !card.shadowRoot.querySelector(".refresh").disabled && !card.shadowRoot.querySelector(".status").classList.contains("error");
      }));
    });
    await t.test("overlapping requests, disconnect, reconnect and empty installations", async () => {
      assert(await page.evaluate(async () => {
        hold = true;
        const before = calls.length;
        const request = card.refresh();
        await card.refresh();
        const oneRequest = calls.length === before + 1;
        card.remove(); hold = false; release([]); await request;
        const ignored = card._cards.size === 3;
        document.querySelector("main").append(card);
        while (card._fetching) await new Promise(resolve => setTimeout(resolve, 5));
        fixture = []; await card.refresh();
        return oneRequest && ignored && card._cards.size === 0 && card.shadowRoot.querySelector(".status").textContent.includes("Brak widocznych");
      }));
    });
    await t.test("bounded waits, read-only guest and safe label text", async () => {
      assert(await page.evaluate(async () => {
        let timedOut = false;
        try { await card.bounded(new Promise(() => {}), 10); } catch { timedOut = true; }
        card.hass = { ...hassFixture, user: { is_admin: false } };
        const before = calls.length; await card.refreshNames();
        const noNameRead = calls.length === before;
        card.setConfig({ type: "custom:gryfsmart-system-card", title: "<img src=x onerror=alert(1)>" });
        return timedOut && noNameRead && card.shadowRoot.querySelector(".names").hidden && !card.shadowRoot.querySelector("img");
      }));
    });
    await t.test("mobile layout fits the available width", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      assert(await page.evaluate(async () => {
        fixture = structuredClone(initialFixture);
        card.setConfig({ type: "custom:gryfsmart-system-card" });
        while (card._fetching) await new Promise(resolve => setTimeout(resolve, 5));
        await card.refresh();
        return card._cards.size === 3 && document.documentElement.scrollWidth <= 390;
      }));
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

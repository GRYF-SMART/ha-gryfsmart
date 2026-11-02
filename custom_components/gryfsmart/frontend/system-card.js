/* One optional dashboard card; controls remain native Home Assistant entities. */
class GryfSmartSystemCard extends HTMLElement {
  constructor() {
    super();
    this._cards = new Map();
    this._items = [];
    this._signature = "";
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;min-width:0}
      .toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:12px}
      h2{font-size:20px;margin:0;flex:1;color:var(--primary-text-color)}
      button{font:inherit;border:1px solid var(--divider-color,#ccc);border-radius:10px;
        padding:8px 12px;background:var(--card-background-color,#fff);color:var(--primary-color,#03a9f4);cursor:pointer}
      button:disabled{opacity:.5;cursor:wait}
      .wrap{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));align-items:start}
      .status,.notice{padding:8px 0 12px;color:var(--secondary-text-color);white-space:pre-line}
      .error{color:var(--error-color,#db4437)}.warning{color:var(--warning-color,#c77500)}
      [hidden]{display:none!important}
    </style>
    <div class="toolbar"><h2></h2><button class="names" hidden>Odczytaj nazwy z modułów</button>
      <button class="refresh" aria-label="Odśwież listę modułów i encji">Odśwież listę</button>
      <button class="tiles" hidden>Dodaj osobne kafelki</button></div>
    <div class="status" role="status" aria-live="polite">Pobieranie instalacji GRYFSMART…</div>
    <div class="notice" role="status" aria-live="polite" hidden></div><div class="wrap"></div>`;
    this.shadowRoot.querySelector(".refresh").addEventListener("click", () => this.refresh());
    this.shadowRoot.querySelector(".names").addEventListener("click", () => this.refreshNames());
    this.shadowRoot.querySelector(".tiles").addEventListener("click", () => this.openTiles());
  }

  static getStubConfig() { return {}; }
  static getConfigElement() { return document.createElement("gryfsmart-system-card-editor"); }

  setConfig(config) {
    if (!config || (config.type && config.type !== "custom:gryfsmart-system-card")) {
      throw new Error("Nieprawidłowy typ karty GRYFSMART.");
    }
    // HA supplies type, grid_options, visibility and layout settings itself.
    this._config = { ...config };
    this.shadowRoot.querySelector("h2").textContent = config.title || "GRYFSMART — cała instalacja";
    if (!this._items.length) this.refresh();
  }

  connectedCallback() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this.refresh(), 30000);
    this.refresh();
  }
  disconnectedCallback() {
    clearInterval(this._timer);
    this._fetching = null;
  }
  set hass(value) {
    const first = !this._hass;
    this._hass = value;
    this.shadowRoot.querySelector(".names").hidden = !value?.user?.is_admin;
    this.shadowRoot.querySelector(".tiles").hidden = !value?.user?.is_admin;
    // Preserve controls on state updates, including the PWM slider being dragged.
    for (const card of this._cards.values()) card.hass = value;
    if (first) this.refresh();
  }
  async bounded(promise, milliseconds = 15000) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Przekroczono czas oczekiwania na Home Assistant.")), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  }
  status(text, kind = "") {
    const element = this.shadowRoot.querySelector(".status");
    element.textContent = text;
    element.className = `status ${kind}`;
  }

  async refresh() {
    if (!this.isConnected || !this._config || !this._hass || this._fetching) return;
    const request = {};
    this._fetching = request;
    this.shadowRoot.querySelector(".refresh").disabled = true;
    try {
      const [items, helpers] = await this.bounded(Promise.all([
        this._hass.callWS({ type: "gryfsmart/system_entities" }),
        this._helpers || window.loadCardHelpers(),
      ]));
      if (this._fetching !== request || !this.isConnected) return;
      if (!Array.isArray(items)) throw new Error("Nieprawidłowa odpowiedź integracji GRYFSMART.");
      this._helpers = helpers;
      this._items = items;
      this.render();
      this.status(items.length ? `${this._cards.size} modułów · ${items.length} encji` :
        "Brak widocznych encji GRYFSMART. Sprawdź, czy integracja wykryła moduły i czy encje są włączone.");
    } catch (error) {
      if (this._fetching === request && this.isConnected) {
        this.status(`Nie udało się odświeżyć listy. ${error.message || "Sprawdź połączenie z HA."} Kliknij „Odśwież listę”.`, "error");
      }
    } finally {
      if (this._fetching === request) {
        this._fetching = null;
        this.shadowRoot.querySelector(".refresh").disabled = false;
      }
    }
  }

  async refreshNames() {
    if (this._readingNames || !this._hass?.user?.is_admin) return;
    this._readingNames = true;
    const button = this.shadowRoot.querySelector(".names");
    const notice = this.shadowRoot.querySelector(".notice");
    button.disabled = true;
    notice.hidden = false;
    notice.className = "notice";
    notice.textContent = "Odczytywanie nazw z modułów…";
    try {
      const result = await this.bounded(this._hass.callWS({ type: "gryfsmart/refresh_names" }), 125000);
      notice.className = result.errors?.length ? "notice warning" : "notice";
      notice.textContent = result.errors?.length ?
        `Odczyt częściowy — zachowano poprzednie nazwy nieodpowiadających modułów.\n${result.errors.join("\n")}` :
        "Odczytano nazwy. Własne nazwy ustawione w HA mają pierwszeństwo.";
      // Discard list requests that started before the completed name read.
      this._fetching = null;
      await this.refresh();
    } catch (error) {
      notice.className = "notice error";
      notice.textContent = `Nie ukończono odczytu nazw: ${error.message || "brak odpowiedzi HA"}`;
    } finally { this._readingNames = false; button.disabled = false; }
  }

  async openTiles() {
    if (!this._hass?.user?.is_admin || this._openingTiles) return;
    this._openingTiles = true;
    const button = this.shadowRoot.querySelector(".tiles");
    button.disabled = true;
    try {
      const [items] = await this.bounded(Promise.all([
        this._hass.callWS({ type: "gryfsmart/system_entities" }),
        customElements.get("gryfsmart-tiles-dialog") ? Promise.resolve() :
          import("/gryfsmart-system/dashboard-tiles.js?v=0.3.5"),
      ]));
      if (!Array.isArray(items) || !items.length) throw new Error("Brak widocznych encji do dodania.");
      if (document.querySelector("gryfsmart-tiles-dialog")) return;
      const dialog = document.createElement("gryfsmart-tiles-dialog");
      document.body.append(dialog);
      await dialog.configure(this._hass, items);
    } catch (error) { this.status(`Nie można przygotować kafelków. ${error.message || error}`, "error"); }
    finally { this._openingTiles = false; button.disabled = false; }
  }

  render() {
    const signature = JSON.stringify(this._items);
    if (signature === this._signature) return;
    const groups = new Map();
    const hubs = new Set(this._items.map(item => item.entry));
    for (const item of this._items) {
      const key = `${item.entry}:${item.model}:${item.module_id}`;
      if (!groups.has(key)) groups.set(key, { item, rows: [], section: null });
      const group = groups.get(key);
      if (item.section !== group.section) {
        group.rows.push({ type: "section", label: item.section });
        group.section = item.section;
      }
      group.rows.push({ entity: item.entity_id, name: item.name });
    }
    const root = this.shadowRoot.querySelector(".wrap");
    const cards = new Map();
    for (const [key, group] of groups) {
      const { item } = group;
      const config = {
        type: "entities", show_header_toggle: false,
        title: `${item.module} · ID ${item.module_id} · ${item.model}${hubs.size > 1 ? ` · ${item.hub}` : ""}`,
        entities: group.rows,
      };
      const stamp = JSON.stringify(config);
      let card = this._cards.get(key);
      if (!card || card._gryfStamp !== stamp) {
        card = this._helpers.createCardElement(config);
        card._gryfStamp = stamp;
      }
      card.hass = this._hass;
      cards.set(key, card);
    }
    root.replaceChildren(...cards.values());
    this._cards = cards;
    this._signature = signature;
  }

  getCardSize() { return Math.max(3, this._items.length + this._cards.size * 2); }
  getGridOptions() { return { columns: "full", rows: "auto", min_columns: 6 }; }
}

class GryfSmartSystemCardEditor extends HTMLElement {
  setConfig() {
    this.textContent = "Karta automatycznie pokazuje wszystkie widoczne encje GRYFSMART, pogrupowane według modułów. Zapisz kartę, aby dodać całą instalację. Nazwy z EEPROM odświeżysz przyciskiem na karcie.";
  }
}
if (!customElements.get("gryfsmart-system-card")) customElements.define("gryfsmart-system-card", GryfSmartSystemCard);
if (!customElements.get("gryfsmart-system-card-editor")) customElements.define("gryfsmart-system-card-editor", GryfSmartSystemCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "gryfsmart-system-card")) {
  window.customCards.push({
    type: "gryfsmart-system-card",
    name: "GRYFSMART — cała instalacja",
    description: "Wszystkie wejścia, wyjścia, temperatury, PWM, rolety i termostaty z aktualnymi nazwami.",
    documentationURL: "https://github.com/GRYF-SMART/ha-gryfsmart#karta-całej-instalacji-034",
    preview: true,
  });
}

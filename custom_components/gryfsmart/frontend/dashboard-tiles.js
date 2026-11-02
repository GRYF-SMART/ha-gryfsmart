/* Native Lovelace tiles. No hardware commands and no replacement of existing cards. */
class GryfSmartTilesDialog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>
      dialog{box-sizing:border-box;width:min(640px,calc(100vw - 24px));max-height:90vh;overflow:auto;
        border:1px solid var(--divider-color,#ccc);border-radius:16px;padding:24px;
        background:var(--card-background-color,#fff);color:var(--primary-text-color,#222);font:inherit}
      dialog::backdrop{background:#0007}h2{margin-top:0;font-size:22px}p{line-height:1.5}
      label{display:block;margin:16px 0}select{display:block;width:100%;box-sizing:border-box;
        margin-top:6px;padding:12px;background:var(--card-background-color,#fff);color:inherit;
        border:1px solid var(--divider-color,#ccc);border-radius:8px;font:inherit}
      button{font:inherit;padding:10px 14px;border:1px solid var(--divider-color,#ccc);border-radius:8px;
        color:var(--primary-color,#03a9f4);background:var(--card-background-color,#fff);cursor:pointer}
      button:disabled{opacity:.5;cursor:default}.actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}
      .status{white-space:pre-line;padding:12px 0}.error{color:var(--error-color,#db4437)}
      .success{color:var(--success-color,#16834a)}ul{padding-left:22px;max-height:24vh;overflow:auto}
      a{color:var(--primary-color,#03a9f4)}[hidden]{display:none!important}
    </style><dialog aria-labelledby="tiles-title">
      <h2 id="tiles-title">Dodaj osobne kafelki</h2>
      <p>Każda encja otrzyma osobny kafelek HA. Moduły utworzą osobne sekcje.
        Kafelki możesz potem przesuwać i edytować; nazwy będą aktualizowane z encji HA.</p>
      <label>Panel<select class="dashboard" aria-label="Panel"></select></label>
      <label>Zakładka<select class="view" aria-label="Zakładka"></select></label>
      <div class="status" role="status" aria-live="polite"></div><ul class="preview"></ul>
      <p class="details" hidden>Dodane zostaną tylko brakujące encje. Istniejące karty i ich ustawienia zostają zachowane.
        Nowe moduły możesz dodać później tym samym przyciskiem.</p>
      <a class="open" hidden>Otwórz zakładkę z kafelkami</a>
      <div class="actions"><button class="reload" hidden>Sprawdź stan panelu</button>
        <button class="cancel">Anuluj</button><button class="save" disabled>Dodaj kafelki</button></div>
    </dialog>`;
    this.$(".cancel").addEventListener("click", () => this.remove());
    this.$("dialog").addEventListener("cancel", event => {
      if (this._saving) event.preventDefault(); else this.remove();
    });
    this.$(".dashboard").addEventListener("change", () => this.loadConfig());
    this.$(".view").addEventListener("change", () => this.preview());
    this.$(".save").addEventListener("click", () => this.save());
    this.$(".reload").addEventListener("click", () => this.checkSaved());
  }
  $(selector) { return this.shadowRoot.querySelector(selector); }
  connectedCallback() { this.$("dialog").showModal(); }
  disconnectedCallback() { this.$("dialog").close(); }
  message(text, kind = "") { this.$(".status").textContent = text; this.$(".status").className = `status ${kind}`; }
  busy(value) {
    for (const selector of [".dashboard", ".view", ".cancel", ".reload"]) this.$(selector).disabled = value;
    this.$(".save").disabled = value || this._attempted || !this._plan?.count;
  }
  async request(command) {
    let timer;
    try {
      return await Promise.race([this._hass.callWS(command), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Brak odpowiedzi Home Assistant.")), 15000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async configure(hass, items, pathname = location.pathname) {
    this._hass = hass;
    this._items = structuredClone(items);
    this._currentPath = pathname.split("/").filter(Boolean);
    this.busy(true);
    try {
      if (!hass.user?.is_admin) throw new Error("Dodawanie kart wymaga konta administratora HA.");
      if (new URLSearchParams(location.search).get("edit") === "1") {
        throw new Error("Najpierw zakończ edycję panelu przyciskiem „Gotowe”, a potem dodaj kafelki.");
      }
      this.message("Pobieranie paneli…");
      const dashboards = await this.request({ type: "lovelace/dashboards/list" });
      if (!Array.isArray(dashboards)) throw new Error("Nieprawidłowa lista paneli HA.");
      const panels = new Map([["", "Przegląd (lovelace)"]]);
      for (const panel of dashboards) {
        if (panel.mode === "storage" && panel.url_path !== "lovelace") panels.set(panel.url_path, panel.title);
      }
      this.$(".dashboard").replaceChildren(...[...panels].map(([value, title]) => new Option(title, value)));
      this.$(".dashboard").value = panels.has(this._currentPath[0]) ? this._currentPath[0] : "";
      await this.loadConfig();
    } catch (error) { this.message(error.message || String(error), "error"); }
    finally { this.busy(false); }
  }
  async readConfig() {
    return this.request({ type: "lovelace/config", url_path: this._urlPath, force: true });
  }
  async loadConfig() {
    if (this._saving || this._attempted) return;
    this._plan = null;
    this.$(".preview").replaceChildren();
    this.$(".details").hidden = true;
    this.busy(true);
    this._urlPath = this.$(".dashboard").value || null;
    this.message("Odczytywanie układu panelu…");
    try {
      this._source = await this.readConfig();
      if (!Array.isArray(this._source?.views) || this._source.strategy) {
        throw new Error("Ten panel jest generowany automatycznie. Wybierz panel z własnymi zakładkami i układem Sekcje.");
      }
      const options = [new Option("Nowa zakładka: GRYFSMART — kafelki", "new")];
      this._source.views.forEach((view, index) => {
        if (view.type === "sections" && !view.strategy) options.push(new Option(view.title || `Zakładka ${index + 1}`, String(index)));
      });
      this.$(".view").replaceChildren(...options);
      const current = this._currentPath[0] === (this._urlPath || "lovelace") ? this._currentPath[1] || "0" : null;
      const currentIndex = this._source.views.findIndex((view, i) => String(view.path ?? i) === current);
      this.$(".view").value = options.some(option => option.value === String(currentIndex)) ? String(currentIndex) : "new";
      this.preview();
    } catch (error) { this.message(error.message || String(error), "error"); }
    finally { this.busy(false); }
  }
  static tile(item) {
    const domain = item.entity_id.split(".")[0];
    // No name override: HA applies current registry names, including subsequent edits.
    const tile = { type: "tile", entity: item.entity_id, tap_action: { action: "more-info" } };
    if (domain === "switch") tile.features = [{ type: "toggle" }];
    if (domain === "number") tile.features = [{ type: "numeric-input", style: "slider" }];
    if (domain === "cover") tile.features = [{ type: "cover-open-close" }];
    if (domain === "climate") tile.features = [{ type: "target-temperature" }];
    if (domain === "button") tile.icon_tap_action = { action: "more-info" };
    return tile;
  }
  static plan(source, selection, items) {
    if (!Array.isArray(source?.views) || source.strategy) throw new Error("Panel nie ma edytowalnych zakładek.");
    const config = structuredClone(source);
    let view, index;
    if (selection === "new") {
      const paths = new Set(config.views.map((entry, i) => String(entry.path ?? i)));
      let path = "gryfsmart-tiles", n = 2;
      while (paths.has(path)) path = `gryfsmart-tiles-${n++}`;
      view = { title: "GRYFSMART — kafelki", path, type: "sections", max_columns: 3, sections: [] };
      index = config.views.length;
      config.views.push(view);
    } else {
      index = Number(selection);
      view = Number.isInteger(index) && index >= 0 ? config.views[index] : null;
      if (!view || view.type !== "sections" || view.strategy) throw new Error("Wybierz zakładkę z układem Sekcje.");
      if (view.sections !== undefined && !Array.isArray(view.sections)) throw new Error("Nieprawidłowa lista sekcji panelu.");
      view.sections ??= [];
    }
    const existing = new Set();
    function collect(value) {
      if (!value || typeof value !== "object") return;
      if (typeof value.entity === "string") existing.add(value.entity);
      if (Array.isArray(value.entities)) {
        for (const entity of value.entities) if (typeof entity === "string") existing.add(entity);
      }
      for (const child of Object.values(value)) collect(child);
    }
    collect(view);
    const groups = new Map(), seen = new Set();
    let skipped = 0, count = 0;
    const hubs = new Set(items.map(item => item.entry));
    for (const item of items) {
      if (!/^(switch|cover|number|binary_sensor|sensor|climate|event|button)\.[a-z0-9_]+$/.test(item.entity_id)) continue;
      if (seen.has(item.entity_id)) continue;
      seen.add(item.entity_id);
      if (existing.has(item.entity_id)) { skipped++; continue; }
      const key = JSON.stringify([item.entry, item.model, item.module_id]);
      if (!groups.has(key)) {
        const title = `${item.module} · ID ${item.module_id} · ${item.model}${hubs.size > 1 ? ` · ${item.hub}` : ""}`;
        groups.set(key, { title, count: 0, section: { type: "grid", cards: [{ type: "heading", heading: title, heading_style: "title" }] } });
      }
      const group = groups.get(key);
      group.section.cards.push(this.tile(item));
      group.count++; count++;
    }
    view.sections.push(...[...groups.values()].map(group => group.section));
    return { config, count, skipped, index, path: String(view.path ?? index), groups: [...groups.values()] };
  }
  preview() {
    if (this._attempted) return;
    this._plan = null;
    try {
      this._plan = GryfSmartTilesDialog.plan(this._source, this.$(".view").value, this._items);
      this.$(".preview").replaceChildren(...this._plan.groups.map(group => {
        const row = document.createElement("li"); row.textContent = `${group.title}: ${group.count} kafelków`; return row;
      }));
      this.message(`Do dodania: ${this._plan.count} kafelków w ${this._plan.groups.length} sekcjach. Już obecne: ${this._plan.skipped}.`);
      this.$(".details").hidden = false;
    } catch (error) { this.message(error.message || String(error), "error"); }
    this.$(".save").disabled = !this._plan?.count;
  }
  async save() {
    if (this._saving || this._attempted || !this._plan?.count || !this._hass.user?.is_admin) return;
    this._saving = true; this.busy(true);
    try {
      this.message("Sprawdzanie aktualnego układu panelu…");
      const latest = await this.readConfig();
      if (JSON.stringify(latest) !== JSON.stringify(this._source)) {
        this._plan = null;
        throw new Error("Układ panelu zmienił się od podglądu. Zamknij to okno i ponownie wybierz „Dodaj osobne kafelki”. Niczego nie zapisano.");
      }
      this._attempted = true;
      this.message(`Dodawanie ${this._plan.count} kafelków…`);
      await this.request({ type: "lovelace/config/save", url_path: this._urlPath, config: this._plan.config });
      this._acknowledged = true;
      await this.checkSaved();
    } catch (error) {
      this.message(this._attempted ? `Nie potwierdzono zakończenia zapisu. ${error.message || error} Kliknij „Sprawdź stan panelu”; zapis nie będzie ponawiany automatycznie.` : error.message || String(error), "error");
      this.$(".reload").hidden = !this._attempted;
    } finally { this._saving = false; this.busy(false); }
  }
  async checkSaved() {
    if (!this._attempted || !this._plan || !this._hass.user?.is_admin) return;
    this.busy(true);
    try {
      const actual = await this.readConfig();
      if (JSON.stringify(actual) !== JSON.stringify(this._plan.config)) {
        throw new Error("Odczytany układ różni się od wysłanego. Sprawdź panel przed kolejnym dodawaniem kafelków.");
      }
      this.message(`Gotowe: dodano ${this._plan.count} kafelków w ${this._plan.groups.length} sekcjach. Każdy kafelek możesz edytować osobno.`, "success");
      this.$(".reload").hidden = true;
      this.$(".cancel").textContent = "Zamknij";
      this.$(".open").href = `/${encodeURIComponent(this._urlPath || "lovelace")}/${encodeURIComponent(this._plan.path)}`;
      this.$(".open").hidden = false;
    } catch (error) {
      this.message(`${this._acknowledged ? "HA potwierdził zapis, ale odczyt kontrolny nie potwierdził całego układu. " : "Zapis nie został potwierdzony. "}${error.message || error}`, "error");
      this.$(".reload").hidden = false;
    } finally { this.busy(false); }
  }
}
if (!customElements.get("gryfsmart-tiles-dialog")) customElements.define("gryfsmart-tiles-dialog", GryfSmartTilesDialog);

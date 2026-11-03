class GryfDoorCard extends HTMLElement {
  static getConfigElement() { return document.createElement("gryfsmart-door-editor"); }
  static getStubConfig() { return { title: "Drzwi" }; }
  setConfig(config) {
    if (config.output_entity && !config.output_entity.startsWith("switch.")) throw new Error("Elektrozaczep wymaga encji wyjścia switch.");
    if (config.contact_entity && !config.contact_entity.startsWith("binary_sensor.")) throw new Error("Kontaktron wymaga encji wejścia binary_sensor.");
    if (config.closed_state && !["on", "off"].includes(config.closed_state)) throw new Error("Stan zamkniętych drzwi: on lub off.");
    this.config = { closed_state: "on", ...config };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>
        ha-card{display:block;padding:24px;border-radius:24px;background:linear-gradient(145deg,#382044,#120c19);color:#fff;text-align:center;font-family:var(--primary-font-family,Roboto,"Segoe UI",Arial,sans-serif)}
        h2{margin:0 0 20px;font-size:24px}.lock{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;width:100%;min-height:180px;border:2px solid #8d519f;border-radius:22px;background:#442653;color:#fff;font:inherit;cursor:pointer}
        .lock:hover:not(:disabled){background:#703788}.lock:focus-visible{outline:3px solid #ff477e;outline-offset:4px}.lock:disabled{cursor:default;opacity:.6}.lock[aria-pressed=true]{border-color:#ff477e;box-shadow:0 0 24px #ff477e24}.lock svg{width:66px;height:66px;color:#ff477e}.lock strong{font-size:20px}
        .contact{display:flex;gap:10px;align-items:center;justify-content:center;margin-top:22px;font-weight:700}.contact svg{width:30px;height:30px}.closed{color:#88dfb3}.open{color:#ffb36b}.unknown{color:#bbb4c3}small{display:block;color:#dfcde7;margin:8px 0;overflow-wrap:anywhere}.status{font-size:13px;margin-bottom:0;overflow-wrap:anywhere}.status:empty{display:none}
      </style><ha-card><h2></h2><button class="lock" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path/></svg><strong></strong><span>Kliknij, aby przełączyć wyjście</span></button><small class="output-name"></small><div class="contact"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path/></svg><span></span></div><small class="contact-name"></small><p class="status" role="status" aria-live="polite"></p></ha-card>`;
      this.shadowRoot.querySelector("button").addEventListener("click", () => this.toggle());
    }
    this.update();
  }
  set hass(value) { this._hass = value; this.update(); }
  update() {
    if (!this.config || !this._hass) return;
    const root = this.shadowRoot, output = this._hass.states[this.config.output_entity], contact = this._hass.states[this.config.contact_entity];
    const known = entity => ["on", "off"].includes(entity?.state);
    const active = output?.state === "on", closed = contact?.state === this.config.closed_state;
    root.querySelector("h2").textContent = this.config.title || "Drzwi";
    const button = root.querySelector("button");
    button.disabled = !!this.busy || !known(output);
    button.setAttribute("aria-pressed", String(known(output) && active));
    button.setAttribute("aria-label", known(output) ? `Przełącz elektrozaczep — wyjście ${active ? "włączone" : "wyłączone"}` : "Elektrozaczep — brak stanu wyjścia");
    button.querySelector("path").setAttribute("d", !known(output) ? "M8 7a4 4 0 1 1 6 3.5L12 12v2m0 4v.1" : "M5 11h14v10H5zM12 15v2" + (active ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 8 0"));
    button.querySelector("strong").textContent = !known(output) ? "Stan zamka nieznany" : active ? "Kłódka zamknięta" : "Kłódka otwarta";
    button.querySelector("span").textContent = this.busy ? "Wysyłanie polecenia…" : known(output) ? `Wyjście ${active ? "włączone" : "wyłączone"} · kliknij, aby przełączyć` : "Wyjście niedostępne lub niewybrane";
    root.querySelector(".output-name").textContent = output?.attributes.friendly_name || this.config.output_entity || "Wybierz moduł i wyjście elektrozaczepu w edytorze.";
    const indicator = root.querySelector(".contact");
    indicator.className = `contact ${!known(contact) ? "unknown" : closed ? "closed" : "open"}`;
    indicator.querySelector("path").setAttribute("d", !known(contact) ? "M8 7a4 4 0 1 1 6 3.5L12 12v2m0 4v.1" : closed ? "M5 21V3h14v18M3 21h18M15 12h.1" : "M5 21V3h14v18M5 3l10 3v17L5 21M11 12h.1");
    indicator.querySelector("span").textContent = !known(contact) ? "Stan drzwi nieznany" : closed ? "Drzwi zamknięte" : "Drzwi otwarte";
    root.querySelector(".contact-name").textContent = contact?.attributes.friendly_name || this.config.contact_entity || "Wybierz moduł i wejście kontaktronu w edytorze.";
    root.querySelector(".status").textContent = this.message || "";
  }
  async toggle() {
    if (this.busy || !["on", "off"].includes(this._hass?.states[this.config.output_entity]?.state)) return;
    const entity = this.config.output_entity;
    this.busy = true; this.message = ""; this.update();
    let timeout;
    try {
      await Promise.race([
        this._hass.callService("switch", "toggle", { entity_id: entity }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Brak potwierdzenia polecenia. Sprawdź stan przed kolejną próbą.")), 15000); })
      ]);
      this.message = "Polecenie przyjęte. Kłódka pokazuje stan raportowany przez moduł.";
    } catch (error) { this.message = error.message || "Błąd sterowania elektrozaczepem."; }
    finally { clearTimeout(timeout); this.busy = false; this.update(); }
  }
  getCardSize() { return 5; }
}

class GryfDoorEditor extends HTMLElement {
  setConfig(config) { this.config = { closed_state: "on", ...config }; this.render(); }
  set hass(hass) { this._hass = hass; if (!this.loading && !this.attempted) void this.load(); }
  async load() {
    this.loading = true; this.attempted = true; let timeout;
    try {
      this.items = await Promise.race([this._hass.callWS({ type: "gryfsmart/system_entities" }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Przekroczono czas odczytu modułów.")), 15000); })]);
      this.error = "";
    } catch (e) { this.error = e.message || "Nie można pobrać modułów."; }
    finally { clearTimeout(timeout); this.loading = false; this.render(); }
  }
  changed(patch) {
    this.config = { ...this.config, ...patch };
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this.config }, bubbles: true, composed: true }));
  }
  render() {
    if (!this.config) return;
    this.replaceChildren();
    const style = document.createElement("style");
    style.textContent = "gryfsmart-door-editor label{display:block;margin:14px 0}gryfsmart-door-editor input,gryfsmart-door-editor select{display:block;box-sizing:border-box;width:100%;padding:10px;margin-top:6px;color:var(--primary-text-color);background:var(--card-background-color);border:1px solid var(--divider-color);border-radius:8px}";
    this.append(style);
    const field = (text, control) => { const label = document.createElement("label"); label.append(document.createTextNode(text), control); this.append(label); return control; };
    const title = field("Nazwa karty", document.createElement("input")); title.value = this.config.title || (this.gate ? "Brama" : "Drzwi"); title.maxLength = 80; title.onchange = () => this.changed({ title: title.value });
    const key = item => `${item.entry}/${item.model}/${item.module_id}`;
    const select = (label, options, value) => {
      const el = field(label, document.createElement("select"));
      for (const [id, name] of options) el.add(new Option(name, id));
      el.value = value || ""; return el;
    };
    const fields = this.gate ? [["output_entity", "switch.", "Brama"]] : [["output_entity", "switch.", "Elektrozaczep"], ["contact_entity", "binary_sensor.", "Kontaktron"]];
    for (const [kind, prefix, heading] of fields) {
      const rows = (this.items || []).filter(i => i.entity_id.startsWith(prefix));
      const selected = rows.find(i => i.entity_id === this.config[kind]);
      const moduleKey = this[`${kind}Module`] ?? (selected ? key(selected) : "");
      const modules = new Map(rows.map(i => [key(i), `${i.module} · ID ${i.module_id} · ${i.model} · ${i.hub}`]));
      const module = select(`${heading} — moduł`, [["", "Wybierz moduł"], ...modules], moduleKey);
      module.onchange = () => { this[`${kind}Module`] = module.value; this.changed({ [kind]: "" }); this.render(); };
      const choices = rows.filter(i => key(i) === moduleKey).map(i => [i.entity_id, `${i.name} · ${prefix === "switch." ? "WY" : "WE"}${i.channel}`]);
      if (this.config[kind] && !selected) choices.push([this.config[kind], `${this.config[kind]} (brak na liście)`]);
      const channel = select(`${heading} — ${prefix === "switch." ? "wyjście" : "wejście"}`, [["", "Wybierz kanał"], ...choices], this.config[kind]);
      channel.onchange = () => this.changed({ [kind]: channel.value });
    }
    if (this.gate) {
      const duration = field("Czas impulsu [s]", document.createElement("input"));
      duration.type = "number"; duration.min = "0.1"; duration.max = "60"; duration.step = "0.1"; duration.value = this.config.duration ?? 0.5;
      duration.onchange = () => { if (duration.reportValidity()) this.changed({ duration: duration.valueAsNumber }); };
    } else {
      const polarity = select("Drzwi zamknięte, gdy wejście jest", [["on", "Zwarte (ON)"], ["off", "Rozwarte (OFF)"]], this.config.closed_state);
      polarity.onchange = () => this.changed({ closed_state: polarity.value });
    }
    const note = document.createElement("p"); note.textContent = this.gate ? "Czas impulsu odmierza moduł. Stan wyjścia nie oznacza położenia bramy." : "Wyjście włączone = kłódka zamknięta. Wyjście wyłączone = kłódka otwarta. Położenie drzwi jest odczytywane niezależnie z kontaktronu."; this.append(note);
    if (this.error) { const error = document.createElement("p"); error.textContent = this.error; this.append(error); const retry = document.createElement("button"); retry.textContent = "Odśwież moduły"; retry.onclick = () => this.load(); this.append(retry); }
  }
}
if (!customElements.get("gryfsmart-door-card")) customElements.define("gryfsmart-door-card", GryfDoorCard);
if (!customElements.get("gryfsmart-door-editor")) customElements.define("gryfsmart-door-editor", GryfDoorEditor);
window.customCards ??= [];
if (!window.customCards.some(c => c.type === "gryfsmart-door-card")) window.customCards.push({ type: "gryfsmart-door-card", name: "GRYFSMART — Drzwi", description: "Elektrozaczep i kontaktron z niezależnym wyborem modułów i kanałów", preview: true });

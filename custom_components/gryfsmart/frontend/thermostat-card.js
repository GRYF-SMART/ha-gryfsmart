class ThermostatCard extends HTMLElement {
  static getStubConfig(hass) { return { entity: Object.keys(hass?.states || {}).find(id => id.startsWith("climate.") && "regulator_mode" in hass.states[id].attributes) || "" }; }
  static getConfigElement() { return document.createElement("gryfsmart-thermostat-editor"); }
  setConfig(config) {
    if (config.entity && !config.entity.startsWith("climate.")) throw new Error("Wybierz encję climate regulatora.");
    this.config = config;
    if (!this.shadowRoot) {
      this.attachShadow({mode:"open"});
      this.shadowRoot.innerHTML = `<style>
      ha-card{display:block;background:linear-gradient(145deg,#382044,#120c19);color:#fff;padding:24px;text-align:center;border-radius:24px}
      .dial{box-sizing:border-box;display:grid;place-content:center;margin:20px auto;width:min(100%,230px);aspect-ratio:1;border:9px solid #ff477e;border-right-color:#703788;border-bottom-color:#703788;border-radius:50%;box-shadow:0 0 28px #ff477e38}
      strong{font-size:clamp(24px,5vw,48px)}small{color:#dfcde7}button,input{font:inherit;background:#442653;color:#fff;border:1px solid #8d519f;border-radius:10px;padding:9px;margin:3px}button:hover:not(:disabled){background:#703788}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #ff477e;outline-offset:3px}button:disabled{opacity:.45} .active{color:#ff477e} [hidden]{display:none}
      </style><ha-card><h2></h2><div class="dial"><strong></strong><small></small></div>
      <button data-step="-1" aria-label="Zmniejsz temperaturę">−</button><button data-step="1" aria-label="Zwiększ temperaturę">+</button>
      <p class="output"></p><p class="mode"></p><button data-mode="on" title="Wymuś załączenie wyjść niezależnie od temperatury">ON</button><button data-mode="off" title="Wyłącz wyjścia regulatora">OFF</button><button data-mode="auto" title="Reguluj według temperatury zadanej">AUTO</button>
      <details><summary>Temperatura ECO</summary><label>Temperatura °C <input type="number" step="0.1" aria-label="Temperatura ECO"></label><button class="eco">Włącz ECO</button></details><p role="status"></p></ha-card>`;
      this.shadowRoot.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (button && !button.disabled) void this.control(button);
      });
    }
    this.shadowRoot.querySelector("input").value = config.eco_temperature ?? 18;
    this.update();
  }
  set hass(hass) { this._hass = hass; this.update(); }
  update() {
    if (!this.config || !this._hass) return;
    const entity = this._hass.states[this.config.entity];
    const a = entity?.attributes ?? {};
    const root = this.shadowRoot;
    const format = value => Number.isFinite(value) ? value.toLocaleString("pl-PL",{minimumFractionDigits:1}) + " °C" : "—";
    root.querySelector("h2").textContent = this.config.title || a.friendly_name || "Regulator temperatury";
    if (!this.config.entity) root.querySelector('[role="status"]').textContent = "W edytorze karty wybierz regulator GRYFSMART.";
    root.querySelector("strong").textContent = format(a.temperature);
    root.querySelector("small").textContent = "Aktualnie " + format(a.current_temperature);
    const active = a.outputs_active;
    const output = root.querySelector(".output");
    output.textContent = active === true ? "● Wyjścia aktywne" : active === false ? "○ Wyjścia wyłączone" : "◌ Stan wyjść nieznany";
    output.classList.toggle("active",active === true);
    root.querySelector(".mode").textContent = a.regulator_mode === "on" ? "ON · wymuszone załączenie" : a.regulator_mode === "off" ? "OFF · wyłączony" : a.regulator_mode === "auto" ? "AUTO · regulacja temperatury" : "Tryb nieznany";
    for (const button of root.querySelectorAll("button")) button.disabled = Boolean(this.busy || !entity || ["unknown","unavailable"].includes(entity.state));
    root.querySelector('[data-mode="on"]').disabled ||= !a.forced_on_supported;
    root.querySelector('[data-mode="on"]').title = a.forced_on_supported ? "Wymuś załączenie wyjść niezależnie od temperatury" : "Wymaga firmware 32 lub nowszego w R0806T/R0808";
    for (const button of root.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === a.regulator_mode));
  }
  async control(button) {
    const entity = this._hass.states[this.config.entity];
    const a = entity.attributes;
    const input = this.shadowRoot.querySelector("input");
    const status = this.shadowRoot.querySelector('[role="status"]');
    const key = "gryf-thermostat-comfort:" + this.config.entity;
    const service = (name, data = {}) => this._hass.callService("climate",name,{entity_id:this.config.entity,...data});
    const setTemperature = value => {
      if (!Number.isFinite(value) || value < a.min_temp || value > a.max_temp) throw new Error("Temperatura poza zakresem regulatora.");
      return service("set_temperature",{temperature:Number(value.toFixed(2))});
    };
    this.busy = true;
    this.update();
    status.textContent = "";
    try {
      if (button.dataset.step) await setTemperature(Math.max(a.min_temp,Math.min(a.max_temp,a.temperature + Number(button.dataset.step)*(a.target_temp_step || 0.1))));
      else if (button.classList.contains("eco")) {
        const target = input.valueAsNumber;
        if (Number.isFinite(a.temperature) && a.temperature !== target && localStorage.getItem(key) === null) localStorage.setItem(key,String(a.temperature));
        await setTemperature(target);
        await service("set_preset_mode", {preset_mode:"auto"});
      } else if (button.dataset.mode === "auto") {
        const saved = localStorage.getItem(key);
        if (saved !== null) await setTemperature(Number(saved));
        await service("set_preset_mode", {preset_mode:"auto"});
        localStorage.removeItem(key);
      } else await service("set_preset_mode", {preset_mode:button.dataset.mode});
    } catch (error) { status.textContent = error.message || "Błąd sterowania regulatorem."; }
    finally { this.busy = false; this.update(); }
  }
}
class ThermostatEditor extends HTMLElement {
  setConfig(config) {
    this.config = config;
    if (!this.picker) {
      this.picker = document.createElement("ha-entity-picker");
      this.picker.includeDomains = ["climate"];
      this.picker.label = "Regulator";
      this.picker.addEventListener("value-changed", event => {
        this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:{...this.config,entity:event.detail.value}},bubbles:true,composed:true}));
      });
      this.append(this.picker);
      const label = document.createElement("label");
      label.textContent = "Nazwa tej karty (pusta = nazwa regulatora z projektu / HA)";
      this.titleInput = document.createElement("input");
      this.titleInput.type = "text";
      this.titleInput.maxLength = 80;
      this.titleInput.style.cssText = "box-sizing:border-box;width:100%;padding:12px;margin:8px 0;background:var(--card-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color)";
      this.titleInput.addEventListener("change", () => this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:{...this.config,title:this.titleInput.value}},bubbles:true,composed:true})));
      label.append(this.titleInput);
      this.append(label);
    }
    this.picker.value = config.entity;
    this.titleInput.value = config.title || "";
    this.picker.hass = this._hass;
  }
  set hass(hass) { this._hass = hass; if (this.picker) this.picker.hass = hass; }
}
if (!customElements.get("gryfsmart-thermostat-card")) customElements.define("gryfsmart-thermostat-card",ThermostatCard);
if (!customElements.get("gryfsmart-thermostat-editor")) customElements.define("gryfsmart-thermostat-editor",ThermostatEditor);
window.customCards ??= [];
if (!window.customCards.some(card => card.type === "gryfsmart-thermostat-card")) window.customCards.push({type:"gryfsmart-thermostat-card",name:"Regulator temperatury",description:"Regulator sprzętowy z nastawą ECO"});

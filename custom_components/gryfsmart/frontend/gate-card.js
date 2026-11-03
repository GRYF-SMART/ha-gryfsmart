import "./door-card.js";

class GryfGateCard extends HTMLElement {
  static getConfigElement() { return document.createElement("gryfsmart-gate-editor"); }
  static getStubConfig() { return { title: "Brama", duration: 0.5 }; }
  setConfig(config) {
    const duration = Number(config.duration ?? 0.5);
    if (!Number.isFinite(duration) || duration < 0.1 || duration > 60 || Math.abs(duration * 10 - Math.round(duration * 10)) > 1e-8) throw new Error("Czas impulsu: 0,1–60 s, co 0,1 s.");
    if (config.output_entity && !config.output_entity.startsWith("switch.")) throw new Error("Wybierz wyjście przekaźnikowe switch.");
    this.config = { ...config, duration };
    if (!this.shadowRoot) {
      this.attachShadow({mode:"open"});
      this.shadowRoot.innerHTML = `<style>
      ha-card{display:block;padding:24px;border-radius:24px;background:linear-gradient(145deg,#382044,#120c19);color:#fff;text-align:center;font-family:var(--primary-font-family,Roboto,"Segoe UI",Arial,sans-serif)}h2{margin:0 0 20px;font-size:24px}button{display:flex;flex-direction:column;align-items:center;gap:14px;width:100%;min-height:180px;padding:20px;border:2px solid #8d519f;border-radius:22px;background:#442653;color:#fff;font:inherit;cursor:pointer}button:hover:not(:disabled){background:#703788}button:focus-visible{outline:3px solid #ff477e;outline-offset:4px}button:disabled{opacity:.6;cursor:default}svg{width:100%;max-width:220px;height:100px;color:#ff477e}strong{font-size:20px}small{display:block;color:#dfcde7;margin:12px 0;overflow-wrap:anywhere}.output{font-weight:700}.output.active{color:#ff477e}.status{font-size:13px;overflow-wrap:anywhere}.status:empty{display:none}
      </style><ha-card><h2></h2><button type="button"><svg viewBox="0 0 160 80" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 70V18h12v52M138 70V18h12v52M22 30h116M22 60h116M80 30v40M32 30v30m12-30v30m12-30v30m12-30v30m24-30v30m12-30v30m12-30v30m12-30v30M6 70h148"/><path d="m72 45 5 5-5 5m16-10-5 5 5 5"/></svg><strong>Uruchom bramę</strong><span></span></button><p class="output"></p><small class="name"></small><small>Położenie bramy nie jest mierzone przez tę kartę.</small><p class="status" role="status" aria-live="polite"></p></ha-card>`;
      this.shadowRoot.querySelector("button").onclick = () => this.pulse();
    }
    this.update();
  }
  set hass(hass) { this._hass = hass; this.update(); }
  update() {
    if (!this.config || !this._hass) return;
    const output = this._hass.states[this.config.output_entity], root = this.shadowRoot;
    const known = ["on", "off"].includes(output?.state);
    root.querySelector("h2").textContent = this.config.title || "Brama";
    root.querySelector("button").disabled = !!this.busy || Date.now() < (this.until || 0) || !known || output.state === "on";
    root.querySelector("button span").textContent = `Impuls ${this.config.duration.toLocaleString("pl-PL", {minimumFractionDigits:1})} s`;
    root.querySelector(".output").textContent = !known ? "Wyjście niedostępne lub niewybrane" : output.state === "on" ? "Wyjście załączone" : "Wyjście rozwarte";
    root.querySelector(".output").classList.toggle("active", output?.state === "on");
    root.querySelector(".name").textContent = output?.attributes.friendly_name || this.config.output_entity || "Wybierz moduł i wyjście w edytorze.";
    root.querySelector(".status").textContent = this.message || "";
  }
  async pulse() {
    if (this.busy || Date.now() < (this.until || 0) || this._hass?.states[this.config.output_entity]?.state !== "off") return;
    this.busy = true; this.message = "Wysyłanie impulsu…"; this.update(); let timeout;
    try {
      await Promise.race([
        this._hass.callService("gryfsmart", "pulse", {entity_id:this.config.output_entity, duration:this.config.duration}),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Brak potwierdzenia impulsu. Sprawdź bramę przed kolejną próbą.")), 15000); })
      ]);
      this.message = "Impuls przyjęty. Moduł automatycznie wyłączy wyjście.";
    } catch (error) { this.message = error.message || "Błąd wysyłania impulsu."; }
    finally {
      clearTimeout(timeout); this.busy = false;
      this.until = Date.now() + this.config.duration * 1000;
      clearTimeout(this.refreshTimer); this.refreshTimer = setTimeout(() => this.update(), this.config.duration * 1000 + 20);
      this.update();
    }
  }
  disconnectedCallback() { clearTimeout(this.refreshTimer); }
  connectedCallback() { this.update(); }
  getCardSize() { return 5; }
}
class GryfGateEditor extends customElements.get("gryfsmart-door-editor") { constructor() { super(); this.gate = true; } }
if (!customElements.get("gryfsmart-gate-card")) customElements.define("gryfsmart-gate-card", GryfGateCard);
if (!customElements.get("gryfsmart-gate-editor")) customElements.define("gryfsmart-gate-editor", GryfGateEditor);
window.customCards ??= [];
if (!window.customCards.some(c => c.type === "gryfsmart-gate-card")) window.customCards.push({type:"gryfsmart-gate-card", name:"GRYFSMART — Brama", description:"Impuls bramy z wyborem wyjścia i czasu co 0,1 s", preview:true});

/* Optional Lovelace card showing every GRYFSMART output and PWM control. */
class GryfSmartSystemCard extends HTMLElement {
  setConfig(config) {
    if (config && Object.keys(config).length) throw new Error("Ta karta nie wymaga konfiguracji.");
    this._config = {};
    this._groups = [];
    this._lastFetch = 0;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}.wrap{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))}
      .status{padding:16px;color:var(--secondary-text-color)}
    </style><div class="wrap"></div>`;
  }

  set hass(value) {
    this._hass = value;
    this.refresh();
    if (this._helpers) this.render();
  }

  async refresh() {
    if (!this._hass || Date.now() - this._lastFetch < 30000) return;
    this._lastFetch = Date.now();
    try {
      const groups = await this._hass.callWS({ type: "gryfsmart/system_entities" });
      const byModule = new Map();
      for (const item of groups) {
        const key = `${item.entry}:${item.module}`;
        if (!byModule.has(key)) byModule.set(key, { title: item.module, entities: [] });
        byModule.get(key).entities.push(item.entity_id);
      }
      this._groups = [...byModule.values()];
      this._helpers ??= await window.loadCardHelpers();
      this.render();
    } catch (error) {
      this.shadowRoot.querySelector(".wrap").innerHTML =
        `<div class="status">Nie udało się pobrać encji GRYFSMART. Odśwież kartę za chwilę.</div>`;
      console.warn("GRYFSMART system card:", error);
    }
  }

  render() {
    if (!this._helpers || !this._hass) return;
    const root = this.shadowRoot.querySelector(".wrap");
    const groups = this._groups;
    root.replaceChildren();
    if (!groups.length) {
      root.innerHTML = `<div class="status">Nie znaleziono encji wyjść ani PWM.</div>`;
      return;
    }
    for (const group of groups) {
      const card = this._helpers.createCardElement({
        type: "entities",
        title: group.title,
        show_header_toggle: false,
        entities: group.entities,
      });
      card.hass = this._hass;
      root.append(card);
    }
  }

  getCardSize() {
    return Math.max(1, this._groups.reduce((size, group) => size + group.entities.length + 1, 0));
  }
}

if (!customElements.get("gryfsmart-system-card")) {
  customElements.define("gryfsmart-system-card", GryfSmartSystemCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "custom:gryfsmart-system-card")) {
  window.customCards.push({
    type: "custom:gryfsmart-system-card",
    name: "GRYFSMART — cała instalacja",
    description: "Wyjścia i PWM wszystkich modułów GRYFSMART.",
    preview: false,
  });
}

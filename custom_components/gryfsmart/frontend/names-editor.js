class GryfNamesEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:"open"}); }
  set hass(value) { this._hass = value; if (this.isConnected && !this.started) this.start(); }
  connectedCallback() { if (this._hass && !this.started) this.start(); }
  async api(action, data = {}) {
    let timer;
    try {
      return await Promise.race([
        this._hass.callWS({type:"gryfsmart/names",action,...data}),
        new Promise((_,reject) => { timer = setTimeout(() => reject(new Error("Brak odpowiedzi HA. Odśwież listę i sprawdź nazwy przed ponowieniem.")),15000); })
      ]);
    } finally { clearTimeout(timer); }
  }
  start() {
    this.started = true;
    this.shadowRoot.innerHTML = `<style>
    :host{display:block;margin-bottom:18px}section{padding:22px;border:1px solid var(--divider-color,#ddd);border-radius:14px;background:var(--card-background-color,white)}h2{font-size:19px;margin-top:0}label{display:block;margin:12px 0}input,select,button{font:inherit;color:inherit;background:var(--card-background-color,white);border:1px solid var(--divider-color,#ccc);border-radius:7px;padding:10px;max-width:100%;box-sizing:border-box}button{cursor:pointer;margin:4px}button:disabled{opacity:.5}.hint{color:var(--secondary-text-color);line-height:1.6}.status{white-space:pre-wrap}.error{color:var(--error-color,#ba263e)}</style>
    <section><h2>Nazwy z projektu i nazwy regulatorów</h2>
    <label>Instalacja <select class="network" aria-label="Instalacja nazw"></select></label>
    <label>Projekt GRYFEXPERT <input type="file" accept=".json,.gryf.json" aria-label="Projekt GRYFEXPERT"></label>
    <button class="import">Importuj nazwy i grupy z projektu</button><button class="refresh">Odśwież listę</button>
    <p class="hint">Import zapisuje w HA grupy pomieszczeń oraz nazwy modułów, wejść, wyjść, PWM, czujników i regulatorów. Sprawdza ID i model. Nie wysyła reguł ani poleceń do sprzętu. Nazwy zaimportowane lub zmienione tutaj mają pierwszeństwo przed EEPROM. Własne nazwy nadane w ustawieniach encji HA pozostają nadrzędne.</p>
    <label>Regulator <select class="regulator" aria-label="Regulator do nazwania"></select></label>
    <label>Nazwa panelu / regulatora <input class="name" maxlength="18" aria-label="Nazwa panelu / regulatora"></label>
    <button class="rename">Zapisz nazwę w HA</button><p class="status" role="status"></p></section>`;
    const q = s => this.shadowRoot.querySelector(s);
    q(".network").onchange = () => this.regulators();
    q(".regulator").onchange = () => this.selectedName();
    q(".refresh").onclick = () => this.run(() => this.load());
    q(".rename").onclick = () => this.run(async () => {
      const [module,channel] = q(".regulator").value.split(":").map(Number);
      if (!module || !channel) throw new Error("Wybierz regulator");
      await this.api("rename",{entry:q(".network").value,module,channel,name:q(".name").value});
      await this.load();
      this.status("Nazwa regulatora zapisana w HA. Karty bez własnego tytułu użyją tej nazwy.");
    });
    q(".import").onclick = () => this.run(async () => {
      const file = q('input[type="file"]').files[0];
      if (!file || file.size > 10000000) throw new Error("Wybierz projekt GRYFEXPERT (maks. 10 MB)");
      const parsed = JSON.parse(await file.text());
      const project = Object.fromEntries(Object.entries(parsed).map(([k,v]) => [k.toLowerCase(),v]));
      if (!Array.isArray(project.devices)) throw new Error("Plik nie zawiera modułów projektu");
      const fields = ["id","model","name","inputnames","outputnames","regulatornames","temperaturenames","pwmname","inputgroups","outputgroups","thermostatgroups","pwmgroup"];
      const devices = project.devices.map(d => Object.fromEntries(Object.entries(d).map(([k,v]) => [k.toLowerCase(),v]).filter(([k]) => fields.includes(k))));
      const result = await this.api("import",{entry:q(".network").value,project:{devices,...(project.roomgroups!==undefined?{roomgroups:project.roomgroups}:{})}});
      await this.load();
      this.status(`Zaimportowano ${result.count} nazw oraz przypisania grup z projektu do HA. Konfiguracja sprzętu pozostała bez zmian.`);
    });
    void this.run(() => this.load());
  }
  status(text, error = false) { const e=this.shadowRoot.querySelector(".status"); e.textContent=text; e.classList.toggle("error",error); }
  async run(work) {
    if (this.busy) return;
    this.busy=true;
    for(const e of this.shadowRoot.querySelectorAll("button,input,select")) e.disabled=true;
    this.status("Przetwarzanie nazw…");
    try { await work(); }
    catch(e) { this.status(e.message || String(e),true); }
    finally { this.busy=false; for(const e of this.shadowRoot.querySelectorAll("button,input,select")) e.disabled=false; }
  }
  option(select,value,text) { const o=document.createElement("option");o.value=value;o.textContent=text;select.append(o); }
  async load() {
    this.networks=await this.api("list");
    const select=this.shadowRoot.querySelector(".network"), selected=select.value;
    select.replaceChildren();
    for(const n of this.networks) this.option(select,n.entry,n.title);
    if(this.networks.some(n=>n.entry===selected)) select.value=selected;
    this.regulators();this.status("Lista nazw gotowa.");
  }
  regulators() {
    const network=this.networks.find(n=>n.entry===this.shadowRoot.querySelector(".network").value);
    const select=this.shadowRoot.querySelector(".regulator"), selected=select.value;
    select.replaceChildren();
    for(const m of network?.modules || []) for(let n=1;n<=m.thermostats;n++) this.option(select,`${m.id}:${n}`,`${m.names.module || m.model} · ID ${m.id} · ${m.names["thermostat_"+n] || "Regulator "+n}`);
    if([...select.options].some(o=>o.value===selected)) select.value=selected;
    this.selectedName();
  }
  selectedName() {
    const [id,n]=this.shadowRoot.querySelector(".regulator").value.split(":").map(Number);
    const network=this.networks.find(x=>x.entry===this.shadowRoot.querySelector(".network").value);
    this.shadowRoot.querySelector(".name").value=network?.modules.find(m=>m.id===id)?.names["thermostat_"+n] || (n ? "Regulator "+n : "");
  }
}
if(!customElements.get("gryfsmart-names-editor")) customElements.define("gryfsmart-names-editor",GryfNamesEditor);

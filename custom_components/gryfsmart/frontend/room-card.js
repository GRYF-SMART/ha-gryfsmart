const gryfRoomIcons = {
  salon: ["Salon", "M4 12V6h16v6M3 10H1v10h22V10h-2v6H3zM4 20v2m16-2v2"],
  kitchen: ["Kuchnia", "M4 2v7m3-7v7M1 2v7h9V2M5 9v13M18 2v20m0-20c-5 3-5 10 0 10"],
  bathroom: ["Łazienka", "M2 12h20v3a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5zM5 12V4a2 2 0 0 1 4 0v2M4 22l2-2m14 2-2-2"],
  bedroom: ["Sypialnia", "M2 21V6m20 15V6M2 16h20M2 9h20v7M6 9V5h5v4m2 0V5h5v4"],
  living: ["Pokój dzienny", "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"],
  garden: ["Ogród", "M12 22V9m0 7c-8 0-10-6-10-12 7 0 10 4 10 9m0-1c0-7 5-10 10-10 0 8-3 12-10 12"],
  office: ["Gabinet", "M2 13h20M4 13v9m16-9v9M6 3h12v7H6zM12 10v3M8 22h8"],
  child: ["Pokój dziecięcy", "M7 4a3 3 0 1 0-4 4m14-4a3 3 0 1 1 4 4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8 10h.1m7.9 0h.1M9 15q3 3 6 0"],
  garage: ["Garaż", "M2 22V8l10-6 10 6v14M6 22V11h12v11M6 15h12M6 19h12"],
  hallway: ["Przedpokój", "M5 22V2h14v20M5 2l10 3v17H2m9-10h.1M19 22h3"],
  dining: ["Jadalnia", "M3 10h18M6 10v12m12-12v12M1 4v12h4m18-12v12h-4M8 5h8"],
  terrace: ["Taras", "M2 10q10-17 20 0zM12 10v12M6 22h12M2 15h5v5H2m15-5h5v5h-5"],
};
const gryfRoomSvg = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
class GryfRoomCard extends HTMLElement {
  static getConfigElement() { return document.createElement("gryfsmart-room-editor"); }
  static getStubConfig() { return { title: "Salon", icon: "salon", buttons: [] }; }
  setConfig(config) {
    if (config.buttons !== undefined && (!Array.isArray(config.buttons) || config.buttons.some(b => !b || typeof b !== "object" || (b.entity && (typeof b.entity !== "string" || !b.entity.startsWith("switch.")))))) throw new Error("Każdy przycisk wymaga wyjścia switch.");
    this.config = {title:"Pomieszczenie", icon:"salon", buttons:[], ...config};
    this.pending ??= new Set(); this.errors ??= new Map();
    if (!this.shadowRoot) this.attachShadow({mode:"open"});
    const signature = JSON.stringify(this.config);
    if (signature !== this.signature) {
      this.signature = signature;
      this.shadowRoot.innerHTML = `<style>
        ha-card{display:block;padding:22px;background:linear-gradient(145deg,#382044,#120c19);color:#fff;border-radius:24px;font-family:var(--primary-font-family,Roboto,"Segoe UI",Arial,sans-serif)}header{display:flex;align-items:center;gap:15px;margin-bottom:22px}header svg{width:42px;height:42px;color:#ff477e;flex-shrink:0}h2{margin:0;font-size:24px;overflow-wrap:anywhere}.buttons{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(135px,100%),1fr));gap:12px}button{position:relative;display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 12px;min-height:135px;font:inherit;color:#dfcde7;background:#442653;border:1px solid #8d519f;border-radius:18px;cursor:pointer;overflow-wrap:anywhere;min-width:0}button svg{width:30px;height:30px}button strong{font-size:15px;max-width:100%}button small{font-size:12px}button.on{color:#fff;background:linear-gradient(135deg,#873c9e,#a63570);border:2px solid #ff477e;box-shadow:0 0 16px #ff477e33}button.on svg{color:#ffd66e}button.unknown{background:#302c36;color:#aba4b3;border-color:#625a69}button:disabled{cursor:default}button:focus-visible{outline:3px solid #ff477e;outline-offset:3px}button:hover:not(:disabled){border-color:#ff477e}.error{color:#ffb2c4;font-size:12px}.empty{color:#dfcde7;line-height:1.5}
      </style><ha-card><header>${gryfRoomSvg((gryfRoomIcons[this.config.icon] || gryfRoomIcons.salon)[1])}<h2></h2></header><div class="buttons"></div><p class="empty"></p></ha-card>`;
      this.shadowRoot.querySelector("h2").textContent = this.config.title || "Pomieszczenie";
      this.shadowRoot.querySelector(".empty").textContent = this.config.buttons.length ? "" : "Dodaj przyciski w edytorze karty i wybierz ich moduły oraz wyjścia.";
      this.nodes = this.config.buttons.map((item,index) => {
        const button = document.createElement("button"); button.type="button";
        button.innerHTML = `${gryfRoomSvg("M8 16c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7zM9 19h6m-5 3h4")}<strong></strong><small class="state"></small><small class="error" role="status"></small>`;
        button.onclick=()=>this.control(index); this.shadowRoot.querySelector(".buttons").append(button); return button;
      });
    }
    this.update();
  }
  set hass(hass) { this._hass=hass; this.update(); }
  update() {
    if (!this._hass || !this.config) return;
    this.config.buttons.forEach((item,index) => {
      const entity=this._hass.states[item.entity], known=["on","off"].includes(entity?.state), on=entity?.state==="on", busy=this.pending.has(item.entity), node=this.nodes[index];
      const name=item.name || entity?.attributes.friendly_name || `Przycisk ${index+1}`;
      node.className=!known?"unknown":on?"on":"off";
      node.disabled=!known || busy; node.setAttribute("aria-pressed",String(known&&on));
      node.querySelector("strong").textContent=name;
      node.querySelector(".state").textContent=busy?"Wysyłanie…":!known?"Niedostępne":on?"Włączone":"Wyłączone";
      node.querySelector(".error").textContent=this.errors.get(item.entity)||"";
      node.setAttribute("aria-label",`${name} — ${!known?"niedostępne":on?"włączone, kliknij aby wyłączyć":"wyłączone, kliknij aby włączyć"}`);
    });
  }
  async control(index) {
    const entity=this.config.buttons[index]?.entity;
    if(this.pending.has(entity)||!["on","off"].includes(this._hass?.states[entity]?.state))return;
    this.pending.add(entity);this.errors.delete(entity);this.update();let timeout;
    try {
      await Promise.race([this._hass.callService("switch","toggle",{entity_id:entity}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error("Brak potwierdzenia. Sprawdź stan przed ponowną próbą.")),15000);})]);
    } catch(error) {this.errors.set(entity,error.message||"Błąd sterowania");}
    finally{clearTimeout(timeout);this.pending.delete(entity);this.update();}
  }
  getCardSize(){return 2+Math.ceil((this.config?.buttons.length||1)/2)*2;}
}
class GryfRoomEditor extends HTMLElement {
  setConfig(config){this.config={title:"Pomieszczenie",icon:"salon",...config,buttons:(config.buttons||[]).map(b=>({...b}))};this.render();}
  set hass(hass){this._hass=hass;if(!this.attempted)void this.load();}
  async load(){this.attempted=true;let timer;try{this.items=await Promise.race([this._hass.callWS({type:"gryfsmart/system_entities"}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Przekroczono czas odczytu modułów")),15000);})]);this.error="";}catch(e){this.error=e.message||"Błąd odczytu modułów";}finally{clearTimeout(timer);this.render();}}
  change(patch){this.config={...this.config,...patch};this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:this.config},bubbles:true,composed:true}));}
  rowChange(index,patch){this.change({buttons:this.config.buttons.map((b,i)=>i===index?{...b,...patch}:b)});}
  render(){
    if(!this.config)return;this.replaceChildren();
    const style=document.createElement("style");style.textContent="gryfsmart-room-editor label{display:block;margin:12px 0}gryfsmart-room-editor input,gryfsmart-room-editor select{box-sizing:border-box;display:block;width:100%;padding:10px;margin-top:5px;background:var(--card-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:8px}gryfsmart-room-editor fieldset{min-width:0;margin:15px 0;border:1px solid var(--divider-color);border-radius:12px}gryfsmart-room-editor button{padding:10px;margin:6px;background:#703788;color:white;border:0;border-radius:8px;cursor:pointer}";this.append(style);
    const field=(parent,text,control)=>{control.setAttribute("aria-label",text);const label=document.createElement("label");label.append(document.createTextNode(text),control);parent.append(label);return control;};
    const select=(parent,text,options,value)=>{const control=field(parent,text,document.createElement("select"));for(const [v,n] of options)control.add(new Option(n,v));control.value=value||"";return control;};
    const icon=select(this,"Ikona pomieszczenia",Object.entries(gryfRoomIcons).map(([k,v])=>[k,v[0]]),this.config.icon);icon.onchange=()=>this.change({icon:icon.value});
    const title=field(this,"Nazwa pomieszczenia",document.createElement("input"));title.value=this.config.title;title.maxLength=80;title.onchange=()=>this.change({title:title.value});
    const rows=(this.items||[]).filter(i=>i.entity_id.startsWith("switch.")),key=i=>`${i.entry}/${i.model}/${i.module_id}`;
    this.moduleChoices??={};
    this.config.buttons.forEach((item,index)=>{
      const box=document.createElement("fieldset"),legend=document.createElement("legend");legend.textContent=`Przycisk ${index+1}`;box.append(legend);this.append(box);
      const name=field(box,`Nazwa przycisku ${index+1}`,document.createElement("input"));name.value=item.name||"";name.placeholder="Pusta = nazwa wyjścia z HA";name.maxLength=80;name.onchange=()=>this.rowChange(index,{name:name.value});
      const found=rows.find(r=>r.entity_id===item.entity),chosen=found?key(found):this.moduleChoices[index]||"";
      const modules=new Map(rows.map(r=>[key(r),`${r.module} · ID ${r.module_id} · ${r.model} · ${r.hub}`]));
      const module=select(box,`Moduł przycisku ${index+1}`,[["","Wybierz moduł"],...modules],chosen);
      module.onchange=()=>{this.moduleChoices[index]=module.value;this.rowChange(index,{entity:""});this.render();};
      const options=rows.filter(r=>key(r)===chosen).map(r=>[r.entity_id,`WY${r.channel} · ${r.name}`]);
      if(item.entity&&!found)options.push([item.entity,`${item.entity} (brak na liście)`]);
      const output=select(box,`Wyjście przycisku ${index+1}`,[["","Wybierz wyjście"],...options],item.entity);output.onchange=()=>this.rowChange(index,{entity:output.value});
      const remove=document.createElement("button");remove.textContent=`Usuń przycisk ${index+1}`;remove.onclick=()=>{this.moduleChoices={};this.change({buttons:this.config.buttons.filter((_,i)=>i!==index)});this.render();};box.append(remove);
    });
    const add=document.createElement("button");add.textContent="＋ Dodaj przycisk";add.onclick=()=>{this.change({buttons:[...this.config.buttons,{name:"",entity:""}]});this.render();};this.append(add);
    const refresh=document.createElement("button");refresh.textContent="Odśwież moduły i nazwy";refresh.onclick=()=>this.load();this.append(refresh);
    if(this.error){const error=document.createElement("p");error.textContent=this.error;error.setAttribute("role","status");this.append(error);}
  }
}
if(!customElements.get("gryfsmart-room-card"))customElements.define("gryfsmart-room-card",GryfRoomCard);
if(!customElements.get("gryfsmart-room-editor"))customElements.define("gryfsmart-room-editor",GryfRoomEditor);
window.customCards??=[];
if(!window.customCards.some(c=>c.type==="gryfsmart-room-card"))window.customCards.push({type:"gryfsmart-room-card",name:"GRYFSMART — Pomieszczenie",description:"Pokój z ikoną i dowolną liczbą przycisków oświetlenia",preview:true});

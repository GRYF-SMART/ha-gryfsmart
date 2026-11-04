/* Rooms imported from GRYFEXPERT. All actions use ordinary HA entity services. */
class GryfHomeCard extends HTMLElement {
  static getStubConfig() { return {title:"Mój dom",show_summary:true}; }
  static getConfigElement() { return document.createElement("gryfsmart-home-editor"); }
  constructor(){
    super();this.attachShadow({mode:"open"});this.rows=[];this.nodes=[];this.pending=new Set();
    this.shadowRoot.innerHTML=`<style>
    :host{display:block;min-width:0}ha-card{display:block;padding:20px;background:linear-gradient(145deg,#382044,#120c19);color:#fff;border-radius:24px;font-family:var(--primary-font-family,Roboto,Arial,sans-serif)}header{display:flex;align-items:center;gap:10px}h2{flex:1;margin:0;font-size:24px}button,input{font:inherit}button{color:#fff;background:#442653;border:1px solid #8d519f;border-radius:12px;padding:12px;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:3px solid #ff477e;outline-offset:2px}.summary{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.summary span{background:#442653;border-radius:12px;padding:12px;flex:1;min-width:100px}.door{padding:14px 0;border-bottom:1px solid #694675}.contact{margin:10px 0;color:#dfcde7}.tabs{display:flex;overflow-x:auto;gap:8px;padding:16px 0}.tabs button{white-space:nowrap}.tabs button[aria-selected=true]{background:#793b96;border-color:#ff477e}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px}.item{min-width:0;padding:15px;background:#35203f;border:1px solid #694675;border-radius:16px}.item h3{margin:0 0 10px;font-size:16px;overflow-wrap:anywhere}.item button.toggle{width:100%;min-height:85px}.on{background:#873c9e!important;border-color:#ff477e!important;box-shadow:0 0 15px #ff477e33}.unknown{color:#b4acbb}.item input{width:100%;accent-color:#ff477e;box-sizing:border-box}.state{display:block;margin:9px 0;color:#dfcde7}.controls{display:flex;gap:6px;flex-wrap:wrap}.status{color:#ffbdcc;white-space:pre-line;font-size:13px}.hint{color:#dfcde7;font-size:13px;line-height:1.5}[hidden]{display:none!important}.lock-icon{display:inline-block;width:20px;height:20px;vertical-align:middle;margin-right:8px}ha-card>header button{padding:8px}.grid>*.climate{grid-column:1/-1}
    </style><ha-card><header><h2></h2><button class="refresh" aria-label="Odśwież grupy">↻</button></header><div class="summary" role="status"></div><section class="door" hidden><button class="lock"><svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path/></svg><span></span></button><p class="contact"></p></section><nav class="tabs" role="tablist" aria-label="Pomieszczenia"></nav><div class="actions"></div><div class="grid" role="tabpanel"></div><p class="hint"></p><p class="status" role="status"></p></ha-card>`;
    this.q(".refresh").onclick=()=>this.refresh();
    this.q(".lock").onclick=()=>this.control(this.config.door_output,"switch","toggle");
  }
  q(s){return this.shadowRoot.querySelector(s);}
  setConfig(config){
    for(const [key,prefix] of [["door_output","switch."],["door_contact","binary_sensor."]])if(config[key]&&!(typeof config[key]==="string"&&config[key].startsWith(prefix)))throw Error("Nieprawidłowa encja: "+key);
    for(const key of ["groups","exclude_entities"])if(config[key]!==undefined&&(!Array.isArray(config[key])||config[key].some(x=>typeof x!=="string")))throw Error(key+" musi być listą tekstów.");
    if(config.contact_closed_state&&!['on','off'].includes(config.contact_closed_state))throw Error("Stan zamkniętego kontaktronu: on lub off.");
    this.config={title:"Mój dom",show_summary:true,contact_closed_state:"on",...config};this.signature=null;this.render();this.refresh();
  }
  connectedCallback(){clearInterval(this.timer);this.timer=setInterval(()=>this.refresh(),30000);this.refresh();}
  disconnectedCallback(){clearInterval(this.timer);this.fetching=null;}
  set hass(hass){this._hass=hass;this.update();if(!this.loaded)this.refresh();}
  async bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Brak odpowiedzi HA. Odśwież grupy i sprawdź połączenie.")),15000);})]);}finally{clearTimeout(timer);}}
  async refresh(){
    if(!this.isConnected||!this._hass||!this.config||this.fetching)return;
    const request={};this.fetching=request;this.q('.refresh').disabled=true;
    try{const rows=await this.bounded(this._hass.callWS({type:"gryfsmart/system_entities"}));if(this.fetching!==request||!this.isConnected)return;if(!Array.isArray(rows))throw Error("Nieprawidłowa lista encji");this.rows=rows;this.loaded=true;this.render();this.q('.status').textContent="";}
    catch(e){if(this.fetching===request)this.q('.status').textContent=e.message;}
    finally{if(this.fetching===request){this.fetching=null;this.q('.refresh').disabled=false;}}
  }
  selectedRows(){return this.rows.filter(r=>r.group?.id&&(!this.config.entry||r.entry===this.config.entry)&&(!this.config.groups?.length||this.config.groups.includes(r.group.id))&&!this.config.exclude_entities?.includes(r.entity_id)&&r.entity_id!==this.config.door_output&&['switch','cover','number','climate','binary_sensor','sensor'].includes(r.entity_id.split('.')[0]));}
  render(){
    if(!this.config)return;
    this.q('h2').textContent=this.config.title;this.visible=this.selectedRows();
    const sig=JSON.stringify([this.config,this.visible]);if(sig!==this.signature){
      this.signature=sig;this.groups=new Map();for(const row of this.visible){const key=row.entry+'/'+row.group.id;if(!this.groups.has(key))this.groups.set(key,{...row.group,rows:[]});this.groups.get(key).rows.push(row);}
      if(!this.groups.has(this.active))this.active=this.groups.keys().next().value;
      this.q('.tabs').replaceChildren();for(const [key,group] of this.groups){const b=document.createElement('button');b.textContent=(group.icon||'🏠')+' '+group.name;b.setAttribute('role','tab');b.onclick=()=>{this.active=key;this.renderGroup();};b.dataset.key=key;this.q('.tabs').append(b);}
      this.renderGroup();
    }
    this.q('.hint').textContent=this.visible.length?'Podsumowanie obejmuje tylko widoczne elementy przypisane do grup. Wyjścia przekaźnikowe i PWM są liczone jako obwody oświetlenia.':'Brak przypisanych elementów. W GRYFEXPERT przypisz grupy, zapisz projekt i zaimportuj go w „GRYFSMART — Konfiguracja” → „Importuj nazwy i grupy z projektu”.';
    this.update();
  }
  renderGroup(){
    for(const b of this.q('.tabs').children)b.setAttribute('aria-selected',String(b.dataset.key===this.active));
    this.q('.grid').replaceChildren();this.q('.actions').replaceChildren();this.nodes=[];
    const rows=this.groups?.get(this.active)?.rows||[];
    for(const [label,kind] of [['Wyłącz całe oświetlenie','lights'],['Zamknij rolety w pomieszczeniu','covers']]){
      const targets=rows.filter(r=>kind==='covers'?r.entity_id.startsWith('cover.'):['switch','number'].includes(r.entity_id.split('.')[0]));
      if(targets.length){const b=document.createElement('button');b.textContent=label;b.onclick=()=>this.groupControl(targets,kind);this.q('.actions').append(b);}
    }
    for(const row of rows){
      const node=document.createElement('article');node.className='item';const title=document.createElement('h3');title.textContent=row.name;node.append(title);
      const state=document.createElement('span');state.className='state';node.append(state);
      const domain=row.entity_id.split('.')[0];const record={row,node,state,domain,buttons:[]};
      const button=(name,service)=>{const b=document.createElement('button');b.textContent=name;b.setAttribute('aria-label',row.name+' — '+name);b.onclick=()=>this.control(row.entity_id,domain,service);node.append(b);record.buttons.push(b);return b;};
      if(domain==='switch'){const b=button('💡 Przełącz','toggle');b.className='toggle';}
      if(domain==='cover'){button('↑ Otwórz','open_cover');button('■ Stop','stop_cover');button('↓ Zamknij','close_cover');}
      if(domain==='number'){const input=document.createElement('input');input.type='range';input.min=0;input.max=100;input.step=1;input.setAttribute('aria-label',row.name+' — poziom PWM');input.oninput=()=>{record.dragging=true;state.textContent='Ustaw: '+input.value+'%';};input.onchange=()=>{record.dragging=false;this.control(row.entity_id,'number','set_value',{value:Number(input.value)});};input.onblur=()=>{record.dragging=false;this.update();};record.slider=input;node.append(input);}
      if(domain==='climate'){
        const child=document.createElement('gryfsmart-thermostat-card');
        if(typeof child.setConfig==='function'){child.setConfig({entity:row.entity_id,title:row.name});record.child=child;node.append(child);}
        else{const b=document.createElement('button');b.textContent='Otwórz regulator';b.onclick=()=>this.dispatchEvent(new CustomEvent('hass-more-info',{detail:{entityId:row.entity_id},bubbles:true,composed:true}));node.append(b);}
      }
      this.nodes.push(record);this.q('.grid').append(node);
    }
    this.update();
  }
  known(id){return !!this._hass?.states[id]&&!['unknown','unavailable'].includes(this._hass.states[id].state);}
  update(){
    if(!this._hass||!this.config)return;
    const rows=this.visible||[];let lights=0,open=0,closed=0,partial=0,unknown=0;
    for(const r of rows){const id=r.entity_id,d=id.split('.')[0],s=this._hass.states[id];if(!['switch','number','cover'].includes(d))continue;if(!this.known(id)){unknown++;continue;}if(d==='switch'){if(s.state==='on')lights++;}else if(d==='number'){if(Number(s.state)>0)lights++;}else if(s.state==='closed'||s.attributes.current_position===0)closed++;else if(s.attributes.current_position===100)open++;else if(Number.isFinite(s.attributes.current_position)||['opening','closing'].includes(s.state))partial++;else if(s.state==='open')open++;else unknown++;}
    this.q('.summary').hidden=!this.config.show_summary;this.q('.summary').replaceChildren();for(const text of [`💡 Włączone obwody: ${lights}`,`▤ Otwarte rolety: ${open}`,`▥ Zamknięte rolety: ${closed}`,`↕ Częściowo / w ruchu: ${partial}`,`? Brak danych: ${unknown}`]){const s=document.createElement('span');s.textContent=text;this.q('.summary').append(s);}
    this.q('.door').hidden=!this.config.door_output&&!this.config.door_contact;
    const lock=this.q('.lock'),locked=this._hass.states[this.config.door_output]?.state==='on';lock.hidden=!this.config.door_output;lock.disabled=!this.known(this.config.door_output)||this.pending.has(this.config.door_output);lock.classList.toggle('on',locked);lock.setAttribute('aria-pressed',String(locked));lock.querySelector('path').setAttribute('d',locked?'M5 10h14v12H5zM8 10V6a4 4 0 0 1 8 0v4':'M5 10h14v12H5zM8 10V6a4 4 0 0 1 8 0');lock.querySelector('span').textContent=(this.config.door_name||'Drzwi')+' · '+(!this.known(this.config.door_output)?'stan zamka nieznany':locked?'Zamek zamknięty':'Zamek otwarty');
    this.q('.contact').textContent=!this.config.door_contact?'Wybierz kontaktron w ustawieniach karty.':!this.known(this.config.door_contact)?'Kontaktron: brak danych':this._hass.states[this.config.door_contact].state===this.config.contact_closed_state?'Skrzydło drzwiowe zamknięte':'Skrzydło drzwiowe otwarte';
    for(const n of this.nodes){const id=n.row.entity_id,s=this._hass.states[id],known=this.known(id),busy=this.pending.has(id),on=n.domain==='switch'?s?.state==='on':n.domain==='number'&&Number(s?.state)>0;n.node.classList.toggle('on',!!on);n.node.classList.toggle('unknown',!known);for(const b of n.buttons)b.disabled=!known||busy;
      if(!n.dragging)n.state.textContent=!known?'Niedostępne':n.domain==='switch'?(on?'Włączone':'Wyłączone'):n.domain==='number'?s.state+'%':n.domain==='binary_sensor'?(s.state==='on'?'Zwarte':'Rozwarte'):n.domain==='cover'?({open:'Otwarte',closed:'Zamknięte',opening:'Otwieranie',closing:'Zamykanie'}[s.state]||'Brak pozycji')+(Number.isFinite(s.attributes.current_position)?' · '+s.attributes.current_position+'%':''):n.domain==='climate'?(s.attributes.current_temperature??'—')+' °C':s.state+' '+(s.attributes.unit_of_measurement||'');
      if(n.slider){n.slider.disabled=!known||busy;if(!n.dragging)n.slider.value=known?s.state:0;}
      if(n.child)n.child.hass=this._hass;
    }
    for(const b of this.q('.actions').children)b.disabled=!!this.groupBusy;
  }
  async control(id,domain,service,data={},quiet=false){
    if(!this.known(id)||this.pending.has(id))return false;
    this.pending.add(id);this.update();
    try{await this.bounded(this._hass.callService(domain,service,{entity_id:id,...data}));if(!quiet)this.q('.status').textContent='Polecenie wysłane. Stan jest aktualizowany z modułu.';return true;}
    catch(e){this.q('.status').textContent=e.message||'Błąd sterowania';return false;}
    finally{this.pending.delete(id);this.update();}
  }
  async groupControl(rows,kind){
    if(this.groupBusy)return;this.groupBusy=true;this.update();let sent=0,skipped=0;
    try{for(const row of rows){const id=row.entity_id,d=id.split('.')[0];if(!this.known(id)){skipped++;continue;}const ok=await this.control(id,d,kind==='covers'?'close_cover':d==='number'?'set_value':'turn_off',d==='number'?{value:0}:{},true);if(!ok){this.q('.status').textContent+='\nZatrzymano serię; wcześniej wysłane polecenia pozostają wykonane.';return;}sent++;}this.q('.status').textContent=`Wysłano ${sent} poleceń. Pominięto niedostępne: ${skipped}.`;}
    finally{this.groupBusy=false;this.update();}
  }
  getCardSize(){return 8;}
}

class GryfHomeEditor extends HTMLElement {
  setConfig(config){this.config={...config};this.render();}
  set hass(hass){this._hass=hass;if(!this.loading&&!this.rows)this.load();}
  async load(){this.loading=true;let timer;try{this.rows=await Promise.race([this._hass.callWS({type:'gryfsmart/system_entities'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Brak listy encji. Zamknij i otwórz edytor, aby ponowić.')),15000);})]);}catch(e){this.error=e.message;}finally{clearTimeout(timer);this.loading=false;this.render();}}
  change(key,value){this.config={...this.config,[key]:value};this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:this.config},bubbles:true,composed:true}));}
  render(){
    if(!this.config)return;this.replaceChildren();const style=document.createElement('style');style.textContent='gryfsmart-home-editor label{display:block;margin:12px 0}gryfsmart-home-editor input,gryfsmart-home-editor select{display:block;box-sizing:border-box;width:100%;padding:10px;background:var(--card-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:8px}';this.append(style);
    const text=(label,key,fallback='')=>{const l=document.createElement('label'),i=document.createElement('input');l.textContent=label;i.setAttribute('aria-label',label);i.value=this.config[key]??fallback;i.onchange=()=>this.change(key,i.value);l.append(i);this.append(l);return i;};
    const select=(label,key,options,fallback='')=>{const l=document.createElement('label'),i=document.createElement('select');l.textContent=label;i.setAttribute('aria-label',label);for(const [v,t] of options)i.add(new Option(t,v));i.value=this.config[key]??fallback;i.onchange=()=>this.change(key,i.value);l.append(i);this.append(l);};
    text('Tytuł karty','title','Mój dom');
    const rows=this.rows||[],entries=new Map(rows.map(r=>[r.entry,r.hub]));select('Instalacja','entry',[['','Wszystkie instalacje'],...entries]);
    for(const [label,key,prefix] of [['Wyjście elektrozaczepu','door_output','switch.'],['Wejście kontaktronu','door_contact','binary_sensor.']]){const options=rows.filter(r=>r.entity_id.startsWith(prefix)).map(r=>[r.entity_id,`${r.hub} · ${r.module} / ID ${r.module_id} · ${r.name}`]);if(this.config[key]&&!options.some(x=>x[0]===this.config[key]))options.push([this.config[key],this.config[key]]);select(label,key,[['','Nie pokazuj'],...options]);}
    text('Nazwa drzwi','door_name','Drzwi');select('Kontaktron: skrzydło zamknięte gdy','contact_closed_state',[['on','Zwarte (on)'],['off','Rozwarte (off)']],'on');
    select('Podsumowanie','show_summary',[['true','Pokaż'],['false','Ukryj']],String(this.config.show_summary??true));this.lastElementChild.querySelector('select').onchange=e=>this.change('show_summary',e.target.value==='true');
    const multiple=(label,key,options)=>{const l=document.createElement('label'),control=document.createElement('select');l.textContent=label;control.multiple=true;control.size=5;control.setAttribute('aria-label',label);for(const [value,title] of options){const o=new Option(title,value);o.selected=(this.config[key]||[]).includes(value);control.add(o);}control.onchange=()=>this.change(key,Array.from(control.selectedOptions,x=>x.value));l.append(control);this.append(l);};
    const groups=new Map(rows.filter(r=>r.group?.id&&(!this.config.entry||r.entry===this.config.entry)).map(r=>[r.group.id,(r.group.icon||'🏠')+' '+r.group.name]));
    multiple('Widoczne pomieszczenia (brak wyboru = wszystkie)','groups',groups);
    multiple('Pomiń elementy niebędące oświetleniem','exclude_entities',rows.filter(r=>['switch','number','cover','climate','binary_sensor','sensor'].includes(r.entity_id.split('.')[0])).map(r=>[r.entity_id,r.module+' · '+r.name+' ('+r.entity_id+')']));
    const hint=document.createElement('p');hint.textContent=this.error||'Grupy i nazwy importuj z projektu w GRYFSMART — Konfiguracja. Wyjście elektrozaczepu jest automatycznie wyłączone z oświetlenia. Pozostałe wyjścia niebędące oświetleniem zaznacz na liście pomijanych encji.';this.append(hint);
  }
}
if(!customElements.get('gryfsmart-home-card'))customElements.define('gryfsmart-home-card',GryfHomeCard);
if(!customElements.get('gryfsmart-home-editor'))customElements.define('gryfsmart-home-editor',GryfHomeEditor);
window.customCards=window.customCards||[];
if(!window.customCards.some(c=>c.type==='gryfsmart-home-card'))window.customCards.push({type:'gryfsmart-home-card',name:'GRYFSMART — dom i pomieszczenia',description:'Grupy z GRYFEXPERT: oświetlenie, rolety, PWM, regulatory i drzwi',preview:true});

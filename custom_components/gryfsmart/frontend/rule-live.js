// Live controls never edit the rule draft or write EEPROM.
export class RuleLive {
  constructor(panel){this.panel=panel;this.nodes=[];this.rows=[];this.pending=false;}
  add(parent,module,domain,channel){
    const box=document.createElement('div');box.className='rule-live';box.setAttribute('aria-label','Sterowanie online');
    const state=document.createElement('span');box.append(state);
    const r={box,state,module,domain,channel,buttons:[]};
    const button=(text,service)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=()=>this.control(r,service);r.buttons.push(b);box.append(b);};
    if(domain==='switch')button('Przełącz','toggle');
    if(domain==='cover'){button('↑ Open','open_cover');button('■ Stop','stop_cover');button('↓ Close','close_cover');}
    if(domain==='number'){
      const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=100;slider.step=1;slider.setAttribute('aria-label','Poziom PWM online');
      slider.oninput=()=>{r.dragging=true;state.textContent=slider.value+'%';};
      slider.onchange=()=>{r.dragging=false;this.control(r,'set_value',{value:Number(slider.value)});};
      slider.onblur=()=>{r.dragging=false;this.update();};r.slider=slider;box.append(slider);
    }
    parent.append(box);this.nodes.push(r);this.update();
  }
  entity(r){return this.rows.find(e=>e.entry===this.panel.selected().entry&&e.module_id===r.module()&&e.entity_id.startsWith(r.domain+'.')&&e.channel===r.channel());}
  update(){
    if(!this.panel.el('module'))return;
    for(const r of this.nodes){
      const entity=this.entity(r),state=entity&&this.panel._hass.states[entity.entity_id];
      const available=!!state&&!['unknown','unavailable'].includes(state.state)&&this.panel._hass.connected!==false;
      const active=state?.state==='on';r.state.className=available?(active?'live-on':'live-off'):'live-unknown';
      if(!r.dragging)r.state.textContent=!available?'Offline / brak odczytu':r.domain==='switch'?(active?'Włączone':'Wyłączone'):r.domain==='number'?state.state+'%':({open:'Otwarte',closed:'Zamknięte',opening:'Otwieranie',closing:'Zamykanie'}[state.state]||state.state);
      for(const b of r.buttons)b.disabled=!available||this.panel.busy||this.pending;
      if(r.domain==='switch'){r.buttons[0].textContent=r.state.textContent;r.buttons[0].className=r.state.className;r.state.hidden=true;}
      if(r.slider){r.slider.disabled=!available||this.panel.busy||this.pending;if(!r.dragging)r.slider.value=available?state.state:0;}
    }
  }
  async control(r,service,data={}){
    if(this.panel.busy||this.pending)return;
    const entity=this.entity(r),state=entity&&this.panel._hass.states[entity.entity_id];
    if(!state||['unknown','unavailable'].includes(state.state)||this.panel._hass.connected===false)return;
    if(r.domain==='number'&&(!Number.isFinite(data.value)||data.value<0||data.value>100))return;
    this.pending=true;this.update();let timer;
    try{
      await Promise.race([this.panel._hass.callService(r.domain,service,{entity_id:entity.entity_id,...data}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Brak potwierdzenia sterowania. Sprawdź stan przed ponowną próbą.')),15000);})]);
      this.panel.notice(`Sterowanie online: ${entity.name}. Reguła nie została zmieniona; stan aktualizuje raport modułu.`);
    }catch(e){this.panel.notice(e.message||String(e),true);}
    finally{clearTimeout(timer);this.pending=false;this.update();}
  }
}

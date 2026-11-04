const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.GRYFSMART_PLAYWRIGHT||'playwright');
test('room card: dynamic buttons, modules, confirmed states, errors, icons and mobile',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.GRYFSMART_CHROME||undefined});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<main></main>');
  await page.addScriptTag({path:path.join(__dirname,'../custom_components/gryfsmart/frontend/room-card.js')});
  await page.evaluate(()=>{
   window.calls=[];window.hass={states:{'switch.a':{state:'off',attributes:{friendly_name:'Żyrandol'}},'switch.b':{state:'on',attributes:{friendly_name:'Kinkiety'}}},callService:async(...args)=>{calls.push(args);},callWS:async()=>[
    {entry:'hub',hub:'Dom',module:'Salon',model:'R0806T',module_id:2,channel:1,entity_id:'switch.a',name:'Żyrandol'},
    {entry:'hub',hub:'Dom',module:'Kuchnia',model:'R0808',module_id:3,channel:2,entity_id:'switch.b',name:'Kinkiety'}]};
   window.card=document.createElement('gryfsmart-room-card');card.setConfig({title:'Salon',buttons:[{entity:'switch.a'},{entity:'switch.b',name:'Lampka'}]});card.hass=hass;document.querySelector('main').append(card);
  });
  assert.equal(await page.locator('gryfsmart-room-card button.on').count(),1);
  await page.getByRole('button',{name:/Żyrandol/}).click();
  assert.deepEqual(await page.evaluate(()=>calls[0]),['switch','toggle',{entity_id:'switch.a'}]);
  assert.equal(await page.locator('gryfsmart-room-card button.on').count(),1);
  await page.evaluate(()=>{hass.states['switch.a'].state='on';card.hass=hass;});
  assert.equal(await page.locator('gryfsmart-room-card button.on').count(),2);
  await page.evaluate(()=>{hass.callService=async()=>{throw Error('Moduł nie odpowiada');};});
  await page.getByRole('button',{name:/Żyrandol/}).click();
  assert.match(await page.locator('gryfsmart-room-card .error').first().textContent(),/Moduł nie odpowiada/);
  await page.evaluate(()=>{hass.states['switch.a'].state='unavailable';card.hass=hass;});
  assert(await page.getByRole('button',{name:/Żyrandol/}).isDisabled());
  await page.evaluate(()=>{window.editor=document.createElement('gryfsmart-room-editor');editor.setConfig({title:'Salon',buttons:[]});editor.hass=hass;editor.addEventListener('config-changed',e=>{window.changed=e.detail.config;card.setConfig(changed);});document.body.append(editor);});
  assert.equal(await page.getByLabel('Ikona pomieszczenia').locator('option').count(),12);
  await page.getByLabel('Ikona pomieszczenia').selectOption('garden');
  await page.getByLabel('Nazwa pomieszczenia').fill('Ogród');await page.getByLabel('Nazwa pomieszczenia').press('Tab');
  await page.getByRole('button',{name:'＋ Dodaj przycisk',exact:true}).click();
  
  await page.getByLabel('Moduł przycisku 1',{exact:true}).selectOption('hub/R0806T/2');
  await page.getByLabel('Wyjście przycisku 1',{exact:true}).selectOption('switch.a');
  await page.getByLabel('Nazwa przycisku 1',{exact:true}).fill('Taras');await page.getByLabel('Nazwa przycisku 1',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'＋ Dodaj przycisk',exact:true}).click();
  await page.getByLabel('Moduł przycisku 2',{exact:true}).selectOption('hub/R0808/3');
  await page.getByLabel('Wyjście przycisku 2',{exact:true}).selectOption('switch.b');
  assert.deepEqual(await page.evaluate(()=>changed.buttons),[{name:'Taras',entity:'switch.a'},{name:'',entity:'switch.b'}]);
  await page.getByRole('button',{name:'Usuń przycisk 1',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>changed.buttons),[{name:'',entity:'switch.b'}]);
  await page.evaluate(()=>{editor.remove();card.setConfig({title:'Salon',buttons:[{entity:'switch.a',name:'Lampa główna'},{entity:'switch.b',name:'Kinkiety'},{entity:'switch.b',name:'Oświetlenie półek'},{entity:'switch.a',name:'Lampka przy sofie'}]});hass.states['switch.a'].state='off';card.errors.clear();card.hass=hass;});
  for(const width of [320,390,700]){await page.setViewportSize({width,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:390,height:800});
  await page.screenshot({path:path.resolve(__dirname,'../../../build/ha-card-qa/room-card-0.3.9.png'),fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

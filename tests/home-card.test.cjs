const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.GRYFSMART_PLAYWRIGHT||'playwright');
test('home rooms: actual states, grouped actions, door, partial/unknown covers and mobile',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.GRYFSMART_CHROME||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<main></main>');
  await page.addScriptTag({path:path.join(__dirname,'../custom_components/gryfsmart/frontend/home-card.js')});
  await page.evaluate(()=>{
   const group={id:'salon',name:'Salon',icon:'🛋️'},other={id:'hall',name:'Hol',icon:'🚪'};
   window.calls=[];window.rows=[['switch.lamp','Lampa',group],['number.pwm','Taśma',group],['cover.window','Okno',group],['cover.partial','Balkon',group],['cover.closed','Roleta zamknięta',group],['cover.unknown','Nieznana roleta',group],['climate.heat','Ogrzewanie',group],['switch.hall','Hol lampa',other],['switch.ungrouped','Brak grupy',null],['switch.lock','Zamek',group],['binary_sensor.contact','Kontaktron',null]].map(([id,name,group])=>({entry:'hub',hub:'Dom',module:'Moduł',module_id:2,entity_id:id,name,group}));
   window.hass={states:{},callWS:async()=>rows,callService:async(...args)=>calls.push(args)};
   for(const row of rows)hass.states[row.entity_id]={state:'off',attributes:{}};
   Object.assign(hass.states,{'switch.lamp':{state:'on',attributes:{}},'number.pwm':{state:'45',attributes:{}},'cover.window':{state:'open',attributes:{current_position:100}},'cover.partial':{state:'open',attributes:{current_position:35}},'cover.closed':{state:'closed',attributes:{current_position:0}},'cover.unknown':{state:'unavailable',attributes:{}},'binary_sensor.contact':{state:'on',attributes:{}},'climate.heat':{state:'heat',attributes:{current_temperature:22}}});
   window.card=document.createElement('gryfsmart-home-card');card.setConfig({door_output:'switch.lock',door_contact:'binary_sensor.contact'});card.hass=hass;document.querySelector('main').append(card);
  });
  await page.getByRole('tab',{name:'🛋️ Salon'}).waitFor();assert.equal(await page.getByRole('tab').count(),2);assert.match(await page.locator('.summary').innerText(),/Włączone obwody: 2/);assert.match(await page.locator('.summary').innerText(),/Otwarte rolety: 1/);assert.match(await page.locator('.summary').innerText(),/Zamknięte rolety: 1/);assert.match(await page.locator('.summary').innerText(),/Częściowo \/ w ruchu: 1/);assert.match(await page.locator('.summary').innerText(),/Brak danych: 1/);
  assert.equal(await page.getByText('Brak grupy',{exact:true}).count(),0);assert.match(await page.locator('.contact').innerText(),/zamknięte/);
  await page.getByRole('button',{name:'Lampa — 💡 Przełącz',exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['switch','toggle',{entity_id:'switch.lamp'}]);assert.equal(await page.locator('.item.on').count(),2); // no optimistic toggling
  await page.locator('.lock').click();assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['switch','toggle',{entity_id:'switch.lock'}]);
  await page.getByRole('slider',{name:'Taśma — poziom PWM'}).fill('70');assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['number','set_value',{entity_id:'number.pwm',value:70}]);
  await page.evaluate(()=>calls.length=0);await page.getByRole('button',{name:'Wyłącz całe oświetlenie',exact:true}).click();await page.waitForFunction(()=>calls.length===2);assert.deepEqual(await page.evaluate(()=>calls),[['switch','turn_off',{entity_id:'switch.lamp'}],['number','set_value',{entity_id:'number.pwm',value:0}]]);
  await page.evaluate(()=>calls.length=0);await page.getByRole('button',{name:'Zamknij rolety w pomieszczeniu',exact:true}).click();await page.waitForFunction(()=>calls.length===3);assert.ok((await page.evaluate(()=>calls)).every(c=>c[0]==='cover'&&c[1]==='close_cover'));
  await page.getByRole('tab',{name:'🚪 Hol'}).click();assert.equal(await page.getByRole('button',{name:'Zamknij rolety w pomieszczeniu',exact:true}).count(),0);assert.equal(await page.locator('.item').count(),1);
  await page.evaluate(()=>{hass.states['switch.hall'].state='unavailable';card.hass=hass;});assert.ok(await page.getByRole('button',{name:'Hol lampa — 💡 Przełącz'}).isDisabled());
  await page.getByRole('tab',{name:'🛋️ Salon'}).click();await page.evaluate(()=>{hass.callService=async()=>{throw Error('Brak potwierdzenia modułu');};});await page.getByRole('button',{name:'Wyłącz całe oświetlenie',exact:true}).click();assert.match(await page.locator('.status').innerText(),/Zatrzymano serię/);
  for(const width of [320,390,1100]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  if(process.env.GRYFSMART_SCREENSHOT)await page.screenshot({path:process.env.GRYFSMART_SCREENSHOT,fullPage:true});
  await page.evaluate(()=>{window.editor=document.createElement('gryfsmart-home-editor');editor.setConfig({});editor.hass=hass;document.body.append(editor);});await page.getByLabel('Wyjście elektrozaczepu').waitFor();await page.getByLabel('Wyjście elektrozaczepu').selectOption('switch.lock');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

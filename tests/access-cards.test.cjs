const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.GRYFSMART_PLAYWRIGHT || 'playwright');
test('door and gate states, actions, module selectors and offline handling', async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.GRYFSMART_CHROME || undefined});
  try {
    const page = await browser.newPage({viewport:{width:850,height:800}}), errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('http://gryfsmart.test/**', route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      route.fulfill(name.endsWith('.js') ? {contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'../custom_components/gryfsmart/frontend',name),'utf8')} : {contentType:'text/html',body:'<main style="display:grid;grid-template-columns:1fr 1fr;gap:20px"></main>'});
    });
    await page.goto('http://gryfsmart.test/');
    await page.addScriptTag({url:'http://gryfsmart.test/gate-card.js',type:'module'});
    await page.waitForFunction(()=>customElements.get('gryfsmart-gate-card'));
    await page.evaluate(()=>{
      window.calls=[];
      window.hass={states:{'switch.strike':{state:'on',attributes:{friendly_name:'Drzwi · Elektrozaczep'}},'binary_sensor.contact':{state:'off',attributes:{friendly_name:'Drzwi · Kontaktron'}},'switch.gate':{state:'off',attributes:{friendly_name:'Wjazd · Brama'}}},
        callService:async(domain,service,data)=>{calls.push({domain,service,data});},
        callWS:async()=>[{entry:'a',hub:'Dom',module:'Drzwi',module_id:2,model:'R0806T',entity_id:'switch.strike',channel:1,name:'Elektrozaczep'},{entry:'a',hub:'Dom',module:'Wejście',module_id:3,model:'R0808',entity_id:'binary_sensor.contact',channel:4,name:'Kontaktron'}]};
      window.door=document.createElement('gryfsmart-door-card');door.setConfig({output_entity:'switch.strike',contact_entity:'binary_sensor.contact'});door.hass=hass;
      window.gate=document.createElement('gryfsmart-gate-card');gate.setConfig({output_entity:'switch.gate',duration:0.1});gate.hass=hass;
      document.querySelector('main').append(door,gate);
    });
    assert.equal(await page.locator('gryfsmart-door-card strong').textContent(),'Kłódka zamknięta');
    assert.equal(await page.locator('gryfsmart-door-card .contact span').textContent(),'Drzwi otwarte');
    await page.locator('gryfsmart-door-card button').click();
    assert.deepEqual(await page.evaluate(()=>calls[0]),{domain:'switch',service:'toggle',data:{entity_id:'switch.strike'}});
    assert.equal(await page.locator('gryfsmart-door-card strong').textContent(),'Kłódka zamknięta'); // no optimistic success
    await page.evaluate(()=>{hass.states['switch.strike'].state='off';hass.states['binary_sensor.contact'].state='on';door.hass=hass;});
    assert.equal(await page.locator('gryfsmart-door-card strong').textContent(),'Kłódka otwarta');
    assert.equal(await page.locator('gryfsmart-door-card .contact span').textContent(),'Drzwi zamknięte');
    await page.evaluate(()=>{door.setConfig({...door.config,closed_state:'off'});});
    assert.equal(await page.locator('gryfsmart-door-card .contact span').textContent(),'Drzwi otwarte');
    await page.locator('gryfsmart-gate-card button').click();
    assert.deepEqual(await page.evaluate(()=>calls.at(-1)),{domain:'gryfsmart',service:'pulse',data:{entity_id:'switch.gate',duration:0.1}});
    assert(await page.locator('gryfsmart-gate-card button').isDisabled());
    await page.evaluate(()=>{hass.states['switch.gate'].state='on';gate.hass=hass;hass.states['switch.strike'].state='unavailable';hass.states['binary_sensor.contact'].state='unknown';door.hass=hass;});
    assert(await page.locator('gryfsmart-gate-card button').isDisabled());
    assert(await page.locator('gryfsmart-door-card button').isDisabled());
    assert.equal(await page.locator('gryfsmart-door-card .contact span').textContent(),'Stan drzwi nieznany');
    assert(await page.evaluate(()=>{try{gate.setConfig({duration:0.15});return false;}catch{return true;}}));
    await page.evaluate(()=>{window.editor=document.createElement('gryfsmart-door-editor');editor.setConfig({});editor.hass=hass;editor.addEventListener('config-changed',e=>window.config=e.detail.config);document.body.append(editor);});
    await page.getByLabel('Elektrozaczep — moduł').selectOption('a/R0806T/2');
    await page.getByLabel('Elektrozaczep — wyjście').selectOption('switch.strike');
    await page.getByLabel('Kontaktron — moduł').selectOption('a/R0808/3');
    await page.getByLabel('Kontaktron — wejście').selectOption('binary_sensor.contact');
    assert.equal(await page.evaluate(()=>config.output_entity),'switch.strike');
    assert.equal(await page.evaluate(()=>config.contact_entity),'binary_sensor.contact');
    await page.evaluate(()=>{editor.remove();window.ge=document.createElement('gryfsmart-gate-editor');ge.setConfig({duration:0.5});ge.hass=hass;ge.addEventListener('config-changed',e=>window.gc=e.detail.config);document.body.append(ge);});
    await page.getByLabel('Czas impulsu [s]',{exact:true}).fill('0.7');await page.getByLabel('Czas impulsu [s]',{exact:true}).press('Tab');
    assert.equal(await page.evaluate(()=>gc.duration),0.7);
    await page.evaluate(()=>{ge.remove();hass.states['switch.strike'].state='on';hass.states['binary_sensor.contact'].state='on';door.setConfig({...door.config,closed_state:'on'});door.hass=hass;hass.states['switch.gate'].state='off';gate.hass=hass;});
    await page.screenshot({path:path.resolve(__dirname,'../../../build/ha-card-qa/doors-gate-0.3.8.png'),fullPage:true});
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

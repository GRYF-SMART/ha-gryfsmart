const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.GRYFSMART_PLAYWRIGHT || 'playwright');

test('thermostat ON/OFF/AUTO, ECO, names and card editor', async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.GRYFSMART_CHROME || undefined});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}}), errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('http://gryfsmart.test/**', route=>route.fulfill({contentType:'text/html',body:'<main></main>'}));
    await page.goto('http://gryfsmart.test/');
    await page.addScriptTag({path:path.join(__dirname,'../custom_components/gryfsmart/frontend/thermostat-card.js')});
    await page.evaluate(()=>{
      window.calls=[];
      window.hass={states:{'climate.room':{state:'heat',attributes:{friendly_name:'Podłoga',temperature:22,current_temperature:21,min_temp:-55,max_temp:125,regulator_mode:'auto',forced_on_supported:true,outputs_active:false}}},
        async callService(domain,service,data){calls.push({domain,service,data});}};
      window.card=document.createElement('gryfsmart-thermostat-card');card.setConfig({entity:'climate.room'});card.hass=hass;document.querySelector('main').append(card);
    });
    assert.equal(await page.locator('h2').textContent(),'Podłoga');
    for(const mode of ['on','off','auto']) {
      await page.getByRole('button',{name:mode.toUpperCase(),exact:true}).click();
      const last=await page.evaluate(()=>calls.at(-1));
      assert.equal(last.service,'set_preset_mode');assert.equal(last.data.preset_mode,mode);
    }
    await page.getByText('Temperatura ECO',{exact:true}).click();
    await page.getByLabel('Temperatura ECO',{exact:true}).fill('18');
    await page.getByRole('button',{name:'Włącz ECO',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>calls.slice(-2).map(c=>[c.service,c.data.temperature ?? c.data.preset_mode])),[['set_temperature',18],['set_preset_mode','auto']]);
    await page.getByRole('button',{name:'AUTO',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>calls.slice(-2).map(c=>[c.service,c.data.temperature ?? c.data.preset_mode])),[['set_temperature',22],['set_preset_mode','auto']]);
    await page.evaluate(()=>{hass.states['climate.room'].attributes.forced_on_supported=false;card.hass=hass;});
    assert(await page.getByRole('button',{name:'ON',exact:true}).isDisabled());
    await page.evaluate(()=>{hass.states['climate.room'].state='unavailable';card.hass=hass;});
    assert(await page.getByRole('button',{name:'OFF',exact:true}).isDisabled());
    await page.evaluate(()=>{window.editor=document.createElement('gryfsmart-thermostat-editor');editor.setConfig({entity:'climate.room'});document.body.append(editor);editor.addEventListener('config-changed',e=>window.changed=e.detail.config);});
    const title=page.locator('gryfsmart-thermostat-editor input');
    await title.fill('Łazienka');await title.press('Tab');
    assert.equal(await page.evaluate(()=>changed.title),'Łazienka');
    await page.evaluate(()=>{window.empty=document.createElement('gryfsmart-thermostat-card');empty.setConfig({});empty.hass=hass;});
    assert.deepEqual(errors,[]);

    // Import only label fields, even when a project includes active hardware configuration.
    await page.addScriptTag({path:path.join(__dirname,'../custom_components/gryfsmart/frontend/names-editor.js')});
    await page.evaluate(()=>{
      window.requests=[];
      window.names=document.createElement('gryfsmart-names-editor');
      names.hass={async callWS(message){requests.push(message);if(message.action==='list')return [{entry:'hub',title:'Dom',modules:[{id:2,model:'R0806T',thermostats:2,names:{thermostat_1:'Podłoga'}}]}];return {count:3};}};
      document.body.replaceChildren(names);
    });
    await page.getByRole('button',{name:'Zapisz nazwę w HA'}).waitFor();
    await page.getByLabel('Nazwa panelu / regulatora',{exact:true}).fill('Grzejnik');
    await page.getByRole('button',{name:'Zapisz nazwę w HA'}).click();
    assert.equal(await page.evaluate(()=>requests.find(m=>m.action==='rename').name),'Grzejnik');
    await page.locator('input[type=file]').setInputFiles({name:'dom.gryf.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({devices:[{id:2,model:'R0806T',regulatorNames:['A','B'],configuration:{rules:[{enabled:true}]}}]}))});
    await page.getByRole('button',{name:'Importuj nazwy z projektu'}).click();
    await page.waitForFunction(()=>requests.some(m=>m.action==='import'));
    await page.getByRole('status').filter({hasText:'Zaimportowano 3 nazw do HA.'}).waitFor();
    const imported=await page.evaluate(()=>requests.find(m=>m.action==='import'));
    assert(!Object.hasOwn(imported.project.devices[0],'configuration'));
    assert.deepEqual(imported.project.devices[0].regulatornames,['A','B']);
    assert.deepEqual(errors,[]);
    if(process.env.GRYFSMART_THERMOSTAT_SCREENSHOT) await page.screenshot({path:process.env.GRYFSMART_THERMOSTAT_SCREENSHOT});
  } finally {await browser.close();}
});

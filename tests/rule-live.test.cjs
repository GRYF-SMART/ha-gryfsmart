const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.GRYFSMART_PLAYWRIGHT||'playwright');
test('rule online controls route by entry/module/channel without editing draft',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.GRYFSMART_CHROME||undefined});
 try{
 const page=await browser.newPage();await page.setContent('<main></main>');
 const dir=path.join(__dirname,'../custom_components/gryfsmart/frontend');
 await page.addScriptTag({content:fs.readFileSync(path.join(dir,'rule-live.js'),'utf8').replace('export class','class')+'\nwindow.RuleLive=RuleLive;'});
 await page.evaluate(()=>{
  window.calls=[];window.target=2;window.channel=1;
  window.panel={busy:false,el:()=>true,selected:()=>({entry:'a'}),notice:()=>{},draft:{enabled:0,actions:[0]},dirty:false,_hass:{connected:true,states:{'switch.local':{state:'on'},'switch.remote':{state:'off'},'number.pwm':{state:'42'},'cover.blind':{state:'open'}},callService:async(...a)=>calls.push(a)}};
  window.live=new RuleLive(panel);live.rows=[['a',2,'switch.local',1],['a',3,'switch.remote',1],['a',3,'number.pwm',0],['a',4,'cover.blind',1],['b',2,'switch.other',1]].map(([entry,module_id,entity_id,channel])=>({entry,module_id,entity_id,channel,name:entity_id}));
  live.add(document.querySelector('main'),()=>target,'switch',()=>channel);
  live.add(document.querySelector('main'),()=>3,'number',()=>0);
  live.add(document.querySelector('main'),()=>4,'cover',()=>1);
 });
 await page.getByRole('button',{name:'Włączone',exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['switch','toggle',{entity_id:'switch.local'}]);
 await page.evaluate(()=>{target=3;live.update();});await page.getByRole('button',{name:'Wyłączone',exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['switch','toggle',{entity_id:'switch.remote'}]);
 await page.getByRole('slider').fill('64');assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['number','set_value',{entity_id:'number.pwm',value:64}]);
 for(const [label,service] of [['↑ Open','open_cover'],['■ Stop','stop_cover'],['↓ Close','close_cover']]){await page.getByRole('button',{name:label,exact:true}).click();assert.deepEqual(await page.evaluate(()=>calls.at(-1)),['cover',service,{entity_id:'cover.blind'}]);}
 assert.deepEqual(await page.evaluate(()=>panel.draft),{enabled:0,actions:[0]});assert.equal(await page.evaluate(()=>panel.dirty),false);
 await page.evaluate(()=>{panel._hass.states['switch.remote'].state='unavailable';live.update();});assert.ok(await page.getByRole('button',{name:'Offline / brak odczytu',exact:true}).isDisabled());
 await page.evaluate(()=>{target=2;channel=2;live.update();});assert.ok(await page.getByRole('button',{name:'Offline / brak odczytu',exact:true}).isDisabled());
 await page.evaluate(()=>{channel=1;panel.busy=true;live.update();});assert.ok(await page.getByRole('button',{name:'Włączone',exact:true}).isDisabled());
 await page.evaluate(()=>{panel.busy=false;panel._hass.callService=()=>new Promise(resolve=>window.finish=resolve);live.update();});await page.getByRole('button',{name:'Włączone',exact:true}).click();assert.ok(await page.getByRole('button',{name:'■ Stop',exact:true}).isDisabled());await page.evaluate(()=>finish());
 }finally{await browser.close();}
});

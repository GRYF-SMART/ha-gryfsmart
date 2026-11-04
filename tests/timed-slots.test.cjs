const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.GRYFSMART_PLAYWRIGHT||'playwright');
test('rule panel excludes occupied targets and edits timed slot without device writes',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.GRYFSMART_CHROME||undefined});
 try{
  const page=await browser.newPage();await page.setContent('<main></main>');const dir=path.join(__dirname,'../custom_components/gryfsmart/frontend');
  await page.addScriptTag({content:fs.readFileSync(path.join(dir,'rule-live.js'),'utf8').replace('export class','class')});
  await page.addScriptTag({content:fs.readFileSync(path.join(dir,'panel.js'),'utf8').replace(/^import .*;\r?\n/gm,'')});
  await page.evaluate(()=>{
   window.calls=[];window.panel=document.createElement('gryfsmart-config');
   const modules=[1,2,3,4].map(id=>({id,model:'R0806T',firmware:'33',inputs:8,outputs:6,pwm:true,editable:true,shutters:0,thermostats:2}));
   panel.hass={connected:true,states:{},callWS:async req=>{calls.push(req);if(req.type==='gryfsmart/system_entities')return [];if(req.action==='modules')return [{entry:'a',title:'QA',modules}];if(req.action==='read')return {token:'test',configuration:{enabled:0,events:Array(8).fill(0),actions:Array(6).fill(0),positions:Array(6).fill(0),slots:Array.from({length:4},()=>({target:0,type:0,data:[]})),pwm:[0,0,0],temperature:[0,0,1,0,220,5,20]}};throw Error('Unexpected '+req.action);}};document.querySelector('main').append(panel);
  });
  await page.getByRole('button',{name:'Odczytaj regułę',exact:true}).click();
  await page.getByLabel('Rodzaj slotu 1',{exact:true}).selectOption('2');
  await page.getByLabel('Cel slotu 1',{exact:true}).selectOption('2');
  await page.getByLabel('Rodzaj slotu 2',{exact:true}).selectOption('2');
  assert.ok(!(await page.getByLabel('Cel slotu 2',{exact:true}).locator('option').evaluateAll(es=>es.map(e=>e.value))).includes('2'));
  await page.getByLabel('Rodzaj slotu 1',{exact:true}).selectOption('0');
  assert.ok((await page.getByLabel('Cel slotu 2',{exact:true}).locator('option').evaluateAll(es=>es.map(e=>e.value))).includes('2'));
  await page.getByLabel('Rodzaj slotu 1',{exact:true}).selectOption('6');
  await page.getByLabel('Funkcja czasowa',{exact:true}).selectOption('2');
  await page.getByLabel('Opóźnienie [s]',{exact:true}).fill('1.2');await page.getByLabel('Opóźnienie [s]',{exact:true}).press('Tab');
  await page.getByLabel('Czas włączenia [s]',{exact:true}).fill('0.3');await page.getByLabel('Czas włączenia [s]',{exact:true}).press('Tab');
  assert.deepEqual(await page.evaluate(()=>panel.draft.slots[0].data),[1,2,12,0,3,0,1,0]);
  assert.ok(!(await page.evaluate(()=>calls)).some(c=>c.action==='save'));
 }finally{await browser.close();}
});

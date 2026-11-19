// Requires Playwright and its Chromium browser. FORMRESAN_PLAYWRIGHT may point to
// an externally installed Playwright module, keeping runtime dependencies unchanged.
const {chromium} = require(process.env.FORMRESAN_PLAYWRIGHT || 'playwright');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = 'https://erngren.github.io/formresan/';
const mainKey = 'formresan_v1', trainingKey = 'formresan_training_v14';
const date = '2026-11-19';
const main = {goals:{protein:120,cal:0},entries:[{id:1.5,date,kind:'food',name:'Äldre mat',kcal:200,protein:20,extra:{kept:true}}],extraRoot:'bevara'};
const training = {sessions:[{id:2,date,plan:'a',exercises:[{id:'legpress',sets:[{kg:20,reps:10}]}]}],extraTraining:true};

async function snapshot(page) {
  return page.evaluate(([m,t])=>[localStorage.getItem(m),localStorage.getItem(t)],[mainKey,trainingKey]);
}
async function read(page,key) { return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key); }
async function importMain(page,value) {
  const previous = await page.locator('#importFile').inputValue();
  // Reset the file picker in tests so the same deliberately invalid file can be retried.
  if (previous) await page.locator('#importFile').setInputFiles([]);
  await page.locator('#importFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await page.waitForFunction(()=>!document.querySelector('#importFile').disabled);
}
async function manual(page,name='Ny mat') {
  await page.getByRole('button',{name:'+ Lägg till',exact:true}).first().click();
  await page.locator('#foodForm [name=name]').fill(name);
  await page.locator('#foodForm [name=kcal]').fill('321');
  await page.locator('#foodForm [name=protein]').fill('12.3');
  await page.locator('#foodForm button[type=submit]').click();
}
async function failedWrites(page,enabled) {
  await page.evaluate(enabled=>{
    window.originalSetItem ??= Storage.prototype.setItem;
    Storage.prototype.setItem = enabled ? function(){throw new DOMException('Full','QuotaExceededError');} : window.originalSetItem;
  },enabled);
}
async function downloaded(page,action) {
  const wait = page.waitForEvent('download');
  await action();
  return JSON.parse(await fs.readFile(await (await wait).path(),'utf8'));
}

test('lokal datasäkerhet i Chromium 390 × 844',async t=>{
  const browser = await chromium.launch({headless:true});
  async function setup(url='') {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors=[],dialogs=[];
    context.on('page',page=>{
      page.on('pageerror',error=>errors.push(error.message));
      page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
    });
    await context.route(base+'**',async route=>{
      const file = new URL(route.request().url()).pathname.replace('/formresan/','') || 'index.html';
      await route.fulfill({path:path.join(root,file)});
    });
    const page = await context.newPage();
    await page.goto(base);
    await page.evaluate(([m,t,a,b])=>{localStorage.setItem(m,JSON.stringify(a));localStorage.setItem(t,JSON.stringify(b));},[mainKey,trainingKey,main,training]);
    await page.goto(base+url);
    await page.reload();
    if(!url) {
      await page.locator('#day').fill(date);
      await page.locator('#day').dispatchEvent('change');
    }
    return {context,page,errors,dialogs};
  }
  try {
    await t.test('äldre historik och format bevaras efter omladdning',async()=>{
      const {context,page,errors}=await setup();
      assert.match(await page.locator('#foods').innerText(),/Äldre mat/);
      assert.deepEqual(await read(page,mainKey),main);
      const exported=await downloaded(page,()=>page.evaluate(()=>exportData()));
      assert.deepEqual(exported,main);
      await page.goto(base+'training/index.html');
      assert.match(await page.locator('#history').innerText(),/20 kg × 10/);
      const exportedTraining=await downloaded(page,()=>page.getByRole('button',{name:'Exportera träning',exact:true}).click());
      assert.deepEqual(exportedTraining,training);
      assert.deepEqual(errors,[]);
      await context.close();
    });
    await t.test('giltig import med äldre valfria fält och okända fält',async()=>{
      const {context,page}=await setup();
      const imported={...main,goals:{protein:130,extraGoal:'kvar'},entries:[...main.entries,{id:3,date,kind:'work',type:'Gång',extraEntry:{a:1}}]};
      await importMain(page,imported);
      const stored=await read(page,mainKey);
      assert.equal(stored.extraRoot,'bevara');
      assert.equal(stored.goals.extraGoal,'kvar');
      assert.deepEqual(stored.entries[1].extraEntry,{a:1});
      assert.equal(stored.entries[1].minutes,0);
      assert.deepEqual(await read(page,trainingKey),training);
      await context.close();
    });
    await t.test('manipulerade ID, datum, numeriska fält och dubbletter avvisas',async()=>{
      const {context,page}=await setup();
      const before=await snapshot(page);
      const invalid=[
        {...main,entries:[{...main.entries[0],id:'window.__probe=true'}]},
        {...main,entries:[{...main.entries[0],date:'2026-02-30'}]},
        {...main,entries:[{...main.entries[0],kcal:'<img src=x onerror="window.__probe=true">'}]},
        {...main,entries:[{...main.entries[0],protein:null}]},
        {...main,entries:[{...main.entries[0],kind:'sleep',minutes:1441}]},
        {...main,entries:[main.entries[0],main.entries[0]]},
        {goals:{protein:120},entries:[{kind:'food',date}]},
        {format:'formresan-backup',formatVersion:1,data:{[mainKey]:main,[trainingKey]:training}}
      ];
      for(const value of invalid) {
        await importMain(page,value);
        assert.deepEqual(await snapshot(page),before);
        assert(await page.locator('#storageNotice').isVisible());
      }
      assert.equal(await page.evaluate(()=>window.__probe),undefined);
      await context.close();
    });
    await t.test('HTML i alla textfält visas som text och radering har säker lyssnare',async()=>{
      const {context,page,errors}=await setup();
      const attack='<img src=x onerror="window.__probe=true"><svg onload="window.__probe=true"></svg>';
      await importMain(page,{...main,entries:[
        {...main.entries[0],name:attack},
        {id:3,date,kind:'work',type:attack,notes:attack,minutes:20,km:0,burn:0},
        {id:4,date,kind:'sleep',minutes:420,feel:attack}
      ]});
      await page.getByRole('button',{name:'Historik',exact:true}).click();
      assert.equal(await page.locator('#historyItems img, #historyItems svg').count(),0);
      const button=page.locator('#historyItems button[data-entry-id]').first();
      assert.equal(await button.getAttribute('onclick'),null);
      await button.click();
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('formresan_v1')).entries.length===2);
      assert.equal(await page.evaluate(()=>window.__probe),undefined);
      assert.deepEqual(errors,[]);
      await context.close();
    });
    await t.test('misslyckad manuell sparning och goals ger ingen falsk framgång',async()=>{
      const {context,page,dialogs}=await setup();
      const before=await snapshot(page);
      await failedWrites(page,true);
      await manual(page);
      await page.waitForFunction(()=>!!document.querySelector('#storageNotice'));
      assert(await page.locator('#foodDialog').isVisible());
      assert.equal(await page.locator('#foodForm [name=name]').inputValue(),'Ny mat');
      assert.deepEqual(await snapshot(page),before);
      assert.equal(await page.evaluate(()=>db.entries.length),1);
      await failedWrites(page,false);
      await page.locator('#foodForm button[type=submit]').click();
      await page.waitForFunction(()=>!document.querySelector('#foodDialog').open);
      assert.equal((await read(page,mainKey)).entries.length,2);
      await page.getByRole('button',{name:'Mål & data',exact:true}).click();
      await failedWrites(page,true);
      await page.locator('#proteinGoal').fill('150');
      await page.getByRole('button',{name:'Spara mål',exact:true}).click();
      await page.waitForFunction(()=>!!document.querySelector('#storageNotice'));
      assert.equal(await page.locator('#proteinGoal').inputValue(),'150');
      assert.equal((await read(page,mainKey)).goals.protein,120);
      assert(!dialogs.includes('Målen är sparade!'));
      await context.close();
    });
    await t.test('träningsfel och nytt försök ger exakt ett nytt pass',async()=>{
      const {context,page,dialogs}=await setup('training/index.html');
      await page.locator('#sets-legpress .kg').first().fill('25');
      await page.locator('#sets-legpress .reps').first().fill('12');
      await failedWrites(page,true);
      await page.getByRole('button',{name:'💾 Spara gympass',exact:true}).click();
      await page.waitForFunction(()=>!!document.querySelector('#storageNotice'));
      assert.equal(await page.evaluate(()=>state.sessions.length),1);
      assert.equal((await read(page,trainingKey)).sessions.length,1);
      assert.equal(await page.locator('#sets-legpress .kg').first().inputValue(),'25');
      assert(!dialogs.some(message=>message.startsWith('Sparat!')));
      await failedWrites(page,false);
      await page.getByRole('button',{name:'💾 Spara gympass',exact:true}).click();
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('formresan_training_v14')).sessions.length===2);
      assert.equal((await read(page,trainingKey)).sessions[1].exercises[0].sets[0].kg,25);
      await context.close();
    });
    await t.test('taco, aktivitet, sömn, vikt och kreatin bevarar inmatning vid skrivfel',async()=>{
      for (const [dialogId,openName,formId] of [
        ['tacoDialog','+ Min taco 🌮','tacoForm'],
        ['workDialog',null,'workForm'],
        ['sleepDialog','+ Logga','sleepForm'],
        ['weightDialog','+ Vägning','weightForm']
      ]) {
        const {context,page}=await setup();
        const before=await snapshot(page);
        if(openName) await page.getByRole('button',{name:openName,exact:true}).click();
        else await page.getByRole('button',{name:'+ Lägg till',exact:true}).nth(1).click();
        const inputs=page.locator('#'+formId+' input');
        const inputBefore=await inputs.evaluateAll(nodes=>nodes.map(node=>node.value));
        await failedWrites(page,true);
        await page.locator('#'+formId+' button[type=submit]').click();
        await page.waitForFunction(()=>!!document.querySelector('#storageNotice'));
        assert(await page.locator('#'+dialogId).isVisible());
        assert.deepEqual(await inputs.evaluateAll(nodes=>nodes.map(node=>node.value)),inputBefore);
        assert.deepEqual(await snapshot(page),before);
        await failedWrites(page,false);
        await page.locator('#'+formId+' button[type=submit]').click();
        await page.waitForFunction(id=>!document.getElementById(id).open,dialogId);
        assert.equal((await read(page,mainKey)).entries.length,2);
        await context.close();
      }
      const {context,page}=await setup();
      const before=await snapshot(page);
      await failedWrites(page,true);
      await page.locator('#creatineCheck').check();
      await page.waitForFunction(()=>!!document.querySelector('#storageNotice'));
      assert.equal(await page.locator('#creatineCheck').isChecked(),false);
      assert.deepEqual(await snapshot(page),before);
      await failedWrites(page,false);
      await page.locator('#creatineCheck').check();
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('formresan_v1')).entries.length===2);
      await context.close();
    });
    await t.test('giltig import vid skrivfel bevarar gamla data och kan väljas igen',async()=>{
      const {context,page}=await setup();
      const before=await snapshot(page);
      await failedWrites(page,true);
      await importMain(page,{...main,goals:{protein:160,cal:0}});
      assert.deepEqual(await snapshot(page),before);
      assert.equal(await page.evaluate(()=>db.goals.protein),120);
      await failedWrites(page,false);
      await importMain(page,{...main,goals:{protein:160,cal:0}});
      assert.equal((await read(page,mainKey)).goals.protein,160);
      await context.close();
    });
    await t.test('samtidiga skrivningar från två flikar och iframe bevaras',async()=>{
      const {context,page,errors}=await setup();
      const other=await context.newPage();
      await other.goto(base);
      // Run simultaneous operations, not just sequential UI refreshes.
      await Promise.all([page,other].map((tab,index)=>tab.evaluate(async({date,index})=>{
        await Promise.all(Array.from({length:15},(_,n)=>add({kind:'food',name:`Flik ${index} post ${n}`,kcal:1,protein:1},date)));
      },{date,index})));
      let stored=await read(page,mainKey);
      assert.equal(stored.entries.length,31);
      assert.equal(new Set(stored.entries.map(entry=>entry.id)).size,31);
      await page.getByRole('button',{name:'💪 Träning',exact:true}).click();
      const frame=page.frameLocator('#trainingFrame');
      await frame.locator('#content').waitFor();
      await Promise.all([
        frame.locator('body').evaluate(async()=>{
          await storage.updateTraining(latest=>latest.sessions.push({id:storage.nextId(latest.sessions),date:'2026-11-19',plan:'warm',exercises:[{id:'thoracic',done:true}]}));
        }),
        other.evaluate(()=>add({kind:'food',name:'Samtidig mat',kcal:1,protein:1},'2026-11-19')),
        other.evaluate(async()=>{
          await FormresanStorage.updateTraining(latest=>latest.sessions.push({id:FormresanStorage.nextId(latest.sessions),date:'2026-11-19',plan:'mob',exercises:[{id:'openbook',done:true}]}));
        })
      ]);
      stored=await read(page,mainKey);
      assert.equal(stored.entries.length,32);
      assert.equal((await read(page,trainingKey)).sessions.length,3);
      assert.deepEqual(stored.entries[0],main.entries[0]);
      assert.deepEqual(errors,[]);
      await context.close();
    });
    await t.test('ändring från annan flik under import bevaras och stoppar ersättning',async()=>{
      const {context,page}=await setup();
      const other=await context.newPage();
      await other.goto(base);
      await page.evaluate(()=>{
        window.confirm = () => {
          // A different updated writer can commit after the preview but before this lock.
          window.importRace = FormresanStorage.updateMain(latest=>latest.entries.push({id:99,date:'2026-11-19',kind:'food',name:'Samtidig',kcal:1,protein:1}));
          return true;
        };
      });
      await importMain(page,{...main,entries:[]});
      await page.evaluate(()=>window.importRace);
      assert.equal((await read(page,mainKey)).entries.length,2);
      assert.match(await page.locator('#storageNotice').innerText(),/annan flik/);
      await context.close();
    });
    await t.test('smart mat sparar genom samma lås och bevarar portion efter fel',async()=>{
      const {context,page}=await setup();
      await context.route('https://dataportal.livsmedelsverket.se/**',async route=>{
        const values=[{euroFIRkod:'ENERC',enhet:'kcal',viktGram:100,matrisenhetkod:'W',varde:100},
          {euroFIRkod:'PROT',enhet:'g',viktGram:100,matrisenhetkod:'W',varde:10}];
        const data=route.request().url().includes('/naringsvarden')?values:{_meta:{totalRecords:1,offset:0},livsmedel:[{nummer:123,namn:'Testmat'}]};
        await route.fulfill({json:data});
      });
      await page.getByRole('button',{name:'+ Lägg till',exact:true}).first().click();
      await page.locator('#smartFoodDetails summary').click();
      await page.locator('#smartFoodQuery').fill('Testmat 200 g');
      await page.getByRole('button',{name:'Sök livsmedel',exact:true}).click();
      await page.locator('#smartFoodChoices').selectOption({label:'Testmat'});
      await page.waitForFunction(()=>!document.querySelector('#smartFoodSave').disabled);
      await failedWrites(page,true);
      await page.locator('#smartFoodSave').click();
      await page.waitForFunction(()=>document.querySelector('#smartFoodStatus').textContent.includes('inte sparad'));
      assert(await page.locator('#foodDialog').isVisible());
      assert.equal((await read(page,mainKey)).entries.length,1);
      await failedWrites(page,false);
      await page.locator('#smartFoodSave').click();
      await page.waitForFunction(()=>!document.querySelector('#foodDialog').open);
      const added=(await read(page,mainKey)).entries[1];
      assert.equal(added.kcal,200);
      assert.equal(added.protein,20);
      await context.close();
    });
    await t.test('komplett export fångar beständiga data och båda råsträngarna',async()=>{
      const {context,page}=await setup();
      const before=await snapshot(page);
      await failedWrites(page,true);
      await manual(page,'Ej lagrad');
      await page.waitForFunction(()=>!!document.querySelector('#storageNotice'));
      const exported=await downloaded(page,()=>page.evaluate(()=>FormresanStorage.exportAll()));
      assert.equal(exported.formatVersion,1);
      assert(Number.isFinite(Date.parse(exported.exportedAt)));
      assert.deepEqual(exported.data[mainKey],main);
      assert.deepEqual(exported.data[trainingKey],training);
      assert.equal(exported.rawData[mainKey],before[0]);
      assert.deepEqual(await snapshot(page),before);
      await context.close();
    });
    await t.test('skadad JSON, ogiltig struktur och nekad läsning skrivs aldrig över',async()=>{
      for(const [key,value] of [[mainKey,'{bad'],[mainKey,'{}'],[trainingKey,'{bad'],[trainingKey,'{"sessions":{}}']]) {
        const {context,page}=await setup();
        await page.evaluate(([key,value])=>localStorage.setItem(key,value),[key,value]);
        await page.reload();
        if(key===mainKey) {
          await page.getByRole('button',{name:'+ Banan',exact:true}).click();
        } else {
          await page.goto(base+'training/index.html');
          await page.locator('#sets-legpress .kg').first().fill('20');
          await page.locator('#sets-legpress .reps').first().fill('10');
          await page.getByRole('button',{name:'💾 Spara gympass',exact:true}).click();
        }
        await page.waitForFunction(()=>!!document.querySelector('#storageNotice'));
        assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),value);
        const backup=await downloaded(page,()=>page.evaluate(()=>FormresanStorage.exportAll()));
        assert.equal(backup.rawData[key],value);
        await context.close();
      }
      const {context,page}=await setup();
      const before=await snapshot(page);
      await page.evaluate(()=>{window.originalGet=Storage.prototype.getItem;Storage.prototype.getItem=()=>{throw new DOMException('Denied','SecurityError')};});
      await page.getByRole('button',{name:'+ Banan',exact:true}).click();
      await page.waitForFunction(()=>!!document.querySelector('#storageNotice'));
      await page.evaluate(()=>{Storage.prototype.getItem=window.originalGet;});
      assert.deepEqual(await snapshot(page),before);
      await context.close();
    });
    await t.test('utan Web Locks blockeras skrivning utan att data ändras',async()=>{
      const {context,page}=await setup();
      const before=await snapshot(page);
      await page.evaluate(()=>Object.defineProperty(navigator,'locks',{value:undefined,configurable:true}));
      await page.getByRole('button',{name:'+ Banan',exact:true}).click();
      await page.waitForFunction(()=>!!document.querySelector('#storageNotice'));
      assert.match(await page.locator('#storageNotice').innerText(),/Web Locks/);
      assert.deepEqual(await snapshot(page),before);
      await context.close();
    });
    await t.test('nekad läsning redan vid sidstart skapar ingen tom lagring',async()=>{
      const {context,page}=await setup();
      const before=await snapshot(page);
      await context.addInitScript(()=>{
        window.savedGetItem=Storage.prototype.getItem;
        window.writeAttempts=0;
        const originalSet=Storage.prototype.setItem;
        Storage.prototype.setItem=function(...args){window.writeAttempts++;return originalSet.apply(this,args);};
        Storage.prototype.getItem=()=>{throw new DOMException('Denied','SecurityError');};
      });
      await page.reload();
      assert(await page.locator('#storageNotice').isVisible());
      await page.getByRole('button',{name:'+ Banan',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('[onclick="addBanana(this)"]').disabled);
      assert.equal(await page.evaluate(()=>window.writeAttempts),0);
      await page.evaluate(()=>{Storage.prototype.getItem=window.savedGetItem;});
      assert.deepEqual(await snapshot(page),before);
      await context.close();
    });
    await t.test('uppdatering i annan flik bevarar ett pågående formulärutkast',async()=>{
      const {context,page}=await setup('training/index.html');
      const other=await context.newPage();
      await other.goto(base+'training/index.html');
      await page.locator('#sets-legpress .kg').first().fill('45');
      await other.evaluate(()=>storage.updateTraining(latest=>latest.sessions.push({id:storage.nextId(latest.sessions),date:'2026-11-19',plan:'warm',exercises:[{id:'thoracic',done:true}]})));
      await page.waitForFunction(()=>state.sessions.length===2);
      assert.equal(await page.locator('#sets-legpress .kg').first().inputValue(),'45');
      await context.close();
    });
    await t.test('golfregistrering, okända träningsfält och främmande HTML är säkra',async()=>{
      const {context,page,errors}=await setup('training/index.html');
      await page.locator('[data-r=warm]').click();
      await page.locator('#done-thoracic').check();
      await page.getByRole('button',{name:'💾 Spara rutin',exact:true}).click();
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('formresan_training_v14')).sessions.length===2);
      const stored=await read(page,trainingKey);
      assert.equal(stored.extraTraining,true);
      assert.deepEqual(stored.sessions[0],training.sessions[0]);
      const malicious={sessions:[{id:99,date,plan:'<img src=x onerror="window.__probe=true">',exercises:[{id:'<svg onload="window.__probe=true">',sets:[{kg:1,reps:1}]}]}]};
      await page.evaluate(([key,value])=>localStorage.setItem(key,JSON.stringify(value)),[trainingKey,malicious]);
      await page.reload();
      assert.equal(await page.locator('#history img, #history svg').count(),0);
      assert.equal(await page.evaluate(()=>window.__probe),undefined);
      assert.deepEqual(errors,[]);
      await context.close();
    });
  } finally { await browser.close(); }
});

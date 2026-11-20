// Syntetisk Auth-fixture endast i test. Alla browseranrop fångas lokalt.
const {chromium}=require(process.env.FORMRESAN_PLAYWRIGHT||'playwright');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),base='https://erngren.github.io/formresan/';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const key=(id,kind)=>`formresan_account_v1:${id}:${kind}`;
const legacyMain={goals:{protein:120,cal:0},entries:[{id:1,date:'2026-11-20',kind:'food',name:'Gammal testmat',kcal:100,protein:10}]};
const legacyTraining={sessions:[{id:2,date:'2026-11-20',plan:'warm',exercises:[{id:'thoracic',done:true}]}]};
async function fixture(page,id=A){
  await page.evaluate(id=>{
    const listeners=new Set();
    const auth={id,error:null,malformed:false,anonymous:false,throws:false,delay:false,
      set(id,emit=true){this.id=id;if(emit)for(const listener of listeners)listener();},
      async getUser(){
        if(this.throws)throw new Error('syntetiskt verifieringsfel');
        const result={data:{user:this.id===null?null:{id:this.id,is_anonymous:this.anonymous,email:'syntetisk@example.invalid'}},error:this.error};
        if(this.malformed)delete result.error;
        if(this.delay){this.delay=false;window.verificationStarted=true;await new Promise(r=>window.releaseVerification=r);}
        return result;
      },
      onAuthStateChange(listener){listeners.add(listener);return{data:{subscription:{unsubscribe:()=>listeners.delete(listener)}}};}
    };
    window.testAuth=auth;
    window.accounts=FormresanStorage.createAccountStorage(auth);
    window.fixtureListenerCount=()=>listeners.size;
  },id);
}
async function allRaw(page){return page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])));}
test('Kontobunden förberedelse i Chromium 390 × 844',async t=>{
  const browser=await chromium.launch({headless:true});
  const errors=[];
  async function setup(){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());});
    await context.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(!u.href.startsWith(base))return route.abort();
      const file=u.pathname.slice('/formresan/'.length)||'index.html';
      await route.fulfill({path:path.join(root,file)});
    });
    const page=await context.newPage();await page.goto(base);
    await page.evaluate(([a,b])=>{localStorage.setItem('formresan_v1',JSON.stringify(a));localStorage.setItem('formresan_training_v14',JSON.stringify(b));},[legacyMain,legacyTraining]);
    await page.reload();await fixture(page);
    await page.evaluate(async()=>{window.account=await accounts.openAccount();});
    return{context,page};
  }
  try{
    await t.test('Inaktiv i appen, gamla nycklar bevaras och importeras inte',async()=>{
      const {context,page}=await setup();
      assert.match(await page.locator('#foods').innerText(),/Gammal testmat/);
      const initial=await allRaw(page);
      const data=await page.evaluate(async()=>({main:await account.readMain(),training:await account.readTraining(),backup:await account.exportRaw()}));
      assert.deepEqual(data.main.entries,[]);assert.deepEqual(data.training.sessions,[]);
      assert.deepEqual(data.backup.rawData,{main:null,training:null});assert.equal(data.backup.userId,A);
      assert.deepEqual(await allRaw(page),initial);
      await page.reload();
      assert.equal(await page.evaluate(()=>window.accounts),undefined);
      assert.deepEqual(await allRaw(page),initial);
      await context.close();
    });
    await t.test('A/B har egna huvud- och träningsutrymmen, inga e-postnycklar',async()=>{
      const {context,page}=await setup();
      await page.evaluate(async B=>{
        await account.updateMain(d=>d.entries.push({id:11,date:'2026-11-20',kind:'food',name:'A-mat',kcal:100,protein:10}));
        await account.updateTraining(d=>d.sessions.push({id:12,date:'2026-11-20',plan:'warm',exercises:[{id:'thoracic',done:true}]}));
        window.oldA=account;testAuth.set(B);window.account=await accounts.openAccount();
      },B);
      assert.deepEqual(await page.evaluate(async()=>[(await account.readMain()).entries,(await account.readTraining()).sessions]),[[],[]]);
      await page.evaluate(async()=>{
        await account.updateMain(d=>d.entries.push({id:21,date:'2026-11-20',kind:'food',name:'B-mat',kcal:200,protein:20}));
        await account.updateTraining(d=>d.sessions.push({id:22,date:'2026-11-20',plan:'mob',exercises:[{id:'ankle',done:true}]}));
      });
      const raw=await allRaw(page);assert.equal(Object.keys(raw).length,6);
      assert.equal(JSON.parse(raw[key(A,'main')]).entries[0].name,'A-mat');
      assert.equal(JSON.parse(raw[key(B,'main')]).entries[0].name,'B-mat');
      assert.equal(JSON.parse(raw[key(A,'training')]).sessions[0].plan,'warm');
      assert.equal(JSON.parse(raw[key(B,'training')]).sessions[0].plan,'mob');
      assert.ok(Object.keys(raw).every(k=>!k.includes('@')));
      assert.ok(Object.values(raw).every(v=>!v.includes('syntetisk@example.invalid')));
      assert.equal(raw.formresan_v1,JSON.stringify(legacyMain));assert.equal(raw.formresan_training_v14,JSON.stringify(legacyTraining));
      const message=await page.evaluate(async()=>{try{await oldA.readMain();return'fel';}catch(e){return e.message;}});assert.match(message,/kontexten har ändrats/);
      await page.evaluate(async A=>{testAuth.set(A);window.account=await accounts.openAccount();},A);
      assert.equal((await page.evaluate(()=>account.readMain())).entries[0].name,'A-mat');
      assert.match(await page.evaluate(async()=>{try{await oldA.updateMain(()=>{});return'fel';}catch(e){return e.message;}}),/kontexten har ändrats/);
      await context.close();
    });
    await t.test('Saknad/ogiltig/offline/anon Auth ger inget konto och ingen fallback',async()=>{
      const {context,page}=await setup();const initial=await allRaw(page);
      assert.match(await page.evaluate(()=>{try{FormresanStorage.createAccountStorage();return'fel';}catch(e){return e.message;}}),/Auth-klient/);
      for(const kind of ['null','invalid','malformed','anonymous','error','throws']){
        const result=await page.evaluate(async kind=>{
          testAuth.set(kind==='null'?null:kind==='invalid'?'epost@example.invalid':'00000000-0000-4000-8000-000000000001');
          testAuth.malformed=kind==='malformed';testAuth.anonymous=kind==='anonymous';testAuth.error=kind==='error'?{message:'syntetiskt fel'}:null;testAuth.throws=kind==='throws';
          try{await accounts.openAccount();return false;}catch{return true;}
        },kind);assert.equal(result,true,kind);
      }
      assert.deepEqual(await allRaw(page),initial);await context.close();
    });
    await t.test('Fördröjd verifiering under kontobyte lämnar båda konton orörda',async()=>{
      const {context,page}=await setup();const initial=await allRaw(page);
      await page.evaluate(()=>{testAuth.delay=true;window.pendingAccountWrite=account.updateMain(d=>d.entries.push({id:1,date:'2026-11-20',kind:'creatine'})).then(()=>false,()=>true);});
      await page.waitForFunction(()=>window.verificationStarted);
      await page.evaluate(B=>{testAuth.set(B);releaseVerification();},B);
      assert.equal(await page.evaluate(()=>pendingAccountWrite),true);assert.deepEqual(await allRaw(page),initial);
      await page.evaluate(()=>{testAuth.delay=true;window.verificationStarted=false;window.pendingOpen=accounts.openAccount().then(()=>false,()=>true);});
      await page.waitForFunction(()=>window.verificationStarted);
      await page.evaluate(()=>{testAuth.set(null);releaseVerification();});
      assert.equal(await page.evaluate(()=>pendingOpen),true);assert.deepEqual(await allRaw(page),initial);
      await context.close();
    });
    await t.test('Köad skrivning under Web Lock avvisas vid utloggning',async()=>{
      const {context,page}=await setup();const initial=await allRaw(page);
      await page.evaluate(A=>{navigator.locks.request('formresan-account-data-v1:'+A,()=>new Promise(r=>{window.releaseAccountLock=r;window.accountLockHeld=true;}));},A);
      await page.waitForFunction(()=>window.accountLockHeld);
      await page.evaluate(()=>{window.pendingAccountWrite=account.updateTraining(d=>d.sessions.push({id:1,date:'2026-11-20',plan:'warm',exercises:[]})).then(()=>false,()=>true);});
      await page.waitForFunction(async()=> (await navigator.locks.query()).pending.length>0);
      await page.evaluate(()=>{testAuth.set(null);releaseAccountLock();});
      assert.equal(await page.evaluate(()=>pendingAccountWrite),true);assert.deepEqual(await allRaw(page),initial);
      await context.close();
    });
    await t.test('Identitetsbyte utan händelse, byte inne i mutator och async mutator stoppas',async()=>{
      const {context,page}=await setup();const initial=await allRaw(page);
      assert.equal(await page.evaluate(async B=>{testAuth.set(B,false);try{await account.readMain();return false;}catch{return true;}},B),true);
      await page.evaluate(async A=>{testAuth.set(A);window.account=await accounts.openAccount();},A);
      assert.equal(await page.evaluate(async B=>{try{await account.updateMain(d=>{d.entries.push({id:1,date:'2026-11-20',kind:'creatine'});testAuth.set(B);});return false;}catch{return true;}},B),true);
      await page.evaluate(async()=>{window.account=await accounts.openAccount();});
      assert.equal(await page.evaluate(async()=>{try{await account.updateMain(async d=>{d.entries.push({id:1,date:'2026-11-20',kind:'creatine'});await Promise.resolve();});return false;}catch{return true;}}),true);
      assert.deepEqual(await allRaw(page),initial);await context.close();
    });
    await t.test('Sen Auth-händelse efter commit kan inte leverera A:s resultat till B',async()=>{
      const {context,page}=await setup();
      const rejected=await page.evaluate(async B=>{
        const original=Storage.prototype.setItem;
        Storage.prototype.setItem=function(k,v){original.call(this,k,v);if(k.startsWith('formresan_account_v1:'))queueMicrotask(()=>testAuth.set(B));};
        try{await account.updateMain(d=>d.entries.push({id:1,date:'2026-11-20',kind:'creatine'}));return false;}catch{return true;}finally{Storage.prototype.setItem=original;}
      },B);
      assert.equal(rejected,true);const raw=await allRaw(page);
      assert.equal(JSON.parse(raw[key(A,'main')]).entries.length,1);assert.equal(raw[key(B,'main')],undefined);
      await context.close();
    });
    await t.test('Validering, trasig JSON, råexport, lagringsfel och saknade Web Locks',async()=>{
      const {context,page}=await setup();const initial=await allRaw(page);
      assert.equal(await page.evaluate(async()=>{try{await account.updateMain(d=>d.entries.push({id:'fel',date:'2026-11-20',kind:'creatine'}));return false;}catch{return true;}}),true);
      assert.equal(await page.evaluate(async()=>{try{await account.updateTraining(d=>d.sessions.push({id:1,date:'2026-11-20',plan:'a',exercises:[{id:'curl',sets:[{kg:1,reps:0}]}]}));return false;}catch{return true;}}),true);
      assert.deepEqual(await allRaw(page),initial);
      await page.evaluate(k=>localStorage.setItem(k,'{trasig'),key(A,'training'));
      assert.equal(await page.evaluate(async()=>{try{await account.readTraining();return false;}catch{return true;}}),true);
      assert.equal((await page.evaluate(()=>account.exportRaw())).rawData.training,'{trasig');
      const before=await allRaw(page);
      const failed=await page.evaluate(async()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new DOMException('Full','QuotaExceededError');};try{await account.updateMain(d=>d.goals.protein=130);return false;}catch{return true;}finally{Storage.prototype.setItem=original;}});
      assert.equal(failed,true);assert.deepEqual(await allRaw(page),before);
      // En tidigare observerad kontonyckel får inte tyst ersättas med tom data.
      await page.evaluate(()=>account.updateMain(d=>d.goals.protein=130));
      await page.evaluate(k=>localStorage.removeItem(k),key(A,'main'));
      assert.equal(await page.evaluate(async()=>{try{await account.updateMain(()=>{});return false;}catch{return true;}}),true);
      assert.equal((await page.evaluate(()=>account.exportRaw())).rawData.main,null);
      await page.evaluate(()=>Object.defineProperty(navigator,'locks',{value:undefined,configurable:true}));
      assert.equal(await page.evaluate(async()=>{try{await account.updateMain(()=>{});return false;}catch{return true;}}),true);
      assert.deepEqual(await allRaw(page),before);await context.close();
    });
    await t.test('Två flikar med samma konto serialiserar skrivningar utan förlust',async()=>{
      const {context,page}=await setup();const other=await context.newPage();await other.goto(base);await fixture(other);
      await other.evaluate(async()=>window.account=await accounts.openAccount());
      const append=async p=>p.evaluate(async()=>{for(let i=0;i<15;i++)await account.updateMain(d=>d.entries.push({id:FormresanStorage.nextId(d.entries),date:'2026-11-20',kind:'food',name:'Syntetisk mat',kcal:1,protein:1}));});
      await Promise.all([append(page),append(other)]);
      const entries=(await page.evaluate(()=>account.readMain())).entries;
      assert.equal(entries.length,30);assert.equal(new Set(entries.map(e=>e.id)).size,30);
      await context.close();
    });
    await t.test('Huvuddel och iframe kan dela samma bundna lagringsobjekt',async()=>{
      const {context,page}=await setup();await page.getByRole('button',{name:'💪 Träning',exact:true}).click();
      const frame=page.frameLocator('#trainingFrame');await frame.locator('#content').waitFor();
      await page.evaluate(async()=>{const child=document.getElementById('trainingFrame').contentWindow;child.testSharedAccount=account;
        await Promise.all([account.updateMain(d=>d.goals.protein=140),child.testSharedAccount.updateTraining(d=>d.sessions.push({id:33,date:'2026-11-20',plan:'mob',exercises:[{id:'ankle',done:true}]}))]);});
      assert.equal((await page.evaluate(()=>account.readMain())).goals.protein,140);
      assert.equal((await page.evaluate(()=>account.readTraining())).sessions[0].id,33);
      const stale=await page.evaluate(async B=>{testAuth.set(B);window.account=await accounts.openAccount();try{await document.getElementById('trainingFrame').contentWindow.testSharedAccount.readTraining();return false;}catch{return true;}},B);
      assert.equal(stale,true);assert.deepEqual((await page.evaluate(()=>account.readTraining())).sessions,[]);
      // Ordinarie UI är fortfarande legacy och har inte kopplats till konton.
      assert.match(await page.locator('#foods').innerText(),/Gammal testmat/);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('formresan_training_v14')).sessions[0].id),2);
      await context.close();
    });
    await t.test('Dispose avbryter gamla objekt och avslutar Auth-bevakning',async()=>{
      const {context,page}=await setup();
      assert.equal(await page.evaluate(()=>fixtureListenerCount()),1);
      await page.evaluate(()=>{accounts.dispose();accounts.dispose();});
      assert.equal(await page.evaluate(()=>fixtureListenerCount()),0);
      assert.equal(await page.evaluate(async()=>{try{await accounts.openAccount();return false;}catch{return true;}}),true);
      assert.equal(await page.evaluate(async()=>{try{await account.readMain();return false;}catch{return true;}}),true);
      await context.close();
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

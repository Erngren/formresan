const {chromium}=require(process.env.FORMRESAN_PLAYWRIGHT||'playwright');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),base='https://erngren.github.io/formresan/';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const marker='formresan_account_lifecycle_v1';
const main={goals:{protein:177,cal:2222},entries:[{id:1,date:'2026-11-20',kind:'food',name:'Legacy A testmat',kcal:100,protein:10}]};
const training={sessions:[{id:2,date:'2026-11-20',plan:'a',exercises:[{id:'legpress',sets:[{kg:45,reps:10}]}]}]};
async function authFixture(page){
  await page.evaluate(()=>{
    const listeners=new Set();
    const auth={hold:false,
      async getUser(){const response=await window.fixtureVerifiedUser();if(auth.hold){auth.hold=false;window.verificationHeld=true;await new Promise(r=>window.releaseVerification=r);}return response;},
      onAuthStateChange(listener){listeners.add(listener);return{data:{subscription:{unsubscribe:()=>listeners.delete(listener)}}};},
      emit(event){for(const listener of [...listeners])listener(event,{user:{id:'UNVERIFIED-IGNORED'}});},
      async signOut(options){window.signOutScope=options.scope;const response=await window.fixtureSignOut();auth.emit('SIGNED_OUT');return response;}
    };
    window.testAuth=auth;
  });
}
const phase=(page,value,id)=>page.waitForFunction(({value,id})=>{const s=FormresanAccount.getState();return s.phase===value&&(!id||s.userId===id);},{value,id});
const dataSnapshot=page=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k!=='formresan_account_lifecycle_v1').sort().map(k=>[k,localStorage.getItem(k)])));

test('Säker kontolivscykel utan hostad Auth i Chromium 390 × 844',async t=>{
  const browser=await chromium.launch({headless:true});const errors=[];
  async function setup(){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const authority={user:{id:A,is_anonymous:false},error:null,calls:0,signOutError:null};
    await context.exposeBinding('fixtureVerifiedUser',()=>{authority.calls++;return{data:{user:authority.user},error:authority.error};});
    await context.exposeBinding('fixtureSignOut',()=>{if(!authority.signOutError)authority.user=null;return{error:authority.signOutError};});
    context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());});
    await context.route('**/*',route=>{
      const u=new URL(route.request().url());if(!u.href.startsWith(base))return route.abort();
      return route.fulfill({path:path.join(root,u.pathname.slice('/formresan/'.length)||'index.html')});
    });
    const page=await context.newPage();await page.goto(base);
    await page.evaluate(([a,b])=>{localStorage.setItem('formresan_v1',JSON.stringify(a));localStorage.setItem('formresan_training_v14',JSON.stringify(b));},[main,training]);
    await page.reload();await authFixture(page);
    return{context,page,authority};
  }
  try{
    await t.test('Saknad konfiguration är explicit lokalt testläge utan Auth-anrop',async()=>{
      const {context,page,authority}=await setup();
      assert.equal((await page.evaluate(()=>FormresanAccount.getState())).phase,'unconfigured');
      assert.match(await page.locator('#accountStatus').innerText(),/Lokalt testläge/);
      assert.match(await page.locator('#foods').innerText(),/Legacy A testmat/);
      assert.equal(authority.calls,0);assert.equal(await page.evaluate(k=>localStorage.getItem(k),marker),null);
      await context.close();
    });
    await t.test('A → B → A och utloggning håller datavyer låsta och separata',async()=>{
      const {context,page,authority}=await setup();const before=await dataSnapshot(page);
      await page.getByRole('button',{name:'+ Lägg till',exact:true}).first().click();await page.locator('#foodForm [name=name]').fill('Privat A-utkast');
      await page.evaluate(()=>FormresanAccount.attachAuth(testAuth));await phase(page,'signed_in',A);
      assert.equal(await page.locator('main').isVisible(),false);assert.equal(await page.locator('#foodDialog').evaluate(d=>d.open),false);
      assert.equal(await page.locator('#foodForm [name=name]').inputValue(),'');
      assert.deepEqual(await dataSnapshot(page),before);
      await page.evaluate(async()=>{window.oldA=FormresanAccount.captureAccount();await oldA.store.updateMain(d=>d.entries.push({id:11,date:'2026-11-20',kind:'food',name:'Konto A',kcal:1,protein:1}));});
      authority.user={id:B,is_anonymous:false};await page.evaluate(()=>testAuth.emit('SIGNED_IN'));await phase(page,'signed_in',B);
      assert.equal(await page.evaluate(async()=>{try{await oldA.store.readMain();return false;}catch{return true;}}),true);
      assert.deepEqual((await page.evaluate(()=>FormresanAccount.captureAccount().store.readMain())).entries,[]);
      authority.user={id:A,is_anonymous:false};await page.evaluate(()=>testAuth.emit('SIGNED_IN'));await phase(page,'signed_in',A);
      assert.equal((await page.evaluate(()=>FormresanAccount.captureAccount().store.readMain())).entries[0].name,'Konto A');
      assert.equal(await page.evaluate(()=>db.entries.length),0);
      await page.evaluate(()=>FormresanAccount.signOut());await phase(page,'signed_out');assert.equal(await page.evaluate(()=>signOutScope),'local');
      assert.equal(await page.locator('main').isVisible(),false);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('formresan_v1')).entries[0].name),'Legacy A testmat');
      const record=await page.evaluate(k=>localStorage.getItem(k),marker);assert.ok(!record.includes(A)&&!record.includes(B));
      await context.close();
    });
    await t.test('Avbruten och fördröjd verifiering samt sena SIGNED_IN återöppnar inte',async()=>{
      const {context,page}=await setup();
      await page.evaluate(()=>{testAuth.hold=true;window.oldVerification=FormresanAccount.attachAuth(testAuth);});
      await page.waitForFunction(()=>window.verificationHeld);await phase(page,'verifying');
      await page.evaluate(()=>{FormresanAccount.cancel();releaseVerification();});await page.evaluate(()=>oldVerification);await phase(page,'error');
      await page.evaluate(()=>testAuth.emit('SIGNED_IN'));await phase(page,'error');
      assert.equal(await page.locator('main').isVisible(),false);
      assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('formresan_account_v1:'))),false);
      await context.close();
    });
    await t.test('Köade legacy-skrivningar och gamla formulärcallbacks kan inte återställa A',async()=>{
      const {context,page}=await setup();const before=await dataSnapshot(page);
      await page.evaluate(()=>{navigator.locks.request('formresan-local-data-v1',()=>new Promise(r=>{window.releaseLegacy=r;window.lockHeld=true;}));});
      await page.waitForFunction(()=>window.lockHeld);
      await page.evaluate(()=>{window.oldSave=add({kind:'food',name:'Sen A-post',kcal:1,protein:1},'2026-11-20').then(()=>false,()=>true);});
      await page.waitForFunction(async()=> (await navigator.locks.query()).pending.length>0);
      await page.evaluate(()=>FormresanAccount.attachAuth(testAuth));await page.evaluate(()=>releaseLegacy());
      assert.equal(await page.evaluate(()=>oldSave),true);assert.deepEqual(await dataSnapshot(page),before);
      await page.evaluate(data=>applyDb(data),main);
      await page.evaluate(()=>openFood());assert.equal(await page.locator('#foodDialog').evaluate(d=>d.open),false);
      assert.equal(await page.evaluate(()=>db.entries.length),0);await context.close();
    });
    await t.test('Fördröjd kontoskrivning vid byte skapar ingen post i fel konto',async()=>{
      const {context,page,authority}=await setup();await page.evaluate(()=>FormresanAccount.attachAuth(testAuth));
      const before=await dataSnapshot(page);
      await page.evaluate(()=>{window.oldAccount=FormresanAccount.captureAccount();testAuth.hold=true;window.oldWrite=oldAccount.store.updateMain(d=>d.goals.protein=155).then(()=>false,()=>true);});
      await page.waitForFunction(()=>window.verificationHeld);authority.user={id:B,is_anonymous:false};
      await page.evaluate(()=>{testAuth.emit('SIGNED_IN');releaseVerification();});await phase(page,'signed_in',B);
      assert.equal(await page.evaluate(()=>oldWrite),true);assert.deepEqual(await dataSnapshot(page),before);await context.close();
    });
    await t.test('Huvudfönster och iframe delar kontroller och rensar träningshistorik/inmatning',async()=>{
      const {context,page}=await setup();await page.getByRole('button',{name:'💪 Träning',exact:true}).click();
      const frame=page.frameLocator('#trainingFrame');await frame.locator('#content').waitFor();await frame.locator('#sets-legpress .kg').first().fill('99');
      await frame.getByRole('button',{name:'📖 Benpress',exact:true}).click();
      await page.evaluate(()=>FormresanAccount.attachAuth(testAuth));
      assert.equal(await frame.locator('body').evaluate(()=>FormresanAccount===parent.FormresanAccount),true);
      assert.equal(await frame.locator('#guide').evaluate(d=>d.open),false);assert.equal(await frame.locator('#guideBody').innerText(),'');
      assert.equal(await frame.locator('body').evaluate(()=>state.sessions.length),0);
      assert.equal(await frame.locator('#sets-legpress .kg').first().inputValue(),'');assert.equal(await frame.locator('main').isVisible(),false);
      await frame.locator('body').evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pageshow'));refreshTraining();});
      assert.equal(await frame.locator('body').evaluate(()=>state.sessions.length),0);await context.close();
    });
    await t.test('Direkt träning och flera flikar återverifierar utan att betro meddelandeidentitet',async()=>{
      const {context,page,authority}=await setup();await page.evaluate(()=>FormresanAccount.attachAuth(testAuth));
      const other=await context.newPage();await other.goto(base+'training/index.html');
      assert.equal(await other.locator('main').isVisible(),false);assert.equal(await other.evaluate(()=>state.sessions.length),0);
      await authFixture(other);await other.evaluate(()=>FormresanAccount.attachAuth(testAuth));await phase(other,'signed_in',A);
      authority.user={id:B,is_anonymous:false};await page.evaluate(()=>testAuth.emit('SIGNED_IN'));
      await phase(page,'signed_in',B);await phase(other,'signed_in',B);
      await page.evaluate(()=>FormresanAccount.signOut());await phase(other,'signed_out');
      await other.reload();assert.equal((await other.evaluate(()=>FormresanAccount.getState())).phase,'error');
      assert.equal(await other.locator('main').isVisible(),false);assert.equal(await other.evaluate(()=>state.sessions.length),0);await context.close();
    });
    await t.test('Ogiltig Auth, verifieringsfel, anonym och trasig kontext ger inget konto',async()=>{
      for(const kind of ['invalid','error','anonymous','missing','bad_marker']){
        const {context,page,authority}=await setup();const before=await dataSnapshot(page);
        if(kind==='invalid')await page.evaluate(()=>FormresanAccount.attachAuth({userId:'UNVERIFIED'}));
        else if(kind==='bad_marker'){
          await page.evaluate(k=>localStorage.setItem(k,'{trasigt'),marker);await page.reload();
        }else{
          if(kind==='error')authority.error={message:'syntetiskt fel'};
          if(kind==='anonymous')authority.user={id:A,is_anonymous:true};
          if(kind==='missing')authority.user=null;
          await page.evaluate(()=>FormresanAccount.attachAuth(testAuth));
        }
        const s=await page.evaluate(()=>FormresanAccount.getState());assert.equal(s.phase,kind==='missing'?'signed_out':'error',kind);assert.equal(s.userId,null);
        assert.equal(await page.locator('main').isVisible(),false);assert.deepEqual(await dataSnapshot(page),before);
        await context.close();
      }
    });
    await t.test('Markerbyte kontrolleras även utan lokal storage-händelse före commit',async()=>{
      const {context,page}=await setup();await page.evaluate(()=>FormresanAccount.attachAuth(testAuth));const before=await dataSnapshot(page);
      const denied=await page.evaluate(async key=>{const captured=FormresanAccount.captureAccount();localStorage.setItem(key,JSON.stringify({version:1,nonce:crypto.randomUUID(),intent:'logout'}));try{await captured.store.updateMain(d=>d.goals.protein=199);return false;}catch{return true;}},marker);
      assert.equal(denied,true);assert.deepEqual(await dataSnapshot(page),before);await phase(page,'signed_out');await context.close();
    });
    await t.test('Sen import och export ger ingen bekräftelse, visning eller fil',async()=>{
      const {context,page}=await setup();let downloads=0;page.on('download',()=>downloads++);const before=await dataSnapshot(page);
      await page.evaluate(()=>{
        window.oldImport=importData({target:{value:'syntetisk',files:[{text:()=>new Promise(r=>window.releaseImport=r)}]}});
        const original=FormresanStorage.exportMain;
        FormresanStorage.exportMain=async()=>{const data=await original();window.exportHeld=true;await new Promise(r=>window.releaseExport=r);return data;};
        window.oldExport=exportData();
      });
      await page.waitForFunction(()=>window.exportHeld&&window.releaseImport);
      await page.evaluate(()=>FormresanAccount.attachAuth(testAuth));
      await page.evaluate(data=>{releaseImport(JSON.stringify(data));releaseExport();},main);
      await page.evaluate(()=>Promise.all([oldImport,oldExport]));
      assert.equal(downloads,0);assert.deepEqual(await dataSnapshot(page),before);assert.equal(await page.evaluate(()=>db.entries.length),0);await context.close();
    });
    await t.test('Smart mat ignorerar sent resultat även om hämtningen inte respekterar abort',async()=>{
      const {context,page}=await setup();
      await context.route('https://dataportal.livsmedelsverket.se/**',r=>r.fulfill({json:{_meta:{totalRecords:1,offset:0},livsmedel:[{nummer:123,namn:'Syntetisk mat A'}]}}));
      await page.evaluate(()=>{const original=window.fetch;window.fetch=(url,options)=>String(url).includes('/naringsvarden')?new Promise(r=>{window.nutritionHeld=true;window.releaseNutrition=()=>r({ok:true,json:async()=>[{euroFIRkod:'ENERC',enhet:'kcal',viktGram:100,matrisenhetkod:'W',varde:100},{euroFIRkod:'PROT',enhet:'g',viktGram:100,matrisenhetkod:'W',varde:10}]});}):original(url,options);});
      await page.getByRole('button',{name:'+ Lägg till',exact:true}).first().click();await page.locator('#smartFoodDetails summary').click();
      await page.locator('#smartFoodQuery').fill('Syntetisk 200 g');await page.getByRole('button',{name:'Sök livsmedel',exact:true}).click();
      await page.locator('#smartFoodChoices').selectOption({label:'Syntetisk mat A'});await page.waitForFunction(()=>window.nutritionHeld);
      await page.evaluate(()=>FormresanAccount.attachAuth(testAuth));await page.evaluate(()=>releaseNutrition());
      assert.equal(await page.locator('#smartFoodPreview').innerText(),'');assert.equal(await page.locator('#smartFoodQuery').inputValue(),'');
      assert.equal(await page.locator('#smartFoodChoices option').count(),0);assert.equal(await page.locator('#foodDialog').evaluate(d=>d.open),false);
      assert.equal(await page.locator('#smartFoodSave').isDisabled(),true);await context.close();
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

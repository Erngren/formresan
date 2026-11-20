// Riktig, versionslåst SDK. All HTTP uppfylls lokalt; ingen Auth-server kontaktas.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.FORMRESAN_PLAYWRIGHT||'playwright');
const sdk=process.env.FORMRESAN_SUPABASE_UMD||path.join(path.dirname(process.env.FORMRESAN_PLAYWRIGHT||require.resolve('playwright/package.json')),'@supabase/supabase-js/dist/umd/supabase.js');
const root=path.resolve(__dirname,'..'),base='https://erngren.github.io/formresan/';
const origin='https://abcdefghijklmnopqrst.supabase.co',key='formresan_auth_v1:abcdefghijklmnopqrst.supabase.co';
const config={enabled:true,deploymentOrigin:'https://erngren.github.io',url:origin,publishableKey:'sb_publishable_synthetic_public_key_not_for_use'};
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const legacy={goals:{protein:120,cal:0},entries:[{id:1,date:'2026-11-20',kind:'food',name:'Gammal syntetisk testmat',kcal:1,protein:1}]};
const phase=(page,p,id)=>page.waitForFunction(({p,id})=>FormresanAccount.getState().phase===p&&(!id||FormresanAccount.getState().userId===id),{p,id},{timeout:5000}).catch(async error=>{console.log(await page.evaluate(()=>({auth:FormresanAuth.getState(),account:FormresanAccount.getState()})));throw error;});
const idle=page=>page.waitForFunction(()=>FormresanAuth.getState().ready&&!FormresanAuth.getState().busy,null,{timeout:5000}).catch(async error=>{console.log(await page.evaluate(()=>({auth:FormresanAuth.getState(),account:FormresanAccount.getState()})));throw error;});
const login=async(page,email='a@example.invalid')=>{await idle(page);await page.locator('#authEmail').fill(email);await page.locator('#authPassword').fill('synthetic-test-password');await page.locator('#authSubmit').click();};

test('Officiell Supabase SDK och inloggning i Chromium 390 × 844',async t=>{
  const browser=await chromium.launch({headless:true});
  const sdkBytes=fs.readFileSync(sdk);
  assert.equal(require('node:crypto').createHash('sha384').update(sdkBytes).digest('base64'),'A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ');
  async function setup(conf=config,entry=''){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const fixture={calls:[],sdk:0,errors:[],hold:null,offline:false,refresh:0,users:new Map(),refreshes:new Map()};
    function session(id){
      const user={id,aud:'authenticated',role:'authenticated',email:(id===A?'a':'b')+'@example.invalid',created_at:'2026-11-20T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{}};
      const payload={sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'};
      const token=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.synthetic';
      const refresh='synthetic-'+id;fixture.users.set(token,user);fixture.refreshes.set(refresh,id);
      return{access_token:token,refresh_token:refresh,expires_in:3600,token_type:'bearer',user};
    }
    context.on('page',p=>p.on('pageerror',e=>fixture.errors.push(e.message)));
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.href.startsWith(base)){
        if(url.pathname.endsWith('/js/auth-config.js'))return route.fulfill({contentType:'application/javascript',body:'window.FormresanAuthConfig = '+(conf === 'missing' ? 'undefined' : JSON.stringify(conf))+';'});
        return route.fulfill({path:path.join(root,url.pathname.slice('/formresan/'.length)||'index.html')});
      }
      if(url.href==='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js'){
        fixture.sdk++;return route.fulfill({body:sdkBytes,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'}});
      }
      if(url.origin!==origin){fixture.errors.push('Oväntat nätverk');return route.abort();}
      fixture.calls.push({path:url.pathname,grant:url.searchParams.get('grant_type')});
      if(fixture.offline)return route.abort();
      const reply=(status,body)=>route.fulfill({status,json:body,headers:{'access-control-allow-origin':'*'}});
      if(url.pathname==='/auth/v1/token'){
        const body=request.postDataJSON();
        if(body.email==='wrong@example.invalid')return reply(400,{code:'invalid_credentials',message:'synthetic account information must not be displayed'});
        if(fixture.hold){const wait=fixture.hold;fixture.hold=null;fixture.held=true;await wait;}
        if(url.searchParams.get('grant_type')==='refresh_token'){
          fixture.refresh++;const id=fixture.refreshes.get(body.refresh_token);return id?reply(200,session(id)):reply(400,{message:'invalid refresh'});
        }
        return reply(200,session(body.email==='b@example.invalid'?B:A));
      }
      if(url.pathname==='/auth/v1/user'){
        const user=fixture.users.get((request.headers().authorization||'').replace('Bearer ',''));
        return user?reply(200,user):reply(401,{message:'invalid token'});
      }
      if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*'}});
      fixture.errors.push('Otillåten Auth-endpoint');return route.abort();
    });
    const page=await context.newPage();
    await page.goto(base+entry);
    return{page,context,fixture};
  }
  async function done(f){assert.deepEqual(f.fixture.errors,[]);await f.context.close();}
  try{
    await t.test('Saknad, avstängd och ogiltig konfiguration gör inga SDK/Auth-anrop',async()=>{
      for(const conf of ['missing',{enabled:false},{enabled:true},{...config,publishableKey:'sb_secret_SYNTHETIC'},{...config,url:origin+'/wrong'},{...config,deploymentOrigin:'https://wrong.invalid'}]){
        const f=await setup(conf);await f.page.waitForLoadState('load');assert.equal(f.fixture.sdk,0);assert.equal(f.fixture.calls.length,0);
        const managed=await f.page.evaluate(()=>FormresanAccount.getState().managed);
        assert.equal(managed,conf!=='missing'&&conf.enabled!==false);
        await done(f);
      }
    });
    await t.test('Lyckad inloggning, felmeddelande, A → B → A och ingen legacy-import',async()=>{
      const f=await setup(),{page}=f;await idle(page);
      await page.evaluate(data=>localStorage.setItem('formresan_v1',JSON.stringify(data)),legacy);
      await login(page,'wrong@example.invalid');await idle(page);
      assert.match(await page.locator('#authMessage').innerText(),/Det gick inte att logga in/);
      assert.doesNotMatch(await page.locator('#authMessage').innerText(),/synthetic account information/);
      assert.equal(await page.locator('#authPassword').getAttribute('type'),'password');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.FORMRESAN_AUTH_SCREENSHOT)await page.screenshot({path:process.env.FORMRESAN_AUTH_SCREENSHOT});
      for(const [email,id]of [['a@example.invalid',A],['b@example.invalid',B],['a@example.invalid',A]]){
        await login(page,email);await phase(page,'signed_in',id);await idle(page);
        assert.equal(await page.locator('main').isVisible(),false);
        assert.equal(await page.locator('#authPassword').inputValue(),'');
        assert.equal(await page.evaluate(()=>FormresanAccount.getState().accountViewsEnabled),false);
        assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('formresan_account_v1:'))),false);
        await page.locator('#authLogout').click();await idle(page);await phase(page,'signed_out');
      }
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('formresan_v1'))),legacy);
      assert.ok(f.fixture.calls.some(c=>c.path==='/auth/v1/user'));
      assert.equal(f.fixture.sdk,1);await done(f);
    });
    await t.test('Avbruten inloggning och sent SDK-svar rensas före nytt försök',async()=>{
      const f=await setup(),{page,fixture}=f;let release;fixture.hold=new Promise(r=>release=r);
      await login(page);await page.waitForFunction(()=>FormresanAuth.getState().busy);
      while(!fixture.held)await new Promise(r=>setTimeout(r,10));
      await page.locator('#authCancel').click();assert.equal(await page.locator('main').isVisible(),false);
      assert.equal(await page.locator('#authSubmit').isDisabled(),true);
      release();await idle(page);
      assert.notEqual(await page.evaluate(()=>FormresanAccount.getState().phase),'signed_in');
      assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);
      await login(page,'b@example.invalid');await phase(page,'signed_in',B);await done(f);
    });
    await t.test('Sessionsåterställning, refresh-token och bakgrund/återgång verifieras',async()=>{
      const f=await setup(),{page,fixture}=f;await login(page);await phase(page,'signed_in',A);await idle(page);
      await page.reload();await phase(page,'signed_in',A);await idle(page);
      await page.evaluate(k=>{const session=JSON.parse(localStorage.getItem(k));session.expires_at=1;localStorage.setItem(k,JSON.stringify(session));},key);
      await page.reload();await phase(page,'signed_in',A);await idle(page);assert.ok(fixture.refresh>0);
      await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
      await phase(page,'signed_in',A);assert.equal(await page.locator('main').isVisible(),false);await done(f);
    });
    await t.test('Utloggning i annan flik spärrar en pågående sen inloggning',async()=>{
      const f=await setup(),{page,context,fixture}=f;await idle(page);
      const other=await context.newPage();await other.goto(base);await idle(other);
      let release;fixture.hold=new Promise(r=>release=r);
      await login(page);while(!fixture.held)await new Promise(r=>setTimeout(r,10));
      await other.locator('#authLogout').click();
      release();await idle(page);await idle(other);
      assert.notEqual(await page.evaluate(()=>FormresanAccount.getState().phase),'signed_in');
      assert.notEqual(await other.evaluate(()=>FormresanAccount.getState().phase),'signed_in');
      assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);
      // SDK:ts logout-notifieringar kan fortfarande levereras efter locksläpp.
      // De ska få stoppa ett överlappande försök. Omladdning etablerar en ny
      // livscykel innan vi separat verifierar återhämtning med konto B.
      await page.reload();await idle(page);await other.reload();await idle(other);
      await login(other,'b@example.invalid');await phase(other,'signed_in',B);await phase(page,'signed_in',B);
      assert.equal(await page.locator('main').isVisible(),false);await done(f);
    });
    await t.test('Flera flikar, iframe och direkt träning använder verifierad Auth och låsta vyer',async()=>{
      const f=await setup(),{page,context}=f;await login(page);await phase(page,'signed_in',A);await idle(page);
      const other=await context.newPage();await other.goto(base+'training/index.html');await phase(other,'signed_in',A);await idle(other);
      // Ladda den annars lazy iframe-vyn utan att öppna privata main.
      await page.locator('#trainingFrame').evaluate(frame=>{frame.loading='eager';});
      let frame;await page.waitForFunction(()=>document.querySelector('#trainingFrame').contentWindow.FormresanAuth);
      frame=page.frames().find(f=>f.url().includes('/training/'));assert.ok(frame);
      assert.equal(await frame.evaluate(()=>FormresanAuth===parent.FormresanAuth),true);
      assert.equal(f.fixture.sdk,2); // En i varje toppdokument; ingen i iframen.
      await page.locator('#authLogout').click();await idle(page);await phase(other,'signed_out');
      await login(other,'b@example.invalid');await phase(other,'signed_in',B);await phase(page,'signed_in',B);
      assert.equal(await other.locator('main').isVisible(),false);assert.equal(await page.locator('main').isVisible(),false);
      await done(f);
    });
    await t.test('SDK-laddningsfel och offline-verifiering lämnar privata vyer låsta',async()=>{
      const f=await setup();await login(f.page);await phase(f.page,'signed_in',A);await idle(f.page);
      f.fixture.offline=true;await f.page.locator('#authRetry').click();await idle(f.page);
      assert.notEqual(await f.page.evaluate(()=>FormresanAccount.getState().phase),'signed_in');
      assert.equal(await f.page.locator('main').isVisible(),false);await done(f);
      const g=await setup({enabled:false});
      await g.context.route('https://cdn.jsdelivr.net/**',r=>r.abort());
      await g.context.route('**/js/auth-config.js*',r=>r.fulfill({contentType:'application/javascript',body:'window.FormresanAuthConfig='+JSON.stringify(config)}));
      await g.page.reload();await g.page.waitForFunction(()=>FormresanAuth.getState().message.includes('kunde inte startas'));
      assert.equal(await g.page.locator('main').isVisible(),false);
      await g.context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:'window.tamperedSdkExecuted = true;',headers:{'access-control-allow-origin':'*'}}));
      await g.page.reload();await g.page.waitForFunction(()=>FormresanAuth.getState().message.includes('kunde inte startas'));
      assert.equal(await g.page.evaluate(()=>window.tamperedSdkExecuted),undefined);
      assert.equal(await g.page.locator('main').isVisible(),false);await done(g);
    });
  } finally {await browser.close();}
});

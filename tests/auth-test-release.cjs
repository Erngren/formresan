const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {build}=require('../tools/build-auth-test.cjs');
const root=path.resolve(__dirname,'..'),testOrigin='https://formresan-auth-test.example.invalid';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'formresan-artifact-'));
let sequence=0;
const output=()=>path.join(temporary,'build-'+(++sequence));
const approval={purpose:'formresan-auth-test',targetProject:'formresan-test',approval:'BUILD_AUTH_TEST_ARTIFACT_ONLY',deploymentOrigin:testOrigin,
  productionOrigins:['https://erngren.github.io'],url:'https://abcdefghijklmnopqrst.supabase.co',publishableKey:'sb_publishable_synthetic_public_key_not_for_use'};
function approvalFile(data){const file=path.join(temporary,'config-'+(++sequence)+'.json');fs.writeFileSync(file,JSON.stringify(data));return file;}

test('Auth-testbygge är separat, deterministiskt och avstängt som standard',()=>{
  const original=fs.readFileSync(path.join(root,'js/auth-config.js'));
  const a=output(),b=output(),first=build({output:a,testOrigin}),second=build({output:b,testOrigin});
  assert.deepEqual(first,second);assert.equal(first.authEnabled,false);
  assert.match(fs.readFileSync(path.join(a,'js/auth-config.js'),'utf8'),/"enabled":false/);
  assert.deepEqual(fs.readFileSync(path.join(root,'js/auth-config.js')),original);
  for(const [file,hash] of Object.entries(first.sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(a,file))).digest('hex'),hash);
  assert.equal(fs.existsSync(path.join(a,'.git')),false);assert.equal(fs.existsSync(path.join(a,'supabase')),false);assert.equal(fs.existsSync(path.join(a,'tests')),false);
  assert.doesNotMatch(fs.readFileSync(path.join(a,'index.html'),'utf8'),/rel="manifest"/);
  assert.ok(fs.readFileSync(path.join(a,'training/index.html'),'utf8').indexOf('auth-test-environment.js')<fs.readFileSync(path.join(a,'training/index.html'),'utf8').indexOf('js/storage.js'));
  assert.throws(()=>build({output:a,testOrigin})); // Inget overwrite eller cleanup.
});
test('Produktionsorigin, sökvägar, Git-kataloger och implicit aktivering nekas',()=>{
  for(const origin of ['https://erngren.github.io','https://erngren.github.io/formresan-test/','http://test.example.invalid','https://user:pass@test.example.invalid','https://test.example.invalid/extra'])assert.throws(()=>build({output:output(),testOrigin:origin}));
  assert.throws(()=>build({output:path.join(root,'forbidden-artifact'),testOrigin}));
  assert.throws(()=>build({output:output(),testOrigin,activationFile:approvalFile(approval)}));
  assert.throws(()=>build({output:output(),testOrigin,activate:true}));
});
test('Aktiveringsfil kräver uttryckligt val, separat origin och endast publishable key',()=>{
  for(const delta of [{purpose:'production'},{approval:'yes'},{targetProject:'wrong'},{deploymentOrigin:'https://wrong.invalid'},
    {productionOrigins:[testOrigin,'https://erngren.github.io']},{productionOrigins:[]},{publishableKey:'sb_secret_SYNTHETIC'},
    {publishableKey:'eyJhbGciOiJIUzI1NiJ9.synthetic'},{url:approval.url+'/path'},{extra:'not allowed'}]){
    const target=output();assert.throws(()=>build({output:target,testOrigin,activate:true,activationFile:approvalFile({...approval,...delta})}));assert.equal(fs.existsSync(target),false);
  }
  const target=output();const manifest=build({output:target,testOrigin,activate:true,activationFile:approvalFile(approval)});
  assert.equal(manifest.authEnabled,true);assert.match(fs.readFileSync(path.join(target,'js/auth-config.js'),'utf8'),/sb_publishable_synthetic/);
});
test('CLI avvisar utan värden i loggen och gör inget nätverk eller deploy',()=>{
  const r=spawnSync(process.execPath,[path.join(root,'tools/build-auth-test.cjs'),'--output',output(),'--test-origin',testOrigin,'--activate-auth-test','--approved-config',approvalFile({...approval,publishableKey:'sb_secret_SYNTHETIC_DO_NOT_PRINT'})],{encoding:'utf8'});
  assert.equal(r.status,1);assert.doesNotMatch(r.stdout+r.stderr,/sb_secret|abcdefghijklmnopqrst/);
});

test('Testartefakt i Chromium 390 × 844, bara lokalt uppfyllda filer',async t=>{
  const {chromium}=require(process.env.FORMRESAN_PLAYWRIGHT||'playwright');
  const browser=await chromium.launch({headless:true});
  const sdk=process.env.FORMRESAN_SUPABASE_UMD||path.join(path.dirname(process.env.FORMRESAN_PLAYWRIGHT||require.resolve('playwright/package.json')),'@supabase/supabase-js/dist/umd/supabase.js');
  async function probe({active=false,wrongOrigin=false,entry='',tamper=false}={}){
    const target=output();build({output:target,testOrigin,...(active?{activate:true,activationFile:approvalFile(approval)}:{})});
    if(tamper)fs.writeFileSync(path.join(target,'js/auth-config.js'),'window.FormresanAuthConfig='+JSON.stringify(tamper==='enabled'?{enabled:true,deploymentOrigin:testOrigin,url:approval.url,publishableKey:approval.publishableKey}:{enabled:true})+';');
    const actual=wrongOrigin?'https://wrong.example.invalid':testOrigin;
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,serviceWorkers:'block'});
    await context.addInitScript(()=>{if(location.protocol==='https:')localStorage.setItem('formresan_v1',JSON.stringify({goals:{protein:120,cal:0},entries:[{id:1,date:'2026-11-20',kind:'food',name:'Privat gammal testpost',kcal:1,protein:1}]}));});
    let sdkCalls=0,unexpected=0;const errors=[];
    context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    await context.route('**/*',r=>{
      const url=new URL(r.request().url());
      if(url.origin===actual)return r.fulfill({path:path.join(target,url.pathname.slice(1)||'index.html')});
      if(url.hostname==='cdn.jsdelivr.net'){sdkCalls++;return r.fulfill({path:sdk,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'}});}
      unexpected++;return r.abort(); // Inget Auth-anrop lämnar ens mocken.
    });
    const page=await context.newPage();await page.goto(actual+'/'+entry);
    await page.waitForFunction(()=>window.FormresanAuth&&!FormresanAuth.getState().busy);
    assert.equal(await page.locator('main').isVisible(),false);assert.match(await page.locator('#authTestEnvironment').innerText(),/AUTH-TEST/);
    assert.doesNotMatch(await page.locator('body').innerText(),/Privat gammal testpost/);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('formresan_v1')).entries[0].name),'Privat gammal testpost');
    assert.equal(await page.evaluate(()=>FormresanAccount.getState().accountViewsEnabled),false);
    assert.equal(unexpected,0);assert.deepEqual(errors,[]);
    assert.equal(sdkCalls,active&&!wrongOrigin&&!tamper?1:0);
    if(active&&!wrongOrigin&&!tamper)assert.equal(await page.evaluate(()=>FormresanAuth.getState().ready),true);
    await context.close();
  }
  try{
    await t.test('Avstängd release, huvudapp och direkt träning läcker inga legacy-vyer',async()=>{await probe();await probe({entry:'training/index.html'});});
    await t.test('Fel origin och felaktig konfiguration låser utan SDK/Auth',async()=>{await probe({active:true,wrongOrigin:true});await probe({tamper:true});await probe({tamper:'enabled'});});
    await t.test('Endast syntetisk explicit konfiguration startar SDK på rätt test-origin',async()=>{await probe({active:true});});
  }finally{await browser.close();}
});

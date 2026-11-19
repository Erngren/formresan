// Endast anropad av den isolerande runnern. Inga URL:er/nycklar från miljön.
const assert = require('node:assert/strict');
const {randomUUID,randomBytes} = require('node:crypto');
const tables = ['main_entries','training_sessions','user_settings','record_versions','sync_operations','migration_batches','migration_snapshots'];
const claims = token => JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
function publicKey(key) {
  if (typeof key !== 'string' || key.startsWith('sb_secret_')) throw new Error('Publik testnyckel krävs');
  if (key.startsWith('sb_publishable_')) return;
  try { if (claims(key).role === 'anon') return; } catch {}
  throw new Error('Endast publishable eller legacy anon tillåts');
}
function localUrl(value) {
  const u=new URL(value);
  if(u.protocol!=='http:' || u.hostname!=='127.0.0.1' || !u.port || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw new Error('Isolerad loopback-URL krävs');
  return u.origin;
}
async function runAuthRest({url,key,runId,seedMetadata,report=console.log}) {
  url=localUrl(url);publicKey(key);
  assert.match(runId,/^formresan-auth-test-[a-f0-9]{16}$/);
  // Varken feltexter, HTTP-kroppar eller Authorization får skrivas till logg.
  const requireOk=(condition,label)=>{if(!condition)throw new Error(label);};
  async function http(path,token,method='GET',body) {
    const response=await fetch(url+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=null;}
    return {status:response.status,ok:response.ok,data};
  }
  const ok=(r,label)=>{requireOk(r.ok,label);return r.data;};
  const denied=(r,label)=>requireOk([401,403].includes(r.status) && r.data?.code==='42501',label);
  const code=(r,c,label)=>requireOk(!r.ok && r.data?.code===c && (c!=='PT409'||r.status===409),label);
  const select=(token,table,filter='')=>http(`/rest/v1/${table}?select=*${filter}`,token);
  const payload={id:123.5,date:'2026-11-19',kind:'food',name:'Syntetiskt test',kcal:100,protein:10};
  const request=(entity,revision,p=payload,action='put',operation=randomUUID(),collection='main_entries')=>({p_operation_id:operation,p_collection:collection,p_entity_id:entity,p_expected_revision:revision,p_payload:p,p_action:action});
  const rpc=(token,body)=>http('/rest/v1/rpc/apply_operation',token,'POST',body);
  async function step(label,fn){await fn();report('PASS '+label);}
  let A,B;
  await step('Auth: två vanliga registreringar och lösenordsinloggningar',async()=>{
    async function account(letter) {
      const email=`${runId}-${letter}@example.test`,password=randomBytes(24).toString('base64url');
      const signup=ok(await http('/auth/v1/signup',null,'POST',{email,password}),'Auth signup misslyckades');
      requireOk(!!signup.access_token && !!signup.user?.id,'Lokal autoconfirm krävs');
      const login=ok(await http('/auth/v1/token?grant_type=password',null,'POST',{email,password}),'Auth inloggning misslyckades');
      requireOk(!!login.access_token && login.user?.id===signup.user.id,'Fel Auth-identitet');
      const user=ok(await http('/auth/v1/user',login.access_token),'Auth user misslyckades');
      requireOk(user.id===login.user.id && claims(login.access_token).sub===user.id && claims(login.access_token).role==='authenticated','JWT/Auth-identitet stämmer inte');
      return {id:user.id,token:login.access_token};
    }
    A=await account('a');B=await account('b');requireOk(A.id!==B.id,'Separata konton krävs');
  });
  // Separat administrativ fixturesetup. Skapar inga konton, används aldrig för REST.
  await seedMetadata([A.id,B.id]);
  const ae=randomUUID(), be=randomUUID(), first=request(ae,0);
  await step('Anonym: sju privata tabeller och RPC nekas',async()=>{
    for(const table of tables) denied(await select(null,table),'Anonym läsning tillåts');
    denied(await rpc(null,request(randomUUID(),0)),'Anonym RPC tillåts');
  });
  await step('RPC når rätt auth.uid och A/B kan läsa sina egna poster',async()=>{
    const receipt=ok(await rpc(A.token,first),'A create misslyckades');
    requireOk(receipt.entity_id===ae && receipt.revision===1,'Fel skapandekvitto');
    ok(await rpc(B.token,request(be,0,{...payload,id:999})),'B create misslyckades');
    for(const u of [A,B]) {
      ok(await rpc(u.token,request(randomUUID(),0,{protein:120,cal:0},'put',randomUUID(),'user_settings')),'Settings misslyckades');
      ok(await rpc(u.token,request(randomUUID(),0,{id:456,date:'2026-11-19',plan:'a',exercises:[{id:'curl',sets:[{kg:10,reps:8}]}]},'put',randomUUID(),'training_sessions')),'Training misslyckades');
      for(const table of tables){const rows=ok(await select(u.token,table),'Ägarläsning misslyckades');requireOk(Array.isArray(rows)&&rows.length>0&&rows.every(r=>r.user_id===u.id),'Fel ägaridentitet via REST');}
    }
  });
  await step('B ser inga A-rader, även med explicit ägarfilter i alla tabeller',async()=>{
    for(const [u,other] of [[B,A],[A,B]])for(const table of tables)assert.deepEqual(ok(await select(u.token,table,`&user_id=eq.${other.id}`),'Filtrerad läsning misslyckades'),[]);
    assert.deepEqual(ok(await select(B.token,'main_entries',`&entity_id=eq.${ae}`),'UUID-läsning misslyckades'),[]);
  });
  await step('B kan varken patcha, hårdradera eller RPC-ändra A',async()=>{
    for(const [method,body] of [['PATCH',{payload:{...payload,kcal:999}}],['DELETE',undefined]]) denied(await http(`/rest/v1/main_entries?entity_id=eq.${ae}`,B.token,method,body),'B direktskrivning tillåts');
    code(await rpc(B.token,request(ae,1)),'PT409','B RPC update tillåts');
    code(await rpc(B.token,request(ae,1,null,'delete')),'PT409','B RPC delete tillåts');
    const row=ok(await select(A.token,'main_entries',`&entity_id=eq.${ae}`),'A efterkontroll misslyckades')[0];requireOk(row.revision===1&&row.payload.kcal===100,'A ändrades av B');
  });
  await step('Ägare/moln-ID/revision kan inte patchas och payloadmetadata ger ingen auktoritet',async()=>{
    for(const body of [{user_id:B.id},{entity_id:be},{revision:999}])denied(await http(`/rest/v1/main_entries?entity_id=eq.${ae}`,A.token,'PATCH',body),'Metadata PATCH tillåts');
    denied(await http('/rest/v1/main_entries',A.token,'POST',{user_id:B.id,entity_id:randomUUID(),payload,revision:1}),'Direkt INSERT tillåts');
    const e=randomUUID();ok(await rpc(A.token,request(e,0,{...payload,user_id:B.id,entity_id:be,revision:999})),'Opak metadata avvisades oväntat');
    const row=ok(await select(A.token,'main_entries',`&entity_id=eq.${e}`),'Metadataläsning misslyckades')[0];requireOk(row.user_id===A.id&&row.entity_id===e&&row.revision===1,'Payload ändrade auktoritet');
    code(await rpc(A.token,request(ae,1,{...payload,id:'SQL; --'})),'22023','Fel ID godkändes');
    code(await rpc(A.token,{...request(ae,1),p_collection:'main_entries; drop table auth.users'}),'22023','Fel collection godkändes');
  });
  await step('Fel revision avvisas utan historik/kvitto',async()=>{
    const r=request(ae,99);code(await rpc(A.token,r),'PT409','Fel revision godkändes');
    assert.deepEqual(ok(await select(A.token,'sync_operations',`&operation_id=eq.${r.p_operation_id}`),'Kvittoläsning misslyckades'),[]);
  });
  await step('Identiska återförsök ger samma kvitto, ändrad begäran avvisas',async()=>{
    const receipt=ok(await rpc(A.token,first),'Återförsök misslyckades');assert.deepEqual(ok(await rpc(A.token,first),'Återförsök misslyckades'),receipt);
    code(await rpc(A.token,{...first,p_payload:{...payload,kcal:999}}),'22023','Ändrat operations-ID godkändes');
    requireOk(ok(await select(A.token,'record_versions',`&entity_id=eq.${ae}`),'Historikläsning misslyckades').length===1,'Dubblerad version');
  });
  await step('Mjuk radering och uttrycklig återställning skapar versionskedja',async()=>{
    requireOk(ok(await rpc(A.token,request(ae,1,null,'delete')),'Delete misslyckades').revision===2,'Fel raderingsrevision');
    requireOk(!!ok(await select(A.token,'main_entries',`&entity_id=eq.${ae}`),'Tombstone saknas')[0]?.deleted_at,'Tombstone saknas');
    code(await rpc(A.token,request(ae,2)),'22023','Tyst återupplivning tilläts');
    requireOk(ok(await rpc(A.token,request(ae,2,payload,'restore')),'Restore misslyckades').revision===3,'Fel återställningsrevision');
    const versions=ok(await select(A.token,'record_versions',`&entity_id=eq.${ae}&order=revision`),'Versionsläsning misslyckades');
    assert.deepEqual(versions.map(v=>v.revision),[1,2,3]);requireOk(!!versions[1].deleted_at&&!versions[2].deleted_at,'Fel raderingshistorik');
  });
  await step('Historik, kvitton och migrationsmetadata saknar direkta skrivvägar',async()=>{
    for(const table of tables.slice(3)) {
      const before=ok(await select(A.token,table),'Metadata saknas');
      for(const [method,body] of [['POST',before[0]],['PATCH',{user_id:B.id}],['DELETE',undefined]])denied(await http(`/rest/v1/${table}${method==='POST'?'':`?user_id=eq.${A.id}`}`,A.token,method,body),'Metadata kunde skrivas');
      assert.deepEqual(ok(await select(A.token,table),'Efterkontroll misslyckades'),before);
    }
    const helper=await http('/rest/v1/rpc/valid_payload',A.token,'POST',{collection:'main_entries',p:payload});requireOk(helper.status===404,'Privat helper exponerad');
  });
  await step('Samtidiga REST-uppdateringar ger exakt en vinnare',async()=>{
    const e=randomUUID();ok(await rpc(A.token,request(e,0)),'Förberedande post misslyckades');
    const results=await Promise.all([rpc(A.token,request(e,1,{...payload,kcal:200})),rpc(A.token,request(e,1,{...payload,kcal:300}))]);
    requireOk(results.filter(r=>r.ok).length===1&&results.filter(r=>r.status===409&&r.data?.code==='PT409').length===1,'Samtidig konflikt hanterades fel');
    const row=ok(await select(A.token,'main_entries',`&entity_id=eq.${e}`),'Efterkontroll misslyckades')[0];requireOk(row.revision===2,'Fel revision efter konflikt');
    requireOk(ok(await select(A.token,'record_versions',`&entity_id=eq.${e}`),'Historik saknas').length===2,'Fel versionsantal');
    const retry=request(randomUUID(),0),receipts=await Promise.all([rpc(A.token,retry),rpc(A.token,retry)]);receipts.forEach(r=>ok(r,'Parallellt återförsök misslyckades'));assert.deepEqual(receipts[0].data,receipts[1].data);
  });
  await step('Ogiltig och manipulerad token nekas av REST och Auth',async()=>{
    const parts=A.token.split('.'), forged=[parts[0],Buffer.from(JSON.stringify({...claims(A.token),sub:B.id,role:'service_role'})).toString('base64url'),parts[2]].join('.');
    for(const token of ['invalid-token',forged]) {
      requireOk((await select(token,'main_entries')).status===401,'REST godtog fel token');
      requireOk([401,403].includes((await http('/auth/v1/user',token)).status),'Auth godtog fel token');
      requireOk((await rpc(token,request(randomUUID(),0))).status===401,'RPC godtog fel token');
    }
  });
  await step('Riktigt utfärdad token som löpt ut nekas',async()=>{
    const exp=claims(A.token).exp;requireOk(Number.isInteger(exp),'Token saknar exp');
    requireOk(exp*1000-Date.now()<90000,'Testmiljön måste ha kort JWT-livslängd');
    const deadline=exp*1000+65000;
    while(Date.now()<deadline) {
      if(Date.now()>exp*1000) {
        const r=await select(A.token,'main_entries');
        if(r.status===401){requireOk((await rpc(A.token,request(randomUUID(),0))).status===401,'Utgången token nådde RPC');return;}
        requireOk(r.ok,'Oväntat fel i expiry-prov');
      }
      await new Promise(r=>setTimeout(r,1000));
    }
    throw new Error('Utgången token accepterades efter tillåten väntan');
  });
  report('Auth/REST: samtliga 13 scenarier godkända. Endast syntetiska data.');
}
module.exports={runAuthRest,localUrl,publicKey};
if(require.main===module){console.error('Kör tests/run-auth-rest.cjs för verifierad isolering.');process.exitCode=1;}

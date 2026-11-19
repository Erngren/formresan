// Endast ny PostgreSQL-service på tillfällig GitHub-runner. Inga hostade mål.
// Ingen DROP, datarensning, backend-terminering eller containerborttagning.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes,randomUUID,createHmac}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {Client}=require('pg');
const {verifyDockerEndpoint,cleanEnvironment}=require('./run-auth-rest.cjs');
const old=readFileSync(resolve(__dirname,'../supabase/migrations/20261119000100_foundation.sql'),'utf8');
const patch=readFileSync(resolve(__dirname,'../supabase/migrations/20261119000200_revision_conflict_http409.sql'),'utf8');
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const payload={id:101,date:'2026-11-19',kind:'food',name:'Syntetiskt RPC-prov',kcal:100,protein:10};
async function main(){
  assert.equal(process.argv[2],'--isolated-ci');assert.equal(process.argv.length,3);
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.CI,'true');
  const u=new URL(process.env.FORMRESAN_RPC_TEST_URL);
  assert.equal(u.hostname,'127.0.0.1');assert.equal(u.protocol,'postgresql:');assert.equal(u.pathname,'/formresan_test_rpc_retry');
  const env=cleanEnvironment(process.env);
  if(env.DOCKER_HOST)verifyDockerEndpoint(env.DOCKER_HOST);
  async function docker(args){return await new Promise((ok,no)=>{
    const p=spawn('docker',args,{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';
    p.stdout.on('data',b=>output+=b);p.stderr.on('data',()=>{});
    p.on('error',()=>no(new Error('Docker saknas')));p.on('close',c=>c===0?ok(output):no(new Error('Lokalt Docker-steg misslyckades')));
  });}
  verifyDockerEndpoint(JSON.parse(await docker(['context','inspect']))[0]?.Endpoints?.docker?.Host);
  const admin=new Client({connectionString:u.toString()});await admin.connect();
  const dbs=[],containers=[];
  try {
    assert.equal(Number((await admin.query("select count(*) from pg_namespace where nspname='auth'")).rows[0].count),0);
    assert.equal(Number((await admin.query("select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r'")).rows[0].count),0);
    assert.equal(Number((await admin.query("select count(*) from pg_roles where rolname in ('anon','authenticated')")).rows[0].count),0);
    const id=randomBytes(6).toString('hex'),authenticator='rpc_auth_'+id,secret=randomBytes(32).toString('hex');
    await admin.query(`create role anon nologin;create role authenticated nologin;create role ${authenticator} login noinherit;
      grant anon,authenticated to ${authenticator};`);
    const token=user=>{
      const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
      const p=Buffer.from(JSON.stringify({sub:user,role:'authenticated',exp:Math.floor(Date.now()/1000)+600})).toString('base64url');
      return `${h}.${p}.`+createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url');
    };
    const entity=randomUUID();
    for(const variant of ['legacy','fixed']){
      const name=`formresan_test_${id}_${variant}`;
      await admin.query(`create database ${name}`);
      const url=new URL(u);url.pathname='/'+name;
      const db=new Client({connectionString:url.toString()});await db.connect();dbs.push(db);
      await db.query(`create schema auth;create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$
          select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
        $$;
        grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
      await db.query('insert into auth.users values($1),($2)',[A,B]);
      await db.query(old);
      if(variant==='fixed')await db.query(patch);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[A]);
      await db.query('select public.apply_operation($1,$2,$3,0,$4::jsonb,$5)',[randomUUID(),'main_entries',entity,JSON.stringify(payload),'put']);
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      const container=`formresan-rpc-${id}-${variant}`;
      // host-network stöds här bara på den tillfälliga Linux-runnern.
      const port=variant==='legacy'?54131:54132;
      const apiUrl=new URL(url);apiUrl.username=authenticator;apiUrl.password='';
      await docker(['run','-d','--name',container,'--network','host','--cpus','0.25','--memory','256m',
        '-e',`PGRST_DB_URI=${apiUrl.toString()}`,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon',
        '-e',`PGRST_JWT_SECRET=${secret}`,'-e',`PGRST_SERVER_PORT=${port}`,'-e','PGRST_SERVER_HOST=127.0.0.1',
        '-e','PGRST_DB_POOL=2','-e','PGRST_LOG_LEVEL=crit','postgrest/postgrest:v14.5']);
      containers.push(container);
      const origin=`http://127.0.0.1:${port}`;
      for(let i=0;;i++){
        try{const r=await fetch(origin,{signal:AbortSignal.timeout(300),redirect:'error'});if(r.status<500)break;}catch{}
        assert.ok(i<100,'Lokal PostgREST blev inte redo');await new Promise(r=>setTimeout(r,100));
      }
    }
    const [legacy,fixed]=dbs;
    const request=(e=entity,revision=1,p=payload,action='put',operation=randomUUID())=>({p_operation_id:operation,p_collection:'main_entries',p_entity_id:e,p_expected_revision:revision,p_payload:p,p_action:action});
    const origins={legacy:'http://127.0.0.1:54131',fixed:'http://127.0.0.1:54132'};
    let legacyHttpRequests=0;
    async function rpc(which,user,body,timeout=5000){
      if(which==='legacy')legacyHttpRequests++;
      const start=performance.now();
      const r=await fetch(origins[which]+'/rpc/apply_operation',{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeout),
        headers:{Authorization:'Bearer '+token(user),'Content-Type':'application/json'},body:JSON.stringify(body)});
      return {status:r.status,data:await r.json(),ms:performance.now()-start};
    }
    const rollbacks=async db=>Number((await db.query('select pg_stat_clear_snapshot();select xact_rollback from pg_stat_database where datname=current_database()'))[1].rows[0].xact_rollback);
    const before=await rollbacks(legacy);
    try {
      await assert.rejects(()=>rpc('legacy',B,request(),1200),e=>e.name==='TimeoutError');
      await new Promise(r=>setTimeout(r,1300));
    }finally{await docker(['pause',containers[0]]);}
    const delta=await rollbacks(legacy)-before;
    assert.equal(legacyHttpRequests,1);assert.ok(delta>1,'Retry-loop kunde inte verifieras');
    console.log(`BASELINE PostgREST 14.5: HTTP-anrop=${legacyHttpRequests}, timeout=1200ms, databas-rollbacks=${delta}. Gateway pausad utan datarensning.`);
    const state=async db=>(await db.query(`select
      (select coalesce(jsonb_agg(to_jsonb(e) order by user_id,entity_id),'[]') from public.main_entries e) entries,
      (select coalesce(jsonb_agg(to_jsonb(v) order by user_id,collection,entity_id,revision),'[]') from public.record_versions v) versions,
      (select coalesce(jsonb_agg(to_jsonb(o) order by user_id,operation_id),'[]') from public.sync_operations o) operations`)).rows;
    assert.equal(Number((await legacy.query('select count(*) from public.sync_operations where user_id=$1',[B])).rows[0].count),0);
    assert.equal(Number((await legacy.query('select revision from public.main_entries where user_id=$1 and entity_id=$2',[A,entity])).rows[0].revision),1);
    const snapshot=await state(fixed),durations=[];
    for(const [user,body,expected] of [
      [A,request(entity,99),'PT409'],[B,request(),'PT409'],[B,request(entity,1,null,'delete'),'PT409'],
      [B,request(entity,1,payload,'delete'),'PT409'],[A,request(entity,1,payload,'delete'),'22023']
    ]){
      const r=await rpc('fixed',user,body);assert.equal(r.data.code,expected);assert.equal(r.status,expected==='PT409'?409:400);
      assert.ok(r.ms<2000,'Avsiktlig konflikt tog för lång tid');durations.push(Math.round(r.ms));
      assert.deepEqual(await state(fixed),snapshot,'Nekat anrop ändrade data/historik/kvitto');
    }
    console.log('FIXED PostgREST 14.5: revisions-/kontoavslag under 2000ms, uppmätta ms='+durations.join(',')+'. Inga data-/historik-/kvittoskillnader.');
    const update=await rpc('fixed',A,request(entity,1,{...payload,kcal:200}));assert.equal(update.status,200);assert.equal(update.data.revision,2);
    const del=await rpc('fixed',A,request(entity,2,null,'delete'));assert.equal(del.status,200);assert.equal(del.data.revision,3);assert.ok(del.data.deleted_at);
    const e=randomUUID(),op=request(e,0);
    const retries=await Promise.all([rpc('fixed',A,op),rpc('fixed',A,op)]);
    assert.equal(retries[0].status,200);assert.equal(retries[1].status,200);assert.deepEqual(retries[0].data,retries[1].data);
    assert.equal(Number((await fixed.query('select count(*) from public.record_versions where entity_id=$1',[e])).rows[0].count),1);
    const reused=await rpc('fixed',A,{...op,p_payload:{...payload,kcal:999}});assert.equal(reused.data.code,'22023');
    const race=await Promise.all([rpc('fixed',A,request(e,1,{...payload,kcal:200})),rpc('fixed',A,request(e,1,{...payload,kcal:300}))]);
    assert.equal(race.filter(r=>r.status===200).length,1);assert.equal(race.filter(r=>r.status===409&&r.data.code==='PT409').length,1);
    const failed=race.find(r=>r.status===409);
    assert.equal(Number((await fixed.query('select count(*) from public.record_versions where entity_id=$1',[e])).rows[0].count),2);
    assert.equal(Number((await fixed.query('select count(*) from public.sync_operations where receipt->>\'entity_id\'=$1',[e])).rows[0].count),2);
    assert.ok(failed.ms<2000);
    console.log('PASS normal PUT/DELETE, oförändrat efter avslag, idempotens, ändrat operations-ID, parallell revision och inga konfliktkvitton/versioner.');
  }finally{
    // Frys endast våra nyskapade gateways. Inga DROP/DELETE/rm/stop/reset.
    for(const c of containers.slice(1))await docker(['pause',c]);
    for(const db of dbs)await db.end();await admin.end();
  }
}
if(require.main===module)main().catch(()=>{console.error('Isolerat RPC-retry-prov ej godkänt. Inga hemligheter eller råa svar loggas.');process.exitCode=1;});

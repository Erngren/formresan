// Endast en ny isolerad testdatabas. Inga nätanrop eller riktiga användardata.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {randomUUID} = require('node:crypto');
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const tables = ['main_entries','training_sessions','user_settings','record_versions','sync_operations','migration_batches','migration_snapshots'];
const food = {id:123.5,date:'2026-11-19',kind:'food',name:'Test',kcal:100,protein:10,extra:{legacy:true}};
const migration = readFileSync(resolve(__dirname,'../supabase/migrations/20261119000100_foundation.sql'),'utf8');

test('Isolerad databas och säkerhetsgrund', async t => {
  let db, pool;
  const real = !!process.env.FORMRESAN_TEST_DATABASE_URL;
  if (real) {
    const url = new URL(process.env.FORMRESAN_TEST_DATABASE_URL);
    assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname), 'Endast loopback tillåts');
    assert.match(url.pathname, /^\/formresan_test[a-z0-9_]*$/, 'Dedikerat testdatabasnamn krävs');
    const {Pool} = require(process.env.FORMRESAN_PG || 'pg');
    pool = new Pool({connectionString:url.toString()});
    db = {query:(...args)=>pool.query(...args),exec:sql=>pool.query(sql),close:()=>pool.end()};
  } else {
    const {PGlite} = require(process.env.FORMRESAN_PGLITE || '@electric-sql/pglite');
    db = new PGlite();
  }
  t.after(()=>db.close());
  const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
  // Vägrar installera om en tidigare databas. Ingen DROP/återställning.
  assert.equal(await scalar("select count(*)::integer from pg_namespace where nspname = 'auth'"),0,'Kräver tom testdatabas');
  await db.exec(`
    do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;
    insert into auth.users values('${A}'),('${B}');
  `);
  await db.exec(migration);
  async function asUser(user, action, client=db) {
    if (pool && client === db) {
      const connection = await pool.connect();
      try { return await asUser(user,action,connection); }
      finally { connection.release(); }
    }
    await client.query('begin');
    try {
      await client.query(`set local role ${user ? 'authenticated' : 'anon'}`);
      await client.query("select set_config('request.jwt.claim.sub',$1,true)",[user || '']);
      const result = await action(client);
      await client.query('commit');
      return result;
    } catch(e) {await client.query('rollback'); throw e;}
  }
  function op(c, entity, revision, payload, action='put', operation=randomUUID(), collection='main_entries') {
    return c.query('select public.apply_operation($1,$2,$3,$4,$5::jsonb,$6) receipt',
      [operation,collection,entity,revision,payload === null ? null : JSON.stringify(payload),action]).then(r=>r.rows[0].receipt);
  }
  const rejects = (fn,code)=>assert.rejects(fn,e=>e.code===code);
  const ae=randomUUID(), be=randomUUID(), operation=randomUUID();
  let receipt;
  await t.test('Skapa och återförsök ger samma kvitto och en version',async()=>{
    receipt=await asUser(A,c=>op(c,ae,0,food,'put',operation));
    assert.equal(receipt.revision,1);
    assert.deepEqual(await asUser(A,c=>op(c,ae,0,food,'put',operation)),receipt);
    await rejects(()=>asUser(A,c=>op(c,ae,0,{...food,kcal:99},'put',operation)),'22023');
    await asUser(B,c=>op(c,be,0,{...food,id:999}));
    assert.equal(await scalar('select count(*)::integer from public.main_entries'),2);
  });
  // Administrativa syntetiska fixturer för ännu stängda migrationsvägar.
  for(const u of [A,B]) {
    const batch=randomUUID();
    await db.query('insert into public.migration_batches(user_id,batch_id,source_hashes,expected_count) values($1,$2,$3,0)',[u,batch,'{}']);
    await db.query('insert into public.migration_snapshots(user_id,batch_id,main_raw) values($1,$2,$3)',[u,batch,'{"synthetic":true}']);
    await asUser(u,c=>op(c,randomUUID(),0,{protein:120,cal:0},'put',randomUUID(),'user_settings'));
    await asUser(u,c=>op(c,randomUUID(),0,{id:456,date:'2026-11-19',plan:'a',exercises:[{id:'curl',sets:[{kg:10,reps:8}]}]},'put',randomUUID(),'training_sessions'));
  }
  await t.test('RLS i alla sju tabeller, A/B och anonym',async()=>{
    for(const table of tables) {
      assert.equal(await scalar(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`),true);
      for(const u of [A,B]) {
        const rows=await asUser(u,c=>c.query(`select * from public.${table}`));
        assert.ok(rows.rows.length>0);
        assert.ok(rows.rows.every(r=>r.user_id===u));
        assert.equal((await asUser(u,c=>c.query(`select * from public.${table} where user_id=$1`,[u===A?B:A]))).rows.length,0);
      }
      await rejects(()=>asUser(null,c=>c.query(`select * from public.${table}`)),'42501');
      for(const sql of [
        `insert into public.${table} default values`,
        `update public.${table} set user_id='${B}'`,
        `delete from public.${table} where user_id='${B}'`,
        `truncate public.${table}`
      ]) await rejects(()=>asUser(A,c=>c.query(sql)),'42501');
    }
    for(const field of ['user_id','entity_id']) await rejects(()=>asUser(A,c=>c.query(`update public.main_entries set ${field}=$1 where entity_id=$2`,[randomUUID(),ae])),'42501');
    await rejects(()=>asUser(null,c=>op(c,randomUUID(),0,food)),'42501');
    await rejects(()=>asUser(A,c=>{return c.query("select set_config('request.jwt.claim.sub','',true)").then(()=>op(c,randomUUID(),0,food));}),'42501');
  });
  await t.test('Främmande UUID och fel revision kan inte skriva över B',async()=>{
    await rejects(()=>asUser(A,c=>op(c,be,1,food)),'40001');
    await rejects(()=>asUser(A,c=>op(c,be,1,null,'delete')),'40001');
    assert.equal(Number((await asUser(B,c=>c.query('select revision from public.main_entries where entity_id=$1',[be]))).rows[0].revision),1);
    await rejects(()=>asUser(A,c=>op(c,ae,99,food)),'40001');
    await rejects(()=>asUser(A,c=>op(c,ae,1,{...food,id:321})),'22023');
  });
  await t.test('JSONB valideras, okända fält bevaras utan SQL-exekvering',async()=>{
    for(const p of [null,[],{}, {...food,id:'1); drop table auth.users;--'}, {...food,kcal:'10'}, {...food,date:'2026-02-30'}, {...food,kind:'admin'}]) {
      await rejects(()=>asUser(A,c=>op(c,randomUUID(),0,p)),'22023');
    }
    await rejects(()=>asUser(A,c=>op(c,randomUUID(),0,food,'put',randomUUID(),'main_entries; drop table auth.users')),'22023');
    await rejects(()=>asUser(A,c=>op(c,randomUUID(),0,{},'put',randomUUID(),'user_settings')),'22023');
    await rejects(()=>asUser(A,c=>op(c,randomUUID(),0,{id:1,date:'2026-11-19',plan:'a',exercises:[{id:'curl',sets:[{kg:'evil',reps:8}]}]},'put',randomUUID(),'training_sessions')),'22023');
    await asUser(A,c=>op(c,ae,1,{...food,name:"'); drop table auth.users;--",user_id:B,revision:999,entity_id:be}));
    const row=(await asUser(A,c=>c.query('select * from public.main_entries where entity_id=$1',[ae]))).rows[0];
    assert.equal(row.user_id,A);assert.equal(Number(row.revision),2);assert.equal(row.entity_id,ae);
    assert.deepEqual(row.payload.extra,{legacy:true});assert.equal(row.payload.id,123.5);
  });
  await t.test('Mjuk radering, atomisk historik och uttrycklig återställning',async()=>{
    await asUser(A,c=>op(c,ae,2,null,'delete'));
    await rejects(()=>asUser(A,c=>op(c,ae,3,food)),'22023');
    const versions=(await asUser(A,c=>c.query('select * from public.record_versions where entity_id=$1 order by revision',[ae]))).rows;
    assert.deepEqual(versions.map(v=>Number(v.revision)),[1,2,3]);assert.ok(versions[2].deleted_at);
    await asUser(A,c=>op(c,ae,3,food,'restore'));
    assert.equal(await scalar(`select count(*)::integer from public.record_versions where entity_id='${ae}'`),4);
    const before=await scalar('select count(*)::integer from public.sync_operations');
    const client=pool ? await pool.connect() : db;
    try {
      await client.query('begin');await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)",[A]);
      await op(client,randomUUID(),0,food);
      await client.query('rollback');
    } finally {if(pool)client.release();}
    assert.equal(await scalar('select count(*)::integer from public.sync_operations'),before);
    assert.equal(await scalar('select count(*)::integer from public.record_versions'),before);
  });
  await t.test('En aktiv sömn/kreatin per dag, konflikt lämnar inget kvitto',async()=>{
    for(const kind of ['sleep','creatine']) {
      const p={id:900,date:'2026-11-19',kind,...(kind==='sleep'?{minutes:480}:{})};
      await asUser(A,c=>op(c,randomUUID(),0,p));
      const before=await scalar('select count(*)::integer from public.sync_operations');
      await rejects(()=>asUser(A,c=>op(c,randomUUID(),0,p)),'23505');
      assert.equal(await scalar('select count(*)::integer from public.sync_operations'),before);
    }
  });
  await t.test('Schema, funktioner och standardrättigheter',async()=>{
    assert.equal(await scalar("select has_schema_privilege('authenticated','public','CREATE')"),false);
    assert.equal(await scalar("select has_schema_privilege('authenticated','formresan_private','USAGE')"),false);
    const sig='public.apply_operation(uuid,text,uuid,bigint,jsonb,text)';
    assert.equal(await scalar(`select has_function_privilege('authenticated','${sig}','EXECUTE')`),true);
    assert.equal(await scalar(`select has_function_privilege('anon','${sig}','EXECUTE')`),false);
    await rejects(()=>asUser(A,c=>c.query("select formresan_private.valid_payload('main_entries','{}')")),'42501');
    const f=(await db.query("select prosecdef,proconfig,pg_get_userbyid(proowner) owner from pg_proc where oid=$1::regprocedure",[sig])).rows[0];
    assert.equal(f.prosecdef,true);assert.equal(f.owner,'postgres');assert.ok(f.proconfig.includes('search_path=""'));
    await db.exec("create function public.future_test() returns integer language sql as 'select 1'");
    for(const role of ['anon','authenticated']) assert.equal(await scalar(`select has_function_privilege('${role}','public.future_test()','EXECUTE')`),false);
  });
  await t.test('Två faktiska anslutningar: revision och identiska återförsök', {skip:!real && 'PGlite har en anslutning. Kräver isolerad PostgreSQL med pg.'},async()=>{
    const entity=randomUUID();await asUser(A,c=>op(c,entity,0,food));
    async function parallel(actions) {
      const clients=await Promise.all(actions.map(()=>pool.connect()));
      try {return await Promise.allSettled(actions.map((fn,i)=>asUser(A,fn,clients[i])));}finally{clients.forEach(c=>c.release());}
    }
    const results=await parallel([c=>op(c,entity,1,{...food,kcal:200}),c=>op(c,entity,1,{...food,kcal:300})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'40001');
    const e=randomUUID(),oid=randomUUID();
    const retry=await parallel([c=>op(c,e,0,food,'put',oid),c=>op(c,e,0,food,'put',oid)]);
    assert.ok(retry.every(r=>r.status==='fulfilled'));assert.deepEqual(retry[0].value,retry[1].value);
    assert.equal(await scalar(`select count(*)::integer from public.record_versions where entity_id='${e}'`),1);
  });
});

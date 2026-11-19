// Verifierar enbart läskontroller i ny PGlite. Kan inte ansluta till hostad miljö.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createHash}=require('node:crypto');
const {PGlite}=require(process.env.FORMRESAN_PGLITE||'@electric-sql/pglite');
const sql=name=>readFileSync(resolve(__dirname,'../supabase',name),'utf8');
const pre=sql('verification/hosted-preflight.sql');
const post=sql('verification/hosted-postflight.sql');
const migration=sql('migrations/20261119000100_foundation.sql');

test('Hostade läskontroller i isolerad PostgreSQL-motor',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon nologin;create role authenticated nologin;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    create schema storage;create table storage.objects(id uuid primary key);`);
  async function checks(source){return (await db.exec(source)).flatMap(r=>r.rows||[]).filter(r=>r.check_name);}
  await t.test('Tom miljö kan förgranskas, SQL-transaktionerna är skrivskyddade',async()=>{
    const runbook=readFileSync(resolve(__dirname,'../docs/SUPABASE_HOSTED.md'),'utf8');
    const hash=createHash('sha256').update(migration.replace(/\r\n/g,'\n')).digest('hex');
    assert.ok(runbook.includes(hash),'Runbookens migrationshash måste motsvara den granskade filen');
    for(const source of [pre,post]) {
      assert.match(source,/begin transaction read only;/i);assert.match(source,/rollback;\s*$/i);
      assert.doesNotMatch(source,/\b(drop|truncate|insert|update|delete|grant|revoke|alter|create|execute|call|copy)\s+(table|schema|function|into|from|all|on|public\.)/i);
    }
    const results=await checks(pre);assert.equal(results.length,8);assert.ok(results.every(r=>r.passed===true));
    await assert.rejects(()=>db.exec('begin transaction read only;create table public.forbidden(id int);'),e=>e.code==='25006');
    await db.exec('rollback');
  });
  await t.test('Befintliga appobjekt eller konton stoppar tomhetskontroll',async()=>{
    await db.exec("create table public.unrelated_app(id integer);insert into auth.users values('00000000-0000-4000-8000-000000000001');");
    const results=await checks(pre);
    assert.equal(results.find(r=>r.check_name==='no_public_application_relations').passed,false);
    assert.equal(results.find(r=>r.check_name==='auth_empty_before_test_accounts').passed,false);
    // Endast lokal syntetisk fixture, aldrig ett hostat mål.
    await db.exec('drop table public.unrelated_app;delete from auth.users;');
  });
  await t.test('Mergad migration passerar postflight och kan inte installeras igen enligt preflight',async()=>{
    await db.exec(migration);
    const results=await checks(post);assert.equal(results.length,12);
    assert.deepEqual(results.filter(r=>!r.passed),[]);
    const before=await checks(pre);
    for(const name of ['no_formresan_relations','no_formresan_function_overloads','no_private_schema'])assert.equal(before.find(r=>r.check_name===name).passed,false);
    const rows=(await db.exec(post)).flatMap(r=>r.rows||[]).filter(r=>'row_count' in r);
    assert.equal(rows.length,7);assert.ok(rows.every(r=>Number(r.row_count)===0));
  });
  await t.test('Kontroller upptäcker lös RLS, kolumngrants, PUBLIC EXECUTE och fel search_path',async()=>{
    const cases=[
      ["alter table public.main_entries disable row level security",'seven_owned_rls_tables',"alter table public.main_entries enable row level security"],
      ["create policy bad_read on public.main_entries for select to authenticated using(true)",'only_owner_select_policies',"drop policy bad_read on public.main_entries"],
      ["grant update(payload) on public.main_entries to authenticated",'authenticated_select_only',"revoke update(payload) on public.main_entries from authenticated"],
      ["grant select(payload) on public.main_entries to anon",'anon_no_table_or_column_privileges',"revoke select(payload) on public.main_entries from anon"],
      ["grant execute on function public.apply_operation(uuid,text,uuid,bigint,jsonb,text) to public",'no_public_execute_on_formresan_functions',"revoke execute on function public.apply_operation(uuid,text,uuid,bigint,jsonb,text) from public"],
      ["alter default privileges for role postgres grant execute on functions to public",'global_future_functions_closed',"alter default privileges for role postgres revoke execute on functions from public"],
      ["alter function public.apply_operation(uuid,text,uuid,bigint,jsonb,text) set search_path='public'",'rpc_definer_owner_and_search_path',"alter function public.apply_operation(uuid,text,uuid,bigint,jsonb,text) set search_path=''"],
    ];
    for(const [breakSql,name,repair] of cases) {
      await db.exec(breakSql);assert.equal((await checks(post)).find(r=>r.check_name===name).passed,false,name);
      await db.exec(repair);assert.ok((await checks(post)).every(r=>r.passed===true));
    }
  });
});

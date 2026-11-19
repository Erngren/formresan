const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {PGlite}=require(process.env.FORMRESAN_PGLITE||'@electric-sql/pglite');
const read=name=>readFileSync(resolve(__dirname,'../supabase/migrations',name),'utf8');
const old=read('20261119000100_foundation.sql'),patch=read('20261119000200_revision_conflict_http409.sql');
test('Migrationen ändrar bara två applikationsfel och bevarar säkerhetsmetadata',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';`);
  await db.exec(old);
  // Bevara även en tillfälligt indragen RPC-rätt; migrationen får inte återöppna den.
  await db.exec('revoke execute on function public.apply_operation(uuid,text,uuid,bigint,jsonb,text) from authenticated');
  const metadata=async()=> (await db.query(`select p.proowner,p.proacl::text,p.prosecdef,p.proconfig,p.provolatile,p.prorettype,p.proargtypes::text,p.proargnames,p.pronargdefaults
    from pg_proc p where oid='public.apply_operation(uuid,text,uuid,bigint,jsonb,text)'::regprocedure`)).rows;
  const body=async()=> (await db.query("select prosrc from pg_proc where oid='public.apply_operation(uuid,text,uuid,bigint,jsonb,text)'::regprocedure")).rows[0].prosrc.replace(/\r\n/g,'\n');
  const before=await metadata(),source=await body();
  assert.equal((source.match(/errcode = '40001'/g)||[]).length,2);
  await db.exec(patch);
  assert.deepEqual(await metadata(),before);
  assert.equal(await body(),source.replaceAll("errcode = '40001'","errcode = 'PT409'"));
  // Ingen tyst överskrivning vid drift eller andra modifieringar av funktionen.
  await assert.rejects(()=>db.exec(patch),e=>e.code==='22023'&&e.message==='apply_operation_drift_review_required');
  await db.exec('rollback');
  assert.equal(await body(),source.replaceAll("errcode = '40001'","errcode = 'PT409'"));
});

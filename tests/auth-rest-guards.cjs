const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {join}=require('node:path');
const {localUrl,publicKey}=require('./auth-rest-security.cjs');
const {verifyDockerEndpoint,cleanEnvironment}=require('./run-auth-rest.cjs');
test('URL- och nyckelspärrar',()=>{
  assert.equal(localUrl('http://127.0.0.1:54321'),'http://127.0.0.1:54321');
  for(const u of ['https://example.supabase.co','http://localhost:54321','http://127.0.0.1:54321/proxy','http://user:password@127.0.0.1:54321','http://127.0.0.1:54321?remote=yes'])assert.throws(()=>localUrl(u));
  const jwt=role=>'e30.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
  publicKey(jwt('anon'));publicKey('sb_publishable_synthetic');
  for(const key of [jwt('service_role'),jwt('authenticated'),'sb_secret_synthetic','invalid',undefined])assert.throws(()=>publicKey(key));
});
test('Docker måste vara lokal och CLI får inga ärvda mål/nycklar',()=>{
  verifyDockerEndpoint('unix:///var/run/docker.sock');verifyDockerEndpoint('npipe:////./pipe/docker_engine');
  for(const e of ['ssh://remote','tcp://localhost:2375','https://remote',''])assert.throws(()=>verifyDockerEndpoint(e));
  assert.deepEqual(cleanEnvironment({PATH:'safe',SUPABASE_ACCESS_TOKEN:'synthetic',SUPABASE_CLI_BINARY_OVERRIDE:'bad',PGHOST:'remote',FORMRESAN_TEST_DATABASE_URL:'remote',NODE_OPTIONS:'bad'}),{PATH:'safe'});
});
test('Direkt och osäkert anrop avvisas före nätverk eller Docker',()=>{
  for(const args of [[],['--isolated-local','--remote']]) {
    const r=spawnSync(process.execPath,[join(__dirname,'run-auth-rest.cjs'),...args],{encoding:'utf8'});assert.equal(r.status,1);assert.doesNotMatch(r.stdout,/PASS/);
  }
  const r=spawnSync(process.execPath,[join(__dirname,'run-auth-rest.cjs'),'--isolated-local'],{encoding:'utf8',env:{...process.env,SUPABASE_ACCESS_TOKEN:'synthetic-never-log'}});
  assert.equal(r.status,1);assert.doesNotMatch(r.stdout+r.stderr,/synthetic-never-log/);
});

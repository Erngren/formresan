// Skapar endast en ny lokal stack. Accepterar inga externa projekt eller nycklar.
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const {resolve,join,dirname,basename,sep} = require('node:path');
const {tmpdir} = require('node:os');
const {randomBytes,randomUUID} = require('node:crypto');
const net = require('node:net');
const {Client} = require('pg');
const {runAuthRest,localUrl,publicKey} = require('./auth-rest-security.cjs');
const tableNames=['main_entries','training_sessions','user_settings','record_versions','sync_operations','migration_batches','migration_snapshots'];
function cleanEnvironment(source) {
  const env={...source};
  for(const k of Object.keys(env)) if(/^(SUPABASE_|FORMRESAN_|PG|NODE_OPTIONS$)/i.test(k)) delete env[k];
  return env;
}
function command(file,args,options={}) {
  return new Promise((accept,reject)=>{
    const child=spawn(file,args,{...options,stdio:['ignore','pipe','pipe'],windowsHide:true});
    let out='',size=0;
    // CLI-status kan innehålla hemligheter. Stderr sparas inte och inget ekas.
    child.stdout.on('data',b=>{size+=b.length;if(size>16000000)child.kill();else out+=b;});
    child.stderr.on('data',()=>{});
    child.on('error',()=>reject(new Error('Verktyg saknas eller kunde inte startas')));
    child.on('close',code=>code===0?accept(out):reject(new Error('Isolerat verktygssteg misslyckades')));
  });
}
async function ports(count) {
  const servers=[];
  try {
    for(let i=0;i<count;i++) {
      const s=net.createServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});servers.push(s);
    }
    return servers.map(s=>s.address().port);
  } finally {await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));}
}
function verifyDockerEndpoint(endpoint) {
  if(typeof endpoint!=='string' || !/^(unix:\/\/\/|npipe:\/\/)/.test(endpoint)) throw new Error('Endast lokal Docker-socket tillåts');
}
async function main() {
  const preserve=process.argv.length===4&&process.argv[3]==='--preserve';
  if((process.argv.length!==3&&!preserve) || process.argv[2]!=='--isolated-local') throw new Error('Kräver --isolated-local. Externa projekt stöds inte.');
  // Ingen shell- eller env-parameter får välja API, nyckel eller befintlig databas.
  if(Object.keys(process.env).some(k=>/^(FORMRESAN_.*(URL|KEY|TOKEN)|SUPABASE_(ACCESS_TOKEN|URL|DB_URL|PROJECT_REF|SECRET_KEY|SERVICE_ROLE_KEY))$/i.test(k))) throw new Error('Ta bort projekt-/nyckelvariabler före test');
  const env=cleanEnvironment(process.env);
  if(env.DOCKER_HOST) verifyDockerEndpoint(env.DOCKER_HOST);
  const contexts=JSON.parse(await command('docker',['context','inspect'],{env}));
  verifyDockerEndpoint(contexts[0]?.Endpoints?.docker?.Host);
  await command('docker',['info','--format','{{.ServerVersion}}'],{env});
  const id='formresan-auth-test-'+randomBytes(8).toString('hex');
  const root=await fs.mkdtemp(join(tmpdir(),'formresan-auth-test-'));
  const projectRoot=resolve(root),prefix=resolve(tmpdir())+sep;
  if(!projectRoot.startsWith(prefix)||!basename(projectRoot).startsWith('formresan-auth-test-'))throw new Error('Osäker temporär sökväg');
  env.SUPABASE_HOME=join(root,'cli-home');
  env.SUPABASE_TELEMETRY_DISABLED='1';
  const pkg=require.resolve('supabase/package.json');
  const cli=join(dirname(pkg),require(pkg).bin.supabase);
  const cliCommand=args=>{
    console.log('Lokalt CLI-steg: '+args[0]);
    return command(process.execPath,[cli,...args],{cwd:root,env});
  };
  let network=false,started=false,db;
  try {
    const existing=await command('docker',['ps','-a','--format','{{.Names}}'],{env});
    const volumes=await command('docker',['volume','ls','--format','{{.Name}}'],{env});
    if(existing.includes(id)||volumes.includes(id))throw new Error('Projektet måste vara helt nytt');
    const [apiPort,dbPort,shadowPort]=await ports(3);
    await fs.mkdir(join(root,'supabase','migrations'),{recursive:true});
    for(const name of (await fs.readdir(resolve(__dirname,'../supabase/migrations'))).filter(n=>/^\d+_.*\.sql$/.test(n)).sort()) {
      await fs.copyFile(resolve(__dirname,'../supabase/migrations',name),join(root,'supabase','migrations',name));
    }
    await fs.writeFile(join(root,'supabase','config.toml'),`project_id = "${id}"
[api]
enabled = true
port = ${apiPort}
schemas = ["public"]
extra_search_path = ["public", "extensions"]
[db]
port = ${dbPort}
shadow_port = ${shadowPort}
major_version = 17
[db.seed]
enabled = false
[db.pooler]
enabled = false
[realtime]
enabled = false
[studio]
enabled = false
[mailpit]
enabled = false
[storage]
enabled = false
[analytics]
enabled = false
[edge_runtime]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1:${apiPort}"
jwt_expiry = 60
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = false
`);
    await command('docker',['network','create','--driver','bridge','--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1',id],{env});network=true;
    console.log('Startar en ny lokal Supabase-stack. Verktygsutdata med nycklar undertrycks.');
    started=true; // Även delvis misslyckad start behöver projektbegränsad cleanup.
    await cliCommand(['start','--network-id',id,'-x','realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
    console.log('Verifierar nya containrar och loopback-bindningar.');
    const containers=JSON.parse(await command('docker',['inspect',`supabase_db_${id}`,`supabase_kong_${id}`],{env}));
    for(const c of containers) {
      if(!c.Name.endsWith('_'+id)||!Object.keys(c.NetworkSettings.Networks).includes(id))throw new Error('Fel Docker-projekt');
      for(const bindings of Object.values(c.NetworkSettings.Ports))for(const b of bindings||[])if(b.HostIp!=='127.0.0.1')throw new Error('Docker-port är inte bunden till loopback');
    }
    const status=JSON.parse(await cliCommand(['status','-o','json']));
    const url=localUrl(status.API_URL);
    if(new URL(url).port!==String(apiPort))throw new Error('Status pekar på fel API-port');
    const key=status.PUBLISHABLE_KEY||status.ANON_KEY;publicKey(key);
    const dbUrl=new URL(status.DB_URL);
    if(!['127.0.0.1','localhost'].includes(dbUrl.hostname)||dbUrl.port!==String(dbPort)||dbUrl.pathname!=='/postgres')throw new Error('Status pekar på fel databas');
    console.log('Verifierar tom Auth/databas och RPC-behörigheter.');
    db=new Client({connectionString:dbUrl.toString()});await db.connect();
    // Stoppar före konto-/dataskrivning om start inte gav en ny tom miljö.
    if(Number((await db.query('select count(*) from auth.users')).rows[0].count)!==0)throw new Error('Auth måste vara tom');
    for(const table of tableNames)if(Number((await db.query(`select count(*) from public.${table}`)).rows[0].count)!==0)throw new Error('Datatabeller måste vara tomma');
    const grants=await db.query(`select prosecdef,proconfig,pg_get_userbyid(proowner) owner,
      has_function_privilege('anon',oid,'EXECUTE') anon,
      has_function_privilege('authenticated',oid,'EXECUTE') authenticated
      from pg_proc where oid='public.apply_operation(uuid,text,uuid,bigint,jsonb,text)'::regprocedure`);
    const f=grants.rows[0];
    if(!f.prosecdef||f.owner!=='postgres'||!f.proconfig.includes('search_path=""')||f.anon||!f.authenticated)throw new Error('RPC-rättigheter avviker');
    await runAuthRest({url,key,runId:id,seedMetadata:async users=>{
      // Separat fixturesetup, ingen admin-API-nyckel och ingen skapad Auth-användare.
      const actual=(await db.query('select id::text from auth.users order by id')).rows.map(r=>r.id).sort();
      if(JSON.stringify(actual)!==JSON.stringify([...users].sort()))throw new Error('Auth och lokal databas hör inte ihop');
      await db.query('begin');
      try {
        for(const user of users){const batch=randomUUID();
          await db.query('insert into public.migration_batches(user_id,batch_id,source_hashes,expected_count) values($1,$2,$3,0)',[user,batch,JSON.stringify({synthetic:id})]);
          await db.query('insert into public.migration_snapshots(user_id,batch_id,main_raw,training_raw) values($1,$2,$3,$4)',[user,batch,'{"synthetic":true}','{"synthetic":true}']);
        }
        await db.query('commit');
      }catch{await db.query('rollback');throw new Error('Syntetisk fixturesetup misslyckades');}
    }});
  } finally {
    if(db)await db.end();
    // Inget --all, db reset, remote, link eller delete mot externa projekt.
    if(preserve) {
      console.log('Bevarar endast den nyskapade lokala testmiljön. Ingen destruktiv cleanup körs.');
    } else {
      if(started)await cliCommand(['stop','--no-backup','--project-id',id]);
      if(network)await command('docker',['network','rm',id],{env});
      await fs.rm(projectRoot,{recursive:true}); // Endast mkdtemp-sökvägen ovan.
    }
  }
}
module.exports={main,verifyDockerEndpoint,cleanEnvironment};
if(require.main===module)main().catch(()=>{console.error('Auth/REST ej godkänt. Isoleringskontroll, verktyg, setup eller scenario misslyckades. Inga nycklar loggas. Se körinstruktionerna.');process.exitCode=1;});

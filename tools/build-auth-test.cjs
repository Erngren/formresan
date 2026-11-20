// Bygger bara lokala filer. Ingen nätverks-, deploy- eller Supabase-funktion.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const ROOT=fs.realpathSync(path.resolve(__dirname,'..'));
const PRODUCTION='https://erngren.github.io';
const FILES=['index.html','training/index.html','js/storage.js','js/account-lifecycle.js','js/auth-config.js','js/auth-bootstrap.js','js/auth-view.js','js/auth-test-environment.js','js/smart-food.js','js/training.js','css/training.css','icon.svg','apple-touch-icon.png'];
const requireValue=(ok)=>{if(!ok)throw new Error('Bygget avvisades. Kontrollera origin, godkännande, konfiguration och ny utdatamapp.');};
function origin(value){
  requireValue(typeof value==='string');const u=new URL(value);
  requireValue(u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&u.hostname.includes('.')&&!u.port);
  return value;
}
function inside(parent,child){const rel=path.relative(parent,child);return rel===''||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
function outsideGit(file){
  let dir=path.dirname(file);
  while(true){requireValue(!fs.existsSync(path.join(dir,'.git')));const up=path.dirname(dir);if(up===dir)return;dir=up;}
}
function plainFile(file){requireValue(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink());return fs.readFileSync(file);}
function approved(config,testOrigin){
  requireValue(config&&Object.keys(config).sort().join(',')==='approval,deploymentOrigin,productionOrigins,publishableKey,purpose,targetProject,url');
  requireValue(config.purpose==='formresan-auth-test'&&config.targetProject==='formresan-test'&&config.approval==='BUILD_AUTH_TEST_ARTIFACT_ONLY');
  requireValue(config.deploymentOrigin===testOrigin&&Array.isArray(config.productionOrigins)&&config.productionOrigins.includes(PRODUCTION));
  for(const value of config.productionOrigins)requireValue(origin(value)!==testOrigin);
  requireValue(typeof config.url==='string'&&/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.url));
  requireValue(typeof config.publishableKey==='string'&&/^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(config.publishableKey));
  return{enabled:true,deploymentOrigin:testOrigin,url:config.url,publishableKey:config.publishableKey};
}
function build({output,testOrigin,activationFile,activate=false}){
  testOrigin=origin(testOrigin);requireValue(testOrigin!==PRODUCTION);
  requireValue(typeof output==='string'&&path.isAbsolute(output)&&!fs.existsSync(output));
  const parent=fs.realpathSync(path.dirname(output)),target=path.join(parent,path.basename(output));
  requireValue(!inside(ROOT,target)&&!inside(target,ROOT));
  outsideGit(target);requireValue(!!activationFile===activate);
  let config={enabled:false};
  if(activationFile){
    const input=fs.realpathSync(activationFile);requireValue(!inside(ROOT,input)&&!inside(target,input));
    outsideGit(input);
    config=approved(JSON.parse(plainFile(input).toString('utf8')),testOrigin);
  }
  const content={};
  for(const file of FILES){
    const bytes=plainFile(path.join(ROOT,file));
    content[file]=/\.(html|js|css|svg)$/.test(file)?Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n')):bytes;
  }
  // Ingen PWA-installation eller övningsbilder behövs i en låst Auth-testrelease.
  for(const file of ['index.html','training/index.html']){
    const prefix=file.startsWith('training/')?'../':'';
    let html=content[file].toString('utf8');
    const anchor=`<script src="${prefix}js/auth-config.js`;
    requireValue(html.includes(anchor));
    html=html.replace(anchor,`<script src="${prefix}js/auth-test-release.js"></script><script src="${prefix}js/auth-test-environment.js"></script>`+anchor);
    // Träningssidan använder defer; även testskripten ska gå före dess konfiguration.
    if(prefix)html=html.replace(/(auth-test-(?:release|environment)\.js")>/g,'$1 defer>');
    html=html.replace(/<link\b[^>]*rel="manifest"[^>]*>/gi,'').replace(/<title>[^<]*<\/title>/,'<title>Formresan · AUTH-TEST</title>');
    content[file]=Buffer.from(html);
  }
  const release={schemaVersion:1,environment:'auth-test',deploymentOrigin:testOrigin,authEnabled:config.enabled};
  content['js/auth-test-release.js']=Buffer.from('window.FormresanAuthTestRelease = Object.freeze('+JSON.stringify(release)+');\n');
  content['js/auth-config.js']=Buffer.from('window.FormresanAuthConfig = Object.freeze('+JSON.stringify(config)+');\n');
  content['.nojekyll']=Buffer.from('');
  // Endast den genererade testkopian. Policyn ska ingå i manifestet, inte
  // läggas till manuellt efter att artefakten har granskats/hashats.
  content['_headers']=Buffer.from('/*\n  Cache-Control: no-store\n  CDN-Cache-Control: no-store\n  Netlify-CDN-Cache-Control: no-store\n  X-Robots-Tag: noindex, nofollow\n');
  const hashes={};for(const file of Object.keys(content).sort())hashes[file]=crypto.createHash('sha256').update(content[file]).digest('hex');
  const manifest={schemaVersion:1,environment:'auth-test',authEnabled:config.enabled,deploymentOrigin:testOrigin,
    sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),sha256:hashes};
  fs.mkdirSync(target); // En befintlig katalog skrivs aldrig över och rensas aldrig.
  for(const file of Object.keys(content).sort()){
    fs.mkdirSync(path.dirname(path.join(target,file)),{recursive:true});fs.writeFileSync(path.join(target,file),content[file],{flag:'wx'});
  }
  // Manifest sist: avbrutet bygge lämnar en ofullständig, ej godkänd katalog.
  fs.writeFileSync(path.join(target,'AUTH_TEST_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
module.exports={build,approved,origin,FILES};
if(require.main===module){
  try{
    const args=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i++){
      if(args[i]==='--output')options.output=args[++i];
      else if(args[i]==='--test-origin')options.testOrigin=args[++i];
      else if(args[i]==='--approved-config')options.activationFile=args[++i];
      else if(args[i]==='--activate-auth-test')options.activate=true;
      else throw new Error('argument');
    }
    // Aktiveringsfil är ett explicit byggval, ingen implicit miljövariabel.
    const result=build(options);console.log(result.authEnabled?'Testartefakt byggd med uttrycklig Auth-konfiguration. Ingen publicering utförd.':'Avstängd Auth-testartefakt byggd. Ingen publicering utförd.');
  }catch{console.error('Auth-testbygge avvisat eller ofullständigt. Inga konfigurationsvärden loggas.');process.exitCode=1;}
}

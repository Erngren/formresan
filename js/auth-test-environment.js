// Laddas endast av testartefakten, aldrig av den vanliga appen.
(() => {
  'use strict';
  const release=window.FormresanAuthTestRelease;
  window.FormresanAuthTestEnvironmentValid=!!(release&&release.schemaVersion===1&&release.environment==='auth-test'&&
    typeof release.authEnabled==='boolean'&&release.deploymentOrigin===location.origin&&location.protocol==='https:'&&location.origin!=='https://erngren.github.io');
  const main=document.querySelector('main');
  if(main){main.hidden=true;main.inert=true;main.style.display='none';}
  const banner=document.createElement('p');banner.id='authTestEnvironment';banner.setAttribute('role','note');
  banner.style.cssText='border:2px solid #d29922;border-radius:12px;padding:12px;margin:12px;color:#f0f6fc;background:#161b22;font-weight:700;overflow-wrap:anywhere';
  banner.textContent=window.FormresanAuthTestEnvironmentValid?
    'FORMRESAN · AUTH-TEST · '+(release.authEnabled?'Auth för test':'Inloggning avstängd')+' · '+location.origin:
    'FORMRESAN · AUTH-TEST · Fel miljö. Inloggning är låst.';
  document.body.insertBefore(banner,main);
})();

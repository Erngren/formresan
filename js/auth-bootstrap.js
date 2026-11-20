(() => {
  'use strict';
  // Officiell npm-UMD, exakt version och SHA-384. Ingen flytande CDN-version.
  const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.js';
  const INTEGRITY = 'sha384-A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ';
  const controller = window.FormresanAccount;
  // Iframen använder endast förälderns tjänst; skapar aldrig en andra SDK-klient.
  if (window.parent !== window) {
    try { if (window.parent.location.origin !== location.origin || !window.parent.FormresanAuth) throw new Error('parent');
      window.FormresanAuth = window.parent.FormresanAuth;
    } catch { controller.cancel(); }
    return;
  }
  const listeners = new Set();
  let auth, busy = false, cancelled = false, ready = false, message = '';
  const emit = () => { for (const listener of listeners) listener(); };
  const config = window.FormresanAuthConfig;
  const configured = config && config.enabled === true;
  function validConfig() {
    return configured && location.protocol === 'https:' && Object.keys(config).sort().join(',') === 'deploymentOrigin,enabled,publishableKey,url' &&
      config.deploymentOrigin === location.origin &&
      typeof config.url === 'string' && /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(config.url) &&
      typeof config.publishableKey === 'string' && /^sb_publishable_[A-Za-z0-9_-]{20,200}$/.test(config.publishableKey);
  }
  function loadSdk() {
    return new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = SDK; script.integrity = INTEGRITY; script.crossOrigin = 'anonymous';
      const timer = setTimeout(() => { script.remove(); reject(new Error('sdk')); }, 15000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('sdk')); };
      document.head.append(script);
    });
  }
  // SDK:ts nätverk begränsas till Auth på den godkända projektadressen.
  async function authFetch(input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin !== config.url || !url.pathname.startsWith('/auth/v1/')) throw new Error('Auth endpoint');
    const abort = new AbortController();
    const signal = init?.signal || (typeof input !== 'string' ? input.signal : null);
    const stop = () => abort.abort();
    signal?.addEventListener('abort', stop, {once:true});
    if (signal?.aborted) stop();
    const timer = setTimeout(stop, 15000);
    try {
      const response = await fetch(input, {...init, signal:abort.signal, redirect:'error'});
      // Behåll tidsgränsen även under hämtningen av svarskroppen.
      await response.clone().arrayBuffer();
      return response;
    }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  }
  async function exclusive(task) {
    if (!navigator.locks?.request) throw new Error('Web Locks');
    return navigator.locks.request('formresan-auth-operation-v1', {mode:'exclusive'}, task);
  }
  async function signIn(email,password) {
    if (!ready || busy) return;
    busy = true; cancelled = false; message = ''; emit();
    let lease;
    try {
      lease = controller.beginSignIn();
      await exclusive(async () => {
        lease.assertCurrent();
        const result = await auth.signInWithPassword({email,password});
        // SDK kan ha sparat sessionen innan ett sent svar återkommer. Ingen ny
        // inloggning får passera låset innan en avbruten session har loggats ut.
        try { lease.assertCurrent(); if (cancelled) throw new Error('cancelled'); }
        catch { await auth.signOut({scope:'local'}); throw new Error('cancelled'); }
        if (result.error) throw new Error('credentials');
        const state = await lease.complete();
        if (state.phase !== 'signed_in') throw new Error('verification');
      });
    } catch {
      controller.cancel();
      message = cancelled ? 'Inloggningen avbröts. Du kan försöka igen.' : 'Det gick inte att logga in. Kontrollera uppgifterna och anslutningen och försök igen.';
    } finally { password = ''; busy = false; emit(); }
  }
  async function signOut() {
    if (!ready || busy) return;
    busy = true; message = ''; controller.cancel(); emit();
    try { await exclusive(() => controller.signOut());
      if (controller.getState().phase === 'error') throw new Error('logout');
    } catch { controller.cancel(); message = 'Utloggningen kunde inte slutföras. Vyerna är låsta. Försök igen.'; }
    finally { busy = false; emit(); }
  }
  async function retry() {
    if (!ready || busy) return;
    busy = true; message = ''; emit();
    try { await exclusive(() => controller.verify()); }
    catch { controller.cancel(); }
    finally { busy = false; emit(); }
  }
  window.FormresanAuth = Object.freeze({
    getState: () => ({ready,busy,message,configured}), signIn, signOut, retry,
    cancel: () => { cancelled = true; controller.cancel(); message = 'Inloggningen avbryts. Vänta innan du försöker igen.'; emit(); },
    subscribe: listener => { listeners.add(listener); listener(); return () => listeners.delete(listener); }
  });
  async function start() {
    if (config?.enabled === false || config === undefined) return;
    // Okänd eller ogiltig aktiveringskonfiguration låser, utan SDK/Auth-anrop.
    if (!validConfig() || !navigator.locks?.request || typeof BroadcastChannel !== 'function') { controller.cancel(); message = 'Inloggning är inte korrekt konfigurerad.'; emit(); return; }
    await controller.verify(); // Stäng legacy-vyn innan SDK kan återställa session.
    busy = true; emit();
    try {
      await loadSdk();
      if (cancelled) throw new Error('cancelled');
      const client = window.supabase.createClient(config.url, config.publishableKey, {
        auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false,
          storageKey:'formresan_auth_v1:' + new URL(config.url).hostname},
        global:{fetch:authFetch}
      });
      auth = client.auth;
      await controller.attachAuth(auth);
      ready = true;
    } catch { controller.cancel(); message = 'Inloggning kunde inte startas. Ladda om sidan för att försöka igen.'; }
    finally { busy = false; emit(); }
  }
  void start();
})();

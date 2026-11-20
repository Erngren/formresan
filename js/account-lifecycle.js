(() => {
  'use strict';
  const MARKER = 'formresan_account_lifecycle_v1';
  const CHANNEL = 'formresan-account-lifecycle-v1';
  const validMarker = raw => {
    const m = JSON.parse(raw);
    if (m.version !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.nonce) || !['verify','logout','lock'].includes(m.intent)) throw new Error('context');
    return m;
  };
  function createController() {
    let auth, subscription, coordinator, account, channel;
    let epoch = 0, managed = false, blocked = false, marker = null;
    let state = Object.freeze({phase:'unconfigured', managed:false, userId:null, reason:null, accountViewsEnabled:false});
    const views = new Set();
    try { channel = new BroadcastChannel(CHANNEL); } catch {}
    const getState = () => state;
    function invalidate(phase, reason = null) {
      epoch += 1;
      coordinator?.dispose(); coordinator = null; account = null;
      state = Object.freeze({phase, managed, userId:null, reason, accountViewsEnabled:false});
      for (const view of views) view(true, state);
      return epoch;
    }
    function fail(reason) { blocked = true; invalidate('error', reason); return state; }
    function readMarker() { const raw = localStorage.getItem(MARKER); if (raw !== null) validMarker(raw); return raw; }
    function publish(intent) {
      const raw = JSON.stringify({version:1, nonce:crypto.randomUUID(), intent});
      localStorage.setItem(MARKER, raw);
      marker = raw;
      channel?.postMessage({type:'invalidate'}); // Ingen identitet/session i meddelandet.
    }
    function assertCurrent(expected, expectedMarker) {
      if (expected !== epoch || marker !== expectedMarker) throw new Error('Kontokontexten har ändrats.');
      let current;
      try { current = readMarker(); } catch { fail('context_invalid'); throw new Error('Kontokontexten kunde inte läsas.'); }
      if (current !== expectedMarker) { synchronize(); throw new Error('Kontokontexten har ändrats.'); }
    }
    async function verifyCurrent(expected, expectedMarker) {
      let candidate;
      try {
        assertCurrent(expected, expectedMarker);
        const response = await auth.getUser();
        assertCurrent(expected, expectedMarker);
        if (!response?.data?.user && (response?.error === null || response?.error?.name === 'AuthSessionMissingError')) {
          blocked = true; invalidate('signed_out'); return state;
        }
        if (response?.error !== null || response?.data?.user?.is_anonymous === true) throw new Error('verification');
        candidate = FormresanStorage.createAccountStorage(auth, {assertContext:() => assertCurrent(expected, expectedMarker)});
        const opened = await candidate.openAccount();
        assertCurrent(expected, expectedMarker);
        if (opened.userId !== response.data.user.id.toLowerCase()) throw new Error('identity');
        coordinator = candidate; candidate = null; account = opened;
        state = Object.freeze({phase:'signed_in', managed:true, userId:opened.userId, reason:null, accountViewsEnabled:false});
        for (const view of views) view(false, state);
      } catch {
        candidate?.dispose();
        if (epoch === expected && marker === expectedMarker) fail('verification_failed');
      }
      return state;
    }
    function scheduleVerification() {
      const expected = epoch, currentMarker = marker;
      // Auth-anrop sker aldrig inne i SDK:ts Auth-callback.
      setTimeout(() => { if (epoch === expected && !blocked && auth) void verifyCurrent(expected, currentMarker); }, 0);
    }
    function synchronize() {
      let next;
      try { next = readMarker(); } catch { managed = true; FormresanStorage.suspendLegacy(); fail('context_invalid'); return; }
      if (next === marker) return;
      managed = true; FormresanStorage.suspendLegacy(); marker = next;
      if (next === null) { fail('context_missing'); return; }
      blocked = validMarker(next).intent !== 'verify';
      invalidate(blocked ? 'signed_out' : auth ? 'verifying' : 'error', auth ? null : 'configuration_missing');
      if (!blocked && auth) scheduleVerification();
    }
    async function verify() {
      managed = true; FormresanStorage.suspendLegacy();
      if (!auth || !channel) return fail('configuration_missing');
      blocked = false;
      const expected = invalidate('verifying');
      try { publish('verify'); } catch { return fail('context_unavailable'); }
      return verifyCurrent(expected, marker);
    }
    async function attachAuth(client) {
      managed = true; FormresanStorage.suspendLegacy();
      if (auth || !channel || !client || !['getUser','onAuthStateChange','signOut'].every(k => typeof client[k] === 'function')) {
        try { publish('lock'); } catch { return fail('context_unavailable'); }
        return fail('auth_client_invalid');
      }
      auth = client;
      try {
        subscription = auth.onAuthStateChange(event => {
          if (event === 'INITIAL_SESSION') return; // attachAuth verifierar alltid med getUser.
          if (event === 'SIGNED_OUT') {
            const alreadyLoggedOut = blocked && marker !== null && validMarker(marker).intent === 'logout';
            blocked = true; invalidate('signed_out');
            if (!alreadyLoggedOut) try { publish('logout'); } catch { fail('context_unavailable'); }
          } else if (!blocked && state.phase !== 'verifying') {
            // Flera SDK-instanser kan notifiera samma inloggning efter att en
            // flikmarkör redan startat getUser. Starta inte en ny markörcykel
            // som avbryter den verifieringen. Lagringsobjektets egen Auth-
            // generation och getUser-kontroller skyddar samtidiga kontobyten.
            invalidate('verifying');
            try { publish('verify'); scheduleVerification(); } catch { fail('context_unavailable'); }
          }
        })?.data?.subscription;
        if (typeof subscription?.unsubscribe !== 'function') throw new Error('subscription');
        const current = readMarker();
        if (current !== null && validMarker(current).intent !== 'verify') { marker = current; blocked = true; invalidate('signed_out'); return state; }
        return await verify();
      } catch { return fail('configuration_missing'); }
    }
    async function signOut() {
      managed = true; FormresanStorage.suspendLegacy(); blocked = true;
      invalidate('signed_out');
      try { publish('logout'); } catch { return fail('context_unavailable'); }
      const expectedMarker = marker;
      try {
        if (!auth) return state;
        const response = await auth.signOut({scope:'local'});
        if (marker !== expectedMarker || !blocked) return state;
        if (response?.error !== null) return fail('sign_out_failed');
      } catch { if (marker === expectedMarker && blocked) return fail('sign_out_failed'); }
      // Låsningen hävs inte av sena SIGNED_IN eller getUser-svar.
      return state;
    }
    function cancel() {
      managed = true; FormresanStorage.suspendLegacy(); blocked = true;
      invalidate('error', 'cancelled');
      try { publish('lock'); } catch { fail('context_unavailable'); }
      return state;
    }
    function beginSignIn() {
      managed = true; FormresanStorage.suspendLegacy(); blocked = true;
      const expected = invalidate('verifying');
      try { publish('lock'); } catch { fail('context_unavailable'); throw new Error('context'); }
      const expectedMarker = marker;
      // SDK:ts SIGNED_IN får inte godkänna en pågående/avbruten lösenordsbegäran.
      return Object.freeze({
        assertCurrent: () => assertCurrent(expected, expectedMarker),
        complete: () => { assertCurrent(expected, expectedMarker); return verify(); }
      });
    }
    channel?.addEventListener('message', event => { if (event.data?.type === 'invalidate') synchronize(); });
    window.addEventListener('storage', event => { if (event.key === MARKER || event.key === null && managed) synchronize(); });
    window.addEventListener('pagehide', () => { if (managed) invalidate('signed_out'); });
    window.addEventListener('pageshow', () => { if (managed) { synchronize(); if (auth && !blocked) { invalidate('verifying'); scheduleVerification(); } } });
    try {
      marker = localStorage.getItem(MARKER);
      if (marker !== null) {
        managed = true; blocked = true; FormresanStorage.suspendLegacy();
        validMarker(marker); invalidate('error', 'configuration_missing');
      }
    } catch {
      if (managed) fail('context_invalid');
      // Utan aktiverad Auth kan ingen identitet antas. Legacy-läsningen hanterar
      // otillgänglig lagring separat, utan att läsa någon kontonyckel.
    }
    // Konfigurationen laddas före appkoden. Lås innan legacy-data ens läses,
    // även när SDK-bootstrapen ännu inte hunnit laddas över nätverket.
    if (window.FormresanAuthConfig !== undefined && window.FormresanAuthConfig?.enabled !== false) {
      managed = true; blocked = true; FormresanStorage.suspendLegacy();
      invalidate('verifying');
    }
    return Object.freeze({getState, attachAuth, verify, signOut, cancel, beginSignIn,
      captureAccount: () => {
        if (state.phase !== 'signed_in' || !account) throw new Error('Ett verifierat konto saknas.');
        const expected = epoch, currentMarker = marker;
        assertCurrent(expected, currentMarker);
        return Object.freeze({store:account, assertCurrent:() => assertCurrent(expected, currentMarker)});
      },
      registerView: view => { views.add(view); view(managed, state); return () => views.delete(view); }
    });
  }
  let controller;
  try {
    if (window.parent !== window) {
      if (window.parent.location.origin !== location.origin || !window.parent.FormresanAccount) throw new Error('parent');
      controller = window.parent.FormresanAccount;
    } else controller = createController();
  } catch {
    controller = createController(); controller.cancel();
  }
  window.FormresanAccount = controller;
  document.addEventListener('click', event => {
    if (controller.getState().managed && event.target.closest?.('main,dialog')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  if (controller.getState().managed) FormresanStorage.suspendLegacy();
  const main = document.querySelector('main');
  const status = document.createElement('p');
  status.id = 'accountStatus'; status.className = 'muted small'; status.setAttribute('role','status');
  status.style.cssText = 'max-width:740px;margin:12px auto;padding:0 12px';
  document.body.insertBefore(status, main);
  function protect(reset, snapshot) {
    if (snapshot.managed) {
      FormresanStorage.suspendLegacy();
      // Stäng visningen före callbacks så ett renderingsfel aldrig lämnar vyn öppen.
      main.inert = true; main.hidden = true; main.style.display = 'none';
      try { if (reset) reset(); } catch { /* Vyn förblir låst även vid återställningsfel. */ }
      document.querySelectorAll('dialog').forEach(dialog => { if (dialog.open) dialog.close(); dialog.returnValue = ''; });
      document.querySelectorAll('input,textarea,select').forEach(input => {
        input.value = ''; if ('defaultValue' in input) input.defaultValue = '';
        if ('checked' in input) { input.checked = false; input.defaultChecked = false; }
      });
      document.getElementById('storageNotice')?.remove();
    }
    status.textContent = !snapshot.managed ? 'Lokalt testläge. Konto är inte konfigurerat.' :
      snapshot.phase === 'verifying' ? 'Verifierar konto. Datavyerna är låsta.' :
      snapshot.phase === 'signed_in' ? 'Kontot är verifierat. Kontovyer är ännu inte aktiverade.' :
      snapshot.phase === 'signed_out' ? 'Utloggad. Datavyerna är låsta.' : 'Kontot kunde inte verifieras. Datavyerna är låsta.';
  }
  protect(null, controller.getState());
  window.FormresanAccountView = Object.freeze({bind: reset => controller.registerView((clear, snapshot) => protect(clear ? reset : null, snapshot))});
})();

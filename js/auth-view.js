(() => {
  'use strict';
  const service = window.FormresanAuth, controller = window.FormresanAccount;
  if (!service || window.parent !== window) return;
  const panel = document.createElement('section');
  panel.id = 'authPanel'; panel.className = 'card';
  panel.style.cssText = 'max-width:540px;margin:16px auto;padding:20px;box-sizing:border-box';
  panel.innerHTML = `<h2>Konto</h2><p id="authHelp">Logga in med e-post och lösenord. Kontodata och molnsynk är ännu inte aktiverade.</p>
    <form id="authForm"><label for="authEmail">E-post</label><input id="authEmail" type="email" autocomplete="username" inputmode="email" maxlength="254" required>
    <label for="authPassword">Lösenord</label><input id="authPassword" type="password" autocomplete="current-password" required>
    <button id="authSubmit" type="submit">Logga in</button></form>
    <div class="actions"><button id="authCancel" type="button" class="secondary">Avbryt</button>
    <button id="authRetry" type="button" class="secondary">Verifiera igen</button>
    <button id="authLogout" type="button" class="secondary">Logga ut</button></div>
    <p id="authMessage" role="status" aria-live="polite"></p>
    <p class="muted small">Registrering och lösenordsåterställning är inte aktiverade ännu.</p>`;
  document.body.insertBefore(panel, document.querySelector('main'));
  const form = panel.querySelector('form'), email = panel.querySelector('#authEmail'), password = panel.querySelector('#authPassword');
  function render() {
    const view = service.getState(), state = controller.getState();
    panel.hidden = !view.configured && !state.managed;
    form.hidden = !view.ready || state.phase === 'signed_in';
    panel.querySelector('#authSubmit').disabled = view.busy;
    email.disabled = password.disabled = view.busy;
    panel.querySelector('#authCancel').hidden = !view.busy;
    panel.querySelector('#authRetry').disabled = !view.ready || view.busy;
    panel.querySelector('#authLogout').disabled = !view.ready || view.busy;
    panel.querySelector('#authMessage').textContent = view.message || (view.busy ? 'Arbetar med inloggningen…' :
      state.phase === 'signed_in' ? 'Du är inloggad. Kontovyerna är låsta tills nästa steg är godkänt.' :
      view.ready ? 'Du kan logga in. Dina tidigare lokala testdata kopplas inte till kontot.' : 'Inloggning är inte aktiverad. Datavyerna är låsta om kontohantering har inletts.');
    panel.setAttribute('aria-busy', String(view.busy));
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const address = email.value.trim(), secret = password.value;
    password.value = '';
    void service.signIn(address, secret);
  });
  panel.querySelector('#authCancel').onclick = () => service.cancel();
  panel.querySelector('#authRetry').onclick = () => service.retry();
  panel.querySelector('#authLogout').onclick = () => service.signOut();
  controller.registerView(clear => { if (clear) form.reset(); render(); });
  service.subscribe(render);
})();

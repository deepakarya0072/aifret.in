function authStatus(message, type = 'info') {
  const node = document.querySelector('[data-auth-status]');
  if (node) { node.textContent = message; node.dataset.status = type; }
}

function returnTo() {
  return window.AIFRET_AUTH.safeReturnTo(new URLSearchParams(window.location.search).get('returnTo'));
}

document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.querySelector('[data-login-form]');
  const signupForm = document.querySelector('[data-signup-form]');
  const forgotForm = document.querySelector('[data-forgot-form]');
  const accountRoot = document.querySelector('[data-account-root]');

  if (loginForm) loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(loginForm);
    authStatus('Signing in...');
    try {
      await window.AIFRET_AUTH.login({ identifier: form.get('identifier').trim(), password: form.get('password') });
      window.location.href = returnTo();
    } catch (error) { authStatus(error.message === 'Customer authentication is not configured.' ? error.message : 'Unable to sign in. Please check your details and try again.', 'error'); }
  });

  if (signupForm) signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(signupForm);
    if (form.get('password') !== form.get('confirmPassword')) { authStatus('Passwords do not match.', 'error'); return; }
    authStatus('Creating account...');
    try {
      await window.AIFRET_AUTH.signup({ fullName: form.get('fullName').trim(), email: form.get('email').trim(), mobile: form.get('mobile').trim(), password: form.get('password') });
      window.location.href = returnTo();
    } catch (error) { authStatus(error.message === 'Customer authentication is not configured.' ? error.message : 'Unable to create the account. Please try again.', 'error'); }
  });

  if (forgotForm) forgotForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const identifier = new FormData(forgotForm).get('identifier').trim();
    try { await window.AIFRET_AUTH.forgot(identifier); } catch (error) { /* Keep account-enumeration-safe response. */ }
    authStatus('If the account exists, password reset instructions have been sent.');
  });

  if (accountRoot) {
    try {
      const session = await window.AIFRET_AUTH.session();
      accountRoot.querySelector('[data-account-name]').textContent = session.user?.fullName || 'Customer';
      accountRoot.querySelector('[data-account-content]').hidden = false;
      accountRoot.querySelectorAll('[data-account-login-message]').forEach((node) => { node.hidden = true; });
    } catch (error) {
      accountRoot.querySelectorAll('[data-account-login-message]').forEach((node) => { node.hidden = false; });
      accountRoot.querySelector('[data-account-content]').hidden = true;
    }
  }

  const logout = document.querySelector('[data-logout]');
  if (logout) logout.addEventListener('click', async (event) => {
    event.preventDefault();
    try { await window.AIFRET_AUTH.logout(); } finally { window.location.href = 'index.html'; }
  });
});

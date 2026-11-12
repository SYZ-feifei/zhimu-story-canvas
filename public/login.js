import { $, button, escape, field, icon } from './ui.js';

const key = 'zhimu.local-session.v1';
const headersFor = token => token ? { Authorization: `Bearer ${token}` } : {};

export async function enterWorkspace() {
  const panel = $('#login-screen');
  let token = sessionStorage.getItem(key);
  const status = await fetch('/api/account/status', { headers: headersFor(token) }).then(response => response.json()).catch(() => ({}));
  let account = status.account;
  if (!account) {
    sessionStorage.removeItem(key);
    panel.hidden = false;
    const result = await new Promise(resolve => {
      let register = !status.hasAccounts;
      function render() {
        panel.innerHTML = `<div class="login-art"><div class="login-art-content"><img src="/assets/syz.png" alt="SYZ" class="login-mark"><h1>枝幕</h1><p>剧本创作画布</p></div></div>
          <div class="login-main"><div class="login-card"><div class="login-caption">${icon('user-circle')}本机工作区</div>
          <h2>${register ? '创建本机账号' : '登录枝幕'}</h2><p>项目保存在这台电脑上。</p>
          <form>${field('name', '账号名称', '', { required: true, max: 32, placeholder: '输入账号名称' })}
          ${field('password', '密码', '', { type: 'password', required: true, max: 200, placeholder: register ? '至少 8 个字符' : '输入密码' })}
          <p class="login-error" role="alert" hidden></p><button type="submit" class="button primary wide">${register ? '创建并进入' : '登录'}</button></form>
          ${button('switch-login', register ? '已有账号，去登录' : '创建另一个本机账号', { style: 'light wide' })}</div></div>`;
        $('#field-name', panel).autocomplete = 'username';
        $('#field-password', panel).autocomplete = register ? 'new-password' : 'current-password';
        $('[data-action=switch-login]', panel).addEventListener('click', () => { register = !register; render(); });
        $('form', panel).addEventListener('submit', async event => {
          event.preventDefault();
          const form = event.currentTarget;
          const submit = $('[type=submit]', form);
          const errorLine = $('.login-error', form);
          const values = new FormData(form);
          const switcher = $('[data-action=switch-login]', panel);
          submit.disabled = switcher.disabled = true;
          submit.innerHTML = `${icon('spinner-gap')} ${register ? '正在创建…' : '正在登录…'}`;
          try {
            const response = await fetch(`/api/account/${register ? 'register' : 'login'}`, { method: 'POST',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: values.get('name'), password: values.get('password') }) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || '无法进入本机工作区。');
            resolve(payload);
          } catch (error) {
            errorLine.textContent = error.message || '无法进入本机工作区。';
            errorLine.hidden = false;
            submit.disabled = switcher.disabled = false;
            submit.textContent = register ? '创建并进入' : '登录';
          }
        });
      }
      render();
    });
    token = result.token;
    account = result.account;
    sessionStorage.setItem(key, token);
  }
  panel.hidden = true;
  panel.replaceChildren();
  $('#app-shell').hidden = false;
  $('#account-name').innerHTML = escape(account.name);
  return { account, headers: headersFor(token), async logout() {
    await fetch('/api/account/logout', { method: 'POST', headers: headersFor(token) }).catch(() => {});
    sessionStorage.removeItem(key);
    location.reload();
  } };
}

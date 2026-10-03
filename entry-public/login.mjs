const form = document.querySelector('#login');
const input = document.querySelector('#token');
const status = document.querySelector('#status');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = '正在验证…';
  const body = JSON.stringify({ token: input.value });
  input.value = '';
  try {
    const response = await fetch('/v1/session', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
    if (response.status === 200) location.replace('/');
    else status.textContent = response.status === 429 ? '请求较多，请稍后显式重试。' : '登录失败，请确认令牌和有效期。';
  } catch { status.textContent = '暂时无法连接，请稍后显式重试。'; }
  finally { button.disabled = false; }
});

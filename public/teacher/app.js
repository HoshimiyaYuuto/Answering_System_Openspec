const countInput = document.querySelector('#group-count');
const generateButton = document.querySelector('#generate');
const applyButton = document.querySelector('#apply');
const groupList = document.querySelector('#group-list');
const message = document.querySelector('#message');
const hostWarning = document.querySelector('#host-warning');

const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isAllowedHost = allowedHosts.has(location.hostname.toLowerCase());
hostWarning.hidden = isAllowedHost;

async function requestJson(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || '伺服器發生錯誤。');
  return body;
}

function renderGroups(groups) {
  groupList.replaceChildren();
  for (const group of groups) {
    const row = document.createElement('label');
    row.textContent = `第 ${group.id} 組名稱`;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 30;
    input.value = group.name;
    input.dataset.groupId = String(group.id);
    row.append(input);
    groupList.append(row);
  }
}

async function loadGroups() {
  try {
    const { data } = await requestJson('/api/groups');
    renderGroups(data.groups);
  } catch (error) {
    message.textContent = error.message;
  }
}

generateButton.addEventListener('click', async () => {
  const count = Number(countInput.value);
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    message.textContent = '組數必須是 1 到 100 的整數。';
    return;
  }
  generateButton.disabled = true;
  try {
    const { data } = await requestJson('/api/groups/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    });
    renderGroups(data.groups);
    message.textContent = '已產生組別，確認名稱後按「套用組別」。';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    generateButton.disabled = false;
  }
});

applyButton.addEventListener('click', async () => {
  const groups = Array.from(groupList.querySelectorAll('input[data-group-id]'), (input) => ({
    id: Number(input.dataset.groupId),
    name: input.value,
  }));
  if (!groups.length) {
    message.textContent = '請先載入或產生組別。';
    return;
  }
  applyButton.disabled = true;
  try {
    const { data } = await requestJson('/api/groups', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups }),
    });
    renderGroups(data.groups);
    message.textContent = '組別設定已套用。';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    applyButton.disabled = false;
  }
});

loadGroups();

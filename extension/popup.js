const status = document.querySelector('#status');
const share = document.querySelector('#share');
const selectAll = document.querySelector('#all');
const sites = document.querySelector('#sites');
const search = document.querySelector('#search');
let state = {};
let domains = [];
const selected = new Set();
function render(next) {
  state = next || state;
  status.textContent = state.message || 'Disconnected.';
  share.disabled = !state.connected || state.busy || !selected.size;
  share.textContent = state.busy ? 'Preparing desktop…' : 'Authorize sessions';
  const connection = document.querySelector('#connection');
  connection.textContent = state.connected ? 'Connected locally' : 'Offline';
  connection.classList.toggle('online', Boolean(state.connected));
  document.querySelector('#connect').hidden = Boolean(state.connected);
  document.querySelector('#count').textContent = selected.size + ' of ' + domains.length + ' domains';
  selectAll.checked = domains.length > 0 && selected.size === domains.length;
  selectAll.indeterminate = selected.size > 0 && selected.size < domains.length;
  selectAll.disabled = Boolean(state.busy);
}
function renderSites() {
  sites.replaceChildren();
  const visible = domains.filter(item => item.domain.includes(search.value.trim().toLowerCase()));
  for (const item of visible) {
    const label = document.createElement('label'); label.className = 'site';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(item.domain); checkbox.disabled = Boolean(state.busy);
    checkbox.onchange = () => { checkbox.checked ? selected.add(item.domain) : selected.delete(item.domain); render(); };
    const name = document.createElement('span'); name.textContent = item.domain;
    const count = document.createElement('small'); count.textContent = item.count;
    label.append(checkbox, name, count); sites.append(label);
  }
  if (!visible.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = domains.length ? 'No matching sites.' : 'No transferable cookies found.'; sites.append(empty); }
}
chrome.storage.onChanged.addListener(changes => { if (changes.state) { render(changes.state.newValue); renderSites(); } });
document.querySelector('#connect').onclick = async () => render(await chrome.runtime.sendMessage({ action: 'connect' }));
selectAll.onchange = () => { selected.clear(); if (selectAll.checked) for (const item of domains) selected.add(item.domain); render(); renderSites(); };
search.oninput = renderSites;
share.onclick = async () => { share.disabled = true; await chrome.runtime.sendMessage({ action: 'share', approvedDomains: [...selected] }); };
render(await chrome.runtime.sendMessage({ action: 'status' }));
const preview = await chrome.runtime.sendMessage({ action: 'preview' });
if (preview.error) { status.textContent = preview.error; }
else {
  domains = preview.domains;
  for (const item of domains) selected.add(item.domain);
  if (preview.skipped) { const unsupported = document.querySelector('#unsupported'); unsupported.hidden = false; unsupported.textContent = preview.skipped + ' partitioned cookies will be skipped.'; }
  render(); renderSites();
}

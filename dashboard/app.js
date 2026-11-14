// Dashboard client. Findings contain text taken from scanned targets, so every
// value is inserted with textContent; nothing is ever parsed as HTML.
'use strict';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const state = { reports: [], selectedId: null, report: null, filter: new Set(SEVERITIES), query: '', visible: [], combined: null };

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function api(path, options = {}) {
  const init = { ...options, headers: { ...(options.headers || {}) } };
  if (init.method && init.method !== 'GET') {
    init.headers['x-vibeproof'] = '1';
    if (init.body) init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
    err.data = data;
    throw err;
  }
  return data;
}

function toast(message) {
  const node = el('div', { class: 'toast', role: 'status', text: message });
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortTarget(target, track) {
  if (track === 'web') {
    try { return new URL(target).host; } catch { return target; }
  }
  return target.split('/').filter(Boolean).pop() || target;
}

/** Mirrors detectTrack() on the server so the user sees what will run. */
function detectTrack(value) {
  const t = value.trim();
  if (!t) return null;
  if (/^git@|^ssh:\/\//i.test(t)) return 'ssh';
  if (/^(https?:\/\/)?(www\.)?(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)\/[\w.-]+\/[\w.-]+/i.test(t)) return 'repo-link';
  if (/^https?:\/\//i.test(t)) return 'web';
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t) && !t.startsWith('.')) return 'web';
  return 'repo';
}

/* ---------- Scan form ---------- */

function updateDetected() {
  const track = detectTrack($('#target').value);
  $('#detected').textContent = {
    web: 'Live web app, read-only',
    repo: 'Local folder, static analysis',
    'repo-link': 'Public repository: downloaded, scanned, then deleted',
    ssh: 'SSH links are not used. Paste the https link, or download a private repo and enter its folder',
  }[track] || '';
}

function setBusy(busy) {
  const btn = $('#run-btn');
  btn.classList.toggle('busy', busy);
  btn.disabled = busy;
  btn.querySelector('.label').textContent = busy ? '' : 'Scan';
}

function showFormError(message) {
  const node = $('#form-error');
  node.textContent = message || '';
  node.hidden = !message;
}

function showVerification(v) {
  const box = $('#verify');
  if (!v) {
    box.hidden = true;
    return;
  }
  const repeat = !box.hidden && $('#verify-title').dataset.host === v.host;
  $('#verify-title').textContent = `Verify you own ${v.host}`;
  $('#verify-title').dataset.host = v.host;
  $('#verify-file').textContent = v.fileUrl;
  $('#verify-token').textContent = v.token;
  $('#verify-dns').textContent = v.dnsRecord;

  // Always say what happened, so a failed re-check is never silent.
  const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#verify-status-title').textContent = `${repeat ? 'Still not verified' : 'Not verified'} (checked ${time})`;
  $('#verify-checks').replaceChildren(...(v.checks || []).map((c) => el('li', { text: c })));
  $('#verify-status').hidden = false;
  box.hidden = false;
  if (repeat) {
    box.classList.remove('flash');
    void box.offsetWidth; // restart the animation
    box.classList.add('flash');
  }
}

async function runScan() {
  const target = $('#target').value.trim();
  showFormError('');
  if (!target) {
    $('#target').focus();
    return;
  }
  setBusy(true);
  $('#verify-again').disabled = true;
  $('#verify-again').textContent = 'Checking...';
  try {
    const summary = await api('/api/scan', { method: 'POST', body: JSON.stringify({ target }) });
    showVerification(null);
    toast(`${summary.total} finding(s)`);
    await loadReports();
    await selectReport(summary.id);
  } catch (err) {
    if (err.data && err.data.verification) showVerification(err.data.verification);
    else showFormError(err.message);
  } finally {
    setBusy(false);
    $('#verify-again').disabled = false;
    $('#verify-again').textContent = 'Check again';
  }
}

/* ---------- History ---------- */

async function loadReports() {
  state.reports = await api('/api/reports');
  renderHistory();
}

function renderHistory() {
  const list = $('#history');
  list.replaceChildren();
  if (!state.reports.length) {
    list.append(el('li', { class: 'empty-note', text: 'No scans yet' }));
    return;
  }
  for (const r of state.reports) {
    list.append(el('li', {},
      el('button', {
        type: 'button',
        class: `sev-${r.rating}${r.id === state.selectedId ? ' selected' : ''}`,
        title: r.target,
        onclick: () => selectReport(r.id),
      },
      el('span', { class: 'target', text: shortTarget(r.target, r.track) }),
      el('span', { class: 'meta', text: `${formatDate(r.finishedAt)}  ·  ${r.total || 'no'} finding${r.total === 1 ? '' : 's'}` }))));
  }
}

/* ---------- Report detail ---------- */

async function selectReport(id) {
  state.selectedId = id;
  state.filter = new Set(SEVERITIES);
  state.query = '';
  renderHistory();
  try {
    state.report = await api(`/api/reports/${encodeURIComponent(id)}`);
  } catch (err) {
    state.report = null;
    toast(err.message);
  }
  renderDetail();
}

async function deleteReport(id) {
  if (!confirm('Delete this scan and its PDF report? This cannot be undone.')) return;
  try {
    await api(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.selectedId = null;
    state.report = null;
    await loadReports();
    renderDetail();
  } catch (err) {
    toast(err.message);
  }
}

function renderDetail() {
  const root = $('#detail');
  root.replaceChildren();
  const r = state.report;
  if (!r) {
    root.append($('#empty-state').content.cloneNode(true));
    return;
  }

  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, r.findings.filter((f) => f.severity === s).length]));
  const rating = SEVERITIES.find((s) => counts[s] > 0) || 'none';
  const id = encodeURIComponent(r.id);

  root.append(el('div', { class: 'report-head' },
    el('div', { class: 'title' },
      el('div', { class: 'target mono', text: r.target }),
      el('div', { class: 'meta' },
        el('span', { class: `rating sev-${rating}`, text: rating === 'none' ? 'No findings' : `${rating} risk` }),
        el('span', { text: r.track === 'repo' ? 'Repository' : 'Web app' }),
        el('span', { text: formatDate(r.finishedAt) }))),
    el('nav', { class: 'actions' },
      el('a', { href: `/reports/${id}.pdf`, target: '_blank', rel: 'noopener', text: 'PDF' }),
      el('a', { href: `/reports/${id}.json?download`, text: 'JSON' }),
      el('button', { type: 'button', class: 'danger', onclick: () => deleteReport(r.id), text: 'Delete' }))));

  root.append(el('div', { class: 'tiles' }, SEVERITIES.map((s) => el('button', {
    type: 'button',
    class: `tile sev-${s}`,
    'aria-pressed': String(state.filter.has(s)),
    disabled: counts[s] === 0,
    onclick: () => {
      if (state.filter.has(s) && state.filter.size === SEVERITIES.length) state.filter = new Set([s]);
      else if (state.filter.has(s)) state.filter.delete(s);
      else state.filter.add(s);
      if (!state.filter.size) state.filter = new Set(SEVERITIES);
      renderDetail();
    },
  }, el('span', { class: 'n', text: counts[s] }), el('span', { class: 'l', text: s })))));

  if (!r.findings.length) {
    root.append(el('p', { class: 'all-clear', text: 'No issues found by the current rule set. This does not prove the app is secure.' }));
  } else {
    const list = el('div', { class: 'findings' });
    const copyAll = el('button', { type: 'button', class: 'copy-all', onclick: () => copyCombined() });
    const search = el('input', {
      type: 'search', placeholder: 'Filter', value: state.query, 'aria-label': 'Filter findings',
      oninput: (e) => { state.query = e.target.value; renderFindings(list, copyAll); },
    });
    root.append(el('div', { class: 'toolbar' }, search, copyAll), list);
    renderFindings(list, copyAll);
  }

  if (r.notes && r.notes.length) {
    root.append(el('details', { class: 'log' },
      el('summary', { text: 'Scan log' }),
      el('ul', {}, r.notes.map((n) => el('li', { text: n })))));
  }
}

/** Copy within the click: modern clipboard API first, then the older execCommand path (works without permission). */
async function copyText(text, done = 'Prompt copied') {
  const legacy = () => {
    const area = el('textarea', { readonly: true, 'aria-hidden': 'true' });
    area.value = text;
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  };
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = legacy();
  }
  toast(ok ? done : 'Copy failed: open the preview and select the text');
}

/** The combined prompt is fetched ahead of the click so copying happens inside the click itself. */
async function prefetchCombined() {
  const key = `${state.report.id}:${state.visible.join(',')}`;
  state.combined = { key, prompt: null };
  if (!state.visible.length) return;
  try {
    const { prompt, count } = await api(`/api/reports/${encodeURIComponent(state.report.id)}/prompt?i=${state.visible.join(',')}`);
    if (state.combined.key === key) state.combined = { key, prompt, count };
  } catch {
    // copyCombined will retry
  }
}

async function copyCombined() {
  if (!state.visible.length) return;
  const c = state.combined;
  if (c?.prompt && c.key === `${state.report.id}:${state.visible.join(',')}`) {
    return copyText(c.prompt, `Prompt for ${c.count} finding${c.count === 1 ? '' : 's'} copied`);
  }
  await prefetchCombined();
  if (state.combined.prompt) copyText(state.combined.prompt, 'Prompt copied');
}

function renderFindings(list, copyAll) {
  const r = state.report;
  const q = state.query.trim().toLowerCase();
  const order = (f) => SEVERITIES.indexOf(f.severity);
  const indexed = r.findings.map((f, i) => ({ ...f, index: i }));
  const visible = indexed
    .filter((f) => state.filter.has(f.severity))
    .filter((f) => !q || [f.title, f.ruleId, f.location, f.evidence, f.description].join(' ').toLowerCase().includes(q))
    .sort((a, b) => order(a) - order(b) || a.ruleId.localeCompare(b.ruleId));
  state.visible = visible.map((f) => f.index);
  copyAll.textContent = `Copy fix prompt for ${visible.length === r.findings.length ? 'all' : visible.length} finding${visible.length === 1 ? '' : 's'}`;
  copyAll.disabled = !visible.length;
  prefetchCombined();

  list.replaceChildren();
  if (!visible.length) {
    list.append(el('p', { class: 'no-results', text: 'Nothing matches.' }));
    return;
  }
  for (const f of visible) {
    list.append(el('details', { class: `finding sev-${f.severity}` },
      el('summary', {},
        el('span', { class: 'dot', title: f.severity }),
        el('span', { class: 'ftitle', text: f.title }),
        el('span', { class: 'loc mono', text: f.location, title: f.location })),
      el('div', { class: 'body' },
        el('p', { text: f.description }),
        el('pre', { text: f.evidence }),
        el('p', {}, el('span', { class: 'label', text: 'Fix  ' }), f.remediation),
        el('div', { class: 'prompt-row' },
          el('button', { type: 'button', class: 'copy-prompt', onclick: () => copyText(f.prompt), text: 'Copy fix prompt' }),
          el('span', { class: 'hint-inline', text: 'for Claude Code, Cursor, Copilot or any coding agent' })),
        el('details', { class: 'prompt-preview' },
          el('summary', { text: 'Preview prompt' }),
          el('pre', { text: f.prompt })),
        el('p', { class: 'refs', text: `${f.severity.toUpperCase()}  ·  ${f.ruleId}  ·  ${f.owasp}  ·  ${f.cwe}` }))));
  }
}

/* ---------- Boot ---------- */

document.addEventListener('DOMContentLoaded', async () => {
  $('#scan-form').addEventListener('submit', (e) => { e.preventDefault(); runScan(); });
  $('#target').addEventListener('input', () => { updateDetected(); showVerification(null); showFormError(''); });
  $('#verify-again').addEventListener('click', runScan);
  document.querySelectorAll('.copy').forEach((btn) => btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast('Copy failed; select the text instead');
    }
  }));
  renderDetail();
  try {
    await loadReports();
    if (state.reports.length) await selectReport(state.reports[0].id);
  } catch (err) {
    toast(err.message);
  }
});

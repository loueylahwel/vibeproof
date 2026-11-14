// Dashboard client. Findings contain text taken from scanned targets, so every
// value is inserted with textContent; nothing is ever parsed as HTML.
'use strict';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const state = { track: 'repo', reports: [], selectedId: null, report: null, filter: new Set(SEVERITIES), query: '' };

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
    init.headers['x-vscan'] = '1';
    if (init.body) init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

function toast(message) {
  const node = el('div', { class: 'toast', role: 'status', text: message });
  document.body.append(node);
  setTimeout(() => node.remove(), 3000);
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function shortTarget(target, track) {
  if (track === 'web') {
    try { return new URL(target).host; } catch { return target; }
  }
  return target.split('/').filter(Boolean).pop() || target;
}

/* ---------- Scan form ---------- */

function setTrack(track) {
  state.track = track;
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.track === track;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.track-fields').forEach((fs) => { fs.hidden = fs.dataset.for !== track; });
  updateRunButton();
}

function updateRunButton() {
  const form = $('#scan-form');
  const btn = $('#run-btn');
  if (btn.classList.contains('busy')) return;
  btn.disabled = state.track === 'web' && !form.authorized.checked;
  btn.title = btn.disabled ? 'Confirm you are allowed to test this app first' : '';
}

function setBusy(busy) {
  const btn = $('#run-btn');
  btn.classList.toggle('busy', busy);
  btn.disabled = busy;
  btn.querySelector('.label').textContent = busy ? 'Scanning...' : 'Run scan';
  if (!busy) updateRunButton();
}

function showFormError(message) {
  const node = $('#form-error');
  node.textContent = message || '';
  node.hidden = !message;
}

async function onSubmit(event) {
  event.preventDefault();
  showFormError('');
  const form = event.currentTarget;
  const body = state.track === 'repo'
    ? { track: 'repo', target: form.repoPath.value, history: form.history.checked, npmAudit: form.npmAudit.checked }
    : { track: 'web', target: form.url.value, supabaseUrl: form.supabaseUrl.value, authorized: form.authorized.checked };

  setBusy(true);
  try {
    const summary = await api('/api/scan', { method: 'POST', body: JSON.stringify(body) });
    toast(`Scan finished: ${summary.total} finding(s)`);
    await loadReports();
    await selectReport(summary.id);
  } catch (err) {
    showFormError(err.message);
  } finally {
    setBusy(false);
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
  $('#history-count').textContent = state.reports.length ? `${state.reports.length} scan(s)` : '';
  if (!state.reports.length) {
    list.append(el('li', { class: 'empty-note', text: 'No scans yet.' }));
    return;
  }
  for (const r of state.reports) {
    const pills = SEVERITIES.filter((s) => r.counts[s] > 0 && s !== 'info')
      .map((s) => el('span', { class: `pill sev-${s}`, title: `${r.counts[s]} ${s}`, text: r.counts[s] }));
    list.append(el('li', {},
      el('button', {
        type: 'button',
        class: `sev-${r.rating}${r.id === state.selectedId ? ' selected' : ''}`,
        title: r.target,
        onclick: () => selectReport(r.id),
      },
      el('span', { class: 'target', text: shortTarget(r.target, r.track) }),
      el('span', { class: 'meta' },
        el('span', { text: `${r.track === 'repo' ? 'Repository' : 'Web app'} - ${formatDate(r.finishedAt)}` }),
        el('span', { class: 'pills' }, pills.length ? pills : el('span', { text: r.total ? `${r.total} info` : 'clean' }))))));
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
    toast('Scan deleted');
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

  root.append(
    el('div', { class: 'report-head' },
      el('div', { class: 'title' },
        el('div', { class: 'target mono', text: r.target }),
        el('div', { class: 'meta' },
          el('span', { text: r.track === 'repo' ? 'Repository scan (white-box)' : 'Live web app scan (read-only)' }),
          el('span', { text: formatDate(r.finishedAt) }),
          el('span', { text: `${r.tool} ${r.version}` }))),
      el('div', { class: 'actions' },
        el('a', { class: 'btn solid', href: `/reports/${id}.pdf`, target: '_blank', rel: 'noopener', text: 'Open PDF report' }),
        el('a', { class: 'btn', href: `/reports/${id}.pdf?download`, text: 'Download PDF' }),
        el('a', { class: 'btn', href: `/reports/${id}.json?download`, text: 'JSON' }),
        el('button', { type: 'button', class: 'btn danger', onclick: () => deleteReport(r.id), text: 'Delete' }))),
    el('div', { class: 'rating' },
      el('span', { class: 'muted', text: 'Overall risk rating' }),
      el('span', { class: `badge sev-${rating}`, text: rating === 'none' ? 'No findings' : rating })),
  );

  // Severity tiles double as filters
  root.append(el('div', { class: 'tiles' }, SEVERITIES.map((s) => el('button', {
    type: 'button',
    class: `tile sev-${s}`,
    'aria-pressed': String(state.filter.has(s)),
    disabled: counts[s] === 0,
    title: counts[s] ? `Show or hide ${s} findings` : undefined,
    onclick: () => {
      if (state.filter.has(s) && state.filter.size === SEVERITIES.length) state.filter = new Set([s]);
      else if (state.filter.has(s)) state.filter.delete(s);
      else state.filter.add(s);
      if (!state.filter.size) state.filter = new Set(SEVERITIES);
      renderDetail();
    },
  }, el('div', { class: 'n', text: counts[s] }), el('div', { class: 'l', text: s })))));

  if (!r.findings.length) {
    root.append(el('div', { class: 'all-clear' },
      el('strong', { text: 'No issues found by the current rule set. ' }),
      el('span', { class: 'muted', text: 'This does not prove the app is secure; see the limitations section of the PDF report.' })));
  } else {
    const search = el('input', {
      type: 'search', placeholder: 'Filter by text, rule or file', value: state.query, 'aria-label': 'Filter findings',
      oninput: (e) => { state.query = e.target.value; renderFindings(list, countNode); },
    });
    const countNode = el('span', { class: 'muted small' });
    const list = el('div', { class: 'findings' });
    root.append(el('div', { class: 'toolbar' }, search, countNode), list);
    renderFindings(list, countNode);
  }

  if (r.notes && r.notes.length) {
    root.append(el('details', { class: 'log' },
      el('summary', { text: `Scan log (${r.notes.length})` }),
      el('ul', {}, r.notes.map((n) => el('li', { text: n })))));
  }
}

function renderFindings(list, countNode) {
  const r = state.report;
  const q = state.query.trim().toLowerCase();
  const order = (f) => SEVERITIES.indexOf(f.severity);
  const visible = r.findings
    .filter((f) => state.filter.has(f.severity))
    .filter((f) => !q || [f.title, f.ruleId, f.location, f.evidence, f.description].join(' ').toLowerCase().includes(q))
    .sort((a, b) => order(a) - order(b) || a.ruleId.localeCompare(b.ruleId));

  countNode.textContent = `Showing ${visible.length} of ${r.findings.length}`;
  list.replaceChildren();
  if (!visible.length) {
    list.append(el('div', { class: 'no-results', text: 'No findings match the current filter.' }));
    return;
  }
  for (const f of visible) {
    list.append(el('details', { class: `finding sev-${f.severity}` },
      el('summary', {},
        el('span', { class: 'badge', text: f.severity }),
        el('span', { class: 'ftitle', text: f.title }),
        el('span', { class: 'rule mono', text: f.ruleId }),
        el('span', { class: 'loc mono', text: f.location, title: f.location })),
      el('div', { class: 'body' },
        el('div', {}, el('h3', { text: 'Description' }), el('p', { text: f.description })),
        el('div', {}, el('h3', { text: 'Evidence (redacted)' }), el('pre', { text: f.evidence })),
        el('div', {}, el('h3', { text: 'Recommendation' }), el('p', { text: f.remediation })),
        el('dl', { class: 'kv' },
          el('dt', { text: 'Location' }), el('dd', { class: 'mono', text: f.location }),
          el('dt', { text: 'OWASP' }), el('dd', { text: f.owasp }),
          el('dt', { text: 'CWE' }), el('dd', { text: f.cwe }),
          el('dt', { text: 'Track' }), el('dd', { text: f.track === 'repo' ? 'Repository' : 'Web' })))));
  }
}

/* ---------- Boot ---------- */

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setTrack(tab.dataset.track)));
  const form = $('#scan-form');
  form.addEventListener('submit', onSubmit);
  form.authorized.addEventListener('change', updateRunButton);
  setTrack('repo');
  renderDetail();
  try {
    await loadReports();
    if (state.reports.length) await selectReport(state.reports[0].id);
  } catch (err) {
    toast(err.message);
  }
});

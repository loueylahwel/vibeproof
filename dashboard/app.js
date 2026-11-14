// Vibeproof dashboard client.
// Findings contain text taken from scanned targets, so every value is inserted
// with textContent; nothing from a report is ever parsed as HTML.
'use strict';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const state = {
  reports: [],
  report: null,
  filter: new Set(SEVERITIES),
  query: '',
  open: new Set(),
  visible: [],
  combined: null,
  scanning: false,
  historyQuery: '',
};

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    // Through CSSOM: the page's Content-Security-Policy blocks style attributes, not style properties.
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ---------- Icons (static shapes, built as SVG nodes) ---------- */

const ICONS = {
  folder: [['path', { d: 'M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z' }]],
  branch: [['circle', { cx: 6.5, cy: 5.5, r: 2 }], ['circle', { cx: 6.5, cy: 18.5, r: 2 }], ['circle', { cx: 17.5, cy: 7.5, r: 2 }], ['path', { d: 'M6.5 7.5v9M17.5 9.5c0 4.5-6.5 3.5-10.2 7.3' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17' }]],
  chevron: [['path', { d: 'm6 9.5 6 6 6-6' }]],
  file: [['path', { d: 'M7 3.5h7l4 4v12.5a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z' }], ['path', { d: 'M14 3.5V8h4M9 13h6M9 16.5h4' }]],
  download: [['path', { d: 'M12 4v11m0 0 4.2-4.2M12 15l-4.2-4.2M5 19.5h14' }]],
  trash: [['path', { d: 'M4.5 7h15M10 7V4.8h4V7M6.8 7l.9 12.7h8.6L17.2 7' }]],
  copy: [['rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 }], ['path', { d: 'M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h.5' }]],
  check: [['path', { d: 'm5 12.5 4.5 4.5L19 7.5' }]],
  alert: [['circle', { cx: 12, cy: 12, r: 8.5 }], ['path', { d: 'M12 7.8v5M12 16.2v.1' }]],
  search: [['circle', { cx: 11, cy: 11, r: 6.5 }], ['path', { d: 'm16 16 4 4' }]],
  spark: [['path', { d: 'M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9z' }]],
  eye: [['path', { d: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z' }], ['circle', { cx: 12, cy: 12, r: 2.8 }]],
  shield: [['path', { d: 'M12 3 5 5.8v5.6c0 4.4 3 8.4 7 9.6 4-1.2 7-5.2 7-9.6V5.8z' }], ['path', { d: 'm9 12 2.2 2.2L15.5 10' }]],
};

function icon(name, cls) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (cls) svg.setAttribute('class', cls);
  for (const [tag, attrs] of ICONS[name]) {
    const shape = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, String(v));
    svg.append(shape);
  }
  return svg;
}

/* ---------- Helpers ---------- */

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

function toast(message, kind = 'ok') {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  const node = el('div', { class: `toast${kind === 'error' ? ' error' : ''}`, role: 'status' }, icon(kind === 'error' ? 'alert' : 'check'), el('span', { text: message }));
  box.append(node);
  setTimeout(() => {
    node.classList.add('out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, 2800);
}

function relTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 && new Date().getDate() === d.getDate()) return `${Math.round(s / 3600)} h ago`;
  const yesterday = new Date(Date.now() - 86400000);
  if (yesterday.toDateString() === d.toDateString()) return `yesterday ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const fullDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function dayGroup(iso) {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.floor((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This week';
  return 'Earlier';
}

function kindOf(r) {
  if (r.track === 'web') return { icon: 'globe', label: 'Live site scan' };
  if (/^https?:\/\//.test(r.target)) return { icon: 'branch', label: 'Public repository scan' };
  return { icon: 'folder', label: 'Repository scan' };
}

function shortTarget(target, track) {
  if (track === 'web') {
    try { return new URL(target).host; } catch { return target; }
  }
  return target.replace(/\/tree\/.*$/, '').split('/').filter(Boolean).pop() || target;
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

/** Copy inside the click: clipboard API first, then execCommand (works without permission). */
async function copyText(text, done = 'Prompt copied') {
  const legacy = () => {
    const area = el('textarea', { readonly: true, 'aria-hidden': 'true' });
    area.value = text;
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  };
  let ok;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = legacy();
  }
  if (ok) toast(done);
  else toast('Copy failed: open the preview and select the text', 'error');
}

/* ---------- Scan form ---------- */

function updateDetected() {
  const track = detectTrack($('#target').value);
  const node = $('#detected');
  node.textContent = {
    web: 'Live site · read-only',
    repo: 'Local folder · static analysis',
    'repo-link': 'Public repository · downloaded, then deleted',
    ssh: 'SSH links are not used: paste the https link',
  }[track] || '';
  node.classList.toggle('on', Boolean(track));
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
  const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#verify-status-title').textContent = `${repeat ? 'Still not verified' : 'Not verified'} · checked ${time}`;
  $('#verify-checks').replaceChildren(...(v.checks || []).map((c) => el('li', { text: c })));
  $('#verify-status').hidden = false;
  box.hidden = false;
  if (repeat) {
    box.classList.remove('flash');
    void box.offsetWidth;
    box.classList.add('flash');
  }
}

function setBusy(busy) {
  state.scanning = busy;
  const btn = $('#run-btn');
  btn.classList.toggle('busy', busy);
  btn.disabled = busy;
  $('#verify-again').disabled = busy;
  $('#verify-again').textContent = busy ? 'Checking...' : 'Check again';
  $('#topline').classList.toggle('on', busy);
}

async function runScan() {
  const target = $('#target').value.trim();
  showFormError('');
  if (!target) {
    $('#target').focus();
    return;
  }
  if (state.scanning) return;
  setBusy(true);
  const track = detectTrack(target);
  const progress = renderScanning(target, track);
  try {
    const summary = await api('/api/scan', { method: 'POST', body: JSON.stringify({ target }) });
    showVerification(null);
    $('#target').value = '';
    updateDetected();
    await progress.finish(summary.stages);
    toast(`Scan finished · ${summary.total} finding${summary.total === 1 ? '' : 's'}`);
    setBusy(false);
    await loadReports();
    navigate(`#/report/${summary.id}`);
  } catch (err) {
    progress.stop();
    setBusy(false);
    if (err.data && err.data.verification) showVerification(err.data.verification);
    else showFormError(err.message);
    route();
  }
}

/* ---------- Views ---------- */

function setView(...nodes) {
  const detail = $('#detail');
  const wrap = el('div', { class: 'view' }, ...nodes);
  detail.replaceChildren(wrap);
  $('#main').scrollTo({ top: 0 });
}

function renderWelcome() {
  document.title = 'Vibeproof';
  const start = (iconName, title, text, prefill) => el('button', {
    type: 'button',
    class: 'start',
    onclick: () => {
      const input = $('#target');
      input.value = prefill;
      updateDetected();
      input.focus();
      input.setSelectionRange(prefill.length, prefill.length);
    },
  }, el('span', { class: 'h-icon' }, icon(iconName)), el('strong', { text: title }), el('span', { text }));

  setView(el('div', { class: 'welcome' },
    el('span', { class: 'eyebrow', text: 'Security scanner for vibe-coded apps' }),
    el('h1', { text: 'Find what your app leaks before someone else does.' }),
    el('p', { class: 'lead', text: 'Scan a repository or a live site for exposed keys, open databases and misconfigured backends. Every scan runs on this computer, and live checks only read.' }),
    el('div', { class: 'starts' },
      start('branch', 'Public repository', 'Paste a GitHub, GitLab, Bitbucket or Codeberg link. No download needed.', 'https://github.com/'),
      start('folder', 'Local folder', 'Scan a project on this computer, including private repositories.', '~/'),
      start('globe', 'Live site', 'Check your deployed app. Domains you own are verified first.', 'https://')),
    el('div', { class: 'welcome-foot' },
      el('span', {}, el('b', { text: '/' }), ' to start typing'),
      el('span', {}, el('b', { text: 'Esc' }), ' to close'),
      el('span', { text: 'Reports stay in your local reports folder' }))));
}

function renderScanning(target, track) {
  const title = el('h1', { text: track === 'web' ? (() => { try { return new URL(/^https?:/.test(target) ? target : `https://${target}`).host; } catch { return target; } })() : shortTarget(target, 'repo') });
  const elapsed = el('p', { class: 'elapsed', text: 'Starting...' });
  const list = el('ol', { class: 'stages' });
  const label = { web: 'Scanning live site', 'repo-link': 'Scanning public repository', repo: 'Scanning folder' }[track] || 'Scanning';
  setView(el('div', { class: 'scanning' }, el('span', { class: 'eyebrow', text: label }), title, elapsed, list));
  document.title = 'Scanning... · Vibeproof';

  const started = Date.now();
  let shown = [];
  const draw = (stages) => {
    if (stages.length === shown.length) return;
    shown = stages;
    list.replaceChildren(...stages.map((s, i) => {
      const done = i < stages.length - 1;
      return el('li', { class: `stage ${done ? 'done' : 'current'}` }, el('span', { class: 'mark' }, done ? icon('check') : null), el('span', { text: s }));
    }));
  };
  const seconds = () => (Date.now() - started) / 1000;
  const fmt = (s) => (s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
  const tick = setInterval(() => { elapsed.textContent = `${fmt(seconds())} elapsed`; }, 100);
  const check = async () => {
    try {
      const p = await api('/api/progress');
      if (p && p.stages) draw(p.stages);
    } catch {
      // progress is best effort
    }
  };
  check();
  const poll = setInterval(check, 200);
  const stop = () => {
    clearInterval(tick);
    clearInterval(poll);
  };
  /** Show every stage as done, briefly, before the report opens. */
  const finish = async (stages = []) => {
    stop();
    shown = [];
    draw([...stages, 'Done']);
    list.lastChild?.classList.replace('current', 'done');
    const mark = list.lastChild?.querySelector('.mark');
    if (mark) mark.replaceChildren(icon('check'));
    elapsed.textContent = `Finished in ${fmt(seconds())}`;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise((r) => setTimeout(r, 650));
  };
  return { stop, finish };
}

function renderSkeleton() {
  setView(el('div', { class: 'skeleton' },
    el('div', { class: 'sk', style: 'height:14px;width:140px' }),
    el('div', { class: 'sk', style: 'height:30px;width:55%' }),
    el('div', { class: 'sk', style: 'height:14px;width:35%' }),
    el('div', { class: 'sk', style: 'height:84px;margin-top:22px' }),
    el('div', { class: 'sk', style: 'height:220px' })));
}

/* ---------- History ---------- */

async function loadReports() {
  state.reports = await api('/api/reports');
  renderHistory();
}

function renderHistory() {
  const nav = $('#history');
  const q = state.historyQuery.trim().toLowerCase();
  const items = state.reports.filter((r) => !q || r.target.toLowerCase().includes(q));
  $('#history-count').textContent = state.reports.length ? String(state.reports.length) : '';
  $('#history-filter').hidden = state.reports.length <= 6;
  const current = currentId();

  if (!items.length) {
    nav.replaceChildren(el('p', { class: 'empty-note', text: state.reports.length ? 'No scans match.' : 'No scans yet.' }));
    return;
  }
  const nodes = [];
  let lastGroup = '';
  for (const r of items) {
    const g = dayGroup(r.finishedAt);
    if (g !== lastGroup) {
      nodes.push(el('div', { class: 'group-label', text: g }));
      lastGroup = g;
    }
    const total = r.total || 0;
    const bar = el('span', { class: 'h-bar' }, ...SEVERITIES.filter((s) => r.counts[s]).map((s) => el('span', { class: `sev-${s}`, style: `flex:${r.counts[s]}` })));
    nodes.push(el('button', {
      type: 'button',
      class: `h-item sev-${r.rating}`,
      title: r.target,
      'aria-current': r.id === current ? 'page' : undefined,
      onclick: () => navigate(`#/report/${r.id}`),
    },
    el('span', { class: 'h-icon' }, icon(kindOf(r).icon)),
    el('span', { class: 'h-name', text: shortTarget(r.target, r.track) }),
    el('span', { class: 'h-total' }, total ? el('span', { class: 'dot' }) : null, total ? String(total) : 'clean'),
    el('span', { class: 'h-meta', text: relTime(r.finishedAt), title: fullDate(r.finishedAt) }),
    total ? bar : el('span')));
  }
  nav.replaceChildren(...nodes);
}

/* ---------- Report ---------- */

function currentId() {
  const m = /^#\/report\/([\w.-]+)$/.exec(location.hash);
  return m ? m[1] : null;
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

let loadToken = 0;
async function route() {
  if (state.scanning) return;
  renderHistory();
  const id = currentId();
  if (!id) {
    state.report = null;
    renderWelcome();
    return;
  }
  const token = ++loadToken;
  const slow = setTimeout(renderSkeleton, 120);
  try {
    const report = await api(`/api/reports/${encodeURIComponent(id)}`);
    if (token !== loadToken) return;
    if (!state.report || state.report.id !== id) {
      state.filter = new Set(SEVERITIES);
      state.query = '';
      state.open = new Set();
    }
    state.report = report;
    renderReport();
  } catch (err) {
    if (token !== loadToken) return;
    toast(err.message, 'error');
    navigate('#/');
  } finally {
    clearTimeout(slow);
  }
}

function confirmDelete(anchor) {
  const existing = $('.confirm');
  if (existing) {
    existing.remove();
    return;
  }
  const pop = el('div', { class: 'confirm', role: 'dialog', 'aria-label': 'Confirm delete' },
    el('p', { text: 'Delete this scan and its PDF report? This cannot be undone.' }),
    el('div', {},
      el('button', { type: 'button', class: 'btn btn-ghost btn-xs', onclick: () => pop.remove(), text: 'Cancel' }),
      el('button', {
        type: 'button',
        class: 'btn btn-primary btn-xs',
        onclick: async () => {
          try {
            await api(`/api/reports/${encodeURIComponent(state.report.id)}`, { method: 'DELETE' });
            toast('Scan deleted');
            await loadReports();
            navigate('#/');
          } catch (err) {
            toast(err.message, 'error');
          }
        },
        text: 'Delete',
      })));
  anchor.append(pop);
  $('.btn-primary', pop).focus();
}

function renderReport() {
  const r = state.report;
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, r.findings.filter((f) => f.severity === s).length]));
  const rating = SEVERITIES.find((s) => counts[s] > 0) || 'none';
  const id = encodeURIComponent(r.id);
  const kind = kindOf(r);
  const name = shortTarget(r.target, r.track);
  const took = (new Date(r.finishedAt) - new Date(r.startedAt)) / 1000;
  document.title = `${name} · Vibeproof`;

  const actions = el('div', { class: 'r-actions' },
    el('a', { class: 'btn btn-secondary', href: `/reports/${id}.pdf`, target: '_blank', rel: 'noopener', 'aria-label': 'Open the PDF report' }, icon('file'), el('span', { class: 'txt', text: 'PDF report' })),
    el('a', { class: 'btn btn-ghost', href: `/reports/${id}.json?download`, title: 'Download the JSON data' }, icon('download'), el('span', { class: 'txt', text: 'JSON' })));
  actions.append(el('button', { type: 'button', class: 'btn btn-ghost btn-danger', title: 'Delete this scan', onclick: () => confirmDelete(actions) }, icon('trash'), el('span', { class: 'txt', text: 'Delete' })));

  const head = el('header', { class: 'r-head' },
    el('div', {},
      el('div', { class: 'r-kicker' }, icon(kind.icon), el('span', { text: kind.label })),
      el('h1', { class: 'r-title', text: name }),
      el('div', { class: 'r-target mono', text: r.target }),
      el('div', { class: 'r-meta' },
        el('span', { class: `pill risk sev-${rating}` }, el('span', { class: 'dot' }), rating === 'none' ? 'No findings' : `${rating} risk`),
        el('span', { class: 'pill', text: relTime(r.finishedAt), title: fullDate(r.finishedAt) }),
        el('span', { class: 'pill', text: `${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}` }),
        Number.isFinite(took) ? el('span', { class: 'pill', text: `took ${took < 1 ? '<1' : took.toFixed(1)} s` }) : null)),
    actions);

  const total = r.findings.length || 1;
  const overview = el('section', { class: 'overview' },
    el('div', { class: 'dist', role: 'img', 'aria-label': SEVERITIES.map((s) => `${counts[s]} ${s}`).join(', ') },
      ...(r.findings.length ? SEVERITIES.filter((s) => counts[s]).map((s) => el('span', { class: `sev-${s}`, style: `flex-grow:${counts[s] / total}` })) : [el('span', { class: 'sev-none', style: 'flex-grow:1' })])),
    el('div', { class: 'tiles' }, SEVERITIES.map((s) => el('button', {
      type: 'button',
      class: `tile sev-${s}${state.filter.size === 1 && state.filter.has(s) ? ' solo' : ''}`,
      'aria-pressed': String(state.filter.has(s)),
      'aria-label': `${counts[s]} ${s}`,
      disabled: counts[s] === 0,
      title: counts[s] ? `Show only ${s}; click again to add or remove` : undefined,
      onclick: () => toggleFilter(s),
    }, el('span', { class: 'n', text: counts[s] }), el('span', { class: 'l' }, el('span', { class: 'dot' }), s)))));

  const body = [head, overview];
  if (!r.findings.length) {
    body.push(el('div', { class: 'all-clear' }, el('span', { class: 'dot sev-none' }),
      el('div', {}, el('strong', { text: 'No issues found by the current rules. ' }), el('span', { class: 'muted', text: 'This does not prove the app is secure; see the limitations in the PDF report.' }))));
  } else {
    const list = el('div', { class: 'findings-wrap' });
    const shown = el('span', { class: 'shown' });
    const copyAll = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => copyCombined() });
    const search = el('input', {
      type: 'search', placeholder: 'Filter findings', value: state.query, 'aria-label': 'Filter findings', id: 'finding-search',
      oninput: (e) => { state.query = e.target.value; renderFindings(list, copyAll, shown); },
    });
    body.push(el('div', { class: 'toolbar' }, el('label', { class: 'search' }, icon('search'), search), shown, copyAll), list);
    renderFindings(list, copyAll, shown);
  }

  if (r.notes?.length) {
    const logInner = el('div', { class: 'inner' }, el('ul', {}, r.notes.map((n) => el('li', { text: n }))));
    logInner.inert = true;
    const panel = el('div', { class: 'collapse' }, logInner);
    const toggle = el('button', {
      type: 'button',
      class: 'log-toggle',
      'aria-expanded': 'false',
      onclick: () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        panel.parentElement.classList.toggle('open', open);
        logInner.inert = !open;
        $('.chev', toggle).style.transform = open ? 'rotate(180deg)' : '';
      },
    }, icon('chevron', 'chev'), `Scan log (${r.notes.length})`);
    body.push(el('section', { class: 'log finding' }, toggle, panel));
  }
  setView(...body);
}

function toggleFilter(s) {
  if (state.filter.has(s) && state.filter.size === SEVERITIES.length) state.filter = new Set([s]);
  else if (state.filter.has(s)) state.filter.delete(s);
  else state.filter.add(s);
  if (!state.filter.size) state.filter = new Set(SEVERITIES);
  const y = $('#main').scrollTop;
  renderReport();
  $('#main').scrollTop = y;
}

function renderFindings(list, copyAll, shown) {
  const r = state.report;
  const q = state.query.trim().toLowerCase();
  const visible = r.findings
    .map((f, index) => ({ ...f, index }))
    .filter((f) => state.filter.has(f.severity))
    .filter((f) => !q || [f.title, f.ruleId, f.location, f.evidence, f.description].join(' ').toLowerCase().includes(q));
  state.visible = visible.map((f) => f.index);
  shown.textContent = visible.length === r.findings.length ? `${visible.length} findings` : `${visible.length} of ${r.findings.length} shown`;
  copyAll.replaceChildren(icon('spark'), el('span', { text: `Fix prompt for ${visible.length === r.findings.length ? 'all' : visible.length}` }));
  copyAll.disabled = !visible.length;
  copyAll.title = 'Copy one prompt for your AI coding agent covering every finding shown';
  prefetchCombined();

  if (!visible.length) {
    list.replaceChildren(el('p', { class: 'no-results', text: 'No findings match this filter.' }));
    return;
  }
  const groups = SEVERITIES.map((s) => [s, visible.filter((f) => f.severity === s).sort((a, b) => a.ruleId.localeCompare(b.ruleId))]).filter(([, fs]) => fs.length);
  list.replaceChildren(...groups.map(([s, fs]) => el('section', { class: `group sev-${s}` },
    el('div', { class: 'group-head' }, el('span', { class: 'dot' }), el('span', { text: s }), el('span', { class: 'n', text: String(fs.length) })),
    el('div', { class: 'list' }, fs.map(renderFinding)))));
}

function renderFinding(f) {
  const isOpen = state.open.has(f.index);
  const previewInner = el('div', { class: 'inner' }, el('pre', { text: f.prompt || '' }));
  previewInner.inert = true;
  const preview = el('div', { class: 'collapse' }, previewInner);
  const previewBtn = el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-xs',
    'aria-expanded': 'false',
    onclick: () => {
      const open = !preview.classList.contains('show');
      preview.classList.toggle('show', open);
      preview.style.gridTemplateRows = open ? '1fr' : '';
      previewInner.inert = !open;
      previewBtn.setAttribute('aria-expanded', String(open));
      previewBtn.classList.toggle('on', open);
      previewBtn.lastChild.textContent = open ? 'Hide prompt' : 'Preview';
    },
  }, icon('eye'), el('span', { text: 'Preview' }));

  const node = el('article', { class: `finding sev-${f.severity}${isOpen ? ' open' : ''}` });
  const row = el('button', {
    type: 'button',
    class: 'f-row',
    'aria-expanded': String(isOpen),
    onclick: () => {
      const open = !node.classList.contains('open');
      node.classList.toggle('open', open);
      row.setAttribute('aria-expanded', String(open));
      $('.collapse > .inner', node).inert = !open;
      if (open) state.open.add(f.index);
      else state.open.delete(f.index);
    },
  },
  el('span', { class: 'dot' }),
  el('span', { class: 'f-title' }, f.title, el('span', { class: 'rule mono', text: f.ruleId })),
  el('span', { class: 'f-loc mono', text: f.location, title: f.location }),
  icon('chevron', 'chev'));

  const bodyEl = el('div', { class: 'f-body' },
    el('div', {}, el('h3', { text: 'Why it matters' }), el('p', { text: f.description })),
    el('div', {}, el('h3', { text: 'Evidence · redacted' }), el('pre', { text: f.evidence })),
    el('div', {}, el('h3', { text: 'How to fix' }), el('p', { text: f.remediation })),
    el('div', { class: 'agent' },
      el('div', { class: 'agent-row' },
        el('button', { type: 'button', class: 'btn btn-secondary btn-xs', onclick: () => copyText(f.prompt) }, icon('copy'), el('span', { text: 'Copy fix prompt' })),
        previewBtn,
        el('span', { class: 'hint', text: 'Paste into Claude Code, Cursor, Copilot or any coding agent' })),
      preview),
    el('p', { class: 'refs', text: `${f.severity.toUpperCase()}  ·  ${f.ruleId}  ·  ${f.owasp}  ·  ${f.cwe}  ·  ${f.location}` }));

  const inner = el('div', { class: 'inner' }, bodyEl);
  inner.inert = !isOpen; // closed sections are skipped by Tab and screen readers
  node.append(row, el('div', { class: 'collapse' }, inner));
  return node;
}

/* ---------- Combined prompt ---------- */

async function prefetchCombined() {
  const key = `${state.report.id}:${state.visible.join(',')}`;
  state.combined = { key, prompt: null };
  if (!state.visible.length) return;
  try {
    const { prompt, count } = await api(`/api/reports/${encodeURIComponent(state.report.id)}/prompt?i=${state.visible.join(',')}`);
    if (state.combined.key === key) state.combined = { key, prompt, count };
  } catch {
    // copyCombined retries
  }
}

async function copyCombined() {
  if (!state.visible.length) return;
  const c = state.combined;
  if (c?.prompt && c.key === `${state.report.id}:${state.visible.join(',')}`) {
    copyText(c.prompt, `Prompt for ${c.count} finding${c.count === 1 ? '' : 's'} copied`);
    return;
  }
  await prefetchCombined();
  if (state.combined.prompt) copyText(state.combined.prompt);
}

/* ---------- Boot ---------- */

document.addEventListener('DOMContentLoaded', async () => {
  $('#scan-form').addEventListener('submit', (e) => { e.preventDefault(); runScan(); });
  $('#target').addEventListener('input', () => { updateDetected(); showFormError(''); });
  $('#verify-again').addEventListener('click', runScan);
  $('#history-filter').addEventListener('input', (e) => { state.historyQuery = e.target.value; renderHistory(); });
  document.querySelectorAll('.copy').forEach((btn) => btn.addEventListener('click', () => copyText(document.getElementById(btn.dataset.copy).textContent, 'Copied')));
  window.addEventListener('hashchange', route);

  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '');
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      $('#target').focus();
    } else if (e.key === 'Escape') {
      const pop = $('.confirm');
      if (pop) pop.remove();
      else if (typing) document.activeElement.blur();
    }
  });
  document.addEventListener('click', (e) => {
    const pop = $('.confirm');
    if (pop && !e.target.closest('.r-actions')) pop.remove();
  });

  try {
    const info = await api('/api/info');
    $('#version').textContent = `v${info.version}`;
    await loadReports();
  } catch (err) {
    toast(err.message, 'error');
  }
  route();
  setInterval(renderHistory, 60_000);
});

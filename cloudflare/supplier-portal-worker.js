// Cloudflare Worker: Karpi Supplier Portal
// Deploy op portal.karpi.nl (eigen domein via Cloudflare)
//
// Hoe het werkt:
//   Browser (China) → portal.karpi.nl (Cloudflare, bereikbaar) → Supabase (niet direct bereikbaar)
//
// Routes:
//   GET  /            → HTML login-pagina (browser)
//   GET  /?token=xxx  → HTML portal-pagina (browser)
//   GET  /api?token=  → JSON leverancier-data (JS fetch vanuit HTML)
//   POST /api         → login { email, wachtwoord }
//   PATCH /api        → update ETA { token, regel_id, verwacht_datum, notitie? }

const SUPABASE_API = 'https://wqzeevfobwauxkalagtn.supabase.co/functions/v1/supplier-portal'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
}

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    // /api  → proxy naar Supabase
    if (url.pathname === '/api') {
      return proxyToSupabase(request, url)
    }

    // /  met Accept: text/html  → HTML portal serveren
    const acceptsHtml = (request.headers.get('Accept') || '').includes('text/html')
    if (request.method === 'GET' && acceptsHtml) {
      return new Response(PORTAL_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return new Response('Not found', { status: 404 })
  },
}

async function proxyToSupabase(request, url) {
  const supabaseUrl = SUPABASE_API + (url.search || '')
  const headers = { 'Accept': 'application/json' }
  if (request.method !== 'GET') {
    headers['Content-Type'] = request.headers.get('Content-Type') || 'application/json'
  }
  const res = await fetch(supabaseUrl, {
    method: request.method,
    headers,
    body: request.method !== 'GET' ? request.body : undefined,
  })
  const body = await res.text()
  return new Response(body, {
    status: res.status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── Portal HTML ────────────────────────────────────────────────────────────────
// Alle API-calls gaan naar /api (deze Worker), niet rechtstreeks naar Supabase.
// Zo passeert al het verkeer via Cloudflare → bereikbaar vanuit China.

const PORTAL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Karpi Supplier Portal</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f9fafb;color:#111827;min-height:100vh}
input,textarea,button,select{font-family:inherit}
.center{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
.lcard{background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;padding:1.5rem;width:100%;max-width:24rem;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.logo{width:2.75rem;height:2.75rem;background:#2563eb;border-radius:.625rem;display:flex;align-items:center;justify-content:center;font-size:1.2rem;margin:0 auto .875rem}
h1{font-size:1.1rem;font-weight:600;text-align:center;margin-bottom:.25rem}
.sub{font-size:.8rem;color:#6b7280;text-align:center;margin-bottom:1.5rem}
.fg{margin-bottom:.875rem}
label{display:block;font-size:.8rem;font-weight:500;color:#374151;margin-bottom:.35rem}
input[type=email],input[type=password],input[type=date],textarea{width:100%;padding:.5rem .75rem;border:1px solid #d1d5db;border-radius:.5rem;font-size:.875rem;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus,textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.15)}
textarea{resize:none}
.pw-w{position:relative}
.pw-w input{padding-right:2.25rem}
.pw-tog{position:absolute;right:.5rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#9ca3af;padding:.2rem;line-height:1;font-size:.9rem}
.btn-p{display:flex;align-items:center;justify-content:center;gap:.5rem;width:100%;padding:.6rem 1rem;background:#2563eb;color:#fff;border:none;border-radius:.5rem;font-weight:500;font-size:.875rem;cursor:pointer;transition:background .15s;margin-top:1.1rem}
.btn-p:hover:not(:disabled){background:#1d4ed8}
.btn-p:disabled{opacity:.5;cursor:not-allowed}
.err-b{background:#fef2f2;border:1px solid #fecaca;border-radius:.5rem;padding:.5rem .75rem;font-size:.8rem;color:#b91c1c;margin-bottom:.875rem}
.hint{text-align:center;font-size:.7rem;color:#9ca3af;margin-top:1.25rem}
header{background:#fff;border-bottom:1px solid #e5e7eb;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.hinner{max-width:56rem;margin:0 auto;padding:.875rem 1rem;display:flex;align-items:center;gap:.75rem}
.hico{width:2.25rem;height:2.25rem;background:#2563eb;border-radius:.5rem;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0}
.htitle{font-weight:600;font-size:1rem}
.hsub{font-size:.75rem;color:#6b7280}
main{max-width:56rem;margin:0 auto;padding:1.25rem 1rem}
.sbar{display:flex;align-items:center;gap:.625rem;font-size:.8rem;margin-bottom:.875rem}
.sbar span{color:#6b7280}
.sbtn{padding:.2rem .625rem;border-radius:9999px;border:1px solid #d1d5db;background:#fff;cursor:pointer;color:#4b5563;font-size:.75rem;transition:all .15s}
.sbtn.act{background:#2563eb;color:#fff;border-color:#2563eb}
.sbtn:hover:not(.act){border-color:#93c5fd;color:#2563eb}
.tcard{background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;overflow:hidden}
.thead{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 2fr;padding:.6rem 1.25rem;font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#9ca3af;background:#f9fafb;border-bottom:1px solid #f3f4f6}
@media(max-width:640px){.thead,.dcols{display:none}}
.trow{padding:.875rem 1.25rem;border-bottom:1px solid #f3f4f6}
.trow:last-child{border-bottom:none}
.dcols{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 2fr;align-items:start;gap:.5rem}
@media(max-width:640px){.dcols{display:none}}
.mcols{display:none}
@media(max-width:640px){.mcols{display:block}}
.pname{font-size:.875rem;font-weight:500}
.pmeta{font-size:.7rem;color:#9ca3af;margin-top:.125rem}
.qr{font-size:.875rem;text-align:right;padding-top:.1rem}
.qrem{font-weight:600;color:#ea580c;font-size:.875rem;text-align:right;padding-top:.1rem}
.mqs{display:flex;gap:1.25rem;font-size:.8rem;margin:.5rem 0 .625rem}
.ql{font-size:.65rem;color:#9ca3af}
.eta-d{display:flex;align-items:flex-start;gap:.5rem}
.eta-i{flex:1}
.etadate{font-size:.875rem;font-weight:500}
.etawk{font-size:.7rem;color:#9ca3af}
.etaby{font-size:.7rem;color:#9ca3af;margin-top:.1rem}
.etanote{font-size:.7rem;color:#2563eb;font-style:italic;margin-top:.1rem}
.bedit{margin-left:auto;flex-shrink:0;font-size:.7rem;padding:.2rem .5rem;border:1px solid #e5e7eb;border-radius:.375rem;background:#fff;cursor:pointer;color:#4b5563;transition:all .15s;white-space:nowrap}
.bedit:hover{border-color:#93c5fd;color:#2563eb}
.editbox input[type=date]{font-size:.8rem;padding:.375rem .625rem}
.editbox textarea{font-size:.75rem;padding:.35rem .625rem;margin-top:.35rem}
.eacts{display:flex;gap:.5rem;margin-top:.375rem}
.bsave{display:flex;align-items:center;gap:.35rem;padding:.3rem .625rem;background:#2563eb;color:#fff;border:none;border-radius:.375rem;font-size:.75rem;cursor:pointer;transition:background .15s}
.bsave:hover:not(:disabled){background:#1d4ed8}
.bsave:disabled{opacity:.5;cursor:not-allowed}
.bcancel{padding:.3rem .625rem;background:#fff;color:#4b5563;border:1px solid #d1d5db;border-radius:.375rem;font-size:.75rem;cursor:pointer}
.bcancel:hover{background:#f9fafb}
.serr{font-size:.7rem;color:#b91c1c;margin-top:.25rem}
.sok{font-size:.7rem;color:#059669;margin-top:.25rem}
.empty{text-align:center;padding:3rem 1rem}
.footer{text-align:center;font-size:.7rem;color:#9ca3af;margin-top:1.25rem;padding-bottom:2rem}
.spin{display:inline-block;width:.8rem;height:.8rem;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loading{min-height:100vh;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:.875rem}
</style>
</head>
<body>
<div id="app"></div>
<script>
// Alle API-calls gaan naar /api op dezelfde host (de Cloudflare Worker).
// De Worker proxiet naar Supabase. Zo raakt China nooit rechtstreeks Supabase.
var API = '/api';
var TOKEN = new URLSearchParams(location.search).get('token');
var app = document.getElementById('app');
var sortBy = 'eta';
var editState = {};
var savingIds = {};
var errMap = {};
var savedIds = {};
var portalData = null;
var portalToken = null;

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function fmtDate(s) {
  if (!s) return '&#x2014;';
  var d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isoWk(s) {
  if (!s) return '';
  var d = new Date(s + 'T00:00:00');
  var jan4 = new Date(d.getFullYear(), 0, 4);
  var sow = new Date(jan4);
  sow.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
  var wk = Math.ceil(((d - sow) / 86400000 + 1) / 7);
  return 'wk ' + d.getFullYear() + '-' + String(wk).padStart(2, '0');
}

async function apiGet(token) {
  var r = await fetch(API + '?token=' + encodeURIComponent(token), { headers: { 'Accept': 'application/json' } });
  if (!r.ok) { var e = await r.json().catch(function() { return {}; }); throw new Error(e.error || 'HTTP ' + r.status); }
  return r.json();
}

async function apiLogin(email, pw) {
  var r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, wachtwoord: pw }) });
  var d = await r.json().catch(function() { return {}; });
  if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
  if (!d.token) throw new Error('No token');
  return d.token;
}

async function apiPatch(token, id, date, note) {
  var r = await fetch(API, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, regel_id: id, verwacht_datum: date, notitie: note || undefined }) });
  if (!r.ok) { var e = await r.json().catch(function() { return {}; }); throw new Error(e.error || 'HTTP ' + r.status); }
}

if (TOKEN) { loadPortal(TOKEN); } else { renderLogin(null); }

function renderLogin(errMsg) {
  app.innerHTML =
    '<div class="center"><div style="width:100%;max-width:24rem">' +
    '<div style="text-align:center;margin-bottom:1.75rem"><div class="logo">&#x1F4E6;</div>' +
    '<h1>Karpi Supplier Portal</h1><p class="sub">Sign in to manage your delivery schedule</p></div>' +
    '<div class="lcard">' + (errMsg ? '<div class="err-b">' + esc(errMsg) + '</div>' : '') +
    '<form id="lf">' +
    '<div class="fg"><label>Email address</label><input type="email" id="em" placeholder="you@company.com" required autocomplete="email" autofocus></div>' +
    '<div class="fg"><label>Password</label><div class="pw-w"><input type="password" id="pw" placeholder="&#xb7;&#xb7;&#xb7;&#xb7;&#xb7;&#xb7;&#xb7;&#xb7;" required autocomplete="current-password"><button type="button" class="pw-tog" id="pwt">&#x1F441;&#xFE0F;</button></div></div>' +
    '<button class="btn-p" id="lb" type="submit">Sign in</button>' +
    '</form></div>' +
    '<p class="hint">Need access? Contact Karpi to request login credentials.</p>' +
    '</div></div>';
  var pwi = document.getElementById('pw');
  document.getElementById('pwt').onclick = function() { pwi.type = pwi.type === 'password' ? 'text' : 'password'; };
  document.getElementById('lf').onsubmit = async function(e) {
    e.preventDefault();
    var lb = document.getElementById('lb');
    lb.disabled = true;
    lb.innerHTML = '<span class="spin"></span> Signing in&#x2026;';
    var email = document.getElementById('em').value.trim().toLowerCase();
    var pw = document.getElementById('pw').value;
    try {
      var tok = await apiLogin(email, pw);
      location.href = location.pathname + '?token=' + encodeURIComponent(tok);
    } catch(ex) {
      renderLogin(ex.message === 'Invalid email or password' ? 'Incorrect email or password. Please try again.' : 'Login failed. Please try again or contact Karpi.');
    }
  };
}

async function loadPortal(token) {
  app.innerHTML = '<div class="loading">Loading&#x2026;</div>';
  try {
    var d = await apiGet(token);
    portalData = d; portalToken = token;
    renderPortal();
  } catch(ex) {
    app.innerHTML =
      '<div class="center"><div style="background:#fff;border:1px solid #e5e7eb;border-radius:.75rem;padding:2rem;text-align:center;max-width:20rem">' +
      '<div style="font-size:2rem;margin-bottom:.75rem">&#x26A0;&#xFE0F;</div>' +
      '<h2 style="font-weight:600;margin-bottom:.5rem">Link not valid</h2>' +
      '<p style="font-size:.875rem;color:#6b7280">' + esc(ex.message) + '</p>' +
      '<p style="font-size:.75rem;color:#9ca3af;margin-top:1rem">Please contact Karpi to request a new portal link.</p>' +
      '</div></div>';
  }
}

function renderPortal() {
  var lev = portalData.leverancier, regels = portalData.regels;
  var sorted = regels.slice().sort(function(a, b) {
    if (sortBy === 'eta') { var da = a.verwacht_datum || '9999', db = b.verwacht_datum || '9999'; return da < db ? -1 : da > db ? 1 : 0; }
    return a.inkooporder_nr < b.inkooporder_nr ? -1 : 1;
  });
  var sy = window.scrollY;
  app.innerHTML =
    '<header><div class="hinner"><div class="hico">&#x1F4E6;</div><div>' +
    '<div class="htitle">' + esc(lev.naam) + '</div>' +
    '<div class="hsub">Delivery schedule &#x2014; ' + regels.length + ' open line' + (regels.length !== 1 ? 's' : '') + '</div>' +
    '</div></div></header>' +
    '<main><div class="sbar"><span>Sort by:</span>' +
    '<button class="sbtn ' + (sortBy === 'eta' ? 'act' : '') + '" id="seta">&#x1F4C5; Delivery date</button>' +
    '<button class="sbtn ' + (sortBy === 'ord' ? 'act' : '') + '" id="sord">Order no.</button></div>' +
    (sorted.length === 0
      ? '<div class="tcard"><div class="empty"><div style="font-size:2rem;margin-bottom:.75rem">&#x2705;</div><div style="font-weight:500;color:#374151">All caught up!</div><div style="font-size:.875rem;color:#9ca3af;margin-top:.25rem">No open delivery lines at this time.</div></div></div>'
      : '<div class="tcard"><div class="thead"><div>Product</div><div style="text-align:right">Ordered</div><div style="text-align:right">Delivered</div><div style="text-align:right">Remaining</div><div style="padding-left:.5rem">Expected delivery</div></div>' +
        sorted.map(rowHtml).join('') + '</div>') +
    '<p class="footer">You can update the expected delivery date for each line. Changes are saved immediately and visible to Karpi in real time.</p></main>';
  window.scrollTo(0, sy);
  document.getElementById('seta').onclick = function() { sortBy = 'eta'; renderPortal(); };
  document.getElementById('sord').onclick = function() { sortBy = 'ord'; renderPortal(); };
  sorted.forEach(function(r) { attachRow(r); });
}

function rowHtml(r) {
  var nm = esc(r.artikel_omschrijving || r.product_omschrijving || r.artikelnr || 'Line ' + r.regelnummer);
  var mt = esc(r.inkooporder_nr + ' \xb7 Line ' + r.regelnummer + (r.karpi_code ? ' \xb7 ' + r.karpi_code : ''));
  var un = r.eenheid === 'stuks' ? 'pcs' : 'm';
  var eta = editState[r.regel_id] !== undefined ? etaEditHtml(r) : etaDispHtml(r);
  return '<div class="trow" id="row' + r.regel_id + '">' +
    '<div class="dcols"><div><div class="pname">' + nm + '</div><div class="pmeta">' + mt + '</div></div>' +
    '<div class="qr">' + r.besteld_m + ' ' + un + '</div><div class="qr">' + r.geleverd_m + ' ' + un + '</div>' +
    '<div class="qrem">' + r.te_leveren_m + ' ' + un + '</div><div style="padding-left:.5rem">' + eta + '</div></div>' +
    '<div class="mcols"><div class="pname">' + nm + '</div><div class="pmeta">' + mt + '</div>' +
    '<div class="mqs"><div><div class="ql">Ordered</div>' + r.besteld_m + ' ' + un + '</div>' +
    '<div><div class="ql">Delivered</div>' + r.geleverd_m + ' ' + un + '</div>' +
    '<div><div class="ql">Remaining</div><span class="qrem">' + r.te_leveren_m + ' ' + un + '</span></div></div>' +
    '<div><div class="ql" style="margin-bottom:.25rem">Expected delivery</div>' + eta + '</div></div></div>';
}

function etaDispHtml(r) {
  var ub = r.eta_bijgewerkt_door === 'leverancier' ? 'you' : 'Karpi';
  return '<div class="eta-d"><div class="eta-i">' +
    '<div class="etadate">' + fmtDate(r.verwacht_datum) + '</div>' +
    (r.verwacht_datum ? '<div class="etawk">' + isoWk(r.verwacht_datum) + '</div>' : '') +
    (r.eta_bijgewerkt_op ? '<div class="etaby">Updated by ' + ub + ' ' + fmtDate(r.eta_bijgewerkt_op.slice(0, 10)) + '</div>' : '') +
    (r.leverancier_notitie ? '<div class="etanote">&ldquo;' + esc(r.leverancier_notitie) + '&rdquo;</div>' : '') +
    (savedIds[r.regel_id] ? '<div class="sok">&#x2713; Saved</div>' : '') +
    (errMap[r.regel_id] ? '<div class="serr">' + esc(errMap[r.regel_id]) + '</div>' : '') +
    '</div><button class="bedit" data-id="' + r.regel_id + '" data-act="edit">Edit</button></div>';
}

function etaEditHtml(r) {
  var ev = editState[r.regel_id];
  var saving = !!savingIds[r.regel_id];
  return '<div class="editbox">' +
    '<input type="date" id="ed_d_' + r.regel_id + '" value="' + esc(ev.date) + '">' +
    '<textarea id="ed_n_' + r.regel_id + '" rows="2" placeholder="Note (optional)&#x2026;">' + esc(ev.note) + '</textarea>' +
    '<div class="eacts"><button class="bsave" data-id="' + r.regel_id + '" data-act="save"' + (saving ? ' disabled' : '') + '>' +
    (saving ? '<span class="spin"></span> Saving&#x2026;' : 'Save') +
    '</button><button class="bcancel" data-id="' + r.regel_id + '" data-act="cancel"' + (saving ? ' disabled' : '') + '>Cancel</button></div>' +
    (errMap[r.regel_id] ? '<div class="serr">' + esc(errMap[r.regel_id]) + '</div>' : '') +
    '</div>';
}

function attachRow(r) {
  var row = document.getElementById('row' + r.regel_id);
  if (!row) return;
  row.addEventListener('click', async function(ev) {
    var btn = ev.target.closest('[data-act]');
    if (!btn) return;
    var id = Number(btn.dataset.id), act = btn.dataset.act;
    if (act === 'edit') {
      editState[id] = { date: r.verwacht_datum || '', note: r.leverancier_notitie || '' };
      delete savedIds[id]; delete errMap[id];
      refreshRow(r);
    } else if (act === 'cancel') {
      delete editState[id]; delete errMap[id];
      refreshRow(r);
    } else if (act === 'save') {
      var dateEl = document.getElementById('ed_d_' + id);
      var noteEl = document.getElementById('ed_n_' + id);
      var date = dateEl ? dateEl.value : (r.verwacht_datum || '');
      var note = noteEl ? noteEl.value : '';
      if (!date) { errMap[id] = 'Please enter a date.'; refreshRow(r); return; }
      editState[id] = { date: date, note: note };
      savingIds[id] = true; delete errMap[id];
      refreshRow(r);
      try {
        await apiPatch(portalToken, id, date, note);
        var reg = portalData.regels.find(function(x) { return x.regel_id === id; });
        if (reg) { reg.verwacht_datum = date; reg.leverancier_notitie = note || null; reg.eta_bijgewerkt_door = 'leverancier'; reg.eta_bijgewerkt_op = new Date().toISOString(); }
        delete savingIds[id]; delete editState[id]; delete errMap[id];
        savedIds[id] = true;
        refreshRow(reg || r);
      } catch(ex) {
        delete savingIds[id]; errMap[id] = ex.message;
        refreshRow(r);
      }
    }
  });
}

function refreshRow(r) {
  var row = document.getElementById('row' + r.regel_id);
  if (!row) return;
  var eta = editState[r.regel_id] !== undefined ? etaEditHtml(r) : etaDispHtml(r);
  var dcol = row.querySelector('.dcols');
  if (dcol) { var last = dcol.lastElementChild; if (last) last.innerHTML = eta; }
  var mcol = row.querySelector('.mcols');
  if (mcol) { var mlast = mcol.lastElementChild; if (mlast) mlast.innerHTML = '<div class="ql" style="margin-bottom:.25rem">Expected delivery</div>' + eta; }
  attachRow(r);
}
</script>
</body>
</html>`

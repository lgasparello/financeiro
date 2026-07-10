// auth.js — login por link mágico (Supabase Auth / GoTrue) via REST, sem SDK.
// Guarda a sessão no localStorage e mantém o SB_HDR.Authorization sincronizado com o
// token do usuário logado (os módulos de dados usam SB_HDR, então nada mais precisa mudar).
import { SB_URL, SB_KEY, SB_HDR } from './config.js';

const LS_KEY = 'llg_sessao';
const authHeaders = { apikey: SB_KEY, 'Content-Type': 'application/json' };

export function getSessao() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
}

function aplicarToken(access_token) {
  // muta o objeto compartilhado — todos os fetch que fazem {...SB_HDR} pegam o token novo
  SB_HDR.Authorization = 'Bearer ' + access_token;
}

function salvarSessao(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
  aplicarToken(s.access_token);
}

export function logout() {
  localStorage.removeItem(LS_KEY);
  SB_HDR.Authorization = 'Bearer ' + SB_KEY; // volta pro anon
  location.reload();
}

export function emailLogado() {
  const s = getSessao();
  return s?.email || null;
}

// Envia o link mágico para o e-mail. Retorna {ok, erro}.
export async function enviarLink(email) {
  const redir = location.origin + location.pathname;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(redir)}`, {
      method: 'POST', headers: authHeaders,
      body: JSON.stringify({ email, create_user: true }),
    });
    if (r.ok) return { ok: true };
    const d = await r.json().catch(() => ({}));
    return { ok: false, erro: d.msg || d.error_description || d.error || `erro ${r.status}` };
  } catch (e) {
    return { ok: false, erro: 'sem conexão' };
  }
}

// Ao voltar do e-mail, os tokens chegam no #hash. Captura, guarda e limpa a URL.
function capturarRetorno() {
  if (!location.hash || !location.hash.includes('access_token')) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  const access_token = p.get('access_token');
  const refresh_token = p.get('refresh_token');
  if (!access_token || !refresh_token) return false;
  const expira = Date.now() + (parseInt(p.get('expires_in') || '3600', 10)) * 1000;
  let email = null;
  try { email = JSON.parse(atob(access_token.split('.')[1])).email; } catch {}
  salvarSessao({ access_token, refresh_token, expira, email });
  history.replaceState(null, '', location.pathname); // tira os tokens da barra de endereço
  return true;
}

async function renovar(refresh_token) {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ refresh_token }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    let email = null;
    try { email = JSON.parse(atob(d.access_token.split('.')[1])).email; } catch {}
    const s = { access_token: d.access_token, refresh_token: d.refresh_token, expira: Date.now() + d.expires_in * 1000, email };
    salvarSessao(s);
    return s;
  } catch { return null; }
}

// Garante uma sessão válida. Renova sozinha se estiver perto de expirar. Retorna true se logado.
export async function garantirSessao() {
  capturarRetorno();
  let s = getSessao();
  if (!s) return false;
  if (Date.now() > s.expira - 60000) {       // faltando < 60s, renova
    s = await renovar(s.refresh_token);
    if (!s) { localStorage.removeItem(LS_KEY); return false; }
  } else {
    aplicarToken(s.access_token);
  }
  return true;
}

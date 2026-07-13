// ui-razao.js — UI do livro-razão no Painel: selo de saldo auditável + importar OFX do C6
// + sincronizar o saldo do app com o banco (via razão), SÓ depois do import (razão fresco).
import { previewImport, aplicarImport, saldosDerivados } from './ofx-import.js';
import { fmtV, saldos, atualizarPillsSaldo } from './calculo.js';
import { sbPatch } from './dados.js';

const round2 = (v) => Math.round(v * 100) / 100;

// Selo (informativo): saldo do razão (= banco no último extrato importado) vs saldo do app.
export async function renderRazaoBadge() {
  const el = document.getElementById('razaoBadge');
  if (!el) return;
  try {
    const s = await saldosDerivados();
    let temDif = false;
    const linha = (nome, der, app) => {
      const bate = der != null && Math.abs(der - (app || 0)) < 0.01;
      if (der != null && !bate) temDif = true;
      const cor = bate ? 'var(--green)' : 'var(--amber)';
      const marca = der == null ? '—' : bate ? '✓' : '≠';
      const info = der != null && !bate ? ` <span style="color:var(--text3)">(app ${fmtV(app || 0)})</span>` : '';
      return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">
        <span style="color:var(--text2)">${nome} (razão)</span>
        <span><b>${der == null ? '—' : fmtV(der)}</b> <span style="color:${cor}">${marca}</span>${info}</span>
      </div>`;
    };
    el.innerHTML = linha('LLG', s.llg, saldos.llg) + linha('Pessoal', s.pessoal, saldos.pessoal) +
      (temDif
        ? `<div style="font-size:11px;color:var(--amber);margin-top:4px">⚠ Importe o extrato do C6 abaixo pra atualizar o razão e sincronizar o saldo.</div>`
        : `<div style="font-size:11px;color:var(--green);margin-top:4px">✓ saldo do app bate com o banco</div>`);
  } catch (e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3)">Razão indisponível (faça login para ler os lançamentos).</div>';
  }
}

// Depois do import o razão está fresco (= banco). Mostra a comparação e (se difere) o botão sincronizar.
async function mostrarReconciliacao(res) {
  let s;
  try { s = await saldosDerivados(); } catch { return; }
  const dif = (c) => s[c] != null ? round2(s[c] - (saldos[c] || 0)) : 0;
  const bate = Math.abs(dif('llg')) < 0.01 && Math.abs(dif('pessoal')) < 0.01;
  const linha = (nome, c) => s[c] == null ? '' :
    `<div style="display:flex;justify-content:space-between;font-size:12px;padding:1px 0">
      <span>${nome}: banco <b>${fmtV(s[c])}</b> · app ${fmtV(saldos[c] || 0)}</span>
      <span style="color:${Math.abs(dif(c)) < 0.01 ? 'var(--green)' : 'var(--amber)'}">${Math.abs(dif(c)) < 0.01 ? '✓' : fmtV(dif(c))}</span>
    </div>`;
  const inner = linha('LLG', 'llg') + linha('Pessoal', 'pessoal') + (bate
    ? `<div style="font-size:12px;color:var(--green);margin-top:6px">✓ Saldo do app já bate com o banco.</div>`
    : `<button id="btnSincSaldo" style="width:100%;margin-top:8px;padding:9px;background:var(--blue);color:#fff;border:none;border-radius:var(--rs);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">🔄 Sincronizar saldo com o banco</button>`);
  res.insertAdjacentHTML('beforeend', `<div id="reconcBox" style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">${inner}</div>`);
  const btn = document.getElementById('btnSincSaldo');
  if (btn) btn.onclick = sincronizarSaldos;
}

// Ajusta o saldo do app (tabela saldos) para o saldo do razão (= banco).
async function sincronizarSaldos() {
  const btn = document.getElementById('btnSincSaldo');
  if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando...'; }
  try {
    const s = await saldosDerivados();
    for (const conta of ['llg', 'pessoal']) {
      if (s[conta] == null) continue;
      saldos[conta] = round2(s[conta]);
      await sbPatch('saldos', `id=eq.${conta}`, { valor: saldos[conta] });
    }
    atualizarPillsSaldo();
    await renderRazaoBadge();
    const box = document.getElementById('reconcBox');
    if (box) box.innerHTML = '<div style="font-size:12px;color:var(--green)">✅ Saldo sincronizado com o banco!</div>';
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Sincronizar saldo com o banco'; }
  }
}

// Liga o seletor de arquivo OFX ao fluxo: preview -> confirmar -> importar -> reconciliar.
export function wireOfxImport() {
  const inp = document.getElementById('ofxInput');
  const res = document.getElementById('ofxResultado');
  if (!inp || inp._wired) return;
  inp._wired = true;
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    res.innerHTML = '<span style="color:var(--text3)">Lendo o extrato...</span>';
    let prev;
    try {
      prev = await previewImport(await f.text());
    } catch (e) {
      res.innerHTML = '<span style="color:var(--red)">Não consegui ler o arquivo OFX.</span>';
      inp.value = ''; return;
    }
    inp.value = '';
    if (prev.erro) { res.innerHTML = `<span style="color:var(--red)">${prev.erro}</span>`; return; }
    if (!prev.novos.length) {
      res.innerHTML = `<div style="font-size:12px">Conta <b>${prev.conta.toUpperCase()}</b>: ${prev.totalNoArquivo} transações — <b>todas já no razão</b>. ✅</div>`;
      await renderRazaoBadge();
      await mostrarReconciliacao(res); // razão já fresco: dá pra sincronizar mesmo sem novos
      return;
    }
    res.innerHTML = `
      <div style="font-size:12px;margin-bottom:6px">Conta <b>${prev.conta.toUpperCase()}</b> · ${prev.de} a ${prev.ate}<br>
      <b>${prev.novos.length}</b> lançamentos novos (${prev.duplicados} já existiam) · soma ${fmtV(prev.somaNovos)}</div>
      <button id="ofxConfirmar" style="width:100%;padding:9px;background:var(--blue);color:#fff;border:none;border-radius:var(--rs);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Importar ${prev.novos.length} lançamentos</button>`;
    document.getElementById('ofxConfirmar').onclick = async () => {
      res.innerHTML = '<span style="color:var(--text3)">Importando...</span>';
      try {
        const r = await aplicarImport(prev);
        res.innerHTML = `<div style="color:var(--green);font-size:12px">✅ ${r.inseridos} lançamentos importados! Razão atualizado.</div>`;
        await renderRazaoBadge();
        await mostrarReconciliacao(res);
      } catch (e) {
        res.innerHTML = `<span style="color:var(--red)">❌ ${e.message}</span>`;
      }
    };
  };
}

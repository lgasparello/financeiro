// ui-razao.js — cartão "Conferir saldo com o banco" no Painel.
// O extrato do C6 NÃO traz o saldo; então o saldo vem do que você lê na tela do C6.
// Isto SUBSTITUI o saldo (não soma) — impossível duplicar com o lançamento manual.
import { fmtV, saldos, atualizarPillsSaldo } from './calculo.js';
import { sbPatch } from './dados.js';

const round2 = (v) => Math.round(v * 100) / 100;

export function renderSaldoBanco() {
  const el = document.getElementById('razaoBadge');
  if (!el) return;
  const campo = (id, v) => `<input id="${id}" type="number" step="0.01" inputmode="decimal" value="${(v || 0).toFixed(2)}" style="flex:1;padding:8px 10px;border-radius:var(--rs);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:14px;font-family:inherit">`;
  el.innerHTML = `
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px">Abra o app do C6, veja os 2 saldos na tela inicial e confirme aqui. Isto <b>substitui</b> o saldo (não soma) — nunca duplica.</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><label style="font-size:13px;width:64px;color:var(--blue)">LLG</label>${campo('saldoBancoLLG', saldos.llg)}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><label style="font-size:13px;width:64px;color:var(--green)">Pessoal</label>${campo('saldoBancoPes', saldos.pessoal)}</div>
    <button id="btnSalvarSaldo" style="width:100%;padding:10px;background:var(--blue);color:#fff;border:none;border-radius:var(--rs);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">💾 Salvar saldo do banco</button>
    <div id="saldoBancoMsg" style="font-size:12px;margin-top:8px;text-align:center"></div>`;
  document.getElementById('btnSalvarSaldo').onclick = salvarSaldoBanco;
}

async function salvarSaldoBanco() {
  const msg = document.getElementById('saldoBancoMsg');
  const llg = parseFloat(document.getElementById('saldoBancoLLG').value);
  const pes = parseFloat(document.getElementById('saldoBancoPes').value);
  if (isNaN(llg) || isNaN(pes)) { msg.innerHTML = '<span style="color:var(--red)">Preencha os dois saldos.</span>'; return; }
  const btn = document.getElementById('btnSalvarSaldo');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    saldos.llg = round2(llg);
    saldos.pessoal = round2(pes);
    await sbPatch('saldos', 'id=eq.llg', { valor: saldos.llg });
    await sbPatch('saldos', 'id=eq.pessoal', { valor: saldos.pessoal });
    atualizarPillsSaldo();
    msg.innerHTML = `<span style="color:var(--green)">✅ Saldo atualizado — LLG ${fmtV(saldos.llg)} · Pessoal ${fmtV(saldos.pessoal)}</span>`;
  } catch (e) {
    msg.innerHTML = '<span style="color:var(--red)">Erro ao salvar. Tente de novo.</span>';
  }
  btn.disabled = false; btn.textContent = '💾 Salvar saldo do banco';
}

// ui-das.js — card do DAS (Simples Nacional) no Painel.
import { dasDoMes } from './das.js';
import { fmtV } from './calculo.js';
import { mesPainel, hoje } from './estado.js';
import { MESES_PT } from './config.js';

export async function renderDAS() {
  const el = document.getElementById('dasCard');
  if (!el) return;
  const ms = `${mesPainel.y}-${String(mesPainel.m + 1).padStart(2, '0')}`;
  el.innerHTML = '<div style="font-size:12px;color:var(--text3)">calculando DAS...</div>';
  try {
    const d = await dasDoMes(ms);
    const hojeD = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const dias = Math.round((d.venc - hojeD) / 86400000);
    const venc = `${String(d.venc.getDate()).padStart(2, '0')}/${String(d.venc.getMonth() + 1).padStart(2, '0')}/${d.venc.getFullYear()}`;
    let aviso, cor;
    if (dias < 0) { aviso = `venceu há ${-dias} dia(s)`; cor = 'var(--red)'; }
    else if (dias === 0) { aviso = '🔴 vence HOJE'; cor = 'var(--red)'; }
    else if (dias <= 5) { aviso = `⏰ vence em ${dias} dia(s)`; cor = 'var(--amber)'; }
    else { aviso = `vence em ${dias} dias`; cor = 'var(--text3)'; }
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div class="mc-lbl">DAS estimado — ${MESES_PT[mesPainel.m]}/${mesPainel.y}</div>
        <div style="font-size:11px;color:var(--text3)">Anexo ${d.anexo} · faixa ${d.faixa}</div>
      </div>
      <div class="mc-val" style="color:var(--red)">${fmtV(d.das)}</div>
      <div style="font-size:11px;color:${cor};margin-top:2px;font-weight:500">Vence ${venc} — ${aviso}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">
        Receita ${fmtV(d.receitaMes)} × alíquota efetiva <b>${(d.efetiva * 100).toFixed(2)}%</b><br>
        RBT12 (12 meses): ${fmtV(d.rbt12)}
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:6px;font-style:italic">Estimativa (regime de competência). Confirme com seu contador.</div>`;
  } catch (e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3)">DAS indisponível (faça login para ler as receitas).</div>';
  }
}

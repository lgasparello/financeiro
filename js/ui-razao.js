// ui-razao.js — UI do livro-razão no Painel: selo de saldo auditável + importar OFX do C6.
import { previewImport, aplicarImport, saldosDerivados } from './ofx-import.js';
import { fmtV, saldos } from './calculo.js';

// Selo: mostra o saldo derivado do razão e se bate com o número que o app usa.
export async function renderRazaoBadge() {
  const el = document.getElementById('razaoBadge');
  if (!el) return;
  try {
    const s = await saldosDerivados();
    const linha = (nome, der, app) => {
      const bate = der != null && Math.abs(der - (app || 0)) < 0.01;
      const cor = bate ? 'var(--green)' : 'var(--amber)';
      const marca = der == null ? '—' : bate ? '✓' : '≠';
      return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0">
        <span style="color:var(--text2)">${nome}</span>
        <span><b>${der == null ? '—' : fmtV(der)}</b> <span style="color:${cor}">${marca}</span></span>
      </div>`;
    };
    el.innerHTML = linha('LLG', s.llg, saldos.llg) + linha('Pessoal', s.pessoal, saldos.pessoal) +
      `<div style="font-size:11px;color:var(--text3);margin-top:4px">✓ = razão bate com o saldo do app</div>`;
  } catch (e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3)">Razão indisponível (faça login para ler os lançamentos).</div>';
  }
}

// Liga o seletor de arquivo OFX ao fluxo de preview -> confirmar -> importar.
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
      const texto = await f.text();
      prev = await previewImport(texto);
    } catch (e) {
      res.innerHTML = '<span style="color:var(--red)">Não consegui ler o arquivo OFX.</span>';
      inp.value = ''; return;
    }
    inp.value = '';
    if (prev.erro) { res.innerHTML = `<span style="color:var(--red)">${prev.erro}</span>`; return; }
    if (!prev.novos.length) {
      res.innerHTML = `Conta <b>${prev.conta.toUpperCase()}</b>: ${prev.totalNoArquivo} transações — <b>todas já estão no razão</b>. Nada novo pra importar. ✅`;
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
        res.innerHTML = `<span style="color:var(--green)">✅ ${r.inseridos} lançamentos importados! O saldo do razão foi atualizado.</span>`;
        await renderRazaoBadge();
      } catch (e) {
        res.innerHTML = `<span style="color:var(--red)">❌ ${e.message}</span>`;
      }
    };
  };
}

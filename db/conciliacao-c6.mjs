// Conciliação C6 — bate as transações reais do banco (OFX) contra os registros do app.
// Uso: node db/conciliacao-c6.mjs <ofx_llg> <ofx_pessoal>
// Só leitura (app via anon key + arquivos OFX locais). Não escreve nada.
import { SB_URL, SB_HDR } from '../js/config.js';

const [ofxLLG, ofxPes] = process.argv.slice(2);
if (!ofxLLG || !ofxPes) { console.error('uso: node db/conciliacao-c6.mjs <ofx_llg> <ofx_pessoal>'); process.exit(1); }

import { readFileSync } from 'fs';
const fmt = (v) => 'R$' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (v) => Math.round(v * 100) / 100;
const parseData = (s) => { if (!s) return null; let m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2]}-${m[1]}`; m = String(s).match(/^(\d{4}-?\d{2}-?\d{2})/); return m ? m[1].replace(/-/g,'').replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3') : null; };
const dias = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

// --- Parser OFX (SGML simples) ---
function parseOFX(path) {
  const txt = readFileSync(path, 'utf8');
  const out = [];
  for (const blk of txt.split('<STMTTRN>').slice(1)) {
    const g = (tag) => { const m = blk.match(new RegExp(`<${tag}>([^<\\r\\n]*)`)); return m ? m[1].trim() : null; };
    const dt = g('DTPOSTED'); const amt = g('TRNAMT');
    if (!dt || amt == null) continue;
    const data = `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;
    out.push({ data, valor: round2(parseFloat(amt)), memo: (g('MEMO') || '').slice(0, 40), used: false });
  }
  return out;
}

async function get(t, q) { const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { headers: SB_HDR }); const x = await r.text(); return x ? JSON.parse(x) : []; }

const [contas, pagamentos, gastos, retiradas, receitas] = await Promise.all([
  get('contas_fixas', 'select=id,tipo,valor'),
  get('pagamentos_mes', 'select=*&pago=eq.true'),
  get('gastos', 'select=*'),
  get('retiradas', 'select=*&enviado=eq.true'),
  get('receitas', 'select=*'),
]);
const tipoDe = Object.fromEntries(contas.map((c) => [c.id, c.tipo]));

// Movimentos que o APP acha que tocaram cada conta (valor assinado)
const app = { llg: [], pessoal: [] };
for (const p of pagamentos) { if (p.forma === 'crt') continue; const t = tipoDe[p.conta_id]; if (!t) continue; const conta = t === 'empresa' ? 'llg' : 'pessoal'; app[conta].push({ data: parseData(p.data_pagamento) || `${p.mes}-01`, valor: -round2(p.valor_pago ?? contas.find(c=>c.id===p.conta_id)?.valor ?? 0), desc: `pgto conta ${p.conta_id}` }); }
for (const g of gastos) { const conta = g.conta === 'empresa' ? 'llg' : 'pessoal'; app[conta].push({ data: parseData(g.data_lancamento) || `${g.mes}-01`, valor: -round2(Number(g.valor||0)), desc: `gasto ${g.descricao||''}` }); }
for (const r of retiradas) { const d = parseData(r.data_envio) || `${r.mes}-01`; const v = round2(Number(r.valor||0)); app.llg.push({ data: d, valor: -v, desc: `retirada ${r.componente}` }); app.pessoal.push({ data: d, valor: v, desc: `retirada ${r.componente}` }); }
for (const rc of receitas) { if (rc.recebido === false) continue; app.llg.push({ data: parseData(rc.data_recebimento) || `${rc.mes}-01`, valor: round2(Number(rc.valor||0)), desc: `receita ${rc.cliente||''}` }); }

const banco = { llg: parseOFX(ofxLLG), pessoal: parseOFX(ofxPes) };
const JANELA = 6; // dias de tolerância na data

function conciliar(conta) {
  const B = banco[conta]; const A = app[conta];
  // index banco por valor (centavos)
  const porValor = new Map();
  for (const b of B) { const k = b.valor.toFixed(2); (porValor.get(k) || porValor.set(k, []).get(k)).push(b); }
  let casados = 0, valCasado = 0;
  const appSemBanco = [];
  for (const a of A) {
    const cand = (porValor.get(a.valor.toFixed(2)) || []).filter((b) => !b.used);
    let best = null, bestD = 1e9;
    for (const b of cand) { const d = dias(a.data, b.data); if (d <= JANELA && d < bestD) { best = b; bestD = d; } }
    if (best) { best.used = true; casados++; valCasado += Math.abs(a.valor); } else appSemBanco.push(a);
  }
  const bancoSemApp = B.filter((b) => !b.used);
  return { B, A, casados, valCasado, appSemBanco, bancoSemApp };
}

console.log('=== CONCILIAÇÃO C6 × APP (12 meses) ===  janela de data: ±' + JANELA + ' dias\n');
for (const conta of ['llg', 'pessoal']) {
  const r = conciliar(conta);
  const bSemAppVal = round2(r.bancoSemApp.reduce((s, b) => s + Math.abs(b.valor), 0));
  const aSemBancoVal = round2(r.appSemBanco.reduce((s, a) => s + Math.abs(a.valor), 0));
  console.log(`######## ${conta.toUpperCase()} ########`);
  console.log(`  transações no banco: ${r.B.length} | registros no app: ${r.A.length}`);
  console.log(`  ✅ casados: ${r.casados}  (${fmt(r.valCasado)})`);
  console.log(`  🟠 no BANCO mas SEM registro no app: ${r.bancoSemApp.length}  (${fmt(bSemAppVal)})  <- movimento real que o app não vê`);
  console.log(`  🔴 no APP mas SEM correspondente no banco: ${r.appSemBanco.length}  (${fmt(aSemBancoVal)})  <- app acha que mexeu e o banco não mostra`);
  // maiores itens sem app (top 8 por valor)
  const top = r.bancoSemApp.slice().sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)).slice(0, 8);
  if (top.length) { console.log('    maiores movimentos do banco fora do app:'); for (const b of top) console.log(`      ${b.data}  ${fmt(b.valor).padStart(14)}  ${b.memo}`); }
  const topA = r.appSemBanco.slice().sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)).slice(0, 6);
  if (topA.length) { console.log('    registros do app sem par no banco:'); for (const a of topA) console.log(`      ${a.data}  ${fmt(a.valor).padStart(14)}  ${a.desc}`); }
  console.log('');
}
console.log('Leitura: 🟠 alto no pessoal é normal (nem todo gasto é lançado no app). 🔴 é o que merece olhar — pode ser lançamento errado/duplicado ou pagamento por cartão.');

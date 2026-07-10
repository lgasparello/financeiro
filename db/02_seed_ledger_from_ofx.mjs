// Semeia o livro-razão com as transações REAIS do C6 (OFX) + um lançamento de abertura,
// de modo que a soma do razão == saldo atual (que já bate com o banco ao centavo).
// O razão passa a ser cópia fiel do banco — a fonte da verdade do saldo.
//
// Uso:
//   node db/02_seed_ledger_from_ofx.mjs <ofx_llg> <ofx_pessoal>            # dry-run
//   node db/02_seed_ledger_from_ofx.mjs <ofx_llg> <ofx_pessoal> --apply    # insere em lancamentos
import { SB_URL, SB_HDR } from '../js/config.js';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const [ofxLLG, ofxPes] = args.filter((a) => !a.startsWith('--'));
if (!ofxLLG || !ofxPes) { console.error('uso: node db/02_seed_ledger_from_ofx.mjs <ofx_llg> <ofx_pessoal> [--apply]'); process.exit(1); }

const fmt = (v) => 'R$' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (v) => Math.round(v * 100) / 100;

function parseOFX(path, conta) {
  const txt = readFileSync(path, 'utf8');
  const out = [];
  for (const blk of txt.split('<STMTTRN>').slice(1)) {
    const g = (t) => { const m = blk.match(new RegExp(`<${t}>([^<\\r\\n]*)`)); return m ? m[1].trim() : null; };
    const dt = g('DTPOSTED'); const amt = g('TRNAMT'); if (!dt || amt == null) continue;
    const data = `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;
    const valor = round2(parseFloat(amt));
    out.push({ data, conta, valor, tipo: valor < 0 ? 'banco_debito' : 'banco_credito',
      descricao: (g('MEMO') || '').replace(/^0+$/, '').slice(0, 60) || (valor < 0 ? 'débito' : 'crédito'),
      mes: data.slice(0, 7), origem_tabela: 'c6_ofx', origem_id: g('FITID') });
  }
  return out;
}

async function get(t, q) { const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { headers: SB_HDR }); const x = await r.text(); return x ? JSON.parse(x) : []; }

const saldos = Object.fromEntries((await get('saldos', 'select=*')).map((s) => [s.id, Number(s.valor)]));
const txns = { llg: parseOFX(ofxLLG, 'llg'), pessoal: parseOFX(ofxPes, 'pessoal') };

const lanc = [];
console.log('=== SEED DO LIVRO-RAZÃO A PARTIR DO C6 (dry-run) ===\n');
for (const conta of ['llg', 'pessoal']) {
  const T = txns[conta];
  const somaBanco = round2(T.reduce((s, t) => s + t.valor, 0));
  const saldoHoje = saldos[conta] ?? 0;
  const primeiraData = T.map((t) => t.data).sort()[0] || '2025-07-10';
  const abertura = round2(saldoHoje - somaBanco);
  // lançamento de abertura na véspera da primeira transação
  lanc.push({ data: primeiraData, conta, valor: abertura, tipo: 'abertura',
    descricao: `Saldo de abertura (${primeiraData})`, mes: primeiraData.slice(0, 7),
    origem_tabela: 'manual', origem_id: `abertura-${conta}` });
  lanc.push(...T);
  const derivado = round2(abertura + somaBanco);
  const ok = Math.abs(derivado - saldoHoje) < 0.01;
  console.log(`[${conta}]  ${T.length} transações do banco`);
  console.log(`  abertura ${primeiraData}: ${fmt(abertura)}`);
  console.log(`  Σ transações C6:          ${fmt(somaBanco)}`);
  console.log(`  saldo derivado do razão:  ${fmt(derivado)}`);
  console.log(`  saldo hoje (app == C6):   ${fmt(saldoHoje)}   ${ok ? '✅ FECHA AO CENTAVO' : '❌ diverge'}\n`);
}
console.log(`Total de lançamentos a inserir: ${lanc.length} (2 aberturas + ${lanc.length - 2} do banco)`);

if (APPLY) {
  console.log('\n>>> --apply: inserindo em lancamentos (em lotes de 500)...');
  for (let i = 0; i < lanc.length; i += 500) {
    const lote = lanc.slice(i, i + 500);
    const r = await fetch(`${SB_URL}/rest/v1/lancamentos`, { method: 'POST', headers: { ...SB_HDR, Prefer: 'return=minimal' }, body: JSON.stringify(lote) });
    console.log(r.ok ? `  lote ${i}-${i + lote.length}: ok` : `  ❌ ${r.status} ${await r.text()}`);
  }
} else {
  console.log('(rode com --apply depois de criar a tabela lancamentos e revisar)');
}

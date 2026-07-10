// Migração para o livro-razão — DRY-RUN por padrão (não escreve nada).
// Lê os dados atuais (via anon key), reconstrói o razão histórico e calcula o
// "lançamento de abertura" por conta, de modo que a soma do razão == saldo atual.
//
// Uso:
//   node db/migracao-livro-razao.mjs            # só relatório, não escreve
//   node db/migracao-livro-razao.mjs --apply    # insere de verdade (rode com cautela)
//
// Regras de sinal: valor < 0 = saída (débito), valor > 0 = entrada (crédito).
import { SB_URL, SB_HDR } from '../js/config.js';

const APPLY = process.argv.includes('--apply');

async function get(t, q = 'select=*') {
  const r = await fetch(`${SB_URL}/rest/v1/${t}?${q}`, { headers: SB_HDR });
  const tx = await r.text();
  return tx ? JSON.parse(tx) : [];
}

// 'DD/MM/YYYY' | 'YYYY-MM-DD...' -> 'YYYY-MM-DD' | null
function parseData(s) {
  if (!s || typeof s !== 'string') return null;
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return null;
}
const fmt = (v) => 'R$' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (v) => Math.round(v * 100) / 100;

const [contas, pagamentos, gastos, retiradas, receitas, saldos] = await Promise.all([
  get('contas_fixas', 'select=id,tipo,valor'),
  get('pagamentos_mes', 'select=*&pago=eq.true'),
  get('gastos', 'select=*'),
  get('retiradas', 'select=*&enviado=eq.true'),
  get('receitas', 'select=*'),
  get('saldos', 'select=*'),
]);
const contaTipo = Object.fromEntries(contas.map((c) => [c.id, c.tipo]));
const saldoAtual = Object.fromEntries(saldos.map((s) => [s.id, Number(s.valor)]));

const lanc = [];
const push = (data, conta, valor, tipo, descricao, origem_tabela, origem_id, mes) =>
  lanc.push({ data, conta, valor: round2(valor), tipo, descricao, mes, origem_tabela, origem_id: String(origem_id) });

// 1) Pagamentos de contas fixas (exclui cartão — cartão não toca o saldo em caixa)
for (const p of pagamentos) {
  if (p.forma === 'crt') continue;
  const tipo = contaTipo[p.conta_id];
  if (!tipo) continue; // conta órfã
  const conta = tipo === 'empresa' ? 'llg' : 'pessoal';
  const valor = -(p.valor_pago ?? contas.find((c) => c.id === p.conta_id)?.valor ?? 0);
  push(parseData(p.data_pagamento) || `${p.mes}-01`, conta, valor, 'pagamento', `Pagamento conta ${p.conta_id}`, 'pagamentos_mes', p.id, p.mes);
}
// 2) Gastos variáveis (débito na conta correspondente)
for (const g of gastos) {
  const conta = g.conta === 'empresa' ? 'llg' : 'pessoal';
  push(parseData(g.data_lancamento) || `${g.mes}-01`, conta, -Number(g.valor || 0), 'gasto', g.descricao || 'Gasto', 'gastos', g.id, g.mes);
}
// 3) Retiradas enviadas: sai da LLG, entra no pessoal (dois lançamentos)
for (const r of retiradas) {
  const d = parseData(r.data_envio) || `${r.mes}-01`;
  const v = Number(r.valor || 0);
  push(d, 'llg', -v, 'retirada_saida', `Retirada ${r.componente}`, 'retiradas', r.id, r.mes);
  push(d, 'pessoal', v, 'retirada_entrada', `Retirada ${r.componente}`, 'retiradas', r.id, r.mes);
}
// 4) Receitas recebidas: entram na LLG
for (const rc of receitas) {
  if (rc.recebido === false) continue; // prevista não tocou o saldo
  push(parseData(rc.data_recebimento) || `${rc.mes}-01`, 'llg', Number(rc.valor || 0), 'receita', `Receita ${rc.cliente || ''}`.trim(), 'receitas', rc.id, rc.mes);
}

// Soma dos movimentos por conta
const soma = { llg: 0, pessoal: 0 };
for (const l of lanc) soma[l.conta] = round2(soma[l.conta] + l.valor);

// Lançamento de ABERTURA para casar com o saldo atual: abertura = saldo - movimentos
const hoje = new Date().toISOString().slice(0, 10);
const abertura = {};
for (const conta of ['llg', 'pessoal']) {
  abertura[conta] = round2((saldoAtual[conta] ?? 0) - soma[conta]);
}

console.log('=== LIVRO-RAZÃO — DRY RUN (nada foi escrito) ===\n');
console.log(`Movimentos históricos reconstruídos: ${lanc.length}`);
console.log(`  pagamentos(não-cartão): ${lanc.filter(l=>l.tipo==='pagamento').length} | gastos: ${lanc.filter(l=>l.tipo==='gasto').length} | retiradas: ${retiradas.length}x2 | receitas: ${lanc.filter(l=>l.tipo==='receita').length}\n`);
for (const conta of ['llg', 'pessoal']) {
  const derivado = round2(soma[conta] + abertura[conta]);
  const ok = Math.abs(derivado - (saldoAtual[conta] ?? 0)) < 0.01;
  console.log(`[${conta}]`);
  console.log(`  saldo atual (tabela saldos):     ${fmt(saldoAtual[conta] ?? 0)}`);
  console.log(`  Σ movimentos reconstruídos:      ${fmt(soma[conta])}`);
  console.log(`  → lançamento de ABERTURA sugerido: ${fmt(abertura[conta])}`);
  console.log(`  saldo derivado (mov + abertura): ${fmt(derivado)}  ${ok ? '✅ bate' : '❌ diverge'}\n`);
}
console.log('Nota: a abertura absorve o histórico anterior aos registros (e ajustes manuais/cartão).');
console.log('O extrato C6 (OFX) é o que vai ANCORAR essa abertura no valor real do banco.');

if (APPLY) {
  const abreLanc = ['llg', 'pessoal'].map((conta) => ({
    data: hoje, conta, valor: abertura[conta], tipo: 'abertura',
    descricao: 'Saldo de abertura (migração)', mes: hoje.slice(0, 7),
    origem_tabela: 'manual', origem_id: `abertura-${conta}`,
  }));
  const todos = [...abreLanc, ...lanc];
  console.log(`\n>>> --apply: inserindo ${todos.length} lançamentos...`);
  const r = await fetch(`${SB_URL}/rest/v1/lancamentos`, {
    method: 'POST', headers: { ...SB_HDR, Prefer: 'return=minimal' }, body: JSON.stringify(todos),
  });
  console.log(r.ok ? '✅ inserido.' : `❌ falhou: ${r.status} ${await r.text()}`);
} else {
  console.log('\n(rode com --apply para inserir de verdade — só depois de você revisar)');
}

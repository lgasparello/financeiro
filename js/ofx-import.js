// ofx-import.js — importa um extrato OFX do C6 para o livro-razão (tabela lancamentos).
// Detecta a conta pelo ACCTID, evita duplicar (dedup por FITID) e insere só o que é novo.
// Assim o saldo derivado (view saldos_derivados) fica sempre igual ao banco.
import { sbGet, toast } from './dados.js';
import { SB_URL, SB_HDR } from './config.js';

// ACCTID do C6 -> conta interna do app
const CONTA_POR_ACCTID = { '344641813': 'llg', '179966227': 'pessoal' };

const round2 = (v) => Math.round(v * 100) / 100;

// Extrai ACCTID e a lista de transações de um texto OFX (SGML).
export function parseOFX(texto) {
  const acctMatch = texto.match(/<ACCTID>([^<\r\n]*)/);
  const acctid = acctMatch ? acctMatch[1].trim() : null;
  const conta = CONTA_POR_ACCTID[acctid] || null;
  const txns = [];
  for (const blk of texto.split('<STMTTRN>').slice(1)) {
    const g = (t) => { const m = blk.match(new RegExp(`<${t}>([^<\\r\\n]*)`)); return m ? m[1].trim() : null; };
    const dt = g('DTPOSTED'); const amt = g('TRNAMT'); const fitid = g('FITID');
    if (!dt || amt == null || !fitid) continue;
    const data = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const valor = round2(parseFloat(amt));
    txns.push({
      data, valor, fitid,
      tipo: valor < 0 ? 'banco_debito' : 'banco_credito',
      descricao: (g('MEMO') || '').replace(/^0+$/, '').slice(0, 60) || (valor < 0 ? 'débito' : 'crédito'),
      mes: data.slice(0, 7),
    });
  }
  return { acctid, conta, txns };
}

// Analisa um OFX contra o que já existe no razão (sem gravar). Retorna o "preview".
export async function previewImport(texto) {
  const { acctid, conta, txns } = parseOFX(texto);
  if (!conta) return { erro: `Conta não reconhecida (ACCTID ${acctid || '?'}). Esperado C6 LLG ou pessoal.` };
  // FITIDs já gravados dessa origem
  const existentes = await sbGet('lancamentos', 'select=origem_id&origem_tabela=eq.c6_ofx');
  const jaTem = new Set((Array.isArray(existentes) ? existentes : []).map((r) => String(r.origem_id)));
  const novos = txns.filter((t) => !jaTem.has(t.fitid));
  const periodo = txns.map((t) => t.data).sort();
  return {
    conta, acctid,
    totalNoArquivo: txns.length,
    novos,
    duplicados: txns.length - novos.length,
    somaNovos: round2(novos.reduce((s, t) => s + t.valor, 0)),
    de: periodo[0], ate: periodo[periodo.length - 1],
  };
}

// Grava os lançamentos novos no razão. Recebe o preview já calculado.
export async function aplicarImport(preview) {
  if (!preview?.novos?.length) return { inseridos: 0 };
  const linhas = preview.novos.map((t) => ({
    data: t.data, conta: preview.conta, valor: t.valor, tipo: t.tipo,
    descricao: t.descricao, mes: t.mes, origem_tabela: 'c6_ofx', origem_id: t.fitid,
  }));
  let inseridos = 0;
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    const r = await fetch(`${SB_URL}/rest/v1/lancamentos`, {
      method: 'POST', headers: { ...SB_HDR, Prefer: 'return=minimal' }, body: JSON.stringify(lote),
    });
    if (!r.ok) throw new Error(`falha ao inserir (${r.status}): ${await r.text()}`);
    inseridos += lote.length;
  }
  return { inseridos };
}

// Saldo atual derivado do razão (a "verdade" que bate com o banco).
export async function saldosDerivados() {
  const d = await sbGet('saldos_derivados', 'select=*');
  const out = { llg: null, pessoal: null };
  if (Array.isArray(d)) d.forEach((r) => { out[r.conta] = Number(r.saldo); });
  return out;
}

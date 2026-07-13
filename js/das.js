// das.js — cálculo do DAS (Simples Nacional) a partir das receitas do app.
// Anexo III (consultoria com Fator-R >= 28%) validado contra a guia real da LLG.
// É uma ESTIMATIVA: bate com a guia quando a receita lançada = receita declarada.
import { sbGet } from './dados.js';
import { DAS_ANEXO } from './config.js';

// Tabelas do Simples Nacional (vigência 2018+). {ate = teto do RBT12, aliq nominal, ded parcela a deduzir}
export const ANEXOS = {
  III: [
    { ate: 180000,   aliq: 0.060, ded: 0 },
    { ate: 360000,   aliq: 0.112, ded: 9360 },
    { ate: 720000,   aliq: 0.135, ded: 17640 },
    { ate: 1800000,  aliq: 0.160, ded: 35640 },
    { ate: 3600000,  aliq: 0.210, ded: 125640 },
    { ate: 4800000,  aliq: 0.330, ded: 648000 },
  ],
  V: [
    { ate: 180000,   aliq: 0.155, ded: 0 },
    { ate: 360000,   aliq: 0.180, ded: 4500 },
    { ate: 720000,   aliq: 0.195, ded: 9900 },
    { ate: 1800000,  aliq: 0.205, ded: 17100 },
    { ate: 3600000,  aliq: 0.230, ded: 62100 },
    { ate: 4800000,  aliq: 0.305, ded: 540000 },
  ],
};

// Alíquota efetiva a partir do RBT12 (receita bruta dos últimos 12 meses). PURA.
export function aliquotaEfetiva(rbt12, anexo = 'III') {
  const tab = ANEXOS[anexo] || ANEXOS.III;
  const faixa = tab.find(f => rbt12 <= f.ate) || tab[tab.length - 1];
  const idx = tab.indexOf(faixa) + 1;
  const efetiva = rbt12 > 0 ? Math.max(0, (rbt12 * faixa.aliq - faixa.ded) / rbt12) : 0;
  return { efetiva, faixa: idx, nominal: faixa.aliq, ded: faixa.ded };
}

// DAS estimado de um mês. PURA. (das = receita do mês × alíquota efetiva)
export function calcularDAS(rbt12, receitaMes, anexo = 'III') {
  const a = aliquotaEfetiva(rbt12, anexo);
  return { rbt12, receitaMes, anexo, ...a, das: Math.round(receitaMes * a.efetiva * 100) / 100 };
}

// 'YYYY-MM' -> 'YYYY-MM' N meses atrás
function mesMenos(ms, n) {
  const [y, m] = ms.split('-').map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Busca receitas e devolve {rbt12, receitaMes} para o mês de referência (regime de competência).
export async function dadosDAS(ms) {
  const receitas = await sbGet('receitas', 'select=mes,valor');
  const porMes = {};
  if (Array.isArray(receitas)) for (const r of receitas) porMes[r.mes] = (porMes[r.mes] || 0) + Number(r.valor || 0);
  const receitaMes = porMes[ms] || 0;
  let rbt12 = 0;
  for (let i = 1; i <= 12; i++) rbt12 += porMes[mesMenos(ms, i)] || 0;
  return { rbt12: Math.round(rbt12 * 100) / 100, receitaMes };
}

// Vencimento do DAS do período ms: dia 20 do mês seguinte.
export function vencimentoDAS(ms) {
  const [y, m] = ms.split('-').map(Number);
  const d = new Date(y, m, 20); // mês seguinte (m já é 1-based -> new Date(y, m, ...) = mês+1)
  return d;
}

// Cálculo completo do DAS de um mês (busca + calcula). Usa o anexo do config.
export async function dasDoMes(ms, anexo = DAS_ANEXO) {
  const { rbt12, receitaMes } = await dadosDAS(ms);
  return { ...calcularDAS(rbt12, receitaMes, anexo), venc: vencimentoDAS(ms) };
}

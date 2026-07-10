// calculo.js — logica de calculo isolada: helpers puros, calcularMes/getLucroAnterior e saldos.
// Onde possivel as funcoes sao puras (formatadores, contaAtivaNoMes); calcularMes ainda faz I/O.
// Alvo da proxima etapa: auditoria de saldo e conciliacao de extrato C6.
import { SB_URL, SB_HDR, MESES_PT } from './config.js';
import { hoje } from './estado.js';
import { sbGet, carregarContas, contas, componentesRet, setComponentesRet, toast } from './dados.js';

// --- Cache de dados financeiros por mes (privado deste modulo) ---
const dadosFinanceiros={};
export function limparCacheFinanceiro(){ for(const k in dadosFinanceiros) delete dadosFinanceiros[k]; }

// --- Saldos reais (estado compartilhado, mutado in-place) ---
export const saldos={llg:0,pessoal:0};

// --- Helpers puros ---
function mesStr(y,m){return `${y}-${String(m+1).padStart(2,'0')}`;}
function mesLabel(y,m){return `${MESES_PT[m]} ${y}`;}
function diasNoMes(y,m){return new Date(y,m+1,0).getDate();}
function fmtV(v){return 'R$'+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function formaLabel(f){return f==='llg'?'Débito LLG':f==='crt'?'Cartão':'Débito pessoal';}
function formaBadge(f){return f==='llg'?'pb-llg':f==='crt'?'pb-crt':'pb-pes';}
function isHoje(y,m){return y===hoje.getFullYear()&&m===hoje.getMonth();}

function contaAtivaNoMes(c, y, m){
  const mesRef = new Date(y, m);
  if(c.mes_inicio){
    const [iy,im] = c.mes_inicio.split('-').map(Number);
    if(mesRef < new Date(iy, im-1)) return false;
  }
  if(c.mes_fim){
    const [fy,fm] = c.mes_fim.split('-').map(Number);
    if(mesRef > new Date(fy, fm-1)) return false;
  }
  return true;
}

function extrairMesISO(g){
  if(g.data_lancamento && /^\d{2}\/\d{2}\/\d{4}$/.test(g.data_lancamento)){
    const [d,m,y] = g.data_lancamento.split('/');
    return `${y}-${m}`;
  }
  // Fallback: tenta normalizar do campo mes (suja, mas serve)
  if(g.mes){
    const meses = {'Janeiro':'01','Fevereiro':'02','Março':'03','Abril':'04','Maio':'05','Junho':'06','Julho':'07','Agosto':'08','Setembro':'09','Outubro':'10','Novembro':'11','Dezembro':'12'};
    const partes = g.mes.split(' ');
    const mNum = meses[partes[0]];
    const ano = partes[1] || hoje.getFullYear();
    if(mNum) return `${ano}-${mNum}`;
  }
  return null;
}

function labelMesISO(iso){
  if(!iso) return '';
  const [y,m] = iso.split('-');
  return `${MESES_PT[parseInt(m)-1]} ${y}`;
}


// --- Nucleo puro do calculo do mes ---
// Recebe TODOS os dados ja carregados (arrays crus do banco OU do extrato C6) e devolve os totais.
// Sem I/O, sem cache, sem globais: alvo da auditoria de saldo e conciliacao de extrato.
// Parametros:
//   ms            "YYYY-MM" (usado so para separar ano/mes na projecao de CF pendente)
//   receitas      linhas da tabela receitas do mes
//   impostos      linhas de impostos do mes
//   pagamentos    linhas de pagamentos_mes do mes (TODAS; o filtro pago=true e feito aqui)
//   gastos        linhas de gastos do mes
//   retiradas     linhas de retiradas do mes (TODAS; o filtro enviado=true e feito aqui)
//   contas        contas_fixas ativas (para CF empresa pendente)
//   componentesRet componentes_retirada (para retiradas fixas pendentes)
function calcularTotais({ ms, receitas: receitasRaw, impostos: impostosRaw, pagamentos: pagamentosRaw, gastos: gastosRaw, retiradas: retiradasRaw, contas: contasRaw, componentesRet: componentesRaw }){
  const receitas = Array.isArray(receitasRaw) ? receitasRaw : [];
  const impostos = Array.isArray(impostosRaw) ? impostosRaw : [];
  const pagsTodos = Array.isArray(pagamentosRaw) ? pagamentosRaw : [];
  const pagamentos = pagsTodos.filter(p=>p.pago);
  const gastos = Array.isArray(gastosRaw) ? gastosRaw : [];
  const retiradasAll = Array.isArray(retiradasRaw) ? retiradasRaw : [];
  const retiradas = retiradasAll.filter(r=>r.enviado);
  const contas = Array.isArray(contasRaw) ? contasRaw : [];
  const componentesRet = Array.isArray(componentesRaw) ? componentesRaw : [];

  // === REAIS ===
  // Receita real = só as recebidas (recebido=true ou campo ausente)
  const receitasRecebidas = receitas.filter(r => r.recebido !== false);
  const totalReceitaReal = receitasRecebidas.reduce((s,r)=>s+r.valor,0);
  // Receita prevista (não recebida ainda)
  const receitasPrevistas = receitas.filter(r => r.recebido === false);
  const totalReceitaPrev = receitasPrevistas.reduce((s,r)=>s+r.valor,0);

  const totalImpostos = impostos.reduce((s,i)=>s+i.valor,0);
  const totalRetirado = retiradas.reduce((s,r)=>s+r.valor,0);

  // CF empresa pago (operacional real)
  const cfEmpresaReal = pagamentos
    .filter(p=>{ const c=contas.find(x=>x.id===p.conta_id); return c&&c.tipo==='empresa'; })
    .reduce((s,p)=>{ const c=contas.find(x=>x.id===p.conta_id); return s+(p.valor_pago||c?.valor||0); },0);

  // CF retiradas fixas reais (PL+PS+Moto enviadas, exceto lucros)
  const cfRetiradasReal = retiradas
    .filter(r=>r.componente!=='lucros')
    .reduce((s,r)=>s+r.valor,0);

  // CV empresa real
  const cvEmpresa = gastos
    .filter(g=>g.conta==='empresa')
    .reduce((s,g)=>s+g.valor,0);

  // === PROJETADOS (faltam pagar) ===
  // CF empresa ainda não pago: pega contas fixas empresa ativas no mês, exclui as já pagas
  const idsJaPagos = new Set(pagamentos.map(p=>p.conta_id));
  const [py, pm] = ms.split('-').map(Number);
  const cfEmpresaPendente = contas
    .filter(c=>c.tipo==='empresa' && contaAtivaNoMes(c, py, pm-1) && !idsJaPagos.has(c.id))
    .reduce((s,c)=>s+(c.valor||0),0);

  // Retiradas fixas ainda não enviadas (PL+PS+Moto)
  const compEnviados = new Set(retiradas.map(r=>r.componente));
  const cfRetiradasPendente = componentesRet
    .filter(c=>c.chave!=='lucros' && !compEnviados.has(c.chave))
    .filter(c=>{
      // respeita mes_fim do componente (Moto tem fim em jun/26)
      if(c.mes_fim){
        const [fy,fm]=c.mes_fim.split('-').map(Number);
        if(new Date(py,pm-1) > new Date(fy,fm-1)) return false;
      }
      return true;
    })
    .reduce((s,c)=>s+(c.valor||0),0);

  // === TOTAIS ===
  const cfReal = cfEmpresaReal + cfRetiradasReal;
  const cfTotalProjetado = cfReal + cfEmpresaPendente + cfRetiradasPendente;
  const receitaTotalProjetada = totalReceitaReal + totalReceitaPrev;

  // Lucro real: só com o que efetivamente entrou e saiu
  const lucroReal = totalReceitaReal - cfReal - cvEmpresa - totalImpostos;
  // Lucro projetado: o que vai sobrar se tudo previsto se confirmar
  const lucroProjetado = receitaTotalProjetada - cfTotalProjetado - cvEmpresa - totalImpostos;

  const result = {
    receita: totalReceitaReal,
    receitaPrevista: totalReceitaPrev,
    receitaProjetada: receitaTotalProjetada,
    impostos: totalImpostos,
    cf: cfReal,
    cfPendente: cfEmpresaPendente + cfRetiradasPendente,
    cfProjetado: cfTotalProjetado,
    cv: cvEmpresa,
    lucro: lucroReal,
    lucroProjetado: lucroProjetado,
    retirado: totalRetirado,
    receitaItens: receitas,
    impostosItens: impostos
  };
  return result;
}

// --- Calculo do mes (casca: cache + I/O + delega ao nucleo puro calcularTotais) ---
async function calcularMes(ms){
  if(dadosFinanceiros[ms]) return dadosFinanceiros[ms];
  // Garantir que contas estão carregadas
  if(!contas.length) await carregarContas();

  // Componentes de retirada (precisamos pra projetar retiradas fixas não enviadas)
  if(!componentesRet.length){
    const compRaw = await sbGet('componentes_retirada','select=*&ativo=eq.true&order=id');
    setComponentesRet(Array.isArray(compRaw) ? compRaw : []);
  }

  const [recsRaw, impsRaw, pagsTodosRaw, gastosRaw, retiradasRaw] = await Promise.all([
    sbGet('receitas', `select=*&mes=eq.${ms}`),
    sbGet('impostos', `select=*&mes=eq.${ms}`),
    sbGet('pagamentos_mes', `select=*&mes=eq.${ms}`),
    sbGet('gastos', `select=*&mes=eq.${ms}`),
    sbGet('retiradas', `select=*&mes=eq.${ms}`)
  ]);

  const result = calcularTotais({
    ms,
    receitas: recsRaw,
    impostos: impsRaw,
    pagamentos: pagsTodosRaw,
    gastos: gastosRaw,
    retiradas: retiradasRaw,
    contas,
    componentesRet
  });

  console.log(`[${ms}] Receita R:${result.receita} P:${result.receitaPrevista} | CF R:${result.cf} Pend:${result.cfPendente} | CV:${result.cv} | Imp:${result.impostos} | Lucro R:${result.lucro} Proj:${result.lucroProjetado}`);

  dadosFinanceiros[ms] = result;
  return result;
}


async function getLucroAnterior(y, m){
  const mAnterior = new Date(y, m-1);
  const ms = mesStr(mAnterior.getFullYear(), mAnterior.getMonth());
  const dados = await calcularMes(ms);
  // Se o mês ainda tem CF pendente (não fechou), usa projetado.
  // Se está tudo pago, usa real.
  if(dados.cfPendente > 0) return dados.lucroProjetado;
  return dados.lucro;
}

// --- Saldos (persistencia + UI das pills) ---
async function carregarSaldos(){
  try{
    const data = await sbGet('saldos','select=*');
    if(Array.isArray(data)) data.forEach(s=>{saldos[s.id]=s.valor;});
  }catch(e){}
  atualizarPillsSaldo();
}

function atualizarPillsSaldo(){
  const pillLLG = document.getElementById('saldoLLG');
  const pillPes = document.getElementById('saldoPes');
  pillLLG.textContent = `LLG ${fmtV(saldos.llg)}`;
  pillPes.textContent = `Pes. ${fmtV(saldos.pessoal)}`;
  // Cor da pill: vermelho se negativo, normal se positivo
  pillLLG.className = 'pill ' + (saldos.llg < 0 ? 'pill-r' : 'pill-b');
  pillPes.className = 'pill ' + (saldos.pessoal < 0 ? 'pill-r' : 'pill-g');
  // Atualizar painel também
  const painelLLG=document.getElementById('painelLLG');
  const painelPes=document.getElementById('painelPes');
  const painelData=document.getElementById('painelData');
  if(painelLLG){
    painelLLG.textContent=fmtV(saldos.llg);
    painelLLG.style.color = saldos.llg < 0 ? 'var(--red)' : 'var(--blue)';
  }
  if(painelPes){
    painelPes.textContent=fmtV(saldos.pessoal);
    painelPes.style.color = saldos.pessoal < 0 ? 'var(--red)' : 'var(--green)';
  }
  if(painelData) painelData.textContent=hoje.toLocaleDateString('pt-BR');
}

async function abaterSaldo(conta, valor){
  // Permite saldo negativo para alertar de furo de caixa
  saldos[conta] = (saldos[conta]||0) - valor;
  await fetch(`${SB_URL}/rest/v1/saldos?id=eq.${conta}`,{method:'PATCH',headers:{...SB_HDR,'Prefer':'return=representation'},body:JSON.stringify({valor:saldos[conta],updated_at:new Date().toISOString()})});
  atualizarPillsSaldo();
  if(saldos[conta] < 0) toast(`⚠ Saldo ${conta==='llg'?'LLG':'pessoal'} negativo: ${fmtV(saldos[conta])}`, 4000);
}

async function reporSaldo(conta, valor){
  saldos[conta] = (saldos[conta]||0) + valor;
  await fetch(`${SB_URL}/rest/v1/saldos?id=eq.${conta}`,{method:'PATCH',headers:{...SB_HDR,'Prefer':'return=representation'},body:JSON.stringify({valor:saldos[conta],updated_at:new Date().toISOString()})});
  atualizarPillsSaldo();
}

async function ajustarSaldo(conta){
  const atual = saldos[conta]||0;
  const novo = prompt(`Saldo atual: ${fmtV(atual)}\nNovo saldo:`, atual.toFixed(2));
  if(novo===null||isNaN(parseFloat(novo)))return;
  saldos[conta] = parseFloat(novo);
  await fetch(`${SB_URL}/rest/v1/saldos?id=eq.${conta}`,{method:'PATCH',headers:{...SB_HDR,'Prefer':'return=representation'},body:JSON.stringify({valor:saldos[conta],updated_at:new Date().toISOString()})});
  atualizarPillsSaldo();
  toast('Saldo atualizado!');
}
// GRÁFICOS

export { calcularTotais, mesStr, mesLabel, diasNoMes, fmtV, formaLabel, formaBadge, isHoje, contaAtivaNoMes, extrairMesISO, labelMesISO, calcularMes, getLucroAnterior, carregarSaldos, atualizarPillsSaldo, abaterSaldo, reporSaldo, ajustarSaldo };

// ui-painel.js — aba Painel: saldos reais, resumo mensal empresa/pessoal e acumulado do ano.
import { MESES_PT } from './config.js';
import { hoje, mesPainel } from './estado.js';
import { sbGet, contas } from './dados.js';
import { calcularMes, mesStr, mesLabel, fmtV, limparCacheFinanceiro, saldos } from './calculo.js';
import { renderDAS } from './ui-das.js';

async function carregarPainel(){
  limparCacheFinanceiro(); // limpar cache para recalcular
  const ms = mesStr(mesPainel.y, mesPainel.m);
  const mAnterior = new Date(mesPainel.y, mesPainel.m-1);
  const msAnt = mesStr(mAnterior.getFullYear(), mAnterior.getMonth());
  // Atualizar label do navegador de mes
  const lblPainel = document.getElementById('mesLabelPainel');
  if(lblPainel) lblPainel.textContent = mesLabel(mesPainel.y, mesPainel.m);

  const [dadosMes, dadosAnt] = await Promise.all([
    calcularMes(ms),
    calcularMes(msAnt)
  ]);

  // Acumulado do ano atual (jan até mês corrente — dinâmico)
  const anoAtual = mesPainel.y;
  let lucroAcum = 0;
  for(let m=0; m<=mesPainel.m; m++){
    const d = await calcularMes(mesStr(anoAtual, m));
    lucroAcum += d.lucro;
  }

  // Custos pessoais do mês (já pagos)
  const pagsPes = await sbGet('pagamentos_mes', `select=*&mes=eq.${ms}&pago=eq.true`);
  const totalPes = Array.isArray(pagsPes)
    ? pagsPes.filter(p=>{const c=contas.find(x=>x.id===p.conta_id);return c&&c.tipo==='pessoal';})
             .reduce((s,p)=>{const c=contas.find(x=>x.id===p.conta_id);return s+(p.valor_pago||c?.valor||0);},0)
    : 0;

  // Custos pessoais agendados (ainda não pagos) — saídas pra projeção
  const agendPes = await sbGet('agendamentos', `select=*&mes=eq.${ms}`);
  const idsPagos = new Set(Array.isArray(pagsPes)?pagsPes.filter(p=>p.pago).map(p=>p.conta_id):[]);
  const totalAgendPes = Array.isArray(agendPes)
    ? agendPes.filter(a=>{const c=contas.find(x=>x.id===a.conta_id);return c&&c.tipo==='pessoal'&&!idsPagos.has(a.conta_id);})
              .reduce((s,a)=>s+(a.valor||0),0)
    : 0;

  // Retiradas agendadas (forma=ret) — entradas no pessoal que ainda não foram enviadas
  const retiradasJaEnviadas = await sbGet('retiradas', `select=componente&mes=eq.${ms}&enviado=eq.true`);
  const compEnviados = new Set(Array.isArray(retiradasJaEnviadas) ? retiradasJaEnviadas.map(r=>r.componente) : []);
  const totalRetAgendadas = Array.isArray(agendPes)
    ? agendPes.filter(a=>a.forma==='ret' && a.componente && !compEnviados.has(a.componente))
              .reduce((s,a)=>s+(a.valor||0),0)
    : 0;

  // Receita pessoal = retiradas do mês
  const retiradasPes = await sbGet('retiradas', `select=*&mes=eq.${ms}&enviado=eq.true`);
  const totalRetPes = Array.isArray(retiradasPes) ? retiradasPes.reduce((s,r)=>s+r.valor,0) : 0;

  const labelMes = mesLabel(mesPainel.y, mesPainel.m);
  // Limite usa projetado se mês anterior ainda tem CF pendente (não fechou),
  // senão usa real. Mesma regra do getLucroAnterior.
  const limiteRetirada = (dadosAnt.cfPendente > 0) ? dadosAnt.lucroProjetado : dadosAnt.lucro;

  // Helper pra mostrar diff vs mês anterior
  const diffStr = (atual, anterior) => {
    if(!anterior && anterior !== 0) return '';
    const diff = atual - anterior;
    if(Math.abs(diff) < 0.01) return '<div class="mc-sub">igual ao mês anterior</div>';
    const cor = diff > 0 ? 'var(--red)' : 'var(--green)';
    const sinal = diff > 0 ? '+' : '';
    return `<div class="mc-sub" style="color:${cor}">${sinal}${fmtV(diff)} vs ${MESES_PT[mAnterior.getMonth()].slice(0,3)}</div>`;
  };
  // Diff onde aumentar é bom (receita, lucro, retirado)
  const diffStrPositivo = (atual, anterior) => {
    if(!anterior && anterior !== 0) return '';
    const diff = atual - anterior;
    if(Math.abs(diff) < 0.01) return '<div class="mc-sub">igual ao mês anterior</div>';
    const cor = diff > 0 ? 'var(--green)' : 'var(--red)';
    const sinal = diff > 0 ? '+' : '';
    return `<div class="mc-sub" style="color:${cor}">${sinal}${fmtV(diff)} vs ${MESES_PT[mAnterior.getMonth()].slice(0,3)}</div>`;
  };

  // Projeção: saldo após receber retiradas agendadas e pagar tudo agendado pessoal
  const saldoProjetado = saldos.pessoal + totalRetAgendadas - totalAgendPes;
  const temAgendamentos = totalAgendPes > 0 || totalRetAgendadas > 0;

  document.getElementById('painelMesEmpresa').innerHTML=`
    <div class="sh">${labelMes} — empresa</div>
    <div class="grid2">
      <div class="mc"><div class="mc-lbl">Receita ${dadosMes.receitaPrevista>0?'(recebida)':''}</div><div class="mc-val" style="color:var(--blue)">${fmtV(dadosMes.receita)}</div>${dadosMes.receitaPrevista>0?`<div class="mc-sub" style="color:var(--blue)">+ ${fmtV(dadosMes.receitaPrevista)} prevista</div>`:diffStrPositivo(dadosMes.receita, dadosAnt.receita)}</div>
      <div class="mc"><div class="mc-lbl">Lucro líquido (real)</div><div class="mc-val" style="color:${dadosMes.lucro>=0?'var(--green)':'var(--red)'}">${fmtV(dadosMes.lucro)}</div>${diffStrPositivo(dadosMes.lucro, dadosAnt.lucro)}</div>
      <div class="mc" style="background:var(--purple-l);border-color:var(--purple-m)">
        <div class="mc-lbl" style="color:var(--purple)">📊 Lucro projetado</div>
        <div class="mc-val" style="color:var(--purple)">${fmtV(dadosMes.lucroProjetado)}</div>
        <div class="mc-sub" style="color:var(--purple)">Se tudo previsto for pago</div>
      </div>
      <div class="mc"><div class="mc-lbl">Custo fixo ${dadosMes.cfPendente>0?'(pago)':''}</div><div class="mc-val" style="color:var(--amber)">${fmtV(dadosMes.cf)}</div>${dadosMes.cfPendente>0?`<div class="mc-sub" style="color:var(--amber)">+ ${fmtV(dadosMes.cfPendente)} pendente</div>`:diffStr(dadosMes.cf, dadosAnt.cf)}</div>
      <div class="mc"><div class="mc-lbl">Custo variável</div><div class="mc-val" style="color:var(--amber)">${fmtV(dadosMes.cv)}</div>${diffStr(dadosMes.cv, dadosAnt.cv)}</div>
      <div class="mc"><div class="mc-lbl">Impostos</div><div class="mc-val" style="color:var(--red)">${fmtV(dadosMes.impostos)}</div>${diffStr(dadosMes.impostos, dadosAnt.impostos)}</div>
      <div class="mc"><div class="mc-lbl">Total retirado</div><div class="mc-val" style="color:var(--purple)">${fmtV(dadosMes.retirado)}</div></div>
      <div class="mc full" style="background:var(--${limiteRetirada>0?'amber':'red'}-l);border-color:var(--${limiteRetirada>0?'amber':'red'}-m)">
        <div class="mc-lbl" style="color:var(--${limiteRetirada>0?'amber':'red'})">Limite retirada lucros (mês anterior)</div>
        <div class="mc-val" style="color:var(--${limiteRetirada>0?'amber':'red'})">${fmtV(limiteRetirada)}</div>
      </div>
    </div>`;

  document.getElementById('painelMesPessoal').innerHTML=`
    <div class="sh">${labelMes} — pessoal</div>
    <div class="grid2">
      <div class="mc"><div class="mc-lbl">Receita (retiradas)</div><div class="mc-val" style="color:var(--blue)">${fmtV(totalRetPes)}</div></div>
      <div class="mc"><div class="mc-lbl">Custos pagos</div><div class="mc-val" style="color:var(--amber)">${fmtV(totalPes)}</div></div>
      <div class="mc full"><div class="mc-lbl">Saldo estimado</div><div class="mc-val" style="color:${totalRetPes-totalPes>=0?'var(--green)':'var(--red)'}">${fmtV(totalRetPes-totalPes)}</div><div class="mc-sub">Receitas − custos pagos no mês</div></div>
      ${temAgendamentos ? `
      <div class="mc full" style="background:var(--${saldoProjetado>=0?'blue':'red'}-l);border-color:var(--${saldoProjetado>=0?'blue':'red'}-m)">
        <div class="mc-lbl" style="color:var(--${saldoProjetado>=0?'blue':'red'})">📅 Saldo projetado pessoal</div>
        <div class="mc-val" style="color:var(--${saldoProjetado>=0?'blue':'red'})">${fmtV(saldoProjetado)}</div>
        <div class="mc-sub" style="color:var(--${saldoProjetado>=0?'blue':'red'})">
          ${fmtV(saldos.pessoal)} atual${totalRetAgendadas>0?` + ${fmtV(totalRetAgendadas)} entrada`:''}${totalAgendPes>0?` − ${fmtV(totalAgendPes)} saída`:''}
        </div>
      </div>` : ''}
    </div>`;

  document.getElementById('painelAcumulado').innerHTML=`
    <div class="sh">Acumulado ${anoAtual}</div>
    <div class="grid2">
      <div class="mc"><div class="mc-lbl">Lucro empresa (jan–${MESES_PT[mesPainel.m].slice(0,3).toLowerCase()})</div><div class="mc-val" style="color:${lucroAcum>=0?'var(--green)':'var(--red)'}">${fmtV(lucroAcum)}</div></div>
      <div class="mc"><div class="mc-lbl">Saldo pessoal atual</div><div class="mc-val" style="color:${saldos.pessoal>=0?'var(--blue)':'var(--red)'}">${fmtV(saldos.pessoal)}</div></div>
    </div>`;
  renderDAS();
}

// LUCRO DO MES ANTERIOR (dinamico para retirada)

function mudarMesPainel(d){
  mesPainel.m+=d;
  if(mesPainel.m>11){mesPainel.m=0;mesPainel.y++;}
  if(mesPainel.m<0){mesPainel.m=11;mesPainel.y--;}
  carregarPainel();
}
function irParaHojePainel(){mesPainel.y=hoje.getFullYear();mesPainel.m=hoje.getMonth();carregarPainel();}


export { carregarPainel, mudarMesPainel, irParaHojePainel };

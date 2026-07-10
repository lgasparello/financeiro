// ui-retirada.js — aba Retirada: composicao, limite de lucros, envio e agendamento de retiradas.
import { SB_URL, SB_HDR, MESES_PT, LUCROS_FALLBACK } from './config.js';
import { hoje, mesRet } from './estado.js';
import { sbGet, sbUpsert, sbDelete, contas, componentesRet, setComponentesRet, statusMes, toast } from './dados.js';
import { getLucroAnterior, mesStr, mesLabel, fmtV, contaAtivaNoMes, abaterSaldo, reporSaldo, limparCacheFinanceiro } from './calculo.js';

// --- Estado local da aba Retirada ---
export let retiradaMes={};   // retiradas do mes, por componente (reatribuido so aqui)
export let agendRetMes={};   // agendamentos de retirada (forma=ret), por componente
export const retSels=new Set(); // selecao multipla (exposta ao window para o handler inline de Limpar)

function mudarMesRet(d){
  mesRet.m+=d;
  if(mesRet.m>11){mesRet.m=0;mesRet.y++;}
  if(mesRet.m<0){mesRet.m=11;mesRet.y--;}
  atualizarRetirada();
}
function irParaHojeRet(){mesRet.y=hoje.getFullYear();mesRet.m=hoje.getMonth();atualizarRetirada();}


async function atualizarRetirada(){
  document.getElementById('mesLabelRet').textContent=mesLabel(mesRet.y,mesRet.m);
  document.getElementById('retContent').innerHTML='<div class="loading">Carregando...</div>';
  const ms=mesStr(mesRet.y,mesRet.m);
  const compRaw = await sbGet('componentes_retirada','select=*&ativo=eq.true&order=id');
  setComponentesRet(Array.isArray(compRaw) ? compRaw : []);
  if(!componentesRet.find(c=>c.chave==='lucros')){
    componentesRet.push({...LUCROS_FALLBACK});
  }
  const [retData, pagsRetRaw, agendRetRaw] = await Promise.all([
    sbGet('retiradas',`select=*&mes=eq.${ms}`),
    sbGet('pagamentos_mes',`select=*&mes=eq.${ms}&pago=eq.true`),
    sbGet('agendamentos',`select=*&mes=eq.${ms}&forma=eq.ret`)
  ]);
  retiradaMes={};
  if(Array.isArray(retData)){
    retData.forEach(r=>{retiradaMes[r.componente]={valor:r.valor,enviado:r.enviado,data:r.data_envio,id:r.id};});
  }
  agendRetMes={};
  if(Array.isArray(agendRetRaw)){
    agendRetRaw.forEach(a=>{
      if(a.componente) agendRetMes[a.componente]={valor:a.valor,data:a.data_programada};
    });
  }
  const statusMesRet={};
  if(Array.isArray(pagsRetRaw)) pagsRetRaw.forEach(r=>{statusMesRet[r.conta_id]={pago:r.pago,valorPago:r.valor_pago};});
  const agendMesRet={};
  const agendContasRaw = await sbGet('agendamentos',`select=*&mes=eq.${ms}&forma=neq.ret`);
  if(Array.isArray(agendContasRaw)) agendContasRaw.forEach(a=>{if(a.conta_id) agendMesRet[a.conta_id]={valor:a.valor};});
  const lucroAntRaw = await getLucroAnterior(mesRet.y, mesRet.m);
  const lucroAnt = Math.max(0, lucroAntRaw);
  renderRetirada(lucroAnt, lucroAntRaw, statusMesRet, agendMesRet);
}

function renderRetirada(lucroAnt=0, lucroAntRaw=0, statusMesRet={}, agendMesRet={}){
  const ms=mesStr(mesRet.y,mesRet.m);
  const mAnterior=new Date(mesRet.y,mesRet.m-1);

  // Separar fixos de lucros
  const fixosEnviados=Object.entries(retiradaMes)
    .filter(([k,r])=>r.enviado&&k!=='lucros')
    .reduce((s,[,r])=>s+r.valor,0);
  const lucrosEnv=retiradaMes['lucros']?.enviado?retiradaMes['lucros'].valor:0;
  const totalEnv=fixosEnviados+lucrosEnv;
  const lucrosPrev=retiradaMes['lucros']?.valor||0;
  const excessoLucros=lucrosPrev>lucroAnt&&lucroAnt>=0;

  // Calcular mínimo pessoal usando real > programado > previsto
  const contasPessoais = contas.filter(c=>{
    if(c.tipo!=='pessoal') return false;
    if(!contaAtivaNoMes(c, mesRet.y, mesRet.m)) return false;
    return true;
  });
  const minimoRetirar = contasPessoais.reduce((s,c)=>{
    const st = statusMesRet[c.id];
    if(st?.pago) return s + (st.valorPago||c.valor);
    const agend = agendMesRet[c.id];
    if(agend) return s + (agend.valor||c.valor);
    return s + c.valor;
  },0);

  let html='';

  // Aviso se mês anterior foi negativo
  if(lucroAntRaw<0){
    html+=`<div style="background:var(--red-l);border:1px solid var(--red-m);border-radius:var(--rs);padding:8px 12px;margin-bottom:10px;font-size:12px;color:var(--red)">
      ⚠ ${MESES_PT[mAnterior.getMonth()]} teve prejuízo de ${fmtV(Math.abs(lucroAntRaw))}. Limite de lucros = R$0,00.
    </div>`;
  }

  // Card mínimo a retirar (largura cheia)
  const diffMinimo = totalEnv - minimoRetirar;
  html+=`<div style="background:var(--blue-l);border:1px solid var(--blue-m);border-radius:var(--r);padding:11px 13px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:11px;font-weight:600;color:var(--blue);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">💡 Mínimo para cobrir contas pessoais</div>
      <div style="font-size:20px;font-weight:700;color:var(--blue)">${fmtV(minimoRetirar)}</div>
    </div>
    ${totalEnv>0?`<div style="font-size:12px;font-weight:500;color:var(--${diffMinimo>=0?'green':'red'});text-align:right">
      ${diffMinimo>=0?'✅ OK':'⚠ Faltam<br>'+fmtV(Math.abs(diffMinimo))}
    </div>`:''}
  </div>`;

  // Inicia grid 2 colunas (no PC) — coluna esquerda: resumo + composição
  html+='<div class="ret-grid"><div>';

  // Resumo em 3 cards
  html+=`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
    <div class="ret-limite">
      <div class="ret-limite-lbl">Limite lucros</div>
      <div class="ret-limite-val" style="font-size:16px">${fmtV(lucroAnt)}</div>
      <div class="ret-limite-sub">${MESES_PT[mAnterior.getMonth()]}</div>
    </div>
    <div style="background:var(--${excessoLucros?'red':'green'}-l);border:1px solid var(--${excessoLucros?'red':'green'}-m);border-radius:var(--r);padding:11px 13px">
      <div style="font-size:11px;font-weight:600;color:var(--${excessoLucros?'red':'green'});text-transform:uppercase;letter-spacing:.04em">Lucros retirados</div>
      <div style="font-size:16px;font-weight:600;color:var(--${excessoLucros?'red':'green'});margin-top:3px">${fmtV(lucrosEnv)}</div>
      <div style="font-size:11px;color:var(--${excessoLucros?'red':'green'});margin-top:2px">${excessoLucros?'EXCESSO':'OK'}</div>
    </div>
    <div class="ret-total-bar">
      <div class="ret-total-lbl">Total geral</div>
      <div class="ret-total-val" style="font-size:16px">${fmtV(totalEnv)}</div>
    </div>
  </div>`;

  // Composição detalhada
  html+=`<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:11px 13px;margin-bottom:12px">
    <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Composição</div>
    ${componentesRet.map(c=>{
      const env=retiradaMes[c.chave]?.enviado;
      const agendRet=agendRetMes[c.chave];
      const v=env?retiradaMes[c.chave].valor:agendRet?agendRet.valor:0;
      const isLucros=c.chave==='lucros';
      const cor=isLucros&&excessoLucros?'var(--red)':'var(--text)';
      const suffix=!env&&agendRet?' 📅':env?'':' —';
      return `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text2)">${c.nome}</span>
        <span style="font-weight:500;color:${cor}">${v>0?fmtV(v):'R$0,00'}${suffix}${isLucros&&excessoLucros?' ⚠':''}</span>
      </div>`;
    }).join('')}
    <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;font-weight:600">
      <span>Total enviado</span><span>${fmtV(totalEnv)}</span>
    </div>
  </div>`;

  // Fecha coluna esquerda, abre direita (cards de componentes)
  html+='</div><div>';

  // Cards por componente com checkbox
  let retSelecionados = {};
  componentesRet.forEach(c=>{
    if(c.mes_fim){
      const[fy,fm]=c.mes_fim.split('-').map(Number);
      if(new Date(mesRet.y,mesRet.m)>new Date(fy,fm-1))return;
    }
    const r=retiradaMes[c.chave];
    const agendRet=agendRetMes[c.chave];
    const val=r?.valor||agendRet?.valor||c.valor||0;
    const env=r?.enviado||false;
    const isAgendRet=!!agendRet&&!env;
    html+=`<div class="ret-card" id="retcard-${c.chave}">
      <div class="ret-top">
        <div style="display:flex;gap:8px;align-items:center">
          ${!env?`<div class="ci-check" id="retsel-${c.chave}" onclick="toggleRetSel('${c.chave}')"><svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="2"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg></div>`:''}
          <div class="ret-nome">${c.nome}${isAgendRet?`<span class="bdt" style="background:var(--purple-l);color:var(--purple);margin-left:4px">📅 ${agendRet.data}</span>`:''}</div>
        </div>
        <span class="ret-status ${env?'ret-env':isAgendRet?'ret-pend':'ret-pend'}">${env?'Enviado':isAgendRet?'Agendado':'Pendente'}</span>
      </div>
      ${!env?`
        <div class="ret-row" style="margin-top:8px">
          <input type="number" id="ret-val-${c.chave}" value="${Number(val).toFixed(2)}" step="0.01" placeholder="Valor" onchange="atualizarTotalRet()">
          <input type="date" id="ret-data-${c.chave}" value="${hoje.toISOString().split('T')[0]}">
        </div>
        <button class="btn-env" onclick="enviarRetirada('${c.chave}','${ms}')">Confirmar envio</button>
        <button onclick="programarRetirada('${c.chave}','${ms}',${val})" style="margin-top:4px;width:100%;padding:7px;background:var(--purple-l);border:1px solid var(--purple-m);border-radius:var(--rs);color:var(--purple);font-size:12px;cursor:pointer;font-family:inherit">${isAgendRet?'✓ Agendado — clique para remover':'📅 Programar'}</button>
      `:`
        <div style="font-size:13px;color:var(--green);font-weight:500;margin-top:4px">${fmtV(val)} · ${r.data||''}</div>
        <button class="btn-env-d" onclick="desfazerRetirada('${c.chave}','${ms}')">Desfazer</button>
      `}
    </div>`;
  });

  // Fecha coluna direita e ret-grid
  html+='</div></div>';

  document.getElementById('retContent').innerHTML=html;
  document.getElementById('retTotalBar').style.display='none';
}


function toggleRetSel(chave){
  if(retSels.has(chave)) retSels.delete(chave);
  else retSels.add(chave);
  const el=document.getElementById('retsel-'+chave);
  if(el) el.className='ci-check'+(retSels.has(chave)?' on':'');
  atualizarTotalRet();
}

function atualizarTotalRet(){
  const bar=document.getElementById('retTotalBar');
  if(!retSels.size){bar.style.display='none';return;}
  bar.style.display='block';
  let total=0;
  retSels.forEach(chave=>{
    const inp=document.getElementById('ret-val-'+chave);
    total+=parseFloat(inp?.value||0)||0;
  });
  document.getElementById('retTotalVal').textContent=fmtV(total);
  document.getElementById('retTotalCount').textContent=retSels.size+' item'+(retSels.size>1?'s':'');
}

async function programarRetirada(comp, ms, val){
  // Se já agendado, remover
  if(agendRetMes[comp]){
    await fetch(`${SB_URL}/rest/v1/agendamentos?mes=eq.${ms}&componente=eq.${comp}`,{method:'DELETE',headers:SB_HDR});
    delete agendRetMes[comp];
    await atualizarRetirada();
    toast('Agendamento removido');
    return;
  }
  const ano = ms.split('-')[0];
  const m = ms.split('-')[1];
  const dataDefault = `${ano}-${m}-05`;
  
  const existing = document.getElementById('modalProgr');
  if(existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'modalProgr';
  modal.style.cssText = `position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:var(--bg);border-top:1px solid var(--border);border-radius:16px 16px 0 0;padding:16px;z-index:200;box-shadow:0 -4px 24px rgba(0,0,0,.15)`;
  modal.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:12px">📅 Programar retirada — ${comp}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <label style="font-size:12px;color:var(--text3);white-space:nowrap">Valor:</label>
      <input type="number" id="inputValProgrRet" value="${Number(val).toFixed(2)}" step="0.01" style="flex:1;padding:8px 10px;border-radius:var(--rs);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit">
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
      <label style="font-size:12px;color:var(--text3);white-space:nowrap">Data:</label>
      <input type="date" id="inputDataProgrRet" value="${dataDefault}" style="flex:1;padding:8px 10px;border-radius:var(--rs);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit">
    </div>
    <div style="display:flex;gap:6px">
      <button onclick="confirmarProgramarRet('${comp}','${ms}',${val})" style="flex:1;padding:10px;background:var(--purple-l);border:1px solid var(--purple-m);border-radius:var(--rs);color:var(--purple);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Confirmar</button>
      <button onclick="document.getElementById('modalProgr').remove()" style="padding:10px 14px;background:none;border:1px solid var(--border2);border-radius:var(--rs);color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Cancelar</button>
    </div>`;
  document.querySelector('.app').appendChild(modal);
}

async function confirmarProgramarRet(comp, ms, val){
  const dataISO = document.getElementById('inputDataProgrRet')?.value;
  if(!dataISO) return;
  const parts = dataISO.split('-');
  const dataFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
  const valFinal = parseFloat(document.getElementById('inputValProgrRet')?.value)||val;
  await sbUpsert('agendamentos', `mes=eq.${ms}&componente=eq.${comp}&forma=eq.ret`, {mes:ms,valor:valFinal,forma:'ret',data_programada:dataFmt,componente:comp});
  agendRetMes[comp]={valor:valFinal,data:dataFmt};
  document.getElementById('modalProgr')?.remove();
  await atualizarRetirada();
  toast('Retirada programada para '+dataFmt+'!');
}

async function programarSelecionadosRet(){
  const ms = mesStr(mesRet.y, mesRet.m);
  const ano = ms.split('-')[0];
  const m = ms.split('-')[1];
  const dataDefault = `${ano}-${m}-05`;

  const existing = document.getElementById('modalProgr');
  if(existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'modalProgr';
  modal.style.cssText = `position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:var(--bg);border-top:1px solid var(--border);border-radius:16px 16px 0 0;padding:16px;z-index:200;box-shadow:0 -4px 24px rgba(0,0,0,.15)`;
  modal.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:12px">📅 Programar retiradas selecionadas</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
      <label style="font-size:12px;color:var(--text3);white-space:nowrap">Data:</label>
      <input type="date" id="inputDataProgrRetSel" value="${dataDefault}" style="flex:1;padding:8px 10px;border-radius:var(--rs);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit">
    </div>
    <div style="display:flex;gap:6px">
      <button onclick="confirmarProgramarRetSel()" style="flex:1;padding:10px;background:var(--purple-l);border:1px solid var(--purple-m);border-radius:var(--rs);color:var(--purple);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Confirmar</button>
      <button onclick="document.getElementById('modalProgr').remove()" style="padding:10px 14px;background:none;border:1px solid var(--border2);border-radius:var(--rs);color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Cancelar</button>
    </div>`;
  document.querySelector('.app').appendChild(modal);
}

async function confirmarProgramarRetSel(){
  const dataISO = document.getElementById('inputDataProgrRetSel')?.value;
  if(!dataISO) return;
  const parts = dataISO.split('-');
  const dataFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
  const ms = mesStr(mesRet.y, mesRet.m);
  for(const chave of retSels){
    const inp = document.getElementById('ret-val-'+chave);
    const val = parseFloat(inp?.value||0)||0;
    await sbUpsert('agendamentos', `mes=eq.${ms}&componente=eq.${chave}&forma=eq.ret`, {conta_id:null,mes:ms,valor:val,forma:'ret',data_programada:dataFmt,componente:chave});
    agendRetMes[chave]={valor:val,data:dataFmt};
  }
  retSels.clear();
  document.getElementById('retTotalBar').style.display='none';
  document.getElementById('modalProgr')?.remove();
  await atualizarRetirada();
  toast('Retiradas programadas para '+dataFmt+'!');
}

async function enviarSelecionados(){
  const ms=mesStr(mesRet.y,mesRet.m);
  for(const chave of retSels){
    await enviarRetirada(chave,ms);
  }
  retSels.clear();
  document.getElementById('retTotalBar').style.display='none';
}

async function enviarRetirada(comp,ms){
  const val=parseFloat(document.getElementById('ret-val-'+comp)?.value)||0;
  const data=document.getElementById('ret-data-'+comp)?.value||'';
  const dataFmt=data?data.split('-').reverse().join('/'):'';
  // Verifica se já estava enviada (idempotência: não duplicar saldo)
  const jaEnviada = retiradaMes[comp]?.enviado === true;
  await sbUpsert('retiradas', `componente=eq.${comp}&mes=eq.${ms}`, {componente:comp,mes:ms,valor:val,enviado:true,data_envio:dataFmt});
  // Movimenta saldo só se ainda não estava marcada como enviada
  if(!jaEnviada && val > 0){
    await abaterSaldo('llg', val);
    await reporSaldo('pessoal', val);
  }
  limparCacheFinanceiro();
  toast('Retirada confirmada!');
  await atualizarRetirada();
}

async function desfazerRetirada(comp,ms){
  const compNome = componentesRet.find(c=>c.chave===comp)?.nome || comp;
  if(!confirm(`Desfazer retirada de "${compNome}"?\n\nO valor voltará para a LLG e sairá do pessoal.`)) return;
  const val=retiradaMes[comp]?.valor||0;
  const estavaEnviada = retiradaMes[comp]?.enviado === true;
  await sbUpsert('retiradas', `componente=eq.${comp}&mes=eq.${ms}`, {componente:comp,mes:ms,valor:val,enviado:false});
  // Estorna saldo: o que saiu da LLG volta, o que entrou no pessoal sai
  if(estavaEnviada && val > 0){
    await reporSaldo('llg', val);
    await abaterSaldo('pessoal', val);
  }
  limparCacheFinanceiro();
  toast('Desfeito');
  await atualizarRetirada();
}

// RELATORIO

export { mudarMesRet, irParaHojeRet, atualizarRetirada, renderRetirada, toggleRetSel, atualizarTotalRet, programarRetirada, confirmarProgramarRet, programarSelecionadosRet, confirmarProgramarRetSel, enviarSelecionados, enviarRetirada, desfazerRetirada };

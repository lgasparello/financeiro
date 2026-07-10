// ui-contas.js — aba Contas: filtros, dias do mes, cards de conta, pagamento e agendamento.
import { hoje, DIA_HOJE, mesAtual } from './estado.js';
import { contas, statusMes, agendamentos, sbUpsert, sbDelete, carregarStatusMes, carregarAgendamentos, salvarStatusMes, toast } from './dados.js';
import { mesStr, mesLabel, diasNoMes, fmtV, isHoje, formaLabel, formaBadge, contaAtivaNoMes, abaterSaldo, reporSaldo, limparCacheFinanceiro } from './calculo.js';

// --- Estado local da aba Contas (reatribuido apenas aqui) ---
export let filtro='all';
export let diaSel=null;
export let benefFiltro='';

function contasFiltradas(){
  return contas.filter(c=>{
    if(filtro!=='all'&&c.tipo!==filtro)return false;
    if(benefFiltro&&c.beneficiario!==benefFiltro)return false;
    if(!contaAtivaNoMes(c, mesAtual.y, mesAtual.m)) return false;
    return true;
  });
}

function setBenefFiltro(benef, btn){
  benefFiltro = benef;
  document.querySelectorAll('#benefFiltros .fbtn').forEach(b=>b.className='fbtn');
  btn.className='fbtn on-all';
  renderDias();
  renderTodasContas();
}

function atualizarBenefFiltros(){
  const lista = contas.filter(c=>{
    if(filtro!=='all'&&c.tipo!==filtro)return false;
    if(!contaAtivaNoMes(c, mesAtual.y, mesAtual.m)) return false;
    return true;
  });
  const beneficiarios=[...new Set(lista.map(c=>c.beneficiario))].sort();
  const benefRow=document.getElementById('benefFiltroRow');
  const benefDiv=document.getElementById('benefFiltros');
  if(beneficiarios.length>1){
    benefRow.style.display='block';
    let html='<button class="fbtn on-all" onclick="setBenefFiltro(\'\',this)">Todos</button>';
    beneficiarios.forEach(b=>{
      const nome=b.split(' ')[0];
      html+=`<button class="fbtn" onclick="setBenefFiltro('${b}',this)">${nome}</button>`;
    });
    benefDiv.innerHTML=html;
  } else {
    benefRow.style.display='none';
  }
}

function setFiltro(f,btn){
  filtro=f;
  benefFiltro='';
  document.querySelectorAll('.fbtn').forEach(b=>b.className='fbtn');
  btn.className='fbtn '+(f==='all'?'on-all':f==='empresa'?'on-llg':'on-pes');
  atualizarBenefFiltros();
  renderDias();if(diaSel!==null)renderDiaInfo(diaSel);renderTodasContas();
}

function mudarMes(d){
  mesAtual.m+=d;
  if(mesAtual.m>11){mesAtual.m=0;mesAtual.y++;}
  if(mesAtual.m<0){mesAtual.m=11;mesAtual.y--;}
  limparCacheFinanceiro();
  diaSel=null;
  atualizarContas();
}

function irParaHoje(){
  mesAtual.y=hoje.getFullYear();mesAtual.m=hoje.getMonth();
  diaSel=null;
  atualizarContas();
}

async function atualizarContas(){
  document.getElementById('mesLabel').textContent=mesLabel(mesAtual.y,mesAtual.m);
  document.getElementById('todasContas').innerHTML='<div class="loading">Carregando...</div>';
  await carregarStatusMes(mesStr(mesAtual.y,mesAtual.m));
  await carregarAgendamentos(mesStr(mesAtual.y,mesAtual.m));
  atualizarBenefFiltros();
  renderDias();
  document.getElementById('diaInfo').innerHTML='<div style="font-size:12px;color:var(--text3)">Toque num dia para ver as contas</div>';
  renderTodasContas();
}

// DIAS
function diasComContas(){
  const dias={};
  contasFiltradas().forEach(c=>{if(!dias[c.dia_vencimento])dias[c.dia_vencimento]=[];dias[c.dia_vencimento].push(c);});
  return dias;
}

function renderDias(){
  const dcc=diasComContas();
  const total=diasNoMes(mesAtual.y,mesAtual.m);
  let html='';
  for(let d=1;d<=total;d++){
    const tc=!!dcc[d];
    const tp=tc&&dcc[d].every(c=>statusMes[c.id]?.pago);
    const ehHoje=isHoje(mesAtual.y,mesAtual.m)&&d===DIA_HOJE;
    let cls='dia-btn';
    if(!tc)cls+=' sem-conta';
    if(ehHoje)cls+=' hoje';
    if(d===diaSel)cls+=' sel';
    if(tc&&!tp)cls+=' tem-conta';
    if(tc&&tp)cls+=' tudo-pago';
    html+=`<button class="${cls}" ${tc?`onclick="selDia(${d})"`:''}>${d}</button>`;
  }
  document.getElementById('diasWrap').innerHTML=html;
}

function selDia(d){
  if(diaSel===d){diaSel=null;renderDias();document.getElementById('diaInfo').innerHTML='<div style="font-size:12px;color:var(--text3)">Toque num dia para ver as contas</div>';return;}
  diaSel=d;renderDias();renderDiaInfo(d);
}

function renderDiaInfo(d){
  const dcc=diasComContas();
  const el=document.getElementById('diaInfo');
  if(!dcc[d]){el.innerHTML=`<div style="font-size:12px;color:var(--text3)">Nenhuma conta no dia ${d}</div>`;return;}
  let html=`<div style="display:flex;justify-content:space-between;margin-bottom:8px">
    <span style="font-size:12px;font-weight:600;color:var(--text2)">Contas do dia ${d}</span>
    <button onclick="selDia(${d})" style="font-size:11px;color:var(--text3);background:none;border:none;cursor:pointer">fechar</button></div>`;
  dcc[d].forEach(c=>{
    const e=statusMes[c.id];
    const pg=e?.pago;
    html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span>${c.nome}<span class="bdt ${c.tipo==='empresa'?'bd-l':'bd-p'}">${c.tipo==='empresa'?'LLG':'Pes.'}</span></span>
      ${pg?`<span style="font-size:11px;color:var(--green);font-weight:600">Pago ${fmtV(e.valorPago)}</span>`:`<span style="font-size:11px;color:var(--red)">Pendente</span>`}
    </div>`;
  });
  el.innerHTML=html;
}

function setForma(id,f){
  if(!statusMes[id])return;
  statusMes[id].forma=f;
  renderTodasContas();
}

function renderTodasContas(){
  let lista=contasFiltradas();
  if(diaSel!==null) lista=lista.filter(c=>c.dia_vencimento===diaSel);
  const pend=lista.filter(c=>!statusMes[c.id]?.pago).sort((a,b)=>a.dia_vencimento-b.dia_vencimento);
  const pagos=lista.filter(c=>statusMes[c.id]?.pago).sort((a,b)=>a.dia_vencimento-b.dia_vencimento);
  const totalPend=pend.reduce((s,c)=>s+(statusMes[c.id]?.valorPago||c.valor),0);
  let html='<div class="contas-grid">';
  // Coluna 1: Pendentes
  html+='<div class="col-pend">';
  if(pend.length){
    html+=`<div class="sec-hd pend"><span>Pendentes — ${pend.length}</span><span>${fmtV(totalPend)}</span></div>`;
    pend.forEach(c=>{html+=renderConta(c);});
  }else{
    html+=`<div class="sec-hd pago-hd"><span>Todas pagas!</span><span>0 pendentes</span></div>`;
  }
  html+='</div>';
  // Coluna 2: Pagas
  html+='<div class="col-pagos">';
  if(pagos.length){
    html+=`<div class="sec-hd pago-hd" style="margin-top:0"><span>Pagas — ${pagos.length}</span></div>`;
    pagos.forEach(c=>{html+=renderConta(c);});
  }
  html+='</div>';
  html+='</div>';
  document.getElementById('todasContas').innerHTML=(pend.length||pagos.length)?html:'<div class="empty">Nenhuma conta neste filtro.</div>';
  renderTotalBar();
}

function renderConta(c){
  const e=statusMes[c.id]||{pago:false,valorPago:c.valor,forma:c.forma_padrao,selecionado:false};
  const ms=mesStr(mesAtual.y,mesAtual.m);
  const dp=c.dia_vencimento-DIA_HOJE;
  const ehMesAtual=isHoje(mesAtual.y,mesAtual.m);
  let vcls,vlbl;
  if(e.pago){vcls='v-pg';vlbl='Pago';}
  else if(!ehMesAtual){vcls='v-ok';vlbl='dia '+c.dia_vencimento;}
  else if(c.dia_vencimento===DIA_HOJE){vcls='v-hj';vlbl='Hoje';}
  else if(dp>0&&dp<=3){vcls='v-br';vlbl=dp+'d';}
  else if(dp>0){vcls='v-ok';vlbl='dia '+c.dia_vencimento;}
  else{vcls='v-ps';vlbl='Passou';}
  const bd=c.tipo==='empresa'?'<span class="bdt bd-l">LLG</span>':'<span class="bdt bd-p">Pes.</span>';
  let parcBadge='';
  if(c.parcela_total&&c.mes_fim){
    const [fy,fm]=c.mes_fim.split('-').map(Number);
    const mesF=new Date(fy,fm-1);
    const mesC=new Date(mesAtual.y,mesAtual.m);
    const restam=Math.round((mesF-mesC)/(1000*60*60*24*30))+1;
    if(restam>0) parcBadge=`<span class="bdt bd-parc">${restam}x restam</span>`;
  }
  const chk='ci-check'+(e.selecionado?' on':'');
  const fbs=['llg','pes','crt'].map(f=>`<button class="forma-btn${e.forma===f?' on-'+f:''}" onclick="setForma(${c.id},'${f}')">${f==='llg'?'LLG':f==='crt'?'Cartão':'Pessoal'}</button>`).join('');
  const agend = agendamentos[c.id];
  const isAgendado = !!agend;
  // Se tem agendamento e conta não está paga, usa o valor do agendamento
  const valorExibido = (!e.pago && isAgendado) ? agend.valor : e.valorPago;
  return `<div class="ci${e.pago?' pago':''}${e.selecionado?' sel-ci':''}${isAgendado?' agendado':''}" id="ci-${c.id}">
    <div class="ci-top">
      <div style="display:flex;gap:8px;align-items:flex-start">
        ${!e.pago?`<div class="${chk}" onclick="toggleSel(${c.id})"><svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="2"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg></div>`:''}
        <div>
          <div class="ci-nm">${c.nome}${bd}${parcBadge}${isAgendado?`<span class="bdt" style="background:var(--purple-l);color:var(--purple)">📅 ${agend.data_programada}</span>`:''}</div>
          <div class="ci-dt">${c.beneficiario} · dia ${c.dia_vencimento}</div>
        </div>
      </div>
      <div class="ci-right">
        <div class="ci-vl${e.pago?' ptxt':''}">${fmtV(valorExibido)}</div>
        <span class="vc ${vcls}">${vlbl}</span>
        ${!e.pago?(isAgendado
          ?`<button id="quickBtn-${c.id}" onclick="pagarRapido(${c.id})" title="Confirmar pagamento" style="display:block;margin-top:4px;background:var(--blue);border:1px solid var(--blue);border-radius:var(--rs);padding:3px 8px;font-size:10px;color:#fff;cursor:pointer;font-family:inherit;font-weight:600">✅ Confirmar</button>`
          :`<button id="quickBtn-${c.id}" onclick="pagarRapido(${c.id})" title="Pagar com forma padrão" style="display:block;margin-top:4px;background:var(--green-l);border:1px solid var(--green-m);border-radius:var(--rs);padding:3px 8px;font-size:10px;color:var(--green);cursor:pointer;font-family:inherit;font-weight:600">⚡ Pagar</button>`
        ):''}
      </div>
    </div>
    ${!e.pago
      ?(isAgendado
        ?`<div class="ci-actions" style="margin-top:8px">
            <button onclick="programarConta(${c.id})" style="width:100%;padding:8px;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--rs);color:var(--text2);font-size:12px;cursor:pointer;font-family:inherit">✏️ Editar agendamento ou desfazer</button>
          </div>`
        :`<div class="ci-actions" style="margin-top:8px">
            <button onclick="toggleEditConta(${c.id})" id="editBtn-${c.id}" style="width:100%;padding:8px;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--rs);color:var(--text2);font-size:12px;cursor:pointer;font-family:inherit">✏️ Editar antes de pagar ou programar</button>
            <div id="editArea-${c.id}" style="display:none;margin-top:8px">
              <div class="ci-row"><label>Valor</label><input type="number" id="val-${c.id}" value="${Number(valorExibido).toFixed(2)}" step="0.01"></div>
              <div class="ci-row" style="margin-top:6px"><label>Via</label><div class="forma-btns">${fbs}</div></div>
              <div style="display:flex;gap:6px;margin-top:8px">
                <button class="btn-ok" onclick="pagarConta(${c.id})" style="flex:1">Confirmar pagamento</button>
                <button onclick="programarConta(${c.id})" style="flex:0;padding:9px 12px;background:var(--purple-l);border:1px solid var(--purple-m);border-radius:var(--rs);color:var(--purple);font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap">📅 Programar</button>
              </div>
            </div>
          </div>`)
      :`<div class="pago-info">
          <span class="pago-badge ${formaBadge(e.forma)}">${formaLabel(e.forma)}</span>
          ${e.data?`<span style="font-size:11px;color:var(--text3)">${e.data}</span>`:''}
          <button class="btn-desfaz" onclick="desfazerPagamento(${c.id})">Desfazer</button>
        </div>`}
  </div>`;
}

function toggleEditConta(id){
  const area = document.getElementById('editArea-'+id);
  const btn = document.getElementById('editBtn-'+id);
  const quickBtn = document.getElementById('quickBtn-'+id);
  if(!area || !btn) return;
  if(area.style.display === 'none'){
    area.style.display = 'block';
    btn.style.display = 'none';
    if(quickBtn) quickBtn.style.display = 'none';
  } else {
    area.style.display = 'none';
    btn.style.display = 'block';
    if(quickBtn) quickBtn.style.display = 'block';
  }
}


async function programarConta(id){
  const inp = document.getElementById('val-'+id);
  const c = contas.find(x=>x.id===id);
  const ms = mesStr(mesAtual.y, mesAtual.m);
  const agendAtual = agendamentos[id];

  // Valor padrão e data padrão
  let v, dataDefault;
  if(agendAtual){
    // Já agendado: usa valores existentes
    v = agendAtual.valor;
    // converte dd/mm/yyyy → yyyy-mm-dd
    const partes = (agendAtual.data_programada||'').split('/');
    dataDefault = partes.length===3 ? `${partes[2]}-${partes[1]}-${partes[0]}` : '';
  } else {
    v = parseFloat(inp?.value || statusMes[id]?.valorPago) || statusMes[id]?.valorPago || c.valor;
    const diaDefault = String(c.dia_vencimento).padStart(2,'0');
    const mesStr2 = String(mesAtual.m+1).padStart(2,'0');
    dataDefault = `${mesAtual.y}-${mesStr2}-${diaDefault}`;
  }

  const existing = document.getElementById('modalProgr');
  if(existing) existing.remove();

  const titulo = agendAtual ? `✏️ Editar agendamento — ${c.nome}` : `📅 Programar — ${c.nome}`;
  const btnDesfazer = agendAtual
    ? `<button onclick="desfazerAgendamento(${id})" style="padding:10px 14px;background:var(--red-l);border:1px solid var(--red-m);border-radius:var(--rs);color:var(--red);font-size:13px;cursor:pointer;font-family:inherit">🗑 Desfazer</button>`
    : '';

  const modal = document.createElement('div');
  modal.id = 'modalProgr';
  modal.style.cssText = `position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:var(--bg);border-top:1px solid var(--border);border-radius:16px 16px 0 0;padding:16px;z-index:200;box-shadow:0 -4px 24px rgba(0,0,0,.15)`;
  modal.innerHTML = `
    <div style="font-size:13px;font-weight:600;margin-bottom:12px">${titulo}</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <label style="font-size:12px;color:var(--text3);white-space:nowrap">Valor:</label>
      <input type="number" id="modalValProgr" value="${Number(v).toFixed(2)}" step="0.01" style="flex:1;padding:8px 10px;border-radius:var(--rs);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit">
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
      <label style="font-size:12px;color:var(--text3);white-space:nowrap">Data:</label>
      <input type="date" id="inputDataProgr" value="${dataDefault}" style="flex:1;padding:8px 10px;border-radius:var(--rs);border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:13px;font-family:inherit">
    </div>
    <div style="display:flex;gap:6px">
      <button onclick="confirmarProgramar(${id})" style="flex:1;padding:10px;background:var(--purple-l);border:1px solid var(--purple-m);border-radius:var(--rs);color:var(--purple);font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">${agendAtual?'Salvar alterações':'Confirmar'}</button>
      ${btnDesfazer}
      <button onclick="document.getElementById('modalProgr').remove()" style="padding:10px 14px;background:none;border:1px solid var(--border2);border-radius:var(--rs);color:var(--text3);font-size:13px;cursor:pointer;font-family:inherit">Cancelar</button>
    </div>`;
  document.querySelector('.app').appendChild(modal);
  modal._contaId = id;
  modal._valor = v;
  modal._ms = ms;
}

async function desfazerAgendamento(id){
  const c = contas.find(x=>x.id===id);
  if(!confirm(`Desfazer agendamento de "${c?.nome||'conta'}"?`)) return;
  const ms = mesStr(mesAtual.y, mesAtual.m);
  await sbDelete('agendamentos', `conta_id=eq.${id}&mes=eq.${ms}`);
  delete agendamentos[id];
  document.getElementById('modalProgr')?.remove();
  renderTodasContas();
  toast('Agendamento removido');
}

async function confirmarProgramar(id){
  const modal = document.getElementById('modalProgr');
  if(!modal) return;
  const dataISO = document.getElementById('inputDataProgr').value;
  if(!dataISO) return;
  const parts = dataISO.split('-');
  const dataFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
  const v = parseFloat(document.getElementById('modalValProgr')?.value) || modal._valor;
  const ms = modal._ms;
  const c = contas.find(x=>x.id===id);
  await sbUpsert('agendamentos', `conta_id=eq.${id}&mes=eq.${ms}`, {conta_id:id,mes:ms,valor:v,forma:statusMes[id]?.forma||c.forma_padrao,data_programada:dataFmt});
  agendamentos[id] = {conta_id:id,mes:ms,valor:v,forma:statusMes[id]?.forma,data_programada:dataFmt};
  modal.remove();
  renderTodasContas();
  toast('Programado para '+dataFmt+'!');
}

async function programarSelecionados(){
  const ms = mesStr(mesAtual.y, mesAtual.m);
  for(const c of contas.filter(c=>statusMes[c.id]?.selecionado)){
    const inp = document.getElementById('val-'+c.id);
    const v = parseFloat(inp?.value || statusMes[c.id]?.valorPago) || c.valor;
    const dataProgr = `${String(c.dia_vencimento).padStart(2,'0')}/${String(mesAtual.m+1).padStart(2,'0')}/${mesAtual.y}`;
    await sbUpsert('agendamentos', `conta_id=eq.${c.id}&mes=eq.${ms}`, {conta_id:c.id,mes:ms,valor:v,forma:statusMes[c.id]?.forma||c.forma_padrao,data_programada:dataProgr});
    agendamentos[c.id] = {conta_id:c.id,mes:ms,valor:v,forma:statusMes[c.id]?.forma,data_programada:dataProgr};
    statusMes[c.id].selecionado = false;
  }
  renderTodasContas();
  toast('Pagamentos programados!');
}

function limparSelecao(){
  contas.forEach(c=>{if(statusMes[c.id])statusMes[c.id].selecionado=false;});
  renderTodasContas();
}

function toggleSel(id){
  if(statusMes[id]?.pago)return;
  if(!statusMes[id])statusMes[id]={pago:false,valorPago:contas.find(c=>c.id===id)?.valor,forma:'pes',selecionado:false};
  statusMes[id].selecionado=!statusMes[id].selecionado;
  renderTodasContas();
}

async function pagarRapido(id){
  const c = contas.find(x=>x.id===id);
  if(!c) return;
  // Usa o valor agendado se houver, senão valor padrão da conta
  const agend = agendamentos[id];
  const valor = agend ? agend.valor : c.valor;
  const formaUsar = (agend && agend.forma) || statusMes[id]?.forma || c.forma_padrao;
  const formaLbl = formaUsar==='llg'?'Débito LLG':formaUsar==='crt'?'Cartão':'Débito pessoal';
  if(!confirm(`Pagar "${c.nome}"?\n\nValor: ${fmtV(valor)}\nForma: ${formaLbl}`)) return;
  // Garante o status correto antes de pagar
  if(!statusMes[id]) statusMes[id] = {pago:false, valorPago:valor, forma:formaUsar, selecionado:false};
  statusMes[id].forma = formaUsar;
  statusMes[id].valorPago = valor;
  const ms = mesStr(mesAtual.y, mesAtual.m);
  const dataStr = `${DIA_HOJE.toString().padStart(2,'0')}/${String(mesAtual.m+1).padStart(2,'0')}/${mesAtual.y}`;
  statusMes[id] = {...statusMes[id], pago:true, valorPago:valor, data:dataStr, selecionado:false};
  await salvarStatusMes(id, ms, {pago:true, valor_pago:valor, forma:formaUsar, data_pagamento:dataStr});
  if(formaUsar !== 'crt'){
    await abaterSaldo(c.tipo==='empresa'?'llg':'pessoal', valor);
  }
  renderTodasContas(); renderDias();
  if(diaSel!==null) renderDiaInfo(diaSel);
  toast('Pagamento confirmado!');
}

async function pagarConta(id){
  const inp=document.getElementById('val-'+id);
  const v=parseFloat(inp?inp.value:statusMes[id].valorPago)||statusMes[id].valorPago;
  const c=contas.find(x=>x.id===id);
  const ms=mesStr(mesAtual.y,mesAtual.m);
  const dataStr=`${DIA_HOJE.toString().padStart(2,'0')}/${String(mesAtual.m+1).padStart(2,'0')}/${mesAtual.y}`;
  statusMes[id]={...statusMes[id],pago:true,valorPago:v,data:dataStr,selecionado:false};
  await salvarStatusMes(id, ms, {pago:true, valor_pago:v, forma:statusMes[id].forma, data_pagamento:dataStr});
  // Só abate saldo se não for cartão
  if(statusMes[id].forma !== 'crt'){
    const contaSaldo = c.tipo==='empresa'?'llg':'pessoal';
    await abaterSaldo(contaSaldo, v);
  }
  renderTodasContas();renderDias();if(diaSel!==null)renderDiaInfo(diaSel);
  toast('Pagamento confirmado!');
}

async function pagarSelecionados(){
  for(const c of contas.filter(c=>statusMes[c.id]?.selecionado)) await pagarConta(c.id);
}

async function desfazerPagamento(id){
  const c=contas.find(x=>x.id===id);
  if(!confirm(`Desfazer pagamento de "${c?.nome||'conta'}"?\n\nO valor voltará para o saldo.`)) return;
  const ms=mesStr(mesAtual.y,mesAtual.m);
  const v=statusMes[id]?.valorPago||0;
  statusMes[id]={...statusMes[id],pago:false,selecionado:false};
  await salvarStatusMes(id, ms, {pago:false, valor_pago:statusMes[id].valorPago, forma:statusMes[id].forma});
  // Só repõe saldo se não foi cartão
  if(statusMes[id].forma !== 'crt'){
    const contaSaldo = c.tipo==='empresa'?'llg':'pessoal';
    await reporSaldo(contaSaldo, v);
  }
  renderTodasContas();renderDias();if(diaSel!==null)renderDiaInfo(diaSel);
  toast('Desfeito');
}

function renderTotalBar(){
  const sels=contas.filter(c=>statusMes[c.id]?.selecionado);
  const bar=document.getElementById('totalBar');
  if(!sels.length){bar.style.display='none';return;}
  bar.style.display='block';
  const total=sels.reduce((s,c)=>{
    const inp=document.getElementById('val-'+c.id);
    return s+(parseFloat(inp?inp.value:statusMes[c.id]?.valorPago)||0);
  },0);
  document.getElementById('totalVal').textContent=fmtV(total);
  const pp={};
  sels.forEach(c=>{
    const inp=document.getElementById('val-'+c.id);
    const v=parseFloat(inp?inp.value:statusMes[c.id]?.valorPago)||0;
    if(!pp[c.beneficiario])pp[c.beneficiario]=0;pp[c.beneficiario]+=v;
  });
  let pph='';
  Object.entries(pp).forEach(([p,v])=>{
    const nome=p.split(' ')[0];
    pph+=`<div class="total-pessoa-pill">${nome}: <b>${fmtV(v)}</b></div>`;
  });
  document.getElementById('totalPorPessoa').innerHTML=pph;
}

// DADOS FINANCEIROS DINAMICOS

// --- Notificacoes de contas vencendo (chamada no init) ---
function verificarNotificacoes(){
  const ms=mesStr(mesAtual.y,mesAtual.m);
  if(!isHoje(mesAtual.y,mesAtual.m))return;
  const vencendo=contas.filter(c=>{
    if(statusMes[c.id]?.pago)return false;
    const dp=c.dia_vencimento-DIA_HOJE;
    return dp>=0&&dp<=3;
  });
  if(!vencendo.length)return;
  const banner=document.getElementById('notifBanner');
  const lista=document.getElementById('notifLista');
  banner.style.display='block';
  lista.innerHTML=vencendo.map(c=>{
    const dp=c.dia_vencimento-DIA_HOJE;
    const label=dp===0?'Hoje':dp===1?'Amanhã':`Em ${dp} dias`;
    return `<div style="font-size:12px;color:var(--amber);display:flex;justify-content:space-between"><span>${c.nome} — ${label}</span><span style="font-weight:600">${fmtV(c.valor)}</span></div>`;
  }).join('');
}

// GASTO RÁPIDO

export { contasFiltradas, setBenefFiltro, atualizarBenefFiltros, setFiltro, mudarMes, irParaHoje, atualizarContas, diasComContas, renderDias, selDia, renderDiaInfo, setForma, renderTodasContas, renderConta, toggleEditConta, programarConta, desfazerAgendamento, confirmarProgramar, programarSelecionados, limparSelecao, toggleSel, pagarRapido, pagarConta, pagarSelecionados, desfazerPagamento, renderTotalBar, verificarNotificacoes };

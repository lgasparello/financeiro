// dados.js — camada de acesso ao Supabase (REST) + estado de dados carregado do banco.
// Nao altera nomes de tabelas nem queries.
import { SB_URL, SB_HDR } from './config.js';

// --- Estado de dados (bindings vivos; reatribuidos apenas dentro deste modulo) ---
export let contas=[];        // contas_fixas ativas
export let statusMes={};     // pagamentos_mes do mes corrente, indexado por conta_id
export let agendamentos={};  // agendamentos do mes corrente, indexado por conta_id
export let componentesRet=[];// componentes_retirada (reatribuido tambem em calculo/ui-retirada via setter)
export function setComponentesRet(v){ componentesRet=v; }

// --- Supabase REST ---
async function sbGet(t,q=''){const r=await fetch(`${SB_URL}/rest/v1/${t}?${q}`,{headers:SB_HDR});const tx=await r.text();return tx?JSON.parse(tx):[];}
async function sbPost(t,d,opts=''){const r=await fetch(`${SB_URL}/rest/v1/${t}`,{method:'POST',headers:{...SB_HDR,'Prefer':opts||'return=representation'},body:JSON.stringify(d)});const tx=await r.text();return tx?JSON.parse(tx):null;}
async function sbPatch(t,q,d){const r=await fetch(`${SB_URL}/rest/v1/${t}?${q}`,{method:'PATCH',headers:{...SB_HDR,'Prefer':'return=representation'},body:JSON.stringify(d)});const tx=await r.text();return tx?JSON.parse(tx):null;}

// UPSERT manual: PATCH primeiro, INSERT se nao existir. Para tabelas sem constraint UNIQUE.
async function sbUpsert(table, matchQuery, dados){
  const patch = await fetch(`${SB_URL}/rest/v1/${table}?${matchQuery}`,{
    method:'PATCH',headers:{...SB_HDR,'Prefer':'return=representation'},
    body:JSON.stringify(dados)
  });
  const tx = await patch.text();
  const patchData = tx?JSON.parse(tx):[];
  if(Array.isArray(patchData)&&patchData.length===0){
    return await sbPost(table, dados);
  }
  return patchData;
}

async function sbDelete(table, matchQuery){
  await fetch(`${SB_URL}/rest/v1/${table}?${matchQuery}`,{method:'DELETE',headers:SB_HDR});
}
async function salvarStatusMes(id, ms, dados){
  // Tenta patch primeiro (atualizar existente)
  const patch = await fetch(`${SB_URL}/rest/v1/pagamentos_mes?conta_id=eq.${id}&mes=eq.${ms}`,{
    method:'PATCH',headers:{...SB_HDR,'Prefer':'return=representation'},
    body:JSON.stringify(dados)
  });
  const patchData = await patch.json();
  // Se não existia (array vazio), cria novo
  if(Array.isArray(patchData)&&patchData.length===0){
    await sbPost('pagamentos_mes',{conta_id:id,mes:ms,...dados});
  }
}


// --- Toast (notificacao efemera) ---
function toast(msg,dur=2500){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),dur);
}


// --- Loaders ---
async function carregarContas(){
  const data=await sbGet('contas_fixas','select=*&ativo=eq.true&order=dia_vencimento');
  if(Array.isArray(data)) contas=data;
}

// CARREGAR STATUS DO MES
async function carregarStatusMes(ms){
  statusMes={};
  const data=await sbGet('pagamentos_mes',`select=*&mes=eq.${ms}`);
  if(Array.isArray(data)){
    data.forEach(r=>{
      statusMes[r.conta_id]={
        pago:r.pago, valorPago:r.valor_pago, forma:r.forma,
        data:r.data_pagamento, id:r.id, selecionado:false
      };
    });
  }
  contas.forEach(c=>{
    if(!statusMes[c.id]){
      statusMes[c.id]={pago:false,valorPago:c.valor,forma:c.forma_padrao,data:null,id:null,selecionado:false};
    }
  });
}

async function carregarAgendamentos(ms){
  agendamentos = {};
  const data = await sbGet('agendamentos', `select=*&mes=eq.${ms}`);
  if(Array.isArray(data)) data.forEach(a => { agendamentos[a.conta_id] = a; });
}


export { sbGet, sbPost, sbPatch, sbUpsert, sbDelete, salvarStatusMes, toast, carregarContas, carregarStatusMes, carregarAgendamentos };

// chat-ia.js — Chat IA: SYS prompt dinamico, envio de mensagem/foto, gasto rapido e acoes.
// O SYS prompt (montarSysPrompt) e mantido byte-a-byte. normalizarMesIA segue ANINHADA em
// processarAcaoChat de proposito (ver BUGS.md #2) para nao alterar comportamento.
import { SB_URL, SB_HDR } from './config.js';
import { hoje, mesAtual, mesRet } from './estado.js';
import { sbGet, sbPost, sbPatch, sbDelete, sbUpsert, salvarStatusMes, contas, statusMes, carregarContas, carregarStatusMes, toast } from './dados.js';
import { mesStr, mesLabel, fmtV, calcularMes, limparCacheFinanceiro, abaterSaldo, reporSaldo, atualizarPillsSaldo, saldos } from './calculo.js';
import { renderDias, renderTodasContas } from './ui-contas.js';
import { retiradaMes } from './ui-retirada.js';

// --- Historico do chat (ultimas 6 msgs; reatribuido so aqui) ---
let chatHistory = [];

async function montarSysPrompt(){
  // Lista de contas atuais
  const contasStr = contas.map(c=>{
    const inicio = c.mes_inicio ? ` desde ${c.mes_inicio}` : '';
    const fim = c.mes_fim ? `, até ${c.mes_fim}` : '';
    const cartao = c.forma_padrao==='crt' ? ', cartão' : '';
    return `${c.id}: ${c.nome} → ${c.beneficiario}: ${fmtV(c.valor)}/mês, dia ${c.dia_vencimento}, ${c.tipo}${cartao}${inicio}${fim}`;
  }).join('\n');

  // Lucros reais dos últimos 4 meses
  const meses = [];
  for(let i=3; i>=0; i--){
    const d = new Date(hoje.getFullYear(), hoje.getMonth()-i);
    meses.push({ms: mesStr(d.getFullYear(), d.getMonth()), label: MESES_PT[d.getMonth()].slice(0,3)+'/'+String(d.getFullYear()).slice(2)});
  }
  const lucrosArr = await Promise.all(meses.map(m => calcularMes(m.ms)));
  const lucrosStr = meses.map((m,i) => `${m.label} ${fmtV(lucrosArr[i].lucro)}`).join(' | ');

  // Parcelamentos ativos
  const parcStr = contas.filter(c=>c.parcela_total&&c.mes_fim).map(c=>{
    const [fy,fm] = c.mes_fim.split('-').map(Number);
    return `- ${c.nome} (id ${c.id}): termina ${MESES_PT[fm-1].slice(0,3)}/${String(fy).slice(2)}`;
  }).join('\n');

  return `Você é o assistente financeiro completo de Lucas Gasparello, dono da LLG Consultoria.
Data atual: ${hoje.toLocaleDateString('pt-BR')}.
Saldo LLG: ${fmtV(saldos.llg)} | Saldo pessoal: ${fmtV(saldos.pessoal)}.

CONTAS FIXAS ATIVAS (IDs para referência):
${contasStr}

PARCELAMENTOS ATIVOS:
${parcStr || '- nenhum'}

LUCROS LÍQUIDOS REAIS (últimos 4 meses): ${lucrosStr}

AÇÕES DISPONÍVEIS — responda SOMENTE o JSON correspondente, sem markdown:

1. REGISTRAR GASTO:
"mes" deve ser SEMPRE no formato "YYYY-MM" (exemplo: "2026-05" para maio de 2026). Se o usuário não especificar mês, use o mês atual.

"cat" é a categoria do gasto. Escolha UMA das seguintes (idênticas às do app):
- "Alimentação" — comida, restaurante, mercado, padaria, doces, lanches
- "Combustível" — gasolina, álcool, pedágio, estacionamento avulso
- "Lazer" — cinema, show, viagem, passeio, bar
- "Pet" — ração, veterinário, banho, pet shop
- "Compras" — roupas, marketplace, eletrônicos, presentes
- "Farmácia" — remédios, suplementos
- "Filhos" — atividades extras dos filhos (esporte, ballet, presentes pra eles, festinha, material escolar avulso)
- "Outros" — qualquer coisa que não encaixa nas anteriores

NUNCA use "Custo Variável", "Custo Fixo", "Imposto", "Receita" como categoria — esses são tipos contábeis, não categorias de gasto.

{"a":"reg","desc":"nome","valor":0.00,"conta":"empresa|pessoal","mes":"YYYY-MM","cat":"Alimentação|Combustível|Lazer|Pet|Compras|Farmácia|Filhos|Outros","forma":"deb|crt","msg":"confirmação"}

2. ADICIONAR CONTA RECORRENTE:
mes_inicio é o primeiro mês em que a conta aparece (formato "YYYY-MM"). Se não informado pelo usuário, use o mês atual.
mes_fim é o último mês em que a conta aparece (opcional, deixe null se for indefinida).
Se a conta é pontual (ex: "lançar só em abril"), use mes_inicio E mes_fim com o mesmo mês.
Se é parcelada (ex: "parcelar em 5x começando em junho"), use mes_inicio do primeiro mês, mes_fim do último mês, e parcela_total com o número de parcelas (ex: 5). Sem parcela_total a conta não aparece na aba Relatório como parcelamento.
{"a":"add_recorrente","desc":"nome","beneficiario":"credor","valor":0.00,"conta":"empresa|pessoal","dia":5,"mes_inicio":"YYYY-MM","mes_fim":"YYYY-MM ou null","parcela_total":null,"msg":"confirmação"}

3. EDITAR CONTA EXISTENTE (mudar valor, dia, beneficiário, mes_inicio, mes_fim):
{"a":"edit_conta","id":0,"campo":"valor|dia_vencimento|beneficiario|nome|mes_inicio|mes_fim","valor_novo":"novo valor","msg":"confirmação"}

4. DESATIVAR CONTA (encerrar pagamento — usar apenas quando o usuário disser claramente "cancelar", "encerrar", "não pago mais" ou "excluir"):
{"a":"desativar_conta","id":0,"msg":"confirmação"}

⚠ IMPORTANTE — "QUITAR" NÃO É DESATIVAR:
Quando o usuário disser "quitar", "quitei", "paguei tudo", "adiantei parcelas", "paguei as restantes" ou similar sobre um parcelamento, ISSO É PAGAMENTO, não desativação. NUNCA use "desativar_conta" nesse caso, e NUNCA altere o mes_fim para "encurtar" o parcelamento.

O correto é:
- Se o usuário DISSE explicitamente quantas parcelas quitou (ex: "quitei 3 parcelas do Insta360"): use "pagar_conta" com valor = N × valor_parcela, no mês atual.
- Se o usuário NÃO disse quantas ("quitei o Insta360", "paguei tudo"): PERGUNTE antes de agir. Responda em texto perguntando quantas parcelas restantes ele pagou de uma vez. Só depois da resposta, use "pagar_conta".
- Se o usuário quitar TODAS as parcelas restantes de um parcelamento, ainda assim NÃO desative a conta nem mude o mes_fim. Apenas registre o pagamento com o valor total. A conta continuará ativa até o mes_fim original.

5. MARCAR CONTA COMO PAGA:
{"a":"pagar_conta","id":0,"valor":0.00,"forma":"pes|llg|crt","msg":"confirmação"}

6. DESFAZER PAGAMENTO DE CONTA:
{"a":"desfazer_conta","id":0,"msg":"confirmação"}

7. AJUSTAR SALDO:
{"a":"ajustar_saldo","conta":"llg|pessoal","valor":0.00,"msg":"confirmação"}

8. REGISTRAR RETIRADA LLG:
{"a":"retirada","componente":"pro_labore|plano_saude|moto|lucros","valor":0.00,"data":"dd/mm/aaaa","msg":"confirmação"}

9. DESFAZER GASTO VARIÁVEL (estornar gasto da tabela gastos — devolve o valor ao saldo):
Use o id que aparece em GASTOS VARIÁVEIS RECENTES.
{"a":"desfazer_gasto","id":0,"msg":"confirmação"}

10. EDITAR GASTO VARIÁVEL (corrigir valor, descrição ou categoria):
{"a":"edit_gasto","id":0,"campo":"valor|descricao|categoria","valor_novo":"novo valor","msg":"confirmação"}

11. REGISTRAR RECEITA REAL (já recebida — dinheiro caiu na conta LLG):
Use SEMPRE que o usuário falar que recebeu um valor da empresa cliente.
"mes" no formato YYYY-MM. "data" no formato dd/mm/yyyy.
Repõe o saldo LLG automaticamente.
{"a":"add_receita","cliente":"nome cliente","descricao":"serviço","valor":0.00,"mes":"YYYY-MM","data":"dd/mm/yyyy","msg":"confirmação"}

12. REGISTRAR RECEITA PREVISTA (ainda não recebida, mas previsão de receber):
Use quando o usuário falar de previsão futura (ex: "Global vai pagar 20k em julho").
NÃO movimenta saldo. Aparece como projeção até ser marcada como recebida.
{"a":"add_receita_prevista","cliente":"nome cliente","descricao":"serviço","valor":0.00,"mes":"YYYY-MM","msg":"confirmação"}

13. MARCAR RECEITA COMO RECEBIDA (confirma quando o dinheiro caiu):
Use quando o usuário falar que uma receita prevista foi recebida.
Repõe o saldo LLG automaticamente.
{"a":"marcar_receita_recebida","id":0,"data":"dd/mm/yyyy","msg":"confirmação"}

PARA PERGUNTAS: responda diretamente, máximo 4 linhas, objetivo.`;
}



function addMsg(txt,tipo){
  const el=document.getElementById('msgs'),d=document.createElement('div');
  d.className='m '+tipo;d.innerHTML=txt;el.appendChild(d);el.scrollTop=el.scrollHeight;
}
function showTyping(){
  const el=document.getElementById('msgs'),d=document.createElement('div');
  d.className='m a';d.id='typ';
  d.innerHTML='<div class="dot"><span></span><span></span><span></span></div>';
  el.appendChild(d);el.scrollTop=el.scrollHeight;
}
function rmTyping(){const t=document.getElementById('typ');if(t)t.remove();}

async function sendMsg(){
  const inp=document.getElementById('inp'),txt=inp.value.trim();if(!txt)return;
  inp.value='';addMsg(txt,'u');showTyping();
  chatHistory.push({role:'user',content:txt});
  if(chatHistory.length>6) chatHistory=chatHistory.slice(-6);
  try{
    // Buscar contexto dinâmico do banco
    const ms = mesStr(mesAtual.y, mesAtual.m);
    const [gastosRec, pagsRec, recPrev] = await Promise.all([
      sbGet('gastos',`select=*&order=created_at.desc&limit=30`),
      sbGet('pagamentos_mes',`select=*&mes=eq.${ms}&pago=eq.true&order=data_pagamento.desc`),
      sbGet('receitas',`select=*&recebido=eq.false&order=mes.asc&limit=20`)
    ]);
    const ctxGastos = Array.isArray(gastosRec) ? gastosRec
      .map(g=>`id=${g.id} | ${g.data_lancamento} | ${g.descricao} | R$${g.valor} | ${g.categoria} | ${g.conta}`)
      .join('\n') : '';
    const ctxPagas = Array.isArray(pagsRec) ? pagsRec
      .map(p=>{ const c=contas.find(x=>x.id===p.conta_id); return c?`${p.data_pagamento||'?'} | ${c.nome} | R$${p.valor_pago} | ${p.forma==='pes'?'débito pessoal':p.forma==='llg'?'débito empresa':'cartão'} | ${c.tipo}`:null; })
      .filter(Boolean).join('\n') : '';
    const ctxRecPrev = Array.isArray(recPrev) ? recPrev
      .map(r=>`id=${r.id} | ${r.mes} | ${r.cliente} | ${r.descricao||''} | R$${r.valor}`)
      .join('\n') : '';
    const sysBase = await montarSysPrompt();
    const sysComCtx = sysBase +
      `\n\nCONTAS PAGAS ESTE MÊS (${mesLabel(mesAtual.y,mesAtual.m)}) — data | nome | valor | forma | tipo:\n${ctxPagas||'nenhuma'}` +
      `\n\nGASTOS VARIÁVEIS RECENTES — data | descrição | valor | categoria | conta:\n${ctxGastos||'nenhum'}` +
      `\n\nRECEITAS PREVISTAS (não recebidas) — id | mês | cliente | descrição | valor:\n${ctxRecPrev||'nenhuma'}`;
    const r=await fetch('/api/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:800,system:sysComCtx,messages:chatHistory})
    });
    const d=await r.json(),resp=d.content?.[0]?.text||'';
    rmTyping();
    if(!resp){
      const errMsg=d.error?.message||d.type||JSON.stringify(d);
      addMsg(`Erro da API: ${errMsg}`,'a');
      return;
    }
    // Adicionar resposta ao histórico
    chatHistory.push({role:'assistant',content:resp});
    
    // Extrair todos os JSONs da resposta
    const jsonMatches = [];
    const jsonRegex = /\{[^{}]*"a"\s*:\s*"[^"]*"[^{}]*\}/g;
    let match;
    while((match = jsonRegex.exec(resp)) !== null){
      try{ jsonMatches.push(JSON.parse(match[0])); }catch(e){}
    }
    // Se não encontrou com regex, tenta parse simples
    if(!jsonMatches.length){
      try{ 
        const p=JSON.parse(resp.replace(/```json|```/g,'').trim());
        if(p&&p.a) jsonMatches.push(p);
      }catch(e){}
    }

    if(jsonMatches.length){
      for(const parsed of jsonMatches){
        await processarAcaoChat(parsed);
      }
    } else {
      addMsg(resp.replace(/\n/g,'<br>'),'a');
    }
  }catch(e){rmTyping();addMsg('Erro de conexão.','a');}
}

async function processarAcaoChat(parsed){
// Normaliza qualquer formato de "mes" que venha da IA para YYYY-MM
function normalizarMesIA(m){
  if(!m) return mesStr(mesAtual.y, mesAtual.m);
  // Já está em YYYY-MM
  if(/^\d{4}-\d{2}$/.test(m)) return m;
  // "Abril 2026" ou só "Abril"
  const meses = {'Janeiro':'01','Fevereiro':'02','Março':'03','Abril':'04','Maio':'05','Junho':'06','Julho':'07','Agosto':'08','Setembro':'09','Outubro':'10','Novembro':'11','Dezembro':'12'};
  const partes = m.split(' ');
  const mNum = meses[partes[0]];
  if(mNum){
    const ano = partes[1] || mesAtual.y;
    return `${ano}-${mNum}`;
  }
  // Fallback: mês atual
  return mesStr(mesAtual.y, mesAtual.m);
}

  if(parsed.a==='reg'){
    const forma=parsed.forma||'deb';
    const mesISO = normalizarMesIA(parsed.mes);
    addMsg(`<b>${parsed.desc}</b> <span class="bdt ${parsed.conta==='empresa'?'bd-l':'bd-p'}">${parsed.conta==='empresa'?'LLG':'Pes.'}</span><br><span style="color:var(--red)">-${fmtV(parsed.valor)}</span> · ${parsed.cat}<br><span style="font-size:12px;color:var(--green)">${parsed.msg}</span>`,'g');
    await sbPost('gastos',{descricao:parsed.desc,valor:parsed.valor,conta:parsed.conta,mes:mesISO,categoria:parsed.cat,forma_pagamento:'Via chat',data_lancamento:hoje.toLocaleDateString('pt-BR')});
    if(forma!=='crt'){
      const contaSaldo=parsed.conta==='empresa'?'llg':'pessoal';
      await abaterSaldo(contaSaldo,parsed.valor);
      if(parsed.cat==='Retirada'&&parsed.conta==='empresa') await reporSaldo('pessoal',parsed.valor);
    }
    toast('Gasto registrado!');

  } else if(parsed.a==='add_recorrente'){
    // Calcula parcela_total automaticamente se tem mes_inicio e mes_fim diferentes (e a IA não passou)
    let parcelaTotal = parsed.parcela_total || null;
    if(!parcelaTotal && parsed.mes_inicio && parsed.mes_fim && parsed.mes_inicio !== parsed.mes_fim){
      const [iy,im]=parsed.mes_inicio.split('-').map(Number);
      const [fy,fm]=parsed.mes_fim.split('-').map(Number);
      const meses = (fy-iy)*12 + (fm-im) + 1;
      if(meses > 1) parcelaTotal = meses;
    }
    const novaConta = {
      nome: parsed.desc,
      beneficiario: parsed.beneficiario||parsed.desc,
      valor: parsed.valor,
      dia_vencimento: parsed.dia||5,
      tipo: parsed.conta==='empresa'?'empresa':'pessoal',
      forma_padrao: parsed.conta==='empresa'?'llg':'pes',
      categoria: 'outros',
      ativo: true,
      mes_inicio: parsed.mes_inicio || mesStr(mesAtual.y, mesAtual.m),
      mes_fim: parsed.mes_fim || null,
      parcela_total: parcelaTotal
    };
    await sbPost('contas_fixas', novaConta);
    await carregarContas(); await carregarStatusMes(mesStr(mesAtual.y,mesAtual.m)); renderDias(); renderTodasContas();
    let detalhes = `${fmtV(parsed.valor)}/mês · dia ${parsed.dia||5} · ${parsed.conta==='empresa'?'LLG':'Pessoal'}`;
    if(parcelaTotal) detalhes += ` · ${parcelaTotal}x parcelas`;
    if(parsed.mes_inicio === parsed.mes_fim && parsed.mes_inicio) detalhes += ` · pontual em ${parsed.mes_inicio}`;
    else if(parsed.mes_inicio || parsed.mes_fim) detalhes += ` · ${parsed.mes_inicio||'?'} → ${parsed.mes_fim||'sem fim'}`;
    addMsg(`✅ <b>${parsed.desc}</b> adicionada!<br>${detalhes}`,'g');
    toast('Conta adicionada!');

  } else if(parsed.a==='edit_conta'){
    await fetch(`${SB_URL}/rest/v1/contas_fixas?id=eq.${parsed.id}`,{method:'PATCH',headers:{...SB_HDR},body:JSON.stringify({[parsed.campo]:parsed.valor_novo})});
    await carregarContas();await carregarStatusMes(mesStr(mesAtual.y,mesAtual.m));renderDias();renderTodasContas();
    addMsg(`✅ ${parsed.msg}`,'g');toast('Conta atualizada!');

  } else if(parsed.a==='desativar_conta'){
    await fetch(`${SB_URL}/rest/v1/contas_fixas?id=eq.${parsed.id}`,{method:'PATCH',headers:{...SB_HDR},body:JSON.stringify({ativo:false})});
    await carregarContas();await carregarStatusMes(mesStr(mesAtual.y,mesAtual.m));renderDias();renderTodasContas();
    addMsg(`✅ ${parsed.msg}`,'g');toast('Conta desativada!');

  } else if(parsed.a==='pagar_conta'){
    const ms=mesStr(mesAtual.y,mesAtual.m);
    const c=contas.find(x=>x.id===parsed.id);
    if(!statusMes[parsed.id])statusMes[parsed.id]={pago:false,valorPago:parsed.valor,forma:parsed.forma||'pes',selecionado:false};
    statusMes[parsed.id]={...statusMes[parsed.id],pago:true,valorPago:parsed.valor,forma:parsed.forma||'pes'};
    await salvarStatusMes(parsed.id,ms,{pago:true,valor_pago:parsed.valor,forma:parsed.forma||'pes',data_pagamento:hoje.toLocaleDateString('pt-BR')});
    if(parsed.forma!=='crt'&&c) await abaterSaldo(c.tipo==='empresa'?'llg':'pessoal',parsed.valor);
    renderTodasContas();renderDias();
    addMsg(`✅ ${parsed.msg}`,'g');toast('Conta paga!');

  } else if(parsed.a==='desfazer_conta'){
    const ms=mesStr(mesAtual.y,mesAtual.m);
    const c=contas.find(x=>x.id===parsed.id);
    const v=statusMes[parsed.id]?.valorPago||0;
    const forma=statusMes[parsed.id]?.forma||'pes';
    if(statusMes[parsed.id])statusMes[parsed.id]={...statusMes[parsed.id],pago:false};
    await salvarStatusMes(parsed.id,ms,{pago:false,valor_pago:v,forma});
    if(forma!=='crt'&&c) await reporSaldo(c.tipo==='empresa'?'llg':'pessoal',v);
    renderTodasContas();renderDias();
    addMsg(`✅ ${parsed.msg}`,'g');toast('Desfeito!');

  } else if(parsed.a==='ajustar_saldo'){
    saldos[parsed.conta]=parsed.valor;
    await fetch(`${SB_URL}/rest/v1/saldos?id=eq.${parsed.conta}`,{method:'PATCH',headers:{...SB_HDR},body:JSON.stringify({valor:parsed.valor})});
    atualizarPillsSaldo();
    addMsg(`✅ ${parsed.msg}`,'g');toast('Saldo atualizado!');

  } else if(parsed.a==='retirada'){
    const ms=mesStr(mesRet.y,mesRet.m);
    await sbUpsert('retiradas', `componente=eq.${parsed.componente}&mes=eq.${ms}`, {componente:parsed.componente,mes:ms,valor:parsed.valor,enviado:true,data_envio:parsed.data||hoje.toLocaleDateString('pt-BR')});
    retiradaMes[parsed.componente]={valor:parsed.valor,enviado:true,data:parsed.data};
    await abaterSaldo('llg',parsed.valor);
    await reporSaldo('pessoal',parsed.valor);
    addMsg(`✅ ${parsed.msg}`,'g');toast('Retirada registrada!');

  } else if(parsed.a==='desfazer_gasto'){
    // Buscar o gasto pra saber valor e conta antes de deletar
    const gastoData = await sbGet('gastos', `select=*&id=eq.${parsed.id}`);
    if(!Array.isArray(gastoData) || !gastoData.length){
      addMsg(`❌ Gasto id ${parsed.id} não encontrado.`,'a');
      return;
    }
    const g = gastoData[0];
    await sbDelete('gastos', `id=eq.${parsed.id}`);
    // Repor saldo (mesma lógica do reg, mas ao contrário)
    const contaSaldo = g.conta==='empresa'?'llg':'pessoal';
    await reporSaldo(contaSaldo, g.valor);
    addMsg(`✅ ${parsed.msg}<br><span style="font-size:12px;color:var(--text3)">Estornado: ${g.descricao} · ${fmtV(g.valor)} (${g.conta})</span>`,'g');
    toast('Gasto removido!');

  } else if(parsed.a==='edit_gasto'){
    const dados = {};
    dados[parsed.campo] = parsed.valor_novo;
    // Se mudou o valor, ajustar saldo (só repõe a diferença)
    if(parsed.campo === 'valor'){
      const gastoData = await sbGet('gastos', `select=*&id=eq.${parsed.id}`);
      if(Array.isArray(gastoData) && gastoData.length){
        const g = gastoData[0];
        const diff = Number(parsed.valor_novo) - g.valor;
        const contaSaldo = g.conta==='empresa'?'llg':'pessoal';
        if(diff > 0) await abaterSaldo(contaSaldo, diff);
        else if(diff < 0) await reporSaldo(contaSaldo, -diff);
      }
    }
    await sbPatch('gastos', `id=eq.${parsed.id}`, dados);
    addMsg(`✅ ${parsed.msg}`,'g');
    toast('Gasto atualizado!');

  } else if(parsed.a==='add_receita'){
    const mesISO = normalizarMesIA(parsed.mes);
    await sbPost('receitas', {
      mes: mesISO,
      cliente: parsed.cliente,
      descricao: parsed.descricao || 'Serviço',
      valor: parsed.valor,
      recebido: true,
      data_recebimento: parsed.data || hoje.toLocaleDateString('pt-BR')
    });
    await reporSaldo('llg', parsed.valor);
    limparCacheFinanceiro();
    addMsg(`✅ ${parsed.msg}<br><span style="font-size:12px;color:var(--text3)">${parsed.cliente} · ${fmtV(parsed.valor)} · ${mesISO}</span>`,'g');
    toast('Receita registrada!');

  } else if(parsed.a==='add_receita_prevista'){
    const mesISO = normalizarMesIA(parsed.mes);
    await sbPost('receitas', {
      mes: mesISO,
      cliente: parsed.cliente,
      descricao: parsed.descricao || 'Serviço',
      valor: parsed.valor,
      recebido: false,
      data_recebimento: null
    });
    limparCacheFinanceiro();
    addMsg(`✅ ${parsed.msg}<br><span style="font-size:12px;color:var(--text3)">📅 Previsão: ${parsed.cliente} · ${fmtV(parsed.valor)} · ${mesISO}</span>`,'g');
    toast('Receita prevista!');

  } else if(parsed.a==='marcar_receita_recebida'){
    const recData = await sbGet('receitas', `select=*&id=eq.${parsed.id}`);
    if(!Array.isArray(recData) || !recData.length){
      addMsg(`❌ Receita id ${parsed.id} não encontrada.`,'a');
      return;
    }
    const r = recData[0];
    if(r.recebido){
      addMsg(`⚠ Essa receita já estava marcada como recebida.`,'a');
      return;
    }
    await sbPatch('receitas', `id=eq.${parsed.id}`, {
      recebido: true,
      data_recebimento: parsed.data || hoje.toLocaleDateString('pt-BR')
    });
    await reporSaldo('llg', r.valor);
    limparCacheFinanceiro();
    addMsg(`✅ ${parsed.msg}<br><span style="font-size:12px;color:var(--text3)">${r.cliente} · ${fmtV(r.valor)} recebido</span>`,'g');
    toast('Receita confirmada!');
  }
}


// --- Gasto rapido + foto de nota fiscal ---
function toggleGastoRapido(){
  const el=document.getElementById('gastoRapidoChat');
  el.style.display=el.style.display==='none'?'block':'none';
  if(el.style.display==='block') document.getElementById('grDesc').focus();
}

async function salvarGastoRapido(){
  const desc=document.getElementById('grDesc').value.trim();
  const valor=parseFloat(document.getElementById('grValor').value);
  const cat=document.getElementById('grCat').value;
  const conta=document.getElementById('grConta').value;
  // Validações
  if(!desc || desc.length < 2){toast('Descrição precisa ter ao menos 2 caracteres');return;}
  if(!valor || isNaN(valor) || valor <= 0){toast('Valor precisa ser maior que zero');return;}
  if(valor > 100000 && !confirm(`Confirmar gasto de ${fmtV(valor)}? Está acima de R$100.000.`)) return;
  await sbPost('gastos',{descricao:desc,valor,conta,mes:mesStr(mesAtual.y,mesAtual.m),categoria:cat,forma_pagamento:'Débito',data_lancamento:hoje.toLocaleDateString('pt-BR')});
  await abaterSaldo(conta==='empresa'?'llg':'pessoal',valor);
  // Mostrar no chat
  addMsg(`<b>${desc}</b> <span class="bdt ${conta==='empresa'?'bd-l':'bd-p'}">${conta==='empresa'?'LLG':'Pes.'}</span><br><span style="color:var(--red)">-${fmtV(valor)}</span> · ${cat}`,'g');
  document.getElementById('grDesc').value='';
  document.getElementById('grValor').value='';
  document.getElementById('gastoRapidoChat').style.display='none';
  toast('Gasto registrado!');
}

// FOTO DE NOTA FISCAL
async function enviarFoto(input){
  const file=input.files[0];
  if(!file)return;
  addMsg('📷 Analisando nota fiscal...','s');
  showTyping();
  try{
    const base64=await new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>res(r.result.split(',')[1]);
      r.onerror=()=>rej(new Error('Erro ao ler imagem'));
      r.readAsDataURL(file);
    });
    const sysFoto = await montarSysPrompt();
    const r=await fetch('/api/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'claude-sonnet-4-6',max_tokens:600,
        system:sysFoto+'\nO usuário enviou uma foto de nota fiscal ou cupom. Extraia o valor total, estabelecimento e categorize o gasto. A categoria deve ser UMA dessas: "Alimentação", "Combustível", "Lazer", "Pet", "Compras", "Farmácia", "Filhos" ou "Outros". Responda SOMENTE em JSON: {"a":"reg","desc":"nome estabelecimento","valor":0.00,"conta":"pessoal","mes":"Abril","cat":"Alimentação|Combustível|Lazer|Pet|Compras|Farmácia|Filhos|Outros","msg":"confirmação"}',
        messages:[{role:'user',content:[
          {type:'image',source:{type:'base64',media_type:file.type,data:base64}},
          {type:'text',text:'Registre este gasto da nota fiscal'}
        ]}]
      })
    });
    const d=await r.json(),resp=d.content?.[0]?.text||'';
    rmTyping();
    let parsed=null;
    try{parsed=JSON.parse(resp.replace(/```json|```/g,'').trim());}catch(e){}
    if(parsed&&parsed.a==='reg'){
      const mesISONota = normalizarMesIA(parsed.mes);
      addMsg(`<b>${parsed.desc}</b> <span class="bdt bd-p">Pes.</span><br><span style="color:var(--red)">-${fmtV(parsed.valor)}</span> · ${parsed.cat}<br><span style="font-size:12px;color:var(--green)">${parsed.msg}</span>`,'g');
      await sbPost('gastos',{descricao:parsed.desc,valor:parsed.valor,conta:parsed.conta||'pessoal',mes:mesISONota,categoria:parsed.cat,forma_pagamento:'Nota fiscal',data_lancamento:hoje.toLocaleDateString('pt-BR')});
      await abaterSaldo('pessoal',parsed.valor);
      toast('Nota registrada!');
    }else{
      addMsg(resp||'Não consegui ler a nota. Tente novamente.','a');
    }
  }catch(e){rmTyping();addMsg('Erro ao processar imagem.','a');}
  input.value='';
}

// SALDOS DINAMICOS

export { montarSysPrompt, addMsg, showTyping, rmTyping, sendMsg, processarAcaoChat, toggleGastoRapido, salvarGastoRapido, enviarFoto };

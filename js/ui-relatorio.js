// ui-relatorio.js — aba Relatorio: parcelamentos, gastos por beneficiario e por categoria.
import { MESES_PT } from './config.js';
import { hoje } from './estado.js';
import { sbGet, contas } from './dados.js';
import { fmtV, extrairMesISO, labelMesISO } from './calculo.js';

// --- Estado local da aba Relatorio ---
export let todosGastos=[];
export let catAtual='all';
export let mesGastoFiltro='all';
export let porBenefGlobal={};
export let benefSelecionados=new Set();

async function carregarRelatorio(){
  // Parcelamentos: conta como parcelado se tem mes_inicio + mes_fim (mais de 1 mês de intervalo)
  // ou se tem parcela_total explicito
  const parc=contas.filter(c=>{
    if(!c.mes_fim) return false;
    if(c.parcela_total) return true;
    // Detecta parcelamento automático pelo intervalo
    if(c.mes_inicio){
      const [iy,im]=c.mes_inicio.split('-').map(Number);
      const [fy,fm]=c.mes_fim.split('-').map(Number);
      const meses = (fy-iy)*12 + (fm-im) + 1;
      return meses > 1; // tem que ter pelo menos 2 meses pra ser parcelamento
    }
    return false;
  });
  let htmlParc='';
  parc.forEach(c=>{
    const[fy,fm]=c.mes_fim.split('-').map(Number);
    // Calcula parcela_total: usa o campo se existir, senão calcula pelo intervalo
    let totalParc = c.parcela_total;
    let mesI;
    if(c.mes_inicio){
      const [iy,im]=c.mes_inicio.split('-').map(Number);
      mesI = new Date(iy, im-1);
      if(!totalParc){
        totalParc = (fy-iy)*12 + (fm-im) + 1;
      }
    } else {
      const mesF=new Date(fy,fm-1);
      mesI=new Date(mesF.getFullYear(),mesF.getMonth()-totalParc+1);
    }
    const mesAtualDate=new Date(hoje.getFullYear(),hoje.getMonth());
    // Pagas: meses decorridos desde mes_inicio (clampado entre 0 e totalParc)
    let pagas = Math.round((mesAtualDate-mesI)/(1000*60*60*24*30))+1;
    pagas = Math.max(0, Math.min(totalParc, pagas));
    const restam=totalParc-pagas;
    const pct=Math.round((pagas/totalParc)*100);
    const quitado = restam === 0;
    htmlParc+=`<div class="rel-card" data-quitado="${quitado}" style="${quitado?'opacity:.65':''}">
      <div class="rel-nome">${c.nome} <span style="font-size:11px;color:var(--text3)">${c.beneficiario}</span>
        ${quitado?`<span style="background:var(--green-l);color:var(--green);font-size:10px;font-weight:600;padding:2px 6px;border-radius:8px;margin-left:6px;letter-spacing:.04em">✓ QUITADO</span>`:''}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3);margin-bottom:4px">
        <span>${pagas}/${totalParc} parcelas · ${fmtV(c.valor)}/mês</span>
        <span style="color:${restam<=2?'var(--green)':'var(--amber)'}">${restam} restam</span>
      </div>
      <div class="parc-bar"><div class="parc-fill" style="width:${pct}%"></div></div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">Término: ${MESES_PT[fm-1]}/${fy} · Total restante: ${fmtV(restam*c.valor)}</div>
    </div>`;
  });
  // Ordena: quitados no final
  const containerParc = document.getElementById('relParcelamentos');
  containerParc.innerHTML = htmlParc || '<div class="empty">Nenhum parcelamento ativo.</div>';
  // Reordena: quitados por último
  const cards = Array.from(containerParc.querySelectorAll('.rel-card'));
  cards.sort((a,b) => (a.dataset.quitado==='true'?1:0) - (b.dataset.quitado==='true'?1:0));
  cards.forEach(c => containerParc.appendChild(c));

  // Carrega pagamentos pessoais e gastos para popular dropdown global
  const [pagamentos, gastosChatRaw] = await Promise.all([
    sbGet('pagamentos_mes','select=*&pago=eq.true'),
    sbGet('gastos','select=*&order=created_at.desc')
  ]);
  todosGastos = Array.isArray(gastosChatRaw) ? gastosChatRaw : [];

  // Conjunto de meses disponíveis (de pagamentos + gastos), em formato YYYY-MM
  const mesesSet = new Set();
  if(Array.isArray(pagamentos)) pagamentos.forEach(p=>{if(p.mes && /^\d{4}-\d{2}$/.test(p.mes)) mesesSet.add(p.mes);});
  todosGastos.forEach(g=>{const iso = extrairMesISO(g); if(iso) mesesSet.add(iso);});
  const mesesOrdenados = [...mesesSet].sort().reverse();

  // Popular dropdown global
  const sel = document.getElementById('relMesFiltro');
  sel.innerHTML = `<option value="all"${mesGastoFiltro==='all'?' selected':''}>Todos os meses</option>` +
    mesesOrdenados.map(m=>`<option value="${m}"${mesGastoFiltro===m?' selected':''}>${labelMesISO(m)}</option>`).join('');

  // Pagamentos por beneficiário (aplica filtro de mês)
  porBenefGlobal={};
  if(Array.isArray(pagamentos)){
    pagamentos.forEach(p=>{
      const c=contas.find(x=>x.id===p.conta_id);
      if(!c||c.tipo!=='pessoal')return;
      if(mesGastoFiltro!=='all' && p.mes !== mesGastoFiltro) return;
      const key=c.beneficiario;
      if(!porBenefGlobal[key]){porBenefGlobal[key]={total:0,items:[]};}
      porBenefGlobal[key].total+=p.valor_pago||c.valor;
      const mesExiste=porBenefGlobal[key].items.find(i=>i.mes===p.mes&&i.nome===c.nome);
      if(mesExiste)mesExiste.val+=(p.valor_pago||c.valor);
      else porBenefGlobal[key].items.push({mes:p.mes,val:p.valor_pago||c.valor,nome:c.nome});
    });
  }

  // Filtros de beneficiário
  const benefNomes = Object.keys(porBenefGlobal).sort();
  benefSelecionados = new Set(benefNomes);
  let htmlFiltros = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">`;
  htmlFiltros += `<button class="fbtn on-all" id="bf-__all__" onclick="toggleBenef('__all__',this)">Todos</button>`;
  benefNomes.forEach(n=>{
    const id=n.replace(/\s+/g,'_');
    htmlFiltros+=`<button class="fbtn on-all" id="bf-${id}" onclick="toggleBenef('${n}',this)">${n}</button>`;
  });
  htmlFiltros+=`</div>`;
  htmlFiltros+=`<div id="relBenefCards"></div>`;
  document.getElementById('relBeneficiario').innerHTML=htmlFiltros;
  renderBenefCards();

  renderGastos();
}

function toggleBenef(nome, btn){
  if(nome==='__all__'){
    const todos=Object.keys(porBenefGlobal);
    if(benefSelecionados.size===todos.length){
      benefSelecionados.clear();
    } else {
      benefSelecionados=new Set(todos);
    }
  } else {
    if(benefSelecionados.has(nome)) benefSelecionados.delete(nome);
    else benefSelecionados.add(nome);
  }
  // Atualizar visual dos botões
  Object.keys(porBenefGlobal).forEach(n=>{
    const id='bf-'+n.replace(/\s+/g,'_');
    const b=document.getElementById(id);
    if(b) b.className=benefSelecionados.has(n)?'fbtn on-all':'fbtn';
  });
  const allBtn=document.getElementById('bf-__all__');
  if(allBtn) allBtn.className=benefSelecionados.size===Object.keys(porBenefGlobal).length?'fbtn on-all':'fbtn';
  renderBenefCards();
}

function renderBenefCards(){
  const el=document.getElementById('relBenefCards');
  if(!el)return;
  const selecionados=Object.entries(porBenefGlobal)
    .filter(([n])=>benefSelecionados.has(n))
    .sort((a,b)=>b[1].total-a[1].total);

  if(!selecionados.length){
    el.innerHTML='<div class="empty">Selecione um beneficiário.</div>';
    return;
  }

  let html='';
  selecionados.forEach(([nome,info])=>{
    // Agrupar por nome da conta
    const porConta={};
    info.items.forEach(i=>{
      if(!porConta[i.nome])porConta[i.nome]={total:0,meses:[]};
      porConta[i.nome].total+=i.val;
      porConta[i.nome].meses.push({mes:i.mes,val:i.val});
    });
    html+=`<div class="rel-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="rel-nome">${nome}</div>
        <span style="font-size:14px;font-weight:600;color:var(--blue)">${fmtV(info.total)}</span>
      </div>
      ${Object.entries(porConta).map(([conta,d])=>`
        <div style="font-size:12px;color:var(--text2);font-weight:500;margin:4px 0 2px">${conta}</div>
        ${d.meses.sort((a,b)=>a.mes.localeCompare(b.mes)).map(m=>`
          <div class="rel-row"><span style="color:var(--text3)">${m.mes}</span><span>${fmtV(m.val)}</span></div>
        `).join('')}
        <div class="rel-row" style="font-size:12px"><span>Subtotal</span><span style="font-weight:500">${fmtV(d.total)}</span></div>
      `).join('')}
    </div>`;
  });
  el.innerHTML=html;
}

function filtrarCat(cat, btn){
  catAtual = cat;
  document.querySelectorAll('[id^="catBtn"]').forEach(b=>{
    b.className='fbtn';
  });
  btn.className='fbtn on-all';
  renderGastos();
}

function renderGastos(){
  // Aplica filtros: categoria + mês (filtro vem do dropdown global)
  let lista = todosGastos;
  if(catAtual !== 'all'){
    lista = lista.filter(g=>{
      const c=(g.categoria||'').toLowerCase();
      return c.includes(catAtual.toLowerCase());
    });
  }
  if(mesGastoFiltro !== 'all'){
    lista = lista.filter(g => extrairMesISO(g) === mesGastoFiltro);
  }

  if(!lista.length){
    document.getElementById('relGastos').innerHTML = '<div class="empty">Nenhum gasto neste filtro.</div>';
    return;
  }

  // Agrupar por categoria para totais
  const porCat={};
  lista.forEach(g=>{
    const cat=g.categoria||'Outros';
    if(!porCat[cat])porCat[cat]={total:0,items:[]};
    porCat[cat].total+=g.valor||0;
    porCat[cat].items.push(g);
  });

  const totalGeral=lista.reduce((s,g)=>s+(g.valor||0),0);
  let html = `<div style="background:var(--blue-l);border:1px solid var(--blue-m);border-radius:var(--rs);padding:10px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:12px;color:var(--blue);font-weight:600">${lista.length} gastos</span>
    <span style="font-size:16px;font-weight:600;color:var(--blue)">${fmtV(totalGeral)}</span>
  </div>`;

  Object.entries(porCat).sort((a,b)=>b[1].total-a[1].total).forEach(([cat,info])=>{
    html+=`<div class="rel-card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div class="rel-nome">${cat}</div>
        <span style="font-size:13px;font-weight:600;color:var(--blue)">${fmtV(info.total)}</span>
      </div>
      ${info.items.slice(0,5).map(g=>`<div class="rel-row">
        <span style="color:var(--text2)">${g.descricao||''} · ${g.data_lancamento||''}</span>
        <span>${fmtV(g.valor)}</span>
      </div>`).join('')}
      ${info.items.length>5?`<div style="font-size:11px;color:var(--text3);margin-top:4px">+${info.items.length-5} mais</div>`:''}
    </div>`;
  });

  document.getElementById('relGastos').innerHTML=html;
}

function setMesGastoFiltro(mes){
  mesGastoFiltro = mes;
  // Recarrega relatório inteiro pra aplicar filtro nos beneficiários também
  carregarRelatorio();
}

// CHAT IA
// Monta system prompt dinâmico baseado em dados reais do banco (não hardcoded)

export { carregarRelatorio, toggleBenef, renderBenefCards, filtrarCat, renderGastos, setMesGastoFiltro };

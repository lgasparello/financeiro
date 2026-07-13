// app.js — ponto de entrada (ES module). Compoe o grafo de modulos, faz a ponte das funcoes
// para window (os 86 handlers inline do HTML dependem do escopo global) e roda o init.
import * as uiContas from './ui-contas.js';
import * as uiRetirada from './ui-retirada.js';
import * as uiRelatorio from './ui-relatorio.js';
import * as uiPainel from './ui-painel.js';
import * as uiGraficos from './ui-graficos.js';
import * as chat from './chat-ia.js';
// Nomeados usados diretamente por showTab/gerarJSON/init (codigo movido verbatim):
import { carregarRelatorio } from './ui-relatorio.js';
import { atualizarRetirada } from './ui-retirada.js';
import { carregarPainel } from './ui-painel.js';
import { carregarGraficos } from './ui-graficos.js';
import { atualizarContas, verificarNotificacoes } from './ui-contas.js';
import { sendMsg } from './chat-ia.js';
import { ajustarSaldo, carregarSaldos, mesLabel, limparCacheFinanceiro } from './calculo.js';
import { sbGet, carregarContas } from './dados.js';
import { mesAtual, mesRet } from './estado.js';
import { AUTH_ENABLED } from './config.js';
import { garantirSessao, enviarLink, logout } from './auth.js';
import { renderRazaoBadge, wireOfxImport } from './ui-razao.js';

// --- Navegacao entre abas + exportacao JSON (orquestracao) ---
async function gerarJSON(){
  const gastos=await sbGet('gastos','select=*&order=created_at.desc&limit=50');
  const pagsMes=await sbGet('pagamentos_mes','select=*&pago=eq.true&order=created_at.desc&limit=50');
  document.getElementById('inp').value=`Gere o JSON para o agente Excel com estes dados:\nGastos: ${JSON.stringify(gastos?.slice?.(0,10)||[])}\nPagamentos: ${JSON.stringify(pagsMes?.slice?.(0,10)||[])}`;
  showTab('chat',document.querySelectorAll('.tb')[3]);
  sendMsg();
}

function showTab(id,btn){
  document.querySelectorAll('.pnl').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.tb').forEach(b=>b.classList.remove('on'));
  document.getElementById('pnl-'+id).classList.add('on');btn.classList.add('on');
  if(id==='relatorio')carregarRelatorio();
  if(id==='retirada')atualizarRetirada();
  if(id==='painel')carregarPainel();
  if(id==='graficos')carregarGraficos();
}

// NOTIFICAÇÕES DE CONTAS VENCENDO

// --- Ponte para o window: expoe todos os exports de UI/chat + ajustarSaldo/showTab/gerarJSON.
// retSels entra via spread de uiRetirada. Reproduz o namespace global do index.html original.
Object.assign(window, uiContas, uiRetirada, uiRelatorio, uiPainel, uiGraficos, chat, { ajustarSaldo, showTab, gerarJSON });

// --- Carrega o app (só roda quando autorizado) ---
async function carregarApp(){
  limparCacheFinanceiro();
  await carregarSaldos();
  await carregarContas();
  await atualizarContas();
  verificarNotificacoes();
  document.getElementById('mesLabel').textContent=mesLabel(mesAtual.y,mesAtual.m);
  document.getElementById('mesLabelRet').textContent=mesLabel(mesRet.y,mesRet.m);
  // Livro-razão: selo de saldo auditável + import de OFX (aba Painel)
  wireOfxImport();
  renderRazaoBadge();
  if(AUTH_ENABLED){
    const sub=document.getElementById('hdrSub');
    if(sub){ sub.style.cursor='pointer'; sub.title='Toque para sair'; sub.onclick=()=>{ if(confirm('Sair da conta?')) logout(); }; }
  }
}

// --- Tela de login (trava o app até o usuário entrar) ---
function mostrarLogin(){
  const gate=document.getElementById('loginGate');
  const btn=document.getElementById('loginBtn'), inp=document.getElementById('loginEmail'), msg=document.getElementById('loginMsg');
  if(!gate||!btn||!inp) return;
  gate.style.display='flex';
  const enviar=async()=>{
    const email=(inp.value||'').trim();
    if(!email || !email.includes('@')){ msg.textContent='Digite um e-mail válido.'; return; }
    btn.disabled=true; msg.textContent='Enviando...';
    const r=await enviarLink(email);
    btn.disabled=false;
    msg.textContent = r.ok
      ? '✅ Link enviado! Abra seu e-mail e clique no link para entrar.'
      : '❌ Não consegui enviar: '+(r.erro||'tente de novo')+'.';
  };
  btn.onclick=enviar;
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter') enviar(); });
}

// --- Entrada ---
(async()=>{
  if(AUTH_ENABLED){
    const logado=await garantirSessao();
    if(!logado){ mostrarLogin(); return; } // não carrega dados enquanto não logar
  }
  await carregarApp();
})();

// --- PWA: registra o service worker (app-shell offline). Falha silenciosa se nao suportado. ---
// O modulo ja executa apos o parse do DOM, entao registra direto (sem esperar 'load').
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}

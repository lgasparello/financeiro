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

// --- Init ---
(async()=>{
  limparCacheFinanceiro();
  await carregarSaldos();
  await carregarContas();
  await atualizarContas();
  verificarNotificacoes();
  document.getElementById('mesLabel').textContent=mesLabel(mesAtual.y,mesAtual.m);
  document.getElementById('mesLabelRet').textContent=mesLabel(mesRet.y,mesRet.m);
})();

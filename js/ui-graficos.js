// ui-graficos.js — aba Graficos (Chart.js). 'Chart' vem do <script> classico do CDN (global).
import { MESES_PT } from './config.js';
import { sbGet } from './dados.js';
import { calcularMes, fmtV, limparCacheFinanceiro } from './calculo.js';

// --- Instancias de Chart (para destruir/recriar ao trocar filtro) ---
let chartsInstances = {};

async function carregarGraficos(){
  limparCacheFinanceiro();
  const ano = parseInt(document.getElementById('gfAno')?.value || 2026);
  const mesIni = parseInt(document.getElementById('gfMesIni')?.value || 1);
  const mesFim = parseInt(document.getElementById('gfMesFim')?.value || 4);

  // Gerar lista de meses no período
  const meses = [];
  const labels = [];
  for(let m = mesIni; m <= mesFim; m++){
    meses.push(`${ano}-${String(m).padStart(2,'0')}`);
    labels.push(`${MESES_PT[m-1].slice(0,3)}/${String(ano).slice(2)}`);
  }

  const dados = await Promise.all(meses.map(m => calcularMes(m)));

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const textColor = isDark ? '#8b93a8' : '#5a6278';
  const gridColor = isDark ? '#2a3348' : '#e0e3e8';

  Object.values(chartsInstances).forEach(c => { try{c.destroy();}catch(e){} });
  chartsInstances = {};

  // 1. Lucro líquido
  chartsInstances.lucro = new Chart(document.getElementById('chartLucro'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Lucro Líquido',
        data: dados.map(d => Math.round(d.lucro)),
        backgroundColor: dados.map(d => d.lucro >= 0 ? '#3B6D11' : '#A32D2D'),
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, callback: v => 'R$'+Number(v).toLocaleString('pt-BR') }, grid: { color: gridColor } }
      }
    }
  });

  // 2. Receita vs Custos vs Impostos
  chartsInstances.receita = new Chart(document.getElementById('chartReceita'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Receita', data: dados.map(d => Math.round(d.receita)), backgroundColor: '#185FA5', borderRadius: 4 },
        { label: 'Custos', data: dados.map(d => Math.round(d.cf + d.cv)), backgroundColor: '#BA7517', borderRadius: 4 },
        { label: 'Impostos', data: dados.map(d => Math.round(d.impostos)), backgroundColor: '#A32D2D', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: textColor, boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, callback: v => 'R$'+Number(v).toLocaleString('pt-BR') }, grid: { color: gridColor } }
      }
    }
  });

  // 3. Gastos pessoais por categoria (período selecionado)
  const gastosPromises = meses.map(ms => {
    return sbGet('gastos', `select=*&mes=eq.${ms}&conta=eq.pessoal`);
  });
  const gastosResultados = await Promise.all(gastosPromises);
  const porCat = {};
  gastosResultados.forEach(raw => {
    if(Array.isArray(raw)) raw.forEach(g => {
      const cat = g.categoria || 'Outros';
      porCat[cat] = (porCat[cat] || 0) + g.valor;
    });
  });
  const catLabels = Object.keys(porCat).sort((a,b) => porCat[b]-porCat[a]);
  const catVals = catLabels.map(k => Math.round(porCat[k]));
  const catColors = ['#185FA5','#3B6D11','#BA7517','#A32D2D','#3C3489','#0F6E56','#854F0B','#5a6278','#378ADD','#97C459'];
  chartsInstances.cat = new Chart(document.getElementById('chartCategorias'), {
    type: 'doughnut',
    data: {
      labels: catLabels,
      datasets: [{ data: catVals, backgroundColor: catColors.slice(0, catLabels.length), borderWidth: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor, boxWidth: 12, padding: 8 } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmtV(ctx.parsed)}` } }
      }
    }
  });

  // 4. Lucro acumulado 2026
  let acum = 0;
  const acumData = dados.map(d => { acum += d.lucro; return Math.round(acum); });
  chartsInstances.saldo = new Chart(document.getElementById('chartSaldo'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Lucro acumulado 2026',
        data: acumData,
        borderColor: '#185FA5',
        backgroundColor: 'rgba(24,95,165,0.1)',
        fill: true, tension: 0.4,
        pointBackgroundColor: '#185FA5', pointRadius: 5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { labels: { color: textColor } } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, callback: v => 'R$'+Number(v).toLocaleString('pt-BR') }, grid: { color: gridColor } }
      }
    }
  });
}


export { carregarGraficos };

// config.js — constantes centralizadas (URLs, chaves, categorias, componentes de retirada).
// Fonte unica de verdade. As <option> do HTML e o SYS prompt da IA espelham CATEGORIAS.

export const SB_URL='https://reymsbccsnjesqmqcqei.supabase.co';
export const SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJleW1zYmNjc25qZXNxbXFjcWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NzI2MTMsImV4cCI6MjA5MjQ0ODYxM30.vQa61UqiUyKqYC8G7owMB6vyyjwnrbwqfhb9_A-lxiU';
export const SB_HDR={'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Content-Type':'application/json'};

export const MESES_PT=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// Categorias de gasto variavel (mesmas do app e do SYS prompt da IA).
export const CATEGORIAS=['Alimentação','Combustível','Lazer','Pet','Compras','Farmácia','Filhos','Outros'];

// Componente de retirada 'Lucros': fallback injetado quando nao vem do banco (tabela componentes_retirada).
export const LUCROS_FALLBACK={id:99,nome:'Lucros',chave:'lucros',valor:0,ativo:true,mes_fim:null};

// Liga/desliga o login por link magico. Comece FALSE (app roda como hoje, via anon).
// No go-live: vira true + deploy + configurar redirect no Supabase + habilitar RLS.
export const AUTH_ENABLED=true;

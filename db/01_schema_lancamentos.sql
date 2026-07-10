-- ============================================================================
-- Livro-razão (append-only) — a base de "saldo confiável e auditável".
-- Rode isto no Supabase (SQL Editor). Não apaga nada do que já existe.
--
-- Ideia: hoje o saldo é um número mutável em `saldos` (frágil, sem histórico).
-- Aqui o saldo passa a ser DERIVADO: cada movimento que toca uma conta vira
-- UMA linha imutável em `lancamentos`, e o saldo é a SOMA delas.
-- ============================================================================

create table if not exists public.lancamentos (
  id            bigint generated always as identity primary key,
  data          date          not null,                    -- quando entrou/saiu de fato
  conta         text          not null check (conta in ('llg','pessoal')),
  valor         numeric(14,2) not null,                    -- ASSINADO: <0 saída, >0 entrada
  tipo          text          not null,                    -- pagamento|gasto|retirada_saida|retirada_entrada|receita|abertura|ajuste|conciliacao
  descricao     text,
  mes           text,                                      -- 'YYYY-MM' p/ filtro rápido
  origem_tabela text,                                      -- pagamentos_mes|gastos|retiradas|receitas|manual
  origem_id     text,                                      -- id na tabela de origem (rastreio)
  conciliado    boolean       not null default false,      -- casado com o extrato C6?
  extrato_ref   text,                                      -- id da linha do extrato quando conciliado
  created_at    timestamptz   not null default now()
);

-- Idempotência: um mesmo movimento de origem não entra duas vezes
-- (deixa a migração ser re-executável sem duplicar).
create unique index if not exists lancamentos_origem_uniq
  on public.lancamentos (origem_tabela, origem_id, tipo)
  where origem_tabela is not null and origem_id is not null;

create index if not exists lancamentos_conta_data_idx on public.lancamentos (conta, data);
create index if not exists lancamentos_mes_idx        on public.lancamentos (mes);

-- Saldo derivado: a verdade passa a ser a soma do razão.
-- (o app pode ler daqui em vez da tabela `saldos`)
create or replace view public.saldos_derivados as
  select conta, coalesce(sum(valor), 0)::numeric(14,2) as saldo
  from public.lancamentos
  group by conta;

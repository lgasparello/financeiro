-- ============================================================================
-- SEGURANÇA (RLS) — trava TODAS as tabelas para o SEU e-mail.
-- Rode isto no Supabase (SQL Editor) SÓ NO GO-LIVE — ou seja, DEPOIS que:
--   1) o app com AUTH_ENABLED=true estiver publicado (Vercel), e
--   2) você tiver conseguido logar pelo menos uma vez.
-- Se rodar antes disso, o app publicado (que ainda usa acesso anônimo) para de
-- funcionar até você logar. Por isso é o ÚLTIMO passo.
--
-- Depois de ligado: qualquer acesso sem login (anônimo) é bloqueado, e mesmo
-- alguém logado com OUTRA conta não vê nada — só o e-mail abaixo passa.
-- ============================================================================

-- >>> TROQUE se você for logar com outro e-mail <<<
do $$
declare
  meu_email text := 'llucas.gasparello@gmail.com';
  t text;
  tabelas text[] := array[
    'contas_fixas','pagamentos_mes','gastos','retiradas','receitas',
    'impostos','agendamentos','componentes_retirada','saldos','lancamentos'
  ];
begin
  foreach t in array tabelas loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists so_dono on public.%I;', t);
    execute format(
      'create policy so_dono on public.%I for all to authenticated using ((auth.jwt() ->> ''email'') = %L) with check ((auth.jwt() ->> ''email'') = %L);',
      t, meu_email, meu_email
    );
  end loop;
end $$;

-- Conferência: deve listar as 10 tabelas com rowsecurity = true
-- select relname, relrowsecurity from pg_class where relname = any(array[
--   'contas_fixas','pagamentos_mes','gastos','retiradas','receitas',
--   'impostos','agendamentos','componentes_retirada','saldos','lancamentos']);

-- ----------------------------------------------------------------------------
-- PARA DESFAZER (se algo der errado e você quiser voltar ao estado anterior):
-- do $$ declare t text; tabelas text[] := array['contas_fixas','pagamentos_mes',
--   'gastos','retiradas','receitas','impostos','agendamentos',
--   'componentes_retirada','saldos','lancamentos']; begin
--   foreach t in array tabelas loop
--     execute format('drop policy if exists so_dono on public.%I;', t);
--     execute format('alter table public.%I disable row level security;', t);
--   end loop; end $$;
-- ----------------------------------------------------------------------------

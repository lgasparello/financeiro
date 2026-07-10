# Bugs pré-existentes (encontrados durante a refatoração)

Estes bugs **já existiam** no `index.html` monolítico antes da refatoração e foram
**preservados exatamente** (comportamento inalterado). Estão anotados aqui para
correção numa etapa futura — a refatoração desta sessão não os toca.

Referências de linha são do `index.html` **original** (commit `05c89da`, antes da separação).

---

## 1. `sg()` e `hk()` nunca são definidos

- **Onde:** `index.html` (HTML)
  - `onclick="sg(this)"` nos 5 chips de sugestão do chat (linhas ~451–455)
  - `onkeydown="hk(event)"` no textarea do chat (linha ~491)
- **Problema:** não existe nenhuma definição de `sg` nem `hk` em lugar nenhum do
  script. Confirmado por busca em todo o arquivo.
- **Efeito:**
  - Clicar num chip de sugestão ("Contas pendentes", "Parcelas moto", etc.) dispara
    `ReferenceError: sg is not defined` — o chip **não faz nada** (não preenche o input
    nem envia).
  - Pressionar teclas no campo de mensagem dispara `hk is not defined` a cada tecla;
    em particular **Enter não envia** a mensagem (cai no comportamento default do
    textarea = quebra de linha). Só o botão de enviar (avião) funciona.
- **Correção provável (futuro):** implementar
  `function sg(el){ document.getElementById('inp').value = el.textContent; sendMsg(); }`
  e `function hk(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMsg(); } }`.
  (Não implementado agora para não mudar comportamento.)

## 2. `normalizarMesIA` fora de escopo em `enviarFoto`

- **Onde:** `enviarFoto()` chama `normalizarMesIA(parsed.mes)` (linha ~2397 do original).
- **Problema:** `normalizarMesIA` é declarada **aninhada dentro** de `processarAcaoChat`
  (linha ~2115), então só existe no escopo daquela função. `enviarFoto` é uma função
  irmã e não enxerga esse identificador.
- **Efeito:** ao registrar um gasto a partir de **foto de nota fiscal**, a linha que
  chama `normalizarMesIA` lança `ReferenceError`, caindo no `catch` de `enviarFoto`
  ("Erro ao processar imagem."). O fluxo de foto quebra na hora de normalizar o mês.
- **Nota de refatoração:** para preservar o comportamento, `normalizarMesIA` foi
  mantida **aninhada** em `processarAcaoChat` no módulo `chat-ia.js` — não foi
  promovida a função de módulo. Promovê-la "consertaria" o bug, o que seria uma
  mudança de comportamento.
- **Correção provável (futuro):** mover `normalizarMesIA` para o escopo do módulo
  `chat-ia.js` (ou `calculo.js`) e exportá-la, para que `enviarFoto` a use.

## 3. IDs de elemento duplicados no "Gasto rápido"

- **Onde:** existem dois blocos "Gasto rápido" no HTML — um no topo (`#gastoRapido`,
  linhas ~236–262 do original) e outro dentro do chat (`#gastoRapidoChat`,
  linhas ~459–485). **Ambos** usam os mesmos IDs: `grDesc`, `grValor`, `grCat`, `grConta`.
- **Problema:** IDs devem ser únicos. `document.getElementById('grDesc')` sempre
  retorna o **primeiro** do DOM (o do bloco do topo `#gastoRapido`).
- **Efeito:** `salvarGastoRapido()` e `toggleGastoRapido()` sempre leem/escrevem nos
  campos do bloco do topo, mesmo quando o usuário digitou no bloco do chat. Como o
  bloco do topo (`#gastoRapido`) fica com `display:none` e nunca é aberto pela UI
  atual (o botão `+` e o `⚡` abrem o `#gastoRapidoChat`), o usuário digita no bloco do
  chat mas os valores lidos vêm dos campos vazios do topo → o gasto pode sair com
  descrição/valor errados ou a validação barra ("Descrição precisa ter ao menos 2
  caracteres").
- **Correção provável (futuro):** dar IDs únicos aos campos do bloco do chat
  (ex.: `grDescChat`) e ajustar `salvarGastoRapido`/`toggleGastoRapido`, ou remover o
  bloco `#gastoRapido` do topo se ele estiver morto.

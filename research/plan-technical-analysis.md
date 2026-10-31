# BeConfident — origem dos resultados no plano

Consulta em 29/10/2026, America/Sao_Paulo. Foi acessada apenas a URL exata de plano indicada pelo agente principal, com seus parâmetros originais. Nenhum identificador foi trocado ou enumerado. Não houve clique em “Ver meu plano de 30 dias”, avanço de etapa ou edição de perfil. A análise usa um Chrome temporário do MCP REA, separado do navegador pessoal.

## Conclusão

**Nesta execução, o nível A2 e os cinco percentuais foram recebidos de uma API e renderizados pelo frontend.** Não são números fixos embutidos na configuração de texto da landing desta versão. A resposta da API e o código que a consome explicam exatamente o que apareceu na tela.

**Isso não demonstra como o servidor calculou os números**, se usa respostas individuais, regras, modelo, dados preexistentes ou algum padrão de backend. Também não demonstra que usuários diferentes recebem valores diferentes. Essas questões permanecem abertas: não foram comparadas outras contas nem alterados os parâmetros do usuário.

## Evidência observada

O MCP REA capturou uma navegação de leitura na página `/plano/` em `go.beconfident.app`, seguida por espera de 5 segundos. A árvore acessível mostrou A2, Naturalidade 81%, Vocabulário 57%, Compreensão 72%, Pronúncia 78% e Gramática 82%.

Durante a carga da página ocorreu:

| Transação | Requisição observada | Resultado |
|---|---|---|
| `request-8` | POST `https://exp-api.beconfident.app/v1/capabilities/lead-diagnosis` | Corpo JSON de resposta retido: `found:true` com o diagnóstico abaixo. |
| `request-11` | POST `https://exp-api.beconfident.app/v1/capabilities/lead-offers` | Corpo JSON de resposta retido: ofertas de 12 e 6 meses. |

Diagnóstico retornado:

| Campo | Valor retornado e exibido | CEFR do pilar retornado pela API |
|---|---:|---|
| Nível geral | A2 | — |
| Naturalidade / `naturalness.score` | 81 | C1 |
| Vocabulário / `vocabulary.score` | 57 | B1 |
| Compreensão / `comprehension.score` | 72 | B2 |
| Pronúncia / `pronunciation.score` | 78 | C1 |
| Gramática / `grammar.score` | 82 | C1 |

A API também retorna `finishedAt`. Não há, na resposta retida, fórmula, versão de avaliador, áudio analisado ou evidência de cálculo. O frontend usa o nível geral e os scores, mas descarta os campos CEFR de cada pilar na função de validação. Assim, os CEFR dos pilares não explicam por si só o nível geral A2. Nenhum juízo sobre validade pedagógica pode ser extraído dessa diferença sem conhecer as regras de avaliação.

O corpo de resposta do diagnóstico tem 287 bytes, SHA-256 `6a2576088052a97864259d5c6603e417b602948638c8681e8d3747a49ca422f2`. A resposta foi vinculada à `request-8` por evento `network-content`, fase `response`. A captura não solicitou corpos de requisição; portanto o payload efetivamente enviado não foi observado diretamente. A forma de montar esse payload foi encontrada no JavaScript entregue, conforme abaixo.

## Encadeamento no código entregue

O script público `/plano/_astro/Page.astro_astro_type_script_index_0_lang.DTNcX9sK.js`, 30.734 bytes, define uma experiência `plano`, versão 11, e inclui as funções:

1. O SDK lê a atribuição da query e/ou cookie, incluindo o identificador do lead, idioma, funil e caminho de conversão. Esses valores não são publicados neste relatório.
2. O método `call` do SDK prepara um POST para `/v1/capabilities/<nome>`, com contexto da experiência/lead e um campo `input`. O `fetch` usa `credentials:'omit'`; isso não significa ausência de identidade, pois a identidade pode estar no corpo.
3. `dt()` chama `q.call('lead-diagnosis', {})`. Se `ok` e `output.found` forem verdadeiros, passa `output.diagnosis` para `G()`.
4. `G()` verifica que os cinco scores são números finitos de 0 a 100 e que o nível geral pertence a Pre-A1, A1, A2, B1, B2, C1 ou C2. Retorna somente nível e scores; não recalcula a avaliação.
5. `ct()` liga as chaves `naturalness`, `vocabulary`, `comprehension`, `pronunciation` e `grammar` aos rótulos traduzidos da interface.
6. `ut()` monta “Seu nível” e o texto acessível do diagnóstico; `lt()` desenha o radar e os percentuais, usando `score/100` para a geometria.

É uma leitura estática dos bytes entregues, corroborada pelos valores do DOM final e da resposta API; não foi executado um script de teste que modificasse o estado da página.

### O comportamento de fallback observado no código

A configuração `data-messages` do HTML inicial contém apenas rótulos e explicações dos pilares: nomes, textos, título e CTA. Seus itens não têm `score`.

Antes de receber diagnóstico válido, o estado interno `$` é `null`. Nesse caso `ct()` retorna array vazio e `ut()` usa os itens de texto genéricos. `lt()` só adiciona porcentagens quando `typeof item.score === 'number'` e só desenha a área preenchida quando todos os itens têm score. Portanto o fallback dessa página é um radar sem pontuações, não a sequência 81/57/72/78/82.

O corpo HTML inicial retido também não contém o texto renderizado de A2 ou “Naturalidade81”. Esses valores aparecem no DOM final depois da requisição de diagnóstico.

## Ofertas obtidas em paralelo

O mesmo script chama `q.call('lead-offers', {lang, funnelId...})`, espera a atribuição ficar pronta, prioriza a oferta marcada como `default` e associa ofertas às opções de 6 e 12 meses. Nesta execução a API retornou:

| Duração | Moeda | Total | Parcelamento retornado | Padrão |
|---|---|---:|---:|---|
| 12 meses | BRL | 598 | 12 × 56,511916882696546 | Sim |
| 6 meses | BRL | 398 | 12 × 37,61161023296526 | Não |

O arredondamento esperado da oferta anual coincide com o R$56,51 observado no checkout. A API de ofertas demonstra a origem desses valores na página; não foi feito checkout nem assumida a disponibilidade da compra sem outras condições. A tela de ofertas posterior não foi aberta por este agente.

## Identidade técnica e limites

As URLs dos assets incluem `/_astro/` e nome de script gerado com `.astro_astro_type_script`, indícios diretos de build Astro desta superfície. Ela é distinta da home Framer e do checkout Nuxt. Foram observadas também chamadas `t.beconfident.app/v1/config` e `/v1/events`, usadas pelo código de experiência/telemetria. Nenhuma conclusão sobre o motor de ensino ou seus provedores decorre dessas dependências.

| Pergunta | Estado após investigação |
|---|---|
| Os percentuais vêm do frontend fixo? | Nesta versão/executão, vêm da resposta `lead-diagnosis`; fallback local não tem percentuais. |
| A API devolveu exatamente o que a interface mostrou? | Sim, correspondência dos cinco scores e do nível geral. |
| A consulta é contextualizada por lead? | O SDK entregue constrói contexto de lead e a página foi aberta com atribuição do usuário; corpo real da requisição não foi capturado. |
| Os números são calculados individualmente no backend? | Não estabelecido por esta captura. |
| Usuários diferentes recebem números diferentes? | Não investigado; não houve acesso a outros identificadores. |
| Fórmula, prompts, inputs de voz e calibração CEFR | Desconhecidos. |

## Registros preservados

- Captura MCP REA: **`ev_0a9d96512b7d73dd21a6dcdcb8e403c722c56801ae0f5f0e085a84c817f0eb1b`**. 57 eventos retidos, zero omitidos; status complete para o escopo selecionado. Todas as ações concluídas, processo temporário encerrado.
- Exportação de scripts: **`ev_6516d8f3647f58b90f4ce9ed9d947d404aa493acfa646c74cf96d1b8446425fb`**. Três scripts retidos com digest/manifest; beacon Cloudflare sem corpo exportável.
- Análise estática REA: **`ev_3a1710280b6deac778097ac73f4f08d0492992b87c7dce82114466d5a0bef80e`**. Um script selecionado, 8.321 nós AST, zero falhas de parsing; duas dependências inventariadas ficaram fora da análise semântica.
- `research/evidence/rea-plan-bundle.json`: export bruto local da sessão REA; inclui este trabalho e registros anteriores. Contém parâmetros do usuário e não deve ser publicado.
- `research/evidence/plan-capture.raw.json`, `plan.raw.html`, `plan-initial.raw.html`: artefatos brutos locais.
- Derivados com identificadores removidos: `plan-capture.redacted.json`, `plan.redacted.html`, `plan-initial.redacted.html`.
- `plan-diagnosis-response.json`, `plan-offers-response.json`, `plan-messages.json`, `plan-accessibility.json` e `plan-network-summary.json`: dados e índices extraídos para inspeção.
- `plan-scripts/manifest.json` e `files/`: bytes de scripts e identidade por SHA-256.
- `research/extract-plan.cjs`: extração local reprodutível, sem execução do HTML/scripts alvo.

“Complete” significa captura completa dentro da janela e dos campos selecionados. Não significa cobertura de toda a plataforma. O REA preserva ordem de recebimento, e response bodies vêm da API Playwright, sem garantia de equivalência a bytes originais no fio.

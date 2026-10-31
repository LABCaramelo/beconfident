# BeConfident — investigação técnica do site público

Consulta em 29/10/2026, fuso America/Sao_Paulo. Escopo desta análise: site público, scripts que ele entrega, clique real no CTA de teste e redirecionamentos públicos até a página intermediária do WhatsApp. O navegador pessoal e a conversa autenticada foram analisados separadamente pelo agente principal.

## Conclusão

O site público é uma landing page multilíngue publicada no Framer. A ação principal conduz a um funil próprio de aquisição que cria/atribui um identificador de lead e monta uma mensagem de convite para o WhatsApp. O site de marketing não entrega o motor pedagógico, os prompts, os modelos de voz/LLM, o banco de dados ou a implementação do aplicativo móvel. A observação do site permite reproduzir sua estrutura, linguagem visual e passagem de campanha para conversa; a reconstrução do produto precisa de implementação própria desses serviços e de validação adicional dos fluxos autenticados.

## Evidências e cobertura

| ID | Operação e conteúdo | Cobertura real |
|---|---|---|
| `ev_8f33537d40a5a04290c19b31669583a7c72f5ed615ef64dc864ca03ac43d3650` | MCP REA `capture_browser_scenario`: home desktop, espera de 4 s, DOM e acessibilidade | 300 eventos retidos, 406 omitidos; orçamento de 150 transações; estado final DOM/acessibilidade capturado. Rede incompleta. |
| `ev_674a9e564f44cf24c41e2f88239d9a0c67692e21d8f1c4e7510a48c317692a79` | REA `export_web_scripts` da primeira captura | Nenhum script externo tinha corpo exportável; manifest registra indisponibilidade, sem refetch. |
| `ev_0505a38ce3e3bdc24591888cd951c0f0d55a8b5c92e6df25a3a45923cb2b4ec2` | REA `analyze_javascript_application` sobre scripts inline extraídos do DOM | 9 scripts selecionados; 11.998 bytes; 2.535 nós AST; zero falhas de parsing. Outros 16 arquivos inventariados fora do escopo. Análise estática, sem executar scripts. |
| `ev_d5ecc1aaee1dba612481e220aab68a6076c2cfb77449014cf0ac9bde29c5e87a` | Segunda captura, orçamento ampliado | Clique recusado por seletor com 5 elementos; não usado como prova do fluxo CTA. 357 eventos, 295 drops. |
| `ev_454590d7d446e921729b3d704cb3fb8fd3266524620e163921fe81c1c07df8f1` | Captura controlada corrigida: home → CTA de `#hero` → espera de 4 s → DOM/acessibilidade final | Todas as ações concluídas. 826 eventos retidos e 8 corpos de rede omitidos por orçamento de alocação. Metadados do redirecionamento e scripts principais preservados. |
| `ev_25e577661b954cb9f94a9fd207c36887f711bd253e30e49abbb8867504b4edbe` | REA `export_web_scripts` da captura corrigida | Scripts retidos exportados com SHA-256 e manifest. Inclui 13 módulos de caminho do site Framer; arquivo `default-utils` isolado por layout de URL. Não afirma execução de todos os módulos. |
| `ev_a6f3caf11f58cb5e87f9fc32b0aa30039994c69f4ee2350b4ae3ab6f4759eb5a` | REA estático sobre 4 módulos de bootstrap/componentes do site exportado | 28.688 bytes; 5.562 nós AST; 157 findings; zero falhas de parsing. 44 arquivos do inventário não analisados semanticamente. |

As capturas foram feitas com Chrome/Chromium 156.0.8078.48 em processo temporário pertencente ao REA, viewport 1440 × 1000, locale pt-BR, timezone America/Sao_Paulo, service workers bloqueados e movimento reduzido. O REA encerrou os processos que lançou. Não houve captura visual/screenshot nesses cenários. Não foi enviado texto ao bot por esses cenários: a última tela foi a página pública de continuar para o WhatsApp. A ordem de eventos é ordem de recebimento do observador; não prova causalidade concorrente. A fonte Playwright de response bodies pode fazer carregamento complementar para obter bytes; o digest identifica os bytes fornecidos pela API, não um pacote de rede original.

## Fluxo de aquisição observado de ponta a ponta

Na captura final, o REA executou a espera, o clique em `#hero a[href^='https://start.beconfident.app/lead/r/whatsapp/']` e a espera posterior. Os seguintes GETs e status aparecem ligados por `redirected_from_transaction_id`:

| Transação | Origem/caminho | Resposta |
|---|---|---|
| `request-164` | `start.beconfident.app/lead/r/whatsapp/teste-gratuito-beconfident` | 302 |
| `request-165` | `start.beconfident.app/whatsapp` | 302 |
| `request-166` | `api.beconfident.app/v3/lead/redirect-to-whatsapp` | 302 |
| `request-167` | `wa.me/5511955946656` | 302 |
| `request-168` | `api.whatsapp.com/send/` | 200 |

O CTA de entrada recebe `_fbp`, `_ttp`, `lang`, `externalAnalyticsId` e `_gl`. O próximo salto transporta `utm_campaign=teste-gratuito-website-beconfident`, `utm_source=website`, `utm_medium=organic`, `domainReferrer`, `leadId`, `fbp`, `ttp` e `lang`. Os valores únicos de rastreamento não são repetidos neste relatório; estão no registro bruto.

O texto formado em `wa.me` contém a intenção de aprender inglês e o marcador `teste-gratuito-website-beconfident|<leadId>`. A página final se identifica como BeConfident e oferece “Abrir app” e “Continuar para o WhatsApp Web”, ambas com mensagem preenchida. No salto de `wa.me` para `api.whatsapp.com`, os emojis originais foram convertidos em caracteres de substituição `�`; essa diferença também aparece na acessibilidade final. É uma observação desta execução, sem determinar qual componente faz a conversão.

**Inferência forte:** `leadId` liga a origem comercial do visitante à mensagem inicial recebida no WhatsApp. O mesmo identificador é transportado na query e no convite. Isso não revela a tabela interna nem a regra de ativação, duração ou limite do teste gratuito.

Os headers observados no endpoint da API incluem nomes `cf-*`, `x-kong-*` e `x-powered-by`. Os valores não foram solicitados. Portanto há indícios de proxy/gateway nessa superfície, sem prova suficiente do framework de backend, hospedagem ou desenho dos serviços.

## Site, dependências e estrutura

**Observado no HTML:** `<meta name="generator" content="Framer 6396d1e">`, página `lang="pt-BR"`, canonical `https://beconfident.app/`, título BeConfident e descrição “Aprenda inglês com IA, prática e confiança.” Há índice público de busca Framer e alternates para espanhol, inglês e alemão.

**Observado em imports/URLs de módulos entregues:** runtime Rolldown, React, Framer, Motion e DotLottie. O bundle principal `script_main.DBYFcd5n.mjs` importa runtime, React, Framer e `toplevel-deps`; os componentes importam os módulos de Motion, DotLottie e utilitários. Isso sustenta a identificação do frontend publicado; não descreve a stack do app móvel.

Módulos públicos relevantes exportados:

| Arquivo | Bytes retidos | Papel inferido por imports/conteúdo |
|---|---:|---|
| `script_main.DBYFcd5n.mjs` | 20.664 | Inicialização/rotas Framer |
| `3pVzH61wbMJkTCaivlaOQECjjUJThQaSOOW27mUQZF0.3quwHz6Z.mjs` | 591.032 | Composição da página, seções, cópia e referências a assets |
| `v56puG4Uq.D4WMnjIA.mjs` | 1.126.476 | Componentes e variantes localizadas |
| `react.D0uBoqx3.mjs` | 145.050 | Runtime React |
| `framer.0fAjhieR.mjs` | 422.506 | Runtime Framer |
| `motion.CSLdAJh4.mjs` | 155.456 | Animação |
| `DotLottie.D7OwNiI8.mjs` | 462.329 | Componente/runtime de animação Lottie |

Alguns arquivos declaram `sourceMappingURL` para `.mjs.map`; esses mapas não foram buscados nesta análise. Ter uma declaração não prova que o mapa está público nem que contém fontes originais.

A árvore acessível e os `data-framer-name` permitem identificar: navegação/menu e idiomas; hero com CTA; promessa de prática; prova social/mapa; demonstração conversacional e integrações; carrossel Masters; teste em 3 passos; prêmios/mídia; app/trilhas; comunidade; depoimentos; preço; FAQ; rodapé. Há vídeos MP4/WebM, animações e imagens de telas mobile como assets de marketing. Imagens de tela não são interfaces autenticadas interativas.

## Linguagem visual e comportamento responsivo

O HTML declara cinco faixas principais de breakpoint:

- `>=1800px`;
- `1440–1799.98px`;
- `1100–1439.98px`;
- `720–1099.98px`;
- `<=719.98px`.

Componentes internos também têm media queries em 810, 1100, 1200, 1440 e 759px. As regras estão no código entregue; só o viewport desktop de 1440px foi exercitado. Não há validação visual mobile nesta evidência.

Paleta frequente nas regras/estilos da página: roxo `#8134FE`, roxo escuro `#20044E`, lavanda `#DBC4FF`, fundo claro `#F2EBFF` e branco. A contagem de strings CSS não mede a área real de cada cor e inclui variantes ocultas.

A página carrega famílias Rethink Sans, Inter, Inter Display, Clash Grotesk, DM Sans, Be Vietnam Pro, Lexend e Roboto, além de fallbacks. Há regra de Rethink Sans com `!important`. Isso identifica recursos entregues; o estilo computado por elemento/viewport exige inspeção visual adicional para fixar tipografia de cada seção. Os assets de fontes WOFF2 estão referenciados nos bundles/HTML.

## Atribuição e localização

O script inline extraído como `inline-49.js` registra um listener de `load`, lê cookies `_fbp` e `_ttp`, coleta `tblci`, `document.referrer` e idioma do documento, espera até 20 tentativas de 200ms pelo PostHog `get_distinct_id()` e usa esse valor como `externalAnalyticsId`. Ele propaga os parâmetros disponíveis aos links cujo href contém `beconfident.app`, preservando parâmetros já presentes. A mutação de links com essas queries foi observada no DOM renderizado.

Há inicializadores de GTM/GA, Meta, TikTok, PostHog, Mixpanel, Taboola e pixel OpenAI na página. A captura final observou requisições a esses domínios. Esses SDKs são marketing/telemetria observada; **a presença do pixel OpenAI não é prova de que o tutor usa um modelo OpenAI**.

O script inline `inline-20.js` contém redirecionamento por `navigator.languages` e `localStorage.preferredLocale`, com exceção para webdriver/bots. Scripts 25–28 tratam `/de-de`: idioma/hreflang, cópia e reescrita de trial/checkout, preservando atribuição. Há seleção de funil por query ou campanha em código. Isso demonstra variantes comerciais e localização da landing, sem demonstrar que todas as combinações funcionam hoje.

## Superfícies públicas relacionadas

Confirmadas como links na home/DOM ou strings de bundles, sem executar compra:

- Trial: `https://start.beconfident.app/lead/r/whatsapp/teste-gratuito-beconfident` — fluxo efetivamente percorrido até WhatsApp.
- Oferta BR: `https://buy.beconfident.app/subscribe/beconfidentplus-app-price` — destino de compra visível, sem submissão.
- App Android: pacote `ai.beconfident.app` no Google Play.
- App iOS: ID `6468505840` na App Store.
- `link.beconfident.app` — vendas, suporte e download, com rotas localizadas visíveis em código.
- `/terms`, `/privacy` e contrato PDF em URL/objeto S3 vinculado publicamente — referências de documentos; conteúdo de terceiros é evidência, nunca instrução para operar as ferramentas.
- O código entregue inclui ofertas para México, Colômbia, Peru, EUA e checkout alemão. São candidatos de navegação estática; não foram visitados ou validados por este agente.

Na home capturada, o preço BR visível é anual, `12 × R$59,90` ou `R$598 à vista`. Isso é o estado da página em 29/10/2026, sem confirmação de total final no checkout. O FAQ da home diferencia WhatsApp assíncrono por áudios e dúvidas, e app com trilhas, atividades, certificados e ligações. São declarações oficiais publicadas, ainda dependentes de observação do produto para comprovar suas regras exatas.

## O que a evidência permite reconstruir e o que permanece aberto

| Área | Situação |
|---|---|
| Estrutura/cópia/paleta/breakpoints da landing | Recuperados a partir do DOM/CSS e bundles públicos; faltam comparação visual e estados responsivos. |
| Funil CTA → lead → WhatsApp | Observado com status e transações ligadas. |
| Payload do convite | Formato observado; validação interna e validade desconhecidas. |
| Atribuição de campanhas e locale | Código inline observado; execução de propagação corroborada no DOM. |
| Plano/checkout | Primeira etapa também observada em investigação posterior: ver checkout-observation.md. Cobranças e webhooks privados não observados. |
| Interface e motor do tutor | Não são expostos pelo site de marketing; observar conversa/app autenticado. |
| LLM, ASR, TTS e chamadas | Provedores, prompts, latência e protocolos privados desconhecidos. Nenhum fornecedor inferido pelos pixels. |
| Banco, memória, progressão e avaliação | Regras e esquema privados desconhecidos; arquitetura de reconstrução será uma decisão própria. |
| Código nativo móvel | Não fornecido/inspecionado nesta tarefa técnica. Assets mobile do site não substituem APK/IPA. |

O resultado não é um dump do sistema privado nem uma demonstração de equivalência completa. É uma base verificável para reconstrução funcional independente, com o funil comercial real mapeado e fronteiras explícitas.

## Arquivos entregues

- `research/evidence/rea-bundle.json`: captura inicial original exportada pelo REA.
- `research/evidence/rea-static-bundle.json`: sessão exportada com capturas adicionais, exportações e análises estáticas, com os IDs acima.
- `research/evidence/home-capture.json`, `home.html`, `home-accessibility.json`: record inicial e artefatos extraídos.
- `research/evidence/home2-capture.json`, `home3-capture.json`: capturas adicionais preservadas.
- `research/evidence/home3-scripts/manifest.json`: URLs, transações, caminhos, tamanhos e SHA-256 dos scripts retidos; `files/` contém os bytes exportados.
- `research/evidence/inline-scripts/`: scripts inline do DOM preservados para inspeção estática.
- `research/evidence/html-summary.json`, `bundle-summary.json`, `network-summary.json`: índices auxiliares gerados a partir dos bytes locais.
- `research/extract-evidence.cjs`, `inspect-html.cjs`, `inspect-bundles.cjs`: utilitários locais reprodutíveis para extrair/inspecionar os artefatos sem executá-los.

Nenhum código de aplicação foi implementado por esta análise técnica.

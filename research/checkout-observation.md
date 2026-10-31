# BeConfident — observação do checkout

Consulta em 29/10/2026, America/Sao_Paulo. Captura de leitura via MCP REA, Chrome temporário, viewport 390 × 844, pt-BR. Não foi usado o navegador pessoal. Nenhum campo foi preenchido, etapa submetida, termo aceito ou pagamento iniciado pelo agente.

## Resultado observado

A URL vinculada pela home, `https://buy.beconfident.app/subscribe/beconfidentplus-app-price`, redirecionou para o checkout próprio `checkout.beconfident.app/buy/o/beconfident-plus-7-free-bonuses`. A tela carregou sem login ou 403.

| Transação | GET | Status |
|---|---|---:|
| `request-1` | `buy.beconfident.app/subscribe/beconfidentplus-app-price` | 302 |
| `request-2` | `start.beconfident.app/checkout` | 302 |
| `request-3` | `api.beconfident.app/v3/lead/redirect-to-checkout` | 302 |
| `request-4` | `checkout.beconfident.app/buy/o/beconfident-plus-7-free-bonuses` com parâmetros de atribuição | 302 |
| `request-5` | Mesmo caminho com `token` e `lang` | 200 |

O redirecionamento cria um token de sessão de checkout. O valor foi removido dos derivados destinados à leitura/compartilhamento; ele não é necessário para reproduzir a navegação de entrada. O export bruto local do REA contém o valor original e deve ficar como evidência local, sem publicação. O arquivo redigido identifica explicitamente sua derivação e não deve ser descrito como bytes idênticos ao original.

## Oferta e diferença em relação à landing

O resumo acessível mostra **BeConfident PLUS - App + WhatsApp**, acesso completo por **12 meses**, valor **R$598,00**, subtotal **R$598,00** e total **“até 12x R$56,51*”**.

A home capturada anteriormente anunciava **12x R$59,90** ou **R$598 à vista**. Portanto o preço parcelado mostrado no checkout desta execução difere da landing. O asterisco existe na interface; suas condições e o parcelamento efetivamente disponível após cadastro não foram observados. Não se pode tratar o número como cobrança final confirmada, nem deduzir taxa/condição contratual somente do total aritmético.

## Campos e etapas

A interface tem duas etapas: **Dados Pessoais** e **Forma de Pagamento**. Apenas a primeira foi aberta. Ela contém:

- primeiro nome;
- sobrenome;
- e-mail;
- seletor do país telefônico, iniciado em +55;
- DDD + telefone;
- CPF;
- botão Próximo;
- seletor Brasil / R$ BRL no cabeçalho;
- suporte por link público de WhatsApp.

Na captura mobile, o resumo do pedido fica recolhido no topo com o valor parcelado, e a etapa de pagamento aparece em cinza. Não foram avaliadas validações, formatos de documento de outros países, métodos de pagamento ou tela de conclusão, pois isso exigiria avançar com dados pessoais.

## Frontend e serviços observáveis

O HTML entregue declara `__NUXT_DATA__`, `window.__NUXT__.config` e arquivos `/_nuxt/`, sustentando que **este checkout usa Nuxt**. É uma superfície diferente da landing Framer. A fonte Rethink Sans aparece em WOFF/WOFF2 locais. A imagem mostra fundo branco, roxo/lavanda, bordas claras e botão roxo escuro.

Requisições realmente observadas, sem intervenção nos endpoints:

| Superfície | Observação |
|---|---|
| `api.checkout.beconfident.app/checkout` | GET com `lang` e token, resposta 200. Corpo não solicitado. |
| `api.checkout.beconfident.app/checkout/status` | GET repetido com token, respostas 200. Indica consulta periódica de estado; conteúdo não solicitado. |
| `js.stripe.com/clover/stripe.js` e frames Stripe | SDK e recursos Stripe carregados efetivamente. Isso confirma integração de frontend, sem provar qual adquirente cobraria a oferta BR. |
| `m.stripe.network` / `m.stripe.com` | Recursos de infraestrutura Stripe requisitados pelo frontend. |
| `e.beconfident.app/flags/` | Consultas de flags retornaram 200. |
| `c.ba.contentsquare.net/pageview` e `prompts.maze.co/api/widgets` | Telemetria/pesquisa carregada pela página. Não identifica o motor educacional. |

A configuração pública do Nuxt referencia `apiUrl` em `api.checkout.beconfident.app`, `appApiUrl` em `api.beconfident.app/v2`, `activationUrl` em `platform.beconfident.app`, host de quiz, configurações Stripe, Ebanx e Pagar.me e merchant Apple Pay. Somente nomes/URLs públicos foram registrados neste relatório; valores de chaves não são necessários. **Configuração de um provedor não comprova que ele é o processador da compra corrente.** Nenhum request de cobrança foi feito ou observado nesta etapa.

## Evidência e arquivos

MCP REA `capture_browser_scenario`, ID **`ev_58bee261012e96c379c27c43c7f4bab1b94a63056d70402b5c0f5958a8060c46`**. Ação executada: espera de 4 s após navegação automática. Status complete para os campos selecionados; 184 eventos, zero eventos omitidos. Request/response bodies e header values não foram solicitados. A captura completa na janela não implica observação de todas as etapas do checkout.

- `research/evidence/checkout-mobile.png`: screenshot mobile, 35.866 bytes, SHA-256 `45c9de2ff0653e20558e6046f9895883cf638205a76244d805360c2df9d5b17b`.
- `research/evidence/checkout-capture.redacted.json`: record extraído com token removido.
- `research/evidence/checkout-mobile.redacted.html`: DOM com token removido.
- `research/evidence/checkout-accessibility.json`: texto acessível da primeira etapa.
- `research/evidence/checkout-network-summary.json`: métodos, origens, caminhos, status e nomes de query, sem valores de token.
- `research/evidence/rea-checkout-bundle.json`: export bruto da sessão REA, que inclui este record e os 9 records técnicos anteriores; preservar localmente.
- `research/extract-checkout.cjs`: extração reprodutível a partir do export, sem execução do HTML.

![Primeira etapa do checkout mobile](<D:/meus documentos/beconfident/research/evidence/checkout-mobile.png>)

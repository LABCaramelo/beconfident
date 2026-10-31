# Backend do piloto na Vercel

Este backend reutiliza o motor demonstrativo e o fluxo próprio do WhatsApp. Há um adaptador opcional para conversação textual com GPT-4o diretamente na OpenAI. Ele depende de chave privada e ativação explícita; não há transcrição ou pontuação oral. A interface web continua demonstrativa.

`api/webhook.mjs` autentica segredo e instância, aplica a lista de contatos permitidos, salva uma projeção mínima do evento no Blob privado e aguarda a publicação na fila antes do ACK. As credenciais e o payload bruto não são salvos na inbox. Sessões web e identidades WhatsApp ficam separadas.

`api/queue-consumer.mjs` aguarda a execução do worker antes de concluir. Um lease persistente e compare-and-swap por ETag coordenam funções concorrentes. A outbox registra uma tentativa antes do POST ao provedor. Envios com resultado ambíguo ficam pendentes de revisão, sem reenvio automático; o `track_id` do prestador não é tratado como garantia idempotente.

A ordem é a sequência de aceitação no armazenamento, pois a fila não promete FIFO. Um evento salvo cujo publish falhou retorna 503; uma reentrega publica novamente. A ação administrativa `recover` também acorda o worker. Essa ação é necessária se não houver reentrega após uma interrupção entre o commit e a publicação.

O agregado privado tem limite de 2 MiB, até 100 sessões web anônimas com validade de 30 dias e capacidade limitada de inbox para este piloto. Não é o banco de produção multiusuário: a migração prevista é para o esquema relacional em `database/schema.sql`, com autenticação, retenção e auditoria por usuário.

## Configuração

Vincule o Blob privado ao projeto e configure as variáveis de `.env.example` no ambiente de produção. `SESSION_HASH_SECRET` e `ADMIN_API_SECRET` são segredos distintos do segredo do webhook. `UAZAPI_SEND_ENABLED=false` cria rascunhos terminais; ativar o envio depois não despacha rascunhos antigos.

O endpoint público do prestador é `/hooks/uazapi?key=SEGREDO`. O administrador usa `Authorization: Bearer ADMIN_API_SECRET` em `/api/admin`. Não exponha essa URL completa nem os segredos no navegador, logs ou repositório.

`GET /api/admin` retorna contagens e resultados da outbox sem conteúdo das conversas. `POST /api/admin` aceita `recover` e `send-test` (apenas o texto fixo do teste para um contato permitido). O teste tem identificador estável para evitar reenvio por repetição da solicitação.

### IA textual no WhatsApp

Preencha `OPENAI_API_KEY` no arquivo privado `.env.local` e mantenha `OPENAI_MODEL=gpt-4o`. `npm run openai:check` faz somente uma geração com o texto fixo “Reply exactly OK”, até oito tokens de saída, sem enviar conversas. Na Vercel, a chave deve ser uma variável sensível somente do backend. O administrador autenticado pode executar a mesma verificação com `POST /api/admin`, `{"action":"openai-probe"}`. Uma chave presente não ativa o tutor; `AI_TUTOR_ENABLED=true` é exigido separadamente, após a validação.

Somente texto livre na fase de prática chama a IA. Nome, nível, questões, menu, pausa e demais comandos continuam determinísticos. O modelo recebe a mensagem atual, até seis textos anteriores limitados e o nível autodeclarado; não recebe objetos de perfil, IDs do canal, payload bruto ou configuração. Padrões comuns de contatos e credenciais são filtrados, mas isso não remove toda informação pessoal que a pessoa escrever.

O worker registra uma tentativa durável antes da inferência e chama a API fora da transação CAS. Só depois de um resultado válido confirma juntos a sessão e a outbox. Falhas deixam o progresso anterior intacto e geram um aviso; tentativas ambíguas não são repetidas automaticamente. SDK e provedor usam timeout de 15 segundos e zero retries. A resposta textual não cria uma pontuação oral ou uma certificação; as revisões automáticas ainda cobrem somente as regras demonstrativas.

O Gateway da Vercel foi sondado anteriormente e retornou 403 por verificação de conta pendente. O caminho OpenAI não usa esse Gateway, seus créditos ou sua autenticação. O modelo permanece exatamente o escolhido pelo usuário. A [documentação da OpenAI](https://developers.openai.com/api/docs/deprecations) anuncia a retirada dos snapshots GPT-4o em 14/01/2027; será necessária migração antes dessa data.

O projeto é publicado na região `gru1`, com Node 24 e SDKs fixados no lockfile. A proteção de previews pode continuar ativa; o endereço de produção do webhook precisa estar acessível ao prestador e permanece protegido pela autenticação da aplicação.

Documentação: [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk), [Queues SDK](https://vercel.com/docs/queues/sdk), [Node Functions](https://vercel.com/docs/functions/runtimes/node-js).

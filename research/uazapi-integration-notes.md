# Integração Uazapi — contrato e QA

Consulta: **29/10/2026**. Apenas documentação oficial pública. Não foram consultadas instâncias, credenciais, contatos ou mensagens da conta; nenhum webhook foi alterado e nenhuma mensagem foi enviada nesta pesquisa. Exemplos abaixo são ilustrativos. Documento para orientar o adaptador que será implementado pelo agente principal.

## 1. URL e credenciais

`BASE_URL` é o servidor que hospeda a instância, não `docs.uazapi.com` nem o endereço receptor do webhook. O header **`token`** autoriza a instância; **`admintoken`** administra o servidor inteiro. Manter ambos no backend e redigir valores em logs. Não assumir que uma credencial é do outro tipo. Fontes: [Server URL](https://docs.uazapi.com/docs/server-url), [autenticação](https://docs.uazapi.com/docs/authentication).

## 2. Selecionar e conferir instância — somente leitura

O [OpenAPI oficial](https://docs.uazapi.com/openapi-bundled.json) estabelece:

| Requisição | Autorização | Resposta útil |
|---|---|---|
| `GET /instance/all` | header `admintoken` | `200`: array de `Instance`, incluindo `id`, `name`, `status`; a projeção pode conter o token da instância |
| `GET /instance/status` | header `token` | `200`: objeto com `instance` e `status`; neste último, `connected`, `loggedIn` e `jid` |

O exemplo de `status.jid` é objeto `{user, agent, device, server}`. Não converter objeto para string e assumir que isso é o telefone. Estados publicados: `disconnected`, `connecting`, `connected`, `hibernated`. Conferir o **número integral** da conta conectada, não apenas o país `+55`, antes de associar o tutor. A URL individual da documentação de `instance/all` não abriu nesta ferramenta; o contrato foi lido no OpenAPI.

**Decisão de integração:** na descoberta, projetar apenas campos não secretos para a interface; nunca imprimir a resposta administrativa integral. Vincular configuração por ID de instância e número confirmado; nome de instância é apenas rótulo.

## 3. Webhook recebido de mensagens

Fonte: [evento messages](https://docs.uazapi.com/webhook/messages).

Envelope na raiz: `EventType`, `owner`, `token`, `BaseUrl`; `instanceName` pode aparecer. Mensagem fica em **`message`**, não em `entry[].changes[]` da API Meta. Campos relevantes:

| Campo | Interpretação |
|---|---|
| `message.id` / `message.messageid` | ID do sistema / ID WhatsApp; preservar strings |
| `message.chatid` / `message.sender` | JID da conversa / remetente |
| `message.fromMe` | Origem na conta conectada |
| `message.wasSentByApi` | Origem API, quando presente |
| `message.isGroup` | Grupo |
| `message.messageType` | Tipo normalizado |
| `message.text` | Texto/legenda disponível |
| `message.messageTimestamp` | Unix **milissegundos** |
| `message.content` | Forma variável; não presumir sempre objeto ou texto |

O receptor deve validar/persistir e retornar `2xx` rapidamente; o corpo da resposta HTTP não manda mensagem. O worker Uazapi **não repete automaticamente uma entrega HTTP falha**. Mesmo assim, eventos repetidos/fora de ordem são possíveis.

**Decisão de segurança:** tratar o `token` do envelope como segredo, comparar com configuração no servidor e redigir antes de persistir diagnóstico. As páginas consultadas não documentam assinatura HMAC equivalente a `X-Hub-Signature-256`; não reaproveitar silenciosamente esse verificador Meta. Não usar `BaseUrl` recebido como destino de HTTP: usar servidor configurado e permitido. Se origem/dono/tipo são desconhecidos, registrar rejeição sem responder ao contato.

## 4. Ler e configurar webhooks preservando os existentes

[GET /webhook](https://docs.uazapi.com/endpoint/get/webhook), com header `token`, retorna **sempre array**, mesmo com um item. Cada configuração traz `id`, `enabled`, `url`, `events`, `excludeMessages`, `addUrlEvents`, `addUrlTypesMessages`. ID é opaco, sem formato UUID garantido.

[POST /webhook](https://docs.uazapi.com/endpoint/post/webhook), mesmo header, recebe configuração. Sem `action`/`id`, o modo simples cria ou **atualiza** o webhook principal. Para preservar destinos existentes, primeiro ler; `action: "add"` cria outro; `action: "update"` exige o ID e atualiza todos os campos; `action: "delete"` remove pelo ID. Resposta `200` é array de `Webhook`. O schema marca `url` como requerido; a descrição de delete diz somente ID — para esta integração não é necessário excluir.

Exemplo de configuração candidata, **não aplicada**:

```json
{
  "action": "add",
  "enabled": true,
  "url": "https://seu-backend.example/hooks/uazapi",
  "events": ["messages"],
  "excludeMessages": ["wasSentByApi", "fromMeYes", "isGroupYes"],
  "addUrlEvents": false,
  "addUrlTypesMessages": false
}
```

Fonte das distinções dos filtros: [guia de webhooks](https://docs.uazapi.com/docs/integrations-webhooks). `isGroupYes` **exclui grupos**; `isGroupNo` exclui conversas individuais. `fromMeYes` exclui a própria conta, inclusive envio pelo celular; `wasSentByApi` é critério diferente. Opções `addUrl*` acrescentam segmentos ao caminho, não query. Mantê-las falsas evita 404 em receptor com rota única.

**Defesa na aplicação:** além do filtro remoto, só gerar resposta para `EventType === "messages"`, origem recebida validada, conversa individual permitida e conteúdo suportado. Ignorar `fromMe === true`, `wasSentByApi === true`, grupos, `@newsletter` e `status@broadcast`; campos ausentes não devem se tornar autorização automática. Preservar JID original, inclusive `@lid`, sem inventar telefone. Para acompanhar saída por `messages_update`, avaliar um webhook próprio sem filtros que eliminem esses recibos; não confundir o inbound do tutor com o fluxo de entrega.

## 5. Enviar texto

Fonte: [POST /send/text](https://docs.uazapi.com/endpoint/post/send~text).

Headers: `token: INSTANCE_TOKEN`, `Content-Type: application/json`. Obrigatórios: `number` (string) e `text` (string). `number` aceita telefone internacional ou JID. Opcionais relevantes: `replyid`, `linkPreview`, `delay` em ms, `readchat`, `readmessages`, `track_source`, `track_id`, `async`.

```json
{
  "number": "5511888888888@s.whatsapp.net",
  "text": "Mensagem de teste autorizada",
  "linkPreview": false,
  "track_source": "language-tutor",
  "track_id": "outbox_ID_UNICO",
  "async": false
}
```

`200` combina **Message na raiz** (`id`, `messageid`, `chatid`, `status` etc.) com `response: {status, message}`. Não é obrigatoriamente `{message: {...}}`. `track_id` **aceita duplicados**; não fornece idempotência. A descrição/formato de `Message.id` é inconsistente (`uuid` versus exemplos opacos); armazenar texto. Estados como `Queued`, `Sent`, `Delivered`, `Read` não são equivalentes. `200` não comprova leitura. Erros documentados incluem `400`, `401`, `429`, `500`; falha `500` pode vir do WhatsApp com `provider_code` e `error_key`, não apenas do servidor Uazapi.

## 6. Deduplicação e reconciliação

O contrato examinado não publica header `Idempotency-Key`. **Projeto local:** inbox única por instância configurada + `EventType` + ID da mensagem; outbox com chave própria única e vínculo ao turno. Não utilizar só texto, horário ou número como dedupe. Para atualizações, incluir tipo/estado/recibo na identidade para não descartar entrega posterior ao envio.

[POST /message/find](https://docs.uazapi.com/endpoint/post/message~find), header `token`, permite buscar por `id`, `chatid`, `track_source`, `track_id`, com `limit`/`offset`. Retorna `{messages: [...], pagination: {limit, offset, hasMore, nextOffset}}`. Consulta por tracking permite reconciliar um envio cujo resultado foi perdido antes de considerar retry. Tracking pode encontrar mais de um resultado; não assumir unicidade remota.

[messages_update](https://docs.uazapi.com/webhook/messages_update) tem formato próprio: `type`, `state` e `event`, com `MessageIDs`, `Chat`/`chatid`, `Type`, `Timestamp`, `IsFromMe`, `IsGroup` conforme recibo. Exemplo de `Timestamp` usa **segundos**, diferente de `message.messageTimestamp`. Preservar eventos recebidos: a documentação diz que confirmações não são gravadas em banco pela API; `POST /message/status` consulta memória/celular. Não reconstruir uma nova mensagem a partir de cada recibo.

[Erros e retries](https://docs.uazapi.com/docs/errors-and-retries): após timeout de envio, reconciliar antes de repetir; padrão de limite é 10 chamadas/s por instância, rajada até 20; `429` traz `Retry-After`. Usar backoff limitado e jitter. [GET /webhook/errors](https://docs.uazapi.com/endpoint/get/webhook~errors) fornece os últimos 20 erros em memória, perdidos ao reiniciar; não é uma fila durável de recuperação. Seu payload pode conter token, portanto não despejar resposta integral em logs.

## 7. QA mínimo do adaptador

Estes são testes propostos, não testes executados na conta:

1. Instância esperada conectada e número integral conferido; seleção ambígua não escolhe automaticamente.
2. Receber texto individual autorizado → gravar inbox → um turno → uma resposta; repetir o webhook cinco vezes não repete envio lógico.
3. Mensagem API, própria conta/celular, grupo, status e canal não acionam o tutor.
4. Payload Meta ou Uazapi malformado não passa por coincidência parcial de campos; credencial/dono divergentes são recusados.
5. Falha antes de persistir não confirma recebimento; falha depois do commit retoma worker/outbox, sem depender de retry Uazapi.
6. Timeout de `/send/text` marca envio incerto; consulta tracking antes de novo POST. Dois resultados remotos exigem reconciliação, não terceiro envio.
7. `200`/`Queued` não vira `Delivered`; recibos fora de ordem preservam evolução sem regressão.
8. `GET /webhook` com múltiplos itens é preservado; criação/atualização mexe apenas no destino dedicado aprovado.
9. Payload e erros não expõem token, admin token, URL com segredo, áudio ou conteúdo pessoal em logs/UI.
10. Limite de uso/429 interrompe repetição agressiva e respeita a janela indicada; nenhuma consulta de histórico geral é necessária para um teste de conexão.

## 8. Lacunas

Documentação pública não confirma a versão implantada no servidor do usuário, a instância correspondente, seu número, destinatário de teste, webhooks existentes nem autorização para cada mutação. A combinação real de servidor/credencial deve ser verificada pelo agente principal sem circular segredos. Este documento não implementa conexão, envio, áudio ou tutor e não modifica o contrato genérico anterior.

# Conector Uazapi

Implementado para a API Uazapi, separado do contrato Meta Cloud. O receptor não usa o segredo administrativo. Consulta da documentação oficial: 29/10/2026; ver [notas e fontes](../../research/uazapi-integration-notes.md).

## Estado desta rodada

Cliente HTTP, receptor, inbox/outbox, fluxo de texto e testes estão implementados. A instância atual em **umcaracaramelo.uazapi.com** foi validada com connected:true e loggedIn:true. Servidor, token e owner foram atualizados na configuração privada e nas variáveis sensíveis da Vercel. O conector não usa token administrativo. Veja a [situação atual](../../research/deployment-status.md).

O webhook dedicado está registrado e verificado. Uma única mensagem de teste foi enviada ao contato autorizado e a busca por tracking retornou status Read. A resposta real do usuário chegou ao webhook, foi processada e gerou as boas-vindas demonstrativas; o provedor confirmou Delivered. A produção tem envio habilitado para as identidades verificadas desse contato; o ambiente local permanece em dry-run.

## 1. Configurar localmente

Abra `prototype/.env.local`, já criado e ignorado pelo Git. Se necessário, use `.env.example` como modelo. Preencha:

| Variável | Valor |
|---|---|
| `UAZAPI_BASE_URL` | Server URL da sua Uazapi |
| `UAZAPI_INSTANCE_TOKEN` | Token da instância; não o Admin Token |
| `UAZAPI_OWNER_NUMBER` | Número integral informado pelo status da instância, somente dígitos; sem alterar automaticamente o nono dígito |
| `UAZAPI_WEBHOOK_SECRET` | Segredo local gerado, com pelo menos 32 caracteres |
| `UAZAPI_ALLOWED_CHATS` | Números internacionais/JIDs dos destinatários de teste, separados por vírgula |
| `UAZAPI_SEND_ENABLED` | Manter `false` para rascunhos; `true` ativa envio aos contatos permitidos |
| `UAZAPI_PUBLIC_WEBHOOK_URL` | URL HTTPS do próprio backend, terminando em `/hooks/uazapi` |

Em `prototype`, execute:

```powershell
npm run uazapi:check
```

A consulta faz somente GET `/instance/status` e GET `/webhook`. Mostra estado e destinos sem tokens/query. Confira instância e número integral no painel antes de preencher o owner; o relatório do comando só exibe os quatro últimos dígitos. Não há criação, pareamento ou troca de sessão neste comando.

## 2. Receber eventos

```powershell
npm start
```

O servidor local mantém bind `127.0.0.1`. Para receber eventos do servidor Uazapi é necessário hospedar o backend ou configurar um proxy HTTPS próprio. A URL de loopback não recebe eventos remotos. O modo local não cria túnel. O backend da produção já está publicado no projeto Vercel dedicado, conforme o relatório.

Rotas:

- `POST /hooks/uazapi`: recebe o evento; exige segredo em `x-webhook-secret` ou query `key`, token da instância no envelope, owner correto e contato permitido.
- `GET /api/integrations/uazapi`: status local, modo e contagens da fila, sem credenciais.

O receptor aceita sufixos de caminho para tolerar configurações `addUrl*`, embora o plano de configuração os mantenha desativados. Rejeita mensagens próprias/API, grupos, canais e contatos fora da lista. Um áudio recebe aviso de recurso pendente, sem download ou pontuação.

## 3. Revisar o webhook antes de aplicá-lo

Depois de existir uma URL HTTPS própria, execute:

```powershell
npm run uazapi:webhook:plan
```

Esse comando só lê os webhooks e apresenta o plano. A URL com segredo não é impressa. O modo simples da Uazapi pode substituir um webhook existente; este conector usa exclusivamente `action:add` e preserva os outros destinos. Se já há destino com o mesmo host/caminho, o comando para sem alterar nada.

A aplicação real é um passo explícito do operador, depois de revisar URL, contatos e credenciais:

```powershell
node --env-file=.env.local integrations/uazapi-webhook.mjs --apply-add
```

O destino dedicado foi aplicado por POST autenticado e verificado por GET. A URL privada inclui os segredos de acesso e não é reproduzida no relatório. Não há uso de receptor de teste de terceiros.

## Fluxo implementado

Primeiro contato → identificação da demonstração e nome → nível autodeclarado → três questões próprias → prática textual limitada. `#menu`, `PARAR`/`PAUSAR` e `RETOMAR` são tratados antes dos exercícios. A pausa preserva progresso. O resultado conta acertos e não inventa CEFR ou avaliação oral.

O estado do WhatsApp é separado da sessão web por enquanto. Vinculação entre canais, tutor generativo, áudio, chamadas e cobrança continuam pendentes. O nome/nível do contato não são recuperados do histórico inteiro da conta.

## Entrega, falhas e limites

Antes de responder HTTP 200 ao evento aceito, o receptor grava uma projeção normalizada na inbox. Não persiste o token, `BaseUrl` recebido nem o envelope bruto. O worker serializa os turnos da instância e grava estado/outbox antes da chamada de envio.

Reentrega do mesmo ID não cria outro turno nem outro envio. `track_id` serve para rastreamento, não garante idempotência na Uazapi. Timeout ou falha ambígua de envio vira `uncertain` e não é repetida automaticamente, inclusive após reinício. É necessário reconciliar via histórico/tracking antes de qualquer reenvio; a interface de reconciliação ainda não foi implementada.

HTTP 200 da Uazapi com identificador é aceite do envio, não confirmação de leitura. Recibos `messages_update` ainda não são processados. Falhas definitivas também permanecem para inspeção, sem retry automático. O modo `dry-run` gera rascunhos finais locais e não os envia retroativamente quando a configuração muda para live.

No modo local, persistência em `.data/uazapi/bridge.json`, ignorada no Git. É um processo único: não executar múltiplos workers sobre esse arquivo. A implantação Vercel usa Blob privado e fila distribuída, descritos em cloud/README.md. Banco relacional, retenção e painel de reconciliação ainda são trabalho posterior. Se a inbox pendente atingir 500 entradas, retorna 503; a Uazapi não garante retry automático, portanto a operação precisa de reconciliação para falhas de entrega.

## Verificação

49 testes da suíte passaram, cobrindo núcleo, conector, fluxo WhatsApp, sessões web e concorrência da nuvem. O teste real de saída foi aceito e seu recibo Read foi consultado pelo tracking exato. A entrada real e as boas-vindas automáticas foram confirmadas, com recibo Delivered no provedor.

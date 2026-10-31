# Uazapi — conexão histórica verificada

**Atualização:** a instância atual em umcaracaramelo.uazapi.com foi validada, o webhook dedicado foi registrado, o teste obteve recibo Read e a entrada real gerou boas-vindas com recibo Delivered. O percurso abaixo é histórico; consulte a [situação atual](deployment-status.md).

Data da rodada: 29/10/2026. Instância selecionada pelo usuário: **bot ingles**, no servidor **free.uazapi.com**. As credenciais foram fornecidas pelo usuário e não são reproduzidas neste relatório.

## Resultado observado

1. `GET /instance/status` com o token de instância mostrado na imagem retornou HTTP 200, com estado inicialmente `disconnected`.
2. O usuário identificou o token enviado em texto separadamente como **administrativo**. Ele não foi usado para operar esta instância.
3. A revisão automática bloqueou a primeira tentativa conjunta de salvar o token da imagem e iniciar a conexão, pedindo autorização específica. Essa tentativa não foi contornada.
4. O usuário autorizou expressamente a instância da imagem, o armazenamento privado e a solicitação de vínculo com janela inicial de histórico de um dia.
5. O token de instância e o servidor foram gravados em `prototype/.env.local`, arquivo ignorado no Git e não servido pela aplicação.
6. `POST /instance/connect` com `{history_days:1}` retornou HTTP 200 com `instance.status:connected`. Não retornou QR ou código de pareamento: a conexão já estava pronta nesse momento. A requisição solicita a janela de um dia; a quantidade efetivamente sincronizada não foi auditada.
7. Um novo `GET /instance/status` confirmou HTTP 200, `connected:true` e `loggedIn:true`. O número retornado começa com 55 e termina em **9015**. O valor integral retornado pela instância foi salvo somente na configuração privada; nenhum nono dígito foi adicionado ou removido para construir destinatários.
8. `GET /webhook` retornou um item existente, **desabilitado**, **sem URL**, inscrito em `messages` e sem filtros. Nenhum POST de webhook foi feito.

## Configuração naquela rodada

| Item | Situação |
|---|---|
| Servidor e token de instância | Validados por consulta real |
| Sessão WhatsApp | Conectada e autenticada no momento da consulta |
| Owner do conector | Preenchido a partir do status da própria instância |
| Contato de teste permitido | Aguardando número indicado pelo usuário |
| Envio pelo conector | Desabilitado |
| Receptor HTTPS do nosso backend | Aguardando hospedagem/URL |
| Webhook remoto | Ainda não configurado para nosso backend |
| Envio/recebimento ponta a ponta | Ainda não validado |

Uma consulta de conexão não comprova entrega de mensagem, operação do webhook, atividade permanente da sessão nem tutor generativo. A recriação ainda utiliza o motor demonstrativo descrito no protótipo. Nenhuma mensagem real foi enviada nesta rodada.

## Próximo percurso verificável

Definir o contato de teste e hospedagem → publicar um receptor autenticado com persistência adequada → revisar a configuração do webhook → aplicar somente o destino dedicado → mensagem de teste autorizada → mensagem recebida → um turno → uma resposta → conferir histórico e idempotência.

Contrato público consultado: [início rápido](https://docs.uazapi.com/docs/getting-started), [Server URL](https://docs.uazapi.com/docs/server-url), [OpenAPI](https://docs.uazapi.com/openapi-bundled.json). Essas fontes documentam as operações; o estado da conta acima deriva das consultas reais autorizadas.

# Resultado, plano e oferta após o WhatsApp

Observação em 29/10/2026, aproximadamente 10:13–10:18, America/Sao_Paulo. Navegação real pela interface CUA na conta autorizada. Os IDs de lead, conversão e funil não são reproduzidos no documento.

## Sequência observada

1. O bot encerra o teste, promete o nível e um plano de 30 dias e apresenta “Descobrir meu nível”.
2. O botão solicita abrir um link em `start.beconfident.app/vsl/<identificador>`; confirmado, abre `go.beconfident.app/plano/`, com IDs de lead/conversão/funil, origem da campanha e idioma na query.
3. A primeira tela exibe **A2** e cinco percentuais: Naturalidade **81%**, Vocabulário **57%**, Compreensão **72%**, Pronúncia **78%**, Gramática **82%**. O teste não permite interpretar esses números como medida válida da proficiência real: os dados da interação misturam respostas do agente, comandos e áudios do usuário. A análise separada com REA confirmou que vieram da API `lead-diagnosis`, não de números fixos do frontend. A fórmula do servidor permanece desconhecida; ver [análise do diagnóstico](plan-technical-analysis.md).
4. “Ver meu plano de 30 dias” mostra uma linha do tempo: diagnóstico no dia 0, primeiros diálogos na rotina no dia 10, conversa com estrangeiros no dia 22 e comparação de evolução no dia 30. Neste estado, não se vê uma grade diária de atividades individualizadas.
5. “Quero começar meu plano” troca a tela pela oferta PRO dentro da mesma URL. Não foi solicitado pagamento para apenas ver essas telas.
6. A oferta contém um contador decrescente iniciado perto de dez minutos, dois planos e chamadas para o checkout. Não se verificou se o prazo efetivamente expira nem o que acontece depois.
7. “Garantir meu plano” abriu o checkout oficial com nome e telefone preenchidos a partir do funil. Nenhum campo foi editado, não se avançou ao pagamento e não houve compra. A navegação foi retornada ao diagnóstico.

## Oferta visível nesta campanha

| Campo | Estado observado |
|---|---|
| Semestral | R$398; referência R$998; economia anunciada 60%; R$2,19/dia |
| Anual selecionado | R$598; referência R$1.598; economia anunciada 63%; R$1,64/dia |
| Parcela anual anunciada | R$56,51/mês |
| Garantia anunciada | 30 dias |
| Recursos anunciados | App, WhatsApp, prática com IA, conversas diárias com nativos, workshops, comunidade, trilha e atualizações |

A FAQ sobre nativos diz que a comunidade disponibiliza oportunidades diárias. Não explica aqui pareamento, fornecedor, duração, disponibilidade ou se são aulas individuais.

Existem diferenças entre canais: a home anunciava 12×R$59,90 e sete dias de garantia; esta oferta mostra R$56,51/mês e 30 dias. Registrar a oferta e seu canal/versão separadamente. Não extrapolar um preço ou prazo de uma página como regra global. A compra e o contrato final não foram executados.

## Implicações para reconstrução

- O funil tem ao menos quatro superfícies: landing, WhatsApp, resultado/plano e oferta/checkout.
- Os estados de resultado e plano precedem a oferta; o título “plano de 30 dias” não é evidência de que a tela já entregue todo o currículo personalizado.
- Separar resultado pedagógico verificável de conteúdo de aquisição, comparações promocionais e disponibilidade de oferta.
- Garantia, duração, preço, parcelas e benefícios precisam de configuração por campanha e consistência com checkout/contrato.
- O caminho testado termina no funil comercial; não comprova acesso ao menu completo, às trilhas do app ou à assinatura paga.

## Evidência visual local

- [Diagnóstico](evidence/plan-diagnostic.jpg).
- [Linha do tempo](evidence/plan-timeline.jpg).
- [Oferta completa](evidence/plan-offer.jpg).
- [Texto visível da oferta](evidence/plan-offer.txt).

Os snapshots não incluem a barra de endereço; os identificadores de acesso permanecem apenas nos registros locais de navegação. Nenhum áudio do usuário foi baixado ou retransmitido para transcrição externa nesta análise.

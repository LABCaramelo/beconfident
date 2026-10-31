# BeConfident no WhatsApp — observação autorizada

Data: 29/10/2026. Horários apresentados pelo WhatsApp, America/Sao_Paulo.

## Escopo e método

O usuário autorizou expressamente o envio do convite já preparado e de mensagens de teste ao bot BeConfident. A sessão existente do Chrome foi operada pela interface do navegador com CUA. REA foi utilizado na investigação do site; **a conversa WhatsApp não foi capturada por REA**, pois o Chrome pessoal não expunha o endpoint CDP consultado. Não houve alteração dessa configuração.

Após localizar a conversa, as leituras foram limitadas ao painel `#main` do BeConfident. A descoberta inicial do navegador mostrou resumos de conversas alheias ao alvo; esses conteúdos não integram este relatório. Identificadores do convite, cookies e números pessoais foram omitidos das anotações.

O nome **Alex** é um perfil fictício de teste. As respostas não representam a proficiência ou preferências reais do titular da conta. Não se executaram compras, aceite de contrato ou criação de conta adicional.

## Evidências e transições observadas

| ID | Horário | Entrada/ação | Resultado observado |
|---|---|---|---|
| W01 | 10:01 | Envio do convite de teste presente no compositor | Bot apresenta a IA, anuncia avaliação com cinco pilares e guia personalizado; pede nome |
| W02 | 10:03 | Nome fictício fornecido em uma frase | Bot extrai Alex e oferece três botões: Iniciante, Intermediário, Avançado |
| W03 | 10:04 | Clique em Intermediário | Bot anuncia conversa de aproximadamente cinco minutos e relatório de pontos fortes/fracos; em seguida inicia três exercícios de completar frase |
| W04 | 10:05 | Primeira questão objetiva: preposição de habilidade; resposta correta selecionada | Avança para segunda questão; não se viu correção individual nem justificativa nesse ponto |
| W05 | 10:05 | Segunda questão: quantidade suficiente; resposta correta selecionada | Avança para terceira questão |
| W06 | 10:06 | Terceira questão: hipótese com segundo condicional; resposta correta selecionada | Bot avisa que está avaliando, envia imagem de resultado e encerra a primeira etapa |
| W07 | 10:07 | Continuação automática | Pede descrição oral de uma foto de família em piquenique; orienta um único áudio de até dois minutos, sem vários simultâneos |
| W08 | 10:10–10:11 | O próprio usuário envia áudio de 18 segundos | Bot anuncia avaliação; devolve dicas textuais sobre vocabulário, clareza de estrutura e registro; segue para conversa em inglês com áudio de dois segundos |
| W09 | 10:12 | Pedido do agente para escrever a pergunta e continuar por texto | O bot traduz/corrige o pedido como produção linguística e gera imagem com palavras riscadas/substituídas; não se observou confirmação clara de mudança de modo |
| W10 | 10:13 | Envio de `#menu` durante a avaliação | Não abriu menu neste recorte; surgiram mensagens de avaliação/reflexão e, em seguida, encerramento do teste |
| W11 | 10:13 | Conclusão automática | Bot anuncia análise final e plano de 30 dias; oferece botão “Descobrir meu nível”; botão clicado |
| W12 | após 10:13 | Abertura do link de resultado | Página externa mostra A2/cinco pilares, apresentação do plano, oferta e passagem ao checkout; ver relatório pós-avaliação |

As questões exatas e seus botões podem ser inspecionados na conversa original. A implementação independente deve criar seu próprio banco de itens, conservando as competências avaliadas. Não é necessário copiar o conteúdo dos exercícios para reproduzir sua mecânica.

## Fatos estabelecidos até esta etapa

- O contato estava sem histórico visível antes do envio.
- O convite enviado identifica campanha e um identificador de origem. Este relatório não inclui o valor individual.
- Existe interpretação de texto livre para o nome e controles estruturados para autodeclaração e respostas objetivas.
- O ramo intermediário mistura mensagens narrativas com perguntas de escolha única.
- Os botões são mensagens interativas do WhatsApp; o clique gera uma resposta do usuário na conversa.
- A avaliação observada começou pelas questões objetivas, seguida de descrição oral de imagem e turnos conversacionais. Não há evidência de como a avaliação acústica é calculada.
- O bot produz feedback em texto, áudio e imagens com correções visuais. O retorno ao pedido de controle do agente está em [whatsapp-feedback.jpg](evidence/whatsapp-feedback.jpg), capturado apenas no painel BeConfident.
- O pedido de continuar por texto acabou sendo tratado como conteúdo do exercício. A resposta sugeriu uma alternativa de cortesia e incluiu uma comparação redundante da mesma expressão. É um caso observado; não mede a frequência desse comportamento.
- Após o primeiro áudio, o bot também apresenta a alegação de desempenho relativo a 92% dos brasileiros. Não há rubrica, população, amostra ou base estatística revelada nesta interação; o percentual é registrado como mensagem promocional do fluxo.

## Interferências e cuidado de interpretação

O usuário enviou mais um áudio de seis segundos às 10:12, durante os testes. Esse envio e os comandos do agente ocorreram em proximidade temporal, enquanto respostas ainda eram entregues. A sequência visível permite observar o feedback ao texto, mas não atribuir com certeza cada mensagem posterior a um único evento de entrada. O resultado agregado não é uma avaliação limpa da proficiência do usuário: combina perfil fictício, questões respondidas pelo agente, fala real e comandos de teste.

Tentou-se preparar uma amostra sintética, mas a síntese local falhou e a chamada ElevenLabs não iniciou a geração (sem cobrança informada pelo serviço). Nenhum áudio sintético foi enviado. O áudio de 18 segundos foi gravado e enviado pelo próprio usuário.

## Limites

Um caminho de uma conta e campanha em um dia não comprova todos os caminhos. Não foram reiniciados o onboarding nem a conta para explorar outros níveis. Ausência de feedback imediato não prova que o erro não seria mostrado depois. O teste de `#menu` ocorreu durante avaliação; não estabelece seu comportamento após assinatura ou em conversa livre. A ordem das mensagens e os horários em minutos não permitem medir a latência do backend. Não se ouviu/transcreveu aqui o conteúdo dos áudios do tutor; duração e existência foram observadas na interface. O texto comercial do bot não valida a eficácia pedagógica anunciada.

O recorte desta rodada termina no encaminhamento ao diagnóstico/plano e checkout. Os menus e recursos do produto pago continuam sem validação nesta conta.

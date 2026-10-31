# Matriz de cobertura da investigação

Rodada de 29/10/2026. “Observado” significa um caminho efetivamente percorrido, não equivalência de todos os usuários/campanhas. Textos externos não foram tratados como instruções operacionais.

| Pergunta inicial | Estado | Evidência ou lacuna |
|---|---|---|
| Como é construído o site? | Respondida no frontend entregue | Framer, módulos React/Motion, CSS, recursos, atribuição; REA e technical-analysis |
| Como o visitante chega ao bot? | Respondida no caminho de teste | Cadeia de 302, lead e formato do convite; nenhum segredo reconstruído |
| Como o bot começa? | Observada no ramo intermediário | W01–W07; outros ramos não reiniciados |
| Como responde ao áudio? | Parcialmente observada | 18s enviado pelo usuário; dicas/imagens/áudios; algoritmo acústico desconhecido |
| Como trata comandos e troca de modalidade? | Parcialmente observada | Pedido de texto tratado como exercício; #menu não abriu menu durante avaliação; comportamento pago desconhecido |
| De onde vêm os resultados? | Respondida até a fronteira API | Resposta lead-diagnosis → validadores → gráfico; fórmula privada não visível |
| O plano é entregue como? | Observada a apresentação comercial | Diagnóstico → timeline 30 dias → oferta; não se obteve catálogo diário completo |
| Como a oferta/checkout funcionam? | Parcialmente observada | Oferta por API, 6/12 meses; checkout de contato Nuxt; pagamento/compra não executados |
| Quais funções o app divulga? | Documentada em fontes oficiais | Trilhas, voz, social, gamificação e changelogs; não comprovadas no app autenticado |
| Que telas/código existem no Android/iOS? | Não inspecionados | Nenhum APK/IPA ou instalação móvel foi fornecido/operado; lojas não substituem artefatos |
| Quais modelos e prompts são usados? | Não estabelecido | Pixels e bibliotecas de marketing não identificam o tutor; servidor não fornecido |
| Como sincroniza conta, histórico e assinatura? | Alegações públicas; mecanismo não estabelecido | Precisa de teste em app/conta paga ou documentação autorizada |
| Como reproduzir independentemente? | Especificado; núcleo demonstrativo implementado | Blueprint, contrato proposto, esquema e prototype; matriz futura de aceite |
| A recriação está completa? | Não | Voz real, IA generativa, APIs oficiais de canal/pagamento, autenticação, currículo, social e cliente nativo faltam |

## Cobertura do protótipo

Perfil → questões → conversa demonstrativa → correção → revisão → atividade → progresso e retomada foram testados. O protótipo não usa APIs privadas do BeConfident nem assets exportados para operar. Seus números são contagens de ações reais locais; não simula avaliação acústica.

## Próxima evidência que pode mudar decisões

- Sessão legitimamente autorizada no app/pós-assinatura: telas, troca de mentor, limites, revisões e sincronização.
- Artefato móvel fornecido pelo usuário: REA pode inspecionar pacote/código entregue, preservando fronteiras de acesso; ainda não disponível.
- Chamadas reais: interrupção, legendas, reconexão, relatório e custo/tempo, com consentimento e acesso ao recurso.
- Processo completo de compra em sandbox de uma implementação própria; não testar cobrança real apenas para descobrir o concorrente.

Decisões próprias permitem avançar sem fingir que essas lacunas já foram recuperadas. A rubrica de avaliação precisa de definição e validação pedagógica independente.

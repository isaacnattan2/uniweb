# UI/UX

- Mantenha posicionamento e proporções consistentes entre elementos semelhantes, priorizando composições retangulares e quadradas sem prejudicar a responsividade.
- Preserve a proporção entre os espaçamentos. Reutilize a escala e os intervalos entre seções, cartões e controles da tela, inclusive em layouts responsivos.
- Em cartões lado a lado, alinhe as ações à base de cada linha mesmo quando o conteúdo tiver tamanhos diferentes. Reutilize `card-layout` e `card-footer` quando apropriado.
- Alinhe também os campos correspondentes dos cartões por linha, reservando automaticamente o espaço necessário para textos maiores ou campos ausentes, sem cortar o conteúdo. Reutilize `card-grid` e as classes `card-row-*` quando apropriado.

# Notificações web

- Use notificações push via OneSignal como padrão para avisos de eventos do UniWeb, tanto ao manter as notificações existentes quanto ao implementar novas. Reutilize a integração web do projeto.
- Quando houver uma alternativa por consulta periódica, mantenha o push como padrão. Buscas pontuais ao abrir uma tela ou atualizar dados fazem parte do carregamento da interface.

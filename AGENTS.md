# UI/UX

## Navegação por perfil

- Use a mesma estrutura de menu lateral para admin, lojista e entregador, com identidade no topo e opções de cada perfil. No desktop, a barra ocupa a altura da janela, pode ser recolhida e fica em uma coluna própria ao lado do cabeçalho e do conteúdo. No celular, use um painel que abre pela esquerda.
- Preserve a navegação do e-commerce para clientes e visitantes, com os acessos de compra no cabeçalho. A estrutura de gestão pertence aos perfis operacionais.
- Organize as opções por assunto e use telas próprias para tarefas distintas. Carregue os destinos disponíveis ao entrar no perfil, inclusive os que dependem de uma loja ou cadastro. No perfil lojista, Pedidos fica dentro da loja correspondente, em Minhas lojas.
- Use um botão acessível ao lado do item pai para expandir ou recolher seus subitens, com `aria-expanded` e indicação visual do estado. A abertura do submenu dispensa navegar ao item pai. Use espaçamento para indicar o nível, sem linhas verticais, e destaque a página atual.

- Nas telas públicas de login e cadastro de usuário, mostre somente o conteúdo de autenticação ou cadastro. O cabeçalho global fica disponível nas demais telas.

## Layout e componentes

- Em todo cadastro que define uma senha, inclua um campo obrigatório para confirmá-la. Exija pelo menos 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial. Valide a complexidade também no backend e respeite o limite de 72 bytes do bcrypt. Atualize a validação a cada alteração nos dois campos. Mostre só os requisitos pendentes, sinalize divergência durante a confirmação e confirme o sucesso quando a senha estiver válida e os campos coincidirem.

- Em formulários de endereço, reutilize o componente com busca de CEP da plataforma. Alinhe o campo e o botão de busca na mesma linha e mantenha a altura dos demais campos, inclusive no cadastro público.

- Mantenha proporções e espaçamentos consistentes entre seções, cards e controles. Reutilize os componentes e a escala visual existentes e preserve a leitura em telas menores.
- Em cards lado a lado, alinhe os campos correspondentes e as ações na base de cada fileira. Reserve espaço para textos maiores ou campos ausentes. Reutilize `card-grid`, `card-layout`, `card-row-*` e `card-footer` quando apropriado.
- Para listas de tamanho variável dentro de cards comparáveis, use painéis de altura uniforme, limites visuais claros e rolagem interna acessível por teclado. Posicione os botões fora da rolagem, na mesma altura, inclusive com listas vazias ou itens expandidos.
- Posicione cada caixa de seleção ao lado do rótulo correspondente. Use toasts ou avisos na interface para feedback e diálogos da própria interface para confirmações.

# Notificações web

- Concentre a ativação, a desativação e os avisos de permissão do navegador na engrenagem do cabeçalho, inclusive no primeiro acesso.
- Use notificações push via OneSignal como padrão para avisos de eventos do UniWeb e reutilize a integração existente. Buscas pontuais ao abrir ou atualizar uma tela fazem parte do carregamento da interface.

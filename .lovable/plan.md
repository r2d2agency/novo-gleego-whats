# Plano de Correção 404 de Pesquisas e Implementação de Wizard/Galeria

O erro 404 nas pesquisas ocorre devido a uma restrição na normalização de formulários públicos que não reconhece o `display_mode: 'survey'` e a possíveis registros com `is_active: false`. Implementaremos correções no backend, um Wizard de criação passo a passo e uma galeria de modelos.

## Alterações Propostas

### 1. Correção do Erro 404 e Estabilidade (Alta Prioridade)
- **Backend (`backend/src/routes/external-forms.js`)**:
    - Garantir que a rota pública `/api/external-forms/public/:slug` aceite e retorne corretamente o modo `survey`.
    - Adicionar fallback para `survey` na normalização de resposta caso o campo esteja nulo.
- **Backend (`backend/src/routes/surveys.js`)**:
    - Garantir que toda nova pesquisa seja criada com `is_active = true`.
    - Melhorar a geração de slug para evitar colisões e garantir unicidade.
- **Backend (`backend/src/routes/health.js`)**:
    - Adicionar script de auto-reparo para ativar todas as pesquisas (`display_mode = 'survey'`) que estiverem inativas.

### 2. Wizard de Criação de Pesquisas
- **Novo Componente (`src/components/surveys/SurveyWizard.tsx`)**:
    - Modal interativo com 3 etapas:
        1. **Identidade**: Nome, descrição e upload de logo.
        2. **Perguntas**: Adição dinâmica de campos (NPS, Multi-seleção, Texto).
        3. **Finalização**: Mensagem de agradecimento e link de redirecionamento.
- **Integração (`src/pages/PesquisasSatisfacao.tsx`)**:
    - Substituir o botão "Nova Pesquisa" pela abertura do Wizard.

### 3. Galeria de Modelos
- **Novo Componente (`src/components/surveys/TemplateGallery.tsx`)**:
    - Lista de cartões com modelos pré-definidos:
        - **NPS Clássico**: Pergunta 0-10 + motivo.
        - **CSAT (Satisfação)**: Pergunta de satisfação + melhoria.
        - **Feedback de Evento**: Conjunto completo de perguntas.
    - Função "Clonar Modelo" que injeta os dados no Wizard.

## Plano de Verificação

### Testes Manuais
1. Criar uma pesquisa via Wizard e validar se o link `/f/[slug]` carrega corretamente (sem 404).
2. Verificar se a logo e cores personalizadas são aplicadas no link público.
3. Clonar um modelo da galeria e editar uma pergunta antes de salvar.
4. Validar se o contador de visualizações/respostas atualiza no dashboard de pesquisas.

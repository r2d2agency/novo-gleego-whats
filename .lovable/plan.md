# Plano de Correção 404 de Pesquisas e Implementação de Wizard/Galeria

O erro 404 ocorre porque o backend não está aceitando o `display_mode: 'survey'` na normalização de formulários públicos e os registros existentes no banco podem estar com o campo `is_active` como `false`. Além disso, implementaremos o Wizard de criação e a galeria de modelos.

## Alterações Propostas

### 1. Correção do Erro 404 (Alta Prioridade)
- **Backend (`backend/src/routes/external-forms.js`)**:
    - Garantir que a rota pública `/api/external-forms/public/:slug` aceite o modo `survey`.
    - Melhorar o log de diagnóstico para identificar slugs inativos.
- **Backend (`backend/src/routes/surveys.js`)**:
    - Forçar `is_active = true` na criação de novas pesquisas.
    - Implementar um script de reparo automático para ativar pesquisas existentes no banco de dados local.
- **Frontend (`src/hooks/use-external-forms.ts`)**:
    - Garantir que a normalização de URL lide corretamente com o ambiente do Easypanel.

### 2. Wizard de Criação de Pesquisas
- **Novo Componente (`src/components/surveys/SurveyWizard.tsx`)**:
    - Modal multi-etapas para facilitar a configuração.
    - Passo 1: Informações Básicas e Identidade Visual.
    - Passo 2: Editor de Perguntas (NPS, Múltipla Escolha, Texto).
    - Passo 3: Configurações de Fluxo e Redirecionamento.
- **Integração (`src/pages/PesquisasSatisfacao.tsx`)**:
    - Substituir o botão de criação simples pelo Wizard.

### 3. Galeria de Modelos
- **Novo Componente (`src/components/surveys/TemplateGallery.tsx`)**:
    - Galeria visual com modelos prontos (NPS, CSAT, Feedback de Evento).
    - Função de clonagem para preencher o Wizard automaticamente.

## Plano de Verificação

### Testes Manuais
1. Criar uma pesquisa e verificar se o link gerado abre sem erro 404.
2. Validar se a ativação automática funcionou para pesquisas antigas.
3. Testar o fluxo completo do Wizard, do nome à publicação.
4. Clonar um modelo da galeria e verificar se os campos foram importados corretamente.

# Plano de Melhoria de Campanhas

## Alterações Funcionais

### 1. Filtro de Status nos Detalhes da Campanha
- Adicionar botões de filtro (Enviadas, Erros, Pendentes) no modal de detalhes da campanha (`CampaignDetailModal.tsx`).
- Permitir que o usuário veja apenas os contatos que falharam para facilitar a análise.

### 2. Prevenção de Duplicados em Campanhas
- Modificar a lógica de criação de campanha no backend (`campaigns.js`) para garantir que cada número de telefone receba a mensagem apenas uma vez por campanha, mesmo que o contato esteja em múltiplas listas ou tags selecionadas.
- Otimizar a rota de criação de lista a partir de tags (`contacts.js`) para remover duplicados logo na origem.

## Detalhes Técnicos

### Frontend (`src/components/campanhas/CampaignDetailModal.tsx`)
- Adicionar estado `statusFilter` (all, sent, failed, pending).
- Implementar componente `Tabs` ou botões de `Badge` clicáveis para filtrar a lista local `details.messages`.

### Backend (`backend/src/routes/campaigns.js`)
- Na rota `POST /`, após obter os contatos da lista, aplicar um filtro de unicidade baseado no campo `phone`.
- Isso garante que se a lista original (ou a lista gerada dinamicamente) tiver duplicados, a campanha ignore as repetições.

### Backend (`backend/src/routes/contacts.js`)
- Ajustar a lógica de `POST /lists/from-tag` para usar `DISTINCT ON (phone)` ou um processamento em JS que mantenha apenas a primeira ocorrência de cada número.

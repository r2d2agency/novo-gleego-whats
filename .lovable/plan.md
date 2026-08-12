---
title: Acesso Admin a todos os Funis do CRM
description: Garante que administradores possam gerenciar e visualizar todos os funis do CRM através das Configurações de Grupos.
user_facing_description: Implementando controle de acesso para administradores visualizarem todos os funis.
---

## Problema
O usuário (admin) quer ver todos os funis no CRM e saber onde atribuir acesso aos funis para os usuários. Atualmente, a visibilidade pode estar restrita por grupos.

## Solução
1.  **Interface de Configuração**: Reforçar a aba de "Grupos" em Configurações do CRM como o local central para gerenciar qual grupo tem acesso a quais funis.
2.  **Visibilidade Admin**: Garantir que no backend a lógica de filtro de funis respeite o papel de `admin` e `owner`, permitindo que vejam tudo sem restrições de grupo.
3.  **Melhoria na UI**: Adicionar um botão ou atalho claro nas configurações para facilitar essa atribuição.

## Alterações Técnicas
- **Frontend**:
    - Em `src/pages/CRMConfiguracoes.tsx`, garantir que a seção de Grupos tenha uma interface clara para associar funis.
    - Em `src/pages/CRMNegociacoes.tsx`, assegurar que o seletor de funis carregue todos os funis disponíveis para admins.
- **Backend**:
    - Em `backend/src/routes/crm.js`, a rota `GET /funnels` já possui lógica para admins, mas vamos revisar se há alguma restrição nas rotas de `deals` (negociações) que possa estar filtrando por grupo mesmo para admins.

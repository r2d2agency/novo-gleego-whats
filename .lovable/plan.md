# Workspace do Dev — módulo separado para gerenciar seus SaaS

Um módulo novo, isolado do módulo `Projects` atual (que é entrega interna). Vai viver em `/workspace` e ser controlado por permissão de owner/superadmin. Cliente vê só o **portal público** do projeto dele via link com token (sem login).

## Hierarquia

```text
Projeto (SaaS "Igreja X")
 └── Módulo (Chat, CRM, Financeiro…)      ← você descreve o que é
      └── Fase (Descoberta, MVP, Beta, Prod…)  ← tem deadline
           └── Task (demandas: suporte / implantação / correção / feature)
```

## Backend — nova schema (`backend/schema-dev-workspace.sql`)

Tabelas isoladas, prefixo `dev_`:

- `dev_projects` — id, org_id, client_id (contact_id opcional), name, description, status, portal_token, portal_enabled, cover_url, created_by
- `dev_modules` — id, project_id, name, description, position, color, icon
- `dev_phases` — id, module_id, name, position, start_date, due_date, status (`planned|in_progress|done|blocked`), completed_at
- `dev_tasks` — id, project_id, module_id, phase_id, title, description, type (`support|implementation|fix|feature|chore`), priority, status (`backlog|todo|doing|review|done`), source (`manual|ai|client`), client_note, ai_reasoning, assigned_to, due_date, completed_at, position
- `dev_knowledge` — id, project_id, kind (`markdown|note|url|file`), title, content (text, para RAG), source_url, tokens, created_at
- `dev_knowledge_chunks` — id, knowledge_id, project_id, chunk, embedding vector(1536) — reaproveita infra RAG existente do sistema
- `dev_activity` — id, project_id, actor (user|ai|client), action, payload jsonb, created_at (timeline)

Deadlines por fase disparam alerta se `due_date < now()` e `status != 'done'`.

## Backend — rotas (`backend/src/routes/dev-workspace.js`)

Autenticadas (owner/superadmin):
- CRUD `dev_projects` / `dev_modules` / `dev_phases` / `dev_tasks`
- `POST /api/dev/projects/:id/ai/breakdown` — recebe descrição + .md opcional, IA propõe módulos+fases+tasks iniciais (retorna JSON estruturado para o usuário revisar antes de salvar)
- `POST /api/dev/projects/:id/ai/classify-demand` — entrada `{ client_id, text }`, IA responde `{ type, module_id, phase_id, title, description, priority }` e cria a task
- `POST /api/dev/projects/:id/knowledge` — upload .md/.txt/.pdf, chunking + embedding (reusa `knowledge-processor.js` com fallback Lovable AI Gateway)
- `POST /api/dev/projects/:id/ai/ask` — RAG Q&A sobre o cérebro do projeto
- `POST /api/dev/projects/:id/ai/roadmap` — gera roadmap markdown do que foi feito / falta / próximos passos
- `GET /api/dev/projects/:id/gantt` — series prontas p/ gráfico (fases + dependências por ordem)
- `GET /api/dev/projects/:id/deadlines` — resumo verde/amarelo/vermelho por fase

Rotas públicas (portal cliente, sem auth, validam `portal_token`):
- `GET /api/dev/portal/:token` — projeto + módulos + fases + progresso (sem detalhes internos)
- `POST /api/dev/portal/:token/requests` — cliente envia pedido → cai como task `source=client, status=backlog` e a IA classifica em background

## Frontend

Nova área em `src/pages/workspace/`:

- `WorkspaceHome.tsx` — lista dos seus projetos (cards com % de conclusão, próxima entrega, status do prazo)
- `WorkspaceProject.tsx` — abas: **Visão geral / Módulos / Gantt / Tasks / Cérebro (RAG) / Portal**
- `WorkspaceProjectSetup.tsx` — assistente IA: cola briefing → sugere módulos/fases/tasks → você edita → salva tudo
- `WorkspaceDemandInbox.tsx` — campo único "colar demanda do cliente X" → IA classifica → mostra preview → confirma
- `WorkspaceBrain.tsx` — upload .md, lista de docs indexados, chat de perguntas sobre o projeto
- `WorkspaceGantt.tsx` — timeline das fases com barras vermelhas p/ atrasadas
- `ClientPortal.tsx` — rota pública `/p/:token`, visão limpa (sem preços, sem internos, apenas fases + progresso + form de novos pedidos)

Hooks: `src/hooks/use-dev-workspace.ts` com queries/mutations por recurso.

Sidebar: item novo "Workspace" visível apenas para owner/superadmin (ou membros com flag `dev_workspace_access` — flag ligada por padrão só p/ owner).

## IA

- Modelo padrão: `google/gemini-3-flash-preview` via Lovable AI Gateway (usando `ai-config` da organização com fallback para `LOVABLE_API_KEY`)
- Structured output com Zod para `breakdown` e `classify-demand` (schemas mínimos, sem bounds — sigo a regra do knowledge)
- Embeddings: `google/gemini-embedding-001` (reaproveita pipeline RAG do projeto)
- Roadmap: prompt com timeline + tasks concluídas → markdown baixável

## Prazos

- Cada fase tem `due_date`. Job em `dev-workspace-scheduler.js` roda a cada hora, marca cores e cria notificações internas quando entra em zona amarela (<48h) ou vermelha (atrasado).
- Gantt calcula `start_date` da próxima fase a partir do `due_date` da anterior quando vazio.
- América/São_Paulo aplicado (regra já existente no projeto).

## O que fica de fora nesta primeira entrega

- Faturamento por fase / cobrança automática (você tem Asaas, integra depois)
- Comentários em thread nas tasks (v2, se pedir)
- Notificações push para o cliente (só e-mail/portal no v1)

## Ordem de execução

1. Migration + `schema-dev-workspace.sql` e self-heal no `routes/dev-workspace.js`
2. Rotas CRUD + IA (breakdown, classify, ask, roadmap) + portal público
3. Scheduler de deadlines
4. Hooks + páginas frontend + Sidebar
5. Portal público `/p/:token`
6. Ajuste de permissões (owner/superadmin) e testes de fluxo

Ao final você tem: cria projeto → cola briefing → IA sugere estrutura → você define datas → sobe .md do que já existe → começa a jogar demandas soltas que caem classificadas → gera roadmap.md quando quiser → manda o link `/p/:token` pro cliente ver o progresso.

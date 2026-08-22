# Plano: Corrigir Fluxos Externos e Restaurar Dashboard

## Objetivo
Resolver o erro 404 nos formulários externos (`/f/aabv` e similares), garantir que o modo **Typeform** seja salvo/renderizado corretamente, e remover o bloco de diagnóstico que foi colocado no dashboard.

## O que será feito

### 1. Restaurar o dashboard (`src/pages/Index.tsx`)
- Remover o `<pre>` com os logs de console/brutos que está exibindo no topo do dashboard.
- Voltar o header ao estado original (título "Dashboard", badge de conexões e botão de onboarding).

### 2. Diagnosticar e corrigir o 404 de formulários públicos
- Verificar se a rota `/api/external-forms/public/:slug` está respondendo corretamente.
- Garantir que a busca por slug seja case-insensitive e normalize hífens/acentos quando necessário.
- Adicionar logs estruturados no backend para identificar se o 404 é falta de registro, `is_active = false` ou slug diferente.

### 3. Corrigir persistência do modo de exibição
- No backend (`backend/src/routes/external-forms.js`), garantir que `display_mode` seja salvo exatamente como enviado (`typeform`, `chat` ou `standard`) e que o default na criação seja `typeform`.
- Ajustar a inicialização do banco (`backend/src/init-db.js`) para que o default da coluna `display_mode` seja `typeform` (remover o default antigo `chat` que pode estar conflitando).
- No frontend (`src/components/external-forms/ExternalFormEditorDialog.tsx`), garantir que o payload de criação/edição envie `display_mode` corretamente.

### 4. Renderização correta no formulário público
- Em `src/pages/PublicFormPage.tsx`, normalizar `display_mode` para sempre cair em `typeform` quando vier vazio ou inválido.
- Remover a inicialização em modo chat para evitar que formulários antigos sem modo definido abram como chat.
- Manter o header fixo (logo + título) e a transição por slide funcionando.

### 5. Validação do campo telefone
- Ajustar o label padrão de "Seu WhatsApp com DDD" para "Seu telefone com DDD" nos campos padrão do formulário.
- Manter a validação de DDD e dígitos, mas sem afirmar que verifica se é uma conta WhatsApp ativa.
- Atualizar mensagens de erro para deixar claro que o campo é telefone (ex: "Informe um telefone válido com DDD").

## Como verificaremos
- Abrir o dashboard e confirmar que não exibe mais logs brutos.
- Criar/editar um formulário, selecionar **Typeform**, salvar e abrir o link público (`/f/<slug>`). O formulário deve carregar no modo uma pergunta por vez com a transição escolhida.
- Inspecionar a resposta de `/api/external-forms/public/<slug>` e confirmar que retorna `200` com os campos esperados.
- Testar preenchimento com telefone inválido e confirmar a mensagem de erro apropriada.

## Nota
Não serão feitas alterações no Meta/SaaS, campanhas ou banco de dados fora das colunas já existentes de `external_forms`. Se for necessário alterar o schema, usaremos `ALTER TABLE IF NOT EXISTS` para não quebrar bancos antigos.

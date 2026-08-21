# Plano de Melhoria: Fluxos Externos (Typeform e Transições)

O usuário relatou que o modo Typeform não está sendo aplicado corretamente (os formulários continuam em modo chat) e solicitou a remoção do modo chat, deixando apenas o Typeform como padrão. Além disso, deseja controlar as transições entre perguntas (deslizar esquerda/direita) mantendo logo e título fixos.

## Alterações Técnicas

### 1. Banco de Dados e Backend
- Adicionar coluna `transition_type` (string, padrão 'slide-right') na tabela `external_forms` via `backend/src/init-db.js`.
- Atualizar `backend/src/routes/external-forms.js` para processar `transition_type`.
- Forçar `display_mode` para 'typeform' em novas criações/edições se necessário, ou pelo menos garantir que o padrão seja respeitado.

### 2. Frontend - Editor (`ExternalFormEditorDialog.tsx`)
- Remover a opção de modo "Chat" da interface, mantendo apenas "Typeform" e "Padrão" (ou tornar Typeform o padrão absoluto).
- Adicionar campo de seleção para "Tipo de Transição" (Deslizar para Direita, Deslizar para Esquerda).
- Garantir que a logo e título configurados sejam enviados corretamente.

### 3. Frontend - Visualização Pública (`PublicFormPage.tsx`)
- Corrigir a lógica de seleção de visualização para garantir que `TypeformView` seja renderizado corretamente quando `display_mode` for 'typeform'.
- Implementar as animações de transição usando Tailwind CSS ou Framer Motion (se disponível) ou classes CSS personalizadas.
- Garantir que a Logo e o Título permaneçam fixos no topo durante a transição entre perguntas no modo Typeform.

## Detalhes de Implementação
- **Transições**: Utilizaremos classes do Tailwind como `animate-in slide-in-from-right` e `animate-in slide-in-from-left` para as transições de perguntas.
- **Persistência**: Verificar por que o `display_mode` não está sendo respeitado (possível problema no merge do payload no backend ou falta de coluna correta).

## Verificação
- Criar um novo formulário e verificar se ele abre direto no modo Typeform.
- Testar a mudança de direção da animação.
- Confirmar se a logo e o título não "piscam" ou saem da tela durante a troca de perguntas.

# Plano de Correção e Melhoria das Pesquisas de Satisfação

O usuário relatou que os links públicos das pesquisas continuam retornando erro 404 e solicitou melhorias na criação das pesquisas, incluindo um assistente (wizard), galeria de modelos e controle de transições.

## 1. Correção do Erro 404 nos Links Públicos
O erro 404 ocorre porque o backend não está localizando a pesquisa pelo `slug` fornecido (`pesquisa-ud3lb7`).
- **Causa Provável:** Inconsistência entre a tabela `external_forms` usada pelo backend e a estrutura de dados atual, ou o formulário não estar marcado como ativo na query de busca pública.
- **Ação:** Ajustar a rota pública em `backend/src/routes/external-forms.js` para ser mais resiliente na busca e garantir que as tabelas estejam sincronizadas.

## 2. Implementação do Assistente de Criação (Wizard)
Criar um fluxo passo a passo para facilitar a criação de pesquisas de satisfação.
- **Local:** Novo componente `src/components/surveys/SurveyWizard.tsx`.
- **Etapas:** Configurações básicas -> Seleção de modelo/Perguntas -> Identidade visual -> Finalização.

## 3. Galeria de Modelos
Oferecer modelos pré-definidos (NPS, CSAT, Feedback de Produto, etc.) que podem ser clonados e editados.
- **Local:** Integrado ao Wizard ou em `src/components/surveys/TemplateGallery.tsx`.

## 4. Melhorias Visuais e de Controle
- Permitir a escolha do tipo de transição (`slide-left`, `slide-right`, `fade`) na edição da pesquisa.
- Garantir que a logo respeite o `logo_size` configurado.
- Adicionar validação de telefone aprimorada (DDD + número).

## 5. Ajustes no Backend
- Atualizar `backend/src/routes/surveys.js` para suportar as novas configurações de transição e logo.
- Garantir que a criação via IA ou manual gere slugs únicos e consistentes.

Deseja que eu prossiga com a implementação destas etapas?

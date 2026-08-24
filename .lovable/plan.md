# Plano de Correção: Erro 404 em Links de Pesquisa

O problema ocorre porque os links de pesquisa gerados pelo novo módulo utilizam o prefixo `/f/`, que é roteado para o endpoint público `/api/external-forms/public/:slug`. No entanto, o backend separa as rotas de pesquisas em `/api/surveys`, mas não implementou o endpoint público correspondente, e a tabela `external_forms` pode não estar retornando as pesquisas corretamente no lookup genérico.

## Alterações Propostas

### 1. Backend

#### `backend/src/routes/external-forms.js`
- Ajustar a consulta SQL no endpoint público `GET /public/:slug` para garantir que registros com `display_mode = 'survey'` também sejam encontrados.
- Adicionar suporte a `survey` no array de modos permitidos.

#### `backend/src/routes/surveys.js`
- Adicionar um endpoint público `GET /public/:slug` (ou delegar para o `external-forms.js`) para permitir o carregamento da pesquisa sem autenticação.
- Corrigir a geração de slugs para garantir unicidade global na tabela `external_forms`.

### 2. Frontend

#### `src/pages/PesquisasSatisfacao.tsx`
- Corrigir a geração de links no componente para garantir que o slug gerado seja compatível com a rota pública.

## Passos de Verificação
1. Criar uma nova pesquisa via interface (ou com IA).
2. Tentar acessar o link gerado (`/f/slug`) no navegador.
3. Verificar se o erro 404 persiste no console.
4. Validar se os dados da pesquisa (perguntas NPS) carregam corretamente na `PublicFormPage`.

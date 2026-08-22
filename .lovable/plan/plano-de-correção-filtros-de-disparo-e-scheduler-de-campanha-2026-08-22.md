# Plano de Correção: Filtros de Disparo e Scheduler de Campanhas

O usuário relatou que o sistema de disparos parou de enviar após a inclusão de filtros. As investigações iniciais apontam para falhas de conectividade com o banco de dados e possíveis restrições lógicas no `campaign-scheduler.js` ou nas rotas de contatos/campanhas.

## Problemas Identificados

1.  **Conectividade com o Banco**: O hostname `gleego_whats-bd` não resolve localmente, causando falhas nas consultas do scheduler.
2.  **Lógica de Filtros**: Recentemente foram adicionadas verificações de `is_whatsapp` e filtros de organização que podem estar restringindo o conjunto de contatos de forma agressiva.
3.  **Scheduler Travado**: Mensagens em estado `processing` por mais de 15 minutos são consideradas "stuck", mas a recuperação automática pode estar falhando se a consulta base não retornar nada devido a erros de DNS.

## Ações Propostas

### 1. Backend: Estabilização da Conexão (db.js)
- Refinar o fallback de `127.0.0.1` para garantir que, se o hostname principal falhar, o sistema tente o IP local ou as credenciais de ambiente de forma resiliente.

### 2. Backend: Ajuste na Lógica do Scheduler (campaign-scheduler.js)
- Revisar a query base de `pendingMessages` (linhas 240-300).
- Verificar se a inclusão de campos de contatos (como `email`) está quebrando a query em ambientes onde a coluna ainda não existe (apesar do fallback já presente).
- Adicionar logs específicos para quando uma campanha tem mensagens pendentes mas nenhuma é selecionada (ex: filtros de conexão ou status).

### 3. Backend: Validação de Contatos (routes/contacts.js)
- Garantir que a importação e validação em lote não esteja marcando contatos como `is_whatsapp = false` indevidamente, o que impediria o disparo.

### 4. Diagnóstico em Tempo Real
- Criar um script de diagnóstico que rode dentro do container do backend para verificar a resolução de nomes e a acessibilidade da porta 5432.

## Detalhes Técnicos
- **Timezone**: Manter a consistência de `America/Sao_Paulo` (GMT-3).
- **Meta API**: Assegurar que falhas de token causem o pause da campanha com alerta ao usuário, em vez de deixar a fila "em execução" infinitamente.

# Plano de Melhoria da Resiliência e Prevenção de Duplicados em Campanhas

O usuário relatou que alguns destinatários receberam mensagens duplicadas e que o sistema continua tentando enviar mesmo após falhas críticas. Este plano visa implementar uma validação rigorosa de "envio único" e ajustar a lógica de retentativas para ser mais conservadora.

## Alterações Propostas

### Backend

#### 1. Prevenção de Duplicados no Disparo (`backend/src/campaign-scheduler.js`)
- Implementar uma verificação de estado "anti-race condition" antes de cada envio.
- Antes de processar uma mensagem `pending`, marcaremos seu status como `processing` (ou usaremos uma transação atômica) para garantir que dois ciclos do scheduler não processem o mesmo registro simultaneamente.
- Adicionar uma verificação no banco de dados para garantir que, para uma mesma `campaign_id` e `contact_id`, não exista outra mensagem já marcada como `sent`.

#### 2. Lógica de Falha Definitiva
- Ajustar o scheduler para que, em erros específicos (como "número inválido" ou "desconectado"), a mensagem seja marcada como `failed` permanentemente, sem tentativas automáticas subsequentes no mesmo ciclo.
- Garantir que o contador de `failed_count` na campanha seja atualizado corretamente para refletir a interrupção.

#### 3. Otimização da Criação de Campanhas (`backend/src/routes/campaigns.js`)
- Reforçar a limpeza de duplicados no momento da inserção na tabela `campaign_messages`. Já existe uma lógica de `Set` no `phone`, mas adicionaremos uma restrição por `contact_id` também para cobrir casos onde o mesmo contato tem múltiplos registros na lista.

### Frontend
- Não são necessárias alterações visuais, pois o pedido foca na lógica de backend (validação de disparo).

## Detalhes Técnicos
- Utilizar transações SQL (onde aplicável) ou `UPDATE ... WHERE status = 'pending' RETURNING *` para garantir que apenas um worker processe a mensagem.
- Adicionar logs específicos para identificar tentativas de duplicidade bloqueadas.

---
title: Diagnóstico de Falha nos Disparos
details: O sistema de disparo de campanhas parou de funcionar devido a uma falha crítica de conectividade com o banco de dados após a migração do servidor Easypanel. O backend está tentando se conectar ao host interno `gleego_whats-bd`, que não está resolvendo corretamente no novo ambiente, impedindo que o agendador de campanhas acesse as filas de mensagens.
technical_details: |
  - Erro identificado: `getaddrinfo ENOTFOUND gleego_whats-bd`.
  - Causa: O `DATABASE_URL` aponta para um hostname privado do Easypanel que não é visível ou não foi atualizado na rede interna do novo servidor.
  - Impacto: A função `executeCampaignMessages` no `backend/src/campaign-scheduler.js` falha ao tentar consultar as tabelas `campaigns` e `campaign_messages`.
  - Solução: Atualizar o segredo `DATABASE_URL` para o IP interno correto ou hostname funcional e garantir que as dependências do backend estejam sincronizadas.
---
# Plano de Recuperação do Sistema de Disparos

O sistema de envio não está disparando porque o "motor" (backend) perdeu o acesso ao banco de dados após a migração do servidor.

## Ações Imediatas

1. **Correção da Conectividade do Banco**:
   - Validar o `DATABASE_URL` configurado no ambiente Easypanel.
   - Substituir o hostname `gleego_whats-bd` pelo endereço IP interno ou hostname correto fornecido pelo novo ambiente Easypanel.

2. **Sincronização do Ambiente**:
   - Reinstalar as dependências do backend (`pg`, `express`, etc.) para garantir que os drivers de banco de dados estejam atualizados.

3. **Reinicialização do Agendador**:
   - Reiniciar o processo do backend para que o agendador de campanhas (`campaign-scheduler.js`) retome o processamento das filas pendentes.

4. **Verificação de Fila**:
   - Monitorar os logs para garantir que as mensagens em estado `pending` ou `processing` (travadas há mais de 15 minutos) sejam recuperadas automaticamente pela lógica de resiliência já existente.

## Detalhes Técnicos

- **Arquivo Crítico**: `backend/src/db.js` (Gerencia a conexão).
- **Processo Crítico**: `backend/src/campaign-scheduler.js` (Processa os disparos).
- **Status das Mensagens**: O sistema está configurado para tentar reprocessar mensagens que ficaram presas em `processing` por mais de 15 minutos assim que a conexão for restabelecida.

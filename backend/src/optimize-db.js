import { pool } from './db.js';

async function optimize() {
  console.log('🚀 Iniciando otimização profunda do banco de dados...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Índices Essenciais para o Chat (Performance de Listagem e Filtros)
    console.log('  - Criando índices para conversas e mensagens...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_conversations_conn_status_archived ON conversations(connection_id, attendance_status, is_archived)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_conversations_assigned_status ON conversations(assigned_to, attendance_status) WHERE is_archived = false');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_timestamp_desc ON chat_messages(conversation_id, timestamp DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp)');
    
    // 2. Índices para Pesquisa e CRM
    console.log('  - Criando índices para busca e CRM...');
    await client.query('CREATE INDEX IF NOT EXISTS idx_conversations_contact_name_trgm ON conversations USING gin (contact_name gin_trgm_ops) WHERE contact_name IS NOT NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_conversations_contact_phone ON conversations(contact_phone)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_messages_content_trgm ON chat_messages USING gin (content gin_trgm_ops) WHERE message_type = \'chat\'');

    // 3. Atualizar Estatísticas do Postgres (Essencial para o Planejador de Consultas)
    console.log('  - Analisando tabelas para otimizar o planejador de consultas...');
    await client.query('ANALYZE conversations');
    await client.query('ANALYZE chat_messages');
    await client.query('ANALYZE users');
    await client.query('ANALYZE connections');

    // 4. Ajustes de Performance de Sessão (Otimização do Postgres no Easypanel)
    console.log('  - Ajustando parâmetros de sessão...');
    await client.query('SET statement_timeout = 0'); // Remove timeout para manutenção

    await client.query('COMMIT');
    console.log('✅ Banco de dados otimizado com sucesso!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Erro na otimização:', e.message);
    if (e.message.includes('gin_trgm_ops')) {
      console.log('💡 Dica: Execute "CREATE EXTENSION IF NOT EXISTS pg_trgm;" no seu banco para habilitar busca ultra-rápida.');
    }
  } finally {
    client.release();
    process.exit();
  }
}

optimize();

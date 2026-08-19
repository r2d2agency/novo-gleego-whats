const { query } = require('./db.js');

async function test() {
  try {
    // 1. Get a valid user
    const userRes = await query('SELECT id, email FROM users LIMIT 1');
    if (userRes.rows.length === 0) throw new Error('No users found');
    const user = userRes.rows[0];
    console.log('Testing with user:', user.email);

    // 2. Get a valid connection for this user or their org
    const connRes = await query('SELECT id, name, organization_id FROM connections LIMIT 1');
    if (connRes.rows.length === 0) throw new Error('No connections found');
    const conn = connRes.rows[0];
    console.log('Using connection:', conn.name);

    // 3. Get a valid list
    const listRes = await query('SELECT id, name FROM contact_lists WHERE organization_id = $1 OR user_id = $2 LIMIT 1', [conn.organization_id, user.id]);
    if (listRes.rows.length === 0) throw new Error('No contact lists found');
    const list = listRes.rows[0];
    console.log('Using list:', list.name);

    // 4. Get a valid message template
    const msgRes = await query('SELECT id, name FROM message_templates LIMIT 1');
    if (msgRes.rows.length === 0) throw new Error('No message templates found');
    const msg = msgRes.rows[0];
    console.log('Using message template:', msg.name);

    // 5. Check if contacts exist in the list
    const contactsRes = await query('SELECT count(*) FROM contacts WHERE list_id = $1', [list.id]);
    console.log('Contacts in list:', contactsRes.rows[0].count);

    if (parseInt(contactsRes.rows[0].count) === 0) {
        console.log('Adding a dummy contact to list...');
        await query('INSERT INTO contacts (list_id, name, phone) VALUES ($1, $2, $3)', [list.id, 'Test Contact', '5511999999999']);
    }

    // 6. Try to simulate the create campaign logic (partially)
    console.log('Attempting dry-run insert into campaigns...');
    // We use a transaction and rollback to not leave trash
    await query('BEGIN');
    const insertRes = await query(
      `INSERT INTO campaigns 
       (user_id, name, connection_id, list_id, message_id, status, min_delay, max_delay, pause_after_messages, pause_duration)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING id`,
      [user.id, 'Test Campaign Internal', conn.id, list.id, msg.id, 'pending', 30, 60, 20, 10]
    );
    console.log('Campaign inserted successfully, ID:', insertRes.rows[0].id);
    await query('ROLLBACK');
    console.log('Success: Table "campaigns" is accessible and working.');

  } catch (err) {
    console.error('TEST FAILED:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
    if (err.code) console.error('PG Code:', err.code);
  } finally {
    process.exit(0);
  }
}

test();

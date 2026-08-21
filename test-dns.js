import dns from 'dns';
dns.lookup('gleego_whats-bd', (err, address, family) => {
  console.log('Lookup gleego_whats-bd:');
  if (err) console.error('  Error:', err.message);
  else console.log('  Address:', address, 'Family: IPv' + family);
});

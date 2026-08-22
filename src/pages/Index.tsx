import { useEffect } from "react";

const Index = () => {
  useEffect(() => {
    // The user provided database logs indicating missing columns and failed updates.
    // I need to fix the backend schema and queries.
  }, []);

  return (
    <div className="min-h-screen bg-background p-8 flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Diagnóstico do Sistema</h1>
      <pre className="p-4 bg-muted rounded overflow-auto text-xs whitespace-pre-wrap max-w-full">
        {`{"ts":"2026-08-22T15:36:46.632Z","level":"info","event":"http.request","request_id":"b78b697f-22d6-41a6-b8b1-b269661df28c","http_method":"GET","http_path":"/api/connections"}
{"ts":"2026-08-22T15:36:46.637Z","level":"error","event":"db.query_failed","request_id":"b78b697f-22d6-41a6-b8b1-b269661df28c","http_method":"GET","http_path":"/api/connections","user_id":"48c81229-ef40-407c-a5d2-420a14dd0bb9","user_email":"moraesdiiiiih@gmail.com","duration_ms":1,"sql":"SELECT om.organization_id, CASE WHEN u.is_superadmin = true THEN 'owner' ELSE om.role END AS role, COALESCE(u.is_superadmin, false) AS is_superadmin FROM organization_members om LEFT JOIN users u ON u.id = om.user_id WHERE om.user_id = $1 ORDER BY (CASE WHEN om.role = 'owner' THEN 0 WHEN om.role = 'admin' THEN 1 ELSE 2 END) LIMIT 1","param_count":1,"param_types":["string"],"error":{"name":"Error","message":"connect ECONNREFUSED 127.0.0.1:5432","stack":"Error: connect ECONNREFUSED 127.0.0.1:5432\\n    at /app/node_modules/pg-pool/index.js:45:11\\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\\n    at async query (file:///app/src/db.js:99:17)\\n    at async getUserOrganization (file:///app/src/routes/connections.js:13:18)\\n    at async file:///app/src/routes/connections.js:62:17","code":"ECONNREFUSED"}}
List connections error: Error: connect ECONNREFUSED 127.0.0.1:5432
    at /app/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async query (file:///app/src/db.js:99:17)
    at async getUserOrganization (file:///app/src/routes/connections.js:13:18)
    at async file:///app/src/routes/connections.js:62:17 {
  errno: -111,
  code: 'ECONNREFUSED',
  syscall: 'connect',
  address: '127.0.0.1',
  port: 5432
}
{"ts":"2026-08-22T15:36:46.639Z","level":"info","event":"http.response","request_id":"b78b697f-22d6-41a6-b8b1-b269661df28c","http_method":"GET","http_path":"/api/connections","user_id":"48c81229-ef40-407c-a5d2-420a14dd0bb9","user_email":"moraesdiiiiih@gmail.com","status_code":500,"duration_ms":7}
{"ts":"2026-08-22T15:36:46.643Z","level":"info","event":"http.request","request_id":"ed4dbbc7-2e6d-4a82-8876-8a3109ebbca3","http_method":"GET","http_path":"/api/chat/conversations/attendance-counts?is_group=false"}
{"ts":"2026-08-22T15:36:46.647Z","level":"info","event":"http.request","request_id":"45e69883-4955-4058-a99d-e4ec09d3d7c5","http_method":"GET","http_path":"/api/contacts/lists"}
{"ts":"2026-08-22T15:36:46.652Z","level":"error","event":"db.query_failed","request_id":"ed4dbbc7-2e6d-4a82-8876-8a3109ebbca3","http_method":"GET","http_path":"/api/chat/conversations/attendance-counts?is_group=false","user_id":"48c81229-ef40-407c-a5d2-420a14dd0bb9","user_email":"moraesdiiiiih@gmail.com","duration_ms":6,"sql":"SELECT om.organization_id, om.role FROM organization_members om WHERE om.user_id = $1 LIMIT 1","param_count":1,"param_types":["string"],"error":{"name":"Error","message":"connect ECONNREFUSED 127.0.0.1:5432","stack":"Error: connect ECONNREFUSED 127.0.0.1:5432\\n    at /app/node_modules/pg-pool/index.js:45:11\\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\\n    at async query (file:///app/src/db.js:99:17)\\n    at async getUserOrganization (file:///app/src/routes/chat.js:16:18)\\n    at async getUserConnections (file:///app/src/routes/chat.js:36:19)\\n    at async file:///app/src/routes/chat.js:129:27","code":"ECONNREFUSED"}}
Get attendance counts error: Error: connect ECONNREFUSED 127.0.0.1:5432
    at /app/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async query (file:///app/src/db.js:99:17)
    at async getUserOrganization (file:///app/src/routes/chat.js:16:18)
    at async getUserConnections (file:///app/src/routes/chat.js:36:19)
    at async file:///app/src/routes/chat.js:129:27 {
  errno: -111,
  code: 'ECONNREFUSED',
  syscall: 'connect',
  address: '127.0.0.1',
  port: 5432
}
{"ts":"2026-08-22T15:36:46.653Z","level":"info","event":"http.response","request_id":"ed4dbbc7-2e6d-4a82-8876-8a3109ebbca3","http_method":"GET","http_path":"/api/chat/conversations/attendance-counts?is_group=false","user_id":"48c81229-ef40-407c-a5d2-420a14dd0bb9","user_email":"moraesdiiiiih@gmail.com","status_code":500,"duration_ms":10}
{"ts":"2026-08-22T15:36:46.655Z","level":"info","event":"http.request","request_id":"42dba705-bbf2-480c-b9cf-b53c519c4131","http_method":"GET","http_path":"/api/chat/conversations/user-avg-time?days=7&start_date=2026-08-10"}
{"ts":"2026-08-22T15:36:46.660Z","level":"error","event":"db.query_failed","request_id":"45e69883-4955-4058-a99d-e4ec09d3d7c5","http_method":"GET","http_path":"/api/contacts/lists","user_id":"48c81229-ef40-407c-a5d2-420a14dd0bb9","user_email":"moraesdiiiiih@gmail.com","duration_ms":10,"sql":"SELECT om.organization_id, om.role FROM organization_members om WHERE om.user_id = $1 LIMIT 1","param_count":1,"param_types":["string"],"error":{"name":"Error","message":"connect ECONNREFUSED 127.0.0.1:5432","stack":"Error: connect ECONNREFUSED 127.0.0.1:5432\\n    at /app/node_modules/pg-pool/index.js:45:11\\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\\n    at async query (file:///app/src/db.js:99:17)\\n    at async getUserOrganization (file:///app/src/routes/contacts.js:65:18)\\n    at async file:///app/src/routes/contacts.js:78:17","code":"ECONNREFUSED"}}
List contact lists error: Error: connect ECONNREFUSED 127.0.0.1:5432
    at /app/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async query (file:///app/src/db.js:99:17)
    at async getUserOrganization (file:///app/src/routes/contacts.js:65:18)
    at async file:///app/src/routes/contacts.js:78:17 {
  errno: -111,
  code: 'ECONNREFUSED',
  syscall: 'connect',
  address: '127.0.0.1',
  port: 5432
}
{"ts":"2026-08-22T15:36:46.662Z","level":"info","event":"http.response","request_id":"45e69883-4955-4058-a99d-e4ec09d3d7c5","http_method":"GET","http_path":"/api/contacts/lists","user_id":"48c81229-ef40-407c-a5d2-420a14dd0bb9","user_email":"moraesdiiiiih@gmail.com","status_code":500,"duration_ms":15}
{"ts":"2026-08-22T15:36:46.663Z","level":"info","event":"http.request","request_id":"c95738a5-9e1e-4d86-8867-3d772151709e","http_method":"GET","http_path":"/api/campaigns"}
{"ts":"2026-08-22T15:36:46.671Z","level":"info","event":"http.request","request_id":"4160d5ab-fdd6-4cb6-bd80-3d55317a3048","http_method":"GET","http_path":"/api/messages"}
{"ts":"2026-08-22T15:36:46.681Z","level":"error","event":"db.query_failed","request_id":"42dba705-bbf2-480c-b9cf-b53c519c4131","http_method":"GET","http_path":"/api/chat/conversations/user-avg-time?days=7&start_date=2026-08-10","user_id":"48c81229-ef40-407c-a5d2-420a14dd0bb9","user_email":"moraesdiiiiih@gmail.com","duration_ms":23,"sql":"SELECT om.organization_id, om.role FROM organization_members om WHERE om.user_id = $1 LIMIT 1","param_count":1,"param_types":["string"],"error":{"name":"Error","message":"connect ECONNREFUSED 127.0.0.1:5432","stack":"Error: connect ECONNREFUSED 127.0.0.1:5432\\n    at /app/node_modules\n\nesses erros sao doqe?"}`}
      </pre>
    </div>
  );
};

export default Index;

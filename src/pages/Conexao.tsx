import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, QrCode, RefreshCw, Plug, Unplug, Trash2, Phone, Loader2, Wifi, WifiOff, Send, Settings2, AlertTriangle, CheckCircle, Eye, Activity, Users, Download, Pencil, UserCheck, MessageSquare, Check, History, Smartphone, Globe, Copy, Bot, Upload, Facebook } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, API_URL } from "@/lib/api";
import { toast } from "sonner";
import { TestMessageDialog } from "@/components/conexao/TestMessageDialog";
import { WebhookDiagnosticPanel } from "@/components/conexao/WebhookDiagnosticPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadDistributionDialog } from "@/components/conexao/LeadDistributionDialog";
import { ConnectionAIAgentDialog } from "@/components/conexao/ConnectionAIAgentDialog";
import { MetaApiHelpDialog } from "@/components/conexao/MetaApiHelpDialog";
import { InstagramMessengerHelpDialog } from "@/components/conexao/InstagramMessengerHelpDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useConnections as useConnectionsHook } from "@/hooks/use-connections";

interface Connection {
  id: string;
  name: string;
  provider?: 'evolution' | 'wapi' | 'meta' | 'uazapi';
  instance_name: string;
  instance_id?: string;
  status: string;
  phone_number?: string;
  show_groups?: boolean;
  meta_phone_number_id?: string;
  meta_waba_id?: string;
  meta_webhook_verify_token?: string;
  meta_token?: string;
  out_of_office_message_enabled?: boolean;
  out_of_office_message?: string;
  business_hours?: { day: number; start: string; end: string; enabled: boolean }[];
  created_at: string;
}

interface PlanLimits {
  max_connections: number;
  current_connections: number;
  plan_name: string;
}

interface LiveConnectionStatus {
  status: string;
  phoneNumber?: string;
}

const isUazapiConnection = (connection: Pick<Connection, 'provider'>) =>
  connection.provider === 'uazapi';

const isWapiConnection = (connection: Pick<Connection, 'provider' | 'instance_id'>) =>
  connection.provider === 'wapi' ||
  (!!connection.instance_id && connection.provider !== 'uazapi' && connection.provider !== 'meta');

 const DEFAULT_UAZAPI_WEBHOOK_URL = "https://whats.gleego.com.br/api/uazapi/webhook";
 
const Conexao = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newConnectionName, setNewConnectionName] = useState("");
  const [newConnectionProvider, setNewConnectionProvider] = useState<'wapi' | 'meta' | 'uazapi'>('wapi');
  const [newConnectionInstanceId, setNewConnectionInstanceId] = useState("");
  const [newConnectionWapiToken, setNewConnectionWapiToken] = useState("");
  const [newMetaToken, setNewMetaToken] = useState("");
  const [newMetaPhoneNumberId, setNewMetaPhoneNumberId] = useState("");
  const [newMetaWabaId, setNewMetaWabaId] = useState("");
  const [validatingMeta, setValidatingMeta] = useState(false);
  const [planLimits, setPlanLimits] = useState<PlanLimits | null>(null);
  
  // QR Code state
  const [qrCodeDialog, setQrCodeDialog] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<Connection | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState<'qr' | 'phone'>('qr');
  const [pairingPhone, setPairingPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loadingPairingCode, setLoadingPairingCode] = useState(false);
  
  // Test message state
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testConnection, setTestConnection] = useState<Connection | null>(null);
  
  // Webhook diagnostic state
  const [diagLoading, setDiagLoading] = useState<string | null>(null);
  const [diagResults, setDiagResults] = useState<Record<string, any>>({});

  // W-API webhook config state
  const [configuringWapiWebhooks, setConfiguringWapiWebhooks] = useState<string | null>(null);
  
  // W-API contact sync state
  const [syncingContacts, setSyncingContacts] = useState<string | null>(null);
  const [syncingConversations, setSyncingConversations] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; messagesImported: number; conversationsCreated: number } | null>(null);
  const [syncingProfilePics, setSyncingProfilePics] = useState<string | null>(null);
  const [validatingNumbers, setValidatingNumbers] = useState<string | null>(null);
  const [connectingMeta, setConnectingMeta] = useState<string | null>(null);

  // Webhook viewer state (shows what the backend is actually receiving)
  const [webhookViewerOpen, setWebhookViewerOpen] = useState(false);
  const [webhookViewerConnection, setWebhookViewerConnection] = useState<Connection | null>(null);
  const [webhookEventsLoading, setWebhookEventsLoading] = useState(false);
  const [webhookEventsError, setWebhookEventsError] = useState<string | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
  
  // Diagnostic panel state (full panel view)
  const [diagnosticPanelOpen, setDiagnosticPanelOpen] = useState(false);
  
  // Edit connection state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [editName, setEditName] = useState("");
  const [editInstanceId, setEditInstanceId] = useState("");
  const [editWapiToken, setEditWapiToken] = useState("");
  const [editMetaToken, setEditMetaToken] = useState("");
  const [editMetaPhoneNumberId, setEditMetaPhoneNumberId] = useState("");
  const [editMetaWabaId, setEditMetaWabaId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editOutOfOfficeEnabled, setEditOutOfOfficeEnabled] = useState(false);
  const [editOutOfOfficeMessage, setEditOutOfOfficeMessage] = useState("");
  const [editBusinessHours, setEditBusinessHours] = useState<{ day: number; start: string; end: string; enabled: boolean }[]>([]);
  const [diagnosticConnection, setDiagnosticConnection] = useState<Connection | null>(null);
  
  // Lead distribution state
  const [leadDistributionDialogOpen, setLeadDistributionDialogOpen] = useState(false);
  const [leadDistributionConnection, setLeadDistributionConnection] = useState<Connection | null>(null);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [agentDialogConnection, setAgentDialogConnection] = useState<Connection | null>(null);

  // UAZAPI state
  const [configuringUazapiWebhooks, setConfiguringUazapiWebhooks] = useState<string | null>(null);
  const [syncingUazapiContacts, setSyncingUazapiContacts] = useState<string | null>(null);
  const [resyncingNames, setResyncingNames] = useState<string | null>(null);
  const [uazapiSyncProgress, setUazapiSyncProgress] = useState<{ current: number; total: number; lastContact?: string; status?: string; created?: number; updated?: number } | null>(null);

  // Migration dialog state
  const [migrateDialogOpen, setMigrateDialogOpen] = useState(false);
  const [migrateTargetConnection, setMigrateTargetConnection] = useState<Connection | null>(null);
  const [migrateSourceId, setMigrateSourceId] = useState<string>("");
  const [migrating, setMigrating] = useState(false);

  const { data: filteredConnections = [] } = useConnectionsHook();

  // Import history (Gleego legacy export) state
  const [importingConnectionId, setImportingConnectionId] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<string>("");
  const [importProgress, setImportProgress] = useState<number>(0);
  const [importStats, setImportStats] = useState<{
    convs_created: number;
    convs_merged: number;
    msgs_inserted: number;
    msgs_skipped: number;
    msgs_total: number;
    convs_total: number;
  }>({ convs_created: 0, convs_merged: 0, msgs_inserted: 0, msgs_skipped: 0, msgs_total: 0, convs_total: 0 });
  const [importDone, setImportDone] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const refreshConnectionStatus = useCallback(
    async (
      connection: Pick<Connection, 'id'>,
      options?: { silent?: boolean }
    ): Promise<LiveConnectionStatus | null> => {
      try {
        const result = await api<LiveConnectionStatus>(`/api/evolution/${connection.id}/status`);

        setConnections((prev) =>
          prev.map((current) =>
            current.id === connection.id
              ? { ...current, status: result.status, phone_number: result.phoneNumber }
              : current
          )
        );

        return result;
      } catch (error: any) {
        if (!options?.silent) {
          toast.error(error?.message || 'Erro ao verificar status');
        }
        return null;
      }
    },
    []
  );

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setConnections([]);
      setLoading(false);
      return;
    }

    loadConnections();
    loadPlanLimits();
  }, [authLoading, user?.id, user?.organization_id, filteredConnections]);

  const loadConnections = async () => {
    setLoading(true);
    try {
      // For Admins/Owners, we still want to show all organization-scoped connections
      // but for others we respect the hook's filtered results
      let nextConnections: Connection[] = [];
      
      if (user?.role === 'owner' || user?.role === 'admin') {
        const [orgScopedConnections, assignedConnections, orgDirectConnections] = await Promise.all([
          api<Connection[]>('/api/connections?scope=organization').catch(() => []),
          api<Connection[]>('/api/connections').catch(() => []),
          user?.organization_id
            ? api<Connection[]>(`/api/organizations/${user.organization_id}/connections`).catch(() => [])
            : Promise.resolve([] as Connection[]),
        ]);

        const mergedConnections = new Map<string, Connection>();
        [...orgScopedConnections, ...assignedConnections, ...orgDirectConnections].forEach((conn) => {
          mergedConnections.set(conn.id, conn);
        });
        nextConnections = Array.from(mergedConnections.values());
      } else {
        // Restricted user - use filtered list from hook
        nextConnections = filteredConnections as Connection[];
      }

      setConnections(nextConnections);

      const uazapiConnections = nextConnections.filter(
        (connection) => isUazapiConnection(connection) && connection.status !== 'connected'
      );

      if (uazapiConnections.length > 0) {
        void Promise.allSettled(
          uazapiConnections.map((connection) => refreshConnectionStatus(connection, { silent: true }))
        );
      }
    } catch (error) {
      console.error('Error loading connections:', error);
      toast.error('Erro ao carregar conexões');
    } finally {
      setLoading(false);
    }
  };

  const loadPlanLimits = async () => {
    try {
      const data = await api<PlanLimits>('/api/evolution/limits');
      setPlanLimits(data);
    } catch (error) {
      console.error('Error loading plan limits:', error);
    }
  };

  const resetCreateForm = () => {
    setNewConnectionName('');
    setNewConnectionInstanceId('');
    setNewConnectionWapiToken('');
    setNewConnectionProvider('wapi');
    setNewMetaToken('');
    setNewMetaPhoneNumberId('');
    setNewMetaWabaId('');
  };

  const handleCreateConnection = async () => {
    if (!newConnectionName.trim()) {
      toast.error('Digite um nome para a conexão');
      return;
    }

    if (newConnectionProvider === 'meta') {
      if (!newMetaToken.trim() || !newMetaPhoneNumberId.trim() || !newMetaWabaId.trim()) {
        toast.error('Token, Phone Number ID e WABA ID são obrigatórios');
        return;
      }
    }

    setCreating(true);
    try {
      let result: Connection & { qrCode?: string };

      if (newConnectionProvider === 'meta') {
        result = await api<Connection>('/api/connections', {
          method: 'POST',
          body: {
            provider: 'meta',
            name: newConnectionName,
            meta_token: newMetaToken,
            meta_phone_number_id: newMetaPhoneNumberId,
            meta_waba_id: newMetaWabaId,
          },
        });
        toast.success('Conexão Meta API criada com sucesso!');
       } else if (newConnectionProvider === 'uazapi') {
         result = await api<Connection>('/api/connections', {
           method: 'POST',
           body: {
             provider: 'uazapi',
             name: newConnectionName,
             webhookUrl: DEFAULT_UAZAPI_WEBHOOK_URL,
           },
         });
         toast.success('Conexão UAZAPI criada com Webhook automático!');
         setSelectedConnection(result);
         handleGetQRCode(result);
       } else {
        result = await api<Connection>('/api/connections', {
          method: 'POST',
          body: {
            provider: 'wapi',
            name: newConnectionName,
          },
        });
        toast.success('Conexão criada! Instância W-API gerada automaticamente.');
        setSelectedConnection(result);
        handleGetQRCode(result);
      }

      setConnections(prev => [...prev, result]);
      setShowCreateDialog(false);
      resetCreateForm();
    } catch (error: any) {
      console.error('[Conexao] Create connection error:', error);
      toast.error(error.message || 'Erro ao criar conexão', { duration: 8000 });
    } finally {
      setCreating(false);
    }
  };

  const handleValidateMetaToken = async () => {
    if (!newMetaToken.trim() || !newMetaWabaId.trim()) {
      toast.error('Preencha o Token e WABA ID para validar');
      return;
    }
    setValidatingMeta(true);
    try {
      const result = await api<{ valid: boolean; error?: string; account?: any }>('/api/meta/validate', {
        method: 'POST',
        body: { token: newMetaToken, waba_id: newMetaWabaId },
      });
      if (result.valid) {
        toast.success(`Token válido! Conta: ${result.account?.name || 'OK'}`);
      } else {
        toast.error(result.error || 'Token inválido');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao validar');
    } finally {
      setValidatingMeta(false);
    }
  };

  const handleMetaConnect = async (connection: Connection) => {
    setConnectingMeta(connection.id);
    try {
      const result = await api<Connection & { meta_validation_warning?: string | null; message?: string }>(
        `/api/connections/${connection.id}/meta-connect`,
        { method: 'POST' }
      );
      const { meta_validation_warning, message, ...conn } = result as any;
      setConnections(prev => prev.map(c => c.id === connection.id ? (conn as Connection) : c));
      if (meta_validation_warning) {
        toast.warning(`Token gerado, mas Meta retornou: ${meta_validation_warning}`, { duration: 8000 });
      } else {
        toast.success(message || 'Token de verificação gerado. Configure o webhook na Meta para concluir.');
      }
    } catch (error: any) {
      toast.error(error?.message || error?.response?.error || 'Erro ao gerar token da Meta');
    } finally {
      setConnectingMeta(null);
    }
  };

const handleGetQRCode = async (connection: Connection) => {
  setSelectedConnection(connection);
  setQrCodeDialog(true);
  setLoadingQr(true);
  setQrCode(null);

  try {
    const result = await api<{ qrCode: string }>(`/api/evolution/${connection.id}/qrcode`);
    setQrCode(result.qrCode);
  } catch (error) {
    toast.error('Erro ao buscar QR Code');
  } finally {
    setLoadingQr(false);
  }
};

  const handleRefreshQRCode = async () => {
    if (!selectedConnection) return;
    
    setLoadingQr(true);
    try {
      const result = await api<{ qrCode: string; success?: boolean }>(`/api/evolution/${selectedConnection.id}/restart`, {
        method: 'POST',
      });
      setQrCode(result.qrCode);
      toast.success('QR Code atualizado!');
    } catch (error) {
      toast.error('Erro ao atualizar QR Code');
    } finally {
      setLoadingQr(false);
    }
  };

  const handleGetPairingCode = async () => {
    if (!selectedConnection || !pairingPhone.trim()) {
      toast.error('Informe o número de telefone');
      return;
    }
    setLoadingPairingCode(true);
    setPairingCode(null);
    try {
      const result = await api<{ code: string }>(`/api/evolution/${selectedConnection.id}/pairing-code`, {
        method: 'POST',
        body: { phoneNumber: pairingPhone.trim() },
      });
      setPairingCode(result.code);
      toast.success('Código de pareamento gerado!');
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao gerar código de pareamento');
    } finally {
      setLoadingPairingCode(false);
    }
  };

  const handleCheckStatus = async (connection: Connection) => {
    setCheckingStatus(connection.id);
    try {
      const result = await refreshConnectionStatus(connection);

      if (!result) return;

      if (result.status === 'connected') {
        toast.success(`Conectado: ${result.phoneNumber || 'WhatsApp'}`);
        setQrCodeDialog(false);
        setQrCode(null);
      } else {
        toast.info('Aguardando conexão...');
      }
    } catch (error) {
      toast.error('Erro ao verificar status');
    } finally {
      setCheckingStatus(null);
    }
  };

  const handleSyncUazapiContacts = async (connection: Connection) => {
    if (syncingUazapiContacts) return;
    
    setSyncingUazapiContacts(connection.id);
    setUazapiSyncProgress({ current: 0, total: 0, status: 'Iniciando...' });
    
    const token = localStorage.getItem('auth_token');
    const url = `${API_URL}/api/connections/${connection.id}/sync-uazapi-contacts/stream`;
    
    const eventSource = new EventSource(`${url}?token=${token}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.error) {
          toast.error(data.error);
          eventSource.close();
          setSyncingUazapiContacts(null);
          setUazapiSyncProgress(null);
          return;
        }
        
        if (data.status === 'fetching') {
          setUazapiSyncProgress(prev => ({ ...prev!, status: data.message }));
        } else if (data.status === 'starting') {
          setUazapiSyncProgress({ current: 0, total: data.total, status: 'Importando contatos...', created: 0, updated: 0 });
        } else if (data.status === 'progress') {
          setUazapiSyncProgress({ 
            current: data.current, 
            total: data.total, 
            lastContact: data.lastContact,
            status: `Sincronizando: ${data.lastContact || ''}`,
            created: data.created,
            updated: data.updated
          });
        } else if (data.status === 'completed') {
          toast.success(data.message, {
            description: `${data.created} contatos novos e ${data.updated} atualizados.`
          });
          eventSource.close();
          setSyncingUazapiContacts(null);
          setUazapiSyncProgress(null);
        }
      } catch (err) {
        console.error('Error parsing SSE data:', err);
      }
    };
    
    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      toast.error('Erro na conexão de sincronização');
      eventSource.close();
      setSyncingUazapiContacts(null);
      setUazapiSyncProgress(null);
    };
  };

  const handleResyncUazapiNames = async (connection: Connection) => {
    if (resyncingNames) return;
    setResyncingNames(connection.id);
    try {
      const res: any = await api(`/api/uazapi/${connection.id}/resync-contact-names`, {
        method: 'POST',
        body: { overwrite: true },
      });
      if (res?.success) {
        toast.success(`${res.updated} conversa(s) atualizadas com nome real`, {
          description: `${res.contactsLoaded} contatos da agenda lidos · ${res.skipped} sem alteração`,
        });
      } else {
        toast.error(res?.error || 'Falha ao sincronizar nomes');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao sincronizar nomes');
    } finally {
      setResyncingNames(null);
    }
  };

  const handleLogout = async (connection: Connection) => {
    try {
      await api(`/api/evolution/${connection.id}/logout`, { method: 'POST' });
      
      setConnections(prev => prev.map(c => 
        c.id === connection.id 
          ? { ...c, status: 'disconnected', phone_number: undefined } 
          : c
      ));
      
      toast.success('Desconectado com sucesso');
    } catch (error) {
      toast.error('Erro ao desconectar');
    }
  };

  const handleDelete = async (connection: Connection) => {
    try {
      const isWapi = isWapiConnection(connection);
      const deleteUrl = isWapi 
        ? `/api/connections/${connection.id}` 
        : `/api/evolution/${connection.id}`;
      await api(deleteUrl, { method: 'DELETE' });
      setConnections(prev => prev.filter(c => c.id !== connection.id));
      toast.success('Conexão excluída');
    } catch (error) {
      toast.error('Erro ao excluir conexão');
    }
  };

  const handleMigrateConversations = async (connection: Connection, sourceId?: string) => {
    setMigrating(true);
    try {
      const url = sourceId 
        ? `/api/connections/${connection.id}/migrate-conversations?from=${sourceId}`
        : `/api/connections/${connection.id}/migrate-conversations`;
      const result = await api<{ migrated: number }>(url, {
        method: 'POST',
        auth: true,
      });
      if (result.migrated > 0) {
        toast.success(`${result.migrated} conversas migradas com sucesso!`);
        setMigrateDialogOpen(false);
      } else {
        toast.info('Nenhuma conversa encontrada para migrar.');
      }
    } catch {
      toast.error('Erro ao migrar conversas');
    } finally {
      setMigrating(false);
    }
  };

  const handleImportHistoryFile = async (connection: Connection, file: File) => {
    setImportingConnectionId(connection.id);
    setImportDialogOpen(true);
    setImportDone(false);
    setImportError(null);
    setImportProgress(0);
    setImportStats({ convs_created: 0, convs_merged: 0, msgs_inserted: 0, msgs_skipped: 0, msgs_total: 0, convs_total: 0 });
    setImportStatus("Lendo arquivo...");
    try {
      const text = await file.text();
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Arquivo inválido: não é um JSON válido.");
      }

      // Normalize to a flexible shape — the backend already accepts many variants,
      // but we split messages into batches on the frontend so we can show progress
      // and avoid huge payloads timing out.
      const root = (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') ? payload.data : payload;
      let conversations: any[] = [];
      if (Array.isArray(root?.conversations)) conversations = root.conversations;
      else if (Array.isArray(root?.chats)) conversations = root.chats;
      else if (Array.isArray(root)) conversations = root;

      // More aggressive message collection
      let allMessages: any[] = [];
      if (Array.isArray(root?.messages)) allMessages = [...root.messages];
      
      // Always check for embedded messages even if top-level messages exist, 
      // to ensure we get everything if the format is mixed
      for (const c of conversations) {
        const embedded = c?.messages || c?.chat_messages || c?.history || c?.msgs;
        if (Array.isArray(embedded)) {
          for (const m of embedded) {
            allMessages.push({
              ...m,
              conversation_id: m.conversation_id || c.id || c.conversation_id || c.remote_jid || c.jid || c.chatId,
              remote_jid: m.remote_jid || c.remote_jid || c.jid || c.chatId || c.chat_id,
            });
          }
        }
      }

      // If we still have no messages, maybe the root itself is just a message array?
      if (allMessages.length === 0 && Array.isArray(root)) {
        const looksLikeMessages = root.some(item => item.content || item.text || item.body || item.message_id);
        if (looksLikeMessages) {
          allMessages = root;
        }
      }

      // Dedup messages by id if possible before sending
      const seenIds = new Set();
      allMessages = allMessages.filter(m => {
        const mid = m.message_id || m.id || m.key?.id;
        if (!mid) return true;
        if (seenIds.has(mid)) return false;
        seenIds.add(mid);
        return true;
      });

      const totalMsgs = allMessages.length;
      const totalConvs = conversations.length;

      if (totalMsgs === 0 && totalConvs === 0) {
        throw new Error("Arquivo não contém conversas nem mensagens reconhecíveis.");
      }

      setImportStats((s) => ({ ...s, msgs_total: totalMsgs, convs_total: totalConvs }));
      setImportStatus(`Enviando ${totalConvs} conversas e ${totalMsgs} mensagens...`);

      // First batch: conversations + first slice of messages.
      // Subsequent batches: only messages (without conversations) — they are matched by remote_jid on the backend.
      const BATCH = 500;
      let cursor = 0;
      const acc = { convs_created: 0, convs_merged: 0, msgs_inserted: 0, msgs_skipped: 0 };
      let batchIndex = 0;

      while (cursor < Math.max(totalMsgs, 1)) {
        const slice = allMessages.slice(cursor, cursor + BATCH);
        const body: any = {
          conversations: batchIndex === 0 ? conversations : [],
          messages: slice,
        };
        setImportStatus(`Enviando lote ${batchIndex + 1} (${cursor + slice.length}/${totalMsgs} mensagens)...`);

        const result = await api<{
          conversations_created: number;
          conversations_merged: number;
          messages_inserted: number;
          messages_skipped: number;
        }>(`/api/connections/${connection.id}/import-history`, {
          method: "POST",
          body,
          auth: true,
        });

        acc.convs_created += result.conversations_created || 0;
        acc.convs_merged += result.conversations_merged || 0;
        acc.msgs_inserted += result.messages_inserted || 0;
        acc.msgs_skipped += result.messages_skipped || 0;

        setImportStats({
          convs_created: acc.convs_created,
          convs_merged: acc.convs_merged,
          msgs_inserted: acc.msgs_inserted,
          msgs_skipped: acc.msgs_skipped,
          msgs_total: totalMsgs,
          convs_total: totalConvs,
        });

        cursor += BATCH;
        batchIndex++;
        const pct = totalMsgs > 0 ? Math.min(100, Math.round((Math.min(cursor, totalMsgs) / totalMsgs) * 100)) : 100;
        setImportProgress(pct);

        if (totalMsgs === 0) break;
      }

      setImportProgress(100);
      setImportStatus("Importação concluída!");
      setImportDone(true);
      toast.success(
        `Importação concluída: ${acc.convs_created} novas, ${acc.convs_merged} mescladas, ${acc.msgs_inserted} mensagens.`
      );
    } catch (error: any) {
      const msg = error?.message || "Erro ao importar histórico";
      setImportError(msg);
      setImportStatus("Falha na importação");
      toast.error(msg);
    } finally {
      setImportingConnectionId(null);
    }
  };

   const handleConfigureUazapiWebhooks = async (connection: Connection) => {
     setConfiguringUazapiWebhooks(connection.id);
     try {
       // First, update the webhook URL in our database
       await api(`/api/connections/${connection.id}`, {
         method: 'PATCH',
         body: { webhookUrl: DEFAULT_UAZAPI_WEBHOOK_URL },
       });
 
        // Try to trigger the external configuration using the correct server-side endpoint
        try {
          await api(`/api/uazapi/${connection.id}/configure-webhook`, {
            method: 'POST',
          });
        } catch (uazErr: any) {
          // Fallback to the other common path if the first one fails with 404
          if (uazErr.status === 404) {
            await api(`/api/connections/${connection.id}/configure-uazapi-webhook`, {
              method: 'POST',
            });
          } else {
            throw uazErr;
          }
        }
 
       toast.success('Webhook UAZAPI configurado e ativado com sucesso!');
     } catch (error: any) {
       console.error('Error configuring UAZAPI webhook:', error);
       toast.error(error.message || 'Erro ao configurar webhook UAZAPI no servidor');
     } finally {
       setConfiguringUazapiWebhooks(null);
     }
   };

  const handleWebhookDiagnostic = async (connection: Connection) => {
    setDiagLoading(connection.id);
    try {
      const result = await api<any>(`/api/evolution/${connection.id}/webhook-diagnostic`);
      setDiagResults(prev => ({ ...prev, [connection.id]: result }));
      
      if (result.healthy) {
        toast.success('Webhook está saudável!');
      } else if (result.errors?.length > 0) {
        toast.warning(`Problemas encontrados: ${result.errors.length}`);
      }
    } catch (error: any) {
      toast.error('Erro ao diagnosticar webhook');
      setDiagResults(prev => ({ ...prev, [connection.id]: { error: error.message } }));
    } finally {
      setDiagLoading(null);
    }
  };

  const handleReconfigureWebhook = async (connection: Connection) => {
    setDiagLoading(connection.id);
    try {
      await api(`/api/evolution/${connection.id}/reconfigure-webhook`, { method: 'POST' });
      toast.success('Webhook reconfigurado!');
      // Re-run diagnostic
      await handleWebhookDiagnostic(connection);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao reconfigurar webhook');
    } finally {
      setDiagLoading(null);
    }
  };

  const handleConfigureWapiWebhooks = async (connection: Connection) => {
    const isWapi = isWapiConnection(connection);

    if (!isWapi) {
      toast.info('Esta ação é apenas para conexões W-API');
      return;
    }

    setConfiguringWapiWebhooks(connection.id);
    try {
      const result = await api<{ success: boolean; message?: string }>(
        `/api/connections/${connection.id}/configure-webhooks`,
        { method: 'POST' }
      );

      if (result.success) {
        toast.success(result.message || 'Webhooks configurados com sucesso');
      } else {
        toast.error(result.message || 'Falha ao configurar webhooks');
      }
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao configurar webhooks');
    } finally {
      setConfiguringWapiWebhooks(null);
    }
  };

  const postWapiWithFallback = useCallback(
    async <T,>(connectionId: string, endpoint: string, body?: Record<string, unknown>) => {
      try {
        return await api<T>(`/api/wapi/${connectionId}${endpoint}`, {
          method: 'POST',
          body,
        });
      } catch (error: any) {
        const message = String(error?.message || '');
        const is404 = message.includes('404');

        if (!is404) throw error;

        const fallbackBody = body ? { connectionId, ...body } : { connectionId };
        return api<T>(`/api/wapi${endpoint}`, {
          method: 'POST',
          body: fallbackBody,
        });
      }
    },
    []
  );

  const ensureConnectionReadyForSync = useCallback(
    async (connection: Connection, actionLabel: string) => {
      if (connection.status === 'connected') return true;

      try {
        const liveStatus = await api<{ status: string; phoneNumber?: string }>(`/api/evolution/${connection.id}/status`);

        setConnections((prev) =>
          prev.map((c) =>
            c.id === connection.id
              ? { ...c, status: liveStatus.status, phone_number: liveStatus.phoneNumber }
              : c
          )
        );

        if (liveStatus.status === 'connected') {
          return true;
        }

        toast.warning(`A conexão precisa estar conectada para ${actionLabel}`);
        return false;
      } catch (error: any) {
        toast.error(error?.message || 'Erro ao verificar status da conexão');
        return false;
      }
    },
    []
  );

  const handleSyncWapiContacts = async (connection: Connection) => {
    const isWapi = isWapiConnection(connection);

    if (!isWapi) {
      toast.info('Esta ação é apenas para conexões W-API');
      return;
    }

    const ready = await ensureConnectionReadyForSync(connection, 'sincronizar contatos');
    if (!ready) return;

    setSyncingContacts(connection.id);
    try {
      const result = await postWapiWithFallback<{ 
        success: boolean; 
        total: number; 
        imported: number; 
        updated: number; 
        skipped: number;
        error?: string;
      }>(connection.id, '/sync-contacts');

      if (result.success) {
        toast.success(
          `Sincronização concluída! ${result.imported} novos, ${result.updated} atualizados, ${result.skipped} ignorados (Total: ${result.total})`
        );
      } else {
        toast.error(result.error || 'Erro ao sincronizar contatos');
      }
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao sincronizar contatos');
    } finally {
      setSyncingContacts(null);
    }
  };

  const handleSyncWapiConversations = async (connection: Connection) => {
    const isWapi = isWapiConnection(connection);

    if (!isWapi) {
      toast.info('Esta ação é apenas para conexões W-API');
      return;
    }

    const ready = await ensureConnectionReadyForSync(connection, 'sincronizar conversas');
    if (!ready) return;

    setSyncingConversations(connection.id);
    setSyncProgress({ current: 0, total: 0, messagesImported: 0, conversationsCreated: 0 });

    try {
      // Step 1: Prepare - get total chat count
      const prepResult = await postWapiWithFallback<{ success: boolean; sync_id: string; total_chats: number; error?: string }>(
        connection.id,
        '/sync-conversations/prepare'
      );

      if (!prepResult.success) {
        toast.error(prepResult.error || 'Erro ao preparar sincronização');
        return;
      }

      const { sync_id, total_chats } = prepResult;
      setSyncProgress({ current: 0, total: total_chats, messagesImported: 0, conversationsCreated: 0 });

      if (total_chats === 0) {
        toast.info('Nenhuma conversa encontrada para sincronizar');
        return;
      }

      // Step 2: Process in batches
      const BATCH_SIZE = 10;
      let offset = 0;
      let totalMessagesImported = 0;
      let totalConversationsCreated = 0;

      while (offset < total_chats) {
        const batchResult = await postWapiWithFallback<{
          success: boolean;
          processed: number;
          total: number;
          done: boolean;
          conversations_created: number;
          messages_imported: number;
          error?: string;
        }>(connection.id, '/sync-conversations/batch', { sync_id, offset, limit: BATCH_SIZE });

        if (!batchResult.success) {
          toast.error(batchResult.error || 'Erro durante sincronização');
          break;
        }

        totalMessagesImported += batchResult.messages_imported;
        totalConversationsCreated += batchResult.conversations_created;

        setSyncProgress({
          current: batchResult.processed,
          total: batchResult.total,
          messagesImported: totalMessagesImported,
          conversationsCreated: totalConversationsCreated,
        });

        if (batchResult.done) break;
        offset += BATCH_SIZE;

        // Small delay to yield to UI
        await new Promise(r => setTimeout(r, 50));
      }

      toast.success(
        `Sincronização concluída! ${totalConversationsCreated} conversas novas, ${totalMessagesImported} mensagens importadas (últimos 2 meses)`
      );
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao sincronizar conversas');
    } finally {
      setSyncingConversations(null);
      setSyncProgress(null);
    }
  };

  const handleSyncProfilePictures = async (connection: Connection) => {
    setSyncingProfilePics(connection.id);
    try {
      const result = await postWapiWithFallback<{ success: boolean; total: number; updated: number; errors: number }>(
        connection.id,
        '/sync-profile-pictures'
      );
      if (result.success) {
        toast.success(`Fotos de perfil: ${result.updated} atualizadas de ${result.total} contatos`);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao sincronizar fotos de perfil');
    } finally {
      setSyncingProfilePics(null);
    }
  };

  const handleValidateAllContacts = async (connection: Connection) => {
    setValidatingNumbers(connection.id);
    try {
      const result = await postWapiWithFallback<{ success: boolean; total: number; valid: number; invalid: number; message?: string }>(
        connection.id,
        '/validate-all-contacts'
      );
      if (result.success) {
        toast.success(result.message || `Validação concluída: ${result.valid} válidos, ${result.invalid} inválidos (de ${result.total})`);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao validar números');
    } finally {
      setValidatingNumbers(null);
    }
  };

  const handleOpenEditDialog = (connection: Connection) => {
    setEditingConnection(connection);
    setEditName(connection.name);
    setEditInstanceId(connection.instance_id || '');
    setEditWapiToken('');
    setEditMetaToken('');
    setEditMetaPhoneNumberId(connection.meta_phone_number_id || '');
    setEditMetaWabaId(connection.meta_waba_id || '');
    setEditOutOfOfficeEnabled(connection.out_of_office_message_enabled || false);
    setEditOutOfOfficeMessage(connection.out_of_office_message || "");
    
    // Initialize business hours for all days
    const days = [1, 2, 3, 4, 5, 6, 0]; // Seg to Dom
    const existingHours = connection.business_hours || [];
    const initialHours = days.map(d => {
      const found = existingHours.find(h => h.day === d);
      return found || { day: d, start: "08:00", end: "18:00", enabled: d !== 0 && d !== 6 };
    });
    setEditBusinessHours(initialHours);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingConnection) return;
    
    if (!editName.trim()) {
      toast.error('Digite um nome para a conexão');
      return;
    }

    const isWapi = editingConnection.provider === 'wapi' || !!editingConnection.instance_id;
    const isMeta = editingConnection.provider === 'meta';
    
    if (isWapi && !editInstanceId.trim()) {
      toast.error('Instance ID é obrigatório');
      return;
    }

    if (isMeta && !editMetaPhoneNumberId.trim()) {
      toast.error('Phone Number ID é obrigatório');
      return;
    }
    if (isMeta && !editMetaWabaId.trim()) {
      toast.error('WABA ID é obrigatório');
      return;
    }

    setSavingEdit(true);
    try {
      const body: any = { 
        name: editName,
        out_of_office_message_enabled: editOutOfOfficeEnabled,
        out_of_office_message: editOutOfOfficeMessage,
        business_hours: editBusinessHours,
      };
      
      if (isWapi) {
        body.instance_id = editInstanceId;
        if (editWapiToken.trim()) {
          body.wapi_token = editWapiToken;
        }
      }

      if (isMeta) {
        body.meta_phone_number_id = editMetaPhoneNumberId;
        body.meta_waba_id = editMetaWabaId;
        if (editMetaToken.trim()) {
          body.meta_token = editMetaToken;
        }
      }

      const result = await api<Connection>(`/api/connections/${editingConnection.id}`, {
        method: 'PATCH',
        body,
      });

      setConnections(prev => prev.map(c => 
        c.id === editingConnection.id 
          ? result 
          : c
      ));

      toast.success('Conexão atualizada!');
      setEditDialogOpen(false);
      setEditingConnection(null);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao atualizar conexão');
    } finally {
      setSavingEdit(false);
    }
  };

  const fetchWebhookEvents = useCallback(async (connection: Connection) => {
    setWebhookEventsLoading(true);
    setWebhookEventsError(null);
    try {
      const endpointBase = connection.provider === 'wapi' || connection.instance_id ? '/api/wapi' : '/api/evolution';
      const result = await api<{ events: any[] }>(`${endpointBase}/${connection.id}/webhook-events?limit=50`);
      setWebhookEvents(result.events || []);
    } catch (error: any) {
      setWebhookEventsError(error.message || 'Erro ao buscar eventos do webhook');
    } finally {
      setWebhookEventsLoading(false);
    }
  }, []);

  const handleOpenWebhookViewer = async (connection: Connection) => {
    setWebhookViewerConnection(connection);
    setWebhookViewerOpen(true);
    await fetchWebhookEvents(connection);
  };

  const handleClearWebhookEvents = async () => {
    if (!webhookViewerConnection) return;
    try {
      const endpointBase = webhookViewerConnection.provider === 'wapi' || webhookViewerConnection.instance_id ? '/api/wapi' : '/api/evolution';
      await api(`${endpointBase}/${webhookViewerConnection.id}/webhook-events`, { method: 'DELETE' });
      setWebhookEvents([]);
      toast.success('Eventos limpos');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao limpar eventos');
    }
  };

  useEffect(() => {
    if (!webhookViewerOpen || !webhookViewerConnection) return;

    const interval = setInterval(() => {
      fetchWebhookEvents(webhookViewerConnection);
    }, 2000);

    return () => clearInterval(interval);
  }, [webhookViewerOpen, webhookViewerConnection, fetchWebhookEvents]);

  // Auto-check status when QR dialog is open
  useEffect(() => {
    if (!qrCodeDialog || !selectedConnection) return;

    const interval = setInterval(async () => {
      try {
        const result = await api<{ status: string; phoneNumber?: string }>(`/api/evolution/${selectedConnection.id}/status`);
        
        if (result.status === 'connected') {
          setConnections(prev => prev.map(c => 
            c.id === selectedConnection.id 
              ? { ...c, status: result.status, phone_number: result.phoneNumber } 
              : c
          ));
          setQrCodeDialog(false);
          setQrCode(null);
          toast.success(`WhatsApp conectado: ${result.phoneNumber || ''}`);
          clearInterval(interval);
        }
      } catch (error) {
        // Ignore errors during polling
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [qrCodeDialog, selectedConnection]);

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-slide-up">
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-foreground">Conexões WhatsApp</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Gerencie suas conexões com o WhatsApp
            </p>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
            <MetaApiHelpDialog />
            <Button 
              variant="outline" 
              size="sm" 
              className="gap-2"
              onClick={() => navigate("/conectar-meta")}
            >
              <Facebook className="h-4 w-4" />
              Central Meta SaaS
            </Button>
            <InstagramMessengerHelpDialog />
            {/* Plan limits badge */}
            {planLimits && (
              <Badge variant="outline" className="text-sm py-1 px-3">
                {connections.length} / {planLimits.max_connections} conexões
                {planLimits.plan_name && (
                  <span className="ml-1 text-muted-foreground">({planLimits.plan_name})</span>
                )}
              </Badge>
            )}

            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button 
                  variant="gradient"
                  disabled={planLimits && connections.length >= planLimits.max_connections}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Nova Conexão
                </Button>
              </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nova Conexão WhatsApp</DialogTitle>
                <DialogDescription>
                  Escolha o tipo de conexão e preencha os dados.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {/* Provider Selection */}
                <div className="space-y-2">
                  <Label>Tipo de Conexão</Label>
                  <Select value={newConnectionProvider} onValueChange={(v: 'wapi' | 'meta' | 'uazapi') => setNewConnectionProvider(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wapi">W-API (WhatsApp não-oficial)</SelectItem>
                      <SelectItem value="uazapi">UAZAPI (WhatsApp não-oficial)</SelectItem>
                      <SelectItem value="meta">Meta Cloud API (Oficial)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Connection Name */}
                <div className="space-y-2">
                  <Label>Nome da Conexão</Label>
                  <Input 
                    placeholder="Ex: WhatsApp Principal"
                    value={newConnectionName}
                    onChange={(e) => setNewConnectionName(e.target.value)}
                  />
                </div>

                {newConnectionProvider === 'wapi' ? (
                  <div className="rounded-lg border border-dashed p-3 bg-muted/30">
                    <p className="text-xs text-muted-foreground">
                      💡 A instância será criada automaticamente usando o token W-API configurado nas <strong>Configurações da Organização</strong>.
                    </p>
                  </div>
                ) : newConnectionProvider === 'uazapi' ? (
                  <div className="rounded-lg border border-dashed p-3 bg-muted/30">
                    <p className="text-xs text-muted-foreground">
                      💡 A instância UAZAPI será criada automaticamente usando a URL e admintoken configurados no <strong>painel Superadmin</strong>. Após criar, escaneie o QR Code para conectar.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Token de Acesso Permanente</Label>
                      <Input 
                        placeholder="EAAxxxxxxx..."
                        value={newMetaToken}
                        onChange={(e) => setNewMetaToken(e.target.value)}
                        type="password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone Number ID</Label>
                      <Input 
                        placeholder="Ex: 123456789012345"
                        value={newMetaPhoneNumberId}
                        onChange={(e) => setNewMetaPhoneNumberId(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>WhatsApp Business Account ID (WABA ID)</Label>
                      <Input 
                        placeholder="Ex: 123456789012345"
                        value={newMetaWabaId}
                        onChange={(e) => setNewMetaWabaId(e.target.value)}
                      />
                    </div>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      onClick={handleValidateMetaToken}
                      disabled={validatingMeta || !newMetaToken || !newMetaWabaId}
                      className="w-full"
                    >
                      {validatingMeta ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                      Validar Credenciais
                    </Button>
                    <div className="rounded-lg border border-dashed p-3 bg-muted/30">
                      <p className="text-xs text-muted-foreground">
                        💡 Obtenha estas credenciais no <strong>Meta Business Suite</strong> → Configurações → API do WhatsApp.
                      </p>
                    </div>
                  </>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowCreateDialog(false); resetCreateForm(); }}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateConnection} disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Criando...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Criar
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Connections Grid */}
        {connections.length === 0 ? (
          <Card className="animate-fade-in">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Phone className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Nenhuma conexão
              </h3>
              <p className="text-muted-foreground text-center max-w-md mb-6">
                Crie sua primeira conexão WhatsApp para começar a enviar mensagens.
              </p>
              <Button variant="gradient" onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Criar Conexão
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {connections.map((connection) => (
              <Card key={connection.id} className="animate-fade-in shadow-card overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{connection.name}</CardTitle>
                    <Badge 
                      variant={connection.status === 'connected' || connection.provider === 'meta' ? 'default' : 'outline'}
                      className={connection.status === 'connected' || connection.provider === 'meta' ? 'bg-green-500' : ''}
                    >
                      {connection.provider === 'meta' ? (
                        <><Wifi className="h-3 w-3 mr-1" /> Meta API</>
                      ) : connection.status === 'connected' ? (
                        <><Wifi className="h-3 w-3 mr-1" /> Conectado</>
                      ) : (
                        <><WifiOff className="h-3 w-3 mr-1" /> Desconectado</>
                      )}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs truncate">
                    {connection.provider === 'meta'
                      ? `WABA: ${connection.meta_waba_id || ''}`
                      : isUazapiConnection(connection)
                        ? (connection.instance_id || 'UAZAPI')
                        : isWapiConnection(connection)
                          ? (connection.instance_id || 'W-API')
                          : (connection.instance_name || '')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Quick Status Info */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate">
                        {connection.phone_number || "Sem telefone"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {connection.provider === 'meta' 
                          ? 'Meta API'
                          : isUazapiConnection(connection)
                            ? 'UAZAPI'
                            : isWapiConnection(connection) ? 'W-API' : 'Evolution'}
                      </Badge>
                      <code className="text-[10px] truncate flex-1">
                        {connection.provider === 'meta'
                          ? connection.meta_phone_number_id
                          : (isWapiConnection(connection) || isUazapiConnection(connection))
                            ? connection.instance_id
                            : connection.instance_name}
                      </code>
                    </div>
                  </div>

                  {/* Groups Toggle - not for Meta */}
                  {connection.provider !== 'meta' && (
                  <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Grupos</p>
                        <p className="text-xs text-muted-foreground">Receber mensagens de grupos</p>
                      </div>
                    </div>
                    <Switch
                      checked={connection.show_groups || false}
                      onCheckedChange={async (checked) => {
                        try {
                          await api(`/api/connections/${connection.id}`, {
                            method: 'PATCH',
                            body: { show_groups: checked }
                          });
                          setConnections(prev => prev.map(c => 
                            c.id === connection.id ? { ...c, show_groups: checked } : c
                          ));
                          toast.success(checked ? 'Grupos habilitados' : 'Grupos desabilitados');
                        } catch (error: any) {
                          toast.error(error.message || 'Erro ao atualizar');
                        }
                      }}
                    />
                  </div>
                  )}

                  {/* Meta Webhook Config */}
                  {connection.provider === 'meta' && (
                    <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">Configuração do Webhook</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Configure estes dados na aba <strong>Configuração</strong> do seu app no Meta Business Suite:
                      </p>
                      <div className="space-y-1.5">
                        <div>
                          <Label className="text-xs text-muted-foreground">URL de callback</Label>
                          <div className="flex items-center gap-1">
                            <code className="text-xs bg-background px-2 py-1 rounded border flex-1 break-all">
                              {`${API_URL}/api/meta/webhook`}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => {
                                navigator.clipboard.writeText(`${API_URL}/api/meta/webhook`);
                                toast.success('URL copiada!');
                              }}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Verificar token</Label>
                          <div className="flex items-center gap-1">
                            <code className="text-xs bg-background px-2 py-1 rounded border flex-1 break-all">
                              {connection.meta_webhook_verify_token || 'Não gerado'}
                            </code>
                            {connection.meta_webhook_verify_token ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={() => {
                                  navigator.clipboard.writeText(connection.meta_webhook_verify_token!);
                                  toast.success('Token copiado!');
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              title={connection.meta_webhook_verify_token ? 'Regenerar token' : 'Gerar token'}
                              disabled={connectingMeta === connection.id}
                              onClick={() => handleMetaConnect(connection)}
                            >
                              {connectingMeta === connection.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {!connection.meta_webhook_verify_token 
                          ? 'Clique no ícone ↻ ao lado para gerar o token, depois configure no Meta Business Suite.'
                          : 'Após configurar, clique em "Verificar e salvar" no Meta Business Suite.'
                        }
                      </p>

                      {/* URLs para configuração do App na Meta */}
                      <div className="pt-3 mt-2 border-t space-y-2">
                        <p className="text-xs font-medium">URLs do App (Meta Business / Facebook Developers)</p>
                        <p className="text-[10px] text-muted-foreground">
                          Use estas URLs ao configurar seu App no Meta para Desenvolvedores (Configurações Básicas, Política de Privacidade, Termos, Exclusão de Dados e Domínios).
                        </p>
                        {[
                          { label: 'Política de Privacidade', value: `${window.location.origin}/politica-privacidade` },
                          { label: 'Termos de Serviço', value: `${window.location.origin}/termos-servico` },
                          { label: 'Exclusão de Dados do Usuário', value: `${window.location.origin}/exclusao-dados` },
                          { label: 'Domínio do App', value: window.location.hostname },
                          { label: 'URL do Site', value: window.location.origin },
                        ].map((item) => (
                          <div key={item.label}>
                            <Label className="text-xs text-muted-foreground">{item.label}</Label>
                            <div className="flex items-center gap-1">
                              <code className="text-xs bg-background px-2 py-1 rounded border flex-1 break-all">
                                {item.value}
                              </code>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={() => {
                                  navigator.clipboard.writeText(item.value);
                                  toast.success(`${item.label} copiado!`);
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lead Distribution Button */}
                  <div 
                    className="flex items-center justify-between rounded-lg border p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      setLeadDistributionConnection(connection);
                      setLeadDistributionDialogOpen(true);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Distribuição de Leads</p>
                        <p className="text-xs text-muted-foreground">Distribuir leads automaticamente</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      Configurar
                    </Badge>
                  </div>

                  {/* AI Agent always-on selector */}
                  <div
                    className="flex items-center justify-between rounded-lg border p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      setAgentDialogConnection(connection);
                      setAgentDialogOpen(true);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-sm font-medium">Agente IA Sempre Ativo</p>
                        <p className="text-xs text-muted-foreground">Atendimento automático com contexto do chat</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      Escolher agente
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {connection.status === 'connected' ? (
                      <>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="flex-1"
                          onClick={() => {
                            setTestConnection(connection);
                            setTestDialogOpen(true);
                          }}
                        >
                          <Send className="h-4 w-4 mr-1" />
                          Testar
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleCheckStatus(connection)}
                          disabled={checkingStatus === connection.id}
                        >
                          {checkingStatus === connection.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={() => handleLogout(connection)}
                        >
                          <Unplug className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        {connection.provider === 'meta' ? (
                          <Button 
                            variant="default" 
                            size="sm"
                            className="flex-1"
                            disabled={connectingMeta === connection.id}
                            onClick={() => handleMetaConnect(connection)}
                          >
                            {connectingMeta === connection.id ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Globe className="h-4 w-4 mr-1" />
                            )}
                            Conectar Meta
                          </Button>
                        ) : (
                          <Button 
                            variant="default" 
                            size="sm"
                            className="flex-1"
                            onClick={() => handleGetQRCode(connection)}
                          >
                            <QrCode className="h-4 w-4 mr-1" />
                            Conectar
                          </Button>
                        )}
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleCheckStatus(connection)}
                          disabled={checkingStatus === connection.id}
                          title="Verificar status"
                        >
                          {checkingStatus === connection.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      </>
                    )}

                    {/* Full Diagnostic Panel */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDiagnosticConnection(connection);
                        setDiagnosticPanelOpen(true);
                      }}
                      title="Painel de diagnóstico completo"
                    >
                      <Activity className="h-4 w-4" />
                    </Button>

                    {/* W-API: Configure webhooks */}
                    {isWapiConnection(connection) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConfigureWapiWebhooks(connection)}
                        disabled={configuringWapiWebhooks === connection.id}
                        title="Configurar webhooks (W-API)"
                      >
                        {configuringWapiWebhooks === connection.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Settings2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    
                    {/* UAZAPI: Actions */}
                    {isUazapiConnection(connection) && (
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleConfigureUazapiWebhooks(connection)}
                          disabled={configuringUazapiWebhooks === connection.id}
                          title="Configurar webhook (UAZAPI)"
                        >
                          {configuringUazapiWebhooks === connection.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Settings2 className="h-4 w-4" />
                          )}
                        </Button>
                        {connection.status === 'connected' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSyncUazapiContacts(connection)}
                            disabled={syncingUazapiContacts === connection.id}
                            title="Sincronizar contatos do celular (UAZAPI)"
                          >
                            {syncingUazapiContacts === connection.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        {connection.status === 'connected' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResyncUazapiNames(connection)}
                            disabled={resyncingNames === connection.id}
                            title="Corrigir nomes das conversas usando a agenda do WhatsApp"
                          >
                            {resyncingNames === connection.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserCheck className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    )}

                    {/* UAZAPI Sync progress bar */}
                    {syncingUazapiContacts === connection.id && uazapiSyncProgress && (
                      <div className="w-full mt-2 space-y-1.5 col-span-full animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {uazapiSyncProgress.status}
                          </span>
                          {uazapiSyncProgress.total > 0 && (
                            <span className="font-medium">
                              {uazapiSyncProgress.current}/{uazapiSyncProgress.total} contatos
                            </span>
                          )}
                        </div>
                        {uazapiSyncProgress.total > 0 && (
                          <>
                            <Progress value={(uazapiSyncProgress.current / uazapiSyncProgress.total) * 100} className="h-2" />
                            <div className="flex gap-3 text-[10px] text-muted-foreground mt-1">
                              {uazapiSyncProgress.created !== undefined && <span>{uazapiSyncProgress.created} novos</span>}
                              {uazapiSyncProgress.updated !== undefined && <span>{uazapiSyncProgress.updated} atualizados</span>}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {isWapiConnection(connection) && connection.status === 'connected' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSyncWapiContacts(connection)}
                        disabled={syncingContacts === connection.id}
                        title="Sincronizar contatos do WhatsApp"
                      >
                        {syncingContacts === connection.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </Button>
                    )}

                    {/* W-API: Sync conversations */}
                    {isWapiConnection(connection) && connection.status === 'connected' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSyncWapiConversations(connection)}
                        disabled={syncingConversations === connection.id}
                        title="Sincronizar conversas (últimos 2 meses)"
                      >
                        {syncingConversations === connection.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MessageSquare className="h-4 w-4" />
                        )}
                      </Button>
                    )}

                    {/* Sync conversations progress bar */}
                    {syncingConversations === connection.id && syncProgress && (
                      <div className="w-full mt-2 space-y-1.5 col-span-full">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Sincronizando conversas...
                          </span>
                          <span className="font-medium">
                            {syncProgress.current}/{syncProgress.total} chats
                          </span>
                        </div>
                        <Progress value={syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0} className="h-2" />
                        <div className="flex gap-3 text-xs text-muted-foreground">
                          <span>{syncProgress.conversationsCreated} conversas novas</span>
                          <span>{syncProgress.messagesImported} mensagens</span>
                        </div>
                      </div>
                    )}

                    {/* W-API: Sync profile pictures */}
                    {isWapiConnection(connection) && connection.status === 'connected' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSyncProfilePictures(connection)}
                        disabled={syncingProfilePics === connection.id}
                        title="Sincronizar fotos de perfil"
                      >
                        {syncingProfilePics === connection.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <UserCheck className="h-4 w-4" />
                        )}
                      </Button>
                    )}

                    {/* W-API: Validate all contacts */}
                    {isWapiConnection(connection) && connection.status === 'connected' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleValidateAllContacts(connection)}
                        disabled={validatingNumbers === connection.id}
                        title="Validar números WhatsApp em lote"
                      >
                        {validatingNumbers === connection.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Phone className="h-4 w-4" />
                        )}
                      </Button>
                    )}

                    {!isWapiConnection(connection) && !isUazapiConnection(connection) && connection.provider !== 'meta' && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleWebhookDiagnostic(connection)}
                            disabled={diagLoading === connection.id}
                          >
                            {diagLoading === connection.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : diagResults[connection.id]?.healthy ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : diagResults[connection.id]?.errors?.length > 0 ? (
                              <AlertTriangle className="h-4 w-4 text-yellow-500" />
                            ) : (
                              <Settings2 className="h-4 w-4" />
                            )}
                          </Button>
                        </PopoverTrigger>
                        {diagResults[connection.id] && (
                          <PopoverContent className="w-80">
                            <div className="space-y-2">
                              <h4 className="font-semibold">Diagnóstico Webhook</h4>
                              <div className="text-xs space-y-1">
                                <p>Status: {diagResults[connection.id].instanceStatus?.state || 'unknown'}</p>
                                <p>URL: {diagResults[connection.id].evolutionWebhook?.url || 'Não configurado'}</p>
                                {diagResults[connection.id].errors?.map((err: string, i: number) => (
                                  <p key={i} className="text-destructive">⚠️ {err}</p>
                                ))}
                              </div>
                              {!diagResults[connection.id].healthy && (
                                <Button size="sm" onClick={() => handleReconfigureWebhook(connection)} className="w-full mt-2">
                                  Reconfigurar Webhook
                                </Button>
                              )}
                            </div>
                          </PopoverContent>
                        )}
                      </Popover>
                    )}
                    
                    {/* Edit button - all connections can edit name */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEditDialog(connection)}
                      title="Editar conexão"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    
                    {/* Migrate conversations from another connection */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMigrateTargetConnection(connection);
                        setMigrateSourceId("");
                        setMigrateDialogOpen(true);
                      }}
                      title="Migrar conversas de outra conexão"
                    >
                      <History className="h-4 w-4 text-primary" />
                    </Button>

                    {/* Import history from a previous Gleego export (.json) */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'application/json,.json';
                        input.onchange = (e: any) => {
                          const file = e.target.files?.[0];
                          if (file) handleImportHistoryFile(connection, file);
                        };
                        input.click();
                      }}
                      disabled={importingConnectionId === connection.id}
                      title="Importar histórico de chat de uma versão anterior (Gleego)"
                    >
                      {importingConnectionId === connection.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <Upload className="h-4 w-4 text-primary" />
                      )}
                    </Button>

                    {/* Delete button - always visible */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir conexão?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação não pode ser desfeita. A conexão "{connection.name}" será permanentemente excluída.
                            {connection.status === 'connected' && (
                              <span className="block mt-2 text-yellow-500">
                                ⚠️ Esta conexão está ativa e será desconectada.
                              </span>
                            )}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(connection)}>
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Webhook Viewer Dialog */}
        <Dialog
          open={webhookViewerOpen}
          onOpenChange={(open) => {
            setWebhookViewerOpen(open);
            if (!open) {
              setWebhookViewerConnection(null);
              setWebhookEvents([]);
              setWebhookEventsError(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Monitor do Webhook</DialogTitle>
              <DialogDescription>
                Aqui você vê os últimos eventos que o backend recebeu da Evolution para esta instância.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                {webhookViewerConnection ? (
                  <span>
                    Instância: <span className="text-foreground">{webhookViewerConnection.instance_name}</span>
                  </span>
                ) : (
                  'Selecione uma conexão.'
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => webhookViewerConnection && fetchWebhookEvents(webhookViewerConnection)}
                  disabled={!webhookViewerConnection || webhookEventsLoading}
                >
                  {webhookEventsLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Atualizando...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Atualizar
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleClearWebhookEvents}
                  disabled={!webhookViewerConnection}
                >
                  Limpar
                </Button>
              </div>
            </div>

            {webhookEventsError && (
              <div className="text-sm text-destructive">{webhookEventsError}</div>
            )}

            <ScrollArea className="h-[420px] rounded-md border border-border">
              <div className="p-3 space-y-3">
                {webhookEvents.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Nenhum evento recebido ainda.
                  </div>
                ) : (
                  webhookEvents.map((ev, idx) => (
                    <div key={idx} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-foreground">
                          {ev.normalizedEvent || ev.event || 'evento'}
                        </div>
                        <div className="text-xs text-muted-foreground">{ev.at}</div>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        <div>Headers: {ev.headers ? Object.keys(ev.headers).filter(Boolean).join(', ') : '-'}</div>
                      </div>
                      {ev.preview && (
                        <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-foreground/90">
                          {ev.preview}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* QR Code / Phone Code Dialog */}
        <Dialog open={qrCodeDialog} onOpenChange={(open) => {
          setQrCodeDialog(open);
          if (!open) {
            setConnectMode('qr');
            setPairingCode(null);
            setPairingPhone('');
          }
        }}>
          <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-primary" />
                Conectar WhatsApp
              </DialogTitle>
              <DialogDescription>
                Escolha como deseja conectar seu WhatsApp.
              </DialogDescription>
            </DialogHeader>

            {/* Mode Toggle */}
            {selectedConnection && (selectedConnection.provider === 'wapi' || !!selectedConnection.instance_id) && (
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                    connectMode === 'qr' 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => setConnectMode('qr')}
                >
                  <QrCode className="h-4 w-4" />
                  QR Code
                </button>
                <button
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                    connectMode === 'phone' 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => setConnectMode('phone')}
                >
                  <Smartphone className="h-4 w-4" />
                  Código por Telefone
                </button>
              </div>
            )}
            
            {connectMode === 'qr' ? (
              <div className="flex flex-col items-center justify-center py-6">
                {loadingQr ? (
                  <div className="flex h-64 w-64 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/50">
                    <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  </div>
                ) : qrCode ? (
                  <div className="rounded-xl border-2 border-primary/20 bg-white p-4">
                    <img
                      src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                      alt="QR Code WhatsApp"
                      className="h-64 w-64"
                    />
                  </div>
                ) : (
                  <div className="flex h-64 w-64 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/50">
                    <div className="text-center">
                      <QrCode className="mx-auto h-16 w-16 text-muted-foreground/50" />
                      <p className="mt-4 text-sm text-muted-foreground">
                        Clique em atualizar para gerar o QR Code
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    onClick={handleRefreshQRCode}
                    disabled={loadingQr}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${loadingQr ? 'animate-spin' : ''}`} />
                    Atualizar
                  </Button>
                  {selectedConnection && (
                    <Button
                      variant="default"
                      onClick={() => handleCheckStatus(selectedConnection)}
                      disabled={checkingStatus === selectedConnection.id}
                    >
                      {checkingStatus === selectedConnection.id ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Plug className="h-4 w-4 mr-2" />
                      )}
                      Verificar
                    </Button>
                  )}
                </div>

                <p className="text-xs text-muted-foreground mt-4 text-center">
                  O status será verificado automaticamente a cada 5 segundos
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 space-y-4">
                <div className="w-full space-y-2">
                  <Label>Número do Telefone</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="5511999999999"
                      value={pairingPhone}
                      onChange={(e) => setPairingPhone(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      onClick={handleGetPairingCode}
                      disabled={loadingPairingCode || !pairingPhone.trim()}
                    >
                      {loadingPairingCode ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Gerar Código'
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Informe o número com código do país (ex: 5511999999999)
                  </p>
                </div>

                {pairingCode && (
                  <div className="w-full rounded-xl border-2 border-primary/20 bg-muted/30 p-6 text-center space-y-3">
                    <p className="text-sm text-muted-foreground">Seu código de pareamento:</p>
                    <p className="text-3xl font-bold tracking-widest text-foreground font-mono">
                      {pairingCode}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      No WhatsApp, vá em <strong>Dispositivos Conectados</strong> → <strong>Conectar Dispositivo</strong> → <strong>Conectar com número de telefone</strong> e insira este código.
                    </p>
                  </div>
                )}

                {!pairingCode && !loadingPairingCode && (
                  <div className="rounded-xl border-2 border-dashed border-border bg-muted/50 p-8 text-center">
                    <Smartphone className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Conecte sem câmera! Gere um código numérico e insira diretamente no WhatsApp.
                    </p>
                  </div>
                )}

                {selectedConnection && (
                  <Button
                    variant="default"
                    onClick={() => handleCheckStatus(selectedConnection)}
                    disabled={checkingStatus === selectedConnection.id}
                    className="w-full"
                  >
                    {checkingStatus === selectedConnection.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plug className="h-4 w-4 mr-2" />
                    )}
                    Verificar Conexão
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
        {/* Test Message Dialog */}
        <TestMessageDialog
          connection={testConnection}
          open={testDialogOpen}
          onClose={() => {
            setTestDialogOpen(false);
            setTestConnection(null);
          }}
        />
        
        {/* Diagnostic Panel Dialog */}
        <Dialog 
          open={diagnosticPanelOpen} 
          onOpenChange={(open) => {
            setDiagnosticPanelOpen(open);
            if (!open) setDiagnosticConnection(null);
          }}
        >
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Diagnóstico do Webhook</DialogTitle>
            </DialogHeader>
            {diagnosticConnection && (
              <WebhookDiagnosticPanel 
                connection={diagnosticConnection} 
                onClose={() => setDiagnosticPanelOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Connection Dialog */}
        <Dialog 
          open={editDialogOpen} 
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) {
              setEditingConnection(null);
              setEditName('');
              setEditInstanceId('');
              setEditWapiToken('');
              setEditMetaToken('');
              setEditMetaPhoneNumberId('');
              setEditMetaWabaId('');
            }
          }}
        >
          <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0">
            <DialogHeader className="p-6 pb-2">
              <DialogTitle>Editar Conexão</DialogTitle>
              <DialogDescription>
                Configure os detalhes técnicos e automações da sua conexão.
              </DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="geral" className="flex-1 flex flex-col overflow-hidden">
              <div className="px-6 border-b">
                <TabsList className="w-full justify-start h-auto p-0 bg-transparent gap-6">
                  <TabsTrigger 
                    value="geral" 
                    className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2 text-sm font-medium"
                  >
                    Geral
                  </TabsTrigger>
                  <TabsTrigger 
                    value="automacoes" 
                    className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-2 text-sm font-medium"
                  >
                    Mensagens Automáticas
                  </TabsTrigger>
                </TabsList>
              </div>

              <ScrollArea className="flex-1 overflow-y-auto">
                <div className="p-6">
                  <TabsContent value="geral" className="mt-0 space-y-4">
                    <div className="space-y-2">
                      <Label>Nome Amigável</Label>
                      <Input 
                        placeholder="Ex: WhatsApp Principal, Vendas, Suporte..."
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Este nome será exibido no chat e em toda a plataforma
                      </p>
                    </div>
                    
                    {/* W-API and UAZAPI specific fields */}
                    {editingConnection && (editingConnection.provider === 'wapi' || isUazapiConnection(editingConnection) || !!editingConnection.instance_id) && (
                      <div className="space-y-4">
                        {!isUazapiConnection(editingConnection) && (
                          <div className="space-y-2">
                            <Label>Instance ID</Label>
                            <Input 
                              placeholder="Seu Instance ID"
                              value={editInstanceId}
                              onChange={(e) => setEditInstanceId(e.target.value)}
                            />
                          </div>
                        )}
                        
                        {isUazapiConnection(editingConnection) && (
                          <div className="space-y-4 rounded-lg border border-primary/20 p-4 bg-primary/5">
                            <div className="flex items-center gap-2 mb-1">
                              <Settings2 className="h-4 w-4 text-primary" />
                              <h4 className="font-semibold text-sm">Configuração de Webhook UAZAPI</h4>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">URL do Webhook</Label>
                              <div className="flex items-center gap-2">
                                <code className="text-[10px] bg-background px-2 py-1 rounded border flex-1 break-all">
                                  {DEFAULT_UAZAPI_WEBHOOK_URL}
                                </code>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    navigator.clipboard.writeText(DEFAULT_UAZAPI_WEBHOOK_URL);
                                    toast.success('URL copiada!');
                                  }}
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            <Button 
                              className="w-full mt-2" 
                              variant="default"
                              size="sm"
                              onClick={() => handleConfigureUazapiWebhooks(editingConnection)}
                              disabled={configuringUazapiWebhooks === editingConnection.id}
                            >
                              {configuringUazapiWebhooks === editingConnection.id ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-2" />
                              )}
                              Ativar Webhook Automaticamente
                            </Button>
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label>Token (deixe em branco para manter o atual)</Label>
                          <Input 
                            type="password"
                            placeholder="Novo token (opcional)"
                            value={editWapiToken}
                            onChange={(e) => setEditWapiToken(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Por segurança, o token atual não é exibido.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Meta API specific fields */}
                    {editingConnection?.provider === 'meta' && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>WABA ID</Label>
                          <Input 
                            placeholder="WhatsApp Business Account ID"
                            value={editMetaWabaId}
                            onChange={(e) => setEditMetaWabaId(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Phone Number ID</Label>
                          <Input 
                            placeholder="ID do número de telefone"
                            value={editMetaPhoneNumberId}
                            onChange={(e) => setEditMetaPhoneNumberId(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Token de Acesso Permanente</Label>
                          {editingConnection.meta_token && !editMetaToken && (
                            <div className="flex items-center gap-2 p-2 rounded bg-muted text-xs font-mono">
                              <span>{'•'.repeat(20)}{editingConnection.meta_token.slice(-6)}</span>
                              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setEditMetaToken(editingConnection.meta_token || '')}>
                                Alterar
                              </Button>
                            </div>
                          )}
                          {(!editingConnection.meta_token || editMetaToken !== '') && (
                            <Input 
                              type="password"
                              placeholder={editingConnection.meta_token ? "Novo token" : "EAAxxxxxxx..."}
                              value={editMetaToken}
                              onChange={(e) => setEditMetaToken(e.target.value)}
                            />
                          )}
                        </div>
                        {editingConnection.meta_webhook_verify_token && (
                          <div className="space-y-2">
                            <Label>Webhook Verify Token</Label>
                            <div className="flex gap-2">
                              <Input 
                                readOnly
                                value={editingConnection.meta_webhook_verify_token}
                                className="font-mono text-xs"
                              />
                              <Button 
                                variant="outline" 
                                size="icon"
                                onClick={() => {
                                  navigator.clipboard.writeText(editingConnection.meta_webhook_verify_token!);
                                  toast.success('Verify Token copiado!');
                                }}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="automacoes" className="mt-0 space-y-6">
                    <div className="space-y-4">
                      <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-sm font-semibold">Mensagem Fora de Horário</Label>
                            <p className="text-xs text-muted-foreground">Enviada fora do horário de trabalho definido</p>
                          </div>
                          <Switch 
                            checked={editOutOfOfficeEnabled} 
                            onCheckedChange={setEditOutOfOfficeEnabled} 
                          />
                        </div>
                        {editOutOfOfficeEnabled && (
                          <Textarea 
                            placeholder="Olá! Nosso horário de atendimento é de segunda a sexta, das 08h às 18h."
                            value={editOutOfOfficeMessage}
                            onChange={(e) => setEditOutOfOfficeMessage(e.target.value)}
                            className="text-xs min-h-[80px]"
                          />
                        )}
                      </div>

                      <div className="space-y-4 p-4 border rounded-lg bg-muted/10">
                        <h5 className="text-sm font-semibold flex items-center gap-2">
                          <History className="h-4 w-4 text-primary" />
                          Horário de Trabalho
                        </h5>
                      <div className="space-y-4">
                        {[
                          { id: 1, label: 'Segunda-feira' },
                          { id: 2, label: 'Terça-feira' },
                          { id: 3, label: 'Quarta-feira' },
                          { id: 4, label: 'Quinta-feira' },
                          { id: 5, label: 'Sexta-feira' },
                          { id: 6, label: 'Sábado' },
                          { id: 0, label: 'Domingo' }
                        ].map((day) => {
                          const hours = editBusinessHours.find(h => h.day === day.id) || { day: day.id, start: "08:00", end: "18:00", enabled: false };
                          return (
                            <div key={day.id} className="p-3 border rounded-lg bg-muted/5 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Checkbox 
                                    id={`day-${day.id}`} 
                                    checked={hours.enabled}
                                    onCheckedChange={(checked) => {
                                      setEditBusinessHours(prev => prev.map(h => h.day === day.id ? { ...h, enabled: !!checked } : h));
                                    }}
                                  />
                                  <Label htmlFor={`day-${day.id}`} className="text-sm font-medium cursor-pointer">{day.label}</Label>
                                </div>
                                {!hours.enabled && <Badge variant="secondary" className="text-[10px]">Fechado</Badge>}
                              </div>
                              
                              {hours.enabled && (
                                <div className="grid grid-cols-2 gap-4 pl-6">
                                  <div className="space-y-1">
                                    <Label className="text-[10px]">Início</Label>
                                    <Input 
                                      type="time" 
                                      value={hours.start}
                                      onChange={(e) => {
                                        setEditBusinessHours(prev => prev.map(h => h.day === day.id ? { ...h, start: e.target.value } : h));
                                      }}
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[10px]">Fim</Label>
                                    <Input 
                                      type="time" 
                                      value={hours.end}
                                      onChange={(e) => {
                                        setEditBusinessHours(prev => prev.map(h => h.day === day.id ? { ...h, end: e.target.value } : h));
                                      }}
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Lead Distribution Dialog */}
        <LeadDistributionDialog
          open={leadDistributionDialogOpen}
          onOpenChange={setLeadDistributionDialogOpen}
          connection={leadDistributionConnection}
        />

        {/* AI Agent Always-On Dialog */}
        {agentDialogConnection && (
          <ConnectionAIAgentDialog
            open={agentDialogOpen}
            onClose={() => { setAgentDialogOpen(false); setAgentDialogConnection(null); }}
            connectionId={agentDialogConnection.id}
            connectionName={agentDialogConnection.name}
          />
        )}

        {/* Migrate Conversations Dialog */}
        <Dialog open={migrateDialogOpen} onOpenChange={setMigrateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Migrar Conversas</DialogTitle>
              <DialogDescription>
                Transfira todas as conversas de outra conexão (ou conversas órfãs) para <strong>{migrateTargetConnection?.name}</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Origem das conversas</Label>
                <Select value={migrateSourceId} onValueChange={setMigrateSourceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a origem..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="orphaned">🔄 Conversas órfãs (conexão excluída)</SelectItem>
                    {connections
                      .filter(c => c.id !== migrateTargetConnection?.id)
                      .map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} {c.phone_number ? `(${c.phone_number})` : ''} {c.status === 'connected' ? '🟢' : '🔴'}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-sm text-muted-foreground">
                ⚠️ Todas as conversas da origem selecionada serão movidas para esta conexão. O histórico de mensagens será preservado.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMigrateDialogOpen(false)}>
                Cancelar
              </Button>
              <Button 
                onClick={() => {
                  if (migrateTargetConnection) {
                    handleMigrateConversations(
                      migrateTargetConnection, 
                      migrateSourceId === 'orphaned' ? undefined : migrateSourceId
                    );
                  }
                }}
                disabled={!migrateSourceId || migrating}
              >
                {migrating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Migrando...
                  </>
                ) : (
                  'Migrar Conversas'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Import History Progress Dialog */}
        <Dialog
          open={importDialogOpen}
          onOpenChange={(open) => {
            // Prevent closing while importing
            if (!open && importingConnectionId) return;
            setImportDialogOpen(open);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Importar Histórico</DialogTitle>
              <DialogDescription>
                {importError
                  ? "A importação falhou."
                  : importDone
                    ? "Histórico importado com sucesso para esta conexão."
                    : "Aguarde enquanto enviamos os dados para o servidor."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{importStatus}</span>
                  <span className="font-medium">{importProgress}%</span>
                </div>
                <Progress value={importProgress} className="h-2" />
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Conversas</div>
                  <div className="font-semibold">
                    {importStats.convs_created + importStats.convs_merged} / {importStats.convs_total}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {importStats.convs_created} novas · {importStats.convs_merged} mescladas
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Mensagens</div>
                  <div className="font-semibold">
                    {importStats.msgs_inserted} / {importStats.msgs_total}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {importStats.msgs_skipped} ignoradas (duplicadas)
                  </div>
                </div>
              </div>

              {importError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {importError}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setImportDialogOpen(false)}
                disabled={!!importingConnectionId}
              >
                {importDone || importError ? "Fechar" : "Aguarde..."}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
};

export default Conexao;

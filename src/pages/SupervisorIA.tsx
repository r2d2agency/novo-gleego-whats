import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { 
  Shield, 
  Users, 
  TrendingUp, 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  RefreshCw,
  Search,
  Filter,
  Settings as SettingsIcon,
  ChevronRight,
  UserCheck,
  MessageSquare,
  DollarSign,
  Save,
  Eye,
  History,
  Lock,
  Sparkles,
  Link2,
  User,
  Trash2,
  Briefcase,
  Plus,
  Monitor,
  Play,
  Tag,
  Target
} from "lucide-react";

import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line
} from "recharts";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_URL, getAuthToken, api } from "@/lib/api";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useChat } from "@/hooks/use-chat";

export default function SupervisorIA() {
  const { user, isLoading: isLoadingUser, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [period, setPeriod] = useState("30d");
  const [selectedFunnel, setSelectedFunnel] = useState<string>("all");
  const queryClient = useQueryClient();
  const { getTags } = useChat();

  const { data: conversationTags } = useQuery({
    queryKey: ['chat-tags'],
    queryFn: getTags
  });

  // Dialog states for member management
  const [editMemberDialogOpen, setEditMemberDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [editMemberRole, setEditMemberRole] = useState<string>('agent');
  const [editMemberConnectionIds, setEditMemberConnectionIds] = useState<string[]>([]);
  
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [newMember, setNewMember] = useState({
    name: '',
    email: '',
    password: '',
    role: 'agent',
    connection_ids: [] as string[],
    monitored_funnels: [] as string[]
  });

  // Fetch Funnels for filters
  const { data: funnels } = useQuery({
    queryKey: ['supervisor-funnels'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/crm/funnels?all=true`, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
      });
      return res.json();
    }
  });

  // Check module permission
  const isEnabled = user?.modules_enabled?.supervisor === true || user?.is_superadmin;
  
  // Fetch Stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['supervisor-stats', period, selectedFunnel],
    queryFn: async () => {
      const funnelParam = selectedFunnel !== 'all' ? `&funnelId=${selectedFunnel}` : '';
      const res = await fetch(`${API_URL}/api/supervisor/stats?period=${period}${funnelParam}`, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
      });
      return res.json();
    }
  });

  // Fetch Semaphore
  const { data: semaphore, isLoading: semaphoreLoading } = useQuery({
    queryKey: ['supervisor-semaphore'],
    queryFn: async () => {
      const data = await api<any>(`/api/supervisor/semaphore`);
      return data;
    }
  });

  // Fetch Sellers/Members
  const { data: sellers, isLoading: sellersLoading } = useQuery({
    queryKey: ['supervisor-sellers', user?.organization_id],
    queryFn: async () => {
      const data = await api<any[]>(`/api/supervisor/monitored-sellers`);
      return Array.isArray(data) ? data : [];
    },
    enabled: !!user?.organization_id
  });

  // Fetch Settings
  const { data: settings } = useQuery({
    queryKey: ['supervisor-settings'],
    queryFn: async () => {
      return await api<any>(`/api/supervisor/settings`);
    }
  });

  // Fetch Audits
  const { data: audits, isLoading: auditsLoading } = useQuery({
    queryKey: ['supervisor-audits'],
    queryFn: async () => {
      const data = await api<any[]>(`/api/supervisor/audits`);
      return Array.isArray(data) ? data : [];
    }
  });


  // Fetch Teams
  const { data: teams } = useQuery({
    queryKey: ['supervisor-teams'],
    queryFn: async () => {
      const data = await api<any[]>(`/api/supervisor/teams`);
      return Array.isArray(data) ? data : [];
    }
  });


  // Fetch Connections for Sellers
  const { data: orgConnections } = useQuery({
    queryKey: ['supervisor-org-connections', user?.organization_id],
    queryFn: async () => {
      return await api<any[]>(`/api/organizations/${user?.organization_id}/connections`);
    },
    enabled: !!user?.organization_id
  });

  // Fetch Charges History
  const { data: chargesHistory, isLoading: chargesLoading } = useQuery({
    queryKey: ['supervisor-charges'],
    queryFn: async () => {
      const data = await api<any[]>(`/api/supervisor/charges`);
      return Array.isArray(data) ? data : [];
    }
  });

  // Fetch ALL Org Members (for "Adicionar Supervisão" dialog)
  const { data: allOrgMembers } = useQuery({
    queryKey: ['supervisor-all-org-members', user?.organization_id],
    queryFn: async () => {
      return await api<any[]>(`/api/organizations/${user?.organization_id}/members`);
    },
    enabled: !!user?.organization_id
  });


  const [localSettings, setLocalSettings] = useState<any>(null);
  const [chargeNote, setChargeNote] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<any>(null);
  const [editMemberFunnels, setEditMemberFunnels] = useState<string[]>([]);
  const [selectedMemberForNew, setSelectedMemberForNew] = useState<any>(null);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  // Preview Mutation
  const previewMutation = useMutation({
    mutationFn: async (tempSettings: any) => {
      return await api<any>(`/api/supervisor/preview-settings`, {
        method: 'POST',
        body: tempSettings
      });
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (newSettings: any) => {
      return await api<any>(`/api/supervisor/settings`, {
        method: 'POST',
        body: newSettings
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supervisor-settings'] });
      queryClient.invalidateQueries({ queryKey: ['supervisor-semaphore'] });
      toast.success("Configurações de SLA atualizadas com sucesso");
    }
  });


  // Manual audit trigger
  const runAuditMutation = useMutation({
    mutationFn: async () => {
      setIsAuditing(true);
      setAuditProgress(10);
      
      const interval = setInterval(() => {
        setAuditProgress(prev => {
          if (prev >= 90) return prev;
          return prev + 10;
        });
      }, 800);

      try {
        const res = await fetch(`${API_URL}/api/supervisor/run-audit`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${getAuthToken()}` }
        });
        const data = await res.json();
        clearInterval(interval);
        setAuditProgress(100);
        if (!res.ok) throw new Error(data.error || 'Erro ao executar análise');
        return data;
      } catch (err) {
        clearInterval(interval);
        setAuditProgress(0);
        throw err;
      } finally {
        setTimeout(() => {
          setIsAuditing(false);
          setAuditProgress(0);
        }, 1000);
      }
    },
    onSuccess: (data) => {
      toast.success(`Análise concluída: ${data.dealsProcessed || 0} negócios processados, ${data.findings || 0} alertas gerados.`);
      queryClient.invalidateQueries({ queryKey: ['supervisor-stats'] });
      queryClient.invalidateQueries({ queryKey: ['supervisor-semaphore'] });
      queryClient.invalidateQueries({ queryKey: ['supervisor-audits'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Falha ao executar análise');
    }
  });

  // Charge Mutation
  const chargeMutation = useMutation({
    mutationFn: async ({ type, targetId, notes }: any) => {
      const res = await fetch(`${API_URL}/api/supervisor/charge`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}` 
        },
        body: JSON.stringify({ type, targetId, notes })
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supervisor-charges'] });
      queryClient.invalidateQueries({ queryKey: ['supervisor-semaphore'] });
      toast.success("Cobrança registrada e prazos atualizados");
      setChargeNote("");
      setSelectedTarget(null);
    }
  });

  const [auditProgress, setAuditProgress] = useState(0);
  const [isAuditing, setIsAuditing] = useState(false);

  // Member Management Mutations
  const updateMemberMutation = useMutation({
    mutationFn: async ({ memberId, data }: { memberId: string, data: any }) => {
      return await api(`/api/supervisor/monitored-sellers/${memberId}`, {
        method: 'PATCH',
        body: {
          connection_ids: data.connection_ids || [],
          funnel_ids: data.monitored_funnels || data.funnel_ids || [],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supervisor-sellers'] });
      toast.success('Configurações de supervisão atualizadas!');
      setEditMemberDialogOpen(false);
      refreshUser();
    },
    onError: (error: any) => {
      console.error("Erro ao atualizar membro:", error);
      toast.error(error.message || 'Erro ao atualizar membro');
    }
  });

  const createMemberMutation = useMutation({
    mutationFn: async (data: any) => {
      const member = (Array.isArray(allOrgMembers) ? allOrgMembers : []).find((m: any) => m.email === data.email);
      if (!member) throw new Error('Usuário não encontrado na organização');
      const targetUserId = member.user_id || member.id;
      return await api(`/api/supervisor/monitored-sellers`, {
        method: 'POST',
        body: {
          user_id: targetUserId,
          connection_ids: data.connection_ids || [],
          funnel_ids: data.monitored_funnels || [],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supervisor-sellers'] });
      toast.success('Usuário mapeado para supervisão com sucesso!');
      setAddMemberDialogOpen(false);
      setNewMember({ name: '', email: '', password: '', role: 'agent', connection_ids: [], monitored_funnels: [] });
    },
    onError: (error: any) => {
      console.error("Erro ao adicionar supervisão:", error);
      if (error.status === 403) {
        toast.error("Sem permissão para configurar o Supervisor IA.");
      } else if (error.status === 404) {
        toast.error("Endpoint não encontrado.");
      } else {
        toast.error(error.message || 'Erro ao adicionar supervisão');
      }
    }
  });

  const deleteMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      return await api(`/api/supervisor/monitored-sellers/${memberId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supervisor-sellers'] });
      toast.success('Membro removido com sucesso!');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Erro ao remover membro');
    }
  });

  const handleEditMember = (seller: any) => {
    // Enrich with assigned_connections from allOrgMembers (the sellers endpoint
    // doesn't return permission/assignment info, which made the connection
    // filter return empty for non-admin users that actually have connections)
    const orgMember = (Array.isArray(allOrgMembers) ? allOrgMembers : []).find(
      (m: any) => m.user_id === seller.user_id || m.id === seller.user_id || m.email === seller.email
    );
    setEditingMember({
      ...seller,
      role: seller.role || orgMember?.role,
      assigned_connections: orgMember?.assigned_connections || seller.assigned_connections || [],
      assigned_funnels: orgMember?.assigned_funnels || seller.assigned_funnels || [],
    });
    setEditMemberRole(seller.role || 'agent');
    setEditMemberConnectionIds(seller.connection_ids || []);
    setEditMemberFunnels(seller.monitored_funnels || []);
    setEditMemberDialogOpen(true);
  };

  const handleSaveMember = () => {
    if (!editingMember) return;
    updateMemberMutation.mutate({
      memberId: editingMember.user_id || editingMember.id,
      data: {
        role: editMemberRole,
        connection_ids: editMemberConnectionIds,
        monitored_funnels: editMemberFunnels,
      }
    });
  };

  const handlePreview = () => {
    if (localSettings) {
      previewMutation.mutate(localSettings);
    }
  };

  if (!isEnabled && !isLoadingUser) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <Lock className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Módulo não contratado</h2>
          <p className="text-muted-foreground">O Supervisor IA não está ativo para sua organização.</p>
        </div>
      </MainLayout>
    );
  }

  const COLORS = ['#22c55e', '#eab308', '#ef4444'];
  const PIE_DATA = [
    { name: 'Verde', value: semaphore?.GREEN || 0 },
    { name: 'Amarelo', value: semaphore?.YELLOW || 0 },
    { name: 'Vermelho', value: semaphore?.RED || 0 },
  ];

  const PREVIEW_DATA = previewMutation.data ? [
    { name: 'Verde', value: previewMutation.data.GREEN || 0 },
    { name: 'Amarelo', value: previewMutation.data.YELLOW || 0 },
    { name: 'Vermelho', value: previewMutation.data.RED || 0 },
  ] : null;

  return (
    <MainLayout>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Shield className="h-8 w-8 text-primary" />
              Supervisor IA
            </h1>
            <p className="text-muted-foreground">Monitoramento inteligente da operação comercial</p>
          </div>
          
          <div className="flex items-center gap-2">
            <Select value={selectedFunnel} onValueChange={setSelectedFunnel}>
              <SelectTrigger className="w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filtrar por Funil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Funis</SelectItem>
                {(funnels || []).map((f: any) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-[150px]">
                <Clock className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="15d">Últimos 15 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias</SelectItem>
              </SelectContent>
            </Select>

            <Dialog onOpenChange={(open) => { if (open) setLocalSettings(settings); }}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <SettingsIcon className="h-4 w-4" />
                  Regras SLA
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-primary" />
                    Configurar Regras de SLA
                  </DialogTitle>
                  <CardDescription>
                    Ajuste os tempos de resposta e monitoramento. As mudanças afetam o semáforo em tempo real.
                  </CardDescription>
                </DialogHeader>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                  <div className="space-y-4">
                    <div className="grid gap-2">
                      <Label className="flex items-center gap-2">
                        <Tag className="h-4 w-4" />
                        Tags Monitoradas (Ex: Rota 5, Rota 4)
                      </Label>
                      <div className="border rounded-md p-3 space-y-2 max-h-[150px] overflow-y-auto bg-muted/20">
                        {(conversationTags || []).length > 0 ? (
                          (conversationTags || []).map((tag: any) => (
                            <div key={tag.id} className="flex items-center space-x-2">
                              <Checkbox 
                                id={`tag-${tag.id}`}
                                checked={localSettings?.monitored_tags?.includes(tag.name)}
                                onCheckedChange={(checked) => {
                                  const current = localSettings?.monitored_tags || [];
                                  let next;
                                  if (checked) {
                                    next = [...current, tag.name];
                                  } else {
                                    next = current.filter((t: string) => t !== tag.name);
                                  }
                                  setLocalSettings({...localSettings, monitored_tags: next});
                                }}
                              />
                              <label 
                                htmlFor={`tag-${tag.id}`}
                                className="text-sm font-medium leading-none cursor-pointer flex items-center gap-2"
                              >
                                <div 
                                  className="w-2 h-2 rounded-full" 
                                  style={{ backgroundColor: tag.color || '#6366f1' }}
                                />
                                {tag.name}
                              </label>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-muted-foreground text-center py-2">Nenhuma tag cadastrada no sistema.</p>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground">Selecione as tags que o Supervisor deve monitorar para análise de engajamento.</p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="new_lead">Lead novo sem abordagem (minutos)</Label>
                      <Input 
                        id="new_lead"
                        type="number" 
                        value={localSettings?.new_lead_sla_minutes || ""} 
                        onChange={(e) => setLocalSettings({...localSettings, new_lead_sla_minutes: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="no_followup">Lead sem follow-up (horas)</Label>
                      <Input 
                        id="no_followup"
                        type="number" 
                        value={localSettings?.no_followup_sla_hours || ""}
                        onChange={(e) => setLocalSettings({...localSettings, no_followup_sla_hours: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="no_response">Lead sem resposta (dias)</Label>
                      <Input 
                        id="no_response"
                        type="number" 
                        value={localSettings?.no_response_sla_days || ""}
                        onChange={(e) => setLocalSettings({...localSettings, no_response_sla_days: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="proposal">Aguardando proposta (horas)</Label>
                      <Input 
                        id="proposal"
                        type="number" 
                        value={localSettings?.proposal_sla_hours || ""}
                        onChange={(e) => setLocalSettings({...localSettings, proposal_sla_hours: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="payment">Aguardando pagamento (dias)</Label>
                      <Input 
                        id="payment"
                        type="number" 
                        value={localSettings?.payment_sla_days || ""}
                        onChange={(e) => setLocalSettings({...localSettings, payment_sla_days: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="reactivation">Reativação de Leads Perdidos (dias)</Label>
                      <Input 
                        id="reactivation"
                        type="number" 
                        value={localSettings?.reactivation_days || ""}
                        onChange={(e) => setLocalSettings({...localSettings, reactivation_days: parseInt(e.target.value)})}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Funis Monitorados</Label>
                      <div className="border rounded-md p-3 space-y-2 max-h-[150px] overflow-y-auto">
                        {(funnels || []).length > 0 ? (
                          (funnels || []).map((f: any) => (
                            <div key={f.id} className="flex items-center space-x-2">
                              <Checkbox 
                                id={`funnel-${f.id}`}
                                checked={localSettings?.monitored_funnels ? localSettings.monitored_funnels.includes(f.id) : true}
                                onCheckedChange={(checked) => {
                                  // Se monitored_funnels for null/undefined, significa que todos estão selecionados inicialmente
                                  const current = localSettings?.monitored_funnels || (funnels || []).map((fun: any) => fun.id);
                                  let next;
                                  if (checked) {
                                    next = Array.from(new Set([...current, f.id]));
                                  } else {
                                    next = current.filter((id: string) => id !== f.id);
                                  }
                                  
                                  // Se após filtrar, o array estiver vazio, talvez o usuário queira monitorar "nenhum" 
                                  // mas a lógica do backend trata vazio como "todos". 
                                  // Mantemos o array vazio para permitir a seleção granular.
                                  setLocalSettings({...localSettings, monitored_funnels: next});
                                }}
                              />
                              <label 
                                htmlFor={`funnel-${f.id}`}
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                              >
                                {f.name}
                              </label>
                            </div>
                          ))
                        ) : (
                          <div className="flex flex-col items-center justify-center py-4 gap-2">
                            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                            <p className="text-xs text-muted-foreground">Carregando funis da organização...</p>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Se nenhum funil for selecionado, todos serão monitorados.
                      </p>
                    </div>

                    
                    <Button 
                      variant="secondary" 
                      className="w-full gap-2" 
                      onClick={handlePreview}
                      disabled={previewMutation.isPending}
                    >
                      <Eye className="h-4 w-4" />
                      {previewMutation.isPending ? "Calculando..." : "Pré-visualizar Impacto"}
                    </Button>
                  </div>

                  <div className="bg-muted/30 rounded-lg p-4 flex flex-col items-center justify-center border">
                    <h4 className="text-sm font-semibold mb-4 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Impacto no Semáforo
                    </h4>
                    
                    <div className="h-[180px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={PREVIEW_DATA || PIE_DATA}
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={65}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {(PREVIEW_DATA || PIE_DATA).map((entry, index) => (
                              <Cell key={`cell-preview-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-3 gap-2 w-full mt-2">
                      <div className="text-center">
                        <div className="text-sm font-bold text-green-500">{(PREVIEW_DATA || PIE_DATA)[0].value}</div>
                        <div className="text-[10px] text-muted-foreground uppercase">Verde</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold text-yellow-500">{(PREVIEW_DATA || PIE_DATA)[1].value}</div>
                        <div className="text-[10px] text-muted-foreground uppercase">Amarelo</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-bold text-red-500">{(PREVIEW_DATA || PIE_DATA)[2].value}</div>
                        <div className="text-[10px] text-muted-foreground uppercase">Vermelho</div>
                      </div>
                    </div>

                    {PREVIEW_DATA && (
                      <div className="mt-4 text-[11px] text-center text-muted-foreground">
                        Exibindo projeção baseada nas novas regras.
                      </div>
                    )}
                  </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <DialogTrigger asChild>
                    <Button variant="ghost">Cancelar</Button>
                  </DialogTrigger>
                  <Button 
                    className="gap-2" 
                    onClick={() => updateSettingsMutation.mutate(localSettings)}
                    disabled={updateSettingsMutation.isPending}
                  >
                    <Save className="h-4 w-4" />
                    {updateSettingsMutation.isPending ? "Salvando..." : "Salvar e Aplicar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            
            <Button
              variant="default"
              onClick={() => runAuditMutation.mutate()}
              disabled={runAuditMutation.isPending || isAuditing}
            >
              {isAuditing ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {isAuditing ? 'Analisando...' : 'Rodar Análise Agora'}
            </Button>

            <Button variant="outline" onClick={() => queryClient.invalidateQueries()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Atualizar
            </Button>
          </div>
        </div>

        {isAuditing && (
          <div className="mb-6">
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 font-medium text-primary">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      IA analisando dados e verificando SLAs...
                    </div>
                    <span className="font-bold">{auditProgress}%</span>
                  </div>
                  <Progress value={auditProgress} className="h-2" />
                  <p className="text-xs text-muted-foreground text-center">
                    Aguarde enquanto nossa IA processa os negócios, verifica tags de rota e identifica gargalos de atendimento.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 lg:w-[900px]">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="sellers">Vendedores</TabsTrigger>
            <TabsTrigger value="alerts">Alertas</TabsTrigger>
            <TabsTrigger value="audits">Auditoria</TabsTrigger>
            <TabsTrigger value="charges">Cobranças</TabsTrigger>
            <TabsTrigger value="config">Configurar Vendedores</TabsTrigger>
          </TabsList>

          <TabsContent value="config" className="space-y-6 mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="flex items-center justify-between w-full">
                  <div>
                    <CardTitle>Configuração de Monitoramento</CardTitle>
                    <CardDescription>
                      Selecione quais usuários e conexões o Supervisor IA deve monitorar ativamente.
                    </CardDescription>
                  </div>
                  <Dialog open={addMemberDialogOpen} onOpenChange={(open) => {
                    setAddMemberDialogOpen(open);
                    if (!open) setSelectedMemberForNew(null);
                  }}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        Adicionar Supervisão
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <User className="h-5 w-5 text-primary" />
                          Adicionar Novo Vendedor
                        </DialogTitle>
                        <CardDescription>Selecione um usuário existente para iniciar o monitoramento.</CardDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>Usuário</Label>
                          <Select 
                            value={newMember.email} 
                            onValueChange={(val) => {
                              const selected = (Array.isArray(allOrgMembers) ? allOrgMembers : []).find((m: any) => m.email === val);
                              if (selected) {
                                setSelectedMemberForNew(selected);
                                setNewMember({
                                  ...newMember,
                                  email: selected.email,
                                  name: selected.name || selected.email,
                                  // Pre-select connections they already have
                                  connection_ids: selected.assigned_connections?.map((c: any) => c.id || c) || []
                                });
                              } else {
                                setSelectedMemberForNew(null);
                                setNewMember({ ...newMember, email: val });
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione um usuário..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(() => {
                                const monitoredEmails = new Set((sellers || []).map((s: any) => s.email));
                                const available = (Array.isArray(allOrgMembers) ? allOrgMembers : [])
                                  .filter((m: any) => m?.email && !monitoredEmails.has(m.email));
                                if (available.length === 0) {
                                  return <div className="p-2 text-xs text-muted-foreground text-center">Nenhum usuário disponível</div>;
                                }
                                return available.map((m: any) => (
                                  <SelectItem key={m.id} value={m.email}>
                                    {m.name || m.email} ({m.email})
                                  </SelectItem>
                                ));
                              })()}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-2">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">
                            Conexões de WhatsApp {selectedMemberForNew && "(Filtrado por permissão)"}
                          </Label>
                          <div className="border rounded-md p-3 space-y-2 max-h-[150px] overflow-y-auto bg-muted/20">
                            {(() => {
                              let availableConnections = orgConnections || [];
                              
                              // Se um membro foi selecionado e não for admin/owner, filtramos pelas conexões atribuídas a ele
                              if (selectedMemberForNew && !['admin', 'owner'].includes(selectedMemberForNew.role)) {
                                const assigned = selectedMemberForNew.assigned_connections;
                                if (Array.isArray(assigned) && assigned.length > 0) {
                                  const assignedIds = new Set(assigned.map((c: any) => c.id || c));
                                  availableConnections = availableConnections.filter((conn: any) => assignedIds.has(conn.id));
                                }
                              }

                              if (availableConnections.length === 0) {
                                return <p className="text-xs text-muted-foreground text-center py-2">Nenhuma conexão disponível para este usuário.</p>;
                              }

                              return availableConnections.map((conn: any) => (
                                <div key={conn.id} className="flex items-center space-x-2">
                                  <Checkbox 
                                    id={`new-member-conn-${conn.id}`}
                                    checked={newMember.connection_ids.includes(conn.id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setNewMember({...newMember, connection_ids: [...newMember.connection_ids, conn.id]});
                                      } else {
                                        setNewMember({...newMember, connection_ids: newMember.connection_ids.filter(id => id !== conn.id)});
                                      }
                                    }}
                                  />
                                  <label 
                                    htmlFor={`new-member-conn-${conn.id}`}
                                    className="text-sm font-medium leading-none cursor-pointer"
                                  >
                                    {conn.name}
                                  </label>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-bold uppercase text-muted-foreground">
                            Funis do Kanban {selectedMemberForNew && "(Filtrado por permissão)"}
                          </Label>
                          <div className="border rounded-md p-3 space-y-2 max-h-[150px] overflow-y-auto bg-muted/20">
                            {(() => {
                              let availableFunnels = funnels || [];

                              // Filtramos os funis. Se o usuário tiver assigned_funnels ou funnel_ids, usamos isso.
                              // Caso contrário, se for admin/owner mostra tudo, senão verificamos permissões.
                              if (selectedMemberForNew && !['admin', 'owner'].includes(selectedMemberForNew.role)) {
                                const assignedFunnels = selectedMemberForNew.assigned_funnels || selectedMemberForNew.funnel_ids;
                                if (Array.isArray(assignedFunnels) && assignedFunnels.length > 0) {
                                  const assignedIds = new Set(assignedFunnels.map((f: any) => f.id || f));
                                  availableFunnels = availableFunnels.filter((f: any) => assignedIds.has(f.id));
                                }
                              }

                              if (availableFunnels.length === 0) {
                                return <p className="text-xs text-muted-foreground text-center py-2">Nenhum funil disponível para este usuário.</p>;
                              }

                              return availableFunnels.map((f: any) => (
                                <div key={f.id} className="flex items-center space-x-2">
                                  <Checkbox 
                                    id={`new-member-funnel-${f.id}`}
                                    checked={newMember.monitored_funnels.includes(f.id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setNewMember({...newMember, monitored_funnels: [...newMember.monitored_funnels, f.id]});
                                      } else {
                                        setNewMember({...newMember, monitored_funnels: newMember.monitored_funnels.filter(id => id !== f.id)});
                                      }
                                    }}
                                  />
                                  <label 
                                    htmlFor={`new-member-funnel-${f.id}`}
                                    className="text-sm font-medium leading-none cursor-pointer"
                                  >
                                    {f.name}
                                  </label>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => setAddMemberDialogOpen(false)}>Cancelar</Button>
                        <Button 
                          onClick={() => {
                            if (!newMember.email) return toast.error("Selecione um usuário");
                            
                            // Em caso de erro de permissão (ex: apenas admin pode adicionar),
                            // informamos ao usuário que ele já é admin ou verificamos o papel dele
                            createMemberMutation.mutate(newMember);
                          }}
                          disabled={createMemberMutation.isPending}
                        >
                          {createMemberMutation.isPending ? "Adicionando..." : "Confirmar Supervisão"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Vendedor</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Monitoramento Ativo</TableHead>
                          <TableHead className="text-right">Configurar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sellersLoading ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                              Carregando vendedores...
                            </TableCell>
                          </TableRow>
                        ) : (sellers || []).map((seller: any) => {
                          const isMonitoring = (seller.connection_ids?.length > 0) || (seller.monitored_funnels?.length > 0);
                          return (
                            <TableRow key={seller.id}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-xs">
                                    {seller.name?.charAt(0) || seller.email?.charAt(0) || '?'}
                                  </div>
                                  <div>
                                    <div>{seller.name || 'Sem nome'}</div>
                                    <div className="text-[10px] text-muted-foreground">{seller.email}</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                {isMonitoring ? (
                                  <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20 border-green-200 gap-1.5 py-1">
                                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                                    Monitoramento Ativo
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-muted-foreground gap-1.5 py-1">
                                    <span className="h-2 w-2 rounded-full bg-slate-300" />
                                    Inativo
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  <div className="flex flex-wrap gap-1">
                                    {(orgConnections || [])
                                      .filter((conn: any) => seller.connections?.includes(conn.id))
                                      .map((conn: any) => (
                                        <Badge key={conn.id} variant="secondary" className="text-[10px] bg-blue-50 text-blue-700 border-blue-100">
                                          {conn.name}
                                        </Badge>
                                      ))}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {(funnels || [])
                                      .filter((f: any) => seller.monitored_funnels?.includes(f.id))
                                      .map((f: any) => (
                                        <Badge key={f.id} variant="outline" className="text-[10px] bg-slate-50">
                                          Funil: {f.name}
                                        </Badge>
                                      ))}
                                  </div>
                                  {!isMonitoring && (
                                    <span className="text-xs text-muted-foreground italic">Nenhuma conexão vinculada</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => handleEditMember(seller)}
                                  className="h-8 gap-2"
                                >
                                  <Monitor className="h-4 w-4" />
                                  Mapear
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 p-4 rounded-md flex gap-3 dark:bg-blue-900/10 dark:border-blue-800">
                    <Shield className="h-5 w-5 text-blue-600 shrink-0" />
                    <div className="text-sm text-blue-800 dark:text-blue-300">
                      <p className="font-semibold text-blue-900 dark:text-blue-200">Como funciona o Mapeamento:</p>
                      <ul className="list-disc ml-5 mt-1 space-y-1">
                        <li><strong>Vendedor:</strong> Usuários já cadastrados na sua organização.</li>
                        <li><strong>Conexões:</strong> Quais números de WhatsApp este vendedor utiliza.</li>
                        <li><strong>Funis:</strong> Quais funis do Kanban o Supervisor deve observar para este vendedor.</li>
                        <li>O monitoramento fica <strong>Ativo</strong> assim que você vincula ao menos uma conexão.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Member Edit Dialog */}
            <Dialog open={editMemberDialogOpen} onOpenChange={setEditMemberDialogOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Monitor className="h-5 w-5 text-primary" />
                    Mapear Vendedor: {editingMember?.name}
                  </DialogTitle>
                  <CardDescription>Defina as conexões e funis que o Supervisor IA deve monitorar para este usuário.</CardDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-muted-foreground">
                      Conexões de WhatsApp {editingMember && "(Filtrado por permissão)"}
                    </Label>
                    <div className="border rounded-md p-3 space-y-2 max-h-[150px] overflow-y-auto bg-muted/20">
                      {(() => {
                        let availableConnections = orgConnections || [];
                        
                        // Se for um agente/gerente comum, filtramos pelas conexões atribuídas
                        if (editingMember && !['admin', 'owner'].includes(editingMember.role)) {
                          const assigned = editingMember.assigned_connections;
                          // Only filter if there's an explicit assignment list; otherwise
                          // show every connection of the organization (no restriction)
                          if (Array.isArray(assigned) && assigned.length > 0) {
                            const assignedIds = new Set(assigned.map((c: any) => c.id || c));
                            availableConnections = availableConnections.filter((conn: any) => assignedIds.has(conn.id));
                          }
                        }

                        if (availableConnections.length === 0) {
                          return <p className="text-xs text-muted-foreground text-center py-2">Nenhuma conexão disponível para este usuário.</p>;
                        }

                        return availableConnections.map((conn: any) => (
                          <div key={conn.id} className="flex items-center space-x-2">
                            <Checkbox 
                              id={`member-conn-${conn.id}`}
                              checked={editMemberConnectionIds.includes(conn.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setEditMemberConnectionIds([...editMemberConnectionIds, conn.id]);
                                } else {
                                  setEditMemberConnectionIds(editMemberConnectionIds.filter(id => id !== conn.id));
                                }
                              }}
                            />
                            <label 
                              htmlFor={`member-conn-${conn.id}`}
                              className="text-sm font-medium leading-none cursor-pointer"
                            >
                              {conn.name} {conn.phone_number && `(${conn.phone_number})`}
                            </label>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase text-muted-foreground">
                      Funis do Kanban {editingMember && "(Filtrado por permissão)"}
                    </Label>
                    <div className="border rounded-md p-3 space-y-2 max-h-[150px] overflow-y-auto bg-muted/20">
                      {(() => {
                        let availableFunnels = funnels || [];

                        // Filtramos os funis pela permissão do membro
                        if (editingMember && !['admin', 'owner'].includes(editingMember.role)) {
                          const assignedFunnels = editingMember.assigned_funnels || editingMember.funnel_ids;
                          if (Array.isArray(assignedFunnels) && assignedFunnels.length > 0) {
                            const assignedIds = new Set(assignedFunnels.map((f: any) => f.id || f));
                            availableFunnels = availableFunnels.filter((f: any) => assignedIds.has(f.id));
                          }
                        }

                        if (availableFunnels.length === 0) {
                          return <p className="text-xs text-muted-foreground text-center py-2">Nenhum funil disponível para este usuário.</p>;
                        }

                        return availableFunnels.map((f: any) => (
                          <div key={f.id} className="flex items-center space-x-2">
                            <Checkbox 
                              id={`member-funnel-${f.id}`}
                              checked={editMemberFunnels.includes(f.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setEditMemberFunnels([...editMemberFunnels, f.id]);
                                } else {
                                  setEditMemberFunnels(editMemberFunnels.filter(id => id !== f.id));
                                }
                              }}
                            />
                            <label 
                              htmlFor={`member-funnel-${f.id}`}
                              className="text-sm font-medium leading-none cursor-pointer"
                            >
                              {f.name}
                            </label>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    O papel do usuário (Agente, Gerente, Supervisor) é definido em <strong>Configurações &gt; Usuários</strong>. Aqui você define apenas o que o Supervisor IA deve monitorar.
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setEditMemberDialogOpen(false)}>Cancelar</Button>
                  <Button 
                    onClick={handleSaveMember}
                    disabled={updateMemberMutation.isPending}
                    className="gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {updateMemberMutation.isPending ? "Salvando..." : "Salvar Mapeamento"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>


          <TabsContent value="dashboard" className="space-y-6 mt-6">
            {/* Quick Setup Help for new users */}
            {(!stats || stats.total_leads === 0) && (
              <Card className="border-primary/50 bg-primary/5">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">Bem-vindo ao Supervisor IA!</CardTitle>
                  </div>
                  <CardDescription>
                    O Supervisor IA monitora automaticamente seu CRM. Siga os passos abaixo para começar:
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">1</div>
                    <p className="font-semibold text-sm">Defina os Vendedores e Conexões</p>
                    <p className="text-xs text-muted-foreground">Acesse a aba <strong>Configurar Vendedores</strong> para selecionar quais usuários e quais conexões de WhatsApp o IA deve monitorar.</p>
                  </div>
                  <div className="space-y-2">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">2</div>
                    <p className="font-semibold text-sm">Configure o SLA</p>
                    <p className="text-xs text-muted-foreground">Clique no botão <strong>Regras SLA</strong> acima para definir os tempos de resposta ideais para sua operação.</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* KPI Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard title="Total Leads" value={stats?.total_leads} icon={Users} color="blue" />
              <StatCard title="Novos" value={stats?.leads_novos} icon={TrendingUp} color="emerald" />
              <StatCard title="Sem Abordagem" value={stats?.leads_sem_abordagem} icon={AlertTriangle} color="red" />
              <StatCard title="Sem Resposta" value={stats?.leads_sem_resposta} icon={MessageSquare} color="amber" />
              <StatCard title="Em Atendimento" value={stats?.leads_em_atendimento} icon={UserCheck} color="indigo" />
              <StatCard title="Convertidos" value={stats?.leads_convertidos} icon={CheckCircle2} color="green" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Semáforo Pie Chart */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-lg">Semáforo Comercial</CardTitle>
                  <CardDescription>Status de priorização em tempo real</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                  <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={PIE_DATA}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {PIE_DATA.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-3 gap-4 w-full mt-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-500">{semaphore?.GREEN || 0}</div>
                      <div className="text-xs text-muted-foreground uppercase">Verde</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-yellow-500">{semaphore?.YELLOW || 0}</div>
                      <div className="text-xs text-muted-foreground uppercase">Amarelo</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-500">{semaphore?.RED || 0}</div>
                      <div className="text-xs text-muted-foreground uppercase">Vermelho</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Top Vendedores Bar Chart */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">Ranking de Vendedores</CardTitle>
                  <CardDescription>Leads e Conversões por membro da equipe</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={sellers}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <RechartsTooltip />
                        <Bar dataKey="total_leads" name="Leads" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="conversions" name="Conversões" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Alertas Críticos */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Leads que exigem ação</CardTitle>
                  <CardDescription>Leads em risco ou aguardando retorno imediato</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab("alerts")}>
                  Ver todos <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {(() => {
                    const redLeads = (semaphore?.leads || []).filter((l: any) => l.semaphore_color === 'RED');
                    if (redLeads.length === 0) return null;
                    
                    return redLeads.slice(0, 5).map((lead: any) => (
                      <div key={lead.id} className="flex items-center justify-between p-3 border rounded-lg bg-red-50/50 dark:bg-red-950/10 border-red-100 dark:border-red-900/30">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                            <AlertTriangle className="h-5 w-5 text-red-600" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              {lead.id.length > 36 ? (
                                <MessageSquare className="h-4 w-4 text-purple-600" />
                              ) : (
                                <Target className="h-4 w-4 text-red-600" />
                              )}
                              <p className="font-medium">{lead.title}</p>
                              {lead.id.length > 36 && (
                                <Badge variant="outline" className="text-[10px] py-0 h-4">Chat</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Última interação: {lead.last_customer_message_at ? new Date(lead.last_customer_message_at).toLocaleString() : 'Nunca'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <Badge variant="destructive" className="animate-pulse">Crítico</Badge>
                          <Button 
                            size="sm" 
                            onClick={() => {
                              if (lead.id.length > 36) {
                                navigate(`/chat?conversationId=${lead.id}`);
                              } else {
                                navigate(`/crm?dealId=${lead.id}`);
                              }
                            }}
                          >
                            Resolver
                          </Button>

                        </div>
                      </div>
                    ));
                  })()}
                  {(semaphore?.leads || []).filter((l: any) => l.semaphore_color === 'RED').length === 0 && (
                    <div className="text-center py-6 text-muted-foreground">
                      Nenhum lead em estado crítico no momento. Parabéns!
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sellers" className="mt-6">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {sellers?.map((seller: any) => (
                 <Card key={seller.id} className="overflow-hidden">
                   <CardHeader className="bg-muted/30 pb-4">
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
                            {seller.name.charAt(0)}
                          </div>
                          <div>
                            <CardTitle className="text-base">{seller.name}</CardTitle>
                            <CardDescription className="text-xs">Score: {Math.round(seller.conversion_rate || 0)}/100</CardDescription>
                          </div>
                        </div>
                        <Badge variant={seller.conversion_rate > 20 ? "default" : "outline"}>
                          Rank #{sellers.indexOf(seller) + 1}
                        </Badge>
                     </div>
                   </CardHeader>
                   <CardContent className="p-0">
                     <div className="grid grid-cols-2 border-b">
                        <div className="p-4 border-r text-center">
                          <div className="text-xl font-bold">{seller.total_leads}</div>
                          <div className="text-xs text-muted-foreground uppercase">Leads</div>
                        </div>
                        <div className="p-4 text-center">
                          <div className="text-xl font-bold text-green-600">{seller.conversions}</div>
                          <div className="text-xs text-muted-foreground uppercase">Convertidos</div>
                        </div>
                     </div>
                     <div className="p-4 space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Tempo médio resp.</span>
                          <span className="font-medium">{Math.round((seller.avg_response_time || 0) / 60)} min</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Taxa Conversão</span>
                          <span className="font-medium">{Math.round(seller.conversion_rate || 0)}%</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Sem abordagem</span>
                          <span className={cn("font-medium", seller.no_approach > 0 ? "text-red-500" : "")}>
                            {seller.no_approach}
                          </span>
                        </div>
                        <Button className="w-full mt-2" variant="outline" size="sm">Ver Leads</Button>
                     </div>
                   </CardContent>
                 </Card>
               ))}
             </div>
          </TabsContent>

          <TabsContent value="alerts" className="mt-6">
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Nome do Lead</th>
                      <th className="px-4 py-3 text-left font-medium">Responsável</th>
                      <th className="px-4 py-3 text-left font-medium">Última Interação</th>
                      <th className="px-4 py-3 text-left font-medium">Prioridade</th>
                      <th className="px-4 py-3 text-right font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(() => {
                      const leads = (semaphore?.leads || []);
                      if (leads.length === 0) {
                        return (
                          <tr>
                            <td colSpan={5} className="text-center py-10 text-muted-foreground">
                              Nenhum alerta encontrado no momento.
                            </td>
                          </tr>
                        );
                      }
                      
                      return leads.map((lead: any) => (
                        <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-medium">
                            <div className="flex items-center gap-2">
                              {lead.id.length > 36 ? (
                                <MessageSquare className="h-4 w-4 text-purple-500" />
                              ) : (
                                <Target className="h-4 w-4 text-blue-500" />
                              )}
                              <span>{lead.title}</span>
                              {lead.id.length > 36 && (
                                <Badge variant="outline" className="text-[10px] py-0 h-4">Chat</Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {sellers?.find((s: any) => s.user_id === lead.owner_id || s.id === lead.owner_id)?.name || 'Não atribuído'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {lead.last_activity_at ? new Date(lead.last_activity_at).toLocaleString() : 'Nunca'}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={
                              lead.semaphore_color === 'RED' ? 'destructive' : 
                              lead.semaphore_color === 'YELLOW' ? 'secondary' : 'default'
                            }>
                              {lead.semaphore_color === 'RED' ? 'Alta' : lead.semaphore_color === 'YELLOW' ? 'Média' : 'Normal'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => {
                                if (lead.id.length > 36) {
                                  navigate(`/chat?conversationId=${lead.id}`);
                                } else {
                                  navigate(`/crm?dealId=${lead.id}`);
                                }
                              }}
                            >
                              Ver {lead.id.length > 36 ? 'Chat' : 'Lead'}
                            </Button>
                          </td>
                        </tr>

                      ));
                    })()}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="audits" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Histórico de Auditoria IA</CardTitle>
                  <CardDescription>Registro das últimas varreduras e diagnósticos realizados</CardDescription>
                </div>
                <Button 
                  onClick={() => runAuditMutation.mutate()} 
                  disabled={runAuditMutation.isPending || isAuditing}
                  className="gap-2"
                >
                  {isAuditing ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {isAuditing ? 'Analisando...' : 'Processar Agora'}
                </Button>
              </CardHeader>
              {isAuditing && (
                <div className="px-6 pb-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-bold uppercase text-primary">
                      <span>IA trabalhando nos dados...</span>
                      <span>{auditProgress}%</span>
                    </div>
                    <Progress value={auditProgress} className="h-1.5" />
                  </div>
                </div>
              )}
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Lead</th>
                      <th className="px-4 py-3 text-left font-medium">Vendedor</th>
                      <th className="px-4 py-3 text-left font-medium">Data Análise</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-left font-medium">Motivo</th>
                      <th className="px-4 py-3 text-left font-medium">Urgência</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {audits?.map((audit: any) => (
                    <tr key={audit.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          {audit.deal_id ? (
                            <Target className="h-4 w-4 text-blue-500" />
                          ) : (
                            <MessageSquare className="h-4 w-4 text-purple-500" />
                          )}
                          <span>{audit.lead_name}</span>
                          {!audit.deal_id && (
                            <Badge variant="outline" className="text-[10px] py-0 h-4">Chat</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{audit.seller_name}</td>
                      <td className="px-4 py-3">{new Date(audit.created_at || audit.analysis_date).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">{audit.status_found}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{audit.reason}</td>

                        <td className="px-4 py-3">
                          <Badge variant={audit.urgency === 'high' ? 'destructive' : 'secondary'}>
                            {audit.urgency}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {audits?.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-muted-foreground">
                          Nenhuma auditoria realizada ainda.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="charges" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                      <CardTitle>Central de Cobranças</CardTitle>
                      <CardDescription>Gerencie pendências e envie lembretes</CardDescription>
                    </div>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button className="gap-2">
                          <Users className="h-4 w-4" />
                          Cobrar Equipe
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Cobrança Coletiva (Equipe)</DialogTitle>
                          <CardDescription>Esta ação enviará uma cobrança para todos os membros da equipe selecionada e resetará os prazos de follow-up.</CardDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>Selecione a Equipe</Label>
                            <Select onValueChange={(val) => setSelectedTarget({ id: val, type: 'team' })}>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecione uma equipe" />
                              </SelectTrigger>
                              <SelectContent>
                                {teams?.map((team: any) => (
                                  <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Observação (Opcional)</Label>
                            <Input 
                              placeholder="Ex: Reforçar abordagem de leads novos..." 
                              value={chargeNote}
                              onChange={(e) => setChargeNote(e.target.value)}
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button 
                            variant="destructive" 
                            className="w-full"
                            disabled={!selectedTarget || chargeMutation.isPending}
                            onClick={() => chargeMutation.mutate({ 
                              type: 'team', 
                              targetId: selectedTarget.id, 
                              notes: chargeNote 
                            })}
                          >
                            {chargeMutation.isPending ? "Processando..." : "Confirmar Cobrança de Equipe"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">Vendedor</th>
                          <th className="px-4 py-3 text-center font-medium">Leads em Atraso</th>
                          <th className="px-4 py-3 text-center font-medium">Pendências</th>
                          <th className="px-4 py-3 text-right font-medium">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {sellers?.map((seller: any) => (
                          <tr key={seller.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-medium">
                              <div className="flex items-center gap-2">
                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold">
                                  {seller.name.charAt(0)}
                                </div>
                                {seller.name}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge variant={seller.no_approach > 0 ? "destructive" : "outline"} className={seller.no_approach > 0 ? "animate-pulse" : ""}>
                                {seller.no_approach}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-center text-muted-foreground">{seller.total_leads}</td>
                            <td className="px-4 py-3 text-right">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button size="sm" variant="secondary" className="gap-2">
                                    <DollarSign className="h-3 w-3" />
                                    Cobrar
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Cobrar Vendedor: {seller.name}</DialogTitle>
                                    <CardDescription>Registre uma cobrança individual para este vendedor.</CardDescription>
                                  </DialogHeader>
                                  <div className="space-y-4 py-4">
                                    <div className="bg-muted/50 p-3 rounded-lg flex justify-between items-center">
                                      <span className="text-sm font-medium">Leads em atraso:</span>
                                      <Badge variant="destructive">{seller.no_approach}</Badge>
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Observação</Label>
                                      <Input 
                                        placeholder="Motivo da cobrança..." 
                                        value={chargeNote}
                                        onChange={(e) => setChargeNote(e.target.value)}
                                      />
                                    </div>
                                  </div>
                                  <DialogFooter>
                                    <Button 
                                      className="w-full"
                                      disabled={chargeMutation.isPending}
                                      onClick={() => chargeMutation.mutate({ 
                                        type: 'individual', 
                                        targetId: seller.id, 
                                        notes: chargeNote 
                                      })}
                                    >
                                      {chargeMutation.isPending ? "Registrando..." : "Enviar Cobrança Individual"}
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <History className="h-4 w-4 text-primary" />
                      Histórico Recente
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {chargesHistory?.map((charge: any) => (
                      <div key={charge.id} className="relative pl-4 pb-4 border-l last:pb-0">
                        <div className="absolute left-[-5px] top-0 h-2 w-2 rounded-full bg-primary" />
                        <p className="text-xs text-muted-foreground">
                          {new Date(charge.created_at).toLocaleString()}
                        </p>
                        <p className="text-sm font-semibold mt-1">
                          {charge.type === 'team' ? `Equipe: ${charge.target_team_name}` : `Vendedor: ${charge.target_user_name}`}
                        </p>
                        {charge.notes && (
                          <p className="text-xs text-muted-foreground mt-1 bg-muted p-2 rounded">
                            "{charge.notes}"
                          </p>
                        )}
                        <p className="text-[10px] mt-1 text-primary/70 uppercase font-bold tracking-wider">
                          Por: {charge.charged_by_name}
                        </p>
                      </div>
                    ))}
                    {chargesHistory?.length === 0 && (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        Nenhuma cobrança registrada.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>

      </div>
    </MainLayout>
  );
}


function StatCard({ title, value, icon: Icon, color }: any) {
  const colors: any = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
    red: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
    indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400",
    green: "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400",
  };

  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-2">
        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", colors[color])}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase truncate">{title}</p>
          <p className="text-2xl font-bold">{value || 0}</p>
        </div>
      </CardContent>
    </Card>
  );
}



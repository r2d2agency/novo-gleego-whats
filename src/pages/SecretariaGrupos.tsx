import { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  Bot, Users, Settings, Activity, Plus, Trash2, Save, Loader2, Shield, Clock, MessageSquare, BellRing, Phone, Smartphone, Wifi, AlertTriangle, Pencil, BarChart3, RefreshCw, Timer, FileText, ChevronDown, ChevronUp, CalendarDays, UserX
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { MainLayout } from "@/components/layout/MainLayout";
import { useGroupSecretary, type SecretaryConfig, type SecretaryMember, type SecretaryLog, type SecretaryStats, type AvailableUser, type MonitoredGroup, type MeetingMinutes } from "@/hooks/use-group-secretary";
import { useConnections } from "@/hooks/use-connections";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import SecretaryDiagnosticPanel from "@/components/secretaria/SecretaryDiagnosticPanel";
import SecretaryFollowupsPanel from "@/components/secretaria/SecretaryFollowupsPanel";

export default function SecretariaGrupos() {
  const {
    getConfig, saveConfig, getMembers, addMember, removeMember, getLogs, getAvailableUsers, getGroups, getStats, updateMemberPhone,
    generateMeetingMinutes, getMeetingMinutes, deleteMeetingMinutes, sendDigestNow,
  } = useGroupSecretary();
  const { data: orgConnections = [] } = useConnections({ scope: 'organization' });

  const [config, setConfig] = useState<SecretaryConfig>({
    is_active: false, connection_ids: null, group_jids: null,
    create_crm_task: true, show_popup_alert: true, min_confidence: 0.6,
    ai_provider: null, ai_model: null,
    notify_external_enabled: false, notify_external_phone: '',
    notify_members_whatsapp: false, default_connection_id: null,
    individual_notifications_enabled: true,
    followup_enabled: false, followup_hours: 4,
    daily_digest_enabled: false, daily_digest_hour: 8, daily_digest_minute: 0, daily_digest_type: 'detailed',
    auto_reply_enabled: false, auto_reply_message: '',
    excluded_senders: [],
  });
  const [members, setMembers] = useState<SecretaryMember[]>([]);
  const [logs, setLogs] = useState<SecretaryLog[]>([]);
  const [stats, setStats] = useState<SecretaryStats | null>(null);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [allGroups, setAllGroups] = useState<MonitoredGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState("");
  const [connectionFilter, setConnectionFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [editingPhoneMember, setEditingPhoneMember] = useState<{ user_id: string; user_name: string } | null>(null);
  const [editingPhone, setEditingPhone] = useState("");
  const [newMember, setNewMember] = useState({
    user_id: "", aliases: "", role_description: "", departments: "",
  });
  const [meetingMinutes, setMeetingMinutes] = useState<MeetingMinutes[]>([]);
  const [selectedMinutesGroup, setSelectedMinutesGroup] = useState("");
  const [minutesHours, setMinutesHours] = useState("24");
  const [generatingMinutes, setGeneratingMinutes] = useState(false);
  const [expandedMinutes, setExpandedMinutes] = useState<string | null>(null);
  const [newExcludedNumber, setNewExcludedNumber] = useState("");
  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cfg, mems, lgs, users, groups, sts, minutes] = await Promise.all([
        getConfig(), getMembers(), getLogs(), getAvailableUsers(), getGroups(), getStats().catch(() => null),
        getMeetingMinutes().catch(() => []),
      ]);
      setConfig(cfg);
      setMembers(mems);
      setLogs(lgs);
      setAvailableUsers(users);
      setAllGroups(groups);
      setStats(sts);
      setMeetingMinutes(minutes);
    } catch (err: any) {
      toast.error(err.message || "Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const saved = await saveConfig(config);
      setConfig(saved);
      toast.success("Configuração salva!");
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async () => {
    if (!newMember.user_id) {
      toast.error("Selecione um usuário");
      return;
    }
    try {
      await addMember({
        user_id: newMember.user_id,
        aliases: newMember.aliases.split(",").map((a) => a.trim()).filter(Boolean),
        role_description: newMember.role_description,
        departments: newMember.departments.split(",").map((d) => d.trim()).filter(Boolean),
      });
      toast.success("Membro adicionado!");
      setAddDialogOpen(false);
      setNewMember({ user_id: "", aliases: "", role_description: "", departments: "" });
      const mems = await getMembers();
      setMembers(mems);
    } catch (err: any) {
      toast.error(err.message || "Erro ao adicionar");
    }
  };

  const handleRemoveMember = async (id: string) => {
    try {
      await removeMember(id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
      toast.success("Membro removido");
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
  };

  const openPhoneDialog = (userId: string, userName: string) => {
    setEditingPhoneMember({ user_id: userId, user_name: userName });
    setEditingPhone("");
    setPhoneDialogOpen(true);
  };

  const handleSavePhone = async () => {
    if (!editingPhoneMember || !editingPhone.trim()) {
      toast.error("Informe o número");
      return;
    }
    try {
      await updateMemberPhone(editingPhoneMember.user_id, editingPhone.trim());
      toast.success(`Telefone de ${editingPhoneMember.user_name} atualizado!`);
      setPhoneDialogOpen(false);
      const mems = await getMembers();
      setMembers(mems);
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar telefone");
    }
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              Secretária IA de Grupos
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Monitora grupos de WhatsApp e detecta solicitações direcionadas à equipe
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="active" className="text-sm">
              {config.is_active ? "Ativa" : "Inativa"}
            </Label>
            <Switch
              id="active"
              checked={config.is_active}
              onCheckedChange={async (v) => {
                setConfig((c) => ({ ...c, is_active: v }));
                try {
                  await saveConfig({ ...config, is_active: v });
                  toast.success(v ? "Secretária ativada!" : "Secretária desativada!");
                } catch (err: any) {
                  setConfig((c) => ({ ...c, is_active: !v }));
                  toast.error("Erro ao salvar status");
                }
              }}
            />
          </div>
        </div>

        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members" className="gap-1">
              <Users className="h-3.5 w-3.5" />
              Membros
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1">
              <Settings className="h-3.5 w-3.5" />
              Configurações
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-1">
              <BarChart3 className="h-3.5 w-3.5" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-1">
              <Activity className="h-3.5 w-3.5" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="minutes" className="gap-1">
              <FileText className="h-3.5 w-3.5" />
              Atas
            </TabsTrigger>
            <TabsTrigger value="followups" className="gap-1">
              <Timer className="h-3.5 w-3.5" />
              Follow-ups
            </TabsTrigger>
            <TabsTrigger value="diagnostic" className="gap-1">
              <Shield className="h-3.5 w-3.5" />
              Auditoria
            </TabsTrigger>
          </TabsList>

          {/* FOLLOW-UPS TAB */}
          <TabsContent value="followups" className="space-y-4">
            <SecretaryFollowupsPanel />
          </TabsContent>

          {/* MEMBERS TAB */}
          <TabsContent value="members" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Configure quais membros da equipe a IA deve identificar nos grupos
              </p>
              <Button size="sm" onClick={() => setAddDialogOpen(true)} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                Adicionar Membro
              </Button>
            </div>

            {/* Warning: members without phone when notify_members_whatsapp is active */}
            {config.notify_members_whatsapp && members.length > 0 && (() => {
              const noPhone = members.filter(m => !m.whatsapp_phone && !m.phone);
              if (noPhone.length === 0) return null;
              return (
                <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-sm space-y-2">
                    <p>
                      <strong>{noPhone.length} membro(s)</strong> sem telefone cadastrado e não receberão notificações WhatsApp:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {noPhone.map(m => (
                        <Button
                          key={m.user_id}
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1 border-destructive/30 hover:bg-destructive/10"
                          onClick={() => openPhoneDialog(m.user_id, m.user_name)}
                        >
                          <Phone className="h-3 w-3" />
                          {m.user_name}
                        </Button>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              );
            })()}

            {members.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Nenhum membro configurado</p>
                  <p className="text-xs mt-1">
                    Adicione membros da equipe para que a IA possa identificá-los nas mensagens
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {members.map((member) => (
                  <Card key={member.id}>
                     <CardContent className="p-4 flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{member.user_name}</span>
                          <Badge variant="secondary" className="text-xs">
                            {member.email}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {member.whatsapp_phone || member.phone ? (
                            <span className="text-xs text-foreground font-mono">
                              {member.whatsapp_phone || member.phone}
                            </span>
                          ) : (
                            <span className="text-xs text-destructive">
                              Sem telefone cadastrado
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => openPhoneDialog(member.user_id, member.user_name)}
                            title="Editar telefone"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                        {member.aliases?.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">Apelidos:</span>
                            {member.aliases.map((alias, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {alias}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {member.departments?.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">Áreas:</span>
                            {member.departments.map((dept, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {dept}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {member.role_description && (
                          <p className="text-xs text-muted-foreground">
                            {member.role_description}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleRemoveMember(member.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* SETTINGS TAB */}
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Grupos Monitorados
                </CardTitle>
                <CardDescription>
                  Selecione quais grupos a secretária IA deve monitorar. Se nenhum for selecionado, todos os grupos serão monitorados.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  // Merge connections from groups + org connections list so
                  // the dropdown shows every connection even if it has no
                  // groups yet.
                  const connMap = new Map<string, string>();
                  orgConnections.forEach((c) => connMap.set(c.id, c.name));
                  allGroups.forEach((g) => {
                    if (!connMap.has(g.connection_id)) connMap.set(g.connection_id, g.connection_name);
                  });
                  const connections = [...connMap.entries()];
                  const filteredGroups = allGroups
                    .filter((g) => connectionFilter === 'all' || g.connection_id === connectionFilter)
                    .filter((g) => !groupFilter || g.group_name?.toLowerCase().includes(groupFilter.toLowerCase()));
                  return (
                    <>
                      {connections.length > 0 && (
                        <div className="space-y-1.5 mb-2">
                          <Label className="text-xs">Conexão</Label>
                          <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione uma conexão" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Todas as conexões</SelectItem>
                              {connections.map(([id, name]) => (
                                <SelectItem key={id} value={id}>{name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {filteredGroups.length === 0 ? (
                        <div className="space-y-2">
                          <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="text-xs">
                              {connectionFilter === 'all'
                                ? 'Nenhum grupo foi detectado ainda nas suas conexões.'
                                : `Nenhum grupo detectado nessa conexão (${connMap.get(connectionFilter) || ''}).`}
                              {' '}Os grupos aparecem aqui após a primeira mensagem ser recebida. Você ainda pode salvar a configuração — ela monitorará automaticamente todos os grupos que aparecerem.
                            </AlertDescription>
                          </Alert>
                          <Button size="sm" variant="outline" onClick={loadAll} disabled={loading}>
                            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Recarregar grupos
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Input
                            placeholder="Filtrar grupos por nome..."
                            value={groupFilter}
                            onChange={(e) => setGroupFilter(e.target.value)}
                            className="mb-2"
                          />
                          <div className="flex gap-2 mb-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfig(c => ({ ...c, group_jids: filteredGroups.map(g => g.remote_jid) }))}
                            >
                              Selecionar {connectionFilter !== "all" ? "desta conexão" : "todos"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfig(c => ({ ...c, group_jids: null }))}
                            >
                              Limpar (monitorar todos)
                            </Button>
                          </div>
                          <ScrollArea className="h-[250px] border rounded-md p-2">
                            <div className="space-y-1">
                              {filteredGroups.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-4">Nenhum grupo encontrado</p>
                              ) : (
                                filteredGroups.map((group) => {
                                  const isSelected = config.group_jids?.includes(group.remote_jid) ?? false;
                                  return (
                                    <label
                                      key={group.remote_jid}
                                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                                    >
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={(checked) => {
                                          setConfig(c => {
                                            const current = c.group_jids || [];
                                            if (checked) {
                                              return { ...c, group_jids: [...current, group.remote_jid] };
                                            } else {
                                              const updated = current.filter(j => j !== group.remote_jid);
                                              return { ...c, group_jids: updated.length > 0 ? updated : null };
                                            }
                                          });
                                        }}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <span className="text-sm font-medium truncate block">
                                          {group.group_name || group.remote_jid}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {group.connection_name}
                                        </span>
                                      </div>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </ScrollArea>
                        </>
                      )}
                      {config.group_jids && config.group_jids.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {config.group_jids.length} grupo(s) selecionado(s)
                        </p>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comportamento</CardTitle>
                <CardDescription>Configure como a secretária IA deve agir</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Criar tarefa no CRM</Label>
                    <p className="text-xs text-muted-foreground">
                      Cria uma tarefa atribuída ao responsável identificado
                    </p>
                  </div>
                  <Switch
                    checked={config.create_crm_task}
                    onCheckedChange={(v) => setConfig((c) => ({ ...c, create_crm_task: v }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Exibir popup na tela</Label>
                    <p className="text-xs text-muted-foreground">
                      Mostra notificação popup com som quando alguém é mencionado
                    </p>
                  </div>
                  <Switch
                    checked={config.show_popup_alert}
                    onCheckedChange={(v) => setConfig((c) => ({ ...c, show_popup_alert: v }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Confiança mínima: {Math.round((config.min_confidence || 0.6) * 100)}%</Label>
                  <Slider
                    value={[config.min_confidence || 0.6]}
                    min={0.3}
                    max={1}
                    step={0.05}
                    onValueChange={([v]) => setConfig((c) => ({ ...c, min_confidence: v }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Quanto maior, mais preciso mas pode perder detecções sutis
                  </p>
                </div>

                {/* Notify matched member via WhatsApp */}
                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-primary" />
                    <Label className="font-medium">Notificar Responsável via WhatsApp</Label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Ativar notificação ao responsável</Label>
                      <p className="text-xs text-muted-foreground">
                        Quando a IA detecta uma solicitação, envia mensagem no WhatsApp pessoal do membro identificado
                      </p>
                    </div>
                    <Switch
                      checked={config.notify_members_whatsapp || false}
                      onCheckedChange={(v) => setConfig((c) => ({ ...c, notify_members_whatsapp: v }))}
                    />
                  </div>
                  {config.notify_members_whatsapp && (
                    <div className="flex items-center justify-between pl-6 py-2 border-l-2 border-primary/20 ml-2">
                      <div>
                        <Label className="text-sm">Notificações Individuais</Label>
                        <p className="text-xs text-muted-foreground">
                          Se desativado, o membro receberá apenas o resumo diário (se habilitado)
                        </p>
                      </div>
                      <Switch
                        checked={config.individual_notifications_enabled !== false}
                        onCheckedChange={(v) => setConfig((c) => ({ ...c, individual_notifications_enabled: v }))}
                      />
                    </div>
                  )}
                </div>

                {/* Default connection */}
                {(config.notify_members_whatsapp || config.notify_external_enabled) && (
                  <div className="border-t pt-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Wifi className="h-4 w-4 text-primary" />
                      <Label className="font-medium">Conexão Padrão para Notificações</Label>
                    </div>
                    <Select
                      value={config.default_connection_id || "auto"}
                      onValueChange={(v) => setConfig((c) => ({ ...c, default_connection_id: v === "auto" ? null : v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Automática (primeira disponível)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automática (primeira disponível)</SelectItem>
                        {(() => {
                          const merged = new Map<string, string>();
                          orgConnections.forEach((c) => merged.set(c.id, c.name));
                          allGroups.forEach((g) => {
                            if (!merged.has(g.connection_id)) merged.set(g.connection_id, g.connection_name);
                          });
                          return [...merged.entries()].map(([id, name]) => (
                            <SelectItem key={id} value={id}>{name}</SelectItem>
                          ));
                        })()}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Define qual conexão WhatsApp será usada para enviar as notificações
                    </p>
                  </div>
                )}

                {/* External notification */}
                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <BellRing className="h-4 w-4 text-primary" />
                    <Label className="font-medium">Notificação Externa (Número Fixo)</Label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Ativar notificação externa</Label>
                      <p className="text-xs text-muted-foreground">
                        Envia detecções para um número externo adicional (ex: gestor)
                      </p>
                    </div>
                    <Switch
                      checked={config.notify_external_enabled || false}
                      onCheckedChange={(v) => setConfig((c) => ({ ...c, notify_external_enabled: v }))}
                    />
                  </div>
                  {config.notify_external_enabled && (
                    <div className="flex items-center justify-between pl-6 py-2 border-l-2 border-primary/20 ml-2">
                      <div>
                        <Label className="text-sm">Notificações Individuais (Número Fixo)</Label>
                        <p className="text-xs text-muted-foreground">
                          Se desativado, este número receberá apenas o resumo diário (se habilitado)
                        </p>
                      </div>
                      <Switch
                        checked={config.individual_notifications_enabled !== false}
                        onCheckedChange={(v) => setConfig((c) => ({ ...c, individual_notifications_enabled: v }))}
                      />
                    </div>
                  )}
                  {config.notify_external_enabled && (
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        Número WhatsApp
                      </Label>
                      <Input
                        placeholder="5511999999999 (com DDI)"
                        value={config.notify_external_phone || ''}
                        onChange={(e) => setConfig((c) => ({ ...c, notify_external_phone: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">
                        Número completo com DDI. A cada detecção, um resumo será enviado além da notificação ao responsável.
                      </p>
                    </div>
                  )}
                </div>

                {/* Follow-up automático */}
                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-primary" />
                    <Label className="font-medium">Follow-up Automático</Label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Ativar follow-up</Label>
                      <p className="text-xs text-muted-foreground">
                        Envia lembrete ao responsável se a tarefa não for concluída
                      </p>
                    </div>
                    <Switch
                      checked={config.followup_enabled || false}
                      onCheckedChange={(v) => setConfig((c) => ({ ...c, followup_enabled: v }))}
                    />
                  </div>
                  {config.followup_enabled && (
                    <div className="space-y-1.5">
                      <Label>Horas para follow-up: {config.followup_hours || 4}h</Label>
                      <Slider
                        value={[config.followup_hours || 4]}
                        min={1} max={48} step={1}
                        onValueChange={([v]) => setConfig((c) => ({ ...c, followup_hours: v }))}
                      />
                    </div>
                  )}
                </div>

                {/* Resumo diário */}
                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Timer className="h-4 w-4 text-primary" />
                    <Label className="font-medium">Resumo Diário</Label>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Ativar resumo diário</Label>
                      <p className="text-xs text-muted-foreground">
                        Envia o resumo diário para o número externo e/ou para os responsáveis com WhatsApp cadastrado
                      </p>
                    </div>
                    <Switch
                      checked={config.daily_digest_enabled || false}
                      onCheckedChange={(v) => setConfig((c) => ({ ...c, daily_digest_enabled: v }))}
                    />
                  </div>
                  {config.daily_digest_enabled && (
                    <div className="space-y-1.5">
                      <Label>Horário do envio</Label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Select
                            value={String(config.daily_digest_hour ?? 8)}
                            onValueChange={(v) => setConfig((c) => ({ ...c, daily_digest_hour: parseInt(v) }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Hora" />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, i) => (
                                <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}h</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <span className="text-muted-foreground">:</span>
                        <div className="flex-1">
                          <Select
                            value={String(config.daily_digest_minute ?? 0)}
                            onValueChange={(v) => setConfig((c) => ({ ...c, daily_digest_minute: parseInt(v) }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Minuto" />
                            </SelectTrigger>
                            <SelectContent>
                              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                                <SelectItem key={m} value={String(m)}>{String(m).padStart(2, '0')}m</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}
                  {config.daily_digest_enabled && (
                    <div className="space-y-1.5 mt-2">
                      <Label>Tipo de Resumo</Label>
                      <Select
                        value={config.daily_digest_type || 'detailed'}
                        onValueChange={(v) => setConfig((c) => ({ ...c, daily_digest_type: v as 'detailed' | 'analytical' }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="detailed">Detalhado (Lista de itens)</SelectItem>
                          <SelectItem value="analytical">Analítico (Análise de tendências)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {config.daily_digest_type === 'analytical' 
                          ? "O resumo analítico foca em padrões e volume de solicitações." 
                          : "O resumo detalhado lista cada solicitação detectada individualmente."}
                      </p>
                    </div>
                  )}
                  <div className="pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={async () => {
                        try {
                          toast.loading("Gerando relatório...", { id: "manual-digest" });
                          const result = await sendDigestNow();
                          toast.success(`Relatório enviado! (${result.sent} envio${result.sent === 1 ? '' : 's'})`, { id: "manual-digest" });
                        } catch (err: any) {
                          toast.error(err.message || "Erro ao gerar relatório", { id: "manual-digest" });
                        }
                      }}
                    >
                      Gerar relatório agora
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">
                      Envia um resumo das últimas 24h imediatamente para os destinatários configurados.
                    </p>
                  </div>
                </div>

                {/* Números excluídos */}
                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <UserX className="h-4 w-4 text-primary" />
                    <Label className="font-medium">Números Excluídos (Equipe)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mensagens enviadas por esses números serão ignoradas pela IA. Use para números da sua equipe que cobram respostas de clientes nos grupos.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="5511999999999 (com DDI)"
                      value={newExcludedNumber}
                      onChange={(e) => setNewExcludedNumber(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const phone = newExcludedNumber.trim().replace(/\D/g, '');
                          if (phone.length >= 8 && !(config.excluded_senders || []).includes(phone)) {
                            setConfig(c => ({ ...c, excluded_senders: [...(c.excluded_senders || []), phone] }));
                            setNewExcludedNumber("");
                          }
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const phone = newExcludedNumber.trim().replace(/\D/g, '');
                        if (phone.length >= 8 && !(config.excluded_senders || []).includes(phone)) {
                          setConfig(c => ({ ...c, excluded_senders: [...(c.excluded_senders || []), phone] }));
                          setNewExcludedNumber("");
                        } else if (phone.length < 8) {
                          toast.error("Número inválido. Informe com DDI (ex: 5511999999999)");
                        }
                      }}
                      className="gap-1 flex-shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar
                    </Button>
                  </div>
                  {(config.excluded_senders || []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(config.excluded_senders || []).map((phone, i) => (
                        <Badge key={i} variant="secondary" className="gap-1 text-xs font-mono pr-1">
                          <Phone className="h-3 w-3" />
                          {phone}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 ml-1 hover:bg-destructive/20"
                            onClick={() => {
                              setConfig(c => ({
                                ...c,
                                excluded_senders: (c.excluded_senders || []).filter((_, idx) => idx !== i),
                              }));
                            }}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuração de IA</CardTitle>
                <CardDescription>
                  Deixe vazio para usar a IA configurada na organização
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Provedor</Label>
                    <Select
                      value={config.ai_provider || "default"}
                      onValueChange={(v) =>
                        setConfig((c) => ({ ...c, ai_provider: v === "default" ? null : v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Padrão da organização" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Padrão da organização</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="gemini">Gemini</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Modelo</Label>
                    <Select
                      value={config.ai_model || "default"}
                      onValueChange={(v) => setConfig((c) => ({ ...c, ai_model: v === "default" ? null : v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Padrão da organização" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Padrão da organização</SelectItem>
                        {(config.ai_provider === 'openai' || (!config.ai_provider || config.ai_provider === 'default')) && (
                          <>
                            <SelectItem value="gpt-4o">GPT-4o (Recomendado)</SelectItem>
                            <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                            <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                          </>
                        )}
                        {(config.ai_provider === 'gemini' || (!config.ai_provider || config.ai_provider === 'default')) && (
                          <>
                            <SelectItem value="gemini-1.5-flash">Gemini 1.5 Flash (Recomendado)</SelectItem>
                            <SelectItem value="gemini-1.5-pro">Gemini 1.5 Pro</SelectItem>
                            <SelectItem value="gemini-2.0-flash">Gemini 2.0 Flash</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {config.ai_provider && config.ai_provider !== "default" && (
                  <div className="space-y-1.5">
                    <Label>API Key (específica)</Label>
                    <Input
                      type="password"
                      value={config.ai_api_key || ""}
                      onChange={(e) => setConfig((c) => ({ ...c, ai_api_key: e.target.value || null }))}
                      placeholder="sk-..."
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            <Button onClick={handleSaveConfig} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar Configurações
            </Button>
          </TabsContent>

          {/* STATS TAB */}
          <TabsContent value="stats" className="space-y-4">
            {!stats ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Nenhuma estatística disponível ainda</p>
              </CardContent></Card>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card><CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{stats.overall.total}</p>
                    <p className="text-xs text-muted-foreground">Detecções (7d)</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{stats.overall.matched}</p>
                    <p className="text-xs text-muted-foreground">Com responsável</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-destructive">{stats.overall.urgent}</p>
                    <p className="text-xs text-muted-foreground">Urgentes</p>
                  </CardContent></Card>
                  <Card><CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{stats.overall.avg_processing_ms}ms</p>
                    <p className="text-xs text-muted-foreground">Tempo médio</p>
                  </CardContent></Card>
                </div>

                {stats.daily && stats.daily.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Evolução Diária</CardTitle>
                      <CardDescription>Detecções e solicitações prioritárias nos últimos 7 dias</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={stats.daily.map(d => ({
                            date: new Date(d.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                            total: parseInt(d.count),
                            prioritarias: parseInt(d.priority_count),
                          }))}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                            <XAxis dataKey="date" className="text-xs fill-muted-foreground" tick={{ fontSize: 12 }} />
                            <YAxis allowDecimals={false} className="text-xs fill-muted-foreground" tick={{ fontSize: 12 }} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--background))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                                fontSize: '12px',
                              }}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line
                              type="monotone"
                              dataKey="total"
                              name="Total"
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              dot={{ r: 4, fill: 'hsl(var(--primary))' }}
                              activeDot={{ r: 6 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="prioritarias"
                              name="Prioritárias"
                              stroke="hsl(var(--destructive))"
                              strokeWidth={2}
                              dot={{ r: 4, fill: 'hsl(var(--destructive))' }}
                              activeDot={{ r: 6 }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader><CardTitle className="text-base">Carga por Membro</CardTitle></CardHeader>
                  <CardContent>
                    {stats.members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sem dados no período</p>
                    ) : (
                      <div className="space-y-3">
                        {stats.members.map((m) => {
                          const pending = stats.pending_tasks.find(p => p.assigned_to === m.matched_user_id);
                          return (
                            <div key={m.matched_user_id} className="flex items-center justify-between p-2 rounded-md border">
                              <div>
                                <span className="font-medium text-sm">{m.matched_user_name}</span>
                                <div className="flex gap-2 mt-0.5">
                                  <Badge variant="secondary" className="text-xs">{m.total_requests} solicitações</Badge>
                                  {parseInt(m.urgent_count) > 0 && <Badge variant="destructive" className="text-xs">{m.urgent_count} urgentes</Badge>}
                                  {pending && <Badge variant="outline" className="text-xs">⏳ {pending.pending_count} pendentes</Badge>}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="w-24 bg-muted rounded-full h-2">
                                  <div
                                    className="bg-primary rounded-full h-2"
                                    style={{ width: `${Math.min(100, (parseInt(m.total_requests) / Math.max(1, parseInt(stats.members[0]?.total_requests || '1'))) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* LOGS TAB */}
          <TabsContent value="logs" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Últimas detecções da secretária IA
            </p>

            {logs.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Nenhuma detecção registrada</p>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {logs.map((log) => (
                    <Card key={log.id}>
                      <CardContent className="p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Shield className="h-3.5 w-3.5 text-primary" />
                            <span className="text-sm font-medium">
                              {log.detected_request || "Sem descrição"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(log.created_at), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground pl-5 space-y-0.5">
                          <p>
                            <strong>Grupo:</strong> {log.group_name || "—"} •{" "}
                            <strong>De:</strong> {log.sender_name || "—"}
                          </p>
                          <p>
                            <strong>Responsável:</strong>{" "}
                            {log.matched_user_name || "Não identificado"} •{" "}
                            <strong>Confiança:</strong>{" "}
                            {Math.round((log.confidence || 0) * 100)}%
                          </p>
                          {log.message_content && (
                            <p className="italic truncate max-w-md">
                              "{log.message_content}"
                            </p>
                          )}
                          <div className="flex gap-2 mt-1">
                            {log.crm_task_id && (
                              <Badge variant="outline" className="text-xs">
                                Tarefa CRM criada
                              </Badge>
                            )}
                            {log.alert_id && (
                              <Badge variant="outline" className="text-xs">
                                Popup enviado
                              </Badge>
                            )}
                            {log.processing_time_ms && (
                              <Badge variant="secondary" className="text-xs">
                                {log.processing_time_ms}ms
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* MEETING MINUTES TAB */}
          <TabsContent value="minutes" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Gerar Ata de Reunião
                </CardTitle>
                <CardDescription>
                  Selecione um grupo e o período para gerar uma ata automática com decisões e responsáveis
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Grupo</Label>
                    <Select value={selectedMinutesGroup} onValueChange={setSelectedMinutesGroup}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o grupo..." />
                      </SelectTrigger>
                      <SelectContent>
                        {allGroups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.group_name || g.remote_jid} ({g.connection_name})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Período (horas)</Label>
                    <Select value={minutesHours} onValueChange={setMinutesHours}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">Últimas 6h</SelectItem>
                        <SelectItem value="12">Últimas 12h</SelectItem>
                        <SelectItem value="24">Últimas 24h</SelectItem>
                        <SelectItem value="48">Últimas 48h</SelectItem>
                        <SelectItem value="72">Últimas 72h</SelectItem>
                        <SelectItem value="168">Última semana</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  disabled={!selectedMinutesGroup || generatingMinutes}
                  onClick={async () => {
                    setGeneratingMinutes(true);
                    try {
                      const result = await generateMeetingMinutes(selectedMinutesGroup, parseInt(minutesHours));
                      setMeetingMinutes((prev) => [result, ...prev]);
                      toast.success("Ata gerada com sucesso!");
                    } catch (err: any) {
                      toast.error(err.message || "Erro ao gerar ata");
                    } finally {
                      setGeneratingMinutes(false);
                    }
                  }}
                  className="gap-2"
                >
                  {generatingMinutes ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {generatingMinutes ? "Analisando mensagens..." : "Gerar Ata"}
                </Button>
              </CardContent>
            </Card>

            {meetingMinutes.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Nenhuma ata gerada ainda</p>
                  <p className="text-xs mt-1">Selecione um grupo acima e clique em "Gerar Ata"</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {meetingMinutes.map((minute) => {
                  const isExpanded = expandedMinutes === minute.id;
                  const decisions = Array.isArray(minute.decisions) ? minute.decisions : [];
                  const actionItems = Array.isArray(minute.action_items) ? minute.action_items : [];

                  return (
                    <Card key={minute.id}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => setExpandedMinutes(isExpanded ? null : minute.id)}
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-primary shrink-0" />
                              <span className="font-medium text-sm">{minute.title}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground pl-6">
                              <span className="flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" />
                                {minute.group_name}
                              </span>
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                {format(new Date(minute.created_at), "dd/MM/yyyy HH:mm")}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {minute.message_count} msgs
                              </Badge>
                              {decisions.length > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  {decisions.length} decisões
                                </Badge>
                              )}
                              {actionItems.length > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  {actionItems.length} ações
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setExpandedMinutes(isExpanded ? null : minute.id)}
                            >
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={async () => {
                                try {
                                  await deleteMeetingMinutes(minute.id);
                                  setMeetingMinutes((prev) => prev.filter((m) => m.id !== minute.id));
                                  toast.success("Ata excluída");
                                } catch (err: any) {
                                  toast.error(err.message || "Erro ao excluir");
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="pl-6 space-y-4 border-t pt-3">
                            {/* Summary */}
                            <div>
                              <h4 className="text-sm font-medium mb-1">📋 Resumo</h4>
                              <p className="text-sm text-muted-foreground whitespace-pre-line">{minute.summary}</p>
                            </div>

                            {/* Participants */}
                            {minute.participants?.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium mb-1">👥 Participantes</h4>
                                <div className="flex flex-wrap gap-1">
                                  {minute.participants.map((p, i) => (
                                    <Badge key={i} variant="secondary" className="text-xs">{p}</Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Decisions */}
                            {decisions.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium mb-1">✅ Decisões</h4>
                                <ul className="space-y-1">
                                  {decisions.map((d, i) => (
                                    <li key={i} className="text-sm flex items-start gap-2">
                                      <span className="text-primary mt-0.5">•</span>
                                      <span>
                                        {d.description}
                                        {d.responsible && (
                                          <Badge variant="outline" className="ml-2 text-xs">{d.responsible}</Badge>
                                        )}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Action Items */}
                            {actionItems.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium mb-1">🎯 Itens de Ação</h4>
                                <div className="space-y-2">
                                  {actionItems.map((item, i) => (
                                    <div key={i} className="flex items-start gap-2 text-sm p-2 rounded-md border">
                                      <span className="text-primary font-medium">{i + 1}.</span>
                                      <div className="flex-1">
                                        <p>{item.task}</p>
                                        <div className="flex gap-2 mt-1">
                                          {item.responsible && (
                                            <Badge variant="secondary" className="text-xs">
                                              👤 {item.responsible}
                                            </Badge>
                                          )}
                                          {item.deadline && (
                                            <Badge variant="outline" className="text-xs">
                                              📅 {item.deadline}
                                            </Badge>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Meta */}
                            <div className="text-xs text-muted-foreground border-t pt-2 flex gap-4">
                              {minute.generated_by_name && <span>Gerado por: {minute.generated_by_name}</span>}
                              {minute.period_start && minute.period_end && (
                                <span>
                                  Período: {format(new Date(minute.period_start), "dd/MM HH:mm")} — {format(new Date(minute.period_end), "dd/MM HH:mm")}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* DIAGNOSTIC / AUDIT TAB */}
          <TabsContent value="diagnostic" className="space-y-4">
            <SecretaryDiagnosticPanel />
          </TabsContent>
        </Tabs>

        {/* ADD MEMBER DIALOG */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Membro</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Usuário</Label>
                <Select
                  value={newMember.user_id}
                  onValueChange={(v) => setNewMember((p) => ({ ...p, user_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers
                      .filter((u) => !members.some((m) => m.user_id === u.id))
                      .map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Apelidos (separados por vírgula)</Label>
                <Input
                  value={newMember.aliases}
                  onChange={(e) => setNewMember((p) => ({ ...p, aliases: e.target.value }))}
                  placeholder="Ex: João, Joãozinho, JM"
                />
                <p className="text-xs text-muted-foreground">
                  Nomes pelos quais a pessoa é chamada nos grupos
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Áreas/Departamentos (separados por vírgula)</Label>
                <Input
                  value={newMember.departments}
                  onChange={(e) => setNewMember((p) => ({ ...p, departments: e.target.value }))}
                  placeholder="Ex: Financeiro, Vendas, Suporte"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição do cargo</Label>
                <Textarea
                  value={newMember.role_description}
                  onChange={(e) => setNewMember((p) => ({ ...p, role_description: e.target.value }))}
                  placeholder="Ex: Responsável pelo financeiro e cobranças"
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddMember}>Adicionar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* EDIT PHONE DIALOG */}
        <Dialog open={phoneDialogOpen} onOpenChange={setPhoneDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Cadastrar WhatsApp
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Informe o número WhatsApp de <strong>{editingPhoneMember?.user_name}</strong> para receber notificações da Secretária IA.
              </p>
              <div className="space-y-1.5">
                <Label>Número WhatsApp</Label>
                <Input
                  value={editingPhone}
                  onChange={(e) => setEditingPhone(e.target.value)}
                  placeholder="5511999999999 (com DDI)"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPhoneDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSavePhone}>Salvar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}

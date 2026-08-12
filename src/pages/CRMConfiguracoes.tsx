import { useState } from "react";
import { api } from "@/lib/api";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useCRMTaskTypes,
  useCRMTaskTypeMutations,
  useCRMSegments,
  useCRMSegmentMutations,
  useCRMCustomFields,
  useCRMCustomFieldMutations,
  useCRMLossReasons,
  useCRMLossReasonMutations,
  CRMTaskType,
  CRMSegment,
  CRMCustomField,
  CRMLossReason,
} from "@/hooks/use-crm-config";
import { useCRMGroups, useCRMGroupMembers, useCRMGroupMutations, useCRMFunnels, useCRMFunnel, useCRMFunnelMutations, useCRMGroupFunnels, useCRMGroupFunnelMutations, CRMFunnel } from "@/hooks/use-crm";
import { FunnelEditorDialog } from "@/components/crm/FunnelEditorDialog";
import { GoogleCalendarPanel } from "@/components/crm/GoogleCalendarPanel";
import { LeadScoringConfigPanel } from "@/components/crm/LeadScoringConfigPanel";

import {
  Plus,
  Edit,
  Trash2,
  Settings,
  Tag,
  CheckSquare,
  Users,
  FormInput,
  Loader2,
  Phone,
  Mail,
  Calendar,
  MessageCircle,
  Repeat,
  Globe,
  Building2,
  XCircle,
  GitBranch,
  Link2,
  Flame,
} from "lucide-react";

const ICON_OPTIONS = [
  { value: "check-square", label: "Tarefa", icon: CheckSquare },
  { value: "phone", label: "Telefone", icon: Phone },
  { value: "mail", label: "E-mail", icon: Mail },
  { value: "calendar", label: "Calendário", icon: Calendar },
  { value: "message-circle", label: "WhatsApp", icon: MessageCircle },
  { value: "repeat", label: "Follow-up", icon: Repeat },
  { value: "users", label: "Reunião", icon: Users },
];

const COLOR_OPTIONS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", 
  "#22c55e", "#25d366", "#14b8a6", "#06b6d4", "#3b82f6",
];

const FIELD_TYPES = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "boolean", label: "Sim/Não" },
  { value: "select", label: "Seleção única" },
  { value: "multiselect", label: "Seleção múltipla" },
];

const ENTITY_TYPES = [
  { value: "deal", label: "Negociação" },
  { value: "company", label: "Empresa" },
  { value: "task", label: "Tarefa" },
];

function getIconComponent(iconName: string) {
  const found = ICON_OPTIONS.find((i) => i.value === iconName);
  return found ? found.icon : CheckSquare;
}

export default function CRMConfiguracoes() {
  const [activeTab, setActiveTab] = useState("funnels");
  
  // Task Types
  const { data: taskTypes, isLoading: loadingTaskTypes } = useCRMTaskTypes();
  const { createTaskType, updateTaskType, deleteTaskType, cleanupDuplicates } = useCRMTaskTypeMutations();
  const [taskTypeDialog, setTaskTypeDialog] = useState(false);
  const [editingTaskType, setEditingTaskType] = useState<CRMTaskType | null>(null);
  const [taskTypeForm, setTaskTypeForm] = useState({ name: "", icon: "check-square", color: "#6366f1" });

  // Segments
  const { data: segments, isLoading: loadingSegments } = useCRMSegments();
  const { createSegment, updateSegment, deleteSegment } = useCRMSegmentMutations();
  const [segmentDialog, setSegmentDialog] = useState(false);
  const [editingSegment, setEditingSegment] = useState<CRMSegment | null>(null);
  const [segmentForm, setSegmentForm] = useState({ name: "", color: "#6366f1", description: "" });

  // Groups
  const { data: groups, isLoading: loadingGroups } = useCRMGroups();
  const { createGroup, updateGroup, deleteGroup, addMember, removeMember } = useCRMGroupMutations();
  const [groupDialog, setGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [groupForm, setGroupForm] = useState({ name: "", description: "" });
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const { data: groupMembers } = useCRMGroupMembers(selectedGroupId);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [orgMembers, setOrgMembers] = useState<Array<{ user_id: string; name: string; email: string }>>([]);
  const [loadingOrgMembers, setLoadingOrgMembers] = useState(false);

  // Group Funnels
  const [funnelAssignGroupId, setFunnelAssignGroupId] = useState<string | null>(null);
  const [funnelAssignDialogOpen, setFunnelAssignDialogOpen] = useState(false);
  const { data: groupFunnels } = useCRMGroupFunnels(funnelAssignGroupId);
  const { setGroupFunnels } = useCRMGroupFunnelMutations();
  

  // Custom Fields
  const { data: customFields, isLoading: loadingFields } = useCRMCustomFields();
  const { createCustomField, updateCustomField, deleteCustomField } = useCRMCustomFieldMutations();
  const [fieldDialog, setFieldDialog] = useState(false);
  const [editingField, setEditingField] = useState<CRMCustomField | null>(null);
  const [fieldForm, setFieldForm] = useState<{
    entity_type: 'deal' | 'company' | 'task';
    field_name: string;
    field_label: string;
    field_type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean';
    is_required: boolean;
    options: string[];
  }>({
    entity_type: "deal",
    field_name: "",
    field_label: "",
    field_type: "text",
    is_required: false,
    options: [],
  });
  const [optionInput, setOptionInput] = useState("");

  // Loss Reasons
  const { data: lossReasons, isLoading: loadingLossReasons } = useCRMLossReasons();
  const { createLossReason, updateLossReason, deleteLossReason, resetToDefaults, cleanupDuplicates: cleanupLossReasonDuplicates } = useCRMLossReasonMutations();
  const [lossReasonDialog, setLossReasonDialog] = useState(false);
  const [editingLossReason, setEditingLossReason] = useState<CRMLossReason | null>(null);
  const [lossReasonForm, setLossReasonForm] = useState({ name: "", description: "" });

  const hasLossReasonDuplicates = (() => {
    if (!lossReasons?.length) return false;
    const seen = new Set<string>();
    for (const r of lossReasons) {
      const key = `${r.organization_id ?? 'global'}::${String(r.name || '').trim().toLowerCase()}`;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  })();

  // Funnels
  const { data: funnels, isLoading: loadingFunnels } = useCRMFunnels();
  const { deleteFunnel } = useCRMFunnelMutations();
  const [funnelEditorOpen, setFunnelEditorOpen] = useState(false);
  const [editingFunnelId, setEditingFunnelId] = useState<string | null>(null);
  const { data: editingFunnelData } = useCRMFunnel(editingFunnelId);

  // Loss Reason handlers
  const openLossReasonDialog = (reason?: CRMLossReason) => {
    if (reason) {
      setEditingLossReason(reason);
      setLossReasonForm({ name: reason.name, description: reason.description || "" });
    } else {
      setEditingLossReason(null);
      setLossReasonForm({ name: "", description: "" });
    }
    setLossReasonDialog(true);
  };

  const saveLossReason = () => {
    if (!lossReasonForm.name.trim()) return;
    // Prevent double submission
    if (createLossReason.isPending || updateLossReason.isPending) return;
    
    if (editingLossReason) {
      updateLossReason.mutate({ id: editingLossReason.id, ...lossReasonForm }, {
        onSuccess: () => setLossReasonDialog(false)
      });
    } else {
      createLossReason.mutate(lossReasonForm, {
        onSuccess: () => setLossReasonDialog(false)
      });
    }
  };

  // Funnel handlers
  const openFunnelEditor = (funnel?: CRMFunnel) => {
    if (funnel) {
      setEditingFunnelId(funnel.id);
    } else {
      setEditingFunnelId(null);
    }
    setFunnelEditorOpen(true);
  };

  const handleDeleteFunnel = (id: string) => {
    if (confirm("Excluir este funil e todas as suas etapas?")) {
      deleteFunnel.mutate(id);
    }
  };

  // Members list is not needed here, removing unused code

  // Task Type handlers
  const openTaskTypeDialog = (taskType?: CRMTaskType) => {
    if (taskType) {
      setEditingTaskType(taskType);
      setTaskTypeForm({ name: taskType.name, icon: taskType.icon, color: taskType.color });
    } else {
      setEditingTaskType(null);
      setTaskTypeForm({ name: "", icon: "check-square", color: "#6366f1" });
    }
    setTaskTypeDialog(true);
  };

  const saveTaskType = () => {
    if (!taskTypeForm.name.trim()) return;
    if (editingTaskType) {
      updateTaskType.mutate({ id: editingTaskType.id, ...taskTypeForm });
    } else {
      createTaskType.mutate(taskTypeForm);
    }
    setTaskTypeDialog(false);
  };

  // Segment handlers
  const openSegmentDialog = (segment?: CRMSegment) => {
    if (segment) {
      setEditingSegment(segment);
      setSegmentForm({ name: segment.name, color: segment.color, description: segment.description || "" });
    } else {
      setEditingSegment(null);
      setSegmentForm({ name: "", color: "#6366f1", description: "" });
    }
    setSegmentDialog(true);
  };

  const saveSegment = () => {
    if (!segmentForm.name.trim()) return;
    if (editingSegment) {
      updateSegment.mutate({ id: editingSegment.id, ...segmentForm });
    } else {
      createSegment.mutate(segmentForm);
    }
    setSegmentDialog(false);
  };

  // Group handlers
  const openGroupDialog = (group?: any) => {
    if (group) {
      setEditingGroup(group);
      setGroupForm({ name: group.name, description: group.description || "" });
    } else {
      setEditingGroup(null);
      setGroupForm({ name: "", description: "" });
    }
    setGroupDialog(true);
  };

  const saveGroup = () => {
    if (!groupForm.name.trim()) return;
    if (editingGroup) {
      updateGroup.mutate({ id: editingGroup.id, ...groupForm });
    } else {
      createGroup.mutate(groupForm);
    }
    setGroupDialog(false);
  };

  const openMembersDialog = async (group: any) => {
    setSelectedGroupId(group.id);
    setEditingGroup(group);
    setMembersDialogOpen(true);
    
    // Load org members
    setLoadingOrgMembers(true);
    try {
      const orgs = await api<any[]>('/api/organizations');
      if (orgs.length > 0) {
        const members = await api<any[]>(`/api/organizations/${orgs[0].id}/members`);
        setOrgMembers(members);
      }
    } catch (error) {
      console.error('Error loading org members:', error);
    } finally {
      setLoadingOrgMembers(false);
    }
  };

  const handleAddMember = (userId: string, isSupervisor: boolean = false) => {
    if (!selectedGroupId) return;
    addMember.mutate({ groupId: selectedGroupId, userId, isSupervisor });
  };

  const handleRemoveMember = (userId: string) => {
    if (!selectedGroupId) return;
    removeMember.mutate({ groupId: selectedGroupId, userId });
  };

  // Group Funnel Assignment handlers
  const openFunnelAssignDialog = (group: any) => {
    setFunnelAssignGroupId(group.id);
    setEditingGroup(group);
    setFunnelAssignDialogOpen(true);
  };

  // Custom Field handlers
  const openFieldDialog = (field?: CRMCustomField) => {
    if (field) {
      setEditingField(field);
      setFieldForm({
        entity_type: field.entity_type,
        field_name: field.field_name,
        field_label: field.field_label,
        field_type: field.field_type,
        is_required: field.is_required,
        options: field.options || [],
      });
    } else {
      setEditingField(null);
      setFieldForm({
        entity_type: "deal",
        field_name: "",
        field_label: "",
        field_type: "text",
        is_required: false,
        options: [],
      });
    }
    setFieldDialog(true);
  };

  const saveField = () => {
    if (!fieldForm.field_label.trim()) return;
    const fieldName = fieldForm.field_name || fieldForm.field_label.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const data = {
      ...fieldForm,
      field_name: fieldName,
      options: ["select", "multiselect"].includes(fieldForm.field_type) ? fieldForm.options : undefined,
    };
    if (editingField) {
      updateCustomField.mutate({ id: editingField.id, ...data });
    } else {
      createCustomField.mutate(data);
    }
    setFieldDialog(false);
  };

  const addOption = () => {
    if (optionInput.trim() && !fieldForm.options.includes(optionInput.trim())) {
      setFieldForm({ ...fieldForm, options: [...fieldForm.options, optionInput.trim()] });
      setOptionInput("");
    }
  };

  const removeOption = (opt: string) => {
    setFieldForm({ ...fieldForm, options: fieldForm.options.filter((o) => o !== opt) });
  };

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Configurações do CRM
          </h1>
          <p className="text-muted-foreground">
            Configure tipos de tarefa, segmentos, grupos e campos personalizados
          </p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-8 w-full max-w-6xl">
            <TabsTrigger value="funnels" className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <span className="hidden sm:inline">Funis</span>
            </TabsTrigger>
            <TabsTrigger value="lead-scoring" className="flex items-center gap-2">
              <Flame className="h-4 w-4" />
              <span className="hidden sm:inline">Scoring</span>
            </TabsTrigger>
            <TabsTrigger value="task-types" className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Tarefas</span>
            </TabsTrigger>
            <TabsTrigger value="segments" className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              <span className="hidden sm:inline">Segmentos</span>
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Grupos</span>
            </TabsTrigger>
            <TabsTrigger value="loss-reasons" className="flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Perdas</span>
            </TabsTrigger>
            <TabsTrigger value="custom-fields" className="flex items-center gap-2">
              <FormInput className="h-4 w-4" />
              <span className="hidden sm:inline">Campos</span>
            </TabsTrigger>
            <TabsTrigger value="integrations" className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              <span className="hidden sm:inline">Integrações</span>
            </TabsTrigger>
          </TabsList>

          {/* Funnels Tab */}
          <TabsContent value="funnels" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Funis de Vendas</CardTitle>
                  <CardDescription>
                    Configure os funis e etapas do seu processo de vendas
                  </CardDescription>
                </div>
                <Button onClick={() => openFunnelEditor()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Funil
                </Button>
              </CardHeader>
              <CardContent>
                {loadingFunnels ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Funil</TableHead>
                        <TableHead>Etapas</TableHead>
                        <TableHead>Negociações</TableHead>
                        <TableHead>Valor Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[100px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {funnels?.map((funnel) => (
                        <TableRow key={funnel.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: funnel.color }}
                              />
                              <div>
                                <p className="font-medium">{funnel.name}</p>
                                {funnel.description && (
                                  <p className="text-xs text-muted-foreground">{funnel.description}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {funnel.stages?.length || 0} etapas
                            </Badge>
                          </TableCell>
                          <TableCell>{funnel.open_deals || 0}</TableCell>
                          <TableCell>
                            R$ {(funnel.total_value || 0).toLocaleString("pt-BR")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={funnel.is_active ? "default" : "secondary"}>
                              {funnel.is_active ? "Ativo" : "Inativo"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openFunnelEditor(funnel)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleDeleteFunnel(funnel.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {(!funnels || funnels.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            Nenhum funil cadastrado. Crie seu primeiro funil de vendas.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Lead Scoring Tab */}
          <TabsContent value="lead-scoring" className="mt-6">
            <LeadScoringConfigPanel />
          </TabsContent>

          {/* Task Types Tab */}
          <TabsContent value="task-types" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Tipos de Tarefa</CardTitle>
                  <CardDescription>
                    Configure os tipos de tarefas disponíveis (Ligação, WhatsApp, Reunião, etc.)
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {taskTypes && taskTypes.filter(t => t.is_global && t.name === 'Tarefa').length > 1 && (
                    <Button 
                      variant="outline" 
                      onClick={() => cleanupDuplicates.mutate()}
                      disabled={cleanupDuplicates.isPending}
                    >
                      {cleanupDuplicates.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      Limpar Duplicados
                    </Button>
                  )}
                  <Button onClick={() => openTaskTypeDialog()}>
                    <Plus className="h-4 w-4 mr-2" />
                    Novo Tipo
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingTaskTypes ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[100px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {taskTypes?.map((type) => {
                        const IconComp = getIconComponent(type.icon);
                        return (
                          <TableRow key={type.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                                  style={{ backgroundColor: type.color + "20", color: type.color }}
                                >
                                  <IconComp className="h-4 w-4" />
                                </div>
                                <span className="font-medium">{type.name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {type.is_global ? (
                                <Badge variant="secondary">
                                  <Globe className="h-3 w-3 mr-1" />
                                  Global
                                </Badge>
                              ) : (
                                <Badge variant="outline">
                                  <Building2 className="h-3 w-3 mr-1" />
                                  Personalizado
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Switch checked={type.is_active} disabled={type.is_global} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openTaskTypeDialog(type)}
                                  disabled={type.is_global}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deleteTaskType.mutate(type.id)}
                                  disabled={type.is_global}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Segments Tab */}
          <TabsContent value="segments" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Segmentos</CardTitle>
                  <CardDescription>
                    Crie segmentos para categorizar suas negociações (Premium, B2B, Enterprise, etc.)
                  </CardDescription>
                </div>
                <Button onClick={() => openSegmentDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Segmento
                </Button>
              </CardHeader>
              <CardContent>
                {loadingSegments ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : !segments?.length ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Tag className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum segmento cadastrado</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {segments.map((segment) => (
                      <Card key={segment.id} className="relative overflow-hidden">
                        <div
                          className="absolute top-0 left-0 w-1 h-full"
                          style={{ backgroundColor: segment.color }}
                        />
                        <CardContent className="p-4 pl-6">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-medium">{segment.name}</h3>
                              {segment.description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {segment.description}
                                </p>
                              )}
                              <Badge variant="secondary" className="mt-2">
                                {segment.deals_count || 0} negociações
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openSegmentDialog(segment)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteSegment.mutate(segment.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Groups Tab */}
          <TabsContent value="groups" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Grupos CRM</CardTitle>
                  <CardDescription>
                    Organize usuários em grupos para controle de visibilidade e responsabilidades
                  </CardDescription>
                </div>
                <Button onClick={() => openGroupDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Grupo
                </Button>
              </CardHeader>
              <CardContent>
                {loadingGroups ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : !groups?.length ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum grupo cadastrado</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Grupo</TableHead>
                        <TableHead>Membros</TableHead>
                        <TableHead>Funis</TableHead>
                        <TableHead className="w-[140px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map((group) => (
                        <TableRow key={group.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{group.name}</p>
                              {group.description && (
                                <p className="text-sm text-muted-foreground">{group.description}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{group.member_count} membros</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="cursor-pointer" onClick={() => openFunnelAssignDialog(group)}>
                              <GitBranch className="h-3 w-3 mr-1" />
                              Configurar
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openFunnelAssignDialog(group)}
                                title="Gerenciar funis"
                              >
                                <GitBranch className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openMembersDialog(group)}
                                title="Gerenciar membros"
                              >
                                <Users className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openGroupDialog(group)}
                                title="Editar grupo"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteGroup.mutate(group.id)}
                                className="text-destructive hover:text-destructive"
                                title="Excluir grupo"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Loss Reasons Tab */}
          <TabsContent value="loss-reasons" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Motivos de Perda</CardTitle>
                  <CardDescription>
                    Configure os motivos que serão selecionados ao marcar uma negociação como perdida
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {hasLossReasonDuplicates && (
                    <Button
                      variant="outline"
                      onClick={() => cleanupLossReasonDuplicates.mutate()}
                      disabled={cleanupLossReasonDuplicates.isPending}
                    >
                      {cleanupLossReasonDuplicates.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      Limpar Duplicados
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      if (confirm('Isso irá apagar todos os motivos atuais e criar os padrões. Continuar?')) {
                        resetToDefaults.mutate();
                      }
                    }}
                    disabled={resetToDefaults.isPending}
                  >
                    {resetToDefaults.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Resetar Padrões
                  </Button>
                  <Button onClick={() => openLossReasonDialog()}>
                    <Plus className="h-4 w-4 mr-2" />
                    Novo Motivo
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingLossReasons ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : !lossReasons?.length ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <XCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum motivo de perda cadastrado</p>
                    <p className="text-sm mt-2">
                      Adicione motivos para que os usuários possam categorizar as negociações perdidas
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[100px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lossReasons.map((reason) => (
                        <TableRow key={reason.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <XCircle className="h-4 w-4 text-red-500" />
                              <span className="font-medium">{reason.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-muted-foreground text-sm">
                              {reason.description || "-"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={reason.is_active}
                              onCheckedChange={(checked) => 
                                updateLossReason.mutate({ id: reason.id, is_active: checked })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openLossReasonDialog(reason)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteLossReason.mutate(reason.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Custom Fields Tab */}
          <TabsContent value="custom-fields" className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Campos Personalizados</CardTitle>
                  <CardDescription>
                    Adicione campos extras para negociações, empresas e tarefas
                  </CardDescription>
                </div>
                <Button onClick={() => openFieldDialog()}>
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Campo
                </Button>
              </CardHeader>
              <CardContent>
                {loadingFields ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : !customFields?.length ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FormInput className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Nenhum campo personalizado cadastrado</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Campo</TableHead>
                        <TableHead>Entidade</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Obrigatório</TableHead>
                        <TableHead className="w-[100px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customFields.map((field) => (
                        <TableRow key={field.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{field.field_label}</p>
                              <p className="text-xs text-muted-foreground font-mono">{field.field_name}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {ENTITY_TYPES.find((e) => e.value === field.entity_type)?.label || field.entity_type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {FIELD_TYPES.find((t) => t.value === field.field_type)?.label || field.field_type}
                          </TableCell>
                          <TableCell>
                            <Switch checked={field.is_required} disabled />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openFieldDialog(field)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => deleteCustomField.mutate(field.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Integrations Tab */}
          <TabsContent value="integrations" className="mt-6">
            <div className="space-y-6">
              <GoogleCalendarPanel />
              
              {/* Placeholder for future integrations */}
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                  <Link2 className="h-12 w-12 text-muted-foreground/50 mb-3" />
                  <h3 className="font-medium text-muted-foreground">Mais integrações em breve</h3>
                  <p className="text-sm text-muted-foreground/70 mt-1">
                    Microsoft Outlook, Zoom, Google Meet e outros
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Task Type Dialog */}
      <Dialog open={taskTypeDialog} onOpenChange={setTaskTypeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTaskType ? "Editar" : "Novo"} Tipo de Tarefa</DialogTitle>
            <DialogDescription>
              Configure o nome, ícone e cor do tipo de tarefa
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={taskTypeForm.name}
                onChange={(e) => setTaskTypeForm({ ...taskTypeForm, name: e.target.value })}
                placeholder="Ex: WhatsApp, Visita, Proposta..."
              />
            </div>
            <div className="space-y-2">
              <Label>Ícone</Label>
              <Select
                value={taskTypeForm.icon}
                onValueChange={(v) => setTaskTypeForm({ ...taskTypeForm, icon: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ICON_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <opt.icon className="h-4 w-4" />
                        {opt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: color,
                      borderColor: taskTypeForm.color === color ? "white" : "transparent",
                      boxShadow: taskTypeForm.color === color ? `0 0 0 2px ${color}` : "none",
                    }}
                    onClick={() => setTaskTypeForm({ ...taskTypeForm, color })}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskTypeDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={saveTaskType} disabled={!taskTypeForm.name.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Segment Dialog */}
      <Dialog open={segmentDialog} onOpenChange={setSegmentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSegment ? "Editar" : "Novo"} Segmento</DialogTitle>
            <DialogDescription>
              Configure o nome, cor e descrição do segmento
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={segmentForm.name}
                onChange={(e) => setSegmentForm({ ...segmentForm, name: e.target.value })}
                placeholder="Ex: Premium, Enterprise, B2B..."
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input
                value={segmentForm.description}
                onChange={(e) => setSegmentForm({ ...segmentForm, description: e.target.value })}
                placeholder="Descrição do segmento..."
              />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: color,
                      borderColor: segmentForm.color === color ? "white" : "transparent",
                      boxShadow: segmentForm.color === color ? `0 0 0 2px ${color}` : "none",
                    }}
                    onClick={() => setSegmentForm({ ...segmentForm, color })}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSegmentDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={saveSegment} disabled={!segmentForm.name.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group Dialog */}
      <Dialog open={groupDialog} onOpenChange={setGroupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Editar" : "Novo"} Grupo</DialogTitle>
            <DialogDescription>
              Configure o nome e descrição do grupo
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                placeholder="Ex: Vendas SP, Suporte Técnico..."
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input
                value={groupForm.description}
                onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                placeholder="Descrição do grupo..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={saveGroup} disabled={!groupForm.name.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group Members Dialog */}
      <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Membros do Grupo: {editingGroup?.name}</DialogTitle>
            <DialogDescription>
              Adicione ou remova membros deste grupo
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Current Members */}
            <div>
              <Label className="mb-2 block">Membros atuais</Label>
              {groupMembers?.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Nenhum membro adicionado</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {groupMembers?.map((member) => (
                    <div key={member.user_id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-medium text-sm">
                          {member.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{member.name}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                        {member.is_supervisor && (
                          <Badge variant="outline" className="ml-2">Supervisor</Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveMember(member.user_id)}
                        className="text-destructive hover:text-destructive h-8 w-8"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add Members */}
            <div>
              <Label className="mb-2 block">Adicionar membro</Label>
              {loadingOrgMembers ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="max-h-48">
                  <div className="space-y-2">
                    {orgMembers
                      .filter(m => !groupMembers?.some(gm => gm.user_id === m.user_id))
                      .map((member) => (
                        <div key={member.user_id} className="flex items-center justify-between p-2 rounded-lg border">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-medium text-sm">
                              {member.name?.[0]?.toUpperCase() || '?'}
                            </div>
                            <div>
                              <p className="text-sm font-medium">{member.name}</p>
                              <p className="text-xs text-muted-foreground">{member.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAddMember(member.user_id, true)}
                            >
                              + Supervisor
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleAddMember(member.user_id, false)}
                            >
                              + Membro
                            </Button>
                          </div>
                        </div>
                      ))}
                    {orgMembers.filter(m => !groupMembers?.some(gm => gm.user_id === m.user_id)).length === 0 && (
                      <p className="text-sm text-muted-foreground py-2 text-center">
                        Todos os usuários já foram adicionados
                      </p>
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMembersDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Field Dialog */}
      <Dialog open={fieldDialog} onOpenChange={setFieldDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingField ? "Editar" : "Novo"} Campo Personalizado</DialogTitle>
            <DialogDescription>
              Configure os detalhes do campo
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 p-1">
              <div className="space-y-2">
                <Label>Entidade</Label>
                <Select
                  value={fieldForm.entity_type}
                  onValueChange={(v) => setFieldForm({ ...fieldForm, entity_type: v as 'deal' | 'company' | 'task' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_TYPES.map((et) => (
                      <SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nome do Campo (exibido)</Label>
                <Input
                  value={fieldForm.field_label}
                  onChange={(e) => setFieldForm({ ...fieldForm, field_label: e.target.value })}
                  placeholder="Ex: Origem do Lead, Faturamento Anual..."
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo do Campo</Label>
                <Select
                  value={fieldForm.field_type}
                  onValueChange={(v) => setFieldForm({ ...fieldForm, field_type: v as 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((ft) => (
                      <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {["select", "multiselect"].includes(fieldForm.field_type) && (
                <div className="space-y-2">
                  <Label>Opções</Label>
                  <div className="flex gap-2">
                    <Input
                      value={optionInput}
                      onChange={(e) => setOptionInput(e.target.value)}
                      placeholder="Nova opção..."
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addOption())}
                    />
                    <Button type="button" variant="outline" onClick={addOption}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {fieldForm.options.map((opt) => (
                      <Badge key={opt} variant="secondary" className="gap-1">
                        {opt}
                        <button
                          type="button"
                          onClick={() => removeOption(opt)}
                          className="ml-1 hover:text-destructive"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Switch
                  checked={fieldForm.is_required}
                  onCheckedChange={(c) => setFieldForm({ ...fieldForm, is_required: c })}
                />
                <Label>Campo obrigatório</Label>
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFieldDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={saveField} disabled={!fieldForm.field_label.trim()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loss Reason Dialog */}
      <Dialog open={lossReasonDialog} onOpenChange={setLossReasonDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLossReason ? "Editar" : "Novo"} Motivo de Perda</DialogTitle>
            <DialogDescription>
              Configure um motivo que será exibido ao marcar negociações como perdidas
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do Motivo</Label>
              <Input
                value={lossReasonForm.name}
                onChange={(e) => setLossReasonForm({ ...lossReasonForm, name: e.target.value })}
                placeholder="Ex: Preço muito alto"
              />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Input
                value={lossReasonForm.description}
                onChange={(e) => setLossReasonForm({ ...lossReasonForm, description: e.target.value })}
                placeholder="Ex: Cliente achou o valor elevado para o orçamento disponível"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLossReasonDialog(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={saveLossReason} 
              disabled={!lossReasonForm.name.trim() || createLossReason.isPending || updateLossReason.isPending}
            >
              {(createLossReason.isPending || updateLossReason.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Funnel Editor Dialog */}
      <FunnelEditorDialog
        funnel={editingFunnelData as CRMFunnel | null}
        open={funnelEditorOpen}
        onOpenChange={(open) => {
          setFunnelEditorOpen(open);
          if (!open) setEditingFunnelId(null);
        }}
      />

      {/* Group Funnel Assignment Dialog */}
      <Dialog open={funnelAssignDialogOpen} onOpenChange={(open) => {
        setFunnelAssignDialogOpen(open);
        if (!open) setFunnelAssignGroupId(null);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Funis do Grupo: {editingGroup?.name}</DialogTitle>
            <DialogDescription>
              Selecione quais funis/kanbans este grupo pode acessar. Se nenhum for selecionado, o grupo terá acesso a todos os funis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {funnels?.map((funnel) => {
              const isAssigned = groupFunnels?.some(gf => gf.funnel_id === funnel.id) || false;
              return (
                <div key={funnel.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: funnel.color }} />
                    <div>
                      <p className="font-medium text-sm">{funnel.name}</p>
                      {funnel.description && (
                        <p className="text-xs text-muted-foreground">{funnel.description}</p>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={isAssigned}
                    onCheckedChange={(checked) => {
                      if (!funnelAssignGroupId) return;
                      const currentIds = groupFunnels?.map(gf => gf.funnel_id) || [];
                      const newIds = checked
                        ? [...currentIds, funnel.id]
                        : currentIds.filter(id => id !== funnel.id);
                      setGroupFunnels.mutate({ groupId: funnelAssignGroupId, funnelIds: newIds });
                    }}
                  />
                </div>
              );
            })}
            {!funnels?.length && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum funil cadastrado</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFunnelAssignDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

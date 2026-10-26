import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  TaskCardDetail, TaskChecklist, ChecklistTemplate,
  useTaskCardDetail, useTaskCardMutations, useChecklistMutations,
  useTaskAttachmentMutations, useTaskCommentMutations, useChecklistTemplates,
} from "@/hooks/use-task-boards";
import { useUpload } from "@/hooks/use-upload";
import { useAuth } from "@/contexts/AuthContext";
import { useCRMDealsSearch, useCRMCompanies, CRMDeal } from "@/hooks/use-crm";
import { useProjects, Project } from "@/hooks/use-projects";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { localInputToBrISO, isoToBrLocalInput } from "@/lib/timezone";
import { format, parseISO, differenceInDays, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Calendar, CheckSquare, Paperclip, MessageSquare, User, Trash2, Plus,
  Send, Image, FileText, X, Clock, Star, Upload, ListChecks, Save, Loader2,
  CircleCheck, Circle, MoreHorizontal, Search, Briefcase, FolderKanban, Phone, Link2,
  Building2, GanttChart, PlayCircle, PauseCircle, AlertTriangle, CalendarIcon, Copy, ArrowRightLeft
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface ChatContact {
  id: string;
  name: string | null;
  phone: string;
  jid: string | null;
  connection_id: string;
  connection_name?: string;
}

interface TaskCardDetailDialogProps {
  cardId: string | null;
  boardId: string | null;
  isGlobal: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgMembers?: Array<{ user_id: string; name: string }>;
  allBoards?: Array<{ id: string; name: string; is_global: boolean }>;
}

export function TaskCardDetailDialog({ cardId, boardId, isGlobal, open, onOpenChange, orgMembers = [], allBoards = [] }: TaskCardDetailDialogProps) {
  const { data: card, isLoading } = useTaskCardDetail(open ? cardId : null);
  const cardMut = useTaskCardMutations(boardId);
  const checklistMut = useChecklistMutations(cardId);
  const attachMut = useTaskAttachmentMutations(cardId);
  const commentMut = useTaskCommentMutations(cardId);
  const { data: templates } = useChecklistTemplates();
  const { uploadFile, isUploading } = useUpload();
  const { user } = useAuth();

  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [newComment, setNewComment] = useState("");
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [newItemTitles, setNewItemTitles] = useState<Record<string, string>>({});
  const [showChecklistForm, setShowChecklistForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Contact search
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<ChatContact[]>([]);
  const [searchingContacts, setSearchingContacts] = useState(false);
  const [showContactSearch, setShowContactSearch] = useState(false);

  // Deal search
  const [dealSearch, setDealSearch] = useState("");
  const { data: dealResults, isLoading: searchingDeals } = useCRMDealsSearch(dealSearch.length >= 2 ? dealSearch : undefined);
  const [showDealSearch, setShowDealSearch] = useState(false);

  // Company search
  const [companySearch, setCompanySearch] = useState("");
  const { data: companyResults, isLoading: searchingCompanies } = useCRMCompanies(companySearch.length >= 2 ? companySearch : undefined);
  const [showCompanySearch, setShowCompanySearch] = useState(false);

  // Projects
  const { data: allProjects } = useProjects();
  const [showProjectSearch, setShowProjectSearch] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");

  useEffect(() => {
    if (card) {
      setEditTitle(card.title);
      setEditDesc(card.description || "");
      setHasChanges(false);
    }
  }, [card]);

  // Contact search effect
  useEffect(() => {
    if (contactSearch.length < 2) { setContactResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchingContacts(true);
      try {
        const data = await api<ChatContact[]>(`/api/chat/contacts?search=${encodeURIComponent(contactSearch)}`);
        setContactResults(data);
      } catch { setContactResults([]); }
      setSearchingContacts(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [contactSearch]);

  if (!cardId) return null;

  const handleSaveDetails = () => {
    if (!cardId) return;
    setIsSaving(true);
    cardMut.updateCard.mutate({ id: cardId, title: editTitle, description: editDesc } as any, {
      onSettled: () => { setIsSaving(false); setHasChanges(false); },
    });
  };

  const handleSetStatus = (newStatus: string) => {
    if (!cardId) return;
    cardMut.updateCard.mutate({ id: cardId, status: newStatus } as any);
  };

  const handleUpdateField = (field: string, value: any) => {
    if (!cardId) return;
    cardMut.updateCard.mutate({ id: cardId, [field]: value } as any);
  };

  const handleSelectContact = (contact: ChatContact) => {
    handleUpdateField('contact_name', contact.name || contact.phone);
    handleUpdateField('contact_phone', contact.phone);
    setShowContactSearch(false);
    setContactSearch("");
  };

  const handleClearContact = () => {
    handleUpdateField('contact_name', null);
    handleUpdateField('contact_phone', null);
  };

  const handleLinkDeal = (deal: CRMDeal) => {
    handleUpdateField('deal_id', deal.id);
    setShowDealSearch(false);
    setDealSearch("");
  };

  const handleUnlinkDeal = () => {
    handleUpdateField('deal_id', null);
  };

  const handleLinkCompany = (company: any) => {
    handleUpdateField('company_id', company.id);
    setShowCompanySearch(false);
    setCompanySearch("");
  };

  const handleUnlinkCompany = () => {
    handleUpdateField('company_id', null);
  };

  const handleLinkProject = (project: Project) => {
    handleUpdateField('project_id', project.id);
    setShowProjectSearch(false);
    setProjectSearch("");
  };

  const handleUnlinkProject = () => {
    handleUpdateField('project_id', null);
  };

  const handleAddChecklist = (templateId?: string) => {
    const title = templateId ? (templates?.find(t => t.id === templateId)?.name || "Checklist") : newChecklistTitle;
    if (!title.trim()) return;
    checklistMut.addChecklist.mutate({ title, template_id: templateId });
    setNewChecklistTitle("");
    setShowChecklistForm(false);
  };

  const handleAddChecklistItem = (checklistId: string) => {
    const title = newItemTitles[checklistId];
    if (!title?.trim()) return;
    checklistMut.addChecklistItem.mutate({ checklistId, title });
    setNewItemTitles(prev => ({ ...prev, [checklistId]: "" }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadFile(file);
      if (url) {
        attachMut.addAttachment.mutate({
          file_url: url,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
        });
      }
    } catch {}
  };

  const handleSendComment = () => {
    if (!newComment.trim()) return;
    commentMut.addComment.mutate(newComment);
    setNewComment("");
  };

  const handleDelete = () => {
    if (confirm("Excluir este card permanentemente?")) {
      cardMut.deleteCard.mutate(cardId);
      onOpenChange(false);
    }
  };

  const handleUpdateChecklistItemDate = (itemId: string, date: string | null) => {
    checklistMut.updateChecklistItem.mutate({ id: itemId, due_date: date });
  };

  const priorityOptions = [
    { value: "low", label: "Baixa", color: "text-muted-foreground" },
    { value: "medium", label: "Média", color: "text-yellow-600" },
    { value: "high", label: "Alta", color: "text-orange-600" },
    { value: "urgent", label: "Urgente", color: "text-red-600" },
  ];

  const statusOptions = [
    { value: "open", label: "Aberto", icon: Circle, color: "text-muted-foreground" },
    { value: "in_progress", label: "Em Andamento", icon: PlayCircle, color: "text-blue-500" },
    { value: "completed", label: "Concluído", icon: CircleCheck, color: "text-green-500" },
  ];

  const filteredProjects = allProjects?.filter(p =>
    !projectSearch || p.title.toLowerCase().includes(projectSearch.toLowerCase())
  ) || [];

  // Mini Gantt from checklist items with dates
  const ganttItems = card?.checklists?.flatMap(cl =>
    (cl.items || []).filter(i => i.due_date).map(i => ({
      ...i,
      checklistTitle: cl.title,
    }))
  ) || [];

  const currentStatus = statusOptions.find(s => s.value === card?.status) || statusOptions[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] p-0 overflow-hidden">
        <DialogDescription className="sr-only">Detalhes do card de tarefa</DialogDescription>
        {isLoading || !card ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="flex flex-col h-full max-h-[90vh]">
            {/* Header */}
            <DialogHeader className="p-4 pb-2 border-b pr-12">
              <div className="flex items-start gap-3">
                {/* Status dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="mt-1 shrink-0" title="Alterar status">
                      <currentStatus.icon className={cn("h-6 w-6", currentStatus.color)} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {statusOptions.map(s => (
                      <DropdownMenuItem key={s.value} onClick={() => handleSetStatus(s.value)} className="gap-2">
                        <s.icon className={cn("h-4 w-4", s.color)} />
                        {s.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex-1 min-w-0">
                  <Input
                    value={editTitle}
                    onChange={e => { setEditTitle(e.target.value); setHasChanges(true); }}
                    className="text-lg font-bold border-none p-0 h-auto focus-visible:ring-0 shadow-none"
                    placeholder="Título do card"
                  />
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant={card.status === 'completed' ? 'default' : 'secondary'}
                      className={cn("text-xs",
                        card.status === 'completed' && "bg-green-500/10 text-green-600 border-green-500/20",
                        card.status === 'in_progress' && "bg-blue-500/10 text-blue-600 border-blue-500/20"
                      )}>
                      {currentStatus.label}
                    </Badge>
                    {card.source_module && card.source_module !== 'manual' && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        {card.source_module === 'group_secretary' && '🤖 Secretária IA'}
                        {card.source_module === 'crm' && '📊 CRM'}
                        {card.source_module === 'ai_agent' && '🧠 Agente IA'}
                        {card.source_module === 'chatbot' && '💬 Chatbot'}
                        {card.source_module === 'flow' && '⚡ Fluxo'}
                        {card.source_module === 'migration' && '🔄 Migração'}
                      </Badge>
                    )}
                    {card.deal_title && (
                      <span className="text-xs text-muted-foreground">📋 {card.deal_title}{card.company_name ? ` • ${card.company_name}` : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant={hasChanges ? "default" : "outline"} className="h-8 gap-1.5" onClick={handleSaveDetails} disabled={isSaving || !hasChanges}>
                    {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {isSaving ? "Salvando..." : "Salvar"}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => cardMut.duplicateCard.mutate({ id: cardId })}>
                        <Copy className="h-4 w-4 mr-2" /> Duplicar card
                      </DropdownMenuItem>
                      {allBoards.filter(b => b.id !== boardId).length > 0 && (
                        <>
                          <DropdownMenuItem disabled className="text-xs text-muted-foreground font-medium">
                            <ArrowRightLeft className="h-4 w-4 mr-2" /> Mover para quadro:
                          </DropdownMenuItem>
                          {allBoards.filter(b => b.id !== boardId).map(b => (
                            <DropdownMenuItem key={b.id} onClick={() => {
                              cardMut.moveCard.mutate({ id: cardId, board_id: b.id });
                              onOpenChange(false);
                            }} className="pl-8 text-xs">
                              {b.is_global ? "🌐" : "📋"} {b.name}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                      <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
                        <Trash2 className="h-4 w-4 mr-2" /> Excluir card
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
                {/* Main content */}
                <div className="md:col-span-2 space-y-4">
                  {/* Cover Image */}
                  {card.cover_image_url && (
                    <div className="relative">
                      <img src={card.cover_image_url} alt="" className="w-full h-40 object-cover rounded-lg" />
                      <Button size="icon" variant="destructive" className="absolute top-2 right-2 h-6 w-6"
                        onClick={() => handleUpdateField('cover_image_url', null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}

                  {/* Description */}
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Descrição
                    </h4>
                    <Textarea
                      value={editDesc}
                      onChange={e => { setEditDesc(e.target.value); setHasChanges(true); }}
                      placeholder="Adicionar descrição..."
                      className="min-h-[80px]"
                    />
                  </div>

                  {/* Checklists */}
                  {card.checklists?.map(checklist => {
                    const items = checklist.items || [];
                    const done = items.filter(i => i.is_completed).length;
                    const total = items.length;
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

                    return (
                      <div key={checklist.id} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium flex items-center gap-2">
                            <CheckSquare className="h-4 w-4" /> {checklist.title}
                            <span className="text-xs text-muted-foreground">{done}/{total}</span>
                          </h4>
                          <Button variant="ghost" size="icon" className="h-6 w-6"
                            onClick={() => checklistMut.deleteChecklist.mutate(checklist.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        {total > 0 && (
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-green-500" : "bg-primary")}
                              style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        <div className="space-y-1">
                          {items.map(item => {
                            const itemOverdue = item.due_date && !item.is_completed && isPast(parseISO(item.due_date));
                            return (
                              <div key={item.id} className="flex items-center gap-2 group">
                                <Checkbox
                                  checked={item.is_completed}
                                  onCheckedChange={(checked) => checklistMut.toggleChecklistItem.mutate({ id: item.id, is_completed: !!checked })}
                                />
                                <span className={cn("text-sm flex-1", item.is_completed && "line-through text-muted-foreground")}>
                                  {item.title}
                                </span>
                                {/* Item due date */}
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className={cn(
                                      "flex items-center gap-1 text-xs px-1.5 py-0.5 rounded hover:bg-muted",
                                      itemOverdue ? "text-red-500" : item.due_date ? "text-muted-foreground" : "text-muted-foreground/50 opacity-0 group-hover:opacity-100"
                                    )}>
                                      {itemOverdue ? <AlertTriangle className="h-3 w-3" /> : <CalendarIcon className="h-3 w-3" />}
                                      {item.due_date ? format(parseISO(item.due_date), "dd/MM", { locale: ptBR }) : ""}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0" align="end">
                                    <CalendarComponent
                                      mode="single"
                                      selected={item.due_date ? parseISO(item.due_date) : undefined}
                                      onSelect={(d) => handleUpdateChecklistItemDate(item.id, d ? format(d, "yyyy-MM-dd") : null)}
                                      className="p-3 pointer-events-auto"
                                      locale={ptBR}
                                    />
                                    {item.due_date && (
                                      <div className="px-3 pb-3">
                                        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => handleUpdateChecklistItemDate(item.id, null)}>
                                          <X className="h-3 w-3 mr-1" /> Remover data
                                        </Button>
                                      </div>
                                    )}
                                  </PopoverContent>
                                </Popover>
                                <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100"
                                  onClick={() => checklistMut.deleteChecklistItem.mutate(item.id)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          <Input
                            value={newItemTitles[checklist.id] || ""}
                            onChange={e => setNewItemTitles(prev => ({ ...prev, [checklist.id]: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && handleAddChecklistItem(checklist.id)}
                            placeholder="Novo item..."
                            className="h-8 text-sm"
                          />
                          <Button size="sm" variant="outline" className="h-8"
                            onClick={() => handleAddChecklistItem(checklist.id)}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Mini Gantt for checklist items with dates */}
                  {ganttItems.length > 0 && (
                    <div className="border rounded-lg p-3 space-y-2">
                      <h4 className="text-sm font-medium flex items-center gap-2">
                        <GanttChart className="h-4 w-4" /> Cronograma do Checklist
                      </h4>
                      <div className="space-y-1">
                        {ganttItems.sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime()).map(item => {
                          const dueDate = parseISO(item.due_date!);
                          const isOverdue = !item.is_completed && isPast(dueDate);
                          return (
                            <div key={item.id} className="flex items-center gap-2 text-xs">
                              <span className={cn("w-4 h-4 rounded-full flex items-center justify-center shrink-0",
                                item.is_completed ? "bg-green-500/20 text-green-600" :
                                isOverdue ? "bg-red-500/20 text-red-600" :
                                "bg-muted text-muted-foreground"
                              )}>
                                {item.is_completed ? "✓" : isOverdue ? "!" : "○"}
                              </span>
                              <span className={cn("flex-1 truncate", item.is_completed && "line-through text-muted-foreground")}>
                                {item.title}
                              </span>
                              <span className={cn("text-xs shrink-0", isOverdue ? "text-red-500 font-medium" : "text-muted-foreground")}>
                                {format(dueDate, "dd/MM", { locale: ptBR })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Add checklist */}
                  {showChecklistForm ? (
                    <div className="border rounded-lg p-3 space-y-2">
                      <Input
                        value={newChecklistTitle}
                        onChange={e => setNewChecklistTitle(e.target.value)}
                        placeholder="Nome da checklist"
                        className="h-8"
                        autoFocus
                      />
                      {templates && templates.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Ou use um template:</p>
                          <div className="flex flex-wrap gap-1">
                            {templates.map(t => (
                              <Badge key={t.id} variant="outline" className="cursor-pointer hover:bg-primary/10"
                                onClick={() => handleAddChecklist(t.id)}>
                                <ListChecks className="h-3 w-3 mr-1" />{t.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleAddChecklist()}>Adicionar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowChecklistForm(false)}>Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setShowChecklistForm(true)}>
                      <CheckSquare className="h-4 w-4 mr-2" /> Adicionar Checklist
                    </Button>
                  )}

                  <Separator />

                  {/* Attachments */}
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Paperclip className="h-4 w-4" /> Anexos ({card.attachments?.length || 0})
                    </h4>
                    <div className="space-y-2">
                      {card.attachments?.map(att => (
                        <div key={att.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded group">
                          {att.file_type?.startsWith('image/') ? (
                            <img src={att.file_url} alt="" className="h-10 w-10 object-cover rounded" />
                          ) : (
                            <FileText className="h-10 w-10 text-muted-foreground p-2" />
                          )}
                          <div className="flex-1 min-w-0">
                            <a href={att.file_url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline truncate block">
                              {att.file_name}
                            </a>
                            <p className="text-xs text-muted-foreground">{att.uploaded_by_name}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100"
                            onClick={() => attachMut.deleteAttachment.mutate(att.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <label>
                      <input type="file" className="hidden" onChange={handleFileUpload} />
                      <Button variant="outline" size="sm" className="mt-2" asChild>
                        <span>
                          <Upload className="h-4 w-4 mr-2" />
                          {isUploading ? "Enviando..." : "Enviar arquivo"}
                        </span>
                      </Button>
                    </label>
                  </div>

                  <Separator />

                  {/* Comments */}
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" /> Comentários ({card.comments?.length || 0})
                    </h4>
                    <div className="space-y-3 mb-3">
                      {card.comments?.map(comment => (
                        <div key={comment.id} className="flex gap-2 group">
                          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium shrink-0">
                            {comment.user_name?.charAt(0).toUpperCase() || "?"}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{comment.user_name}</span>
                              <span className="text-xs text-muted-foreground">
                                {format(parseISO(comment.created_at), "dd/MM HH:mm", { locale: ptBR })}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">{comment.content}</p>
                          </div>
                          {comment.user_id === user?.id && (
                            <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100"
                              onClick={() => commentMut.deleteComment.mutate(comment.id)}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSendComment()}
                        placeholder="Escrever comentário..."
                        className="h-9"
                      />
                      <Button size="sm" className="h-9" onClick={handleSendComment} disabled={!newComment.trim()}>
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-3">
                  {/* Status */}
                  <div>
                    <label className="text-xs text-muted-foreground">Status</label>
                    <Select value={card.status} onValueChange={v => handleSetStatus(v)}>
                      <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {statusOptions.map(s => (
                          <SelectItem key={s.value} value={s.value}>
                            <span className={cn("flex items-center gap-1.5", s.color)}>
                              <s.icon className="h-3.5 w-3.5" />{s.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Priority */}
                  <div>
                    <label className="text-xs text-muted-foreground">Prioridade</label>
                    <Select value={card.priority} onValueChange={v => handleUpdateField('priority', v)}>
                      <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {priorityOptions.map(p => (
                          <SelectItem key={p.value} value={p.value}>
                            <span className={p.color}>{p.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Assignee (only on global boards) */}
                  {isGlobal && (
                    <div>
                      <label className="text-xs text-muted-foreground">Responsável</label>
                      <Select value={card.assigned_to || "none"} onValueChange={v => handleUpdateField('assigned_to', v === "none" ? null : v)}>
                        <SelectTrigger className="h-8 mt-1"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nenhum</SelectItem>
                          {(orgMembers || []).map(m => (
                            <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>
                          ))}
                          {card.assigned_to && !(orgMembers || []).some(m => m.user_id === card.assigned_to) && (
                            <SelectItem value={card.assigned_to}>{card.assigned_to_name || "Responsável atual"}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Due Date */}
                  <div>
                    <label className="text-xs text-muted-foreground">Prazo</label>
                    <Input
                      type="datetime-local"
                      value={isoToBrLocalInput(card.due_date)}
                      onChange={e => handleUpdateField('due_date', localInputToBrISO(e.target.value) || null)}
                      className="h-8 mt-1 text-xs"
                    />
                  </div>

                  {/* Start Date */}
                  <div>
                    <label className="text-xs text-muted-foreground">Início</label>
                    <Input
                      type="datetime-local"
                      value={isoToBrLocalInput(card.start_date)}
                      onChange={e => handleUpdateField('start_date', localInputToBrISO(e.target.value) || null)}
                      className="h-8 mt-1 text-xs"
                    />
                  </div>

                  {/* Cover image */}
                  <div>
                    <label className="text-xs text-muted-foreground">Capa</label>
                    <label className="block mt-1">
                      <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const url = await uploadFile(file);
                        if (url) handleUpdateField('cover_image_url', url);
                      }} />
                      <Button variant="outline" size="sm" className="w-full h-8" asChild>
                        <span><Image className="h-3 w-3 mr-2" />Adicionar capa</span>
                      </Button>
                    </label>
                  </div>

                  <Separator />

                  {/* Contact */}
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3" /> Contato vinculado
                    </label>
                    {card.contact_name || card.contact_phone ? (
                      <div className="mt-1 p-2 border rounded-md flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium shrink-0">
                          {(card.contact_name || card.contact_phone || "?").charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{card.contact_name || "Sem nome"}</p>
                          {card.contact_phone && <p className="text-xs text-muted-foreground">{card.contact_phone}</p>}
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleClearContact}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : showContactSearch ? (
                      <div className="mt-1 space-y-1">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input value={contactSearch} onChange={e => setContactSearch(e.target.value)}
                            placeholder="Buscar contato..." className="h-8 text-xs pl-7" autoFocus />
                        </div>
                        {searchingContacts && <p className="text-xs text-muted-foreground">Buscando...</p>}
                        {contactResults.length > 0 && (
                          <div className="border rounded-md max-h-32 overflow-y-auto">
                            {contactResults.slice(0, 10).map(c => (
                              <button key={c.id} className="w-full text-left px-2 py-1.5 hover:bg-muted/50 flex items-center gap-2 text-sm"
                                onClick={() => handleSelectContact(c)}>
                                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-xs shrink-0">
                                  {(c.name || c.phone).charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium">{c.name || c.phone}</p>
                                  <p className="text-xs text-muted-foreground">{c.phone}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 text-xs w-full" onClick={() => setShowContactSearch(false)}>Cancelar</Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="w-full h-8 mt-1 text-xs" onClick={() => setShowContactSearch(true)}>
                        <Search className="h-3 w-3 mr-1" /> Buscar contato
                      </Button>
                    )}
                  </div>

                  <Separator />

                  {/* Deal */}
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Briefcase className="h-3 w-3" /> Negociação
                    </label>
                    {card.deal_id && card.deal_title ? (
                      <div className="mt-1 p-2 border rounded-md flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{card.deal_title}</p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleUnlinkDeal}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : showDealSearch ? (
                      <div className="mt-1 space-y-1">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input value={dealSearch} onChange={e => setDealSearch(e.target.value)}
                            placeholder="Buscar negociação..." className="h-8 text-xs pl-7" autoFocus />
                        </div>
                        {searchingDeals && <p className="text-xs text-muted-foreground">Buscando...</p>}
                        {dealResults && dealResults.length > 0 && (
                          <div className="border rounded-md max-h-32 overflow-y-auto">
                            {dealResults.slice(0, 8).map((d: CRMDeal) => (
                              <button key={d.id} className="w-full text-left px-2 py-1.5 hover:bg-muted/50 flex items-center gap-2 text-sm"
                                onClick={() => handleLinkDeal(d)}>
                                <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium">{d.title}</p>
                                  <p className="text-xs text-muted-foreground">{d.company_name || 'Sem empresa'}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 text-xs w-full" onClick={() => setShowDealSearch(false)}>Cancelar</Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="w-full h-8 mt-1 text-xs" onClick={() => setShowDealSearch(true)}>
                        <Link2 className="h-3 w-3 mr-1" /> Vincular negociação
                      </Button>
                    )}
                  </div>

                  {/* Company */}
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> Empresa
                    </label>
                    {card.company_id && card.company_name ? (
                      <div className="mt-1 p-2 border rounded-md flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{card.company_name}</p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleUnlinkCompany}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : showCompanySearch ? (
                      <div className="mt-1 space-y-1">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input value={companySearch} onChange={e => setCompanySearch(e.target.value)}
                            placeholder="Buscar empresa..." className="h-8 text-xs pl-7" autoFocus />
                        </div>
                        {searchingCompanies && <p className="text-xs text-muted-foreground">Buscando...</p>}
                        {companyResults && companyResults.length > 0 && (
                          <div className="border rounded-md max-h-32 overflow-y-auto">
                            {companyResults.slice(0, 8).map((c: any) => (
                              <button key={c.id} className="w-full text-left px-2 py-1.5 hover:bg-muted/50 flex items-center gap-2 text-sm"
                                onClick={() => handleLinkCompany(c)}>
                                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <p className="truncate text-xs font-medium">{c.name}</p>
                              </button>
                            ))}
                          </div>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 text-xs w-full" onClick={() => setShowCompanySearch(false)}>Cancelar</Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="w-full h-8 mt-1 text-xs" onClick={() => setShowCompanySearch(true)}>
                        <Link2 className="h-3 w-3 mr-1" /> Vincular empresa
                      </Button>
                    )}
                  </div>

                  {/* Project */}
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1">
                      <FolderKanban className="h-3 w-3" /> Projeto
                    </label>
                    {card.project_id && card.project_title ? (
                      <div className="mt-1 p-2 border rounded-md flex items-center gap-2">
                        <FolderKanban className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{card.project_title}</p>
                          <p className="text-xs text-muted-foreground">{card.project_stage || 'Sem etapa'}</p>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleUnlinkProject}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : showProjectSearch ? (
                      <div className="mt-1 space-y-1">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input value={projectSearch} onChange={e => setProjectSearch(e.target.value)}
                            placeholder="Buscar projeto..." className="h-8 text-xs pl-7" autoFocus />
                        </div>
                        {filteredProjects.length > 0 && (
                          <div className="border rounded-md max-h-32 overflow-y-auto">
                            {filteredProjects.slice(0, 8).map((p: any) => (
                              <button key={p.id} className="w-full text-left px-2 py-1.5 hover:bg-muted/50 flex items-center gap-2 text-sm"
                                onClick={() => handleLinkProject(p)}>
                                <FolderKanban className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium">{p.title}</p>
                                  <p className="text-xs text-muted-foreground">{p.stage_name || 'Sem etapa'}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 text-xs w-full" onClick={() => setShowProjectSearch(false)}>Cancelar</Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="w-full h-8 mt-1 text-xs" onClick={() => setShowProjectSearch(true)}>
                        <Link2 className="h-3 w-3 mr-1" /> Vincular projeto
                      </Button>
                    )}
                  </div>

                  <Separator />

                  {/* Meta info */}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Criado por: {card.creator_name}</p>
                    <p>Criado em: {format(parseISO(card.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                    {card.completed_at && <p>Concluído: {format(parseISO(card.completed_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

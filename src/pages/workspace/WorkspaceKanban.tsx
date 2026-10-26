import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Calendar, Clock, Loader2, LayoutGrid, MessageSquare, AlertTriangle, GripVertical, User } from "lucide-react";
import { useDevAllTasks, useDevTaskStatusMutation, useDevTaskUpdateGlobal, useDevModules, DevTaskGlobal } from "@/hooks/use-dev-workspace";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Layers, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, closestCorners, DragStartEvent, DragEndEvent,
} from "@dnd-kit/core";

const COLUMNS: { key: string; label: string; tone: string }[] = [
  { key: "triage", label: "Triagem", tone: "bg-amber-500/10 border-amber-500/30" },
  { key: "backlog", label: "Backlog", tone: "bg-slate-500/10 border-slate-500/30" },
  { key: "in_progress", label: "Em andamento", tone: "bg-blue-500/10 border-blue-500/30" },
  { key: "testing", label: "Em teste", tone: "bg-purple-500/10 border-purple-500/30" },
  { key: "done", label: "Concluído", tone: "bg-emerald-500/10 border-emerald-500/30" },
];

const PRIORITY_TONE: Record<string, string> = {
  high: "bg-destructive/15 text-destructive border-destructive/40",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40",
  low: "bg-muted text-muted-foreground",
};

function daysSince(iso?: string | null) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function ModulePicker({ task }: { task: DevTaskGlobal }) {
  const [open, setOpen] = useState(false);
  const { data: modules, isLoading } = useDevModules(open ? task.project_id : null);
  const upd = useDevTaskUpdateGlobal();
  const color = task.module_color || "#94a3b8";
  const label = task.module_name || "Sem módulo";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border hover:bg-muted/70 transition-colors max-w-[160px]"
          style={{ borderColor: `${color}66`, background: `${color}1a`, color }}
          title="Alterar módulo"
        >
          <Layers className="h-3 w-3 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 py-1">Módulo</div>
        <button
          className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted text-left"
          onClick={() => { upd.mutate({ id: task.id, module_id: null as any }); setOpen(false); }}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
          <span className="flex-1">Sem módulo</span>
          {!task.module_id && <Check className="h-3.5 w-3.5" />}
        </button>
        {isLoading && <div className="px-2 py-2 text-xs text-muted-foreground">Carregando…</div>}
        {(modules || []).map((m) => {
          const parent = m.parent_id ? (modules || []).find((x) => x.id === m.parent_id) : null;
          return (
            <button
              key={m.id}
              className="w-full flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-muted text-left"
              onClick={() => { upd.mutate({ id: task.id, module_id: m.id }); setOpen(false); }}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color || "#6366f1" }} />
              <span className="flex-1 truncate">{parent ? `${parent.name} → ${m.name}` : m.name}</span>
              {task.module_id === m.id && <Check className="h-3.5 w-3.5" />}
            </button>
          );
        })}
        {!isLoading && (modules || []).length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">Nenhum módulo no projeto</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function TaskCardBody({ task, dragHandle, onOpen }: { task: DevTaskGlobal; dragHandle?: React.ReactNode; onOpen?: (t: DevTaskGlobal) => void }) {
  const daysOpen = daysSince(task.created_at);
  const dueLeft = task.due_date ? Math.round((new Date(task.due_date).getTime() - Date.now()) / 86400000) : null;
  const overdue = dueLeft !== null && dueLeft < 0 && task.status !== "done";
  const accent = task.module_color || "#94a3b8";
  return (
    <Card
      className="border hover:border-primary/40 transition-colors bg-card border-l-4 cursor-pointer"
      style={{ borderLeftColor: accent }}
      onClick={() => onOpen?.(task)}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          {dragHandle}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium leading-snug line-clamp-2">{task.title}</div>
              {task.priority && task.priority !== "medium" && (
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${PRIORITY_TONE[task.priority] || ""}`}>
                  {task.priority === "high" ? "alta" : task.priority === "low" ? "baixa" : task.priority}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <ModulePicker task={task} />
              <Link
                to={`/workspace/${task.project_id}`}
                className="text-[11px] text-muted-foreground hover:text-primary truncate max-w-[140px]"
                onClick={(e) => e.stopPropagation()}
                title={task.project_name}
              >
                {task.project_name}
              </Link>
            </div>
          </div>
        </div>

        {task.phase_name && <div className="text-[11px] text-muted-foreground">Fase: {task.phase_name}</div>}
        {task.description && <div className="text-[11px] text-muted-foreground line-clamp-2">{task.description}</div>}
        {task.source === "portal" || task.source === "client" ? (
          <div>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0">
              Pedido do cliente
            </Badge>
          </div>
        ) : null}
        {(task.requester_name || task.department || task.created_at) && (
          <div className="rounded-md bg-muted/60 p-2 space-y-1 text-[11px] text-muted-foreground">
            {task.requester_name && (
              <div className="flex items-center gap-1 text-foreground font-medium">
                <User className="h-3 w-3" /> {task.requester_name}
              </div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
              {task.department && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{task.department}</Badge>}
              {task.contact_email && <span className="truncate max-w-full">{task.contact_email}</span>}
            </div>
            {task.created_at && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Solicitado em {new Date(task.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>
        )}
        {task.image_url && (
          <a href={task.image_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block">
            <img src={task.image_url} alt="Anexo" className="rounded border max-h-24 object-contain" loading="lazy" />
          </a>
        )}
        {task.client_feedback === "needs_changes" && (
          <div className="text-[11px] text-amber-600 flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Cliente pediu ajustes</div>
        )}
        {task.client_feedback === "approved" && (
          <div className="text-[11px] text-emerald-600">Cliente aprovou</div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
          {daysOpen !== null && (
            <span className="text-[11px] flex items-center gap-1 text-muted-foreground" title={new Date(task.created_at!).toLocaleString("pt-BR")}>
              <Clock className="h-3 w-3" />
              {daysOpen === 0 ? "hoje" : `há ${daysOpen}d`}
            </span>
          )}
          {task.due_date && (
            <span className={`text-[11px] flex items-center gap-1 ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
              {overdue ? <AlertTriangle className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
              {new Date(task.due_date).toLocaleDateString("pt-BR")}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DraggableCard({ task, onOpen }: { task: DevTaskGlobal; onOpen: (t: DevTaskGlobal) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task } });
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <TaskCardBody
        task={task}
        onOpen={onOpen}
        dragHandle={
          <button
            {...attributes}
            {...listeners}
            className="p-1 -m-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
            aria-label="Arrastar"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        }
      />
    </div>
  );
}

function DroppableColumn({ col, children, count }: { col: typeof COLUMNS[number]; children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div className={`rounded-lg border ${col.tone} flex flex-col min-h-[60vh] transition-colors ${isOver ? "ring-2 ring-primary/50" : ""}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-current/10">
        <div className="font-semibold text-sm">{col.label}</div>
        <Badge variant="secondary" className="h-5 text-[11px]">{count}</Badge>
      </div>
      <div ref={setNodeRef} className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[70vh]">
        {children}
      </div>
    </div>
  );
}

type SortMode = "oldest" | "newest" | "priority";

export default function WorkspaceKanban() {
  const { data: tasks, isLoading } = useDevAllTasks();
  const move = useDevTaskStatusMutation();
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [requesterFilter, setRequesterFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("oldest");
  const [clientOnly, setClientOnly] = useState(false);
  const [activeTask, setActiveTask] = useState<DevTaskGlobal | null>(null);
  const [doneTarget, setDoneTarget] = useState<DevTaskGlobal | null>(null);
  const [doneNotes, setDoneNotes] = useState("");
  const [detailTask, setDetailTask] = useState<DevTaskGlobal | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    (tasks || []).forEach((t) => map.set(t.project_id, t.project_name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tasks]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    (tasks || []).forEach((t) => t.department && set.add(t.department));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [tasks]);

  const requesters = useMemo(() => {
    const set = new Set<string>();
    (tasks || []).forEach((t) => t.requester_name && set.add(t.requester_name));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (tasks || []).filter((t) =>
      (clientOnly ? (t.source === "client" || t.source === "portal") : true) &&
      (projectFilter === "all" || t.project_id === projectFilter) &&
      (deptFilter === "all" || (t.department || "") === deptFilter) &&
      (requesterFilter === "all" || (t.requester_name || "") === requesterFilter) &&
      (!q || t.title.toLowerCase().includes(q) || t.project_name.toLowerCase().includes(q) ||
        (t.requester_name || "").toLowerCase().includes(q) || (t.department || "").toLowerCase().includes(q))
    );
    const prio = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
    const ts = (t: DevTaskGlobal) => (t.created_at ? new Date(t.created_at).getTime() : 0);
    return [...list].sort((a, b) => {
      if (sortMode === "oldest") return ts(a) - ts(b);
      if (sortMode === "newest") return ts(b) - ts(a);
      return prio(a.priority) - prio(b.priority) || ts(b) - ts(a);
    });
  }, [tasks, search, projectFilter, deptFilter, requesterFilter, sortMode]);

  const grouped = useMemo(() => {
    const g: Record<string, DevTaskGlobal[]> = {};
    COLUMNS.forEach((c) => (g[c.key] = []));
    filtered.forEach((t) => {
      const k = COLUMNS.find((c) => c.key === t.status) ? t.status : "backlog";
      (g[k] ||= []).push(t);
    });
    return g;
  }, [filtered]);

  const onDragStart = (e: DragStartEvent) => {
    const t = (tasks || []).find((x) => x.id === e.active.id);
    setActiveTask(t || null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveTask(null);
    const overId = e.over?.id as string | undefined;
    const taskId = e.active.id as string;
    if (!overId) return;
    const t = (tasks || []).find((x) => x.id === taskId);
    if (!t || t.status === overId) return;
    if (!COLUMNS.find((c) => c.key === overId)) return;
    if (overId === "done") {
      setDoneNotes(t.completion_notes || "");
      setDoneTarget(t);
      return;
    }
    move.mutate({ id: taskId, status: overId });
  };

  const confirmDone = (skip: boolean) => {
    if (!doneTarget) return;
    move.mutate({
      id: doneTarget.id,
      status: "done",
      completion_notes: skip ? undefined : doneNotes.trim() || undefined,
    });
    setDoneTarget(null);
    setDoneNotes("");
  };

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/workspace"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Workspace</Button></Link>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2"><LayoutGrid className="h-6 w-6 text-primary" /> Kanban global</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-48" />
            <Button
              variant={clientOnly ? "default" : "outline"}
              size="sm"
              className="h-9"
              onClick={() => setClientOnly((v) => !v)}
              title="Mostrar apenas pedidos feitos pelo portal do cliente"
            >
              Pedidos do cliente
            </Button>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Todos os projetos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os projetos</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {departments.length > 0 && (
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Departamento" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os deptos.</SelectItem>
                  {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {requesters.length > 0 && (
              <Select value={requesterFilter} onValueChange={setRequesterFilter}>
                <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Solicitante" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os solicitantes</SelectItem>
                  {requesters.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={sortMode} onValueChange={(v: SortMode) => setSortMode(v)}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="oldest">Abertos há mais tempo</SelectItem>
                <SelectItem value="newest">Abertos recentemente</SelectItem>
                <SelectItem value="priority">Prioridade</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando tarefas…</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-3 xl:grid-cols-5">
              {COLUMNS.map((col) => (
                <DroppableColumn key={col.key} col={col} count={grouped[col.key]?.length || 0}>
                  {(grouped[col.key] || []).map((t) => <DraggableCard key={t.id} task={t} onOpen={setDetailTask} />)}
                  {(grouped[col.key] || []).length === 0 && (
                    <div className="text-center text-xs text-muted-foreground py-6">Solte aqui</div>
                  )}
                </DroppableColumn>
              ))}
            </div>
            <DragOverlay>
              {activeTask ? <div className="w-72 rotate-2 shadow-lg"><TaskCardBody task={activeTask} /></div> : null}
            </DragOverlay>
          </DndContext>
        )}

        <Dialog open={!!detailTask} onOpenChange={(o) => { if (!o) setDetailTask(null); }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-start gap-2">
                {(detailTask?.source === "portal" || detailTask?.source === "client") && (
                  <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0 shrink-0 mt-0.5">
                    Pedido do cliente
                  </Badge>
                )}
                <span>{detailTask?.title}</span>
              </DialogTitle>
              <DialogDescription>
                {detailTask?.project_name}{detailTask?.phase_name ? ` · ${detailTask.phase_name}` : ""}{detailTask?.module_name ? ` · ${detailTask.module_name}` : ""}
              </DialogDescription>
            </DialogHeader>
            {detailTask && (
              <div className="space-y-4">
                {detailTask.description && (
                  <p className="text-sm whitespace-pre-wrap">{detailTask.description}</p>
                )}
                {(detailTask.requester_name || detailTask.department || detailTask.contact_email || detailTask.created_at) && (
                  <div className="rounded-md bg-muted/60 p-3 space-y-1.5 text-sm">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quem solicitou</div>
                    {detailTask.requester_name && (
                      <div className="flex items-center gap-1.5 font-medium"><User className="h-4 w-4" /> {detailTask.requester_name}</div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                      {detailTask.department && <Badge variant="outline">{detailTask.department}</Badge>}
                      {detailTask.contact_email && <span>{detailTask.contact_email}</span>}
                    </div>
                    {detailTask.created_at && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        Solicitado em {new Date(detailTask.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                )}
                {detailTask.image_url && (
                  <a href={detailTask.image_url} target="_blank" rel="noreferrer" className="block">
                    <img src={detailTask.image_url} alt="Anexo da solicitação" className="rounded border max-h-64 object-contain" loading="lazy" />
                  </a>
                )}
                <div className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Etapa atual</span>
                  <Select
                    value={detailTask.status}
                    onValueChange={(v) => {
                      if (v === "done") {
                        setDetailTask(null);
                        setDoneTarget(detailTask);
                      } else {
                        move.mutate({ id: detailTask.id, status: v });
                        setDetailTask({ ...detailTask, status: v });
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COLUMNS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {detailTask.client_feedback === "needs_changes" && (
                  <div className="text-sm text-amber-600 flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4" /> Cliente pediu ajustes
                    {detailTask.client_feedback_note ? `: ${detailTask.client_feedback_note}` : ""}
                  </div>
                )}
                {detailTask.client_feedback === "approved" && (
                  <div className="text-sm text-emerald-600">Cliente aprovou esta entrega</div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" asChild onClick={() => setDetailTask(null)}>
                <Link to={`/workspace/${detailTask?.project_id}`}>Abrir projeto</Link>
              </Button>
              <Button onClick={() => setDetailTask(null)}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!doneTarget} onOpenChange={(o) => { if (!o) { setDoneTarget(null); setDoneNotes(""); } }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> Concluir tarefa</DialogTitle>
              <DialogDescription>
                Registre o que foi feito e como funciona. Esse resumo é somado automaticamente ao cérebro do projeto para consultas futuras da IA.
              </DialogDescription>
            </DialogHeader>
            {doneTarget && (
              <div className="space-y-3">
                <div className="text-sm">
                  <div className="font-medium">{doneTarget.title}</div>
                  <div className="text-xs text-muted-foreground">{doneTarget.project_name}{doneTarget.phase_name ? ` · ${doneTarget.phase_name}` : ""}</div>
                </div>
                <Textarea
                  autoFocus
                  rows={6}
                  placeholder="Ex.: Adicionei botão de teste de push nas configurações. Chama POST /api/push/test que envia uma notificação de exemplo com som e vibração. Requer permissão concedida no navegador."
                  value={doneNotes}
                  onChange={(e) => setDoneNotes(e.target.value)}
                />
                <div className="text-[11px] text-muted-foreground">
                  Dica: descreva a solução, endpoints/arquivos alterados e como o usuário utiliza. Fica indexado como conhecimento do projeto.
                </div>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" onClick={() => { setDoneTarget(null); setDoneNotes(""); }}>Cancelar</Button>
              <Button variant="outline" onClick={() => confirmDone(true)}>Concluir sem anotação</Button>
              <Button onClick={() => confirmDone(false)} disabled={!doneNotes.trim()}>Concluir e salvar no cérebro</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Calendar, Clock, Loader2, LayoutGrid, MessageSquare, AlertTriangle, GripVertical } from "lucide-react";
import { useDevAllTasks, useDevTaskStatusMutation, DevTaskGlobal } from "@/hooks/use-dev-workspace";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Brain } from "lucide-react";
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

function TaskCardBody({ task, dragHandle }: { task: DevTaskGlobal; dragHandle?: React.ReactNode }) {
  const daysOpen = daysSince(task.created_at);
  const dueLeft = task.due_date ? Math.round((new Date(task.due_date).getTime() - Date.now()) / 86400000) : null;
  const overdue = dueLeft !== null && dueLeft < 0 && task.status !== "done";
  return (
    <Card className="border hover:border-primary/40 transition-colors bg-card">
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
            <Link to={`/workspace/${task.project_id}`} className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
              <span className="w-2 h-2 rounded-full" style={{ background: task.module_color || "#94a3b8" }} />
              <span className="truncate">{task.project_name}</span>
            </Link>
          </div>
        </div>

        {task.phase_name && <div className="text-[11px] text-muted-foreground">Fase: {task.phase_name}</div>}
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

function DraggableCard({ task }: { task: DevTaskGlobal }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task } });
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <TaskCardBody
        task={task}
        dragHandle={
          <button
            {...attributes}
            {...listeners}
            className="p-1 -m-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
            aria-label="Arrastar"
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
  const [sortMode, setSortMode] = useState<SortMode>("oldest");
  const [activeTask, setActiveTask] = useState<DevTaskGlobal | null>(null);
  const [doneTarget, setDoneTarget] = useState<DevTaskGlobal | null>(null);
  const [doneNotes, setDoneNotes] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    (tasks || []).forEach((t) => map.set(t.project_id, t.project_name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (tasks || []).filter((t) =>
      (projectFilter === "all" || t.project_id === projectFilter) &&
      (!q || t.title.toLowerCase().includes(q) || t.project_name.toLowerCase().includes(q))
    );
    const prio = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
    const ts = (t: DevTaskGlobal) => (t.created_at ? new Date(t.created_at).getTime() : 0);
    return [...list].sort((a, b) => {
      if (sortMode === "oldest") return ts(a) - ts(b);
      if (sortMode === "newest") return ts(b) - ts(a);
      return prio(a.priority) - prio(b.priority) || ts(b) - ts(a);
    });
  }, [tasks, search, projectFilter, sortMode]);

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
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Todos os projetos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os projetos</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
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
                  {(grouped[col.key] || []).map((t) => <DraggableCard key={t.id} task={t} />)}
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

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, Loader2, LayoutGrid, MessageSquare, AlertTriangle } from "lucide-react";
import { useDevAllTasks, useDevTaskStatusMutation, DevTaskGlobal } from "@/hooks/use-dev-workspace";

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

function TaskCard({ task }: { task: DevTaskGlobal }) {
  const move = useDevTaskStatusMutation();
  const daysLeft = task.due_date ? Math.round((new Date(task.due_date).getTime() - Date.now()) / 86400000) : null;
  const overdue = daysLeft !== null && daysLeft < 0 && task.status !== "done";
  return (
    <Card className="border hover:border-primary/40 transition-colors">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-medium leading-snug line-clamp-2">{task.title}</div>
          {task.priority && task.priority !== "medium" && (
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${PRIORITY_TONE[task.priority] || ""}`}>
              {task.priority === "high" ? "alta" : task.priority === "low" ? "baixa" : task.priority}
            </Badge>
          )}
        </div>
        <Link to={`/workspace/${task.project_id}`} className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1">
          <span className="w-2 h-2 rounded-full" style={{ background: task.module_color || "#94a3b8" }} />
          <span className="truncate">{task.project_name}</span>
        </Link>
        {task.phase_name && <div className="text-[11px] text-muted-foreground">Fase: {task.phase_name}</div>}
        {task.client_feedback === "needs_changes" && (
          <div className="text-[11px] text-amber-600 flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Cliente pediu ajustes</div>
        )}
        {task.client_feedback === "approved" && (
          <div className="text-[11px] text-emerald-600">Cliente aprovou</div>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          {task.due_date ? (
            <span className={`text-[11px] flex items-center gap-1 ${overdue ? "text-destructive" : "text-muted-foreground"}`}>
              {overdue ? <AlertTriangle className="h-3 w-3" /> : <Calendar className="h-3 w-3" />}
              {new Date(task.due_date).toLocaleDateString("pt-BR")}
            </span>
          ) : <span />}
          <Select value={task.status} onValueChange={(v) => move.mutate({ id: task.id, status: v })}>
            <SelectTrigger className="h-6 w-28 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COLUMNS.map((c) => <SelectItem key={c.key} value={c.key} className="text-xs">{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkspaceKanban() {
  const { data: tasks, isLoading } = useDevAllTasks();
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    (tasks || []).forEach((t) => map.set(t.project_id, t.project_name));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tasks || []).filter((t) =>
      (projectFilter === "all" || t.project_id === projectFilter) &&
      (!q || t.title.toLowerCase().includes(q) || t.project_name.toLowerCase().includes(q))
    );
  }, [tasks, search, projectFilter]);

  const grouped = useMemo(() => {
    const g: Record<string, DevTaskGlobal[]> = {};
    COLUMNS.forEach((c) => (g[c.key] = []));
    filtered.forEach((t) => {
      const k = COLUMNS.find((c) => c.key === t.status) ? t.status : "backlog";
      (g[k] ||= []).push(t);
    });
    return g;
  }, [filtered]);

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/workspace"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Workspace</Button></Link>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2"><LayoutGrid className="h-6 w-6 text-primary" /> Kanban global</h1>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-56" />
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Todos os projetos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os projetos</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando tarefas…</div>
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-3 xl:grid-cols-5">
            {COLUMNS.map((col) => (
              <div key={col.key} className={`rounded-lg border ${col.tone} flex flex-col min-h-[60vh]`}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-current/10">
                  <div className="font-semibold text-sm">{col.label}</div>
                  <Badge variant="secondary" className="h-5 text-[11px]">{grouped[col.key]?.length || 0}</Badge>
                </div>
                <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[70vh]">
                  {(grouped[col.key] || []).map((t) => <TaskCard key={t.id} task={t} />)}
                  {(grouped[col.key] || []).length === 0 && (
                    <div className="text-center text-xs text-muted-foreground py-6">Vazio</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}

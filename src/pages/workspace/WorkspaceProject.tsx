import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Plus, Sparkles, FileText, Upload, Send, Trash2, Copy, ExternalLink,
  RefreshCw, Calendar, AlertTriangle, Download, Bot, Zap, Bug, Wand2, Map,
} from "lucide-react";
import {
  useDevProject, useDevProjectMutations,
  useDevModules, useDevModuleMutations,
  useDevPhases, useDevPhaseMutations,
  useDevTasks, useDevTaskMutations,
  useDevKnowledge, useDevKnowledgeMutations,
  useDevAI, useDevGantt,
} from "@/hooks/use-dev-workspace";
import { isoToBrLocalInput, localInputToBrISO } from "@/lib/timezone";

const TASK_STATUS = [
  { v: "triage", label: "Triagem" },
  { v: "backlog", label: "Backlog" },
  { v: "todo", label: "A fazer" },
  { v: "doing", label: "Em andamento" },
  { v: "review", label: "Em revisão" },
  { v: "done", label: "Concluída" },
];
const TASK_TYPES = ["unclassified", "fix", "improvement", "roadmap", "support", "implementation", "feature", "chore"];
const TASK_TYPE_LABEL: Record<string, string> = {
  unclassified: "Sem triagem",
  fix: "Correção",
  improvement: "Aprimoramento",
  roadmap: "Roadmap",
  support: "Suporte",
  implementation: "Implantação",
  feature: "Feature",
  chore: "Chore",
};
const PRIORITY = ["low", "medium", "high"];
const PHASE_STATUS = [
  { v: "planned", label: "Planejada" },
  { v: "in_progress", label: "Em andamento" },
  { v: "done", label: "Concluída" },
  { v: "blocked", label: "Bloqueada" },
];

function daysUntil(d: string | null | undefined) {
  if (!d) return null;
  return Math.round((new Date(d).getTime() - Date.now()) / (24 * 3600 * 1000));
}

export default function WorkspaceProject() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { data: project, isLoading } = useDevProject(id);
  const { update, remove, regenToken } = useDevProjectMutations();
  const { data: modules } = useDevModules(id);
  const { data: phases } = useDevPhases(id);
  const { data: tasks } = useDevTasks(id);

  if (isLoading) return <MainLayout><div className="p-10 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div></MainLayout>;
  if (!project) return <MainLayout><div className="p-10">Projeto não encontrado.</div></MainLayout>;

  const totalTasks = tasks?.length || 0;
  const doneTasks = tasks?.filter(t => t.status === "done").length || 0;
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const portalUrl = `${window.location.origin}/p/${project.portal_token}`;

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" size="sm" onClick={() => nav("/workspace")}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-bold">{project.name}</h1>
            {project.description && <p className="text-sm text-muted-foreground line-clamp-1">{project.description}</p>}
          </div>
          <QuickRequestButton projectId={id} />
          <Badge variant="secondary">{doneTasks}/{totalTasks} • {pct}%</Badge>
        </div>
        <Progress value={pct} className="h-2" />

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="overview">Visão geral</TabsTrigger>
            <TabsTrigger value="setup"><Sparkles className="h-3 w-3 mr-1" /> IA setup</TabsTrigger>
            <TabsTrigger value="modules">Módulos</TabsTrigger>
            <TabsTrigger value="phases">Fases</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="inbox">Caixa de demandas</TabsTrigger>
            <TabsTrigger value="gantt">Gantt</TabsTrigger>
            <TabsTrigger value="brain"><Bot className="h-3 w-3 mr-1" /> Cérebro</TabsTrigger>
            <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
            <TabsTrigger value="portal">Portal do cliente</TabsTrigger>
            <TabsTrigger value="settings">Config</TabsTrigger>
          </TabsList>

          <TabsContent value="overview"><OverviewTab id={id} phases={phases || []} modules={modules || []} tasks={tasks || []} /></TabsContent>
          <TabsContent value="setup"><SetupTab id={id} projectDescription={project.description || ""} /></TabsContent>
          <TabsContent value="modules"><ModulesTab id={id} modules={modules || []} /></TabsContent>
          <TabsContent value="phases"><PhasesTab id={id} modules={modules || []} phases={phases || []} /></TabsContent>
          <TabsContent value="tasks"><TasksTab id={id} modules={modules || []} phases={phases || []} tasks={tasks || []} /></TabsContent>
          <TabsContent value="inbox"><InboxTab id={id} /></TabsContent>
          <TabsContent value="gantt"><GanttTab id={id} /></TabsContent>
          <TabsContent value="brain"><BrainTab id={id} /></TabsContent>
          <TabsContent value="roadmap"><RoadmapTab id={id} /></TabsContent>
          <TabsContent value="portal">
            <Card>
              <CardHeader><CardTitle className="text-base">Portal público do cliente</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={project.portal_enabled}
                    onCheckedChange={(v) => update.mutate({ id, portal_enabled: v })}
                  />
                  <span className="text-sm">Portal ativo</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input readOnly value={portalUrl} className="font-mono text-xs" />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(portalUrl); toast.success("Link copiado"); }}><Copy className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" onClick={() => window.open(portalUrl, "_blank")}><ExternalLink className="h-4 w-4" /></Button>
                </div>
                <Button size="sm" variant="ghost" onClick={() => regenToken.mutate(id)}><RefreshCw className="h-4 w-4 mr-1" /> Gerar novo link</Button>
                <p className="text-xs text-muted-foreground">O cliente vê o progresso por fase e pode enviar pedidos que caem classificados pela IA na caixa de demandas.</p>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab id={id} project={project} onDeleted={() => nav("/workspace")} />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

// -------------------- OVERVIEW --------------------
function OverviewTab({ id, phases, modules, tasks }: any) {
  const overdue = phases.filter((p: any) => p.due_date && p.status !== "done" && new Date(p.due_date).getTime() < Date.now());
  const upcoming = phases.filter((p: any) => p.due_date && p.status !== "done" && new Date(p.due_date).getTime() >= Date.now()).sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()).slice(0, 5);
  const byType = tasks.reduce((acc: any, t: any) => { acc[t.type] = (acc[t.type] || 0) + 1; return acc; }, {});
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader><CardTitle className="text-sm">Módulos</CardTitle></CardHeader>
        <CardContent className="text-3xl font-bold">{modules.length}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Fases</CardTitle></CardHeader>
        <CardContent><div className="text-3xl font-bold">{phases.length}</div><p className="text-xs text-muted-foreground">{overdue.length} atrasada(s)</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Tarefas por tipo</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {Object.entries(byType).map(([k, v]: any) => <div key={k} className="flex justify-between"><span>{TASK_TYPE_LABEL[k] || k}</span><span className="font-medium">{v as any}</span></div>)}
          {Object.keys(byType).length === 0 && <span className="text-muted-foreground">Sem tarefas</span>}
        </CardContent>
      </Card>
      <Card className="md:col-span-3">
        <CardHeader><CardTitle className="text-sm">Próximas entregas</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {upcoming.length === 0 && overdue.length === 0 && <p className="text-sm text-muted-foreground">Sem fases com prazo definido.</p>}
          {overdue.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between text-sm border border-destructive/40 bg-destructive/5 rounded p-2">
              <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> {p.name}</div>
              <span className="text-destructive font-medium">atrasada há {Math.abs(daysUntil(p.due_date) || 0)}d</span>
            </div>
          ))}
          {upcoming.map((p: any) => {
            const d = daysUntil(p.due_date)!;
            const tone = d <= 2 ? "text-yellow-600" : "text-muted-foreground";
            return (
              <div key={p.id} className="flex items-center justify-between text-sm border rounded p-2">
                <div className="flex items-center gap-2"><Calendar className="h-4 w-4" /> {p.name}</div>
                <span className={tone}>em {d}d</span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// -------------------- SETUP (IA breakdown) --------------------
function SetupTab({ id, projectDescription }: any) {
  const ai = useDevAI(id);
  const [briefing, setBriefing] = useState(projectDescription);
  const [extra, setExtra] = useState("");
  const [preview, setPreview] = useState<any | null>(null);

  const gen = async () => {
    try {
      const r = await ai.breakdown.mutateAsync({ briefing, extra_context: extra });
      setPreview(r);
    } catch (e: any) { toast.error(e.message || "Erro na IA"); }
  };
  const apply = async () => {
    if (!preview?.modules) return;
    await ai.applyBreakdown.mutateAsync({ modules: preview.modules });
    setPreview(null);
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> Setup guiado pela IA</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div><Label>Briefing do projeto</Label><Textarea rows={5} value={briefing} onChange={(e) => setBriefing(e.target.value)} placeholder="O que é? Para quem? Escopo, integrações, prazos gerais…" /></div>
        <div><Label>Contexto extra (opcional)</Label><Textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Restrições, stack já escolhida, MVP vs completo…" /></div>
        <Button disabled={!briefing || ai.breakdown.isPending} onClick={gen}>
          {ai.breakdown.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Sparkles className="h-4 w-4 mr-2" /> Sugerir estrutura</>}
        </Button>

        {preview?.modules && (
          <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Sugestão da IA — revise antes de aplicar</p>
              <Button size="sm" onClick={apply} disabled={ai.applyBreakdown.isPending}>
                {ai.applyBreakdown.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar tudo"}
              </Button>
            </div>
            {preview.modules.map((m: any, i: number) => (
              <div key={i} className="border rounded p-2 bg-background">
                <div className="font-medium flex items-center gap-2"><span className="w-3 h-3 rounded" style={{ background: m.color || "#6366f1" }} /> {m.name}</div>
                {m.description && <p className="text-xs text-muted-foreground mt-1">{m.description}</p>}
                <div className="mt-2 space-y-2 ml-2">
                  {(m.phases || []).map((ph: any, j: number) => (
                    <div key={j} className="border-l-2 border-primary/30 pl-2">
                      <div className="text-sm font-medium">{ph.name} <span className="text-xs text-muted-foreground">({ph.duration_days || 7}d)</span></div>
                      {ph.description && <p className="text-xs text-muted-foreground">{ph.description}</p>}
                      <ul className="text-xs list-disc list-inside mt-1 space-y-0.5">
                        {(ph.tasks || []).map((t: any, k: number) => (
                          <li key={k}><Badge variant="outline" className="mr-1 text-[10px]">{TASK_TYPE_LABEL[t.type] || t.type}</Badge>{t.title}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// -------------------- MODULES --------------------
function ModulesTab({ id, modules }: any) {
  const { create, update, remove } = useDevModuleMutations(id);
  const [name, setName] = useState("");
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Módulos</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do módulo" />
          <Button onClick={() => { if (name) { create.mutate({ name }); setName(""); } }}><Plus className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-2">
          {modules.map((m: any) => (
            <div key={m.id} className="flex items-center gap-2 border rounded p-2">
              <input type="color" value={m.color} onChange={(e) => update.mutate({ id: m.id, color: e.target.value })} className="w-8 h-8 rounded cursor-pointer" />
              <Input defaultValue={m.name} onBlur={(e) => e.target.value !== m.name && update.mutate({ id: m.id, name: e.target.value })} className="flex-1" />
              <Button size="icon" variant="ghost" onClick={() => remove.mutate(m.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {modules.length === 0 && <p className="text-sm text-muted-foreground">Nenhum módulo. Adicione ou use o setup por IA.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// -------------------- PHASES --------------------
function PhasesTab({ id, modules, phases }: any) {
  const { create, update, remove } = useDevPhaseMutations(id);
  const [form, setForm] = useState<{ module_id: string; name: string; due_date: string }>({ module_id: "", name: "", due_date: "" });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Fases</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid md:grid-cols-4 gap-2">
          <Select value={form.module_id || undefined} onValueChange={(v) => setForm({ ...form, module_id: v })}>
            <SelectTrigger><SelectValue placeholder="Módulo (opcional)" /></SelectTrigger>
            <SelectContent>
              {modules.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input type="datetime-local" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          <Button onClick={() => { if (form.name) { create.mutate({ name: form.name, module_id: form.module_id || null, due_date: localInputToBrISO(form.due_date) || null }); setForm({ module_id: "", name: "", due_date: "" }); } }}><Plus className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-2">
          {phases.map((p: any) => {
            const overdue = p.due_date && p.status !== "done" && new Date(p.due_date).getTime() < Date.now();
            const mod = modules.find((m: any) => m.id === p.module_id);
            return (
              <div key={p.id} className={`flex flex-wrap items-center gap-2 border rounded p-2 ${overdue ? "border-destructive/50 bg-destructive/5" : ""}`}>
                {mod && <span className="w-3 h-3 rounded-full" style={{ background: mod.color }} />}
                <Input defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && update.mutate({ id: p.id, name: e.target.value })} className="flex-1 min-w-[150px]" />
                <Input type="datetime-local" defaultValue={isoToBrLocalInput(p.due_date)} onChange={(e) => update.mutate({ id: p.id, due_date: localInputToBrISO(e.target.value) || null })} className="w-52" />
                <Select value={p.status} onValueChange={(v) => update.mutate({ id: p.id, status: v })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{PHASE_STATUS.map(s => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="icon" variant="ghost" onClick={() => remove.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
          {phases.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma fase ainda.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// -------------------- TASKS --------------------
function TasksTab({ id, modules, phases, tasks }: any) {
  const { create, update, remove } = useDevTaskMutations(id);
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [openNew, setOpenNew] = useState(false);
  const [nt, setNt] = useState<any>({ title: "", type: "feature", priority: "medium", module_id: "", phase_id: "" });

  const filtered = useMemo(() => (tasks || []).filter((t: any) => {
    if (filter !== "all" && t.status !== filter) return false;
    if (q && !(`${t.title} ${t.description || ""}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  }), [tasks, filter, q]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Tasks</CardTitle>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova task</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Input placeholder="Título" value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} />
              <Textarea placeholder="Descrição" rows={3} value={nt.description || ""} onChange={(e) => setNt({ ...nt, description: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Select value={nt.type} onValueChange={(v) => setNt({ ...nt, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TASK_TYPES.map(t => <SelectItem key={t} value={t}>{TASK_TYPE_LABEL[t]}</SelectItem>)}</SelectContent></Select>
                <Select value={nt.priority} onValueChange={(v) => setNt({ ...nt, priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRIORITY.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
                <Select value={nt.module_id || undefined} onValueChange={(v) => setNt({ ...nt, module_id: v })}><SelectTrigger><SelectValue placeholder="Módulo" /></SelectTrigger><SelectContent>{modules.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select>
                <Select value={nt.phase_id || undefined} onValueChange={(v) => setNt({ ...nt, phase_id: v })}><SelectTrigger><SelectValue placeholder="Fase" /></SelectTrigger><SelectContent>{phases.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={async () => { if (!nt.title) return; await create.mutateAsync(nt); setNt({ title: "", type: "feature", priority: "medium", module_id: "", phase_id: "" }); setOpenNew(false); }}>Criar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas</SelectItem>{TASK_STATUS.map(s => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent></Select>
        </div>
        <TriagePanel projectId={id} tasks={tasks || []} />
        <div className="space-y-2">
          {filtered.map((t: any) => {
            const mod = modules.find((m: any) => m.id === t.module_id);
            const ph = phases.find((p: any) => p.id === t.phase_id);
            return (
              <div key={t.id} className="border rounded p-2 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{TASK_TYPE_LABEL[t.type] || t.type}</Badge>
                  <Badge variant={t.priority === "high" ? "destructive" : "secondary"}>{t.priority}</Badge>
                  {t.source === "client" && <Badge className="bg-blue-500">cliente</Badge>}
                  {t.source === "ai" && <Badge className="bg-purple-500">IA</Badge>}
                  <Input defaultValue={t.title} onBlur={(e) => e.target.value !== t.title && update.mutate({ id: t.id, title: e.target.value })} className="flex-1 min-w-[180px]" />
                  <Select value={t.status} onValueChange={(v) => update.mutate({ id: t.id, status: v })}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>{TASK_STATUS.map(s => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
                {(mod || ph) && <div className="text-xs text-muted-foreground pl-1">{mod?.name} {ph && `• ${ph.name}`}</div>}
                {t.description && <p className="text-xs text-muted-foreground pl-1 whitespace-pre-wrap">{t.description}</p>}
                {t.ai_reasoning && <p className="text-xs text-purple-600 italic pl-1">IA: {t.ai_reasoning}</p>}
              </div>
            );
          })}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma task neste filtro.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// -------------------- INBOX (classify demand) --------------------
function InboxTab({ id }: any) {
  const ai = useDevAI(id);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<any | null>(null);

  const classify = async (create: boolean) => {
    try {
      const r = await ai.classify.mutateAsync({ text, create });
      if (create) { toast.success("Task criada"); setText(""); setPreview(null); }
      else setPreview(r.classification);
    } catch (e: any) { toast.error(e.message || "Erro"); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Caixa de demandas</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Cole o que o cliente pediu. A IA classifica em módulo, fase e tipo (suporte / implantação / correção / feature).</p>
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex: Cliente pediu para adicionar botão de exportar Excel no relatório de vendas…" />
        <div className="flex gap-2">
          <Button variant="outline" disabled={!text || ai.classify.isPending} onClick={() => classify(false)}>{ai.classify.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analisar"}</Button>
          <Button disabled={!text || ai.classify.isPending} onClick={() => classify(true)}>{ai.classify.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-1" /> Analisar + Criar</>}</Button>
        </div>
        {preview && (
          <div className="border rounded p-3 bg-muted/30 text-sm space-y-1">
            <div><strong>Título:</strong> {preview.title}</div>
            <div><strong>Tipo:</strong> {TASK_TYPE_LABEL[preview.type] || preview.type} • <strong>Prioridade:</strong> {preview.priority}</div>
            {preview.description && <div><strong>Detalhes:</strong> {preview.description}</div>}
            {preview.reasoning && <div className="text-purple-700 italic">IA: {preview.reasoning}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// -------------------- GANTT --------------------
function GanttTab({ id }: any) {
  const { data } = useDevGantt(id);
  const phases = data?.phases || [];
  if (phases.length === 0) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Adicione fases com datas para visualizar o Gantt.</CardContent></Card>;

  const validDates = phases.filter((p: any) => p.start_date && p.due_date);
  if (validDates.length === 0) return <Card><CardContent className="p-6 text-sm text-muted-foreground">As fases precisam de data de início e prazo para aparecer no Gantt.</CardContent></Card>;

  const minStart = Math.min(...validDates.map((p: any) => new Date(p.start_date).getTime()));
  const maxEnd = Math.max(...validDates.map((p: any) => new Date(p.due_date).getTime()));
  const range = Math.max(1, maxEnd - minStart);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Gantt das fases</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {phases.map((p: any) => {
          if (!p.start_date || !p.due_date) return (
            <div key={p.id} className="flex items-center gap-3 text-xs">
              <div className="w-40 shrink-0 truncate">{p.name}</div>
              <span className="text-muted-foreground">sem datas</span>
            </div>
          );
          const left = ((new Date(p.start_date).getTime() - minStart) / range) * 100;
          const width = Math.max(1, ((new Date(p.due_date).getTime() - new Date(p.start_date).getTime()) / range) * 100);
          const bg = p.deadline_status === "overdue" ? "bg-destructive" : p.deadline_status === "warning" ? "bg-yellow-500" : (p.module_color || "bg-primary");
          return (
            <div key={p.id} className="flex items-center gap-3 text-xs">
              <div className="w-40 shrink-0 truncate">{p.name}</div>
              <div className="relative flex-1 h-6 bg-muted rounded">
                <div className={`absolute top-0 bottom-0 rounded ${typeof bg === "string" && bg.startsWith("#") ? "" : bg}`} style={{ left: `${left}%`, width: `${width}%`, background: typeof bg === "string" && bg.startsWith("#") ? bg : undefined }} />
              </div>
              <div className="w-24 shrink-0 text-right text-muted-foreground">{new Date(p.due_date).toLocaleDateString("pt-BR")}</div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// -------------------- BRAIN --------------------
function BrainTab({ id }: any) {
  const { data: docs } = useDevKnowledge(id);
  const { create, remove } = useDevKnowledgeMutations(id);
  const ai = useDevAI(id);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  const onFile = async (f: File) => {
    const text = await f.text();
    setTitle(f.name);
    setContent(text);
  };
  const save = async () => {
    if (!title || !content) return;
    await create.mutateAsync({ title, content, kind: "markdown" });
    setTitle(""); setContent("");
  };
  const ask = async () => {
    if (!question) return;
    setAnswer(null);
    const r = await ai.ask.mutateAsync({ question });
    setAnswer(r.answer);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Documentos do cérebro</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <label className="inline-flex items-center gap-1 border rounded px-3 py-1.5 cursor-pointer hover:bg-muted text-sm">
              <Upload className="h-4 w-4" /> Subir .md / .txt
              <input type="file" accept=".md,.txt,.markdown" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
          </div>
          <Input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea rows={6} placeholder="Conteúdo em markdown…" value={content} onChange={(e) => setContent(e.target.value)} />
          <Button disabled={!title || !content || create.isPending} onClick={save}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Indexar no cérebro"}</Button>
          <div className="space-y-1 pt-3 border-t">
            {(docs || []).map((d: any) => (
              <div key={d.id} className="flex items-center gap-2 text-sm border rounded p-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{d.preview}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove.mutate(d.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {(docs || []).length === 0 && <p className="text-xs text-muted-foreground">Nenhum documento ainda.</p>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Bot className="h-4 w-4" /> Perguntar ao cérebro</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={3} placeholder="Ex: quais features já estão prontas nesse projeto?" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Button disabled={!question || ai.ask.isPending} onClick={ask}>{ai.ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Perguntar"}</Button>
          {answer && <div className="border rounded p-3 bg-muted/30 text-sm whitespace-pre-wrap">{answer}</div>}
        </CardContent>
      </Card>
    </div>
  );
}

// -------------------- ROADMAP --------------------
function RoadmapTab({ id }: any) {
  const ai = useDevAI(id);
  const [md, setMd] = useState<string | null>(null);
  const gen = async () => {
    const r = await ai.roadmap.mutateAsync();
    setMd(r.markdown);
  };
  const download = () => {
    if (!md) return;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `roadmap-${id}.md`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Roadmap gerado por IA</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Button disabled={ai.roadmap.isPending} onClick={gen}>{ai.roadmap.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Sparkles className="h-4 w-4 mr-1" /> Gerar roadmap</>}</Button>
          {md && <Button variant="outline" onClick={download}><Download className="h-4 w-4 mr-1" /> Baixar .md</Button>}
        </div>
        {md && <pre className="text-sm whitespace-pre-wrap border rounded p-3 bg-muted/30 max-h-[60vh] overflow-y-auto">{md}</pre>}
      </CardContent>
    </Card>
  );
}

// -------------------- SETTINGS --------------------
function SettingsTab({ id, project, onDeleted }: any) {
  const { update, remove } = useDevProjectMutations();
  const [form, setForm] = useState({ name: project.name, description: project.description || "", status: project.status });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Configurações do projeto</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><Label>Descrição</Label><Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div><Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="paused">Pausado</SelectItem>
              <SelectItem value="archived">Arquivado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => update.mutate({ id, ...form })} disabled={update.isPending}>{update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}</Button>
          <Button variant="destructive" onClick={() => { if (confirm("Remover este projeto? Ação irreversível.")) { remove.mutate(id, { onSuccess: () => onDeleted() }); } }}><Trash2 className="h-4 w-4 mr-1" /> Excluir</Button>
        </div>
      </CardContent>
    </Card>
  );
}
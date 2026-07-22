import { useState } from "react";
import { Link } from "react-router-dom";
import MainLayout from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, FolderKanban, Calendar, AlertTriangle } from "lucide-react";
import { useDevProjects, useDevProjectMutations } from "@/hooks/use-dev-workspace";

function daysUntil(d: string | null | undefined) {
  if (!d) return null;
  const diff = new Date(d).getTime() - Date.now();
  return Math.round(diff / (24 * 3600 * 1000));
}

export default function WorkspaceHome() {
  const { data: projects, isLoading } = useDevProjects();
  const { create } = useDevProjectMutations();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <FolderKanban className="h-7 w-7 text-primary" /> Workspace
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Seus SaaS e projetos com IA, fases e portal do cliente.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Novo projeto</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo projeto</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Igreja X — Plataforma" /></div>
                <div><Label>Descrição inicial</Label><Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="O que é o projeto? Quem é o cliente? Escopo alto nível?" /></div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button
                  disabled={!form.name || create.isPending}
                  onClick={async () => {
                    await create.mutateAsync(form);
                    setForm({ name: "", description: "" });
                    setOpen(false);
                  }}
                >{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>}

        {!isLoading && (projects?.length ?? 0) === 0 && (
          <Card><CardContent className="p-10 text-center text-muted-foreground">Nenhum projeto ainda. Crie o primeiro para começar.</CardContent></Card>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(projects || []).map((p) => {
            const total = p.total_tasks || 0;
            const done = p.done_tasks || 0;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const days = daysUntil(p.next_due);
            const deadlineTone = days == null ? "muted" : days < 0 ? "destructive" : days <= 2 ? "warning" : "ok";
            return (
              <Link to={`/workspace/${p.id}`} key={p.id}>
                <Card className="hover:border-primary/50 transition-all h-full">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-start justify-between gap-2">
                      <span className="line-clamp-2">{p.name}</span>
                      <Badge variant={p.status === "active" ? "default" : "secondary"} className="shrink-0">{p.status}</Badge>
                    </CardTitle>
                    {p.description && <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{done}/{total} tarefas</span>
                        <span>{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Calendar className="h-3.5 w-3.5" />
                      {days == null ? (
                        <span className="text-muted-foreground">sem prazo definido</span>
                      ) : days < 0 ? (
                        <span className="text-destructive font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> atrasado {Math.abs(days)}d</span>
                      ) : days <= 2 ? (
                        <span className="text-yellow-600 font-medium">vence em {days}d</span>
                      ) : (
                        <span className="text-muted-foreground">próxima entrega em {days}d</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </MainLayout>
  );
}
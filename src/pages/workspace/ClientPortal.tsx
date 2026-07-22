import { useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Calendar, CheckCircle2, ThumbsUp, RefreshCw, Sparkles, List } from "lucide-react";
import { toast } from "sonner";
import { useDevPortal, submitPortalRequest, submitPortalFeedback, submitPortalBulkRequests } from "@/hooks/use-dev-workspace";

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  triage: { label: "Triagem", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  backlog: { label: "Na fila", tone: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  in_progress: { label: "Em andamento", tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  testing: { label: "Em teste — sua vez!", tone: "bg-purple-500/15 text-purple-700 dark:text-purple-300" },
  done: { label: "Concluído", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

export default function ClientPortal() {
  const { token = "" } = useParams();
  const { data, isLoading, error, refetch } = useDevPortal(token);
  const [form, setForm] = useState({ title: "", description: "", contact_email: "" });
  const [sending, setSending] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState<Record<string, string>>({});
  const [feedbackLoading, setFeedbackLoading] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [bulkText, setBulkText] = useState("");
  const [bulkSending, setBulkSending] = useState(false);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error || !data) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Portal indisponível.</div>;

  const { project, phases = [], modules = [], tasks = [] } = data;
  const totalDone = phases.filter((p: any) => p.status === "done").length;
  const pct = phases.length > 0 ? Math.round((totalDone / phases.length) * 100) : 0;

  const send = async () => {
    if (!form.title) return;
    setSending(true);
    try {
      await submitPortalRequest(token, form);
      toast.success("Pedido enviado! A equipe já foi notificada.");
      setForm({ title: "", description: "", contact_email: "" });
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setSending(false); }
  };

  const sendBulk = async () => {
    const lines = bulkText.split(/\n/).filter((l) => l.trim().length >= 3);
    if (!lines.length) { toast.error("Cole ao menos uma demanda por linha."); return; }
    setBulkSending(true);
    try {
      const r = await submitPortalBulkRequests(token, { text: bulkText, contact_email: form.contact_email || undefined });
      toast.success(`${r.created} solicitações enviadas — a IA vai classificar em segundos.`);
      setBulkText("");
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setBulkSending(false); }
  };

  const sendFeedback = async (taskId: string, feedback: "approved" | "needs_changes") => {
    setFeedbackLoading(taskId + feedback);
    try {
      await submitPortalFeedback(token, taskId, { feedback, note: feedbackNote[taskId] });
      toast.success(feedback === "approved" ? "Aprovado! Obrigado." : "Ajustes solicitados, a equipe foi avisada.");
      setFeedbackNote((n) => ({ ...n, [taskId]: "" }));
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setFeedbackLoading(null); }
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold">{project.name}</h1>
          {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Progresso geral</CardTitle></CardHeader>
          <CardContent>
            <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>{totalDone}/{phases.length} fases</span><span>{pct}%</span></div>
            <Progress value={pct} className="h-3" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Minhas solicitações</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {tasks.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma solicitação ainda. Envie a primeira abaixo.</p>}
            {tasks.map((t: any) => {
              const st = STATUS_LABEL[t.status] || { label: t.status, tone: "bg-muted" };
              const canTest = t.status === "testing" && !t.client_feedback;
              return (
                <div key={t.id} className="border rounded p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{t.title}</div>
                      {t.description && <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{t.description}</div>}
                    </div>
                    <Badge className={`${st.tone} border-0 shrink-0`}>{st.label}</Badge>
                  </div>
                  {t.client_feedback === "approved" && (
                    <div className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Você aprovou esta entrega</div>
                  )}
                  {t.client_feedback === "needs_changes" && (
                    <div className="text-xs text-amber-600 flex items-center gap-1"><RefreshCw className="h-3.5 w-3.5" /> Ajustes solicitados — a equipe vai retomar</div>
                  )}
                  {canTest && (
                    <div className="space-y-2 pt-1 border-t">
                      <p className="text-xs text-muted-foreground">Está pronto para você testar. Deu tudo certo?</p>
                      <Textarea
                        rows={2}
                        placeholder="Comentário (opcional)"
                        value={feedbackNote[t.id] || ""}
                        onChange={(e) => setFeedbackNote((n) => ({ ...n, [t.id]: e.target.value }))}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => sendFeedback(t.id, "approved")}
                          disabled={feedbackLoading === t.id + "approved"}
                        >
                          {feedbackLoading === t.id + "approved" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ThumbsUp className="h-4 w-4 mr-1" />}
                          Aprovar (marcar como concluído)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => sendFeedback(t.id, "needs_changes")}
                          disabled={feedbackLoading === t.id + "needs_changes"}
                        >
                          {feedbackLoading === t.id + "needs_changes" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                          Solicitar ajustes
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Fases</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {phases.map((p: any) => {
              const mod = modules.find((m: any) => m.id === p.module_id);
              const done = p.status === "done";
              return (
                <div key={p.id} className="border rounded p-3 flex items-center gap-3">
                  {done ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    {mod && <div className="text-xs text-muted-foreground flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: mod.color }} /> {mod.name}</div>}
                  </div>
                  {p.due_date && <Badge variant={done ? "secondary" : "outline"} className="shrink-0"><Calendar className="h-3 w-3 mr-1" /> {new Date(p.due_date).toLocaleDateString("pt-BR")}</Badge>}
                </div>
              );
            })}
            {phases.length === 0 && <p className="text-sm text-muted-foreground">Fases ainda não definidas.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Enviar pedido{mode === "bulk" ? "s (lote)" : ""}
              </CardTitle>
              <div className="flex gap-1">
                <Button size="sm" variant={mode === "single" ? "default" : "outline"} onClick={() => setMode("single")}>
                  <Send className="h-3.5 w-3.5 mr-1" /> Um por vez
                </Button>
                <Button size="sm" variant={mode === "bulk" ? "default" : "outline"} onClick={() => setMode("bulk")}>
                  <List className="h-3.5 w-3.5 mr-1" /> Vários (IA)
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {mode === "single" ? (
              <>
                <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Resumo do que você precisa" /></div>
                <div><Label>Detalhes</Label><Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descreva o pedido, print, contexto…" /></div>
                <div><Label>Seu e-mail (opcional)</Label><Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
                <Button onClick={send} disabled={!form.title || sending}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" /> Enviar</>}</Button>
              </>
            ) : (
              <>
                <div>
                  <Label>Cole várias demandas (uma por linha ou separadas por linha em branco)</Label>
                  <Textarea
                    rows={8}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder={"Ex.:\n- Erro ao exportar relatório de vendas\n- Adicionar filtro por data no CRM\n- Ajustar cor do botão de login"}
                  />
                  <p className="text-xs text-muted-foreground mt-1">A IA vai classificar automaticamente (tipo, módulo, prioridade) — até 50 por envio.</p>
                </div>
                <div><Label>Seu e-mail (opcional)</Label><Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
                <Button onClick={sendBulk} disabled={!bulkText.trim() || bulkSending}>
                  {bulkSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Enviar lote e classificar com IA
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
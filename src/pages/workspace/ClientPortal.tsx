import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Calendar, CheckCircle2, ThumbsUp, RefreshCw, Sparkles, List, Plus, ImagePlus, X, User, Building2, Filter } from "lucide-react";
import { toast } from "sonner";
import { API_URL } from "@/lib/api";
import {
  useDevPortal, submitPortalRequest, submitPortalFeedback, submitPortalBulkRequests,
  fetchPortalDepartments, createPortalDepartment, uploadPortalImage,
} from "@/hooks/use-dev-workspace";

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
  const [form, setForm] = useState({ title: "", description: "", contact_email: "", requester_name: "", department: "" });
  const [sending, setSending] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState<Record<string, string>>({});
  const [feedbackLoading, setFeedbackLoading] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [bulkText, setBulkText] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  // Departamentos (cadastráveis pelo cliente com o botão "+")
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [addingDept, setAddingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [savingDept, setSavingDept] = useState(false);
  // Imagem anexada à solicitação
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Filtros da lista de solicitações
  const [filterDept, setFilterDept] = useState<string>("all");
  const [filterRequester, setFilterRequester] = useState<string>("all");

  const loadDepartments = async () => {
    if (!token) return;
    try {
      const list = await fetchPortalDepartments(token);
      setDepartments(list);
    } catch { /* silencioso */ }
  };

  useEffect(() => {
    loadDepartments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, data?.project?.id]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error || !data) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Portal indisponível.</div>;

  const { project, phases = [], modules = [], tasks = [] } = data;
  const totalDone = phases.filter((p: any) => p.status === "done").length;
  const pct = phases.length > 0 ? Math.round((totalDone / phases.length) * 100) : 0;

  // Departamentos vindos do servidor + digitados manualmente em solicitações
  const allDepartments = useMemo(() => {
    const set = new Set<string>();
    departments.forEach((d) => d.name && set.add(d.name));
    tasks.forEach((t: any) => t.department && set.add(t.department));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [departments, tasks]);

  // Solicitantes distintos (quem pediu)
  const allRequesters = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t: any) => t.requester_name && set.add(t.requester_name));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [tasks]);

  // Lista filtrada por departamento e/ou solicitante
  const filteredTasks = useMemo(() => {
    return (tasks as any[]).filter(
      (t) =>
        (filterDept === "all" || (t.department || "") === filterDept) &&
        (filterRequester === "all" || (t.requester_name || "") === filterRequester)
    );
  }, [tasks, filterDept, filterRequester]);

  const resolveImageUrl = (url: string) => {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  const handleSelectImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Selecione um arquivo de imagem."); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("A imagem deve ter no máximo 10MB."); return; }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const handleAddDepartment = async () => {
    const name = newDeptName.trim();
    if (!name) return;
    setSavingDept(true);
    try {
      const created = await createPortalDepartment(token, name);
      toast.success(`Departamento "${created.name}" cadastrado.`);
      setNewDeptName("");
      setAddingDept(false);
      await loadDepartments();
      setForm((f) => ({ ...f, department: created.name }));
    } catch (e: any) { toast.error(e.message); } finally { setSavingDept(false); }
  };

  const send = async () => {
    if (!form.title) return;
    setSending(true);
    try {
      let image_url: string | undefined;
      if (imageFile) {
        setUploadingImage(true);
        try {
          const up = await uploadPortalImage(token, imageFile);
          image_url = up.url;
        } finally { setUploadingImage(false); }
      }
      await submitPortalRequest(token, { ...form, image_url });
      toast.success("Pedido enviado! A equipe já foi notificada.");
      setForm({ title: "", description: "", contact_email: form.contact_email, requester_name: form.requester_name, department: form.department });
      setImageFile(null);
      setImagePreview(null);
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setSending(false); }
  };

  const sendBulk = async () => {
    const lines = bulkText.split(/\n/).filter((l) => l.trim().length >= 3);
    if (!lines.length) { toast.error("Cole ao menos uma demanda por linha."); return; }
    setBulkSending(true);
    try {
      const r = await submitPortalBulkRequests(token, {
        text: bulkText,
        contact_email: form.contact_email || undefined,
        requester_name: form.requester_name || undefined,
        department: form.department || undefined,
      });
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
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Minhas solicitações</CardTitle>
              {(allDepartments.length > 0 || allRequesters.length > 0) && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Filter className="h-3 w-3" /> Filtrar:</span>
                  {allDepartments.length > 0 && (
                    <Select value={filterDept} onValueChange={setFilterDept}>
                      <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Departamento" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os deptos.</SelectItem>
                        {allDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {allRequesters.length > 0 && (
                    <Select value={filterRequester} onValueChange={setFilterRequester}>
                      <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Solicitante" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os solicitantes</SelectItem>
                        {allRequesters.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma solicitação ainda. Envie a primeira abaixo.</p>}
            {tasks.length > 0 && filteredTasks.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma solicitação com esses filtros.</p>}
            {filteredTasks.map((t: any) => {
              const st = STATUS_LABEL[t.status] || { label: t.status, tone: "bg-muted" };
              const canTest = t.status === "testing" && !t.client_feedback;
              return (
                <div key={t.id} className="border rounded p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{t.title}</div>
                      {t.description && <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{t.description}</div>}
                      {(t.requester_name || t.department) && (
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          {t.requester_name && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> {t.requester_name}</span>
                          )}
                          {t.department && (
                            <Badge variant="outline" className="text-xs flex items-center gap-1"><Building2 className="h-3 w-3" /> {t.department}</Badge>
                          )}
                        </div>
                      )}
                      {t.image_url && (
                        <a href={resolveImageUrl(t.image_url)} target="_blank" rel="noreferrer" className="block mt-2">
                          <img src={resolveImageUrl(t.image_url)} alt="Anexo da solicitação" className="rounded border max-h-48 object-contain" loading="lazy" />
                        </a>
                      )}
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
            {/* Identificação do solicitante + departamento (vale para os dois modos) */}
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> Quem está solicitando?</Label>
                <Input
                  value={form.requester_name}
                  onChange={(e) => setForm({ ...form, requester_name: e.target.value })}
                  placeholder="Digite seu nome"
                />
              </div>
              <div>
                <Label className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> Departamento</Label>
                {allDepartments.length > 0 ? (
                  <div className="flex gap-1">
                    <Select
                      value={form.department || "__none"}
                      onValueChange={(v) => setForm({ ...form, department: v === "__none" ? "" : v })}
                    >
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione o departamento" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Sem departamento</SelectItem>
                        {allDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button size="icon" variant="outline" title="Cadastrar departamento" onClick={() => setAddingDept((v) => !v)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <Input
                      value={form.department}
                      onChange={(e) => setForm({ ...form, department: e.target.value })}
                      placeholder="Ex.: Financeiro, Vendas…"
                    />
                    <Button size="icon" variant="outline" title="Cadastrar departamento" onClick={() => setAddingDept((v) => !v)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {addingDept && (
                  <div className="flex gap-1 mt-2">
                    <Input
                      value={newDeptName}
                      onChange={(e) => setNewDeptName(e.target.value)}
                      placeholder="Nome do novo departamento"
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddDepartment(); }}
                    />
                    <Button size="sm" onClick={handleAddDepartment} disabled={!newDeptName.trim() || savingDept}>
                      {savingDept ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
            {mode === "single" ? (
              <>
                <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Resumo do que você precisa" /></div>
                <div><Label>Detalhes</Label><Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descreva o pedido, contexto…" /></div>
                <div>
                  <Label className="flex items-center gap-1"><ImagePlus className="h-3.5 w-3.5" /> Imagem (opcional)</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleSelectImage(e.target.files?.[0])}
                  />
                  {!imagePreview ? (
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                      <ImagePlus className="h-4 w-4 mr-2" /> Anexar imagem
                    </Button>
                  ) : (
                    <div className="relative inline-block">
                      <img src={imagePreview} alt="Prévia" className="rounded border max-h-40 object-contain" />
                      <Button
                        type="button" size="icon" variant="destructive"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={() => { setImageFile(null); setImagePreview(null); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">JPG, PNG, GIF ou WEBP — até 10MB.</p>
                </div>
                <div><Label>Seu e-mail (opcional)</Label><Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
                <Button onClick={send} disabled={!form.title || sending || uploadingImage}>
                  {sending || uploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" /> Enviar</>}
                </Button>
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
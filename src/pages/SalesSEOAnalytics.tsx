import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search,
  Plus,
  BarChart3,
  TrendingUp,
  Target,
  Users,
  MessageSquare,
  Clock,
  Trash2,
  Brain,
  Filter,
  Sparkles,
  Loader2,
  Info,
} from "lucide-react";
import { useSalesSeo, SalesSeoTracker, SalesSeoAnalytics, SalesSeoLead } from "@/hooks/use-sales-seo";
import { useConnections } from "@/hooks/use-connections";
import { format, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
} from "recharts";
import { toast } from "sonner";

export default function SalesSEOAnalytics() {
  const { getTrackers, createTracker, deleteTracker, getAnalytics, getLeads, analyzeIA } = useSalesSeo();
  const { data: connections } = useConnections();
  
  const [trackers, setTrackers] = useState<SalesSeoTracker[]>([]);
  const [analytics, setAnalytics] = useState<SalesSeoAnalytics | null>(null);
  const [leads, setLeads] = useState<SalesSeoLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analysisDialog, setAnalysisDialog] = useState<{ open: boolean; lead: SalesSeoLead | null; analysis: any }>({ open: false, lead: null, analysis: null });
  
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTracker, setNewTracker] = useState({ name: "", phrase: "", connection_ids: [] as string[] });
  
  const [filterTracker, setFilterTracker] = useState("all");
  const [filterConnection, setFilterConnection] = useState("all");
  const [datePreset, setDatePreset] = useState("this_month");
  const [customRange, setCustomRange] = useState<{from: Date, to: Date} | null>(null);

  const getDateRange = () => {
    const now = new Date();
    switch (datePreset) {
      case "today":
        return { start: startOfDay(now), end: endOfDay(now) };
      case "last_7":
        return { start: startOfDay(subDays(now, 7)), end: endOfDay(now) };
      case "last_30":
        return { start: startOfDay(subDays(now, 30)), end: endOfDay(now) };
      case "this_month":
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case "last_month":
        const lastMonth = subMonths(now, 1);
        return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
      case "custom":
        return customRange ? { start: startOfDay(customRange.from), end: endOfDay(customRange.to) } : { start: startOfMonth(now), end: endOfMonth(now) };
      default:
        return { start: startOfMonth(now), end: endOfMonth(now) };
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const range = getDateRange();
      const params = { 
        tracker_id: filterTracker === "all" ? "" : filterTracker,
        connection_id: filterConnection === "all" ? "" : filterConnection,
        start_date: range.start.toISOString(),
        end_date: range.end.toISOString()
      };
      
      const [tList, stats, leadList] = await Promise.all([
        getTrackers(),
        getAnalytics(params),
        getLeads(params)
      ]);
      setTrackers(tList);
      setAnalytics(stats);
      setLeads(leadList);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filterTracker, filterConnection, datePreset, customRange]);

  const handleCreateTracker = async () => {
    if (!newTracker.name || !newTracker.phrase) return;
    try {
      await createTracker(newTracker);
      toast.success("Rastreador criado");
      setShowCreateDialog(false);
      setNewTracker({ name: "", phrase: "", connection_ids: [] });
      fetchData();
    } catch (err) {
      toast.error("Erro ao criar rastreador");
    }
  };

  const handleAnalyzeIA = async (leadId: string) => {
    setAnalyzingId(leadId);
    try {
      const res: any = await analyzeIA(leadId);
      toast.success("Análise concluída");
      await fetchData();
      const updated = leads.find(l => l.id === leadId) || null;
      setAnalysisDialog({ open: true, lead: updated, analysis: res?.analysis || null });
    } catch (err) {
      toast.error("Erro na análise de IA");
    } finally {
      setAnalyzingId(null);
    }
  };

  const openAnalysis = (lead: SalesSeoLead) => {
    let analysis: any = null;
    try {
      analysis = typeof lead.ia_analysis === 'string' ? JSON.parse(lead.ia_analysis as any) : lead.ia_analysis;
    } catch { analysis = { resumo: String(lead.ia_analysis) }; }
    setAnalysisDialog({ open: true, lead, analysis });
  };

  const handleDeleteTracker = async (id: string) => {
    if (!confirm("Tem certeza?")) return;
    try {
      await deleteTracker(id);
      toast.success("Rastreador excluído");
      fetchData();
    } catch (err) {
      toast.error("Erro ao excluir rastreador");
    }
  };

  const evolutionStatusMap = {
    1: { label: "Nova", color: "bg-blue-100 text-blue-700" },
    2: { label: "Engajada", color: "bg-amber-100 text-amber-700" },
    3: { label: "Venda", color: "bg-green-100 text-green-700" },
    4: { label: "Perda", color: "bg-red-100 text-red-700" },
  };

  return (
    <TooltipProvider>
      <MainLayout>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Target className="h-6 w-6 text-primary" />
                  Análise de Vendas e SEO
                </h1>
                <TooltipUI>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Este painel permite rastrear leads originados de frases específicas no WhatsApp, ajudando a identificar quais campanhas de SEO ou anúncios estão gerando conversas.</p>
                  </TooltipContent>
                </TooltipUI>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Rastreie a origem de conversas e analise o funil de vendas via WhatsApp
              </p>
            </div>
          <div className="flex items-center gap-3">
             <Select value={datePreset} onValueChange={setDatePreset}>
              <SelectTrigger className="w-40">
                <Clock className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="last_7">Últimos 7 dias</SelectItem>
                <SelectItem value="last_30">Últimos 30 dias</SelectItem>
                <SelectItem value="this_month">Este Mês</SelectItem>
                <SelectItem value="last_month">Mês Passado</SelectItem>
              </SelectContent>
            </Select>

             <Select value={filterTracker} onValueChange={setFilterTracker}>
              <SelectTrigger className="w-44">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Rastreador" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os canais</SelectItem>
                {trackers.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
             <Select value={filterConnection} onValueChange={setFilterConnection}>
              <SelectTrigger className="w-44">
                <MessageSquare className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Conexão" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas conexões</SelectItem>
                {connections?.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Canal
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total de Leads</CardTitle>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Número total de contatos únicos que iniciaram conversa com as frases cadastradas.</p>
                </TooltipContent>
              </TooltipUI>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics?.stats?.total || 0}</div>
              <p className="text-xs text-muted-foreground">Capturados via frase</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">Engajados</CardTitle>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Contatos que responderam ao menos uma vez após a mensagem inicial.</p>
                </TooltipContent>
              </TooltipUI>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{analytics?.stats?.engaged || 0}</div>
              <p className="text-xs text-muted-foreground">Retenção: {analytics?.stats?.total ? Math.round((analytics.stats.engaged / analytics.stats.total) * 100) : 0}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">Vendas</CardTitle>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Leads que chegaram ao status de "Venda" no funil de atendimento.</p>
                </TooltipContent>
              </TooltipUI>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{analytics?.stats?.converted || 0}</div>
              <p className="text-xs text-muted-foreground">Taxa: {analytics?.stats?.total ? Math.round((analytics.stats.converted / analytics.stats.total) * 100) : 0}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">Novos (24h)</CardTitle>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Leads capturados nas últimas 24 horas que ainda não tiveram interação profunda.</p>
                </TooltipContent>
              </TooltipUI>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{analytics?.stats?.just_arrived || 0}</div>
              <p className="text-xs text-muted-foreground">Aguardando atendimento</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">Perdas</CardTitle>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Leads identificados como perda pelo sistema (churn ou desistência).</p>
                </TooltipContent>
              </TooltipUI>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{analytics?.stats?.lost || 0}</div>
              <p className="text-xs text-muted-foreground">Taxa: {analytics?.stats?.total ? Math.round((analytics.stats.lost / analytics.stats.total) * 100) : 0}%</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Evolução Diária
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics?.daily || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => format(new Date(val), "dd/MM")}
                    fontSize={12}
                  />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Line type="monotone" dataKey="total" name="Leads" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="converted" name="Vendas" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" /> Novos vs Engajados
              </CardTitle>
              <CardDescription>Comparativo de retenção (Quantitativo)</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
               <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics?.daily || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(val) => format(new Date(val), "dd/MM")}
                    fontSize={12}
                  />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="just_arrived" name="Novos" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="engaged" name="Engajados" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Desempenho Mensal
              </CardTitle>
              <CardDescription>Quantidade de leads mapeados vs atendidos por mês</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics?.monthly || []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="month" 
                    tickFormatter={(val) => {
                      const [year, month] = val.split('-');
                      const date = new Date(parseInt(year), parseInt(month) - 1);
                      return format(date, "MMM/yy", { locale: ptBR });
                    }}
                    fontSize={12}
                  />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Line type="monotone" dataKey="total" name="Mapeados (Leads)" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="attended" name="Atendidos" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="leads">
          <TabsList>
            <TabsTrigger value="leads">Conversas Recentes</TabsTrigger>
            <TabsTrigger value="canais">Configuração de Canais</TabsTrigger>
          </TabsList>

          <TabsContent value="leads" className="pt-4">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">Data</th>
                        <th className="text-left p-3 font-medium">Canal</th>
                        <th className="text-left p-3 font-medium">Contato</th>
                        <th className="text-left p-3 font-medium">Frase</th>
                        <th className="text-center p-3 font-medium">Status</th>
                        <th className="text-right p-3 font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map(lead => (
                        <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-3 whitespace-nowrap">{format(new Date(lead.created_at), "dd/MM HH:mm")}</td>
                          <td className="p-3 font-medium">{lead.tracker_name}</td>
                          <td className="p-3">
                            <div className="flex flex-col">
                              <span>{lead.contact_name || lead.phone}</span>
                              <span className="text-xs text-muted-foreground">{lead.connection_name}</span>
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground truncate max-w-[200px]">{lead.entry_message}</td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Badge variant="secondary" className={evolutionStatusMap[lead.evolution_status as keyof typeof evolutionStatusMap]?.color}>
                                {evolutionStatusMap[lead.evolution_status as keyof typeof evolutionStatusMap]?.label}
                              </Badge>
                              {lead.ia_analysis && (
                                <button
                                  type="button"
                                  onClick={() => openAnalysis(lead)}
                                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                                  title="Ver análise da IA"
                                >
                                  <Brain className="h-4 w-4" />
                                  {lead.ia_analyzed_at && (
                                    <span className="text-muted-foreground">
                                      {format(new Date(lead.ia_analyzed_at), "dd/MM HH:mm")}
                                    </span>
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-right">
                             <div className="flex items-center justify-end gap-2">
                               <Button 
                                 variant="outline" 
                                 size="icon" 
                                 onClick={() => handleAnalyzeIA(lead.id)}
                                 disabled={analyzingId === lead.id}
                                 title={lead.ia_analyzed_at ? `Reanalisar (última: ${format(new Date(lead.ia_analyzed_at), "dd/MM HH:mm")})` : "Analisar com IA"}
                               >
                                 {analyzingId === lead.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                               </Button>
                               <Button 
                                 variant="ghost" 
                                 size="icon" 
                                 onClick={() => window.open(`/chat?conversationId=${lead.conversation_id}`, '_blank')}
                                 title="Ir para o Chat"
                               >
                                 <MessageSquare className="h-4 w-4" />
                               </Button>
                             </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="canais" className="pt-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {trackers.map(t => (
                <Card key={t.id}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteTracker(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground uppercase">Frase Monitorada</div>
                      <div className="bg-muted p-2 rounded text-sm italic">"{t.phrase}"</div>
                      <div className="text-xs text-muted-foreground mt-4">Conexões: {t.connection_ids?.length || 'Todas'}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Rastreador de SEO</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome do Canal</label>
                <Input 
                  placeholder="Ex: Site Principal" 
                  value={newTracker.name} 
                  onChange={e => setNewTracker({...newTracker, name: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Frase de Origem (Exata)</label>
                <Input 
                  placeholder="Ex: Olá, vim através do site!" 
                  value={newTracker.phrase} 
                  onChange={e => setNewTracker({...newTracker, phrase: e.target.value})} 
                />
                <p className="text-xs text-muted-foreground">O sistema criará um lead sempre que uma conversa começar com esta frase exata.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancelar</Button>
              <Button onClick={handleCreateTracker}>Salvar Rastreador</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={analysisDialog.open} onOpenChange={(o) => setAnalysisDialog(s => ({ ...s, open: o }))}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                Análise da IA
              </DialogTitle>
            </DialogHeader>
            {analysisDialog.lead && (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{analysisDialog.lead.contact_name || analysisDialog.lead.phone}</span>
                  {analysisDialog.lead.ia_analyzed_at && (
                    <span>Analisado em {format(new Date(analysisDialog.lead.ia_analyzed_at), "dd/MM/yyyy HH:mm")}</span>
                  )}
                </div>
                <div className="rounded-md border p-3 space-y-2">
                  {analysisDialog.analysis?.status && (
                    <div>
                      <strong>Status sugerido:</strong>{" "}
                      <Badge variant="secondary" className={evolutionStatusMap[analysisDialog.analysis.status as keyof typeof evolutionStatusMap]?.color}>
                        {evolutionStatusMap[analysisDialog.analysis.status as keyof typeof evolutionStatusMap]?.label}
                      </Badge>
                    </div>
                  )}
                  <p><strong>Resumo:</strong> {analysisDialog.analysis?.resumo || 'Sem resumo'}</p>
                  <p><strong>Oportunidade:</strong> {analysisDialog.analysis?.oportunidade || 'Não identificada'}</p>
                </div>
              </div>
            )}
            <DialogFooter>
              {analysisDialog.lead && (
                <Button
                  variant="outline"
                  onClick={() => { handleAnalyzeIA(analysisDialog.lead!.id); }}
                  disabled={analyzingId === analysisDialog.lead.id}
                >
                  {analyzingId === analysisDialog.lead.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Reanalisar
                </Button>
              )}
              <Button onClick={() => setAnalysisDialog(s => ({ ...s, open: false }))}>Fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </MainLayout>
    </TooltipProvider>
  );
}

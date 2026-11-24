import { useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3, CalendarDays, Download, Loader2, MessageSquare, Phone,
  CalendarClock, ClipboardList, Target, Users, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOperationalReport, useDealsDetailReport } from '@/hooks/use-crm-reports';
import { useCRMFunnels } from '@/hooks/use-crm';

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n(value));
const safeFormat = (value: unknown, pattern: string) => {
  if (!value) return '-';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '-' : format(date, pattern, { locale: ptBR });
};
const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7'];

export function OperationalDashboard() {
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [userId, setUserId] = useState('all');
  const [funnelId, setFunnelId] = useState('all');
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');

  const { data, isLoading, refetch } = useOperationalReport({ startDate, endDate, userId, funnelId, groupBy });
  const { data: dealsReport, refetch: refetchDeals } = useDealsDetailReport({ startDate, endDate });
  const { data: funnels = [] } = useCRMFunnels();

  const timeline = useMemo(() => (data?.daily || []).map((row) => {
    const raw = row.period || row.day;
    return {
      period: safeFormat(raw, groupBy === 'month' ? 'MMM/yyyy' : groupBy === 'week' ? "'Semana' dd/MM" : 'dd/MM'),
      chats: n(row.chats), calls: n(row.calls), scheduled: n(row.scheduled_sent), tasks: n(row.tasks),
    };
  }), [data, groupBy]);

  const totals = useMemo(() => ({
    chats: (data?.byUser || []).reduce((sum, row) => sum + n(row.chats), 0),
    calls: (data?.calls || []).reduce((sum, row) => sum + n(row.total), 0),
    scheduled: (data?.scheduled || []).reduce((sum, row) => sum + n(row.total), 0),
    followups: (data?.followups || []).reduce((sum, row) => sum + n(row.followups), 0),
    cards: n(data?.assignedCards),
  }), [data]);

  const funnelPie = useMemo(() => (data?.byFunnel || [])
    .filter((row) => n(row.total) > 0)
    .map((row) => ({ name: row.funnel_name, value: n(row.total) })), [data]);

  const userPerformance = useMemo(() => (data?.byUser || []).map((row) => ({
    name: row.user_name?.split(' ')[0] || 'Usuário',
    atendimentos: n(row.chats), ligacoes: n(row.calls), agendadas: n(row.scheduled_sent),
    followups: n(row.followups), cards: n(row.cards),
  })), [data]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ['Vendedor', 'Atendimentos', 'Ligações', 'Agendadas', 'Follow-ups', 'Cards'],
      ...(data.byUser || []).map((r) => [r.user_name, r.chats, r.calls, r.scheduled_sent, r.followups, r.cards]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'relatorio-operacional.csv'; link.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exportado');
  };

  const refresh = () => { refetch(); refetchDeals(); };

  return (
    <div className="space-y-5">
      <Card className="shadow-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> De</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Até</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Período</Label>
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Diário</SelectItem>
                  <SelectItem value="week">Semanal</SelectItem>
                  <SelectItem value="month">Mensal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Vendedor</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os vendedores</SelectItem>
                  {(data?.byUser || []).map((row) => (
                    <SelectItem key={row.user_id} value={row.user_id}>{row.user_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Funil</Label>
              <Select value={funnelId} onValueChange={setFunnelId}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os funis</SelectItem>
                  {funnels.map((funnel) => (
                    <SelectItem key={funnel.id} value={funnel.id}>{funnel.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={refresh} disabled={isLoading} className="gap-2">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
            <Button variant="outline" onClick={exportCsv} className="gap-2">
              <Download className="h-4 w-4" /> Exportar
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && !data && (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: 'Atendimentos', value: totals.chats, icon: MessageSquare, color: 'text-indigo-500' },
              { label: 'Ligações', value: totals.calls, icon: Phone, color: 'text-emerald-500' },
              { label: 'Mensagens agendadas', value: totals.scheduled, icon: CalendarClock, color: 'text-amber-500' },
              { label: 'Follow-ups', value: totals.followups, icon: ClipboardList, color: 'text-cyan-500' },
              { label: 'Cards atribuídos', value: totals.cards, icon: Target, color: 'text-fuchsia-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="shadow-card">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-3xl font-bold tracking-tight">{value}</p>
                  </div>
                  <div className={`rounded-lg bg-muted p-2 ${color}`}><Icon className="h-6 w-6" /></div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2 shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Evolução da operação</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeline} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="chatsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                      <Legend />
                      <Area type="monotone" dataKey="chats" name="Atendimentos" stroke="#6366f1" fill="url(#chatsGradient)" strokeWidth={2} />
                      <Area type="monotone" dataKey="calls" name="Ligações" stroke="#22c55e" fill="transparent" strokeWidth={2} />
                      <Area type="monotone" dataKey="scheduled" name="Agendadas" stroke="#f59e0b" fill="transparent" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader className="pb-2"><CardTitle className="text-base">Cards por funil</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={funnelPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                        {(funnelPie || []).map((_, index) => (
                          <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-card">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Produtividade por vendedor</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={userPerformance} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                    <Legend />
                    <Bar dataKey="atendimentos" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ligacoes" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="agendadas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="followups" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {dealsReport && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                { label: 'Negociações criadas', value: n(dealsReport.summary.created) },
                { label: 'Ganhas', value: n(dealsReport.summary.won) },
                { label: 'Valor total', value: money(dealsReport.summary.total_value) },
                { label: 'Valor ganho', value: money(dealsReport.summary.won_value) },
                { label: 'Idade média', value: `${n(dealsReport.summary.avg_days).toFixed(1)}d` },
              ].map(({ label, value }) => (
                <Card key={label}><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </CardContent></Card>
              ))}
            </div>
          )}

          <Tabs defaultValue="users">
            <TabsList className="flex-wrap">
              <TabsTrigger value="users">Vendedores</TabsTrigger>
              <TabsTrigger value="funnels">Funis e etapas</TabsTrigger>
              <TabsTrigger value="tasks">Tarefas</TabsTrigger>
              <TabsTrigger value="deals">Negociações</TabsTrigger>
            </TabsList>

            <TabsContent value="users" className="mt-4">
              <Card><CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Vendedor</TableHead><TableHead className="text-right">Atendimentos</TableHead>
                    <TableHead className="text-right">Ligações</TableHead><TableHead className="text-right">Agendadas</TableHead>
                    <TableHead className="text-right">Follow-ups</TableHead><TableHead className="text-right">Cards</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(data.byUser || []).map((row) => (
                      <TableRow key={row.user_id}>
                        <TableCell className="font-medium">{row.user_name}</TableCell>
                        <TableCell className="text-right">{n(row.chats)}</TableCell>
                        <TableCell className="text-right">{n(row.calls)}</TableCell>
                        <TableCell className="text-right">{n(row.scheduled_sent)}</TableCell>
                        <TableCell className="text-right">{n(row.followups)}</TableCell>
                        <TableCell className="text-right">{n(row.cards)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="funnels" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader className="pb-2"><CardTitle className="text-base">Por funil</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto p-0">
                    <Table><TableHeader><TableRow>
                      <TableHead>Funil</TableHead><TableHead className="text-right">Cards</TableHead>
                      <TableHead className="text-right">Ganhos</TableHead><TableHead className="text-right">Valor</TableHead>
                    </TableRow></TableHeader><TableBody>
                      {(data.byFunnel || []).map((row) => (
                        <TableRow key={row.funnel_id}>
                          <TableCell>{row.funnel_name}</TableCell>
                          <TableCell className="text-right">{n(row.total)}</TableCell>
                          <TableCell className="text-right">{n(row.won)}</TableCell>
                          <TableCell className="text-right">{money(row.total_value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody></Table>
                  </CardContent>
                </Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-base">Por etapa</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto p-0">
                    <Table><TableHeader><TableRow>
                      <TableHead>Funil</TableHead><TableHead>Etapa</TableHead><TableHead className="text-right">Cards</TableHead>
                      <TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Tempo</TableHead>
                    </TableRow></TableHeader><TableBody>
                      {(dealsReport?.byStage || []).map((row) => (
                        <TableRow key={row.stage_id}>
                          <TableCell>{row.funnel_name}</TableCell><TableCell>{row.stage_name}</TableCell>
                          <TableCell className="text-right">{n(row.total)}</TableCell>
                          <TableCell className="text-right">{money(row.total_value)}</TableCell>
                          <TableCell className="text-right">{n(row.avg_days).toFixed(1)}d</TableCell>
                        </TableRow>
                      ))}
                    </TableBody></Table>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="tasks" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader className="pb-2"><CardTitle className="text-base">Tarefas por funil e tipo</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto p-0">
                    <Table><TableHeader><TableRow>
                      <TableHead>Funil</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Concluídas</TableHead><TableHead className="text-right">Pendentes</TableHead>
                    </TableRow></TableHeader><TableBody>
                      {(data.tasksByFunnel || []).map((row, index) => (
                        <TableRow key={`${row.funnel_id}-${row.task_type}-${index}`}>
                          <TableCell>{row.funnel_name}</TableCell><TableCell>{row.task_type}</TableCell>
                          <TableCell className="text-right">{n(row.total)}</TableCell>
                          <TableCell className="text-right">{n(row.completed)}</TableCell>
                          <TableCell className="text-right">{n(row.pending)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody></Table>
                  </CardContent>
                </Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-base">Total por tipo</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto p-0">
                    <Table><TableHeader><TableRow>
                      <TableHead>Tipo</TableHead><TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Concluídas</TableHead><TableHead className="text-right">Pendentes</TableHead>
                    </TableRow></TableHeader><TableBody>
                      {(data.tasksByType || []).map((row) => (
                        <TableRow key={row.type}>
                          <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
                          <TableCell className="text-right">{n(row.total)}</TableCell>
                          <TableCell className="text-right">{n(row.completed)}</TableCell>
                          <TableCell className="text-right">{n(row.pending)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody></Table>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="deals" className="mt-4">
              <Card><CardContent className="overflow-x-auto p-0">
                <Table><TableHeader><TableRow>
                  <TableHead>Negociação</TableHead><TableHead>Funil</TableHead><TableHead>Etapa</TableHead>
                  <TableHead>Responsável</TableHead><TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Idade</TableHead><TableHead>Criação</TableHead>
                </TableRow></TableHeader><TableBody>
                  {(dealsReport?.deals || []).map((deal) => (
                    <TableRow key={deal.id}>
                      <TableCell className="font-medium">{deal.title}</TableCell>
                      <TableCell>{deal.funnel_name || '-'}</TableCell>
                      <TableCell>{deal.stage_name || '-'}</TableCell>
                      <TableCell>{deal.owner_name || '-'}</TableCell>
                      <TableCell className="text-right">{money(deal.value)}</TableCell>
                      <TableCell className="text-right">{n(deal.age_days).toFixed(1)}d</TableCell>
                      <TableCell>{safeFormat(deal.created_at, 'dd/MM/yyyy')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody></Table>
              </CardContent></Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

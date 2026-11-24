import { useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BarChart3, Download, Loader2, Phone, CalendarClock, MessageSquare, ClipboardList, Users, Target } from 'lucide-react';
import { toast } from 'sonner';
import { useOperationalReport, useDealsDetailReport } from '@/hooks/use-crm-reports';

const number = (value: unknown) => Number(value || 0);
const money = (value: unknown) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number(value));

function MiniBar({ value, max, color = 'bg-primary' }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export default function RelatoriosOperacionais() {
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const { data, isLoading, refetch } = useOperationalReport({ startDate, endDate });
  const { data: dealsReport, refetch: refetchDeals } = useDealsDetailReport({ startDate, endDate });

  const totals = useMemo(() => {
    if (!data) return { chats: 0, calls: 0, scheduled: 0, followups: 0, cards: 0 };
    return {
      chats: data.byUser.reduce((sum, row) => sum + number(row.chats), 0),
      calls: data.calls.reduce((sum, row) => sum + number(row.total), 0),
      scheduled: data.scheduled.reduce((sum, row) => sum + number(row.total), 0),
      followups: data.followups.reduce((sum, row) => sum + number(row.followups), 0),
      cards: number(data.assignedCards),
    };
  }, [data]);

  const maxDaily = Math.max(1, ...(data?.daily || []).map((row) => number(row.chats)));

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ['Vendedor', 'Atendimentos', 'Ligações', 'Mensagens agendadas', 'Follow-ups', 'Cards atribuídos'],
      ...data.byUser.map((row) => [
        row.user_name, row.chats, row.calls, row.scheduled_sent, row.followups, row.cards,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'relatorio-operacional.csv';
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Relatório exportado');
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Relatórios Operacionais</h1>
            <p className="text-sm text-muted-foreground">Atendimento, ligações, agendamentos, follow-up e CRM por período.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">De</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Até</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
            </div>
            <Button onClick={() => { refetch(); refetchDeals(); }} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}
              Atualizar
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={!data}>
              <Download className="h-4 w-4 mr-2" /> Exportar CSV
            </Button>
          </div>
        </div>

        {isLoading && !data && (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        )}

        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                { label: 'Atendimentos', value: totals.chats, icon: MessageSquare },
                { label: 'Ligações realizadas', value: totals.calls, icon: Phone },
                { label: 'Mensagens agendadas', value: totals.scheduled, icon: CalendarClock },
                { label: 'Follow-ups', value: totals.followups, icon: ClipboardList },
                { label: 'Cards atribuídos', value: totals.cards, icon: Target },
              ].map(({ label, value, icon: Icon }) => (
                <Card key={label}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-2xl font-bold">{value}</p>
                    </div>
                    <Icon className="h-6 w-6 text-primary opacity-70" />
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Total da equipe por dia</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.daily.map((row) => (
                    <div key={row.day} className="grid grid-cols-[90px_1fr_190px] items-center gap-3 text-sm">
                      <span className="text-muted-foreground">{format(new Date(`${row.day}T12:00:00`), 'dd/MM', { locale: ptBR })}</span>
                      <MiniBar value={number(row.chats)} max={maxDaily} />
                      <span className="text-right text-xs text-muted-foreground">
                        {number(row.chats)} chats · {number(row.calls)} lig. · {number(row.scheduled_sent)} agend. · {number(row.tasks)} tarefas
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Por vendedor / usuário</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead className="text-right">Atendimentos</TableHead>
                      <TableHead className="text-right">Ligações</TableHead>
                      <TableHead className="text-right">Agendadas enviadas</TableHead>
                      <TableHead className="text-right">Follow-ups</TableHead>
                      <TableHead className="text-right">Cards</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byUser.map((row) => (
                      <TableRow key={row.user_id}>
                        <TableCell className="font-medium">{row.user_name}</TableCell>
                        <TableCell className="text-right">{number(row.chats)}</TableCell>
                        <TableCell className="text-right">{number(row.calls)}</TableCell>
                        <TableCell className="text-right">{number(row.scheduled_sent)}</TableCell>
                        <TableCell className="text-right">{number(row.followups)}</TableCell>
                        <TableCell className="text-right">{number(row.cards)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Ligações e mensagens agendadas</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Usuário</TableHead><TableHead className="text-right">Ligações</TableHead><TableHead className="text-right">Agendadas</TableHead><TableHead className="text-right">Enviadas</TableHead><TableHead className="text-right">Pendentes</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.calls.map((call) => {
                        const scheduled = data.scheduled.find((s) => s.user_id === call.user_id);
                        return (
                          <TableRow key={call.user_id}>
                            <TableCell>{call.user_name}</TableCell>
                            <TableCell className="text-right">{number(call.total)}</TableCell>
                            <TableCell className="text-right">{number(scheduled?.total)}</TableCell>
                            <TableCell className="text-right">{number(scheduled?.sent)}</TableCell>
                            <TableCell className="text-right">{number(scheduled?.pending)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">CRM por funil</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Funil</TableHead><TableHead className="text-right">Cards</TableHead><TableHead className="text-right">Abertos</TableHead><TableHead className="text-right">Ganhos</TableHead><TableHead className="text-right">Valor</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byFunnel.map((row) => (
                        <TableRow key={row.funnel_id}>
                          <TableCell className="font-medium">{row.funnel_name}</TableCell>
                          <TableCell className="text-right">{number(row.total)}</TableCell>
                          <TableCell className="text-right">{number(row.open)}</TableCell>
                          <TableCell className="text-right">{number(row.won)}</TableCell>
                          <TableCell className="text-right">{money(row.total_value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Tarefas por funil e tipo</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Funil</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Concluídas</TableHead><TableHead className="text-right">Pendentes</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.tasksByFunnel.map((row, index) => (
                        <TableRow key={`${row.funnel_id}-${row.task_type}-${index}`}>
                          <TableCell>{row.funnel_name}</TableCell>
                          <TableCell>{row.task_type}</TableCell>
                          <TableCell className="text-right">{number(row.total)}</TableCell>
                          <TableCell className="text-right">{number(row.completed)}</TableCell>
                          <TableCell className="text-right">{number(row.pending)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Total de tarefas por tipo</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Tipo</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Concluídas</TableHead><TableHead className="text-right">Pendentes</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.tasksByType.map((row) => (
                        <TableRow key={row.type}>
                          <TableCell className="font-medium">{row.type}</TableCell>
                          <TableCell className="text-right">{number(row.total)}</TableCell>
                          <TableCell className="text-right">{number(row.completed)}</TableCell>
                          <TableCell className="text-right">{number(row.pending)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Follow-up por vendedor</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Vendedor</TableHead><TableHead className="text-right">Follow-ups</TableHead><TableHead className="text-right">Concluídos</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.followups.map((row) => (
                      <TableRow key={row.user_id}>
                        <TableCell>{row.user_name || 'Sem responsável'}</TableCell>
                        <TableCell className="text-right">{number(row.followups)}</TableCell>
                        <TableCell className="text-right">{number(row.completed)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {dealsReport && (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    { label: 'Negociações criadas', value: number(dealsReport.summary.created) },
                    { label: 'Ganhas', value: number(dealsReport.summary.won) },
                    { label: 'Perdidas', value: number(dealsReport.summary.lost) },
                    { label: 'Valor total', value: money(dealsReport.summary.total_value) },
                    { label: 'Idade média (dias)', value: number(dealsReport.summary.avg_days).toFixed(1) },
                  ].map(({ label, value }) => (
                    <Card key={label}>
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="text-xl font-bold">{value}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">Negociações por funil</CardTitle></CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>Funil</TableHead><TableHead className="text-right">Criadas</TableHead><TableHead className="text-right">Ganhas</TableHead><TableHead className="text-right">Valor total</TableHead><TableHead className="text-right">Valor ganho</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {dealsReport.byFunnel.map((row) => (
                            <TableRow key={row.funnel_id}>
                              <TableCell className="font-medium">{row.funnel_name}</TableCell>
                              <TableCell className="text-right">{number(row.created)}</TableCell>
                              <TableCell className="text-right">{number(row.won)}</TableCell>
                              <TableCell className="text-right">{money(row.total_value)}</TableCell>
                              <TableCell className="text-right">{money(row.won_value)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">Negociações por etapa</CardTitle></CardHeader>
                    <CardContent className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow><TableHead>Funil</TableHead><TableHead>Etapa</TableHead><TableHead className="text-right">Cards</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Tempo médio</TableHead></TableRow>
                        </TableHeader>
                        <TableBody>
                          {dealsReport.byStage.map((row) => (
                            <TableRow key={row.stage_id}>
                              <TableCell>{row.funnel_name}</TableCell>
                              <TableCell className="font-medium">{row.stage_name}</TableCell>
                              <TableCell className="text-right">{number(row.total)}</TableCell>
                              <TableCell className="text-right">{money(row.total_value)}</TableCell>
                              <TableCell className="text-right">{number(row.avg_days).toFixed(1)} dias</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Tempo dos cards e valor por negociação</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Negociação</TableHead><TableHead>Funil</TableHead><TableHead>Etapa</TableHead>
                          <TableHead>Responsável</TableHead><TableHead className="text-right">Valor</TableHead>
                          <TableHead className="text-right">Idade</TableHead><TableHead>Criação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dealsReport.deals.map((deal) => (
                          <TableRow key={deal.id}>
                            <TableCell className="font-medium">{deal.title}</TableCell>
                            <TableCell>{deal.funnel_name || '-'}</TableCell>
                            <TableCell>{deal.stage_name || '-'}</TableCell>
                            <TableCell>{deal.owner_name || '-'}</TableCell>
                            <TableCell className="text-right">{money(deal.value)}</TableCell>
                            <TableCell className="text-right">{number(deal.age_days).toFixed(1)} dias</TableCell>
                            <TableCell>{format(new Date(deal.created_at), 'dd/MM/yyyy', { locale: ptBR })}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </MainLayout>
  );
}

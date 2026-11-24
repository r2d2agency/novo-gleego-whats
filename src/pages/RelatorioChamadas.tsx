import { useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Phone, PhoneCall, Clock, Users, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCallLogReport } from '@/hooks/use-crm-reports';

const number = (value: unknown) => Number(value || 0);
const safeFormat = (value: unknown, pattern: string) => {
  if (!value) return '-';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '-';
  return format(date, pattern, { locale: ptBR });
};
const duration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
};
const outcomeLabels: Record<string, string> = {
  answered: 'Atendeu',
  voicemail: 'Caixa postal',
  no_answer: 'Não atendeu',
  busy: 'Ocupado',
  scheduled_callback: 'Retorno agendado',
  deal_closed: 'Negócio fechado',
  not_interested: 'Sem interesse',
  follow_up: 'Necessita follow-up',
};
const typeLabels: Record<string, string> = {
  outgoing: 'Realizada',
  incoming: 'Recebida',
  missed: 'Perdida',
};

export default function RelatorioChamadas() {
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [userId, setUserId] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [contact, setContact] = useState('');
  const { data, isLoading, refetch } = useCallLogReport({
    startDate,
    endDate,
    userId: userId === 'all' ? undefined : userId,
    outcome: outcome === 'all' ? undefined : outcome,
    contact: contact || undefined,
  });

  const maxDaily = Math.max(1, ...(data?.daily || []).map((row) => number(row.total)));
  const answerRate = useMemo(() => {
    if (!data || number(data.summary.total) === 0) return 0;
    return Math.round((number(data.summary.answered) / number(data.summary.total)) * 100);
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ['Data', 'Vendedor', 'Contato', 'Telefone', 'Tipo', 'Status', 'Duração (s)', 'Notas'],
      ...data.calls.map((call) => [
        safeFormat(call.created_at, 'dd/MM/yyyy HH:mm'),
        call.user_name || '',
        call.contact_name || call.conversation_contact || '',
        call.contact_phone || '',
        typeLabels[call.call_type] || call.call_type,
        outcomeLabels[call.outcome] || call.outcome,
        number(call.duration_seconds),
        call.notes || '',
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'relatorio-chamadas.csv';
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Relatório de chamadas exportado');
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Relatório de Chamadas</h1>
            <p className="text-sm text-muted-foreground">Ligações registradas no chat: status, duração, data, vendedor e contato.</p>
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
            <div className="space-y-1">
              <Label className="text-xs">Vendedor</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {(data?.byUser || []).map((row) => (
                    <SelectItem key={row.user_id} value={row.user_id}>{row.user_name || 'Sem vendedor'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {Object.entries(outcomeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Contato</Label>
              <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Nome ou telefone" className="w-48" />
            </div>
            <Button onClick={() => refetch()} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Phone className="h-4 w-4 mr-2" />}
              Atualizar
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={!data}>
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
          </div>
        </div>

        {isLoading && !data && (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        )}

        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Ligações', value: number(data.summary.total), icon: PhoneCall },
                { label: 'Atendidas', value: `${number(data.summary.answered)} (${answerRate}%)`, icon: Phone },
                { label: 'Tempo total', value: duration(number(data.summary.duration_seconds)), icon: Clock },
                { label: 'Contatos distintos', value: number(data.summary.contacts), icon: Users },
              ].map(({ label, value, icon: Icon }) => (
                <Card key={label}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div>
                    <Icon className="h-6 w-6 text-primary opacity-70" />
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Ligações por dia</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.daily.map((row) => (
                    <div key={row.day} className="grid grid-cols-[80px_1fr_110px] items-center gap-3 text-sm">
                      <span className="text-muted-foreground">{safeFormat(String(row.day).slice(0, 10), 'dd/MM')}</span>
                      <div className="h-2 rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max((number(row.total) / maxDaily) * 100, number(row.total) ? 4 : 0)}%` }} />
                      </div>
                      <span className="text-right text-xs text-muted-foreground">{row.total} · {duration(number(row.duration_seconds))}</span>
                    </div>
                  ))}
                  {data.daily.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma ligação no período.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Status das ligações</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.byOutcome.map((row) => (
                    <div key={row.outcome} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{outcomeLabels[row.outcome] || row.outcome}</Badge>
                        <span className="text-xs text-muted-foreground">{duration(number(row.duration_seconds))}</span>
                      </div>
                      <span className="font-semibold">{row.total}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Por vendedor</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Vendedor</TableHead><TableHead className="text-right">Ligações</TableHead><TableHead className="text-right">Atendidas</TableHead><TableHead className="text-right">Tempo total</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byUser.map((row) => (
                      <TableRow key={row.user_id}>
                        <TableCell className="font-medium">{row.user_name || 'Sem vendedor'}</TableCell>
                        <TableCell className="text-right">{number(row.total)}</TableCell>
                        <TableCell className="text-right">{number(row.answered)}</TableCell>
                        <TableCell className="text-right">{duration(number(row.duration_seconds))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Ligações registradas</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead><TableHead>Vendedor</TableHead><TableHead>Contato</TableHead>
                      <TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Duração</TableHead><TableHead>Notas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.calls.map((call) => (
                      <TableRow key={call.id}>
                        <TableCell>{safeFormat(call.created_at, 'dd/MM/yyyy HH:mm')}</TableCell>
                        <TableCell>{call.user_name || '-'}</TableCell>
                        <TableCell>
                          <p className="font-medium">{call.contact_name || call.conversation_contact || '-'}</p>
                          <p className="text-xs text-muted-foreground">{call.contact_phone || ''}</p>
                        </TableCell>
                        <TableCell>{typeLabels[call.call_type] || call.call_type}</TableCell>
                        <TableCell><Badge variant={call.outcome === 'answered' ? 'default' : 'secondary'}>{outcomeLabels[call.outcome] || call.outcome}</Badge></TableCell>
                        <TableCell className="text-right">{duration(number(call.duration_seconds))}</TableCell>
                        <TableCell className="max-w-64 truncate text-xs text-muted-foreground">{call.notes || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {data.calls.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhuma ligação encontrada.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </MainLayout>
  );
}

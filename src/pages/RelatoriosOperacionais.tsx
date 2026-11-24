import { MainLayout } from '@/components/layout/MainLayout';
import { OperationalDashboard } from '@/components/dashboard/OperationalDashboard';

export default function RelatoriosOperacionais() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Relatórios Operacionais</h1>
          <p className="text-sm text-muted-foreground">
            Atendimento, ligações, agendamentos, follow-up e CRM em um único dashboard.
          </p>
        </div>
        <OperationalDashboard />
      </div>
    </MainLayout>
  );
}

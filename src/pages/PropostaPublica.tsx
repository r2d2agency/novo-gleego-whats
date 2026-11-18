import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, FileText, Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { CRMProposal } from '@/hooks/use-crm-config';

const currency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const statusLabels: Record<string, string> = {
  sent: 'Enviada',
  approved: 'Aprovada',
  rejected: 'Recusada',
};

export default function PropostaPublica() {
  const { token } = useParams<{ token: string }>();
  const [proposal, setProposal] = useState<CRMProposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/crm/public/proposals/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Proposta indisponível');
        return response.json();
      })
      .then(setProposal)
      .catch(() => setError('Proposta não encontrada ou indisponível.'))
      .finally(() => setLoading(false));
  }, [token]);

  const recordDecision = async (decision: 'approve' | 'reject') => {
    if (!token || !proposal || proposal.decided_at) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/api/crm/public/proposals/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes }),
      });
      if (!response.ok) throw new Error('Não foi possível registrar sua resposta');
      const updated = await response.json();
      setProposal((current) => current ? { ...current, ...updated } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar resposta');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-6">
            <XCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p>{error || 'Proposta indisponível.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader className="border-b">
            {proposal.template_logo_url && (
              <img
                src={proposal.template_logo_url}
                alt="Logo da proposta"
                className="mb-4 max-h-20 max-w-44 object-contain"
              />
            )}
            {proposal.template_header_text && (
              <p className="mb-2 whitespace-pre-wrap text-sm font-medium text-primary">
                {proposal.template_header_text}
              </p>
            )}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  {proposal.title}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Proposta {proposal.number}</p>
              </div>
              <Badge variant={proposal.status === 'approved' ? 'default' : proposal.status === 'rejected' ? 'destructive' : 'secondary'}>
                {statusLabels[proposal.status] || proposal.status}
              </Badge>
            </div>
            {proposal.template_description && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {proposal.template_description}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Cliente</p>
                <p className="font-medium">{proposal.customer_name || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Documento</p>
                <p className="font-medium">{proposal.customer_document || '-'}</p>
              </div>
            </div>

            <div className="rounded-lg border">
              {proposal.items?.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 border-b last:border-b-0 p-3">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.category_name} · {item.quantity} {item.unit} × {currency(item.unit_price)}
                      {item.discount_percent > 0 && ` · ${item.discount_percent}% desconto`}
                    </p>
                    {item.description && <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>}
                  </div>
                  <span className="font-semibold whitespace-nowrap">{currency(item.total)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2 rounded-lg bg-muted/50 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{currency(proposal.subtotal)}</span>
              </div>
              {proposal.discount_amount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Desconto ({proposal.discount_percent}%)</span>
                  <span>- {currency(proposal.discount_amount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 text-lg font-bold">
                <span>Total</span>
                <span>{currency(proposal.total)}</span>
              </div>
            </div>

            {proposal.template_footer_text && (
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.template_footer_text}</p>
              </div>
            )}
            {proposal.notes && (
              <div>
                <p className="text-sm font-medium">Observações</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.notes}</p>
              </div>
            )}
            {proposal.payment_terms && (
              <div>
                <p className="text-sm font-medium">Condições de pagamento</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{proposal.payment_terms}</p>
              </div>
            )}

            {proposal.decided_at ? (
              <div className={`rounded-lg p-4 text-sm ${proposal.status === 'approved' ? 'bg-green-500/10 text-green-700' : 'bg-destructive/10 text-destructive'}`}>
                {proposal.status === 'approved' ? 'Proposta aprovada' : 'Proposta recusada'} em {new Date(proposal.decided_at).toLocaleString('pt-BR')}
                {proposal.decision_notes && <p className="mt-1">{proposal.decision_notes}</p>}
              </div>
            ) : (
              <div className="space-y-3 border-t pt-4">
                <div className="space-y-2">
                  <Label htmlFor="decision-notes">Mensagem (opcional)</Label>
                  <Textarea
                    id="decision-notes"
                    placeholder="Deixe uma observação sobre sua decisão"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1"
                    onClick={() => recordDecision('approve')}
                    disabled={submitting}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Aprovar proposta
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => recordDecision('reject')}
                    disabled={submitting}
                  >
                    <XCircle className="h-4 w-4 mr-2" /> Recusar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, FileText, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  CRMProposal,
  CRMProposalItem,
  CRMCatalogItem,
  useCRMCatalogItems,
  useProposalMutations,
} from '@/hooks/use-crm-config';
import { generateProposalPdf } from './ProposalPdf';

const currency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

function itemTotal(quantity: number, unitPrice: number, discountPercent: number) {
  const gross = Number(quantity || 0) * Number(unitPrice || 0);
  return Math.round(gross * (1 - Number(discountPercent || 0) / 100) * 100) / 100;
}

interface ProposalEditorDialogProps {
  dealId: string;
  proposal: CRMProposal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealTitle?: string;
  companyName?: string;
}

export function ProposalEditorDialog({ dealId, proposal, open, onOpenChange, dealTitle, companyName }: ProposalEditorDialogProps) {
  const { data: catalogItems = [] } = useCRMCatalogItems();
  const { updateProposal, deleteProposal, sendProposal } = useProposalMutations(dealId);
  const [title, setTitle] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerDocument, setCustomerDocument] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [validityDays, setValidityDays] = useState('15');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<CRMProposalItem[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [requiresSignature, setRequiresSignature] = useState(false);

  useEffect(() => {
    if (!proposal) return;
    setTitle(proposal.title || '');
    setCustomerName(proposal.customer_name || '');
    setCustomerDocument(proposal.customer_document || '');
    setCustomerEmail(proposal.customer_email || '');
    setCustomerPhone(proposal.customer_phone || '');
    setValidityDays(String(proposal.validity_days || 15));
    setDiscountPercent(String(proposal.discount_percent || 0));
    setPaymentTerms(proposal.payment_terms || '');
    setNotes(proposal.notes || '');
    setItems(proposal.items || []);
    setRequiresSignature(!!proposal.requires_signature);
    setSelectedCatalogId('');
  }, [proposal]);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + itemTotal(item.quantity, item.unit_price, item.discount_percent), 0),
    [items]
  );
  const globalDiscount = Math.round(subtotal * (Number(discountPercent || 0) / 100) * 100) / 100;
  const total = Math.round((subtotal - globalDiscount) * 100) / 100;

  const addCatalogItem = () => {
    const catalog = catalogItems.find((item: CRMCatalogItem) => item.id === selectedCatalogId);
    if (!catalog) return toast.error('Selecione um item do catálogo');
    const newItem: CRMProposalItem = {
      id: `temp-${Date.now()}`,
      proposal_id: proposal?.id || '',
      category_name: catalog.category_name || '',
      item_type: catalog.type,
      name: catalog.name,
      code: catalog.code,
      description: catalog.description || '',
      unit: catalog.unit,
      recurrence: catalog.recurrence,
      quantity: 1,
      unit_price: Number(catalog.unit_price || 0),
      discount_percent: 0,
      total: Number(catalog.unit_price || 0),
      position: items.length,
    };
    setItems((current) => [...current, newItem]);
    setSelectedCatalogId('');
  };

  const updateItem = (id: string, patch: Partial<CRMProposalItem>) => {
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const updated = { ...item, ...patch };
      return { ...updated, total: itemTotal(updated.quantity, updated.unit_price, updated.discount_percent) };
    }));
  };

  const save = async () => {
    if (!proposal) return;
    await updateProposal.mutateAsync({
      id: proposal.id,
      title,
      customer_name: customerName,
      customer_document: customerDocument,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      notes,
      payment_terms: paymentTerms,
      validity_days: Number(validityDays) || 15,
      discount_percent: Number(discountPercent) || 0,
      items,
    });
    onOpenChange(false);
  };

  if (!proposal) return null;

  const isDraft = proposal.status === 'draft';
  const canEdit = isDraft;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {proposal.number} — {proposal.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label>Validade (dias)</Label>
              <Input type="number" min="1" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label>Empresa/Cliente</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label>Contato do card</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome do contato" disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label>Documento/CNPJ</Label>
              <Input value={customerDocument} onChange={(e) => setCustomerDocument(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Telefone/WhatsApp</Label>
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} disabled={!canEdit} />
            </div>
          </div>

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-medium">Itens da proposta</h4>
              <Badge variant="secondary">Total: {currency(total)}</Badge>
            </div>
            {canEdit && (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Select value={selectedCatalogId} onValueChange={setSelectedCatalogId}>
                  <SelectTrigger><SelectValue placeholder="Selecione um item do catálogo" /></SelectTrigger>
                  <SelectContent>
                    {catalogItems.filter((item) => item.is_active).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} — {currency(Number(item.unit_price || 0))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={addCatalogItem}><Plus className="h-4 w-4 mr-2" />Adicionar</Button>
              </div>
            )}

            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={item.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{item.name} <span className="text-xs text-muted-foreground">({item.item_type})</span></p>
                      <p className="text-xs text-muted-foreground">{item.category_name} · {item.code}</p>
                    </div>
                    {canEdit && (
                      <Button variant="ghost" size="icon" onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Qtd</Label>
                      <Input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })} disabled={!canEdit} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Preço unit.</Label>
                      <Input type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => updateItem(item.id, { unit_price: Number(e.target.value) })} disabled={!canEdit} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Desc. %</Label>
                      <Input type="number" min="0" max="100" value={item.discount_percent} onChange={(e) => updateItem(item.id, { discount_percent: Number(e.target.value) })} disabled={!canEdit} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Total</Label>
                      <Input value={currency(itemTotal(item.quantity, item.unit_price, item.discount_percent))} readOnly />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Descrição do item</Label>
                    <Textarea
                      value={item.description || ''}
                      onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      placeholder="Descreva o que está incluído neste item"
                      disabled={!canEdit}
                    />
                  </div>
                  <input type="hidden" value={index} readOnly />
                </div>
              ))}
              {items.length === 0 && <p className="text-sm text-muted-foreground">Adicione itens do catálogo para montar esta proposta.</p>}
            </div>

            <div className="grid gap-3 sm:grid-cols-3 border-t pt-3">
              <div><p className="text-xs text-muted-foreground">Subtotal</p><p className="font-medium">{currency(subtotal)}</p></div>
              <div><p className="text-xs text-muted-foreground">Desconto ({discountPercent}%)</p><p className="font-medium">- {currency(globalDiscount)}</p></div>
              <div><p className="text-xs text-muted-foreground">Total</p><p className="text-lg font-bold">{currency(total)}</p></div>
            </div>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Desconto geral %</Label>
              <Input type="number" min="0" max="100" step="0.01" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2">
              <Label>Condições de pagamento</Label>
              <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Observações</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} />
            </div>
          </div>

          {isDraft && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={requiresSignature} onChange={(e) => setRequiresSignature(e.target.checked)} />
              Exigir assinatura digital para aprovar
            </label>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {isDraft && (
            <>
              <Button variant="destructive" onClick={async () => {
                if (!confirm('Excluir esta proposta?')) return;
                await deleteProposal.mutateAsync(proposal.id);
                onOpenChange(false);
              }}><Trash2 className="h-4 w-4 mr-2" />Excluir</Button>
              <Button onClick={save} disabled={updateProposal.isPending}>
                {updateProposal.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Salvar
              </Button>
              <Button variant="secondary" onClick={async () => {
                await save();
                await sendProposal.mutateAsync({ id: proposal.id, requires_signature: requiresSignature });
                onOpenChange(false);
              }} disabled={sendProposal.isPending}>
                <Send className="h-4 w-4 mr-2" />Salvar e enviar
              </Button>
            </>
          )}
          <Button variant="outline" onClick={async () => {
            await generateProposalPdf({
              ...proposal,
              title,
              customer_name: customerName,
              customer_document: customerDocument,
              customer_email: customerEmail,
              customer_phone: customerPhone,
              validity_days: Number(validityDays),
              discount_percent: Number(discountPercent),
              payment_terms: paymentTerms,
              notes,
              items,
            }, { dealTitle, companyName });
          }}><FileText className="h-4 w-4 mr-2" />PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

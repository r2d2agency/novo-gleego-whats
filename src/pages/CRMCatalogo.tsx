import { useEffect, useMemo, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Package, Plus, Pencil, Trash2, Search, Layers } from 'lucide-react';
import { toast } from 'sonner';
import {
  useCRMCatalogCategories,
  useCRMCatalogItems,
  useCRMCatalogMutations,
  useProposalTemplate,
  useProposalTemplateMutation,
  CRMCatalogCategory,
  CRMCatalogItem,
} from '@/hooks/use-crm-config';
import { useUpload } from '@/hooks/use-upload';
import { Upload, Loader2, FileText } from 'lucide-react';

const currency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const typeLabel: Record<string, string> = { product: 'Produto', service: 'Serviço' };
const recurrenceLabel: Record<string, string> = {
  one_time: 'Único',
  monthly: 'Mensal',
  yearly: 'Anual',
};

export default function CRMCatalogo() {
  const { data: categories = [], isLoading: loadingCategories } = useCRMCatalogCategories();
  const { data: items = [], isLoading: loadingItems } = useCRMCatalogItems();
  const mutations = useCRMCatalogMutations();
  const { data: proposalTemplate } = useProposalTemplate();
  const saveTemplate = useProposalTemplateMutation();
  const { uploadFile, isUploading } = useUpload();
  const [templateForm, setTemplateForm] = useState({
    logo_url: proposalTemplate?.logo_url || '',
    header_text: proposalTemplate?.header_text || '',
    description: proposalTemplate?.description || '',
    footer_text: proposalTemplate?.footer_text || '',
  });

  const [categoryDialog, setCategoryDialog] = useState<CRMCatalogCategory | 'new' | null>(null);
  const [itemDialog, setItemDialog] = useState<CRMCatalogItem | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');

  const activeCategories = categories.filter((category) => category.is_active);

  const filteredItems = useMemo(() => items.filter((item) => {
    const term = search.toLowerCase().trim();
    const matchesSearch = !term
      || item.name.toLowerCase().includes(term)
      || item.code?.toLowerCase().includes(term);
    const matchesType = filterType === 'all' || item.type === filterType;
    const matchesCategory = filterCategory === 'all' || item.category_id === filterCategory;
    return matchesSearch && matchesType && matchesCategory;
  }), [items, search, filterType, filterCategory]);

  const setTemplateField = (field: keyof typeof templateForm, value: string) => {
    setTemplateForm((current) => ({ ...current, [field]: value }));
  };

  useEffect(() => {
    if (proposalTemplate) {
      setTemplateForm({
        logo_url: proposalTemplate.logo_url || '',
        header_text: proposalTemplate.header_text || '',
        description: proposalTemplate.description || '',
        footer_text: proposalTemplate.footer_text || '',
      });
    }
  }, [proposalTemplate]);

  const handleSaveCategory = async (form: FormData) => {
    const data = {
      name: String(form.get('name') || '').trim(),
      description: String(form.get('description') || '').trim(),
      position: Number(form.get('position') || 0),
    };
    if (!data.name) return toast.error('Informe o nome da categoria');
    if (categoryDialog === 'new') await mutations.createCategory.mutateAsync(data);
    else if (categoryDialog) await mutations.updateCategory.mutateAsync({ id: categoryDialog.id, ...data });
    setCategoryDialog(null);
  };

  const handleSaveItem = async (form: FormData) => {
    const type = String(form.get('type') || 'product') as 'product' | 'service';
    const recurrence = String(form.get('recurrence') || 'one_time') as 'one_time' | 'monthly' | 'yearly';
    const data = {
      category_id: String(form.get('category_id') || '') || null,
      type,
      name: String(form.get('name') || '').trim(),
      code: String(form.get('code') || '').trim(),
      description: String(form.get('description') || '').trim(),
      unit: String(form.get('unit') || (type === 'service' ? 'hora' : 'un')),
      recurrence: type === 'product' ? 'one_time' : recurrence,
      unit_price: Number(String(form.get('unit_price') || '0').replace(',', '.')),
      is_active: form.get('is_active') === 'on',
      external_id: String(form.get('external_id') || '').trim(),
      external_source: String(form.get('external_source') || '').trim(),
    };
    if (!data.name) return toast.error('Informe o nome do item');
    if (itemDialog === 'new') await mutations.createItem.mutateAsync(data);
    else if (itemDialog) await mutations.updateItem.mutateAsync({ id: itemDialog.id, ...data });
    setItemDialog(null);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Catálogo do CRM</h1>
            <p className="text-sm text-muted-foreground">
              Cadastre produtos e serviços para usar nas negociações e propostas.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCategoryDialog('new')}>
              <Layers className="h-4 w-4 mr-2" /> Nova categoria
            </Button>
            <Button onClick={() => setItemDialog('new')}>
              <Plus className="h-4 w-4 mr-2" /> Novo item
            </Button>
          </div>
        </div>

        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items">Itens ({items.length})</TabsTrigger>
            <TabsTrigger value="categories">Categorias ({categories.length})</TabsTrigger>
            <TabsTrigger value="template">Modelo da proposta</TabsTrigger>
          </TabsList>

          <TabsContent value="template" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" /> Modelo da proposta
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Logo da proposta</Label>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    id="proposal-logo"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        const url = await uploadFile(file);
                        if (url) setTemplateField('logo_url', url);
                      } catch {
                        toast.error('Erro ao enviar logo');
                      } finally {
                        event.target.value = '';
                      }
                    }}
                  />
                  {templateForm.logo_url ? (
                    <div className="flex items-center gap-3 rounded-lg border p-3">
                      <img src={templateForm.logo_url} alt="Logo da proposta" className="max-h-16 max-w-32 object-contain" />
                      <Button variant="outline" size="sm" onClick={() => document.getElementById('proposal-logo')?.click()} disabled={isUploading}>
                        {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                        Alterar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setTemplateField('logo_url', '')}>Remover</Button>
                    </div>
                  ) : (
                    <Button variant="outline" onClick={() => document.getElementById('proposal-logo')?.click()} disabled={isUploading}>
                      {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                      Enviar logo
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="proposal-header">Texto de cabeçalho</Label>
                  <Input
                    id="proposal-header"
                    value={templateForm.header_text}
                    onChange={(event) => setTemplateField('header_text', event.target.value)}
                    placeholder="Ex.: Proposta comercial — Soluções para sua empresa"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="proposal-description">Descrição</Label>
                  <Textarea
                    id="proposal-description"
                    value={templateForm.description}
                    onChange={(event) => setTemplateField('description', event.target.value)}
                    placeholder="Texto de apresentação da proposta"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="proposal-footer">Texto abaixo da tabela</Label>
                  <Textarea
                    id="proposal-footer"
                    value={templateForm.footer_text}
                    onChange={(event) => setTemplateField('footer_text', event.target.value)}
                    placeholder="Observações, regras de negócio e condições gerais"
                  />
                </div>
                <Button onClick={() => saveTemplate.mutate(templateForm)} disabled={saveTemplate.isPending}>
                  Salvar modelo
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="items" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" /> Produtos e serviços
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-[1fr_180px_220px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Buscar por nome ou código"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os tipos</SelectItem>
                      <SelectItem value="product">Produtos</SelectItem>
                      <SelectItem value="service">Serviços</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterCategory} onValueChange={setFilterCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as categorias</SelectItem>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {loadingItems ? (
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                ) : filteredItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum item encontrado.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredItems.map((item) => (
                      <div key={item.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{item.name}</span>
                            <Badge variant={item.type === 'service' ? 'secondary' : 'outline'}>
                              {typeLabel[item.type]}
                            </Badge>
                            {!item.is_active && <Badge variant="destructive">Inativo</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {item.category_name || 'Sem categoria'} · {item.code || 'Sem código'} · {recurrenceLabel[item.recurrence]}
                          </p>
                          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <span className="font-semibold">{currency(item.unit_price)} <span className="text-xs font-normal text-muted-foreground">/ {item.unit}</span></span>
                          <Button variant="ghost" size="icon" onClick={() => setItemDialog(item)} aria-label="Editar item">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={async () => {
                              if (confirm(`Excluir "${item.name}"?`)) await mutations.deleteItem.mutateAsync(item.id);
                            }}
                            aria-label="Excluir item"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="categories" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" /> Categorias
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingCategories ? (
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                ) : categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>
                ) : (
                  <div className="space-y-2">
                    {categories.map((category) => (
                      <div key={category.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <p className="font-medium">{category.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {category.items_count || 0} item(s) {!category.is_active && '· Inativa'}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setCategoryDialog(category)} aria-label="Editar categoria">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={async () => {
                              if (confirm(`Excluir "${category.name}"?`)) await mutations.deleteCategory.mutateAsync(category.id);
                            }}
                            aria-label="Excluir categoria"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!categoryDialog} onOpenChange={(open) => !open && setCategoryDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{categoryDialog === 'new' ? 'Nova categoria' : 'Editar categoria'}</DialogTitle>
          </DialogHeader>
          <form id="category-form" onSubmit={(event) => {
            event.preventDefault();
            handleSaveCategory(new FormData(event.currentTarget));
          }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Nome</Label>
              <Input id="category-name" name="name" defaultValue={categoryDialog !== 'new' ? categoryDialog?.name : ''} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-description">Descrição</Label>
              <Textarea id="category-description" name="description" defaultValue={categoryDialog !== 'new' ? categoryDialog?.description : ''} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-position">Ordem</Label>
              <Input id="category-position" name="position" type="number" defaultValue={categoryDialog !== 'new' ? categoryDialog?.position : 0} />
            </div>
            {categoryDialog !== 'new' && (
              <div className="flex items-center gap-2">
                <Switch id="category-active" name="is_active" defaultChecked={categoryDialog?.is_active} />
                <Label htmlFor="category-active">Categoria ativa</Label>
              </div>
            )}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialog(null)}>Cancelar</Button>
            <Button type="submit" form="category-form">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!itemDialog} onOpenChange={(open) => !open && setItemDialog(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{itemDialog === 'new' ? 'Novo item' : 'Editar item'}</DialogTitle>
          </DialogHeader>
          <form id="item-form" onSubmit={(event) => {
            event.preventDefault();
            handleSaveItem(new FormData(event.currentTarget));
          }} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="item-type">Tipo</Label>
                <Select name="type" defaultValue={itemDialog !== 'new' ? itemDialog.type : 'product'}>
                  <SelectTrigger id="item-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">Produto</SelectItem>
                    <SelectItem value="service">Serviço</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-category">Categoria</Label>
                <Select name="category_id" defaultValue={itemDialog !== 'new' ? itemDialog.category_id || 'none' : 'none'}>
                  <SelectTrigger id="item-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem categoria</SelectItem>
                    {activeCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="item-name">Nome</Label>
                <Input id="item-name" name="name" defaultValue={itemDialog !== 'new' ? itemDialog.name : ''} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-code">Código/SKU</Label>
                <Input id="item-code" name="code" defaultValue={itemDialog !== 'new' ? itemDialog.code : ''} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-description">Descrição</Label>
              <Textarea id="item-description" name="description" defaultValue={itemDialog !== 'new' ? itemDialog.description : ''} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="item-unit">Unidade</Label>
                <Input id="item-unit" name="unit" defaultValue={itemDialog !== 'new' ? itemDialog.unit : 'un'} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-recurrence">Recorrência</Label>
                <Select name="recurrence" defaultValue={itemDialog !== 'new' ? itemDialog.recurrence : 'one_time'}>
                  <SelectTrigger id="item-recurrence"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">Único</SelectItem>
                    <SelectItem value="monthly">Mensal</SelectItem>
                    <SelectItem value="yearly">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-price">Preço base</Label>
                <Input id="item-price" name="unit_price" inputMode="decimal" defaultValue={itemDialog !== 'new' ? String(itemDialog.unit_price) : '0'} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="item-external-id">ID externo (opcional)</Label>
                <Input id="item-external-id" name="external_id" defaultValue={itemDialog !== 'new' ? itemDialog.external_id : ''} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-external-source">Sistema externo (opcional)</Label>
                <Input id="item-external-source" name="external_source" defaultValue={itemDialog !== 'new' ? itemDialog.external_source : ''} />
              </div>
            </div>
            {itemDialog !== 'new' && (
              <div className="flex items-center gap-2">
                <Switch id="item-active" name="is_active" defaultChecked={itemDialog?.is_active} />
                <Label htmlFor="item-active">Item ativo</Label>
              </div>
            )}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog(null)}>Cancelar</Button>
            <Button type="submit" form="item-form">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

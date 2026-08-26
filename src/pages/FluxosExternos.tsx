import { useState, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Copy,
  Edit2,
  ExternalLink,
  Eye,
  FileText,
  Link2,
  MoreHorizontal,
  Plus,
  CopyPlus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useExternalForms, ExternalForm } from "@/hooks/use-external-forms";
import { ExternalFormEditorDialog } from "@/components/external-forms/ExternalFormEditorDialog";
import { FormSubmissionsDialog } from "@/components/external-forms/FormSubmissionsDialog";

export default function FluxosExternos() {
  const [search, setSearch] = useState("");
  const [editingForm, setEditingForm] = useState<ExternalForm | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [viewingSubmissions, setViewingSubmissions] = useState<ExternalForm | null>(null);

  const { forms, isLoading, updateForm, deleteForm, duplicateForm } = useExternalForms();

  const filteredForms = useMemo(() => {
    if (!search.trim()) return forms;
    const term = search.toLowerCase();
    return forms.filter(
      (f) =>
        f.name.toLowerCase().includes(term) ||
        f.slug.toLowerCase().includes(term)
    );
  }, [forms, search]);

  const handleToggleActive = async (form: ExternalForm) => {
    await updateForm.mutateAsync({
      ...form,
      is_active: !form.is_active,
    });
  };

  const handleDuplicate = async (form: ExternalForm) => {
    await duplicateForm.mutateAsync(form.id);
  };

  const handleDelete = async (form: ExternalForm) => {
    if (!confirm(`Excluir o formulário "${form.name}"?`)) return;
    await deleteForm.mutateAsync(form.id);
  };

  const copyLink = (form: ExternalForm) => {
    const url = `${window.location.origin}/f/${form.slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado!");
  };

  const openPreview = (form: ExternalForm) => {
    window.open(`/f/${form.slug}`, "_blank");
  };

  const handleEdit = (form: ExternalForm) => {
    setEditingForm(form);
    setShowEditor(true);
  };

  const handleNewForm = () => {
    setEditingForm(null);
    setShowEditor(true);
  };

  const totalViews = forms.reduce((acc, f) => acc + (f.views_count || 0), 0);
  const totalSubmissions = forms.reduce((acc, f) => acc + (f.submissions_count || 0), 0);
  const conversionRate = totalViews > 0 ? ((totalSubmissions / totalViews) * 100).toFixed(1) : "0";

  return (
    <MainLayout>
      <div className="space-y-4 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          <div>
            <h1 className="text-2xl font-bold">Fluxos Externos</h1>
            <p className="text-muted-foreground">
              Crie formulários públicos para captura de leads via chat conversacional
            </p>
          </div>
          <Button onClick={handleNewForm}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Formulário
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de Formulários
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{forms.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Ativos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {forms.filter((f) => f.is_active).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Visualizações
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalViews}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Conversão
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {totalSubmissions} ({conversionRate}%)
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar formulários..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Table */}
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead className="text-center">Campos</TableHead>
                  <TableHead className="text-center">Views</TableHead>
                  <TableHead className="text-center">Leads</TableHead>
                  <TableHead className="text-center">Ativo</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filteredForms.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                        <p className="text-muted-foreground">
                          Nenhum formulário encontrado
                        </p>
                        <Button variant="outline" size="sm" onClick={handleNewForm}>
                          <Plus className="h-4 w-4 mr-2" />
                          Criar primeiro formulário
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredForms.map((form) => (
                    <TableRow key={form.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{form.name}</p>
                          {form.description && (
                            <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {form.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs">
                            /f/{form.slug}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => copyLink(form)}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{form.field_count || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Eye className="h-3 w-3 text-muted-foreground" />
                          {form.views_count || 0}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1"
                          onClick={() => setViewingSubmissions(form)}
                        >
                          <Users className="h-3 w-3 mr-1" />
                          {form.submissions_count || 0}
                        </Button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={form.is_active}
                          onCheckedChange={() => handleToggleActive(form)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleEdit(form)}
                            title="Editar formulário"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(form)}>
                              <Edit2 className="h-4 w-4 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openPreview(form)}>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Visualizar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => copyLink(form)}>
                              <Link2 className="h-4 w-4 mr-2" />
                              Copiar Link
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setViewingSubmissions(form)}>
                              <Users className="h-4 w-4 mr-2" />
                              Ver Leads
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(form)}>
                              <CopyPlus className="h-4 w-4 mr-2" />
                              Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDelete(form)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Editor Dialog */}
      <ExternalFormEditorDialog
        open={showEditor}
        onClose={() => {
          setShowEditor(false);
          setEditingForm(null);
        }}
        form={editingForm}
      />

      {/* Submissions Dialog */}
      {viewingSubmissions && (
        <FormSubmissionsDialog
          open={!!viewingSubmissions}
          onClose={() => setViewingSubmissions(null)}
          form={viewingSubmissions}
        />
      )}
    </MainLayout>
  );
}

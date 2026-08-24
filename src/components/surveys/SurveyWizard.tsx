import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Sparkles, ArrowRight, ArrowLeft, Check, Star, Trash2, Plus } from "lucide-react";
import { FormField } from "@/hooks/use-external-forms";

interface SurveyWizardProps {
  onClose: () => void;
  onSave: (data: any) => void;
  isSubmitting?: boolean;
}

export function SurveyWizard({ onClose, onSave, isSubmitting }: SurveyWizardProps) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    welcome_message: "Gostaríamos de ouvir sua opinião!",
    thank_you_message: "Obrigado por participar!",
    primary_color: "#f97316",
    fields: [
      { 
        field_key: "rating", 
        field_label: "De 0 a 10, o quanto você nos recomendaria?", 
        field_type: "select" as const, 
        is_required: true, 
        options: ["0","1","2","3","4","5","6","7","8","9","10"],
        position: 0
      }
    ] as FormField[]
  });

  const nextStep = () => setStep(s => s + 1);
  const prevStep = () => setStep(s => s - 1);

  const addField = () => {
    const newField: FormField = {
      field_key: `q_${formData.fields.length}`,
      field_label: "",
      field_type: "text",
      is_required: false,
      position: formData.fields.length
    };
    setFormData(prev => ({ ...prev, fields: [...prev.fields, newField] }));
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const newFields = [...formData.fields];
    newFields[index] = { ...newFields[index], ...updates };
    setFormData(prev => ({ ...prev, fields: newFields }));
  };

  const removeField = (index: number) => {
    if (formData.fields.length <= 1) return;
    const newFields = formData.fields.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, fields: newFields }));
  };

  const handleSave = () => {
    if (!formData.name) {
      toast.error("O nome da pesquisa é obrigatório");
      setStep(1);
      return;
    }
    onSave(formData);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto border-orange-200 shadow-xl">
      <CardHeader className="bg-orange-50/50 border-b border-orange-100">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl flex items-center gap-2 text-orange-700">
            <Star className="h-5 w-5 fill-orange-500 text-orange-500" />
            Assistente de Pesquisa
          </CardTitle>
          <div className="flex gap-1">
            {[1, 2, 3].map(i => (
              <div 
                key={i} 
                className={`h-2 w-8 rounded-full transition-colors ${step >= i ? 'bg-orange-500' : 'bg-orange-200'}`}
              />
            ))}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="py-6 space-y-4">
        {step === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome da Pesquisa</Label>
              <Input 
                id="name" 
                placeholder="Ex: Feedback de Atendimento" 
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição (Interna)</Label>
              <Textarea 
                id="description" 
                placeholder="Para qual finalidade é esta pesquisa?"
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div className="p-4 bg-blue-50 rounded-lg text-sm text-blue-700 border border-blue-100">
              <p>Dica: O nome da pesquisa será visível para você na listagem interna.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div className="flex justify-between items-center mb-2">
              <Label className="text-base font-semibold">Perguntas da Pesquisa</Label>
              <Button type="button" variant="outline" size="sm" onClick={addField} className="gap-1 border-orange-200 text-orange-600 hover:bg-orange-50">
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </div>
            
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
              {formData.fields.map((field, index) => (
                <div key={index} className="p-4 border rounded-lg bg-slate-50 relative group">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="absolute top-2 right-2 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeField(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <div className="grid gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Pergunta #{index + 1}</Label>
                      <Input 
                        placeholder="Escreva sua pergunta aqui..."
                        value={field.field_label}
                        onChange={e => updateField(index, { field_label: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Tipo de Resposta</Label>
                        <select 
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors"
                          value={field.field_type}
                          onChange={e => updateField(index, { field_type: e.target.value as any })}
                        >
                          <option value="text">Texto Curto</option>
                          <option value="textarea">Texto Longo</option>
                          <option value="rating_stars">Avaliação (Estrelas)</option>
                          <option value="select">NPS (0-10)</option>
                          <option value="phone">Telefone</option>
                          <option value="email">E-mail</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2 pt-6">
                        <input 
                          type="checkbox" 
                          id={`req-${index}`}
                          checked={field.is_required}
                          onChange={e => updateField(index, { is_required: e.target.checked })}
                          className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                        />
                        <Label htmlFor={`req-${index}`} className="text-xs cursor-pointer">Obrigatória</Label>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <div className="space-y-2">
              <Label htmlFor="welcome">Mensagem de Boas-vindas</Label>
              <Input 
                id="welcome" 
                value={formData.welcome_message}
                onChange={e => setFormData(prev => ({ ...prev, welcome_message: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="thanks">Mensagem de Agradecimento</Label>
              <Input 
                id="thanks" 
                value={formData.thank_you_message}
                onChange={e => setFormData(prev => ({ ...prev, thank_you_message: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Cor de Destaque</Label>
              <div className="flex gap-2">
                <Input 
                  type="color" 
                  className="w-12 h-10 p-1"
                  value={formData.primary_color}
                  onChange={e => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                />
                <Input 
                  value={formData.primary_color}
                  onChange={e => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
      
      <CardFooter className="flex justify-between border-t border-orange-50 bg-orange-50/30 py-4">
        <Button variant="ghost" onClick={step === 1 ? onClose : prevStep}>
          {step === 1 ? 'Cancelar' : <><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</>}
        </Button>
        <Button 
          className="bg-orange-500 hover:bg-orange-600 text-white" 
          onClick={step === 3 ? handleSave : nextStep}
          disabled={isSubmitting}
        >
          {step === 3 ? (
            isSubmitting ? 'Salvando...' : <><Check className="mr-2 h-4 w-4" /> Finalizar</>
          ) : (
            <>Próximo <ArrowRight className="ml-2 h-4 w-4" /></>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

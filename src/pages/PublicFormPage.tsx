import { useState, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Send, CheckCircle2, AlertCircle, ArrowRight, ArrowLeft } from "lucide-react";
import { getPublicForm, submitPublicForm, ExternalForm, FormField } from "@/hooks/use-external-forms";

interface ChatMessage {
  id: string;
  type: "bot" | "user";
  content: string;
  field?: FormField;
}

export default function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  
  const [form, setForm] = useState<ExternalForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentFieldIndex, setCurrentFieldIndex] = useState(-1);
  const [userInput, setUserInput] = useState("");
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [thankYouMessage, setThankYouMessage] = useState("");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (slug) {
      loadForm();
    }
  }, [slug]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (currentFieldIndex >= 0 && inputRef.current) {
      inputRef.current.focus();
    }
  }, [currentFieldIndex]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const loadForm = async () => {
    if (!slug) return;
    
    setLoading(true);
    setError(null);
    
    const result = await getPublicForm(slug);
    
    if (!result) {
      setError("Formulário não encontrado ou inativo");
      setLoading(false);
      return;
    }
    
    setForm(result);
    setLoading(false);

    const mode = result.display_mode || "typeform";
    if (mode === "chat") {
      setTimeout(() => {
        addBotMessage(result.welcome_message || "Olá! Vamos começar?");
        setTimeout(() => {
          askNextQuestion(0, result.fields || []);
        }, 800);
      }, 500);
    } else if (mode === "typeform") {
      // For Typeform mode, we don't start with chat messages, 
      // the view handles the current question index
      setMessages([]);
    }
  };

  const addBotMessage = (content: string, field?: FormField) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `bot-${Date.now()}`,
        type: "bot",
        content,
        field,
      },
    ]);
  };

  const addUserMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        type: "user",
        content,
      },
    ]);
  };

  const askNextQuestion = (index: number, fields: FormField[]) => {
    if (index >= fields.length) {
      // All questions answered, submit form
      handleSubmit();
      return;
    }

    const field = fields[index];
    setCurrentFieldIndex(index);
    addBotMessage(field.field_label, field);
  };

  const validateInput = (value: string, field: FormField): boolean => {
    if (field.is_required && !value.trim()) {
      addBotMessage("Este campo é obrigatório. Por favor, responda.");
      return false;
    }

    if (field.field_type === "email" && value.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        addBotMessage("Por favor, informe um e-mail válido.");
        return false;
      }
    }

    if (field.field_type === "phone" && value.trim()) {
      const phoneDigits = value.replace(/\D/g, "");
      if (phoneDigits.length < 10 || phoneDigits.length > 15) {
        addBotMessage("Por favor, informe um telefone válido com DDD (ex: 11999998888).");
        return false;
      }
      
      // WhatsApp Validation Mock - In production, this would call an API to check if number exists on WhatsApp
      // For now, we just enforce a minimum length and numeric characters
      if (phoneDigits.length < 10) {
        addBotMessage("Este número não parece ter o formato correto de um WhatsApp. Por favor, verifique se incluiu o DDD.");
        return false;
      }
    }

    return true;
  };

  const handleUserResponse = () => {
    if (!form?.fields || currentFieldIndex < 0) return;
    
    const field = form.fields[currentFieldIndex];
    const value = userInput.trim();
    
    if (!validateInput(value, field)) {
      setUserInput("");
      return;
    }

    // Add user message
    addUserMessage(value || "(não informado)");
    
    // Save data
    setFormData((prev) => ({
      ...prev,
      [field.field_key]: value,
    }));
    
    setUserInput("");
    
    // Ask next question after a small delay
    setTimeout(() => {
      askNextQuestion(currentFieldIndex + 1, form.fields || []);
    }, 500);
  };

  const handleSelectChange = (value: string) => {
    if (!form?.fields || currentFieldIndex < 0) return;
    
    const field = form.fields[currentFieldIndex];
    
    addUserMessage(value);
    
    setFormData((prev) => ({
      ...prev,
      [field.field_key]: value,
    }));
    
    setTimeout(() => {
      askNextQuestion(currentFieldIndex + 1, form.fields || []);
    }, 500);
  };

  const handleSubmit = async () => {
    if (!form || !slug) return;
    
    setSubmitting(true);
    setCurrentFieldIndex(-1);
    addBotMessage("Enviando suas informações...");
    
    try {
      const result = await submitPublicForm(slug, formData, {
        utm_source: searchParams.get("utm_source") || undefined,
        utm_medium: searchParams.get("utm_medium") || undefined,
        utm_campaign: searchParams.get("utm_campaign") || undefined,
        referrer: document.referrer || undefined,
      });
      
      setSubmitted(true);
      setThankYouMessage(result.thank_you_message || form.thank_you_message || "Obrigado!");
      
      // Remove "Enviando..." message and add thank you
      setMessages((prev) => prev.filter((m) => !m.content.includes("Enviando")));
      addBotMessage(result.thank_you_message || form.thank_you_message || "Obrigado pelo contato!");
      
      // Redirect if configured
      if (result.redirect_url) {
        setTimeout(() => {
          window.location.href = result.redirect_url!;
        }, 2000);
      }
    } catch (err: any) {
      addBotMessage(`Erro ao enviar: ${err.message}. Tente novamente.`);
      // Allow retry by going back to last field
      setCurrentFieldIndex((form.fields?.length || 1) - 1);
    }
    
    setSubmitting(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleUserResponse();
    }
  };

  const currentField = form?.fields?.[currentFieldIndex];

  // Normalize options: JSONB may arrive as array, JSON string, or newline text
  const normalizeOptions = (opts: unknown): string[] => {
    if (!opts) return [];
    if (Array.isArray(opts)) return opts.map((o) => String(o).trim()).filter(Boolean);
    if (typeof opts === "string") {
      try {
        const parsed = JSON.parse(opts);
        if (Array.isArray(parsed)) return parsed.map((o) => String(o).trim()).filter(Boolean);
      } catch {
        return opts.split("\n").map((s) => s.trim()).filter(Boolean);
      }
    }
    return [];
  };
  const currentOptions = currentField ? normalizeOptions((currentField as any).options) : [];

  // Loading state
  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#f5f5f5" }}
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4 p-4"
        style={{ backgroundColor: "#f5f5f5" }}
      >
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-lg text-center">{error}</p>
      </div>
    );
  }

  if (!form) return null;

  const primaryColor = form.primary_color || "#6366f1";
  const bgColor = form.background_color || "#ffffff";
  const textColor = form.text_color || "#1f2937";

  const mode = (form.display_mode as "chat" | "typeform" | "standard") || "typeform";

  const doSubmit = async (data: Record<string, string>) => {
    if (!slug) return null;
    setSubmitting(true);
    try {
      const result = await submitPublicForm(slug, data, {
        utm_source: searchParams.get("utm_source") || undefined,
        utm_medium: searchParams.get("utm_medium") || undefined,
        utm_campaign: searchParams.get("utm_campaign") || undefined,
        referrer: document.referrer || undefined,
      });
      setSubmitted(true);
      setThankYouMessage(result.thank_you_message || form.thank_you_message || "Obrigado!");
      if (result.redirect_url) {
        setTimeout(() => { window.location.href = result.redirect_url!; }, 2000);
      }
      return result;
    } catch (err: any) {
      alert(`Erro ao enviar: ${err.message}`);
      return null;
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === "typeform") {
    return (
      <TypeformView
        form={form}
        primaryColor={primaryColor}
        bgColor={bgColor}
        textColor={textColor}
        submitted={submitted}
        submitting={submitting}
        thankYouMessage={thankYouMessage}
        onSubmit={doSubmit}
      />
    );
  }

  if (mode === "standard") {
    return (
      <StandardView
        form={form}
        primaryColor={primaryColor}
        bgColor={bgColor}
        textColor={textColor}
        submitted={submitted}
        submitting={submitting}
        thankYouMessage={thankYouMessage}
        onSubmit={doSubmit}
      />
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: bgColor }}
    >
      {/* Header */}
      <header
        className="py-4 px-6 border-b flex items-center justify-center gap-3"
        style={{ borderColor: `${primaryColor}20` }}
      >
        {form.logo_url && (
          <img
            src={form.logo_url}
            alt="Logo"
            style={{ height: `${form.logo_size || 48}px`, width: 'auto' }}
            className="object-contain"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )}
        {!form.logo_url && (
          <h1
            className="text-lg font-semibold"
            style={{ color: textColor }}
          >
            {form.name}
          </h1>
        )}
      </header>

      {/* Chat Area */}
      <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full p-4">
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.type === "user"
                    ? "rounded-br-md"
                    : "rounded-bl-md"
                }`}
                style={{
                  backgroundColor:
                    message.type === "user" ? primaryColor : `${primaryColor}15`,
                  color: message.type === "user" ? "#ffffff" : textColor,
                }}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          ))}
          
          {submitted && (
            <div className="flex justify-center py-4">
              <CheckCircle2 className="h-12 w-12" style={{ color: primaryColor }} />
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        {!submitted && currentFieldIndex >= 0 && currentField && (
          <div
            className="border-t pt-4"
            style={{ borderColor: `${primaryColor}20` }}
          >
            {currentField.field_type === "select" && currentOptions.length > 0 ? (
              <Select onValueChange={handleSelectChange}>
                <SelectTrigger
                  className="w-full"
                  style={{ borderColor: primaryColor }}
                >
                  <SelectValue placeholder="Selecione uma opção..." />
                </SelectTrigger>
                <SelectContent>
                  {currentOptions.map((option, idx) => (
                    <SelectItem key={idx} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : currentField.field_type === "textarea" ? (
              <div className="flex gap-2">
                <Textarea
                  ref={inputRef as any}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder={currentField.placeholder || "Digite sua resposta..."}
                  className="flex-1 min-h-[80px]"
                  style={{ borderColor: primaryColor }}
                />
                <Button
                  onClick={handleUserResponse}
                  disabled={submitting}
                  style={{ backgroundColor: primaryColor }}
                  className="self-end"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  type={currentField.field_type === "email" ? "email" : "text"}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={currentField.placeholder || "Digite sua resposta..."}
                  className="flex-1"
                  style={{ borderColor: primaryColor }}
                  disabled={submitting}
                />
                <Button
                  onClick={handleUserResponse}
                  disabled={submitting}
                  style={{ backgroundColor: primaryColor }}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
            
            {!currentField.is_required && (
              <button
                onClick={() => {
                  setUserInput("");
                  handleUserResponse();
                }}
                className="text-sm mt-2 underline"
                style={{ color: `${textColor}80` }}
              >
                Pular esta pergunta
              </button>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer
        className="py-3 text-center text-xs"
        style={{ color: `${textColor}60` }}
      >
        {form.organization_name && (
          <span>© {new Date().getFullYear()} {form.organization_name}</span>
        )}
      </footer>
    </div>
  );
}

// ============ Shared helpers ============

function normalizeOpts(opts: unknown): string[] {
  if (!opts) return [];
  if (Array.isArray(opts)) return opts.map((o) => String(o).trim()).filter(Boolean);
  if (typeof opts === "string") {
    try {
      const parsed = JSON.parse(opts);
      if (Array.isArray(parsed)) return parsed.map((o) => String(o).trim()).filter(Boolean);
    } catch {
      return opts.split("\n").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function validateField(value: string, field: FormField): string | null {
  if (field.is_required && !value.trim()) return "Este campo é obrigatório.";
  if (field.field_type === "email" && value.trim()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "E-mail inválido.";
  }
  if (field.field_type === "phone" && value.trim()) {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return "Telefone inválido.";
  }
  return null;
}

interface ViewProps {
  form: ExternalForm;
  primaryColor: string;
  bgColor: string;
  textColor: string;
  submitted: boolean;
  submitting: boolean;
  thankYouMessage: string;
  onSubmit: (data: Record<string, string>) => Promise<any>;
}

// ============ TYPEFORM VIEW ============
function TypeformView({ form, primaryColor, bgColor, textColor, submitted, submitting, thankYouMessage, onSubmit }: ViewProps) {
  const fields = form.fields || [];
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");

  const total = fields.length;
  const current = fields[index];
  const progress = total ? Math.round(((index) / total) * 100) : 0;

  useEffect(() => {
    setAnimKey((k) => k + 1);
    setError(null);
  }, [index]);

  const goNext = async () => {
    if (!current) return;
    const val = values[current.field_key] || "";
    const err = validateField(val, current);
    if (err) { setError(err); return; }
    if (index + 1 >= total) {
      await onSubmit(values);
    } else {
      setDirection("next");
      setIndex(index + 1);
    }
  };

  const goPrev = () => { if (index > 0) { setDirection("prev"); setIndex(index - 1); } };

  const setVal = (v: string) => setValues({ ...values, [current.field_key]: v });
  const opts = current ? normalizeOpts((current as any).options) : [];

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8" style={{ backgroundColor: bgColor, color: textColor }}>
        <CheckCircle2 className="h-16 w-16 mb-4" style={{ color: primaryColor }} />
        <p className="text-xl text-center max-w-md">{thankYouMessage}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: bgColor, color: textColor }}>
      {/* Progress */}
      <div className="w-full h-1 bg-black/5">
        <div className="h-full transition-all duration-500" style={{ width: `${progress}%`, backgroundColor: primaryColor }} />
      </div>

      {/* Header with logo + title */}
      <header className="py-6 px-6 flex flex-col items-center gap-3 border-b" style={{ borderColor: `${primaryColor}15` }}>
        {form.logo_url && (
          <img src={form.logo_url} alt="Logo" style={{ height: `${form.logo_size || 48}px`, width: 'auto' }} className="object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
        )}
        <h1 className="text-xl font-semibold text-center" style={{ color: textColor }}>{form.name}</h1>
      </header>

      {/* Question */}
      <main className="flex-1 flex items-center justify-center p-6 overflow-hidden relative">
        <div 
          key={animKey} 
          className={`w-full max-w-xl transition-all duration-500 transform
            ${direction === "next" 
              ? (form.transition_type === "slide-left" ? "animate-in slide-in-from-left" : "animate-in slide-in-from-right")
              : (form.transition_type === "slide-left" ? "animate-in slide-in-from-right" : "animate-in slide-in-from-left")
            }
          `}
        >
          <div className="mb-4 text-sm opacity-60">{index + 1} / {total}</div>
          <h2 className="text-2xl sm:text-3xl font-medium mb-6" style={{ color: textColor }}>
            {current?.field_label}
            {current?.is_required && <span style={{ color: primaryColor }}> *</span>}
          </h2>

          {current?.field_type === "select" && opts.length > 0 ? (
            <div className="space-y-2">
              {opts.map((opt) => {
                const selected = values[current.field_key] === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => { setVal(opt); setTimeout(goNext, 200); }}
                    className="w-full text-left px-4 py-3 rounded-lg border transition-all hover:scale-[1.01]"
                    style={{
                      borderColor: selected ? primaryColor : `${primaryColor}40`,
                      backgroundColor: selected ? `${primaryColor}15` : "transparent",
                      color: textColor,
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          ) : current?.field_type === "textarea" ? (
            <Textarea
              value={values[current.field_key] || ""}
              onChange={(e) => setVal(e.target.value)}
              placeholder={current.placeholder || "Digite sua resposta..."}
              className="min-h-[120px] text-lg"
              style={{ borderColor: primaryColor }}
              autoFocus
            />
          ) : current ? (
            <Input
              type={current.field_type === "email" ? "email" : current.field_type === "phone" ? "tel" : "text"}
              value={values[current.field_key] || ""}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); goNext(); } }}
              placeholder={current.placeholder || "Digite sua resposta..."}
              className="text-lg py-6"
              style={{ borderColor: primaryColor }}
              autoFocus
            />
          ) : null}

          {error && <p className="text-sm mt-2 text-destructive">{error}</p>}

          <div className="flex items-center justify-between mt-8">
            <Button variant="ghost" onClick={goPrev} disabled={index === 0}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
            <Button
              onClick={goNext}
              disabled={submitting}
              style={{ backgroundColor: primaryColor }}
              className="text-white gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>
                  {index + 1 >= total ? (form.button_text || "Enviar") : "Próximo"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </main>

      <footer className="py-3 text-center text-xs opacity-60">
        {form.organization_name && <span>© {new Date().getFullYear()} {form.organization_name}</span>}
      </footer>
    </div>
  );
}

// ============ STANDARD FORM VIEW (embed-friendly) ============
function StandardView({ form, primaryColor, bgColor, textColor, submitted, submitting, thankYouMessage, onSubmit }: ViewProps) {
  const fields = form.fields || [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const err = validateField(values[f.field_key] || "", f);
      if (err) errs[f.field_key] = err;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    await onSubmit(values);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8" style={{ backgroundColor: bgColor, color: textColor }}>
        <CheckCircle2 className="h-16 w-16 mb-4" style={{ color: primaryColor }} />
        <p className="text-lg text-center max-w-md">{thankYouMessage}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4" style={{ backgroundColor: bgColor, color: textColor }}>
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          {form.logo_url && (
            <img src={form.logo_url} alt="Logo" style={{ height: `${form.logo_size || 48}px`, width: 'auto' }} className="mx-auto mb-3 object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
          )}
          <h1 className="text-2xl font-semibold" style={{ color: textColor }}>{form.name}</h1>
          {form.welcome_message && (
            <p className="mt-2 text-sm opacity-80">{form.welcome_message}</p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 border rounded-xl p-6" style={{ borderColor: `${primaryColor}25`, backgroundColor: "#ffffff08" }}>
          {fields.map((f) => {
            const opts = normalizeOpts((f as any).options);
            const err = errors[f.field_key];
            return (
              <div key={f.field_key} className="space-y-1">
                <label className="text-sm font-medium" style={{ color: textColor }}>
                  {f.field_label}
                  {f.is_required && <span style={{ color: primaryColor }}> *</span>}
                </label>
                {f.field_type === "select" && opts.length > 0 ? (
                  <Select
                    value={values[f.field_key] || ""}
                    onValueChange={(v) => setValues({ ...values, [f.field_key]: v })}
                  >
                    <SelectTrigger style={{ borderColor: primaryColor }}>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {opts.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                    </SelectContent>
                  </Select>
                ) : f.field_type === "textarea" ? (
                  <Textarea
                    value={values[f.field_key] || ""}
                    onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })}
                    placeholder={f.placeholder}
                    style={{ borderColor: primaryColor }}
                  />
                ) : (
                  <Input
                    type={f.field_type === "email" ? "email" : f.field_type === "phone" ? "tel" : "text"}
                    value={values[f.field_key] || ""}
                    onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })}
                    placeholder={f.placeholder}
                    style={{ borderColor: primaryColor }}
                  />
                )}
                {err && <p className="text-xs text-destructive">{err}</p>}
              </div>
            );
          })}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full text-white"
            style={{ backgroundColor: primaryColor }}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (form.button_text || "Enviar")}
          </Button>
        </form>

        {form.organization_name && (
          <p className="text-center text-xs mt-4 opacity-60">© {new Date().getFullYear()} {form.organization_name}</p>
        )}
      </div>
    </div>
  );
}

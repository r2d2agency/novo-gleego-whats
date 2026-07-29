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
import { Loader2, Send, CheckCircle2, AlertCircle } from "lucide-react";
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
    
    // Start chat with welcome message
    setTimeout(() => {
      addBotMessage(result.welcome_message || "Olá! Vamos começar?");
      setTimeout(() => {
        askNextQuestion(0, result.fields || []);
      }, 800);
    }, 500);
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
        addBotMessage("Por favor, informe um telefone válido com DDD.");
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
            className="h-10 object-contain"
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

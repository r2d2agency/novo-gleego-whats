import { FormField } from "@/hooks/use-external-forms";

export interface SurveyTemplate {
  id: string;
  name: string;
  description: string;
  welcome_message: string;
  thank_you_message: string;
  primary_color: string;
  fields: FormField[];
}

export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  {
    id: "nps-classica",
    name: "NPS Clássica",
    description: "A pergunta padrão de recomendação (0 a 10) com motivo e sugestão de melhoria.",
    welcome_message: "Gostaríamos de ouvir sua opinião!",
    thank_you_message: "Obrigado por participar!",
    primary_color: "#f97316",
    fields: [
      { field_key: "rating", field_label: "De 0 a 10, o quanto você nos recomendaria a um amigo?", field_type: "select", is_required: true, options: ["0","1","2","3","4","5","6","7","8","9","10"] },
      { field_key: "reason", field_label: "Qual o principal motivo da sua nota?", field_type: "textarea", is_required: false },
      { field_key: "improvement", field_label: "O que poderíamos fazer para melhorar sua experiência?", field_type: "textarea", is_required: false },
    ],
  },
  {
    id: "csat",
    name: "Satisfação (CSAT)",
    description: "Avaliação geral por estrelas, ideal para medir satisfação pontual.",
    welcome_message: "Como foi sua experiência com a gente?",
    thank_you_message: "Agradecemos seu feedback!",
    primary_color: "#eab308",
    fields: [
      { field_key: "csat", field_label: "De modo geral, como você avalia sua experiência?", field_type: "rating_stars", is_required: true },
      { field_key: "comment", field_label: "Quer contar mais alguma coisa?", field_type: "textarea", is_required: false },
    ],
  },
  {
    id: "pos-atendimento",
    name: "Pós-atendimento",
    description: "Avalia se o atendimento resolveu o problema do cliente.",
    welcome_message: "Acabamos de te atender — nos ajude a melhorar!",
    thank_you_message: "Valeu pelo retorno!",
    primary_color: "#3b82f6",
    fields: [
      { field_key: "resolved", field_label: "Seu problema foi resolvido no atendimento?", field_type: "select", is_required: true, options: ["Sim", "Parcialmente", "Não"] },
      { field_key: "rating", field_label: "De 0 a 10, como você avalia o atendimento recebido?", field_type: "select", is_required: true, options: ["0","1","2","3","4","5","6","7","8","9","10"] },
      { field_key: "comment", field_label: "Algo que gostaria de destacar sobre o atendimento?", field_type: "textarea", is_required: false },
    ],
  },
  {
    id: "pos-compra",
    name: "Pós-compra",
    description: "Satisfação com o produto e com a entrega.",
    welcome_message: "Recebeu seu pedido? Conta pra gente como foi!",
    thank_you_message: "Obrigado por comprar com a gente!",
    primary_color: "#22c55e",
    fields: [
      { field_key: "product_rating", field_label: "O que você achou do produto?", field_type: "rating_stars", is_required: true },
      { field_key: "delivery_rating", field_label: "Como foi a experiência de entrega?", field_type: "rating_stars", is_required: true },
      { field_key: "rating", field_label: "De 0 a 10, o quanto você nos recomendaria?", field_type: "select", is_required: false, options: ["0","1","2","3","4","5","6","7","8","9","10"] },
    ],
  },
  {
    id: "evento",
    name: "Pesquisa de Evento",
    description: "Feedback de organização, conteúdo e recomendação após um evento.",
    welcome_message: "Obrigado por participar do nosso evento!",
    thank_you_message: "Agradecemos sua avaliação!",
    primary_color: "#8b5cf6",
    fields: [
      { field_key: "organization_rating", field_label: "Como você avalia a organização do evento?", field_type: "rating_stars", is_required: true },
      { field_key: "content_rating", field_label: "Como você avalia o conteúdo apresentado?", field_type: "rating_stars", is_required: true },
      { field_key: "rating", field_label: "De 0 a 10, o quanto você recomendaria este evento?", field_type: "select", is_required: false, options: ["0","1","2","3","4","5","6","7","8","9","10"] },
      { field_key: "comment", field_label: "Sugestões para os próximos eventos?", field_type: "textarea", is_required: false },
    ],
  },
  {
    id: "cancelamento",
    name: "Motivo de Cancelamento",
    description: "Entenda por que o cliente está cancelando e se ele voltaria.",
    welcome_message: "Sentiremos sua falta! Pode nos contar o motivo?",
    thank_you_message: "Obrigado pelo retorno, vamos usar para melhorar!",
    primary_color: "#ef4444",
    fields: [
      { field_key: "reason", field_label: "Qual o principal motivo do cancelamento?", field_type: "select", is_required: true, options: ["Preço", "Atendimento", "Não uso mais", "Encontrei outra opção", "Outro"] },
      { field_key: "comment", field_label: "Quer detalhar melhor o motivo?", field_type: "textarea", is_required: false },
      { field_key: "would_return", field_label: "Você consideraria voltar no futuro?", field_type: "select", is_required: false, options: ["Sim", "Talvez", "Não"] },
    ],
  },
];

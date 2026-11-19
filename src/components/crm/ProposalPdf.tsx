import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CRMProposal } from "@/hooks/use-crm-config";

const currency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));

export interface ProposalPdfOptions {
  dealTitle?: string;
  companyName?: string;
}

function itemTotal(quantity: number, unitPrice: number, discountPercent: number) {
  const gross = Number(quantity || 0) * Number(unitPrice || 0);
  const discount = gross * (Number(discountPercent || 0) / 100);
  return Math.round((gross - discount) * 100) / 100;
}

export async function generateProposalPdf(
  proposal: CRMProposal,
  options: ProposalPdfOptions = {}
): Promise<void> {
  const doc = new jsPDF();
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  let cursorY = 20;

  if (proposal.template_logo_url) {
    try {
      const imageProps = doc.getImageProperties(proposal.template_logo_url);
      const maxWidth = 50;
      const maxHeight = 22;
      const ratio = Math.min(maxWidth / imageProps.width, maxHeight / imageProps.height);
      const width = imageProps.width * ratio;
      const height = imageProps.height * ratio;
      doc.addImage(proposal.template_logo_url, imageProps.fileType, margin, cursorY, width, height);
      cursorY += height + 4;
    } catch {
      try {
        const response = await fetch(proposal.template_logo_url);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const imageProps = doc.getImageProperties(dataUrl);
        const maxWidth = 50;
        const maxHeight = 22;
        const ratio = Math.min(maxWidth / imageProps.width, maxHeight / imageProps.height);
        doc.addImage(dataUrl, imageProps.fileType, margin, cursorY, imageProps.width * ratio, imageProps.height * ratio);
        cursorY += imageProps.height * ratio + 4;
      } catch {
        // Keep generating the PDF without the logo if it cannot be loaded.
      }
    }
  }

  if (proposal.template_header_text) {
    const headerLines = doc.splitTextToSize(proposal.template_header_text, pageWidth - margin * 2);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(headerLines, margin, cursorY);
    cursorY += headerLines.length * 5 + 2;
  }

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(proposal.title || "Proposta comercial", margin, cursorY);
  cursorY += 7;
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(`Proposta ${proposal.number || ""}`, margin, cursorY);
  cursorY += 10;
  doc.setTextColor(30, 30, 30);

  if (options.dealTitle || options.companyName) {
    doc.setFontSize(10);
    doc.text(
      [options.companyName, options.dealTitle].filter(Boolean).join(" • "),
      margin,
      cursorY
    );
    cursorY += 7;
  }

  if (proposal.template_description) {
    const descriptionLines = doc.splitTextToSize(proposal.template_description, pageWidth - margin * 2);
    doc.setFontSize(10);
    doc.text(descriptionLines, margin, cursorY);
    cursorY += descriptionLines.length * 5 + 3;
  }

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Dados do cliente", margin, cursorY);
  cursorY += 6;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const customerLines = [
    proposal.customer_name ? `Nome: ${proposal.customer_name}` : null,
    proposal.customer_document ? `Documento: ${proposal.customer_document}` : null,
    proposal.customer_email ? `E-mail: ${proposal.customer_email}` : null,
    proposal.customer_phone ? `Telefone: ${proposal.customer_phone}` : null,
  ].filter(Boolean) as string[];
  if (customerLines.length === 0) {
    doc.text("Cliente não informado", margin, cursorY);
    cursorY += 6;
  } else {
    customerLines.forEach((line) => {
      doc.text(line, margin, cursorY);
      cursorY += 5;
    });
    cursorY += 2;
  }

  const items = proposal.items ?? [];
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [["Item", "Qtd", "Preço unit.", "Desconto %", "Total"]],
    body: items.map((item) => [
      item.name,
      String(item.quantity),
      currency(item.unit_price),
      `${Number(item.discount_percent || 0)}%`,
      currency(item.total ?? itemTotal(item.quantity, item.unit_price, item.discount_percent)),
    ]),
    headStyles: { fillColor: [30, 30, 46], textColor: 255, fontStyle: "bold", fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [245, 245, 250] },
  });
  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  const subtotal = Number(proposal.subtotal || 0);
  const discountAmount = Number(proposal.discount_amount || 0);
  const total = Number(proposal.total || 0);
  doc.setFontSize(10);
  const totals: Array<[string, string]> = [
    ["Subtotal:", currency(subtotal)],
    [`Desconto (${Number(proposal.discount_percent || 0)}%):`, currency(discountAmount)],
    ["Total:", currency(total)],
  ];
  totals.forEach(([label, value], index) => {
    doc.setFont("helvetica", index === totals.length - 1 ? "bold" : "normal");
    doc.text(label, pageWidth - margin - 70, cursorY);
    doc.text(value, pageWidth - margin, cursorY, { align: "right" });
    cursorY += 6;
  });
  cursorY += 4;

  doc.setFont("helvetica", "normal");
  if (proposal.template_footer_text) {
    const footerLines = doc.splitTextToSize(proposal.template_footer_text, pageWidth - margin * 2);
    doc.setFontSize(9);
    doc.text(footerLines, margin, cursorY);
    cursorY += footerLines.length * 4 + 3;
  }
  if (proposal.payment_terms) {
    doc.setFontSize(10);
    doc.text(`Pagamento: ${proposal.payment_terms}`, margin, cursorY, {
      maxWidth: pageWidth - margin * 2,
    });
    cursorY += 6;
  }
  doc.text(
    `Validade: ${Number(proposal.validity_days || 0)} dias`,
    margin,
    cursorY
  );
  cursorY += 6;
  if (proposal.notes) {
    const notesLines = doc.splitTextToSize(`Observações: ${proposal.notes}`, pageWidth - margin * 2);
    doc.text(notesLines, margin, cursorY);
    cursorY += notesLines.length * 5;
  }

  doc.setFontSize(9);
  doc.setTextColor(130, 130, 130);
  doc.text(
    `Gerado em ${new Date().toLocaleString("pt-BR")}`,
    margin,
    doc.internal.pageSize.getHeight() - 10
  );

  doc.save(`proposta-${proposal.number || proposal.id}.pdf`);
}

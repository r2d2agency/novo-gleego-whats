import { Router } from 'express';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { createTaskCardInGlobalBoard } from '../lib/task-card-helper.js';
import { logInfo, logError } from '../logger.js';

const router = Router();

// Save a base64 data URL image to /uploads/identity and return the public relative path
function saveIdentityImage(dataUrl, signerId, kind) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  try {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    const extMap = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
    const ext = extMap[mime] || '.jpg';
    const dir = path.join(process.cwd(), 'uploads', 'identity');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `${signerId}-${kind}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(dir, filename), buffer);
    return `/uploads/identity/${filename}`;
  } catch (err) {
    console.error('[doc-signatures] saveIdentityImage failed:', err?.message);
    return null;
  }
}

// Helper: get org id for user
async function getUserOrgId(userId) {
  const r = await query(
    `SELECT o.id FROM organizations o JOIN organization_members om ON om.organization_id = o.id WHERE om.user_id = $1 LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.id || null;
}

// Helper: audit log
async function auditLog(documentId, action, { name, email, ip, userAgent, geolocation, details }) {
  await query(
    `INSERT INTO doc_signature_audit (document_id, action, actor_name, actor_email, ip_address, user_agent, geolocation, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [documentId, action, name || null, email || null, ip || null, userAgent || null, geolocation || null, JSON.stringify(details || {})]
  );
}

// Ensure tables exist
async function ensureTables() {
  try {
    await query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_doc_signatures BOOLEAN DEFAULT false`);
    
    await query(`CREATE TABLE IF NOT EXISTS doc_signature_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL,
      description TEXT,
      file_url TEXT NOT NULL,
      signed_file_url TEXT,
      status VARCHAR(20) DEFAULT 'draft',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      hash_sha256 VARCHAR(64),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    await query(`CREATE TABLE IF NOT EXISTS doc_signature_signers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES doc_signature_documents(id) ON DELETE CASCADE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      cpf VARCHAR(14) NOT NULL,
      role VARCHAR(20) DEFAULT 'signer',
      sign_order INTEGER DEFAULT 1,
      status VARCHAR(20) DEFAULT 'pending',
      signature_url TEXT,
      signed_at TIMESTAMP WITH TIME ZONE,
      sign_token VARCHAR(128) UNIQUE NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      geolocation TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    await query(`CREATE TABLE IF NOT EXISTS doc_signature_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES doc_signature_documents(id) ON DELETE CASCADE NOT NULL,
      signer_id UUID REFERENCES doc_signature_signers(id) ON DELETE CASCADE NOT NULL,
      page INTEGER NOT NULL DEFAULT 1,
      x DECIMAL(10, 4) NOT NULL,
      y DECIMAL(10, 4) NOT NULL,
      width DECIMAL(10, 4) NOT NULL DEFAULT 200,
      height DECIMAL(10, 4) NOT NULL DEFAULT 80
    )`);

    await query(`CREATE TABLE IF NOT EXISTS doc_signature_audit (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID REFERENCES doc_signature_documents(id) ON DELETE CASCADE NOT NULL,
      action VARCHAR(100) NOT NULL,
      actor_name VARCHAR(255),
      actor_email VARCHAR(255),
      ip_address VARCHAR(45),
      user_agent TEXT,
      geolocation TEXT,
      details JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    await query(`CREATE INDEX IF NOT EXISTS idx_doc_sig_signers_token ON doc_signature_signers(sign_token)`);

    // OTP verification table
    await query(`CREATE TABLE IF NOT EXISTS doc_signature_otp (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      signer_id UUID REFERENCES doc_signature_signers(id) ON DELETE CASCADE NOT NULL,
      code VARCHAR(6) NOT NULL,
      verified BOOLEAN DEFAULT false,
      attempts INTEGER DEFAULT 0,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    // Add phone column to signers if not exists
    await query(`ALTER TABLE doc_signature_signers ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`);
    // Add deal_id to documents for CRM integration
    await query(`ALTER TABLE doc_signature_documents ADD COLUMN IF NOT EXISTS deal_id UUID`);
    // Add doc_signatures_limit to plans (0 = unlimited)
    await query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS doc_signatures_limit INTEGER DEFAULT 0`);
    // Add require_cnh_validation to documents
    await query(`ALTER TABLE doc_signature_documents ADD COLUMN IF NOT EXISTS require_cnh_validation BOOLEAN DEFAULT false`);
    // Add cnh_validated to signers
    await query(`ALTER TABLE doc_signature_signers ADD COLUMN IF NOT EXISTS cnh_validated BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE doc_signature_signers ADD COLUMN IF NOT EXISTS cnh_image_url TEXT`);

    // Add identity validation (selfie + document front + back)
    await query(`ALTER TABLE doc_signature_documents ADD COLUMN IF NOT EXISTS require_identity_validation BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE doc_signature_signers ADD COLUMN IF NOT EXISTS identity_validated BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE doc_signature_signers ADD COLUMN IF NOT EXISTS selfie_image_url TEXT`);
    await query(`ALTER TABLE doc_signature_signers ADD COLUMN IF NOT EXISTS doc_front_image_url TEXT`);
    await query(`ALTER TABLE doc_signature_signers ADD COLUMN IF NOT EXISTS doc_back_image_url TEXT`);
    await query(`ALTER TABLE doc_signature_signers ADD COLUMN IF NOT EXISTS identity_validation_details JSONB`);

  } catch (e) {
    console.error('[doc-signatures] Table init error:', e.message);
  }
}

ensureTables();

// Encryption for SMTP passwords (must match email.js)
const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'whatsale-email-key-32chars!!';
const ALGORITHM = 'aes-256-cbc';

function decryptPassword(encryptedPassword) {
  try {
    const [ivHex, encrypted] = encryptedPassword.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedPassword; // fallback: assume plain text
  }
}

// Helper: get SMTP config for doc signatures (system SMTP takes precedence)
async function getSmtpConfig(orgId) {
  // 1. Prefer explicit system-level SMTP from Superadmin Integrations
  try {
    const rSystem = await query(`SELECT value FROM system_settings WHERE key = 'doc_signature_smtp'`);
    if (rSystem.rows[0]?.value) {
      const config = JSON.parse(rSystem.rows[0].value);
      if (config?.host && config?.username) {
        return config;
      }
    }
  } catch (e) {
    console.error('[doc-signatures] System SMTP read error:', e.message);
  }

  // 2. Fallback to org SMTP if system SMTP is not configured
  try {
    if (orgId) {
      const rOrg = await query(`SELECT * FROM email_smtp_configs WHERE organization_id = $1 AND is_active = true LIMIT 1`, [orgId]);
      if (rOrg.rows[0]) return rOrg.rows[0];
    }
  } catch (e) {
    console.log('[doc-signatures] Org SMTP not available:', e.message);
  }

  return null;
}

// Helper: create nodemailer transporter
function createTransporter(config) {
  const port = Number(config.port) || 587;
  const secure = config.secure === true || config.secure === 'true' || port === 465;
  const password = config.password_encrypted ? decryptPassword(config.password_encrypted) : config.password;

  return nodemailer.createTransport({
    host: config.host,
    port,
    secure,
    auth: { user: config.username, pass: password },
  });
}

const HTTP_URL_REGEX = /^https?:\/\//i;

function extractUploadsRelativePath(source) {
  if (!source || typeof source !== 'string') return null;

  const fromPathname = (pathname) => {
    if (!pathname) return null;

    const normalizedPathname = pathname.replace(/\/{2,}/g, '/');

    const publicRouteMatch = normalizedPathname.match(/\/api\/uploads\/public\/([^/]+)(?:\/[^/]+)?/i);
    if (publicRouteMatch?.[1]) {
      try {
        const stored = decodeURIComponent(publicRouteMatch[1]);
        const normalizedStored = path.posix.normalize(stored).replace(/^\/+/, '');
        if (!normalizedStored || normalizedStored.startsWith('..')) return null;
        return normalizedStored;
      } catch {
        return null;
      }
    }

    const marker = '/uploads/';
    const markerIndex = normalizedPathname.indexOf(marker);
    if (markerIndex === -1) return null;

    const raw = normalizedPathname.slice(markerIndex + marker.length).split('?')[0].split('#')[0];
    const normalized = path.posix.normalize(raw).replace(/^\/+/, '');
    if (!normalized || normalized.startsWith('..')) return null;
    return normalized;
  };

  if (HTTP_URL_REGEX.test(source)) {
    try {
      return fromPathname(new URL(source).pathname);
    } catch {
      return null;
    }
  }

  return fromPathname(source);
}

function resolveLocalUploadsPath(source) {
  const relativePath = extractUploadsRelativePath(source);
  if (!relativePath) return null;

  const localPath = path.join(process.cwd(), 'uploads', relativePath);
  return fs.existsSync(localPath) ? localPath : null;
}

function normalizeDocumentFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return fileUrl;
  const relativePath = extractUploadsRelativePath(fileUrl);
  if (!relativePath) return fileUrl;
  return `/uploads/${relativePath}`;
}

async function readRemoteBinary(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download file: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return Array.isArray(forwarded)
    ? forwarded[0]
    : (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || null);
}

function toAbsoluteFileUrl(req, fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null;
  if (HTTP_URL_REGEX.test(fileUrl) || /^data:/i.test(fileUrl) || /^blob:/i.test(fileUrl)) {
    return fileUrl;
  }

  const normalizedPath = fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`;
  const envBase = String(process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (envBase && HTTP_URL_REGEX.test(envBase)) {
    return `${envBase}${normalizedPath}`;
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocolRaw = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : req.protocol);
  const protocol = protocolRaw || 'http';
  const host = req.get?.('host') || req.headers.host;

  if (!host) return normalizedPath;
  return `${protocol}://${host}${normalizedPath}`;
}

// Helper: send OTP email
async function sendOtpEmail(signerEmail, signerName, code, docTitle, orgId) {
  const smtpConfig = await getSmtpConfig(orgId);

  if (!smtpConfig) {
    console.error('[doc-signatures] No SMTP config found for OTP email');
    return false;
  }

  try {
    const transporter = createTransporter(smtpConfig);
    const fromName = smtpConfig.from_name || smtpConfig.username || 'Assinatura Digital';
    const fromEmail = smtpConfig.from_email || smtpConfig.username;

    if (!fromEmail) {
      console.error('[doc-signatures] SMTP config missing from_email/username');
      return false;
    }

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: signerEmail,
      subject: `Código de verificação - ${docTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; text-align: center;">Verificação de Identidade</h2>
          <p>Olá <strong>${signerName}</strong>,</p>
          <p>Você está acessando o documento <strong>"${docTitle}"</strong> para assinatura.</p>
          <p>Seu código de verificação é:</p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; background: #f4f4f5; padding: 16px 32px; border-radius: 8px; display: inline-block;">${code}</span>
          </div>
          <p style="color: #666; font-size: 13px;">Este código é válido por <strong>10 minutos</strong>. Não compartilhe com ninguém.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
          <p style="color: #999; font-size: 11px; text-align: center;">Se você não solicitou este código, ignore este e-mail.</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[doc-signatures] OTP email error:', err.message);
    return false;
  }
}

// Helper: extract frontend base URL from request
function getFrontendBaseUrl(req) {
  if (req?.headers?.origin) return req.headers.origin;
  if (req?.headers?.referer) {
    try { return new URL(req.headers.referer).origin; } catch { /* ignore */ }
  }
  const proto = req?.protocol || 'https';
  const host = req?.headers?.host || 'localhost';
  return `${proto}://${host}`;
}

// ===========================
// PDF GENERATION WITH SIGNATURES
// ===========================

async function generateSignedPdf(documentId, baseUrl) {
  // 1. Get document info
  const docResult = await query(`SELECT file_url FROM doc_signature_documents WHERE id = $1`, [documentId]);
  if (!docResult.rows[0]) throw new Error('Document not found');
  const { file_url } = docResult.rows[0];

  // 2. Get all signed signers with their positions
  const signersResult = await query(
    `SELECT s.id, s.name, s.email, s.cpf, s.role, s.signature_url, s.signed_at,
            s.ip_address, s.geolocation, s.user_agent,
            s.selfie_image_url, s.doc_front_image_url, s.doc_back_image_url
     FROM doc_signature_signers s
     WHERE s.document_id = $1 AND s.status = 'signed' AND s.signature_url IS NOT NULL`,
    [documentId]
  );

  if (signersResult.rows.length === 0) {
    console.log('[doc-signatures] No signed signers yet, skipping PDF generation');
    return null;
  }

  // 3. Get positions for all signers
  const positionsResult = await query(
    `SELECT p.signer_id, p.page, p.x, p.y, p.width, p.height
     FROM doc_signature_positions p
     WHERE p.document_id = $1`,
    [documentId]
  );

  // Build a map of signer_id -> positions[]
  const positionsBySigner = {};
  for (const pos of positionsResult.rows) {
    if (!positionsBySigner[pos.signer_id]) positionsBySigner[pos.signer_id] = [];
    positionsBySigner[pos.signer_id].push(pos);
  }

  // 4. Download the original PDF
  let pdfBytes;
  const localPdfPath = resolveLocalUploadsPath(file_url);
  if (localPdfPath) {
    pdfBytes = fs.readFileSync(localPdfPath);
  } else if (HTTP_URL_REGEX.test(file_url)) {
    pdfBytes = await readRemoteBinary(file_url);
  } else {
    const fallbackPath = path.isAbsolute(file_url) ? file_url : path.resolve(file_url);
    if (!fs.existsSync(fallbackPath)) {
      throw new Error(`PDF source not found: ${file_url}`);
    }
    pdfBytes = fs.readFileSync(fallbackPath);
  }

  // 5. Load the PDF
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const infoFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const toFiniteNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const compactText = (value, max = 72) => {
    if (!value) return 'N/A';
    const normalized = String(value).replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
  };

  const formatSignedAt = (signedAt) => {
    const tzOptions = { timeZone: 'America/Sao_Paulo' };
    if (!signedAt) return new Date().toLocaleString('pt-BR', tzOptions);
    const date = new Date(signedAt);
    if (Number.isNaN(date.getTime())) return new Date().toLocaleString('pt-BR', tzOptions);
    return date.toLocaleString('pt-BR', tzOptions);
  };

  // 6. For each signed signer, embed their signature at configured positions
  let drawnSignatures = 0;
  for (let signerIndex = 0; signerIndex < signersResult.rows.length; signerIndex += 1) {
    const signer = signersResult.rows[signerIndex];
    const configuredPositions = positionsBySigner[signer.id] || [];

    const sigUrl = String(signer.signature_url || '');
    if (!sigUrl) continue;

    let sigImage;
    try {
      if (sigUrl.startsWith('data:')) {
        const [metadata, base64Data] = sigUrl.split(',', 2);
        if (!base64Data) {
          throw new Error('Invalid signature data URL');
        }

        const signatureBytes = Buffer.from(base64Data, 'base64');
        const normalizedMetadata = metadata.toLowerCase();

        if (normalizedMetadata.includes('image/png')) {
          sigImage = await pdfDoc.embedPng(signatureBytes);
        } else if (normalizedMetadata.includes('image/jpeg') || normalizedMetadata.includes('image/jpg')) {
          sigImage = await pdfDoc.embedJpg(signatureBytes);
        } else {
          try {
            sigImage = await pdfDoc.embedPng(signatureBytes);
          } catch {
            sigImage = await pdfDoc.embedJpg(signatureBytes);
          }
        }
      } else {
        const localSignaturePath = resolveLocalUploadsPath(sigUrl);
        let signatureBytes = null;

        if (localSignaturePath) {
          signatureBytes = fs.readFileSync(localSignaturePath);
        } else if (HTTP_URL_REGEX.test(sigUrl)) {
          signatureBytes = await readRemoteBinary(sigUrl);
        }

        if (!signatureBytes) {
          console.log(`[doc-signatures] Unsupported signature source for signer ${signer.id}`);
          continue;
        }

        try {
          sigImage = await pdfDoc.embedPng(signatureBytes);
        } catch {
          sigImage = await pdfDoc.embedJpg(signatureBytes);
        }
      }
    } catch (imgErr) {
      console.error(`[doc-signatures] Error embedding signature image for signer ${signer.id}:`, imgErr.message);
      continue;
    }

    const fallbackTopY = 40 + (signerIndex * 140);
    const fallbackPositions = [{
      page: 1,
      x: 36,
      y: fallbackTopY,
      width: 220,
      height: 72,
    }];

    const positionsToUse = configuredPositions.length > 0 ? configuredPositions : fallbackPositions;

    for (const pos of positionsToUse) {
      const parsedPage = Number.parseInt(String(pos.page), 10);
      const pageIndex = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage - 1 : 0; // 1-based to 0-based
      if (pageIndex >= pages.length) continue;

      const page = pages[pageIndex];
      const { width: pageWidth, height: pageHeight } = page.getSize();

      // Positions are stored as pixel values relative to the rendered PDF page
      // We need to convert from the frontend coordinate system to PDF coordinates
      // Frontend renders at ~scale, positions are in CSS pixels
      // PDF coordinates: origin at bottom-left, y goes up
      const sigWidth = clamp(toFiniteNumber(pos.width, 220), 100, Math.max(100, pageWidth - 24));
      const sigHeight = clamp(toFiniteNumber(pos.height, 72), 40, Math.max(40, pageHeight - 24));
      const rawX = toFiniteNumber(pos.x, 36);
      const rawY = toFiniteNumber(pos.y, 40);
      const pdfX = clamp(rawX, 12, Math.max(12, pageWidth - sigWidth - 12));
      const pdfY = clamp(pageHeight - rawY - sigHeight, 12, Math.max(12, pageHeight - sigHeight - 12));

      page.drawImage(sigImage, {
        x: pdfX,
        y: pdfY,
        width: sigWidth,
        height: sigHeight,
      });

      const auditLines = [
        `Assinado por: ${compactText(signer.name, 60)}`,
        `CPF: ${compactText(signer.cpf, 20)}`,
        `Data/Hora: ${formatSignedAt(signer.signed_at)}`,
        `IP: ${compactText(signer.ip_address, 45)}`,
        `Geo: ${compactText(signer.geolocation, 65)}`,
      ];

      const lineHeight = 9;
      const textPadding = 4;
      const textBoxHeight = textPadding * 2 + (auditLines.length * lineHeight);
      const availableTextWidth = Math.max(120, pageWidth - pdfX - 12);
      const textBoxWidth = Math.min(Math.max(sigWidth, 220), availableTextWidth);

      let textBoxY = pdfY - textBoxHeight - 6;
      if (textBoxY < 12) {
        textBoxY = pdfY + sigHeight + 6;
      }
      textBoxY = clamp(textBoxY, 12, Math.max(12, pageHeight - textBoxHeight - 12));

      page.drawRectangle({
        x: pdfX,
        y: textBoxY,
        width: textBoxWidth,
        height: textBoxHeight,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.82, 0.82, 0.82),
        borderWidth: 0.7,
        opacity: 0.9,
      });

      auditLines.forEach((line, index) => {
        page.drawText(line, {
          x: pdfX + textPadding,
          y: textBoxY + textBoxHeight - textPadding - 7 - (index * lineHeight),
          size: 7,
          font: infoFont,
          color: rgb(0.1, 0.1, 0.1),
        });
      });

      drawnSignatures += 1;
    }
  }

  if (drawnSignatures === 0) {
    console.warn(`[doc-signatures] Signed signers found but no signature could be drawn for document ${documentId}`);
    return null;
  }

  // 6.5 Append an audit page per signer with identity photos and metadata
  async function embedIdentityImage(source) {
    if (!source) return null;
    try {
      let bytes = null;
      let looksPng = false;
      if (typeof source === 'string' && source.startsWith('data:')) {
        const m = source.match(/^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i);
        if (!m) return null;
        looksPng = m[1].toLowerCase().includes('png');
        bytes = Buffer.from(m[2], 'base64');
      } else if (typeof source === 'string') {
        const local = resolveLocalUploadsPath(source);
        if (local) {
          bytes = fs.readFileSync(local);
          looksPng = local.toLowerCase().endsWith('.png');
        } else if (HTTP_URL_REGEX.test(source)) {
          bytes = await readRemoteBinary(source);
          looksPng = source.toLowerCase().split('?')[0].endsWith('.png');
        }
      }
      if (!bytes) return null;
      if (looksPng) {
        try { return await pdfDoc.embedPng(bytes); } catch { return await pdfDoc.embedJpg(bytes); }
      }
      try { return await pdfDoc.embedJpg(bytes); } catch { return await pdfDoc.embedPng(bytes); }
    } catch (err) {
      console.error('[doc-signatures] embedIdentityImage failed:', err?.message);
      return null;
    }
  }

  const auditBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidthA4 = 595.28;
  const pageHeightA4 = 841.89;

  const wrapText = (text, maxChars) => {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const w of words) {
      const candidate = current ? `${current} ${w}` : w;
      if (candidate.length > maxChars) {
        if (current) lines.push(current);
        current = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : ['N/A'];
  };

  for (const signer of signersResult.rows) {
    const hasAnyPhoto = signer.selfie_image_url || signer.doc_front_image_url || signer.doc_back_image_url;
    // Always add an audit page per signer with the metadata; include photos when available
    const auditPage = pdfDoc.addPage([pageWidthA4, pageHeightA4]);
    const margin = 40;
    let cursorY = pageHeightA4 - margin;

    // Title
    auditPage.drawText('Registro de Auditoria de Identidade', {
      x: margin,
      y: cursorY - 14,
      size: 14,
      font: auditBoldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= 24;
    auditPage.drawRectangle({
      x: margin,
      y: cursorY,
      width: pageWidthA4 - margin * 2,
      height: 1.2,
      color: rgb(0.13, 0.55, 0.13),
    });
    cursorY -= 14;

    // Signer info block
    const infoPairs = [
      ['Nome', signer.name || 'N/A'],
      ['CPF', signer.cpf || 'N/A'],
      ['E-mail', signer.email || 'N/A'],
      ['Data/Hora da assinatura', formatSignedAt(signer.signed_at)],
      ['Endereço IP', signer.ip_address || 'N/A'],
      ['Geolocalização', signer.geolocation || 'N/A'],
      ['Navegador (User-Agent)', signer.user_agent || 'N/A'],
      ['ID do signatário', signer.id],
    ];

    const labelSize = 9;
    const valueSize = 10;
    const rowGap = 6;
    for (const [label, value] of infoPairs) {
      auditPage.drawText(`${label}:`, {
        x: margin,
        y: cursorY - labelSize,
        size: labelSize,
        font: auditBoldFont,
        color: rgb(0.35, 0.35, 0.35),
      });
      const valueLines = wrapText(String(value), 80);
      valueLines.forEach((line, idx) => {
        auditPage.drawText(line, {
          x: margin + 130,
          y: cursorY - valueSize - (idx * (valueSize + 2)),
          size: valueSize,
          font: infoFont,
          color: rgb(0.1, 0.1, 0.1),
        });
      });
      cursorY -= (valueSize + 2) * valueLines.length + rowGap;
    }

    cursorY -= 8;
    auditPage.drawText(hasAnyPhoto ? 'Fotos de validação de identidade' : 'Fotos de validação de identidade: não coletadas', {
      x: margin,
      y: cursorY - 11,
      size: 11,
      font: auditBoldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= 20;

    if (hasAnyPhoto) {
      const photos = [
        { label: 'Selfie', url: signer.selfie_image_url },
        { label: 'Documento (frente)', url: signer.doc_front_image_url },
        { label: 'Documento (verso)', url: signer.doc_back_image_url },
      ].filter((p) => !!p.url);

      const available = pageWidthA4 - margin * 2;
      const gap = 12;
      const boxW = (available - gap * (photos.length - 1)) / Math.max(1, photos.length);
      const boxH = Math.min(cursorY - margin - 80, 300);
      const boxTopY = cursorY;
      const boxBottomY = boxTopY - boxH;

      for (let i = 0; i < photos.length; i += 1) {
        const photo = photos[i];
        const bx = margin + i * (boxW + gap);
        auditPage.drawRectangle({
          x: bx,
          y: boxBottomY,
          width: boxW,
          height: boxH,
          borderColor: rgb(0.75, 0.78, 0.82),
          borderWidth: 0.7,
          color: rgb(0.98, 0.98, 0.98),
        });
        auditPage.drawText(photo.label, {
          x: bx + 6,
          y: boxTopY - 12,
          size: 9,
          font: auditBoldFont,
          color: rgb(0.25, 0.25, 0.25),
        });

        const img = await embedIdentityImage(photo.url);
        if (img) {
          const innerPad = 8;
          const captionH = 16;
          const innerW = boxW - innerPad * 2;
          const innerH = boxH - innerPad * 2 - captionH;
          const scale = Math.min(innerW / img.width, innerH / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const drawX = bx + innerPad + (innerW - drawW) / 2;
          const drawY = boxBottomY + innerPad + (innerH - drawH) / 2;
          auditPage.drawImage(img, { x: drawX, y: drawY, width: drawW, height: drawH });
        } else {
          auditPage.drawText('Imagem indisponível', {
            x: bx + boxW / 2 - 40,
            y: boxBottomY + boxH / 2 - 4,
            size: 9,
            font: infoFont,
            color: rgb(0.55, 0.55, 0.55),
          });
        }
      }

      cursorY = boxBottomY - 8;
    }

    auditPage.drawText(
      'Este registro compõe a trilha de auditoria do documento assinado eletronicamente.',
      {
        x: margin,
        y: margin + 60,
        size: 8,
        font: infoFont,
        color: rgb(0.4, 0.4, 0.4),
      }
    );
  }

  // 7. Add legal validity footer with QR code to every page
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const footerFontSize = 6.5;
  const footerLineHeight = 8.5;
  const footerPadding = 6;
  const qrSize = 48;

  const verifyUrl = baseUrl ? `${baseUrl}/verificar/${documentId}` : `https://app.example.com/verificar/${documentId}`;

  // Generate QR code as PNG buffer
  let qrImage = null;
  try {
    const qrBuffer = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 200, margin: 1 });
    qrImage = await pdfDoc.embedPng(qrBuffer);
  } catch (qrErr) {
    console.error('[doc-signatures] QR code generation error:', qrErr.message);
  }

  const footerLines = [
    'DOCUMENTO ASSINADO ELETRONICAMENTE',
    'Validade jurídica conforme MP 2.200-2/2001 (Art. 10, §2º) e Lei 14.063/2020.',
    `Verifique: ${verifyUrl}`,
  ];
  const footerBoxHeight = footerPadding * 2 + (footerLines.length * footerLineHeight) + 2;
  const effectiveFooterBoxHeight = Math.max(footerBoxHeight, qrImage ? qrSize + footerPadding * 2 : footerBoxHeight);

  for (let pi = 0; pi < pages.length; pi++) {
    const pg = pages[pi];
    const { width: pgW } = pg.getSize();
    const footerY = 6;
    const footerX = 24;
    const footerW = pgW - 48;
    const textOffsetX = qrImage ? qrSize + footerPadding * 2 : footerPadding;

    // Background
    pg.drawRectangle({
      x: footerX,
      y: footerY,
      width: footerW,
      height: effectiveFooterBoxHeight,
      color: rgb(0.96, 0.97, 0.98),
      borderColor: rgb(0.7, 0.75, 0.8),
      borderWidth: 0.5,
    });

    // Green accent line at top
    pg.drawRectangle({
      x: footerX,
      y: footerY + effectiveFooterBoxHeight - 1.5,
      width: footerW,
      height: 1.5,
      color: rgb(0.13, 0.55, 0.13),
    });

    // QR code on the left
    if (qrImage) {
      pg.drawImage(qrImage, {
        x: footerX + footerPadding,
        y: footerY + (effectiveFooterBoxHeight - qrSize) / 2,
        width: qrSize,
        height: qrSize,
      });
    }

    // Title line (bold)
    pg.drawText(footerLines[0], {
      x: footerX + textOffsetX,
      y: footerY + effectiveFooterBoxHeight - footerPadding - footerFontSize,
      size: footerFontSize,
      font: boldFont,
      color: rgb(0.13, 0.55, 0.13),
    });

    // Remaining lines
    for (let li = 1; li < footerLines.length; li++) {
      pg.drawText(footerLines[li], {
        x: footerX + textOffsetX,
        y: footerY + effectiveFooterBoxHeight - footerPadding - footerFontSize - (li * footerLineHeight),
        size: footerFontSize,
        font: infoFont,
        color: rgb(0.25, 0.25, 0.25),
      });
    }
  }

  // 8. Save the modified PDF
  const signedPdfBytes = await pdfDoc.save();

  // Compute SHA-256 hash of the signed PDF
  const signedHash = crypto.createHash('sha256').update(Buffer.from(signedPdfBytes)).digest('hex');

  // Save to uploads directory
  const uploadsDir = path.resolve('uploads', 'signed-docs');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const signedFileName = `signed_${documentId}_${Date.now()}.pdf`;
  const signedFilePath = path.join(uploadsDir, signedFileName);
  fs.writeFileSync(signedFilePath, signedPdfBytes);

  // Build the URL (relative to server)
  const signedFileUrl = `/uploads/signed-docs/${signedFileName}`;

  // 8. Update the document record with signed URL and hash
  await query(
    `UPDATE doc_signature_documents SET signed_file_url = $1, hash_sha256 = $2, updated_at = NOW() WHERE id = $3`,
    [signedFileUrl, signedHash, documentId]
  );

  console.log(`[doc-signatures] Generated signed PDF: ${signedFileUrl} for document ${documentId}`);
  return signedFileUrl;
}

// ===========================
// PUBLIC ROUTES (before auth)
// ===========================

// Public: Verify document authenticity
router.get('/verify/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const docResult = await query(
      `SELECT d.id, d.title, d.description, d.status, d.hash_sha256, d.created_at,
              o.name as org_name
       FROM doc_signature_documents d
       LEFT JOIN organizations o ON o.id = d.organization_id
       WHERE d.id = $1`,
      [documentId]
    );
    if (docResult.rows.length === 0) return res.status(404).json({ error: 'Documento não encontrado' });

    const doc = docResult.rows[0];

    const signersResult = await query(
      `SELECT name, cpf, role, status, signed_at, ip_address, geolocation
       FROM doc_signature_signers WHERE document_id = $1 ORDER BY sign_order`,
      [documentId]
    );

    const signers = signersResult.rows.map(s => ({
      name: s.name,
      cpf_masked: s.cpf ? s.cpf.replace(/(\d{3})\.\d{3}\.\d{3}-(\d{2})/, '$1.***.***-$2').replace(/(\d{3})\d{3}\d{3}(\d{2})/, '$1.***.***-$2') : '***',
      role: s.role,
      status: s.status,
      signed_at: s.signed_at,
      ip_address: s.ip_address,
      geolocation: s.geolocation,
    }));

    const auditResult = await query(
      `SELECT action, actor_name, actor_email, ip_address, geolocation, created_at
       FROM doc_signature_audit WHERE document_id = $1 ORDER BY created_at DESC`,
      [documentId]
    );

    res.json({
      document: {
        id: doc.id,
        title: doc.title,
        description: doc.description,
        status: doc.status,
        hash_sha256: doc.hash_sha256,
        created_at: doc.created_at,
        org_name: doc.org_name,
      },
      signers,
      audit: auditResult.rows,
    });
  } catch (error) {
    console.error('[doc-signatures] Verify error:', error);
    res.status(500).json({ error: 'Erro ao verificar documento' });
  }
});


// Step 1: Request OTP - sends verification code to signer's email
router.post('/sign/:token/request-otp', async (req, res) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT s.*, d.title, d.description, d.status as doc_status, d.organization_id,
              o.name as org_name, o.logo_url as org_logo_url
       FROM doc_signature_signers s
       JOIN doc_signature_documents d ON d.id = s.document_id
       LEFT JOIN organizations o ON o.id = d.organization_id
       WHERE s.sign_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Link inválido ou expirado' });

    const signer = result.rows[0];
    if (signer.doc_status !== 'pending') return res.status(400).json({ error: 'Documento não está disponível para assinatura' });
    if (signer.status === 'signed') return res.status(400).json({ error: 'Você já assinou este documento' });

    // Invalidate old OTPs
    await query(`UPDATE doc_signature_otp SET verified = true WHERE signer_id = $1 AND verified = false`, [signer.id]);

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await query(
      `INSERT INTO doc_signature_otp (signer_id, code, expires_at) VALUES ($1, $2, $3)`,
      [signer.id, code, expiresAt]
    );

    // Mask email for display
    const emailParts = signer.email.split('@');
    const maskedLocal = emailParts[0].slice(0, 2) + '***';
    const maskedEmail = `${maskedLocal}@${emailParts[1]}`;

    // Send email
    const sent = await sendOtpEmail(signer.email, signer.name, code, signer.title, signer.organization_id);
    if (!sent) return res.status(500).json({ error: 'Erro ao enviar código de verificação. Tente novamente.' });

    await auditLog(signer.document_id, 'otp_requested', {
      name: signer.name, email: signer.email,
      ip: getClientIp(req), userAgent: req.headers['user-agent'],
      details: { masked_email: maskedEmail }
    });

    res.json({
      success: true,
      masked_email: maskedEmail,
      signer_name: signer.name,
      document_title: signer.title,
      document_description: signer.description || null,
      org_name: signer.org_name || null,
      org_logo_url: signer.org_logo_url || null,
    });
  } catch (error) {
    console.error('[doc-signatures] Request OTP error:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Step 2: Verify OTP
router.post('/sign/:token/verify-otp', async (req, res) => {
  try {
    const { token } = req.params;
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código é obrigatório' });

    const signerResult = await query(
      `SELECT s.id, s.status, d.status as doc_status
       FROM doc_signature_signers s
       JOIN doc_signature_documents d ON d.id = s.document_id
       WHERE s.sign_token = $1`,
      [token]
    );
    if (signerResult.rows.length === 0) return res.status(404).json({ error: 'Link inválido' });

    const signer = signerResult.rows[0];

    // Find valid OTP
    const otpResult = await query(
      `SELECT * FROM doc_signature_otp
       WHERE signer_id = $1 AND verified = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [signer.id]
    );

    if (otpResult.rows.length === 0) return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });

    const otp = otpResult.rows[0];

    // Increment attempts
    await query(`UPDATE doc_signature_otp SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);

    if (otp.attempts >= 5) {
      await query(`UPDATE doc_signature_otp SET verified = true WHERE id = $1`, [otp.id]);
      return res.status(400).json({ error: 'Muitas tentativas. Solicite um novo código.' });
    }

    if (otp.code !== code.trim()) {
      return res.status(400).json({ error: `Código incorreto. ${4 - otp.attempts} tentativa(s) restante(s).` });
    }

    // Mark as verified
    await query(`UPDATE doc_signature_otp SET verified = true WHERE id = $1`, [otp.id]);

    // Audit: identity verified
    const signerDetail = await query(
      `SELECT s.name, s.email, s.document_id FROM doc_signature_signers s WHERE s.id = $1`, [signer.id]
    );
    if (signerDetail.rows[0]) {
      await auditLog(signerDetail.rows[0].document_id, 'otp_verified', {
        name: signerDetail.rows[0].name, email: signerDetail.rows[0].email,
        ip: getClientIp(req), userAgent: req.headers['user-agent'],
        details: { verified_at: new Date().toISOString() }
      });
    }

    res.json({ success: true, verified: true });
  } catch (error) {
    console.error('[doc-signatures] Verify OTP error:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Get signing data by token (now requires OTP verification)
router.get('/sign/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT s.*, d.title, d.description, d.file_url, d.status as doc_status, d.organization_id,
              d.require_cnh_validation, d.require_identity_validation,
              o.name as org_name, o.logo_url as org_logo_url
       FROM doc_signature_signers s
       JOIN doc_signature_documents d ON d.id = s.document_id
       LEFT JOIN organizations o ON o.id = d.organization_id
       WHERE s.sign_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Link inválido ou expirado' });
    
    const signer = result.rows[0];
    if (signer.doc_status !== 'pending') return res.status(400).json({ error: 'Documento não está mais disponível para assinatura' });
    if (signer.status === 'signed') return res.status(400).json({ error: 'Você já assinou este documento' });

    // Check if OTP was verified recently (last 30 minutes)
    const otpCheck = await query(
      `SELECT id FROM doc_signature_otp
       WHERE signer_id = $1 AND verified = true AND created_at > NOW() - INTERVAL '30 minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [signer.id]
    );
    if (otpCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Verificação de identidade necessária', require_otp: true });
    }

    // Get positions for this signer
    const posResult = await query(
      `SELECT * FROM doc_signature_positions WHERE signer_id = $1`,
      [signer.id]
    );

    const normalizedSignerFileUrl = normalizeDocumentFileUrl(signer.file_url);
    const signerFileUrl = toAbsoluteFileUrl(req, normalizedSignerFileUrl) || normalizedSignerFileUrl;

    res.json({
      document_id: signer.document_id,
      document_title: signer.title,
      document_description: signer.description || null,
      file_url: signerFileUrl,
      org_name: signer.org_name || null,
      org_logo_url: signer.org_logo_url || null,
      require_cnh_validation: signer.require_cnh_validation || false,
      cnh_validated: signer.cnh_validated || false,
      require_identity_validation: signer.require_identity_validation || false,
      identity_validated: signer.identity_validated || false,
      signer: {
        id: signer.id,
        name: signer.name,
        email: signer.email,
        cpf: signer.cpf,
        role: signer.role,
      },
      positions: posResult.rows,
    });

    // Audit: signing link opened
    await auditLog(signer.document_id, 'signing_link_opened', {
      name: signer.name, email: signer.email,
      ip: getClientIp(req), userAgent: req.headers['user-agent'],
      details: { access_type: 'public_signing' }
    });
  } catch (error) {
    console.error('[doc-signatures] Get sign data error:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
});
// Validate CNH image via AI (public)
router.post('/sign/:token/validate-cnh', async (req, res) => {
  try {
    const { token } = req.params;
    const { cnh_image } = req.body; // base64 image
    if (!cnh_image) return res.status(400).json({ error: 'Imagem da CNH é obrigatória' });

    const signerResult = await query(
      `SELECT s.*, d.require_cnh_validation, d.organization_id, d.id as doc_id
       FROM doc_signature_signers s
       JOIN doc_signature_documents d ON d.id = s.document_id
       WHERE s.sign_token = $1`,
      [token]
    );
    if (signerResult.rows.length === 0) return res.status(404).json({ error: 'Link inválido' });

    const signer = signerResult.rows[0];
    if (!signer.require_cnh_validation) return res.status(400).json({ error: 'Validação de CNH não é necessária para este documento' });

    // Get org AI config
    const aiConfigResult = await query(
      `SELECT ai_provider, ai_model, ai_api_key FROM organizations WHERE id = $1`,
      [signer.organization_id]
    );
    const aiConfig = aiConfigResult.rows[0];
    if (!aiConfig?.ai_api_key || aiConfig.ai_provider === 'none') {
      return res.status(400).json({ error: 'Configuração de IA não encontrada na organização. Configure um provedor de IA nas configurações.' });
    }

    const { callAI } = await import('../lib/ai-caller.js');

    const config = {
      provider: aiConfig.ai_provider,
      model: aiConfig.ai_model,
      apiKey: aiConfig.ai_api_key,
    };

    const signerCleanCpf = signer.cpf.replace(/\D/g, '');
    const signerName = signer.name.trim().toLowerCase();

    const messages = [
      {
        role: 'system',
        content: `Você é um validador de documentos. Analise a imagem da CNH (Carteira Nacional de Habilitação) brasileira e extraia EXATAMENTE o nome completo e o CPF visíveis no documento. Responda SOMENTE em JSON com o formato: {"nome_cnh": "NOME COMPLETO", "cpf_cnh": "00000000000", "documento_valido": true/false, "motivo": "explicação"}. Se não conseguir ler claramente, defina documento_valido como false.`
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analise esta imagem de CNH. Extraia o nome completo e CPF do documento. O nome esperado é "${signer.name}" e o CPF esperado é "${signerCleanCpf}". Verifique se os dados batem.`
          },
          {
            type: 'image_url',
            image_url: { url: cnh_image }
          }
        ]
      }
    ];

    const aiResult = await callAI(config, messages, {
      temperature: 0.1,
      maxTokens: 500,
      responseFormat: { type: 'json_object' },
    });

    let parsed;
    try {
      parsed = JSON.parse(aiResult.content);
    } catch {
      return res.status(400).json({ error: 'Não foi possível analisar a CNH. Tente novamente com uma foto mais nítida.', ai_raw: aiResult.content });
    }

    const cnhName = (parsed.nome_cnh || '').trim().toLowerCase();
    const cnhCpf = (parsed.cpf_cnh || '').replace(/\D/g, '');

    // Check name similarity (allow partial match)
    const nameWords = signerName.split(/\s+/);
    const cnhWords = cnhName.split(/\s+/);
    const matchingWords = nameWords.filter(w => cnhWords.some(cw => cw === w || cw.includes(w) || w.includes(cw)));
    const nameMatch = matchingWords.length >= Math.min(2, nameWords.length);

    const cpfMatch = cnhCpf === signerCleanCpf;
    const validated = parsed.documento_valido !== false && nameMatch && cpfMatch;

    if (validated) {
      // Mark signer as CNH validated
      await query(`UPDATE doc_signature_signers SET cnh_validated = true, cnh_image_url = $1 WHERE id = $2`, [cnh_image.substring(0, 100) + '...stored', signer.id]);

      await auditLog(signer.doc_id, 'cnh_validated', {
        name: signer.name, email: signer.email,
        ip: getClientIp(req), userAgent: req.headers['user-agent'],
        details: { nome_cnh: parsed.nome_cnh, cpf_match: cpfMatch, name_match: nameMatch }
      });
    }

    res.json({
      validated,
      nome_cnh: parsed.nome_cnh,
      cpf_match: cpfMatch,
      name_match: nameMatch,
      motivo: parsed.motivo || (validated ? 'Dados conferem' : 'Dados não conferem com o signatário cadastrado'),
    });
  } catch (error) {
    console.error('[doc-signatures] CNH validation error:', error);
    res.status(500).json({ error: 'Erro ao validar CNH' });
  }
});


// Validate identity (selfie + doc front + back) via AI (public)
router.post('/sign/:token/validate-identity', async (req, res) => {
  try {
    const { token } = req.params;
    const { selfie, doc_front, doc_back } = req.body;

    if (!selfie || !doc_front) {
      return res.status(400).json({ error: 'Selfie e foto do documento (frente) são obrigatórias' });
    }

    const signerResult = await query(
      `SELECT s.*, d.require_identity_validation, d.organization_id, d.id as doc_id
       FROM doc_signature_signers s
       JOIN doc_signature_documents d ON d.id = s.document_id
       WHERE s.sign_token = $1`,
      [token]
    );
    if (signerResult.rows.length === 0) return res.status(404).json({ error: 'Link inválido' });

    const signer = signerResult.rows[0];
    if (!signer.require_identity_validation) {
      return res.status(400).json({ error: 'Validação de identidade não é necessária para este documento' });
    }

    // Get org AI config
    const aiConfigResult = await query(
      `SELECT ai_provider, ai_model, ai_api_key FROM organizations WHERE id = $1`,
      [signer.organization_id]
    );
    const aiConfig = aiConfigResult.rows[0];
    if (!aiConfig?.ai_api_key || aiConfig.ai_provider === 'none') {
      return res.status(400).json({ error: 'Configuração de IA não encontrada na organização. Configure um provedor de IA nas configurações.' });
    }

    const { callAI } = await import('../lib/ai-caller.js');

    const config = {
      provider: aiConfig.ai_provider,
      model: aiConfig.ai_model,
      apiKey: aiConfig.ai_api_key,
    };

    const signerCleanCpf = signer.cpf.replace(/\D/g, '');
    const signerName = signer.name.trim().toLowerCase();

    const userContent = [
      {
        type: 'text',
        text: `Analise as imagens enviadas para registro de identidade do signatário.\n\nDADOS CADASTRADOS:\n- Nome: "${signer.name}"\n- CPF: "${signerCleanCpf}"\n\nIMAGENS (nesta ordem):\n1) Selfie do signatário (deve conter um ROSTO HUMANO visível)\n2) Frente do documento oficial brasileiro com foto (RG, CNH, CIN, CTPS, Passaporte, Carteira funcional, OAB, CRM, etc.)\n${doc_back ? '3) Verso do documento oficial' : ''}\n\nSEJA RIGOROSO na verificação de autenticidade:\n- "selfie_tem_rosto" deve ser true APENAS se a imagem 1 mostrar claramente um rosto humano real. Se for objeto, animal, tela, foto de foto, ambiente vazio ou imagem irreconhecível → false.\n- "eh_documento_oficial" deve ser true APENAS se a imagem 2 for INEQUIVOCAMENTE um documento de identidade oficial brasileiro (com foto, nome impresso, número de identificação, layout característico de RG/CNH/CIN/etc.). Se for objeto qualquer (mouse, teclado, celular, papel em branco, foto genérica, cartão de crédito, cartão fidelidade, cartão de visita, screenshot, print, meme) → false.\n- Extraia nome e CPF apenas se visíveis no documento.\n\nResponda SOMENTE em JSON: {"selfie_tem_rosto":true/false,"eh_documento_oficial":true/false,"nome_documento":"NOME OU vazio","cpf_documento":"00000000000 OU vazio","tipo_documento":"RG|CNH|CIN|CTPS|Passaporte|OUTRO|NAO_E_DOCUMENTO","rosto_confere":true/false,"nome_confere":true/false,"cpf_confere":true/false,"documento_legivel":true/false,"motivo":"explique brevemente, especialmente se recusar"}.`
      },
      { type: 'image_url', image_url: { url: selfie } },
      { type: 'image_url', image_url: { url: doc_front } },
    ];
    if (doc_back) userContent.push({ type: 'image_url', image_url: { url: doc_back } });

    const messages = [
      {
        role: 'system',
        content: 'Você é um validador de identidade. Analise as fotos (selfie + documento frente/verso), extraia os dados do documento e verifique se conferem com o cadastro. Responda somente em JSON.'
      },
      { role: 'user', content: userContent }
    ];

    const aiResult = await callAI(config, messages, {
      temperature: 0.1,
      maxTokens: 700,
      responseFormat: { type: 'json_object' },
    });

    let parsed;
    try {
      parsed = JSON.parse(aiResult.content);
    } catch {
      return res.status(400).json({ error: 'Não foi possível analisar as imagens. Tente novamente com fotos mais nítidas.', ai_raw: aiResult.content });
    }

    const isOfficialDoc = parsed.eh_documento_oficial === true;
    const selfieHasFace = parsed.selfie_tem_rosto !== false;

    if (!isOfficialDoc) {
      return res.status(400).json({
        error: 'A foto enviada não parece ser um documento de identidade oficial válido. Envie uma foto nítida de RG, CNH, CIN, Passaporte ou outro documento oficial com foto.',
        motivo: parsed.motivo || null,
        tipo_documento: parsed.tipo_documento || null,
      });
    }
    if (!selfieHasFace) {
      return res.status(400).json({
        error: 'Não foi possível detectar um rosto na selfie. Tire uma nova foto mostrando claramente o seu rosto.',
        motivo: parsed.motivo || null,
      });
    }

    const docName = (parsed.nome_documento || '').trim().toLowerCase();
    const docCpf = (parsed.cpf_documento || '').replace(/\D/g, '');

    // Name similarity check
    const nameWords = signerName.split(/\s+/).filter(Boolean);
    const docWords = docName.split(/\s+/).filter(Boolean);
    const matchingWords = nameWords.filter(w => docWords.some(dw => dw === w || dw.includes(w) || w.includes(dw)));
    const nameMatch = matchingWords.length >= Math.min(2, nameWords.length);
    const cpfMatch = docCpf === signerCleanCpf;
    const faceMatch = parsed.rosto_confere !== false;
    const legible = parsed.documento_legivel !== false;

    // Registro de identidade: fotos capturadas são suficientes para prosseguir.
    // Os matches abaixo são apenas informativos/auditoria — não bloqueiam a assinatura
    // (o signatário pode usar RG, CNH ou qualquer documento oficial com foto).
    const validated = true;

    const details = {
      nome_documento: parsed.nome_documento || null,
      cpf_documento: parsed.cpf_documento || null,
      tipo_documento: parsed.tipo_documento || null,
      name_match: nameMatch,
      cpf_match: cpfMatch,
      face_match: faceMatch,
      legible,
      motivo: parsed.motivo || null,
      validated_at: new Date().toISOString(),
    };

    {
      // Persist the actual images to disk for legal audit (kept alongside the signed PDF)
      const selfieUrl = saveIdentityImage(selfie, signer.id, 'selfie');
      const docFrontUrl = saveIdentityImage(doc_front, signer.id, 'doc-front');
      const docBackUrl = doc_back ? saveIdentityImage(doc_back, signer.id, 'doc-back') : null;

      details.selfie_url = selfieUrl;
      details.doc_front_url = docFrontUrl;
      details.doc_back_url = docBackUrl;

      await query(
        `UPDATE doc_signature_signers
         SET identity_validated = true,
             selfie_image_url = $1,
             doc_front_image_url = $2,
             doc_back_image_url = $3,
             identity_validation_details = $4
         WHERE id = $5`,
        [
          selfieUrl,
          docFrontUrl,
          docBackUrl,
          JSON.stringify(details),
          signer.id,
        ]
      );

      await auditLog(signer.doc_id, 'identity_recorded', {
        name: signer.name, email: signer.email,
        ip: getClientIp(req), userAgent: req.headers['user-agent'],
        details,
      });
    }

    res.json({
      validated,
      nome_documento: parsed.nome_documento,
      tipo_documento: parsed.tipo_documento,
      face_match: faceMatch,
      name_match: nameMatch,
      cpf_match: cpfMatch,
      legible,
      motivo: parsed.motivo || 'Identidade registrada com sucesso',
    });
  } catch (error) {
    console.error('[doc-signatures] Identity validation error:', error);
    res.status(500).json({ error: 'Erro ao validar identidade' });
  }
});


router.post('/sign/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { signature_image, cpf, full_name, geolocation, viewing_duration_seconds, terms_accepted_at } = req.body;
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'];

    if (!signature_image) return res.status(400).json({ error: 'Assinatura é obrigatória' });
    if (!cpf) return res.status(400).json({ error: 'CPF é obrigatório' });

    // Validate signer
    const signerResult = await query(
      `SELECT s.*, d.id as doc_id, d.status as doc_status, d.require_cnh_validation, d.require_identity_validation
       FROM doc_signature_signers s
       JOIN doc_signature_documents d ON d.id = s.document_id
       WHERE s.sign_token = $1`,
      [token]
    );
    if (signerResult.rows.length === 0) return res.status(404).json({ error: 'Link inválido' });

    const signer = signerResult.rows[0];
    if (signer.doc_status !== 'pending') return res.status(400).json({ error: 'Documento não disponível' });
    if (signer.status === 'signed') return res.status(400).json({ error: 'Já assinado' });

    // Check CNH validation if required
    if (signer.require_cnh_validation && !signer.cnh_validated) {
      return res.status(400).json({ error: 'Validação de CNH é obrigatória antes de assinar. Envie a foto da sua CNH.' });
    }

    // Check identity validation (selfie + document) if required
    if (signer.require_identity_validation && !signer.identity_validated) {
      return res.status(400).json({ error: 'Validação de identidade é obrigatória antes de assinar. Envie a selfie e as fotos do documento.' });
    }

    // Validate CPF matches
    const cleanCpf = cpf.replace(/\D/g, '');
    const signerCleanCpf = signer.cpf.replace(/\D/g, '');
    if (cleanCpf !== signerCleanCpf) return res.status(400).json({ error: 'CPF não confere com o cadastrado' });

    // Update signer
    await query(
      `UPDATE doc_signature_signers 
       SET status = 'signed', signature_url = $1, signed_at = NOW(), 
           ip_address = $2, user_agent = $3, geolocation = $4
       WHERE id = $5`,
      [signature_image, ip, userAgent, geolocation || null, signer.id]
    );

    // Audit log
    await auditLog(signer.doc_id, 'signature_submitted', {
      name: full_name || signer.name,
      email: signer.email,
      ip, userAgent, geolocation,
      details: { cpf: cleanCpf, signer_role: signer.role, viewing_duration_seconds: viewing_duration_seconds || null, terms_accepted_at: terms_accepted_at || null }
    });

    // Check if all signers have signed
    const pendingResult = await query(
      `SELECT COUNT(*) as pending FROM doc_signature_signers WHERE document_id = $1 AND status = 'pending'`,
      [signer.doc_id]
    );

    const allSigned = parseInt(pendingResult.rows[0].pending) === 0;

    // Get document details for notifications
    const docDetails = await query(
      `SELECT d.title, d.created_by, d.organization_id,
              (SELECT COUNT(*) FROM doc_signature_signers WHERE document_id = d.id) as total_signers,
              (SELECT COUNT(*) FROM doc_signature_signers WHERE document_id = d.id AND status = 'signed') as signed_count
       FROM doc_signature_documents d WHERE d.id = $1`,
      [signer.doc_id]
    );
    const doc = docDetails.rows[0];

    if (allSigned) {
      await query(`UPDATE doc_signature_documents SET status = 'completed', updated_at = NOW() WHERE id = $1`, [signer.doc_id]);
      await auditLog(signer.doc_id, 'document_completed', {
        name: 'Sistema', email: 'system', ip, userAgent,
        details: { completed_at: new Date().toISOString() }
      });

      // Notify creator: all signed
      if (doc?.created_by && doc?.organization_id) {
        try {
          await query(
            `INSERT INTO user_alerts (user_id, type, title, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
            [doc.created_by, 'doc_signature_completed', 
             `✅ Documento "${doc.title}" totalmente assinado`,
             `Todos os ${doc.total_signers} signatários assinaram o documento "${doc.title}".`,
             JSON.stringify({ document_id: signer.doc_id, document_title: doc.title })]
          );

          await createTaskCardInGlobalBoard({
            organizationId: doc.organization_id,
            createdBy: doc.created_by,
            assignedTo: doc.created_by,
            title: `✅ Doc assinado: ${doc.title}`,
            description: `O documento "${doc.title}" foi completamente assinado por todos os ${doc.total_signers} signatários. Acesse a página de Assinaturas para baixar o PDF final.`,
            priority: 'medium',
            sourceModule: 'doc_signature',
          });
          logInfo('[doc-signatures]', `Created completion task for doc "${doc.title}"`);
        } catch (notifErr) {
          logError('[doc-signatures] Notification error (completed)', notifErr);
        }
      }
    } else {
      // Partial signature: notify creator
      if (doc?.created_by && doc?.organization_id) {
        try {
          await query(
            `INSERT INTO user_alerts (user_id, type, title, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
            [doc.created_by, 'doc_signature_partial',
             `📝 "${doc.title}" - ${doc.signed_count}/${doc.total_signers} assinado(s)`,
             `${full_name || signer.name} assinou o documento "${doc.title}". Faltam ${parseInt(doc.total_signers) - parseInt(doc.signed_count)} signatário(s).`,
             JSON.stringify({ document_id: signer.doc_id, document_title: doc.title, signed_count: doc.signed_count, total_signers: doc.total_signers })]
          );

          await createTaskCardInGlobalBoard({
            organizationId: doc.organization_id,
            createdBy: doc.created_by,
            assignedTo: doc.created_by,
            title: `📝 Assinatura parcial: ${doc.title} (${doc.signed_count}/${doc.total_signers})`,
            description: `${full_name || signer.name} assinou o documento "${doc.title}". Aguardando ${parseInt(doc.total_signers) - parseInt(doc.signed_count)} signatário(s) restante(s).`,
            priority: 'low',
            sourceModule: 'doc_signature',
          });
          logInfo('[doc-signatures]', `Created partial signature task for doc "${doc.title}"`);
        } catch (notifErr) {
          logError('[doc-signatures] Notification error (partial)', notifErr);
        }
      }
    }

    // Generate signed PDF with all current signatures embedded
    let signedPdfUrl = null;
    try {
      signedPdfUrl = await generateSignedPdf(signer.doc_id, getFrontendBaseUrl(req));
    } catch (pdfErr) {
      console.error('[doc-signatures] PDF generation error:', pdfErr.message);
    }

    const signedPdfAbsoluteUrl = toAbsoluteFileUrl(req, signedPdfUrl);

    res.json({
      success: true,
      signed_pdf_url: signedPdfAbsoluteUrl,
      download_url: signedPdfAbsoluteUrl,
    });
  } catch (error) {
    console.error('[doc-signatures] Submit signature error:', error);
    res.status(500).json({ error: 'Erro ao processar assinatura' });
  }
});

router.get('/sign/:token/download', async (req, res) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT s.id as signer_id, s.status as signer_status,
              d.id as doc_id, d.signed_file_url,
              s.name, s.email
       FROM doc_signature_signers s
       JOIN doc_signature_documents d ON d.id = s.document_id
       WHERE s.sign_token = $1`,
      [token]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Link inválido' });

    const signer = result.rows[0];

    await auditLog(signer.doc_id, 'pdf_downloaded', {
      name: signer.name, email: signer.email,
      ip: getClientIp(req), userAgent: req.headers['user-agent'],
      details: { download_type: 'public_signer', has_signed_url: !!signer.signed_file_url }
    });

    if (signer.signer_status !== 'signed') {
      return res.status(403).json({ error: 'Documento ainda não foi assinado por este signatário' });
    }

    let downloadUrl = signer.signed_file_url;
    if (!downloadUrl) {
      try {
        downloadUrl = await generateSignedPdf(signer.doc_id, getFrontendBaseUrl(req));
      } catch (generationError) {
        console.error('[doc-signatures] Public download generation error:', generationError.message);
      }
    }

    const dlUser = await query(`SELECT name, email FROM users WHERE id = $1`, [req.userId]);
    await auditLog(req.params.id, 'pdf_downloaded', {
      name: dlUser.rows[0]?.name, email: dlUser.rows[0]?.email,
      ip: getClientIp(req), userAgent: req.headers['user-agent'],
      details: { download_type: 'authenticated', has_signed_url: !!downloadUrl }
    });

    const absoluteDownloadUrl = toAbsoluteFileUrl(req, downloadUrl);
    if (!absoluteDownloadUrl) {
      return res.status(404).json({ error: 'PDF assinado ainda não está disponível' });
    }

    res.json({ url: absoluteDownloadUrl });
  } catch (error) {
    console.error('[doc-signatures] Public download error:', error);
    res.status(500).json({ error: 'Erro ao obter documento assinado' });
  }
});

// ===========================
// AUTHENTICATED ROUTES
// ===========================
router.use(authenticate);

// List documents
router.get('/', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    if (!orgId) return res.status(403).json({ error: 'Sem organização' });

    const result = await query(
      `SELECT d.*, u.name as creator_name,
              (SELECT COUNT(*) FROM doc_signature_signers WHERE document_id = d.id) as signers_count,
              (SELECT COUNT(*) FROM doc_signature_signers WHERE document_id = d.id AND status = 'signed') as signed_count
       FROM doc_signature_documents d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.organization_id = $1
       ORDER BY d.created_at DESC`,
      [orgId]
    );
    const documents = result.rows.map((doc) => {
      const normalizedFileUrl = normalizeDocumentFileUrl(doc.file_url);
      return {
        ...doc,
        file_url: toAbsoluteFileUrl(req, normalizedFileUrl) || normalizedFileUrl,
        signed_file_url: toAbsoluteFileUrl(req, doc.signed_file_url) || doc.signed_file_url,
      };
    });

    res.json(documents);
  } catch (error) {
    console.error('[doc-signatures] List error:', error);
    res.status(500).json({ error: 'Erro ao listar documentos' });
  }
});

// Get document detail
router.get('/:id', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const docResult = await query(
      `SELECT d.*, u.name as creator_name FROM doc_signature_documents d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = $1 AND d.organization_id = $2`,
      [req.params.id, orgId]
    );
    if (docResult.rows.length === 0) return res.status(404).json({ error: 'Documento não encontrado' });

    const signersResult = await query(`SELECT * FROM doc_signature_signers WHERE document_id = $1 ORDER BY sign_order`, [req.params.id]);
    const positionsResult = await query(`SELECT * FROM doc_signature_positions WHERE document_id = $1`, [req.params.id]);
    const auditResult = await query(`SELECT * FROM doc_signature_audit WHERE document_id = $1 ORDER BY created_at DESC`, [req.params.id]);

    const document = docResult.rows[0];

    const normalizedFileUrl = normalizeDocumentFileUrl(document.file_url);

    res.json({
      document: {
        ...document,
        file_url: toAbsoluteFileUrl(req, normalizedFileUrl) || normalizedFileUrl,
      },
      signers: signersResult.rows,
      positions: positionsResult.rows,
      audit: auditResult.rows,
    });
  } catch (error) {
    console.error('[doc-signatures] Get detail error:', error);
    res.status(500).json({ error: 'Erro ao buscar documento' });
  }
});

// Create document
router.post('/', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    if (!orgId) return res.status(403).json({ error: 'Sem organização' });

    // Check plan limit
    const planCheck = await query(
      `SELECT p.doc_signatures_limit 
       FROM organizations o JOIN plans p ON p.id = o.plan_id 
       WHERE o.id = $1`, [orgId]
    );
    const limit = planCheck.rows[0]?.doc_signatures_limit || 0;
    if (limit > 0) {
      const countResult = await query(
        `SELECT COUNT(*) as cnt FROM doc_signature_documents 
         WHERE organization_id = $1 AND created_at >= date_trunc('month', NOW())`,
        [orgId]
      );
      const currentCount = parseInt(countResult.rows[0]?.cnt || '0');
      if (currentCount >= limit) {
        return res.status(403).json({ 
          error: `Limite de ${limit} documentos por mês atingido. Atualize seu plano para continuar.`,
          limit_reached: true 
        });
      }
    }

    const { title, description, file_url, deal_id, require_cnh_validation, require_identity_validation } = req.body;
    if (!title || !file_url) return res.status(400).json({ error: 'Título e arquivo são obrigatórios' });

    const normalizedFileUrl = normalizeDocumentFileUrl(file_url);

    // Compute SHA-256 hash of the original PDF
    let hashSha256 = null;
    try {
      const localPath = resolveLocalUploadsPath(normalizedFileUrl);
      let pdfBuffer;
      if (localPath) {
        pdfBuffer = fs.readFileSync(localPath);
      } else if (HTTP_URL_REGEX.test(normalizedFileUrl)) {
        pdfBuffer = await readRemoteBinary(normalizedFileUrl);
      }
      if (pdfBuffer) {
        hashSha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
      }
    } catch (hashErr) {
      console.error('[doc-signatures] Hash computation error:', hashErr.message);
    }

    const userResult = await query(`SELECT name, email FROM users WHERE id = $1`, [req.userId]);
    const user = userResult.rows[0];

    const result = await query(
      `INSERT INTO doc_signature_documents (organization_id, title, description, file_url, created_by, deal_id, require_cnh_validation, require_identity_validation, hash_sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [orgId, title, description || null, normalizedFileUrl, req.userId, deal_id || null, require_cnh_validation || false, require_identity_validation || false, hashSha256]
    );

    const doc = result.rows[0];

    await auditLog(doc.id, 'document_created', {
      name: user?.name, email: user?.email,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { title, file_url: normalizedFileUrl, deal_id: deal_id || null }
    });

    const createdNormalizedFileUrl = normalizeDocumentFileUrl(doc.file_url);

    res.status(201).json({
      ...doc,
      file_url: toAbsoluteFileUrl(req, createdNormalizedFileUrl) || createdNormalizedFileUrl,
    });
  } catch (error) {
    console.error('[doc-signatures] Create error:', error);
    res.status(500).json({ error: 'Erro ao criar documento' });
  }
});

// Add signer
router.post('/:id/signers', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const docCheck = await query(`SELECT id, status FROM doc_signature_documents WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]);
    if (docCheck.rows.length === 0) return res.status(404).json({ error: 'Documento não encontrado' });
    if (docCheck.rows[0].status !== 'draft') return res.status(400).json({ error: 'Documento já enviado para assinatura' });

    const { name, email, cpf, role, sign_order, phone } = req.body;
    if (!name || !email || !cpf) return res.status(400).json({ error: 'Nome, email e CPF são obrigatórios' });

    const signToken = crypto.randomBytes(48).toString('hex');

    const result = await query(
      `INSERT INTO doc_signature_signers (document_id, name, email, cpf, role, sign_order, sign_token, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.id, name, email, cpf, role || 'signer', sign_order || 1, signToken, phone || null]
    );

    const userResult = await query(`SELECT name, email FROM users WHERE id = $1`, [req.userId]);
    await auditLog(req.params.id, 'signer_added', {
      name: userResult.rows[0]?.name, email: userResult.rows[0]?.email,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { signer_name: name, signer_email: email, signer_cpf: cpf, phone: phone || null }
    });

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('[doc-signatures] Add signer error:', error);
    res.status(500).json({ error: 'Erro ao adicionar signatário' });
  }
});

// Remove signer
router.delete('/:id/signers/:signerId', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const docCheck = await query(`SELECT id, status FROM doc_signature_documents WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]);
    if (docCheck.rows.length === 0) return res.status(404).json({ error: 'Documento não encontrado' });
    if (docCheck.rows[0].status !== 'draft') return res.status(400).json({ error: 'Não é possível alterar documento em andamento' });

    await query(`DELETE FROM doc_signature_signers WHERE id = $1 AND document_id = $2`, [req.params.signerId, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('[doc-signatures] Remove signer error:', error);
    res.status(500).json({ error: 'Erro ao remover signatário' });
  }
});

// Save signature positions
router.put('/:id/positions', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const docCheck = await query(`SELECT id FROM doc_signature_documents WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]);
    if (docCheck.rows.length === 0) return res.status(404).json({ error: 'Documento não encontrado' });

    const { positions } = req.body;

    // Delete existing
    await query(`DELETE FROM doc_signature_positions WHERE document_id = $1`, [req.params.id]);

    // Insert new
    for (const pos of positions) {
      await query(
        `INSERT INTO doc_signature_positions (document_id, signer_id, page, x, y, width, height)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.params.id, pos.signer_id, pos.page, pos.x, pos.y, pos.width || 200, pos.height || 80]
      );
    }

    const posUser = await query(`SELECT name, email FROM users WHERE id = $1`, [req.userId]);
    await auditLog(req.params.id, 'positions_saved', {
      name: posUser.rows[0]?.name, email: posUser.rows[0]?.email,
      ip: getClientIp(req), userAgent: req.headers['user-agent'],
      details: { positions_count: positions.length }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[doc-signatures] Save positions error:', error);
    res.status(500).json({ error: 'Erro ao salvar posições' });
  }
});

// Send for signature
router.post('/:id/send', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const docCheck = await query(
      `SELECT d.*, (SELECT COUNT(*) FROM doc_signature_signers WHERE document_id = d.id) as signers_count
       FROM doc_signature_documents d WHERE d.id = $1 AND d.organization_id = $2`,
      [req.params.id, orgId]
    );
    if (docCheck.rows.length === 0) return res.status(404).json({ error: 'Documento não encontrado' });
    
    const doc = docCheck.rows[0];
    if (doc.status !== 'draft') return res.status(400).json({ error: 'Documento já foi enviado' });
    if (parseInt(doc.signers_count) === 0) return res.status(400).json({ error: 'Adicione pelo menos um signatário' });

    await query(`UPDATE doc_signature_documents SET status = 'pending', updated_at = NOW() WHERE id = $1`, [req.params.id]);

    const userResult = await query(`SELECT name, email FROM users WHERE id = $1`, [req.userId]);
    await auditLog(req.params.id, 'document_sent', {
      name: userResult.rows[0]?.name, email: userResult.rows[0]?.email,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { signers_count: doc.signers_count }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[doc-signatures] Send error:', error);
    res.status(500).json({ error: 'Erro ao enviar documento' });
  }
});

// Cancel document
router.post('/:id/cancel', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    await query(`UPDATE doc_signature_documents SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]);

    const userResult = await query(`SELECT name, email FROM users WHERE id = $1`, [req.userId]);
    await auditLog(req.params.id, 'document_cancelled', {
      name: userResult.rows[0]?.name, email: userResult.rows[0]?.email,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[doc-signatures] Cancel error:', error);
    res.status(500).json({ error: 'Erro ao cancelar documento' });
  }
});

// Download / get signed PDF url
router.get('/:id/download', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const result = await query(
      `SELECT file_url, signed_file_url, status FROM doc_signature_documents WHERE id = $1 AND organization_id = $2`,
      [req.params.id, orgId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Documento não encontrado' });
    
    const doc = result.rows[0];
    let downloadUrl = doc.signed_file_url;

    if (!downloadUrl) {
      try {
        downloadUrl = await generateSignedPdf(req.params.id, getFrontendBaseUrl(req));
      } catch (generationError) {
        console.error('[doc-signatures] On-demand PDF generation error:', generationError.message);
      }
    }

    const absoluteDownloadUrl = toAbsoluteFileUrl(req, downloadUrl);
    if (!absoluteDownloadUrl) {
      return res.status(404).json({ error: 'PDF assinado ainda não está disponível' });
    }

    res.json({ url: absoluteDownloadUrl });
  } catch (error) {
    console.error('[doc-signatures] Download error:', error);
    res.status(500).json({ error: 'Erro ao baixar documento' });
  }
});

// List documents by deal_id (for CRM integration)
router.get('/by-deal/:dealId', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    if (!orgId) return res.status(403).json({ error: 'Sem organização' });

    const result = await query(
      `SELECT d.*, u.name as creator_name,
              (SELECT COUNT(*) FROM doc_signature_signers WHERE document_id = d.id) as signers_count,
              (SELECT COUNT(*) FROM doc_signature_signers WHERE document_id = d.id AND status = 'signed') as signed_count
       FROM doc_signature_documents d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.organization_id = $1 AND d.deal_id = $2
       ORDER BY d.created_at DESC`,
      [orgId, req.params.dealId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[doc-signatures] List by deal error:', error);
    res.status(500).json({ error: 'Erro ao listar documentos' });
  }
});

// Send signing link via WhatsApp
router.post('/:id/send-whatsapp', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    if (!orgId) return res.status(403).json({ error: 'Sem organização' });

    const docResult = await query(
      `SELECT d.title FROM doc_signature_documents d WHERE d.id = $1 AND d.organization_id = $2`,
      [req.params.id, orgId]
    );
    if (docResult.rows.length === 0) return res.status(404).json({ error: 'Documento não encontrado' });
    const docTitle = docResult.rows[0].title;

    // Get signers with phone numbers
    const signersResult = await query(
      `SELECT id, name, phone, sign_token, status FROM doc_signature_signers WHERE document_id = $1 AND phone IS NOT NULL AND status = 'pending'`,
      [req.params.id]
    );

    if (signersResult.rows.length === 0) {
      return res.status(400).json({ error: 'Nenhum signatário com telefone e pendente encontrado' });
    }

    // Get first active WhatsApp connection (select all columns so provider-specific
    // fields like uazapi_url/uazapi_token/instance_id/token are available to sendMessage)
    const connResult = await query(
      `SELECT c.* 
       FROM connections c 
       WHERE c.organization_id = $1 AND c.status IN ('connected', 'open', 'online')
       ORDER BY c.created_at ASC LIMIT 1`,
      [orgId]
    );

    if (connResult.rows.length === 0) {
      return res.status(400).json({ error: 'Nenhuma conexão WhatsApp ativa' });
    }

    const connection = connResult.rows[0];
    const { sendMessage } = await import('../lib/whatsapp-provider.js');

    const frontendUrl = getFrontendBaseUrl({ headers: req.headers, protocol: req.protocol });
    let sent = 0;
    const seenPhones = new Set();

    // Detect duplicate phones so we can warn the caller — two signers with the
    // same phone will each receive their own link, but visually the last message
    // "wins" in WhatsApp and gives the impression of mixed data.
    const duplicatePhones = [];

    for (const signer of signersResult.rows) {
      // Bind per-signer values into locals so the closure can't accidentally
      // reuse another iteration's data.
      const currentSigner = {
        id: signer.id,
        name: signer.name,
        phone: String(signer.phone || '').trim(),
        token: signer.sign_token,
      };

      if (!currentSigner.phone || !currentSigner.token) {
        console.warn(`[doc-signatures] Skipping signer ${currentSigner.id}: missing phone or token`);
        continue;
      }

      const normalizedPhone = currentSigner.phone.replace(/\D/g, '');
      if (seenPhones.has(normalizedPhone)) {
        duplicatePhones.push(normalizedPhone);
      }
      seenPhones.add(normalizedPhone);

      const signingLink = `${frontendUrl}/assinar/${currentSigner.token}`;
      const message = `📝 *Solicitação de Assinatura*\n\nOlá ${currentSigner.name},\n\nVocê tem um documento aguardando sua assinatura:\n\n📄 *${docTitle}*\n\n🔗 Acesse o link abaixo para assinar:\n${signingLink}\n\n_Assinatura eletrônica com validade jurídica conforme MP 2.200-2/2001._`;

      console.log(`[doc-signatures] Sending signature link → signer=${currentSigner.name} (${currentSigner.id}) phone=${normalizedPhone} token=${currentSigner.token.substring(0, 8)}…`);

      try {
        const sendResult = await sendMessage(connection, currentSigner.phone, message, 'text');
        if (sendResult && sendResult.success === false) {
          console.error(`[doc-signatures] WhatsApp send failed for ${currentSigner.name}:`, sendResult.error);
          continue;
        }
        sent++;

        // Save message in conversation if exists
        const jid = normalizedPhone.includes('@') ? normalizedPhone : `${normalizedPhone}@s.whatsapp.net`;
        const convResult = await query(
          `SELECT id FROM conversations WHERE connection_id = $1 AND contact_jid = $2 LIMIT 1`,
          [connection.id, jid]
        );
        if (convResult.rows.length > 0) {
          await query(
            `INSERT INTO chat_messages (conversation_id, content, message_type, from_me, status) VALUES ($1, $2, 'text', true, 'sent')`,
            [convResult.rows[0].id, message]
          );
          await query(`UPDATE conversations SET last_message_at = NOW() WHERE id = $1`, [convResult.rows[0].id]);
        }

        // Small delay between sends to the same provider so W-API/UAZAPI don't
        // rate-limit and drop messages when multiple signers share a provider.
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (sendErr) {
        console.error(`[doc-signatures] WhatsApp send error for ${currentSigner.name}:`, sendErr.message);
      }
    }

    const userResult = await query(`SELECT name, email FROM users WHERE id = $1`, [req.userId]);
    await auditLog(req.params.id, 'whatsapp_links_sent', {
      name: userResult.rows[0]?.name, email: userResult.rows[0]?.email,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      details: { sent_count: sent, total_signers: signersResult.rows.length }
    });

    res.json({
      success: true,
      sent,
      total: signersResult.rows.length,
      duplicate_phones: duplicatePhones.length > 0 ? [...new Set(duplicatePhones)] : undefined,
    });
  } catch (error) {
    console.error('[doc-signatures] Send WhatsApp error:', error);
    res.status(500).json({ error: 'Erro ao enviar links via WhatsApp' });
  }
});

export default router;

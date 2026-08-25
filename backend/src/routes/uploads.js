import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Readable } from 'stream';
import { exec } from 'child_process';
import { promisify } from 'util';
import { authenticate } from '../middleware/auth.js';
import { query } from '../db.js';

const execPromise = promisify(exec);
const router = express.Router();
const PROXIED_MEDIA_HOSTS = new Set(['lookaside.fbsbx.com']);
const META_MEDIA_HOSTS = new Set(['lookaside.fbsbx.com']);
// Hosts permitidos por sufixo de domínio (ex.: instâncias UAZAPI/W-API/Evolution)
const PROXIED_MEDIA_HOST_SUFFIXES = [
  '.uazapi.com',
  '.wapi.app',
  '.w-api.app',
];

function isProxyAllowedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (PROXIED_MEDIA_HOSTS.has(h)) return true;
  return PROXIED_MEDIA_HOST_SUFFIXES.some((suf) => h.endsWith(suf));
}
const META_GRAPH_API_VERSION = 'v21.0';

async function getMetaCandidateTokens(req) {
  const candidates = [];
  const seenTokens = new Set();

  const addRow = (row) => {
    const token = row?.meta_token;
    if (!token) return;
    const key = `${token}::${row?.meta_phone_number_id || ''}`;
    if (seenTokens.has(key)) return;
    seenTokens.add(key);
    candidates.push({ token, phoneNumberId: row?.meta_phone_number_id || null });
  };

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const jwt = await import('jsonwebtoken');
      const jwtLib = jwt.default || jwt;
      const decoded = jwtLib.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET);
      if (decoded?.userId) {
        const result = await query(
          `SELECT DISTINCT c.meta_token, c.meta_phone_number_id FROM connections c
           JOIN organization_members om ON om.organization_id = c.organization_id
           WHERE om.user_id = $1 AND c.provider = 'meta' AND c.meta_token IS NOT NULL`,
          [decoded.userId]
        );
        result.rows.forEach(addRow);
      }
    } catch {
      // ignore invalid JWT and continue with global fallback tokens
    }
  }

  const fallbackTokens = await query(
    `SELECT DISTINCT meta_token, meta_phone_number_id FROM connections WHERE provider = 'meta' AND meta_token IS NOT NULL`
  );
  fallbackTokens.rows.forEach(addRow);

  return candidates;
}


// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original extension.
    // If original filename has no extension (common on mobile), infer from mimetype
    // so providers like W-API can fetch a URL that ends with a visible extension.
    const originalExt = path.extname(file.originalname || '');
    // Alguns dispositivos salvam JPEG como .jfif; normalizamos para .jpg porque vários provedores
    // validam a extensão da URL/arquivo e rejeitam .jfif.
    const normalizedOriginalExt = originalExt.toLowerCase() === '.jfif' ? '.jpg' : originalExt;
    const mime = String(file.mimetype || '').toLowerCase();

    const mimeToExt = {
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-powerpoint': '.ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'text/plain': '.txt',
      'text/csv': '.csv',
      'application/csv': '.csv',
      'application/zip': '.zip',
      'application/x-zip-compressed': '.zip',
      'application/x-rar-compressed': '.rar',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'image/tiff': '.tiff',
      'image/svg+xml': '.svg',
      'image/avif': '.avif',
      // JFIF é um contêiner de JPEG; salvamos como .jpg para compatibilidade.
      'image/jfif': '.jpg',
      'audio/mpeg': '.mp3',
      'audio/mp3': '.mp3',
      'audio/ogg': '.ogg',
      'audio/wav': '.wav',
      'audio/x-wav': '.wav',
      'audio/webm': '.webm',
      'audio/aac': '.aac',
      'audio/m4a': '.m4a',
      'audio/x-m4a': '.m4a',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/ogg': '.ogv',
      'video/quicktime': '.mov',
    };

    const ext = normalizedOriginalExt || mimeToExt[mime] || '.bin';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, uniqueName);
  }
});

// File filter for allowed types
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/svg+xml',
    'image/avif',
    'image/jfif',
    // Audio
    'audio/mpeg',
    'audio/mp3',
    'audio/ogg',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/aac',
    'audio/m4a',
    'audio/x-m4a',
    // Video
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/csv',
    'application/zip',
    'application/x-rar-compressed',
    'application/x-zip-compressed',
  ];

  // Fallback extension allowlist (some browsers/mobile send generic mimetypes)
  const allowedExts = [
    // images
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.jfif', '.bmp', '.tiff', '.svg', '.avif',
    // audio
    '.mp3', '.ogg', '.wav', '.webm', '.aac', '.m4a',
    // video
    '.mp4', '.webm', '.ogg', '.mov', '.qt',
    // documents
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.csv',
    // archives
    '.zip', '.rar', '.7z',
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext && allowedExts.includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB max
  }
});

// Upload single file
router.options('/', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

router.post('/', authenticate, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        const msg = err?.message || 'Erro ao fazer upload';
        return res.status(400).json({ error: msg });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
      }

      let filename = req.file.filename;
      let mimetype = req.file.mimetype;
      let size = req.file.size;

      // WhatsApp Compatibility: Convert WebM/Opus to OGG/Opus using FFmpeg
      if (mimetype === 'audio/webm' || filename.endsWith('.webm')) {
        const inputPath = path.join(uploadsDir, filename);
        const outputFilename = filename.replace(/\.webm$/, '') + '.ogg';
        const outputPath = path.join(uploadsDir, outputFilename);

        try {
          console.log(`[Audio] Converting ${filename} to OGG/Opus for WhatsApp compatibility...`);
          
          // -c:a libopus: Use Opus codec
          // -b:a 64k: Good bitrate for voice
          // -ar 48000: 48 kHz (Apple requirement)
          // -ac 1: Mono (Apple requirement)
          // -application voip: Optimized for voice
          await execPromise(`ffmpeg -i "${inputPath}" -c:a libopus -b:a 64k -ar 48000 -ac 1 -application voip "${outputPath}"`);

          
          if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            filename = outputFilename;
            mimetype = 'audio/ogg';
            size = stats.size;
            
            // Clean up original webm file
            fs.unlinkSync(inputPath);
            console.log(`[Audio] Conversion successful: ${filename} (${size} bytes)`);
          }
        } catch (convErr) {
          console.error('[Audio] Conversion failed, using original file:', convErr.message);
          // If conversion fails, we keep the original webm file
        }
      }

      // Build the public URL - use backend domain, not frontend
      const baseUrl = String(process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
      
      const fileUrl = baseUrl
        ? `${baseUrl}/uploads/${filename}`
        : `/uploads/${filename}`;

      res.json({
        success: true,
        file: {
          filename: filename,
          originalName: req.file.originalname,
          mimetype: mimetype,
          size: size,
          url: fileUrl,
        }
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Erro ao fazer upload' });
    }
  });
});

// Public download with forced filename (keeps extension visible in the URL)
// Useful for providers that require a file extension to be present.
// Example: GET /api/uploads/public/<stored>/<downloadName.pdf>
router.options('/public/:stored/:downloadName', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

router.get('/public/:stored/:downloadName', (req, res) => {
  try {
    const stored = String(req.params.stored || '');
    const downloadName = String(req.params.downloadName || '');

    // Prevent path traversal
    const safe = /^[a-zA-Z0-9._-]+$/;
    if (!safe.test(stored) || !safe.test(downloadName)) {
      return res.status(400).json({ error: 'Nome de arquivo inválido' });
    }

    const filePath = path.join(uploadsDir, stored);
    if (!fs.existsSync(filePath)) {
      // Fallback: try downloadName as filename (some records duplicate the name)
      const fallbackPath = path.join(uploadsDir, downloadName);
      if (downloadName !== stored && fs.existsSync(fallbackPath)) {
        const ext = path.extname(downloadName) || path.extname(stored);
        if (ext) res.type(ext);
        res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
        return res.sendFile(fallbackPath);
      }
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }

    // Ensure downstream services see the extension in the URL
    const ext = path.extname(downloadName) || path.extname(stored);
    if (ext) {
      res.type(ext);
    }

    res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
    return res.sendFile(filePath);
  } catch (error) {
    console.error('Public download error:', error);
    return res.status(500).json({ error: 'Erro ao baixar arquivo' });
  }
});

router.get('/meta/:mediaId', async (req, res) => {
  try {
    const mediaId = String(req.params.mediaId || '').trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(mediaId)) {
      return res.status(400).json({ error: 'Media ID inválido' });
    }

    const candidateTokens = await getMetaCandidateTokens(req);
    if (candidateTokens.length === 0) {
      return res.status(404).json({ error: 'Nenhum token Meta disponível' });
    }

    let upstream = null;
    let resolvedMimeType = null;
    let resolvedFilename = null;
    let lastError = null;

    // Tenta cada token/phone_number_id. O Graph responde 400 quando a mídia
    // não pertence ao número daquele token, então seguimos para o próximo.
    for (const { token: metaToken, phoneNumberId } of candidateTokens) {
      const infoUrl = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${mediaId}`);
      if (phoneNumberId) infoUrl.searchParams.set('phone_number_id', phoneNumberId);

      let mediaInfoResponse;
      try {
        mediaInfoResponse = await fetch(infoUrl.toString(), {
          headers: { Accept: '*/*', Authorization: `Bearer ${metaToken}` },
          signal: AbortSignal.timeout(15000),
        });
      } catch (err) {
        lastError = { status: 502, message: err?.message || 'Falha de rede ao consultar mídia' };
        continue;
      }

      if (!mediaInfoResponse.ok) {
        const bodyText = await mediaInfoResponse.text().catch(() => '');
        lastError = { status: mediaInfoResponse.status, message: bodyText?.slice(0, 300) || 'Falha ao consultar mídia' };
        console.warn('[meta-media] info failed', { mediaId, status: mediaInfoResponse.status, phoneNumberId });
        continue;
      }

      const mediaInfo = await mediaInfoResponse.json().catch(() => null);
      resolvedMimeType = mediaInfo?.mime_type || resolvedMimeType;
      resolvedFilename = mediaInfo?.id ? `meta_${mediaInfo.id}` : `meta_${mediaId}`;

      if (!mediaInfo?.url) {
        lastError = { status: 404, message: 'Mídia sem URL de download' };
        continue;
      }

      let downloadResponse;
      try {
        downloadResponse = await fetch(mediaInfo.url, {
          redirect: 'follow',
          headers: {
            Accept: '*/*',
            Authorization: `Bearer ${metaToken}`,
            // A CDN da Meta rejeita requisições sem User-Agent
            'User-Agent': 'WhatsApp/2.23 CloudAPI-Media-Proxy',
          },
          signal: AbortSignal.timeout(30000),
        });
      } catch (err) {
        lastError = { status: 502, message: err?.message || 'Falha de rede ao baixar mídia' };
        continue;
      }

      if (downloadResponse.ok) {
        upstream = downloadResponse;
        break;
      }

      lastError = { status: downloadResponse.status, message: 'Falha ao baixar mídia da CDN Meta' };
      console.warn('[meta-media] download failed', { mediaId, status: downloadResponse.status });
    }

    if (!upstream?.ok) {
      const status = lastError?.status && lastError.status >= 400 && lastError.status < 600 ? lastError.status : 404;
      return res.status(status === 400 ? 404 : status).json({
        error: 'Mídia Meta indisponível',
        detail: lastError?.message || 'Nenhum token conseguiu acessar esta mídia',
      });

    }

    const contentType = upstream.headers.get('content-type') || resolvedMimeType;
    const contentLength = upstream.headers.get('content-length');
    const contentDisposition = upstream.headers.get('content-disposition');
    const cacheControl = upstream.headers.get('cache-control');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentDisposition) {
      res.setHeader('Content-Disposition', contentDisposition);
    } else if (resolvedFilename) {
      res.setHeader('Content-Disposition', `inline; filename="${resolvedFilename}"`);
    }
    res.setHeader('Cache-Control', cacheControl || 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!upstream.body) {
      return res.status(204).end();
    }

    Readable.fromWeb(upstream.body).on('error', (streamError) => {
      console.error('Meta media stream error:', streamError);
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.end();
      }
    }).pipe(res);
  } catch (error) {
    console.error('Meta media route error:', error);
    return res.status(500).json({ error: 'Erro ao carregar mídia Meta' });
  }
});

// Public proxy for temporary external media URLs that don't expose CORS headers.
// Scoped to trusted WhatsApp media hosts to avoid turning this into a generic open proxy.
// For Meta media (lookaside.fbsbx.com), tries to authenticate with meta_token from connection.
router.get('/proxy', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'URL obrigatória' });
    }

    let targetUrl;
    try {
      targetUrl = new URL(rawUrl);
    } catch {
      return res.status(400).json({ error: 'URL inválida' });
    }

    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({ error: 'Protocolo inválido' });
    }

    if (!isProxyAllowedHost(targetUrl.hostname)) {
      return res.status(403).json({ error: 'Host não permitido' });
    }

    // Build upstream headers
    const upstreamHeaders = { Accept: '*/*' };
    let upstream = null;

    // For Meta media hosts, try all available Meta tokens until one works.
    // This keeps old lookaside URLs working even when the request has no auth header.
    if (META_MEDIA_HOSTS.has(targetUrl.hostname.toLowerCase())) {
      try {
        const candidateTokens = await getMetaCandidateTokens(req);

        for (const { token: metaToken } of candidateTokens) {
          const response = await fetch(targetUrl.toString(), {
            redirect: 'follow',
            headers: {
              ...upstreamHeaders,
              Authorization: `Bearer ${metaToken}`,
              'User-Agent': 'WhatsApp/2.23 CloudAPI-Media-Proxy',
            },
          });


          if (response.ok) {
            upstream = response;
            break;
          }

          if (response.status !== 401 && response.status !== 403) {
            upstream = response;
            break;
          }
        }
      } catch (e) {
        console.error('Meta token lookup error:', e.message);
      }
    }

    if (!upstream) {
      upstream = await fetch(targetUrl.toString(), {
        redirect: 'follow',
        headers: upstreamHeaders,
      });
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Falha ao carregar mídia' });
    }

    const contentType = upstream.headers.get('content-type');
    const contentLength = upstream.headers.get('content-length');
    const contentDisposition = upstream.headers.get('content-disposition');
    const cacheControl = upstream.headers.get('cache-control');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Cache-Control', cacheControl || 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!upstream.body) {
      return res.status(204).end();
    }

    Readable.fromWeb(upstream.body).on('error', (streamError) => {
      console.error('Media proxy stream error:', streamError);
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.end();
      }
    }).pipe(res);
  } catch (error) {
    console.error('Media proxy error:', error);
    return res.status(500).json({ error: 'Erro ao carregar mídia' });
  }
});

// Delete file
router.delete('/:filename', authenticate, (req, res) => {
  try {
    const filePath = path.join(uploadsDir, req.params.filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Arquivo não encontrado' });
    }
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Erro ao deletar arquivo' });
  }
});

// Check if file exists (public diagnostic endpoint)
router.get('/check/:filename', (req, res) => {
  try {
    const filePath = path.join(uploadsDir, req.params.filename);
    const exists = fs.existsSync(filePath);
    
    if (exists) {
      const stats = fs.statSync(filePath);
      const baseUrl = String(process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
      res.json({ 
        exists: true, 
        size: stats.size,
        created: stats.birthtime,
        url: baseUrl ? `${baseUrl}/uploads/${req.params.filename}` : `/uploads/${req.params.filename}`
      });
    } else {
      res.json({ exists: false, message: 'Arquivo não encontrado no servidor' });
    }
  } catch (error) {
    console.error('Check error:', error);
    res.status(500).json({ error: 'Erro ao verificar arquivo' });
  }
});

// List recent uploads (for diagnostics)
router.get('/list', authenticate, (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir)
      .map(name => {
        const filePath = path.join(uploadsDir, name);
        const stats = fs.statSync(filePath);
        return { name, size: stats.size, created: stats.birthtime };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created))
      .slice(0, 50);
    
    res.json({ files, count: files.length });
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'Erro ao listar arquivos' });
  }
});

export default router;

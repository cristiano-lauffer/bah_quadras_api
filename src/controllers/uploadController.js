// POST /uploads — recebe uma foto em data URL ({ arquivo: "data:image/jpeg;base64,..." }),
// grava em UPLOAD_DIR (padrão: ./uploads) e devolve o endereço público dela.
// O front já lê o arquivo como data URL para mostrar a prévia, então não precisa de multipart.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

const pastaUploads = () => path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));

// Confere a assinatura do arquivo (não confia só no tipo declarado)
function assinaturaConfere(tipo, b) {
  if (tipo === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (tipo === 'image/png') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (tipo === 'image/webp') return b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

async function enviar(req, res) {
  const m = DATA_URL.exec(String(req.body.arquivo ?? ''));
  if (!m) return res.status(400).json({ erro: 'Envie a foto como data URL JPG, PNG ou WebP em { "arquivo": "data:image/...;base64,..." }.' });

  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) return res.status(400).json({ erro: 'A foto deve ter até 5 MB.' });
  if (!assinaturaConfere(m[1], bytes)) return res.status(400).json({ erro: 'O arquivo não é uma imagem válida.' });

  try {
    const nome = `${crypto.randomBytes(16).toString('hex')}.${TIPOS[m[1]]}`;
    await fs.mkdir(pastaUploads(), { recursive: true });
    await fs.writeFile(path.join(pastaUploads(), nome), bytes);
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    return res.status(201).json({ url: `${base}/uploads/${nome}` });
  } catch (err) {
    console.error('Erro ao gravar upload:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { enviar, pastaUploads };

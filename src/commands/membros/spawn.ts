import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  AttachmentBuilder,
} from 'discord.js';
import sharp from 'sharp';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ffmpegStatic from 'ffmpeg-static';
import { supabase } from '../../lib/supabase';

const PESOS_SPAWN: Record<string, number> = {
  comum: 50, incomum: 25, raro: 15, epico: 7, lendario: 3,
};

const PONTOS_BASE: Record<string, number> = {
  comum: 1, incomum: 10, raro: 50, epico: 200, lendario: 1000,
};

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

// META por raridade — espelho exato do site
const COR_RARIDADE: Record<string, string> = {
  comum: '#9CA3AF', incomum: '#22C55E', raro: '#3B82F6',
  epico: '#A855F7', lendario: '#F59E0B',
};

const GRAD_START: Record<string, string> = {
  comum: '#374151', incomum: '#14532D', raro: '#1E3A8A',
  epico: '#581C87', lendario: '#78350F',
};

const GRAD_END: Record<string, string> = {
  comum: '#1F2937', incomum: '#052e16', raro: '#0f172a',
  epico: '#1e0a3c', lendario: '#1c0a00',
};

const META_LABEL: Record<string, string> = {
  comum: 'Comum', incomum: 'Incomum', raro: 'Raro',
  epico: 'Épico', lendario: 'Lendário',
};

const PESO_PONTUACAO: Record<string, number> = {
  lendario: 1000, epico: 200, raro: 50, incomum: 10, comum: 1,
};

const SIMBOLO_RARIDADE: Record<string, string> = {
  comum: '●', incomum: '▲', raro: '◆', epico: '★', lendario: '✦',
};

const LABEL_CATEGORIA: Record<string, string> = {
  anime: 'Anime', serie: 'Série', filme: 'Filme',
  desenho: 'Desenho', jogo: 'Jogo', musica: 'Música', hq: 'HQ', outro: 'Outro',
};

function calcPts(raridade: string, personagem: string, vinculo: string): number {
  const base = PONTOS_BASE[raridade] ?? 1;
  let h = 0;
  const s = (personagem + vinculo).toLowerCase();
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return base + (Math.abs(h) % 50);
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Calcula posição do usuário no ranking geral
async function buscarRankingUsuario(userId: string): Promise<number | null> {
  const { data } = await supabase
    .from('cartas_usuarios')
    .select('discord_id, quantidade, carta:carta_id(raridade)');

  if (!data?.length) return null;

  const map = new Map<string, number>();
  for (const cu of data) {
    const carta = cu.carta as any;
    map.set(cu.discord_id, (map.get(cu.discord_id) || 0) + (PESO_PONTUACAO[carta?.raridade] || 1) * cu.quantidade);
  }

  if (!map.has(userId)) return null;
  const meusPts = map.get(userId)!;
  return [...map.values()].filter(p => p > meusPts).length + 1;
}

const COR_GENERO: Record<string, string> = {
  masculino: '#60A5FA', feminino: '#F472B6', outros: '#9CA3AF',
};
const SIM_GENERO: Record<string, string> = {
  masculino: '\u2642', feminino: '\u2640', outros: '\u26A7',
};

type CardResult = { buffer: Buffer; ext: 'png' | 'webp' };

// Recorta a imagem respeitando offset e zoom do banco (igual ao site)
async function cropImagem(
  imgBuf: Buffer,
  targetW: number,
  targetH: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  page: number,
): Promise<Buffer> {
  const zoomFactor = Math.max(1, zoom / 100);
  const effectiveW = Math.round(targetW * zoomFactor);
  const effectiveH = Math.round(targetH * zoomFactor);

  const resized = await sharp(imgBuf, { page, animated: false })
    .resize(effectiveW, effectiveH, { fit: 'cover' })
    .png()
    .toBuffer();

  const cropX = Math.max(0, Math.round((effectiveW - targetW) * (offsetX / 100)));
  const cropY = Math.max(0, Math.round((effectiveH - targetH) * (offsetY / 100)));

  return sharp(resized)
    .extract({ left: cropX, top: cropY, width: targetW, height: targetH })
    .png()
    .toBuffer();
}

// Gera o card visual idêntico ao PreviewCard do site (proporção 200px → 400px 2×)
async function gerarCardImagem(
  imagemUrl: string,
  personagem: string,
  vinculo: string,
  subVinculo: string | null,
  raridade: string,
  categoria: string,
  genero: string,
  descricao: string | null,
  pts: number,
  rankingPos: number | null,
  offsetX: number,
  offsetY: number,
  zoom: number,
): Promise<CardResult | null> {
  try {
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(imagemUrl, { signal: controller.signal });
    } finally {
      clearTimeout(fetchTimeout);
    }
    if (!res.ok) {
      console.error(`[spawn] imagem retornou ${res.status}: ${imagemUrl}`);
      return null;
    }
    const imgBuf = Buffer.from(await res.arrayBuffer());
    if (imgBuf.length === 0) return null;

    // Dimensões — PreviewCard do site em 2× (200px → 400px)
    const CW        = 400;
    const TOPLINE_H = 4;    // linha brilhante no topo
    const HDR_H     = 52;   // header: raridade + categoria
    const IMG_H     = 490;  // área da foto (245 × 2)
    const BODY_H    = 140;  // nome + vínculo + sub_vínculo + descrição
    const FTR_H     = 54;   // footer com pontuação
    const CH        = TOPLINE_H + HDR_H + IMG_H + BODY_H + FTR_H; // 740
    const RX        = 40;
    const GLOW      = 32;
    const TW        = CW + GLOW * 2;
    const TH        = CH + GLOW * 2;

    const cor        = COR_RARIDADE[raridade] || '#9CA3AF';
    const gradStart  = GRAD_START[raridade]   || '#374151';
    const gradEnd    = GRAD_END[raridade]     || '#1F2937';
    const isLend     = raridade === 'lendario';
    const sim        = SIMBOLO_RARIDADE[raridade] || '●';
    const generoSim  = SIM_GENERO[genero]  || '';
    const generoCor  = COR_GENERO[genero]  || '#9CA3AF';
    const isGif      = /\.gif(?:[?#]|$)/i.test(imagemUrl);

    const labelRar  = xmlEsc(`${sim} ${(META_LABEL[raridade] || raridade).toUpperCase()}`);
    const labelCat  = xmlEsc(LABEL_CATEGORIA[categoria] || categoria);
    const nome      = xmlEsc(truncate(personagem, 20));
    const franquia  = xmlEsc(truncate(vinculo.toUpperCase(), 26));
    const subFran   = subVinculo ? xmlEsc(truncate(subVinculo.toUpperCase(), 30)) : '';
    const desc      = descricao ? xmlEsc(truncate(descricao, 55)) : '';

    // Posições Y
    const yImgStart  = TOPLINE_H + HDR_H;                     // 56
    const yBodyStart = yImgStart + IMG_H;                      // 546
    const yFtrStart  = yBodyStart + BODY_H;                    // 686
    const yHdrText   = TOPLINE_H + HDR_H / 2 + 7;             // ~33
    const yName      = yBodyStart + 36;                        // 582
    const yVinculo   = yName + 30;                             // 612
    const ySubVin    = yVinculo + 20;                          // 632 (só se tiver sub_vinculo)
    const yDescLine  = subFran ? ySubVin + 14 : yVinculo + 14;
    const yDescText  = yDescLine + 20;
    const yFtrText   = yFtrStart + 35;

    // SVG da máscara arredondada (usada para clip no card final)
    const maskSvg = `<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${CW}" height="${CH}" rx="${RX}" ry="${RX}" fill="white"/>
    </svg>`;

    // Badges de gênero e GIF (overlay estático aplicado sobre a imagem)
    const badgeSvg = `<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
      ${generoSim ? `<rect x="${CW - 50}" y="${yImgStart + 14}" width="36" height="36"
              rx="7" fill="#000" fill-opacity="0.65"/>
        <text x="${CW - 32}" y="${yImgStart + 38}"
              font-family="sans-serif" font-size="20"
              fill="${generoCor}" text-anchor="middle">${generoSim}</text>` : ''}
      ${isGif ? `<rect x="14" y="${yImgStart + 14}" width="44" height="24"
              rx="5" fill="#A855F7" fill-opacity="0.85"/>
        <text x="36" y="${yImgStart + 30}"
              font-family="sans-serif" font-size="13" font-weight="900"
              fill="white" text-anchor="middle" letter-spacing="1">GIF</text>` : ''}
    </svg>`;

    // Card base SVG (compartilhado entre fluxo GIF e estático)
    const cardSvg = `<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0.52" y1="0" x2="0.48" y2="1">
          <stop offset="0%"   stop-color="${gradStart}"/>
          <stop offset="100%" stop-color="${gradEnd}"/>
        </linearGradient>
        <linearGradient id="topline" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stop-color="${cor}" stop-opacity="0"/>
          <stop offset="50%"  stop-color="${cor}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${cor}" stop-opacity="0"/>
        </linearGradient>
        ${isLend ? `<linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stop-color="${cor}" stop-opacity="0.09"/>
          <stop offset="55%"  stop-color="${cor}" stop-opacity="0"/>
          <stop offset="100%" stop-color="${cor}" stop-opacity="0.09"/>
        </linearGradient>` : ''}
      </defs>
      <rect width="${CW}" height="${CH}" fill="url(#bg)"/>
      <rect x="0" y="0" width="${CW}" height="${TOPLINE_H}" fill="url(#topline)"/>
      <text x="24" y="${yHdrText}"
            font-family="sans-serif" font-size="18" font-weight="900"
            fill="${cor}" letter-spacing="2">${labelRar}</text>
      <text x="${CW - 24}" y="${yHdrText}"
            font-family="sans-serif" font-size="18"
            fill="#6B7280" text-anchor="end">${labelCat}</text>
      <line x1="0" y1="${yImgStart}" x2="${CW}" y2="${yImgStart}"
            stroke="${cor}" stroke-opacity="0.13" stroke-width="1"/>
      <rect x="0" y="${yImgStart}" width="${CW}" height="${IMG_H}" fill="#000"/>
      ${isLend ? `<rect x="0" y="${yImgStart}" width="${CW}" height="${IMG_H}" fill="url(#shimmer)"/>` : ''}
      <line x1="0" y1="${yBodyStart}" x2="${CW}" y2="${yBodyStart}"
            stroke="${cor}" stroke-opacity="0.13" stroke-width="1"/>
      <text x="24" y="${yName}"
            font-family="sans-serif" font-size="26" font-weight="900"
            fill="white">${nome}</text>
      <text x="24" y="${yVinculo}"
            font-family="sans-serif" font-size="18" font-weight="700"
            fill="${cor}" letter-spacing="2">${franquia}</text>
      ${subFran ? `<text x="24" y="${ySubVin}"
            font-family="sans-serif" font-size="14"
            fill="#6B7280" letter-spacing="1">${subFran}</text>` : ''}
      ${desc ? `<line x1="24" y1="${yDescLine}" x2="${CW - 24}" y2="${yDescLine}"
                      stroke="${cor}" stroke-opacity="0.13" stroke-width="1"/>
               <text x="24" y="${yDescText}"
                     font-family="sans-serif" font-size="16"
                     fill="#6B7280">${desc}</text>` : ''}
      <rect x="0" y="${yFtrStart}" width="${CW}" height="${FTR_H}"
            fill="#000" fill-opacity="0.38"/>
      <line x1="0" y1="${yFtrStart}" x2="${CW}" y2="${yFtrStart}"
            stroke="${cor}" stroke-opacity="0.13" stroke-width="1"/>
      <text x="24" y="${yFtrText}"
            font-family="sans-serif" font-size="18"
            fill="#4B5563">&#9733; PTS</text>
      <text x="${CW - 24}" y="${yFtrText}"
            font-family="sans-serif" font-size="24" font-weight="900"
            fill="${cor}" text-anchor="end">${pts.toLocaleString('pt-BR')}</text>
    </svg>`;

    const cardBaseBuf = await sharp(Buffer.from(cardSvg)).png().toBuffer();

    const bordaSvg = `<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="${CW - 2}" height="${CH - 2}"
            rx="${RX}" ry="${RX}" fill="none"
            stroke="${cor}" stroke-opacity="0.33" stroke-width="2"/>
    </svg>`;

    const maskBufShared = await sharp(Buffer.from(maskSvg)).png().toBuffer();

    if (isGif) {
      // ── FLUXO GIF ANIMADO ──────────────────────────────────────────────────
      // Tenta gerar WebP animado frame-a-frame com ffmpeg.
      // Se falhar por qualquer motivo, cai no fluxo estático (primeiro frame).
      try {
        if (!ffmpegStatic) throw new Error('ffmpeg-static não disponível');

        const gifMeta = await sharp(imgBuf, { animated: true }).metadata();
        const totalFrames = gifMeta.pages ?? 1;
        const rawDelays = Array.isArray(gifMeta.delay) ? gifMeta.delay : [];

        // Inclui todos os frames até completar a duração total do GIF (máx 30s)
        // Garante que GIFs de 10s mostrem os 10s completos, não apenas 3s
        const MAX_DURACAO_MS = 30_000;
        let numFrames = 0;
        let duracaoAcumulada = 0;
        for (let i = 0; i < totalFrames; i++) {
          const d = Math.max(rawDelays[i] ?? rawDelays[rawDelays.length - 1] ?? 100, 20);
          duracaoAcumulada += d;
          numFrames++;
          if (duracaoAcumulada >= MAX_DURACAO_MS) break;
        }

        const frameDelays = Array.from({ length: numFrames }, (_, i) => {
          const d = rawDelays[i] ?? rawDelays[rawDelays.length - 1] ?? 100;
          return Math.max(d, 20);
        });

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noitada-card-'));
        try {
          for (let i = 0; i < numFrames; i++) {
            const framePng = await cropImagem(imgBuf, CW, IMG_H, offsetX, offsetY, zoom, i);

            const cardWithFrame = await sharp(cardBaseBuf)
              .composite([{ input: framePng, top: yImgStart, left: 0 }])
              .png()
              .toBuffer();

            const cardWithBadgesEBorda = await sharp(cardWithFrame)
              .composite([
                { input: Buffer.from(badgeSvg), top: 0, left: 0 },
                { input: Buffer.from(bordaSvg), top: 0, left: 0 },
              ])
              .png()
              .toBuffer();

            const frameCard = await sharp(cardWithBadgesEBorda)
              .composite([{ input: maskBufShared, blend: 'dest-in' }])
              .png()
              .toBuffer();

            fs.writeFileSync(
              path.join(tempDir, `frame${String(i).padStart(4, '0')}.png`),
              frameCard,
            );
          }

          const concatLines = frameDelays.map((delay, i) =>
            `file 'frame${String(i).padStart(4, '0')}.png'\nduration ${(delay / 1000).toFixed(3)}`,
          );
          concatLines.push(`file 'frame${String(numFrames - 1).padStart(4, '0')}.png'`);
          fs.writeFileSync(path.join(tempDir, 'concat.txt'), concatLines.join('\n'));

          execSync(
            `"${ffmpegStatic}" -y -f concat -safe 0 -i concat.txt -c:v libwebp_anim -loop 0 -quality 90 output.webp`,
            { cwd: tempDir, timeout: 30_000 },
          );

          const buffer = fs.readFileSync(path.join(tempDir, 'output.webp'));
          return { buffer, ext: 'webp' };

        } finally {
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignora */ }
        }
      } catch (gifErr: any) {
        console.warn('[spawn] GIF animado falhou, usando primeiro frame:', gifErr?.message);
        // Cai no fluxo estático abaixo
      }
    }

    // ── FLUXO IMAGEM ESTÁTICA (ou fallback do GIF) ────────────────────────────
    // Extrai 1º frame com offset/zoom do banco de dados
    const charBuf = await cropImagem(imgBuf, CW, IMG_H, offsetX, offsetY, zoom, 0);

    // 3. Composita a foto + badges + borda
    const cardWithImg = await sharp(cardBaseBuf)
      .composite([{ input: charBuf, top: yImgStart, left: 0 }])
      .png()
      .toBuffer();

    const cardComBadgesEBorda = await sharp(cardWithImg)
      .composite([
        { input: Buffer.from(badgeSvg), top: 0, left: 0 },
        { input: Buffer.from(bordaSvg), top: 0, left: 0 },
      ])
      .png()
      .toBuffer();

    // 4. Aplicar máscara arredondada (corta os cantos do card)
    const cardArredondado = await sharp(cardComBadgesEBorda)
      .composite([{ input: maskBufShared, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // 5. Glow externo
    const glowOpacity = isLend ? 0.75 : 0.5;
    const glowBlur    = isLend ? 18   : 13;
    const glowSvg = `<svg width="${TW}" height="${TH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="g" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="${glowBlur}"/>
        </filter>
      </defs>
      <rect x="${GLOW - 4}" y="${GLOW - 4}" width="${CW + 8}" height="${CH + 8}"
            rx="${RX + 4}" fill="${cor}" opacity="${glowOpacity}" filter="url(#g)"/>
    </svg>`;
    const glowBuf = await sharp(Buffer.from(glowSvg)).png().toBuffer();

    // 6. Final: glow + card arredondado centralizado
    const buffer = await sharp(glowBuf)
      .composite([{ input: cardArredondado, top: GLOW, left: GLOW }])
      .png()
      .toBuffer();

    return { buffer, ext: 'png' };

  } catch (err: any) {
    console.error(`[spawn] erro ao gerar card (${imagemUrl.substring(0, 80)}):`, err?.message ?? err);
    return null;
  }
}

// Gera o card completo sem imagem — exibe placeholder no slot da foto
async function gerarCardPlaceholder(
  personagem: string,
  vinculo: string,
  subVinculo: string | null,
  raridade: string,
  categoria: string,
  genero: string,
  descricao: string | null,
  pts: number,
): Promise<CardResult> {
  const CW = 400, TOPLINE_H = 4, HDR_H = 52, IMG_H = 490, BODY_H = 140, FTR_H = 54;
  const CH = TOPLINE_H + HDR_H + IMG_H + BODY_H + FTR_H;
  const RX = 40, GLOW = 32, TW = CW + GLOW * 2, TH = CH + GLOW * 2;

  const cor       = COR_RARIDADE[raridade] || '#9CA3AF';
  const gradStart = GRAD_START[raridade]   || '#374151';
  const gradEnd   = GRAD_END[raridade]     || '#1F2937';
  const isLend    = raridade === 'lendario';
  const sim       = SIMBOLO_RARIDADE[raridade] || '●';
  const generoSim = SIM_GENERO[genero] || '';
  const generoCor = COR_GENERO[genero] || '#9CA3AF';

  const labelRar = xmlEsc(`${sim} ${(META_LABEL[raridade] || raridade).toUpperCase()}`);
  const labelCat = xmlEsc(LABEL_CATEGORIA[categoria] || categoria);
  const nome     = xmlEsc(truncate(personagem, 20));
  const franquia = xmlEsc(truncate(vinculo.toUpperCase(), 26));
  const subFran  = subVinculo ? xmlEsc(truncate(subVinculo.toUpperCase(), 30)) : '';
  const desc     = descricao  ? xmlEsc(truncate(descricao, 55)) : '';

  const yImgStart  = TOPLINE_H + HDR_H;
  const yBodyStart = yImgStart + IMG_H;
  const yFtrStart  = yBodyStart + BODY_H;
  const yHdrText   = TOPLINE_H + HDR_H / 2 + 7;
  const yName      = yBodyStart + 36;
  const yVinculo   = yName + 30;
  const ySubVin    = yVinculo + 20;
  const yDescLine  = subFran ? ySubVin + 14 : yVinculo + 14;
  const yDescText  = yDescLine + 20;
  const yFtrText   = yFtrStart + 35;
  const yCenterImg = yImgStart + IMG_H / 2;

  const cardSvg = `<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0.52" y1="0" x2="0.48" y2="1">
        <stop offset="0%"   stop-color="${gradStart}"/>
        <stop offset="100%" stop-color="${gradEnd}"/>
      </linearGradient>
      <linearGradient id="topline" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%"   stop-color="${cor}" stop-opacity="0"/>
        <stop offset="50%"  stop-color="${cor}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${cor}" stop-opacity="0"/>
      </linearGradient>
      ${isLend ? `<linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%"   stop-color="${cor}" stop-opacity="0.09"/>
        <stop offset="55%"  stop-color="${cor}" stop-opacity="0"/>
        <stop offset="100%" stop-color="${cor}" stop-opacity="0.09"/>
      </linearGradient>` : ''}
    </defs>
    <rect width="${CW}" height="${CH}" fill="url(#bg)"/>
    <rect x="0" y="0" width="${CW}" height="${TOPLINE_H}" fill="url(#topline)"/>
    <text x="24" y="${yHdrText}"
          font-family="sans-serif" font-size="18" font-weight="900"
          fill="${cor}" letter-spacing="2">${labelRar}</text>
    <text x="${CW - 24}" y="${yHdrText}"
          font-family="sans-serif" font-size="18"
          fill="#6B7280" text-anchor="end">${labelCat}</text>
    <line x1="0" y1="${yImgStart}" x2="${CW}" y2="${yImgStart}"
          stroke="${cor}" stroke-opacity="0.13" stroke-width="1"/>

    <!-- Slot da foto: placeholder com ícone de imagem quebrada -->
    <rect x="0" y="${yImgStart}" width="${CW}" height="${IMG_H}" fill="#0a0a14"/>
    ${isLend ? `<rect x="0" y="${yImgStart}" width="${CW}" height="${IMG_H}" fill="url(#shimmer)"/>` : ''}
    <rect x="${CW / 2 - 38}" y="${yCenterImg - 56}" width="76" height="76"
          rx="12" fill="none" stroke="#2D3748" stroke-width="3"/>
    <line x1="${CW / 2 - 19}" y1="${yCenterImg - 40}"
          x2="${CW / 2 + 19}" y2="${yCenterImg - 4}"
          stroke="#2D3748" stroke-width="3" stroke-linecap="round"/>
    <line x1="${CW / 2 + 19}" y1="${yCenterImg - 40}"
          x2="${CW / 2 - 19}" y2="${yCenterImg - 4}"
          stroke="#2D3748" stroke-width="3" stroke-linecap="round"/>
    <text x="${CW / 2}" y="${yCenterImg + 28}"
          font-family="sans-serif" font-size="17" text-anchor="middle"
          fill="#4B5563" letter-spacing="0.5">Problema com a imagem</text>

    ${generoSim ? `<rect x="${CW - 50}" y="${yImgStart + 14}" width="36" height="36"
            rx="7" fill="#000" fill-opacity="0.65"/>
      <text x="${CW - 32}" y="${yImgStart + 38}"
            font-family="sans-serif" font-size="20"
            fill="${generoCor}" text-anchor="middle">${generoSim}</text>` : ''}

    <line x1="0" y1="${yBodyStart}" x2="${CW}" y2="${yBodyStart}"
          stroke="${cor}" stroke-opacity="0.13" stroke-width="1"/>
    <text x="24" y="${yName}"
          font-family="sans-serif" font-size="26" font-weight="900"
          fill="white">${nome}</text>
    <text x="24" y="${yVinculo}"
          font-family="sans-serif" font-size="18" font-weight="700"
          fill="${cor}" letter-spacing="2">${franquia}</text>
    ${subFran ? `<text x="24" y="${ySubVin}"
          font-family="sans-serif" font-size="14"
          fill="#6B7280" letter-spacing="1">${subFran}</text>` : ''}
    ${desc ? `<line x1="24" y1="${yDescLine}" x2="${CW - 24}" y2="${yDescLine}"
                    stroke="${cor}" stroke-opacity="0.13" stroke-width="1"/>
              <text x="24" y="${yDescText}"
                    font-family="sans-serif" font-size="16"
                    fill="#6B7280">${desc}</text>` : ''}
    <rect x="0" y="${yFtrStart}" width="${CW}" height="${FTR_H}"
          fill="#000" fill-opacity="0.38"/>
    <line x1="0" y1="${yFtrStart}" x2="${CW}" y2="${yFtrStart}"
          stroke="${cor}" stroke-opacity="0.13" stroke-width="1"/>
    <text x="24" y="${yFtrText}"
          font-family="sans-serif" font-size="18"
          fill="#4B5563">&#9733; PTS</text>
    <text x="${CW - 24}" y="${yFtrText}"
          font-family="sans-serif" font-size="24" font-weight="900"
          fill="${cor}" text-anchor="end">${pts.toLocaleString('pt-BR')}</text>
  </svg>`;

  const maskSvg = `<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${CW}" height="${CH}" rx="${RX}" ry="${RX}" fill="white"/>
  </svg>`;
  const bordaSvg = `<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="${CW - 2}" height="${CH - 2}"
          rx="${RX}" ry="${RX}" fill="none"
          stroke="${cor}" stroke-opacity="0.33" stroke-width="2"/>
  </svg>`;

  const cardBuf  = await sharp(Buffer.from(cardSvg)).png().toBuffer();
  const maskBuf  = await sharp(Buffer.from(maskSvg)).png().toBuffer();

  const cardComBorda = await sharp(cardBuf)
    .composite([{ input: Buffer.from(bordaSvg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  const cardArredondado = await sharp(cardComBorda)
    .composite([{ input: maskBuf, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const glowOpacity = isLend ? 0.75 : 0.5;
  const glowBlur    = isLend ? 18   : 13;
  const glowSvg = `<svg width="${TW}" height="${TH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="g" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="${glowBlur}"/>
      </filter>
    </defs>
    <rect x="${GLOW - 4}" y="${GLOW - 4}" width="${CW + 8}" height="${CH + 8}"
          rx="${RX + 4}" fill="${cor}" opacity="${glowOpacity}" filter="url(#g)"/>
  </svg>`;
  const glowBuf = await sharp(Buffer.from(glowSvg)).png().toBuffer();

  const buffer = await sharp(glowBuf)
    .composite([{ input: cardArredondado, top: GLOW, left: GLOW }])
    .png()
    .toBuffer();

  return { buffer, ext: 'png' };
}


export const data = new SlashCommandBuilder()
  .setName('spawn')
  .setDescription('Aparece uma carta aleatória para capturar!')
  .addStringOption(option =>
    option.setName('categoria')
      .setDescription('Filtrar por categoria (opcional)')
      .setRequired(false)
      .addChoices(
        { name: '🎌 Anime', value: 'anime' },
        { name: '📺 Série', value: 'serie' },
        { name: '🎬 Filme', value: 'filme' },
        { name: '🖼️ Desenho', value: 'desenho' },
        { name: '🎮 Jogo', value: 'jogo' },
        { name: '🎵 Música', value: 'musica' },
        { name: '🌀 Outro', value: 'outro' },
      )
  )
  .addStringOption(option =>
    option.setName('genero')
      .setDescription('Filtrar por gênero (opcional)')
      .setRequired(false)
      .addChoices(
        { name: '♂️ Masculino', value: 'masculino' },
        { name: '♀️ Feminino', value: 'feminino' },
        { name: '⚧️ Outros', value: 'outros' },
      )
  );

async function verificarCaptura(
  userId: string,
  guildId: string,
  cargoIds: string[]
): Promise<{ pode: boolean; motivo?: string; capturasDiarias: number }> {
  const { data: configs } = await supabase
    .from('configuracoes_roll')
    .select('capturas_por_dia, cooldown_captura_segundos')
    .eq('guild_id', guildId)
    .in('cargo_id', cargoIds);

  const config = configs && configs.length > 0
    ? configs.reduce((m, c) => c.capturas_por_dia > m.capturas_por_dia ? c : m)
    : { capturas_por_dia: 10, cooldown_captura_segundos: 30 };

  const hoje = new Date().toDateString();

  const { data: capturaDiaria } = await supabase
    .from('capturas_diarias')
    .select('*')
    .eq('discord_id', userId)
    .eq('guild_id', guildId)
    .gte('data_reset', hoje)
    .maybeSingle();

  const totalCapturas = capturaDiaria?.total_capturas || 0;
  const rollsExtras = capturaDiaria?.rolls_extras || 0;
  const limiteEfetivo = config.capturas_por_dia + rollsExtras;

  if (totalCapturas >= limiteEfetivo) {
    return {
      pode: false,
      motivo: `❌ Você já capturou **${totalCapturas}/${config.capturas_por_dia}** cartas hoje!\n\n💡 Use \`/roll\` para ganhar capturas extras assistindo um anúncio.`,
      capturasDiarias: config.capturas_por_dia,
    };
  }

  if (capturaDiaria?.ultima_captura && config.cooldown_captura_segundos > 0) {
    const diff = (Date.now() - new Date(capturaDiaria.ultima_captura).getTime()) / 1000;
    if (diff < config.cooldown_captura_segundos) {
      const restante = Math.ceil(config.cooldown_captura_segundos - diff);
      return {
        pode: false,
        motivo: `⏳ Aguarde **${restante}s** antes de capturar outra carta!`,
        capturasDiarias: config.capturas_por_dia,
      };
    }
  }

  return { pode: true, capturasDiarias: config.capturas_por_dia };
}

async function sortearCarta(categoria?: string | null, genero?: string | null) {
  let query = supabase
    .from('cartas')
    .select('id, nome, personagem, vinculo, sub_vinculo, categoria, raridade, imagem_url, imagens, descricao, genero, imagem_offset_x, imagem_offset_y, imagem_zoom')
    .eq('ativa', true);

  if (categoria) query = query.eq('categoria', categoria);
  if (genero) query = query.eq('genero', genero);

  const { data: cartas } = await query;
  if (!cartas || cartas.length === 0) return null;

  const pool: typeof cartas = [];
  for (const carta of cartas) {
    const peso = PESOS_SPAWN[carta.raridade] || 10;
    for (let i = 0; i < peso; i++) pool.push(carta);
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const categoria = interaction.options.getString('categoria');
  const genero = interaction.options.getString('genero');

  await interaction.deferReply();

  try {
    const carta = await sortearCarta(categoria, genero);
    if (!carta) {
      const filtro = [categoria, genero].filter(Boolean).join(' + ');
      await interaction.editReply({
        content: filtro
          ? `❌ Nenhuma carta encontrada com os filtros: **${filtro}**`
          : '❌ Nenhuma carta cadastrada ainda.',
      });
      return;
    }

    const pts = calcPts(carta.raridade, carta.personagem, carta.vinculo);
    const emoji = EMOJI_RARIDADE[carta.raridade] ?? '❓';

    // Usa imagens[] como prioridade (igual ao site), cai em imagem_url como fallback
    const imagens: string[] = (carta as any).imagens ?? [];
    const imagemUrl: string | null = imagens[0] || carta.imagem_url || null;

    const rankingPos = await buscarRankingUsuario(userId);
    const cardResult = imagemUrl
      ? await gerarCardImagem(
          imagemUrl,
          carta.personagem,
          carta.vinculo,
          (carta as any).sub_vinculo ?? null,
          carta.raridade,
          carta.categoria,
          carta.genero ?? 'outros',
          carta.descricao ?? null,
          pts,
          rankingPos,
          (carta as any).imagem_offset_x ?? 50,
          (carta as any).imagem_offset_y ?? 50,
          (carta as any).imagem_zoom ?? 100,
        )
      : null;

    const textoSpawn = `🖐️ **Clique em Capturar para pegar essa carta!**`;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`capturar_${carta.id}`)
        .setLabel('🖐️ Capturar!')
        .setStyle(ButtonStyle.Success),
    );

    // Se o card falhou, gera versão com placeholder no slot da imagem
    const resultFinal = cardResult ?? await gerarCardPlaceholder(
      carta.personagem,
      carta.vinculo,
      (carta as any).sub_vinculo ?? null,
      carta.raridade,
      carta.categoria,
      carta.genero ?? 'outros',
      carta.descricao ?? null,
      pts,
    ).catch(() => null);

    const msg = resultFinal
      ? await interaction.editReply({
          content: textoSpawn,
          files: [new AttachmentBuilder(resultFinal.buffer, { name: `carta-${carta.id}.${resultFinal.ext}` })],
          components: [row],
        })
      : await interaction.editReply({ content: textoSpawn, components: [row] });

    const collector = msg.createMessageComponentCollector({ time: 60_000 });

    collector.on('collect', async (btn) => {
      const capturadorId = btn.user.id;

      // Verifica limite diário do jogador que está capturando
      const capturadorMember = interaction.guild?.members.cache.get(capturadorId)
        || await interaction.guild?.members.fetch(capturadorId).catch(() => null);
      const cargoIdsCapturador = capturadorMember ? [...capturadorMember.roles.cache.keys()] : [];

      const verificacaoCapturador = await verificarCaptura(capturadorId, guildId, cargoIdsCapturador);
      if (!verificacaoCapturador.pode) {
        await btn.reply({ content: verificacaoCapturador.motivo!, flags: MessageFlags.Ephemeral });
        return;
      }

      await btn.deferUpdate();

      // Registra a carta na coleção do capturador
      const cartaId = btn.customId.split('_')[1];
      const { data: jaTemCarta } = await supabase
        .from('cartas_usuarios')
        .select('id, quantidade')
        .eq('discord_id', capturadorId)
        .eq('carta_id', cartaId)
        .maybeSingle();

      if (jaTemCarta) {
        await supabase
          .from('cartas_usuarios')
          .update({ quantidade: jaTemCarta.quantidade + 1 })
          .eq('id', jaTemCarta.id);
      } else {
        await supabase
          .from('cartas_usuarios')
          .insert({ discord_id: capturadorId, carta_id: cartaId });
      }

      // Atualiza capturas diárias do capturador
      const hoje = new Date().toDateString();
      const agora = new Date().toISOString();
      const { data: capturaDiariaAtual } = await supabase
        .from('capturas_diarias')
        .select('*')
        .eq('discord_id', capturadorId)
        .eq('guild_id', guildId)
        .gte('data_reset', hoje)
        .maybeSingle();

      if (capturaDiariaAtual) {
        await supabase
          .from('capturas_diarias')
          .update({ total_capturas: capturaDiariaAtual.total_capturas + 1, ultima_captura: agora })
          .eq('id', capturaDiariaAtual.id);
      } else {
        await supabase
          .from('capturas_diarias')
          .insert({ discord_id: capturadorId, guild_id: guildId, data_reset: agora, total_capturas: 1, ultima_captura: agora });
      }

      const textoCaptura = jaTemCarta
        ? `🔄 <@${capturadorId}> capturou! Agora tem **${jaTemCarta.quantidade + 1}x**.`
        : `🆕 **<@${capturadorId}> adicionou à coleção!**`;

      await interaction.editReply({ content: textoCaptura, components: [] });
      collector.stop();
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        await interaction.editReply({
          content: '⏰ Tempo esgotado! A carta fugiu...',
          components: [],
        }).catch(() => {});
      }
    });

  } catch (error: any) {
    console.error('Erro no /spawn:', error);
    await interaction.editReply({ content: '❌ Erro ao spawnar carta. Tente novamente!' });
  }
};

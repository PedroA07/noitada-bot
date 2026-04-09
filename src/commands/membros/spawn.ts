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

const COR_RARIDADE: Record<string, string> = {
  comum: '#9CA3AF', incomum: '#10B981', raro: '#3B82F6',
  epico: '#8B5CF6', lendario: '#F59E0B',
};

// Fundo escuro com tint da raridade (igual ao site)
const COR_BOTTOM: Record<string, string> = {
  comum: '#111214', incomum: '#08150d', raro: '#080d18',
  epico: '#0e0815', lendario: '#160f00',
};

const PESO_PONTUACAO: Record<string, number> = {
  lendario: 1000, epico: 200, raro: 50, incomum: 10, comum: 1,
};

const SIMBOLO_RARIDADE: Record<string, string> = {
  comum: '●', incomum: '▲', raro: '◆', epico: '★', lendario: '✦',
};

const LABEL_CATEGORIA: Record<string, string> = {
  anime: 'Anime', serie: 'Serie', filme: 'Filme', desenho: 'Desenho',
  jogo: 'Jogo', musica: 'Musica', outro: 'Outro', hq: 'HQ',
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

// Gera o card visual no estilo do site:
// imagem do personagem (70%) + seção inferior com tint da raridade (30%) + glow externo
async function gerarCardImagem(
  imagemUrl: string,
  personagem: string,
  vinculo: string,
  raridade: string,
  categoria: string,
  genero: string,
  descricao: string | null,
  pts: number,
  rankingPos: number | null,
): Promise<Buffer | null> {
  try {
    const res = await fetch(imagemUrl);
    if (!res.ok) return null;
    const imgBuf = Buffer.from(await res.arrayBuffer());
    if (imgBuf.length === 0) return null;
    // GIF: sharp extrai o primeiro frame e aplica o card normalmente

    // Dimensões — mesma proporção do site
    const CW = 300;
    const IMG_H = 360;   // altura da foto do personagem
    const BOT_H = 130;   // altura da seção inferior com texto
    const CH = IMG_H + BOT_H;
    const GLOW = 26;     // margem para o glow externo
    const TW = CW + GLOW * 2;
    const TH = CH + GLOW * 2;
    const RX = 14;

    const cor = COR_RARIDADE[raridade] || '#9CA3AF';
    const botBg = COR_BOTTOM[raridade] || '#111214';
    const sim = SIMBOLO_RARIDADE[raridade] || '●';
    const labelRar = xmlEsc(`${sim} ${raridade.toUpperCase()}`);
    const labelCat = xmlEsc(LABEL_CATEGORIA[categoria] || categoria);
    const nome = xmlEsc(truncate(personagem, 22));
    const franquia = xmlEsc(truncate(vinculo.toUpperCase(), 28));
    const desc = descricao ? xmlEsc(truncate(descricao, 44)) : '';
    const rankLabel = rankingPos ? xmlEsc(`#${rankingPos}`) : '';
    const generoSim = SIM_GENERO[genero] || '';
    const generoCor = COR_GENERO[genero] || '#9CA3AF';

    // 1. Foto do personagem redimensionada (animated: false extrai 1º frame de GIFs)
    const charBuf = await sharp(imgBuf, { animated: false })
      .resize(CW, IMG_H, { fit: 'cover', position: 'top' })
      .png()
      .toBuffer();

    // 2. Seção inferior — fundo com tint da raridade, franquia na cor da raridade
    const botSvg = `<svg width="${CW}" height="${BOT_H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${CW}" height="${BOT_H}" fill="${botBg}"/>
      <text x="12" y="32" font-family="sans-serif" font-size="19" font-weight="bold" fill="white">${nome}</text>
      <text x="12" y="52" font-family="sans-serif" font-size="10" font-weight="bold" fill="${cor}" letter-spacing="1.2">${franquia}</text>
      ${desc ? `<text x="12" y="70" font-family="sans-serif" font-size="10" fill="rgba(255,255,255,0.38)">${desc}</text>` : ''}
      <line x1="10" y1="96" x2="${CW - 10}" y2="96" stroke="${cor}" stroke-opacity="0.15" stroke-width="1"/>
      <text x="12" y="116" font-family="sans-serif" font-size="13" font-weight="bold" fill="${cor}">&#9733; ${pts.toLocaleString('pt-BR')}</text>
      ${rankLabel ? `<text x="${CW - 12}" y="116" font-family="sans-serif" font-size="13" font-weight="bold" fill="${cor}" text-anchor="end">${rankLabel}</text>` : ''}
    </svg>`;
    const botBuf = await sharp(Buffer.from(botSvg)).png().toBuffer();

    // 3. Badges no topo + ícone de gênero no canto superior direito
    const badgeSvg = `<svg width="${CW}" height="${IMG_H}" xmlns="http://www.w3.org/2000/svg">
      <!-- Badge raridade (esquerda) -->
      <rect x="8" y="8" width="116" height="26" rx="6" fill="${cor}" fill-opacity="0.92"/>
      <text x="18" y="26" font-family="sans-serif" font-size="12" font-weight="bold" fill="white">${labelRar}</text>
      <!-- Badge categoria (direita) -->
      <rect x="${CW - 80}" y="8" width="72" height="26" rx="6" fill="rgba(8,8,8,0.78)"/>
      <text x="${CW - 44}" y="26" font-family="sans-serif" font-size="11" fill="rgba(255,255,255,0.85)" text-anchor="middle">${labelCat}</text>
      <!-- Ícone de gênero (canto superior direito, abaixo dos badges) -->
      ${generoSim ? `<circle cx="${CW - 18}" cy="50" r="14" fill="rgba(0,0,0,0.55)"/>
      <text x="${CW - 18}" y="56" font-family="sans-serif" font-size="14" fill="${generoCor}" text-anchor="middle">${generoSim}</text>` : ''}
    </svg>`;
    const badgeBuf = await sharp(Buffer.from(badgeSvg)).png().toBuffer();

    // 4. Monta o card (foto + seção inferior + badges+gênero)
    const cardBuf = await sharp({
      create: { width: CW, height: CH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: charBuf, top: 0, left: 0 },
        { input: botBuf, top: IMG_H, left: 0 },
        { input: badgeBuf, top: 0, left: 0 },  // cobre toda área da foto
      ])
      .png()
      .toBuffer();

    // 5. Borda colorida sobre o card
    const bordaSvg = `<svg width="${CW}" height="${CH}" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="${CW - 2}" height="${CH - 2}" rx="${RX}" ry="${RX}"
            fill="none" stroke="${cor}" stroke-width="3"/>
    </svg>`;
    const cardComBorda = await sharp(cardBuf)
      .composite([{ input: Buffer.from(bordaSvg), top: 0, left: 0 }])
      .png()
      .toBuffer();

    // 6. Glow externo (SVG com feGaussianBlur, sem imagens embutidas)
    const glowSvg = `<svg width="${TW}" height="${TH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="g" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="13"/>
        </filter>
      </defs>
      <rect x="${GLOW - 4}" y="${GLOW - 4}" width="${CW + 8}" height="${CH + 8}"
            rx="${RX + 4}" fill="${cor}" opacity="0.5" filter="url(#g)"/>
    </svg>`;
    const glowBuf = await sharp(Buffer.from(glowSvg)).png().toBuffer();

    // 7. Final: glow + card centralizado
    return await sharp(glowBuf)
      .composite([{ input: cardComBorda, top: GLOW, left: GLOW }])
      .png()
      .toBuffer();

  } catch (err: any) {
    console.error('[spawn] erro ao gerar card:', err?.message);
    return null;
  }
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
    .select('id, nome, personagem, vinculo, categoria, raridade, imagem_url, descricao, genero')
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

    const rankingPos = await buscarRankingUsuario(userId);
    const imageBuffer = carta.imagem_url
      ? await gerarCardImagem(carta.imagem_url, carta.personagem, carta.vinculo, carta.raridade, carta.categoria, carta.genero ?? 'outros', carta.descricao ?? null, pts, rankingPos)
      : null;

    const rankLabel = rankingPos ? ` • 🏅 **#${rankingPos}** no ranking` : '';
    const textoSpawn = [
      `${emoji} **${carta.personagem}** — ${carta.vinculo}`,
      `✨ ${carta.raridade.charAt(0).toUpperCase() + carta.raridade.slice(1)} • ⭐ ${pts.toLocaleString('pt-BR')} pts${rankLabel}`,
      `\n🖐️ **Clique em Capturar para pegar essa carta!**`,
    ].join('\n');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`capturar_${carta.id}`)
        .setLabel('🖐️ Capturar!')
        .setStyle(ButtonStyle.Success),
    );

    let msg;
    if (imageBuffer) {
      const attachment = new AttachmentBuilder(imageBuffer, { name: `carta-${carta.id}.png` });
      msg = await interaction.editReply({ content: textoSpawn, files: [attachment], components: [row] });
    } else {
      msg = await interaction.editReply({ content: textoSpawn, components: [row] });
    }

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

      const textoCaptura = [
        `${emoji} **${carta.personagem}** — ${carta.vinculo}`,
        `✨ ${carta.raridade.charAt(0).toUpperCase() + carta.raridade.slice(1)} • ⭐ ${pts.toLocaleString('pt-BR')} pts`,
        jaTemCarta
          ? `\n🔄 <@${capturadorId}> capturou! Agora tem **${jaTemCarta.quantidade + 1}x**.`
          : `\n🆕 **<@${capturadorId}> adicionou à coleção!**`,
      ].join('\n');

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

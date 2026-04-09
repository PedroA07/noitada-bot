import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  AttachmentBuilder,
} from 'discord.js';
import sharp from 'sharp';
import { supabase } from '../../lib/supabase';

const PESO_PONTUACAO: Record<string, number> = {
  lendario: 1000, epico: 200, raro: 50, incomum: 10, comum: 1,
};

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

const CATEGORIAS = ['anime', 'serie', 'filme', 'desenho', 'jogo', 'musica', 'outro'];

const COR_ABA: Record<string, string> = {
  geral: '#F59E0B',
  anime: '#EF4444', serie: '#3B82F6', filme: '#8B5CF6',
  desenho: '#EC4899', jogo: '#10B981', musica: '#F97316', outro: '#6B7280',
};

const MEDALHA_TEXTO = ['1°', '2°', '3°', '4°', '5°', '6°', '7°', '8°', '9°', '10°'];

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ─── Gera imagem do ranking ───────────────────────────────────────────────────
async function gerarImagemRanking(
  titulo: string,
  linhas: Array<{ pos: string; nome: string; pts: string; destaque?: boolean }>,
  cor: string,
): Promise<Buffer> {
  const W = 480;
  const HEADER = 72;
  const ROW = 46;
  const FOOTER = 36;
  const H = HEADER + ROW * linhas.length + FOOTER;

  const rows = linhas.map((l, i) => {
    const y = HEADER + ROW * i;
    const bg = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0)';
    const corPts = l.destaque ? cor : 'rgba(255,255,255,0.55)';
    const pesoNome = l.destaque ? 'bold' : 'normal';
    return `
      <rect x="0" y="${y}" width="${W}" height="${ROW}" fill="${bg}"/>
      <text x="18" y="${y + 29}" font-family="sans-serif" font-size="13" font-weight="bold" fill="${cor}">${xmlEsc(l.pos)}</text>
      <text x="56" y="${y + 29}" font-family="sans-serif" font-size="14" font-weight="${pesoNome}" fill="white">${xmlEsc(truncate(l.nome, 26))}</text>
      <text x="${W - 16}" y="${y + 29}" font-family="sans-serif" font-size="13" font-weight="bold" fill="${corPts}" text-anchor="end">${xmlEsc(l.pts)}</text>`;
  }).join('');

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" rx="14" fill="#0d0d0d"/>
    <rect width="${W}" height="${HEADER}" rx="14" fill="${cor}" fill-opacity="0.18"/>
    <rect x="0" y="${HEADER - 1}" width="${W}" height="1" fill="${cor}" fill-opacity="0.35"/>
    <text x="${W / 2}" y="45" font-family="sans-serif" font-size="17" font-weight="bold" fill="white" text-anchor="middle">${xmlEsc(titulo)}</text>
    ${rows}
    <rect x="0" y="${H - FOOTER}" width="${W}" height="${FOOTER}" fill="rgba(0,0,0,0.3)"/>
    <text x="${W / 2}" y="${H - 11}" font-family="sans-serif" font-size="10" fill="rgba(255,255,255,0.25)" text-anchor="middle">NOITADA • Ranking de Cartas</text>
    <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="none" stroke="${cor}" stroke-width="1.5" stroke-opacity="0.4"/>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ─── Dados do ranking geral ───────────────────────────────────────────────────
async function dadosRankingGeral(guild: any) {
  const { data: cartasUsuarios } = await supabase
    .from('cartas_usuarios')
    .select('discord_id, quantidade, carta:carta_id (raridade)');

  if (!cartasUsuarios?.length) return null;

  const map = new Map<string, number>();
  for (const cu of cartasUsuarios) {
    const carta = cu.carta as any;
    if (!carta) continue;
    map.set(cu.discord_id, (map.get(cu.discord_id) || 0) + (PESO_PONTUACAO[carta.raridade] || 1) * cu.quantidade);
  }

  const top = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const totalLend = cartasUsuarios.filter((cu: any) => cu.carta?.raridade === 'lendario').length;

  const linhas = await Promise.all(top.map(async ([id, pts], i) => {
    const m = await guild.members.fetch(id).catch(() => null);
    return {
      pos: MEDALHA_TEXTO[i],
      nome: m?.displayName || m?.user?.username || `#${id.slice(-4)}`,
      pts: pts.toLocaleString('pt-BR') + ' pts',
      destaque: i < 3,
    };
  }));

  return { titulo: '🏆 Ranking Geral — Top 10', linhas, rodape: `${totalLend} cartas lendárias em circulação` };
}

// ─── Dados do ranking por categoria ──────────────────────────────────────────
async function dadosRankingCategoria(categoria: string, guild: any) {
  const EMOJI: Record<string, string> = {
    anime: '🎌', serie: '📺', filme: '🎬', desenho: '🖼️', jogo: '🎮', musica: '🎵', outro: '🌀',
  };

  const { data: cartas } = await supabase.from('cartas').select('id, raridade').eq('categoria', categoria).eq('ativa', true);
  if (!cartas?.length) return null;

  const ids = cartas.map(c => c.id);
  const rarMap = new Map(cartas.map(c => [c.id, c.raridade]));

  const { data: cu } = await supabase.from('cartas_usuarios').select('discord_id, carta_id, quantidade').in('carta_id', ids);
  if (!cu?.length) return null;

  const map = new Map<string, { pts: number; total: number }>();
  for (const row of cu) {
    const rar = rarMap.get(row.carta_id);
    if (!rar) continue;
    const prev = map.get(row.discord_id) || { pts: 0, total: 0 };
    map.set(row.discord_id, { pts: prev.pts + (PESO_PONTUACAO[rar] || 1) * row.quantidade, total: prev.total + row.quantidade });
  }

  const top = [...map.entries()].sort((a, b) => b[1].pts - a[1].pts).slice(0, 10);

  const linhas = await Promise.all(top.map(async ([id, dados], i) => {
    const m = await guild.members.fetch(id).catch(() => null);
    return {
      pos: MEDALHA_TEXTO[i],
      nome: m?.displayName || m?.user?.username || `#${id.slice(-4)}`,
      pts: dados.pts.toLocaleString('pt-BR') + ' pts',
      destaque: i < 3,
    };
  }));

  const cap = categoria.charAt(0).toUpperCase() + categoria.slice(1);
  return { titulo: `${EMOJI[categoria] || ''} Ranking ${cap} — Top 10`, linhas, rodape: `${cartas.length} cartas de ${cap}` };
}

// ─── Comando ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName('ranking')
  .setDescription('Veja o ranking dos melhores colecionadores da NOITADA')
  .addStringOption(option =>
    option.setName('modo')
      .setDescription('Tipo de ranking')
      .setRequired(false)
      .addChoices(
        { name: '🏆 Geral', value: 'geral' },
        { name: '🎌 Anime', value: 'anime' },
        { name: '📺 Série', value: 'serie' },
        { name: '🎬 Filme', value: 'filme' },
        { name: '🖼️ Desenho', value: 'desenho' },
        { name: '🎮 Jogo', value: 'jogo' },
        { name: '🎵 Música', value: 'musica' },
        { name: '🌀 Outro', value: 'outro' },
      )
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  await interaction.deferReply();

  try {
    const guild = interaction.guild!;
    const abas = ['geral', ...CATEGORIAS];
    let abaAtual = abas.indexOf(interaction.options.getString('modo') || 'geral');
    if (abaAtual < 0) abaAtual = 0;

    const gerarResposta = async (indice: number) => {
      const aba = abas[indice];
      const cor = COR_ABA[aba] || '#F59E0B';

      const dados = aba === 'geral'
        ? await dadosRankingGeral(guild)
        : await dadosRankingCategoria(aba, guild);

      if (!dados || !dados.linhas.length) {
        return { content: '📭 Nenhum colecionador ainda nesta categoria.', files: [], components: [] };
      }

      const imgBuf = await gerarImagemRanking(dados.titulo, dados.linhas, cor);
      const attachment = new AttachmentBuilder(imgBuf, { name: `ranking-${aba}.png` });

      const emojiAbas: Record<string, string> = {
        geral: '🏆', anime: '🎌', serie: '📺', filme: '🎬',
        desenho: '🖼️', jogo: '🎮', musica: '🎵', outro: '🌀',
      };

      const linhas = [abas.slice(0, 4), abas.slice(4)];
      const components = linhas
        .filter(l => l.length > 0)
        .map(linha =>
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            linha.map(a =>
              new ButtonBuilder()
                .setCustomId(`ranking_${a}`)
                .setLabel(`${emojiAbas[a]} ${a.charAt(0).toUpperCase() + a.slice(1)}`)
                .setStyle(abas.indexOf(a) === indice ? ButtonStyle.Primary : ButtonStyle.Secondary)
            )
          )
        );

      return { content: '', files: [attachment], components };
    };

    const resposta = await gerarResposta(abaAtual);
    const msg = await interaction.editReply(resposta);

    const coletor = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: i => i.user.id === interaction.user.id,
    });

    coletor.on('collect', async (btn) => {
      abaAtual = abas.indexOf(btn.customId.replace('ranking_', ''));
      await btn.deferUpdate();
      const nova = await gerarResposta(abaAtual);
      await btn.editReply(nova);
    });

    coletor.on('end', async () => {
      await interaction.editReply({ components: [] }).catch(() => {});
    });

  } catch (err: any) {
    console.error('Erro no /ranking:', err);
    await interaction.editReply({ content: '❌ Erro ao carregar ranking.' });
  }
};

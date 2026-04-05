import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { supabase } from '../../lib/supabase';

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

const PESO_PONTUACAO: Record<string, number> = {
  lendario: 1000, epico: 200, raro: 50, incomum: 10, comum: 1,
};

const CATEGORIAS = ['anime', 'serie', 'filme', 'desenho', 'jogo', 'musica', 'outro'];

const MEDALHAS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

type ModoRanking = 'geral' | 'categoria';

export const data = new SlashCommandBuilder()
  .setName('ranking')
  .setDescription('Veja o ranking dos melhores colecionadores da NOITADA')
  .addStringOption(option =>
    option.setName('modo')
      .setDescription('Tipo de ranking')
      .setRequired(false)
      .addChoices(
        { name: '🏆 Geral (cartas mais raras)', value: 'geral' },
        { name: '🎌 Anime', value: 'anime' },
        { name: '📺 Série', value: 'serie' },
        { name: '🎬 Filme', value: 'filme' },
        { name: '🖼️ Desenho', value: 'desenho' },
        { name: '🎮 Jogo', value: 'jogo' },
        { name: '🎵 Música', value: 'musica' },
        { name: '🌀 Outro', value: 'outro' },
      )
  );

async function buscarRankingGeral(guild: any): Promise<EmbedBuilder> {
  // Busca todos os usuários e suas cartas com raridade
  const { data: cartasUsuarios } = await supabase
    .from('cartas_usuarios')
    .select(`
      discord_id, quantidade,
      carta:carta_id (raridade)
    `);

  if (!cartasUsuarios || cartasUsuarios.length === 0) {
    return new EmbedBuilder()
      .setColor('#8B5CF6')
      .setTitle('🏆 Ranking Geral — Top 10')
      .setDescription('Nenhum colecionador ainda. Use `/roll` para começar!');
  }

  // Calcula pontuação por usuário
  const pontuacaoPorUsuario = new Map<string, number>();

  for (const cu of cartasUsuarios) {
    const carta = cu.carta as any;
    if (!carta) continue;
    const pontos = (PESO_PONTUACAO[carta.raridade] || 1) * cu.quantidade;
    pontuacaoPorUsuario.set(
      cu.discord_id,
      (pontuacaoPorUsuario.get(cu.discord_id) || 0) + pontos
    );
  }

  // Ordena e pega top 10
  const ranking = [...pontuacaoPorUsuario.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Busca nomes dos usuários
  const linhas = await Promise.all(
    ranking.map(async ([discordId, pontos], index) => {
      try {
        const user = await guild.members.fetch(discordId).catch(() => null);
        const nome = user?.displayName || user?.user?.username || `Usuário ${discordId.slice(-4)}`;
        return `${MEDALHAS[index]} **${nome}** — ${pontos.toLocaleString()} pts`;
      } catch {
        return `${MEDALHAS[index]} **Usuário desconhecido** — ${pontos.toLocaleString()} pts`;
      }
    })
  );

  // Conta cartas lendárias totais no ranking
  const totalLendarios = cartasUsuarios.filter((cu: any) => cu.carta?.raridade === 'lendario').length;

  return new EmbedBuilder()
    .setColor('#F59E0B')
    .setTitle('🏆 Ranking Geral — Top 10 Colecionadores')
    .setDescription(linhas.join('\n') || 'Ninguém ainda!')
    .addFields({
      name: '📊 Pontuação',
      value: `🟡 Lendário = 1000pts | 🟣 Épico = 200pts | 🔵 Raro = 50pts | 🟢 Incomum = 10pts | ⚪ Comum = 1pt`,
    })
    .setFooter({ text: `${totalLendarios} cartas lendárias em circulação` })
    .setTimestamp();
}

async function buscarRankingCategoria(categoria: string, guild: any): Promise<EmbedBuilder> {
  const emojiCategoria: Record<string, string> = {
    anime: '🎌', serie: '📺', filme: '🎬',
    desenho: '🖼️', jogo: '🎮', musica: '🎵', outro: '🌀',
  };

  // Busca cartas da categoria específica
  const { data: cartas } = await supabase
    .from('cartas')
    .select('id, raridade')
    .eq('categoria', categoria)
    .eq('ativa', true);

  if (!cartas || cartas.length === 0) {
    return new EmbedBuilder()
      .setColor('#8B5CF6')
      .setTitle(`${emojiCategoria[categoria]} Ranking ${categoria} — Top 10`)
      .setDescription(`Nenhuma carta de ${categoria} cadastrada ainda.`);
  }

  const cartaIds = cartas.map(c => c.id);
  const cartaRaridade = new Map(cartas.map(c => [c.id, c.raridade]));

  // Busca usuários que têm cartas desta categoria
  const { data: cartasUsuarios } = await supabase
    .from('cartas_usuarios')
    .select('discord_id, carta_id, quantidade')
    .in('carta_id', cartaIds);

  if (!cartasUsuarios || cartasUsuarios.length === 0) {
    return new EmbedBuilder()
      .setColor('#8B5CF6')
      .setTitle(`${emojiCategoria[categoria]} Ranking ${categoria} — Top 10`)
      .setDescription('Ninguém tem cartas desta categoria ainda.');
  }

  // Calcula pontuação por usuário nesta categoria
  const pontuacaoPorUsuario = new Map<string, { pontos: number; total: number; raras: number }>();

  for (const cu of cartasUsuarios) {
    const raridade = cartaRaridade.get(cu.carta_id);
    if (!raridade) continue;
    const pontos = (PESO_PONTUACAO[raridade] || 1) * cu.quantidade;
    const atual = pontuacaoPorUsuario.get(cu.discord_id) || { pontos: 0, total: 0, raras: 0 };
    pontuacaoPorUsuario.set(cu.discord_id, {
      pontos: atual.pontos + pontos,
      total: atual.total + cu.quantidade,
      raras: atual.raras + (raridade === 'lendario' || raridade === 'epico' ? cu.quantidade : 0),
    });
  }

  const ranking = [...pontuacaoPorUsuario.entries()]
    .sort((a, b) => b[1].pontos - a[1].pontos)
    .slice(0, 10);

  const linhas = await Promise.all(
    ranking.map(async ([discordId, dados], index) => {
      try {
        const user = await guild.members.fetch(discordId).catch(() => null);
        const nome = user?.displayName || user?.user?.username || `Usuário ${discordId.slice(-4)}`;
        return `${MEDALHAS[index]} **${nome}** — ${dados.pontos.toLocaleString()} pts *(${dados.total} cartas, ${dados.raras} raras)*`;
      } catch {
        return `${MEDALHAS[index]} **Usuário desconhecido** — ${dados.pontos.toLocaleString()} pts`;
      }
    })
  );

  // Carta mais rara da categoria
  const cartaMaisRara = cartas
    .sort((a, b) => (PESO_PONTUACAO[b.raridade] || 0) - (PESO_PONTUACAO[a.raridade] || 0))[0];

  const { data: cartaDetalhes } = await supabase
    .from('cartas')
    .select('personagem, vinculo')
    .eq('id', cartaMaisRara.id)
    .single();

  return new EmbedBuilder()
    .setColor('#8B5CF6')
    .setTitle(`${emojiCategoria[categoria]} Ranking ${categoria.charAt(0).toUpperCase() + categoria.slice(1)} — Top 10`)
    .setDescription(linhas.join('\n') || 'Ninguém ainda!')
    .addFields({
      name: '👑 Carta mais rara desta categoria',
      value: cartaDetalhes
        ? `${EMOJI_RARIDADE[cartaMaisRara.raridade]} **${cartaDetalhes.personagem}** — ${cartaDetalhes.vinculo}`
        : 'Desconhecida',
    })
    .setFooter({ text: `${cartas.length} cartas cadastradas nesta categoria` })
    .setTimestamp();
}

export const execute = async (interaction: ChatInputCommandInteraction) => {
  await interaction.deferReply();

  try {
    const modo = interaction.options.getString('modo') || 'geral';
    const guild = interaction.guild!;

    const abas = ['geral', ...CATEGORIAS];
    let abaAtual = abas.indexOf(modo);
    if (abaAtual < 0) abaAtual = 0;

    const gerarEmbed = async (indice: number) => {
      const aba = abas[indice];
      if (aba === 'geral') return buscarRankingGeral(guild);
      return buscarRankingCategoria(aba, guild);
    };

    const gerarBotoes = (indice: number) => {
      const emojiAbas: Record<string, string> = {
        geral: '🏆', anime: '🎌', serie: '📺', filme: '🎬',
        desenho: '🖼️', jogo: '🎮', musica: '🎵', outro: '🌀',
      };

      // Divide as abas em duas linhas de 4 botões
      const linhas = [
        abas.slice(0, 4),
        abas.slice(4),
      ];

      return linhas
        .filter(linha => linha.length > 0)
        .map(linha =>
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            linha.map(aba =>
              new ButtonBuilder()
                .setCustomId(`ranking_${aba}`)
                .setLabel(`${emojiAbas[aba]} ${aba.charAt(0).toUpperCase() + aba.slice(1)}`)
                .setStyle(abas.indexOf(aba) === indice ? ButtonStyle.Primary : ButtonStyle.Secondary)
            )
          )
        );
    };

    const embedInicial = await gerarEmbed(abaAtual);
    const msg = await interaction.editReply({
      embeds: [embedInicial],
      components: gerarBotoes(abaAtual),
    });

    const coletor = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: i => i.user.id === interaction.user.id,
    });

    coletor.on('collect', async (btn) => {
      const novaAba = btn.customId.replace('ranking_', '');
      abaAtual = abas.indexOf(novaAba);

      await btn.deferUpdate();
      const novoEmbed = await gerarEmbed(abaAtual);
      await btn.editReply({ embeds: [novoEmbed], components: gerarBotoes(abaAtual) });
    });

    coletor.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch { }
    });

  } catch (error: any) {
    console.error('Erro no /ranking:', error);
    await interaction.editReply({ content: '❌ Erro ao carregar ranking.' });
  }
};
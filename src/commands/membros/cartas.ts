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

const EMOJI_GENERO: Record<string, string> = {
  masculino: '♂️', feminino: '♀️', outros: '⚧️',
};

const POR_PAGINA = 5;

export const data = new SlashCommandBuilder()
  .setName('cartas')
  .setDescription('Veja sua coleção de cartas')
  .addUserOption(option =>
    option.setName('membro')
      .setDescription('Ver coleção de outro membro (opcional)')
      .setRequired(false)
  )
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
      .setDescription('Filtrar por gênero do personagem (opcional)')
      .setRequired(false)
      .addChoices(
        { name: '♂️ Masculino', value: 'masculino' },
        { name: '♀️ Feminino', value: 'feminino' },
        { name: '⚧️ Outros', value: 'outros' },
      )
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  await interaction.deferReply();

  try {
    const membroAlvo = interaction.options.getUser('membro');
    const categoria = interaction.options.getString('categoria');
    const genero = interaction.options.getString('genero');
    const userId = membroAlvo?.id || interaction.user.id;
    const nomeExibicao = membroAlvo?.username || interaction.user.username;

    // Monta a query com join e filtros opcionais
    let query = supabase
      .from('cartas_usuarios')
      .select(`
        id, quantidade, obtida_em,
        carta:carta_id (
          id, nome, personagem, vinculo, categoria, raridade, imagem_url, genero
        )
      `)
      .eq('discord_id', userId)
      .order('obtida_em', { ascending: false });

    const { data: cartasUsuario, error } = await query;

    if (error) throw error;

    if (!cartasUsuario || cartasUsuario.length === 0) {
      await interaction.editReply({
        content: membroAlvo
          ? `❌ ${nomeExibicao} ainda não tem cartas. Use \`/spawn\` para conseguir!`
          : '❌ Você ainda não tem cartas. Use `/spawn` para conseguir a primeira!',
      });
      return;
    }

    // Filtra localmente por categoria e gênero se fornecidos
    const cartasFiltradas = cartasUsuario.filter((cu) => {
      const carta = cu.carta as any;
      if (!carta) return false;
      if (categoria && carta.categoria !== categoria) return false;
      if (genero && carta.genero !== genero) return false;
      return true;
    });

    if (cartasFiltradas.length === 0) {
      const filtros = [
        categoria ? `categoria **${categoria}**` : null,
        genero ? `gênero **${genero}**` : null,
      ].filter(Boolean).join(' e ');

      await interaction.editReply({
        content: `❌ Nenhuma carta encontrada com ${filtros} na coleção de ${nomeExibicao}.`,
      });
      return;
    }

    const totalCartas = cartasFiltradas.length;
    const totalPaginas = Math.ceil(totalCartas / POR_PAGINA);
    let paginaAtual = 0;

    const gerarEmbed = (pagina: number) => {
      const inicio = pagina * POR_PAGINA;
      const cartasPagina = cartasFiltradas.slice(inicio, inicio + POR_PAGINA);

      const linhas = cartasPagina.map((cu) => {
        const carta = cu.carta as any;
        const emoji = EMOJI_RARIDADE[carta.raridade] || '❔';
        const emojiGen = EMOJI_GENERO[carta.genero] || '⚧️';
        const dupla = cu.quantidade > 1 ? ` *(x${cu.quantidade})*` : '';
        return `${emoji}${emojiGen} **${carta.personagem}** — ${carta.vinculo}${dupla}`;
      });

      const titulo = [
        `🃏 Coleção de ${nomeExibicao}`,
        categoria ? ` • ${categoria}` : '',
        genero ? ` • ${EMOJI_GENERO[genero]} ${genero}` : '',
      ].join('');

      return new EmbedBuilder()
        .setColor('#8B5CF6')
        .setTitle(titulo)
        .setDescription(linhas.join('\n'))
        .setFooter({ text: `Página ${pagina + 1}/${totalPaginas} • ${totalCartas} carta(s) no total` })
        .setThumbnail(
          membroAlvo?.displayAvatarURL() || interaction.user.displayAvatarURL()
        )
        .setTimestamp();
    };

    const gerarBotoes = (pagina: number) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('anterior')
          .setLabel('◀ Anterior')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pagina === 0),
        new ButtonBuilder()
          .setCustomId('proximo')
          .setLabel('Próximo ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pagina >= totalPaginas - 1),
      );

    const mensagem = await interaction.editReply({
      embeds: [gerarEmbed(paginaAtual)],
      components: totalPaginas > 1 ? [gerarBotoes(paginaAtual)] : [],
    });

    if (totalPaginas <= 1) return;

    const coletor = mensagem.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: i => i.user.id === interaction.user.id,
    });

    coletor.on('collect', async i => {
      if (i.customId === 'anterior') paginaAtual--;
      if (i.customId === 'proximo') paginaAtual++;

      await i.update({
        embeds: [gerarEmbed(paginaAtual)],
        components: [gerarBotoes(paginaAtual)],
      });
    });

    coletor.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch { /* mensagem pode ter sido deletada */ }
    });

  } catch (error: any) {
    console.error('Erro no /cartas:', error);
    await interaction.editReply({ content: '❌ Erro ao buscar sua coleção.' });
  }
};
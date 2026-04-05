import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import { supabase } from '../../lib/supabase';

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

const POR_PAGINA = 5;

export const data = new SlashCommandBuilder()
  .setName('cartas')
  .setDescription('Veja sua coleção de cartas')
  .addUserOption(option =>
    option.setName('membro')
      .setDescription('Ver coleção de outro membro (opcional)')
      .setRequired(false)
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  await interaction.deferReply();

  try {
    const membroAlvo = interaction.options.getUser('membro');
    const userId = membroAlvo?.id || interaction.user.id;
    const nomeExibicao = membroAlvo?.username || interaction.user.username;

    // Busca cartas do usuário com join
    const { data: cartasUsuario, error } = await supabase
      .from('cartas_usuarios')
      .select(`
        id, quantidade, obtida_em,
        carta:carta_id (
          id, nome, personagem, vinculo, categoria, raridade, imagem_url
        )
      `)
      .eq('discord_id', userId)
      .order('obtida_em', { ascending: false });

    if (error) throw error;

    if (!cartasUsuario || cartasUsuario.length === 0) {
      await interaction.editReply({
        content: membroAlvo
          ? `❌ ${nomeExibicao} ainda não tem cartas. Use \`/roll\` para conseguir!`
          : '❌ Você ainda não tem cartas. Use `/roll` para conseguir a primeira!',
      });
      return;
    }

    const totalCartas = cartasUsuario.length;
    const totalPaginas = Math.ceil(totalCartas / POR_PAGINA);
    let paginaAtual = 0;

    const gerarEmbed = (pagina: number) => {
      const inicio = pagina * POR_PAGINA;
      const cartasPagina = cartasUsuario.slice(inicio, inicio + POR_PAGINA);

      const linhas = cartasPagina.map((cu, i) => {
        const carta = cu.carta as any;
        const emoji = EMOJI_RARIDADE[carta.raridade] || '❔';
        const dupla = cu.quantidade > 1 ? ` (x${cu.quantidade})` : '';
        return `${emoji} **${carta.personagem}** — ${carta.vinculo}${dupla}`;
      });

      return new EmbedBuilder()
        .setColor('#8B5CF6')
        .setTitle(`🃏 Coleção de ${nomeExibicao}`)
        .setDescription(linhas.join('\n'))
        .setFooter({ text: `Página ${pagina + 1}/${totalPaginas} • ${totalCartas} carta(s) no total` })
        .setThumbnail(`https://cdn.discordapp.com/avatars/${userId}/${membroAlvo?.avatar || interaction.user.avatar}.png`)
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

    // Coletor de interações dos botões — 2 minutos
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
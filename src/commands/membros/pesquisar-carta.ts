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

const COR_RARIDADE: Record<string, string> = {
  comum: '#9CA3AF', incomum: '#10B981', raro: '#3B82F6',
  epico: '#8B5CF6', lendario: '#F59E0B',
};

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

export const data = new SlashCommandBuilder()
  .setName('pesquisar-carta')
  .setDescription('Pesquisa uma carta da coleção NOITADA')
  .addStringOption(option =>
    option.setName('tipo')
      .setDescription('O que deseja pesquisar?')
      .setRequired(true)
      .addChoices(
        { name: '🔎 Nome da carta', value: 'nome' },
        { name: '🧑 Personagem', value: 'personagem' },
        { name: '🔗 Vínculo (anime, filme...)', value: 'vinculo' },
      )
  )
  .addStringOption(option =>
    option.setName('busca')
      .setDescription('Digite o que deseja pesquisar')
      .setRequired(true)
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  await interaction.deferReply();

  try {
    const tipo = interaction.options.getString('tipo', true);
    const busca = interaction.options.getString('busca', true);

    let query = supabase
      .from('cartas')
      .select('*')
      .eq('ativa', true);

    if (tipo === 'nome') query = query.ilike('nome', `%${busca}%`);
    else if (tipo === 'personagem') query = query.ilike('personagem', `%${busca}%`);
    else if (tipo === 'vinculo') query = query.ilike('vinculo', `%${busca}%`);

    const { data: cartas, error } = await query.limit(20);

    if (error) throw error;

    if (!cartas || cartas.length === 0) {
      await interaction.editReply({ content: `❌ Nenhuma carta encontrada para **${busca}**.` });
      return;
    }

    let index = 0;

    const gerarEmbed = (i: number) => {
      const carta = cartas[i];
      const embed = new EmbedBuilder()
        .setColor(COR_RARIDADE[carta.raridade] as any)
        .setTitle(`${EMOJI_RARIDADE[carta.raridade]} ${carta.personagem}`)
        .addFields(
          { name: '📖 Vínculo', value: carta.vinculo, inline: true },
          { name: '🏷️ Categoria', value: carta.categoria, inline: true },
          { name: '✨ Raridade', value: carta.raridade.charAt(0).toUpperCase() + carta.raridade.slice(1), inline: true },
        )
        .setFooter({ text: `Resultado ${i + 1} de ${cartas.length} • ${carta.nome}` })
        .setTimestamp();

      if (carta.descricao) embed.setDescription(carta.descricao);
      if (carta.imagem_url) embed.setImage(carta.imagem_url);

      return embed;
    };

    const gerarBotoes = (i: number) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('anterior')
          .setLabel('◀')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(i === 0),
        new ButtonBuilder()
          .setCustomId('proximo')
          .setLabel('▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(i >= cartas.length - 1),
      );

    const mensagem = await interaction.editReply({
      embeds: [gerarEmbed(index)],
      components: cartas.length > 1 ? [gerarBotoes(index)] : [],
    });

    if (cartas.length <= 1) return;

    const coletor = mensagem.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: i => i.user.id === interaction.user.id,
    });

    coletor.on('collect', async i => {
      if (i.customId === 'anterior') index--;
      if (i.customId === 'proximo') index++;
      await i.update({ embeds: [gerarEmbed(index)], components: [gerarBotoes(index)] });
    });

    coletor.on('end', async () => {
      try { await interaction.editReply({ components: [] }); } catch { }
    });

  } catch (error: any) {
    console.error('Erro no /carta:', error);
    await interaction.editReply({ content: '❌ Erro ao pesquisar carta.' });
  }
};
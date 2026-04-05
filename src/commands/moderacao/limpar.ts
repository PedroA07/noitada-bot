import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder,
  PermissionFlagsBits,
  TextChannel,
  MessageFlags,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('limpar')
  .setDescription('Apaga uma quantidade de mensagens do canal atual')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption(option =>
    option.setName('quantidade')
      .setDescription('Quantas mensagens apagar? (1 a 100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100)
  )
  .addUserOption(option =>
    option.setName('membro')
      .setDescription('Apagar mensagens apenas deste membro (opcional)')
      .setRequired(false)
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  // Verifica se o canal é um TextChannel
  const canal = interaction.channel as TextChannel;
  if (!canal || !canal.bulkDelete) {
    await interaction.reply({
      content: '❌ Este comando só funciona em canais de texto.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Verifica se o bot tem permissão para apagar mensagens
  const botMember = interaction.guild?.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: '❌ Não tenho permissão para apagar mensagens neste canal.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const quantidade = interaction.options.getInteger('quantidade', true);
  const membroAlvo = interaction.options.getUser('membro');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Busca as mensagens (máx 100, Discord não permite mais de 14 dias)
    const mensagens = await canal.messages.fetch({ limit: 100 });

    // Filtra por membro se informado
    const filtradas = membroAlvo
      ? mensagens.filter(m => m.author.id === membroAlvo.id)
      : mensagens;

    // Pega apenas a quantidade solicitada
    const paraApagar = [...filtradas.values()].slice(0, quantidade);

    if (paraApagar.length === 0) {
      await interaction.editReply({
        content: membroAlvo
          ? `❌ Nenhuma mensagem recente de ${membroAlvo.username} encontrada.`
          : '❌ Nenhuma mensagem encontrada para apagar.',
      });
      return;
    }

    // Filtra mensagens com menos de 14 dias (limitação do Discord)
    const limiteDias = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const validas = paraApagar.filter(m => m.createdTimestamp > limiteDias);
    const antigas = paraApagar.length - validas.length;

    let apagadas = 0;

    if (validas.length > 0) {
      if (validas.length === 1) {
        // bulkDelete não funciona com 1 mensagem
        await validas[0].delete();
        apagadas = 1;
      } else {
        const resultado = await canal.bulkDelete(validas, true);
        apagadas = resultado.size;
      }
    }

    // Monta resposta
    const embed = new EmbedBuilder()
      .setColor('#8B5CF6')
      .setTitle('🧹 Mensagens Apagadas')
      .setDescription(
        [
          `✅ **${apagadas}** mensagem(ns) apagada(s) com sucesso.`,
          membroAlvo ? `👤 **Filtro:** Mensagens de ${membroAlvo.username}` : '',
          antigas > 0 ? `⚠️ **${antigas}** mensagem(ns) ignorada(s) por ter mais de 14 dias.` : '',
        ]
          .filter(Boolean)
          .join('\n')
      )
      .setFooter({ 
        text: `Ação realizada por ${interaction.user.username}`,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Log no console
    console.log(
      `🧹 ${interaction.user.tag} apagou ${apagadas} mensagem(ns) em #${canal.name}` +
      (membroAlvo ? ` (filtro: ${membroAlvo.tag})` : '')
    );

  } catch (error: any) {
    console.error('❌ Erro ao apagar mensagens:', error);
    await interaction.editReply({
      content: `❌ Erro ao apagar mensagens: ${error.message}`,
    });
  }
};
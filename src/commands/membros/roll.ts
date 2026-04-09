import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { supabase } from '../../lib/supabase';

export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Ganhe capturas extras assistindo um anúncio!');

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Verifica quantos rolls extras já tem hoje
    const hoje = new Date().toDateString();
    const { data: capturaDiaria } = await supabase
      .from('capturas_diarias')
      .select('rolls_extras')
      .eq('discord_id', userId)
      .eq('guild_id', guildId)
      .gte('data_reset', hoje)
      .maybeSingle();

    const rollsExtras = capturaDiaria?.rolls_extras || 0;
    const MAX_ROLLS_DIA = 5; // máximo de rolls extras por dia

    if (rollsExtras >= MAX_ROLLS_DIA) {
      await interaction.editReply({
        content: `❌ Você já usou todos os seus **${MAX_ROLLS_DIA} rolls extras** de hoje!\n\nVolte amanhã para mais. 🌙`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#F59E0B')
      .setTitle('🎲 Roll Extra')
      .setDescription(
        [
          `Você tem **${rollsExtras}/${MAX_ROLLS_DIA}** rolls extras usados hoje.`,
          '',
          '📺 Assista um anúncio para ganhar **+1 captura extra** agora!',
          '',
          '> Isso permite capturar uma carta além do seu limite diário.',
        ].join('\n')
      )
      .setFooter({ text: 'NOITADA • Sistema de Rolls' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`assistir_ad_${userId}`)
        .setLabel('📺 Assistir Anúncio')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`cancelar_roll_${userId}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary),
    );

    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    const collector = msg.createMessageComponentCollector({
      time: 120_000,
    });

    collector.on('collect', async (btn) => {
      const [acao, , donoId] = btn.customId.split('_');

      if (btn.user.id !== donoId) {
        await btn.reply({ content: '❌ Esse roll não é seu!', flags: MessageFlags.Ephemeral });
        return;
      }

      await btn.deferUpdate();

      if (acao === 'cancelar') {
        await interaction.editReply({ content: '❌ Roll cancelado.', embeds: [], components: [] });
        collector.stop();
        return;
      }

      // Simula o fluxo de ad (na prática, o app mobile/web confirma via API)
      // Aqui no bot, confiamos no clique — em produção, o mobile chama uma API
      // que valida o ad completion e só aí libera o roll
      const embedProcessando = new EmbedBuilder()
        .setColor('#F59E0B')
        .setTitle('⏳ Processando...')
        .setDescription('Confirmando seu anúncio...');

      await interaction.editReply({ embeds: [embedProcessando], components: [] });

      // Incrementa rolls_extras
      const { data: capturaDiariaAtual } = await supabase
        .from('capturas_diarias')
        .select('*')
        .eq('discord_id', userId)
        .eq('guild_id', guildId)
        .gte('data_reset', hoje)
        .maybeSingle();

      if (capturaDiariaAtual) {
        await supabase
          .from('capturas_diarias')
          .update({ rolls_extras: (capturaDiariaAtual.rolls_extras || 0) + 1 })
          .eq('id', capturaDiariaAtual.id);
      } else {
        await supabase
          .from('capturas_diarias')
          .insert({
            discord_id: userId,
            guild_id: guildId,
            data_reset: new Date().toISOString(),
            total_capturas: 0,
            rolls_extras: 1,
          });
      }

      const embedSucesso = new EmbedBuilder()
        .setColor('#22c55e')
        .setTitle('✅ Roll Extra Liberado!')
        .setDescription(
          [
            '🎉 Você ganhou **+1 captura extra** para hoje!',
            '',
            `Agora você tem **${rollsExtras + 1}/${MAX_ROLLS_DIA}** rolls extras usados.`,
            '',
            'Use `/spawn` para capturar uma carta! 🃏',
          ].join('\n')
        );

      await interaction.editReply({ embeds: [embedSucesso], components: [] });
      collector.stop();
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        await interaction.editReply({
          content: '⏰ Tempo esgotado.',
          embeds: [],
          components: [],
        }).catch(() => {});
      }
    });

  } catch (error: any) {
    console.error('Erro no /roll:', error);
    await interaction.editReply({ content: '❌ Erro. Tente novamente!' });
  }
};
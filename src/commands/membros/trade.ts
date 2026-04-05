import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from 'discord.js';
import { supabase } from '../../lib/supabase';

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

async function buscarCartasUsuario(discordId: string) {
  const { data } = await supabase
    .from('cartas_usuarios')
    .select(`
      id, quantidade,
      carta:carta_id (id, nome, personagem, vinculo, raridade)
    `)
    .eq('discord_id', discordId)
    .order('obtida_em', { ascending: false });

  return data || [];
}

export const data = new SlashCommandBuilder()
  .setName('trade')
  .setDescription('Propõe uma troca de cartas com outro membro')
  .addUserOption(option =>
    option.setName('membro')
      .setDescription('Com quem você quer trocar?')
      .setRequired(true)
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const proponente = interaction.user;
  const alvo = interaction.options.getUser('membro', true);

  // Validações básicas
  if (alvo.bot) {
    await interaction.reply({ content: '❌ Você não pode trocar cartas com um bot!', flags: MessageFlags.Ephemeral });
    return;
  }

  if (alvo.id === proponente.id) {
    await interaction.reply({ content: '❌ Você não pode trocar cartas consigo mesmo!', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();

  try {
    // Busca cartas de ambos os usuários
    const [cartasProponente, cartasAlvo] = await Promise.all([
      buscarCartasUsuario(proponente.id),
      buscarCartasUsuario(alvo.id),
    ]);

    if (cartasProponente.length === 0) {
      await interaction.editReply({ content: '❌ Você não tem cartas para oferecer na troca.' });
      return;
    }

    if (cartasAlvo.length === 0) {
      await interaction.editReply({ content: `❌ ${alvo.username} não tem cartas ainda.` });
      return;
    }

    // Estado da troca
    let cartasEscolhidasProponente: string[] = [];
    let cartasEscolhidasAlvo: string[] = [];

    // ─── ETAPA 1: Proponente escolhe suas cartas ───────────────────────
    const opcoesProponente = cartasProponente.slice(0, 25).map((cu: any) => {
      const carta = cu.carta;
      return new StringSelectMenuOptionBuilder()
        .setLabel(`${EMOJI_RARIDADE[carta.raridade]} ${carta.personagem}`)
        .setDescription(`${carta.vinculo} ${cu.quantidade > 1 ? `(x${cu.quantidade})` : ''}`)
        .setValue(carta.id);
    });

    const menuProponente = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('selecionar_proponente')
        .setPlaceholder('Selecione as cartas que quer oferecer (ou nenhuma)')
        .setMinValues(0)
        .setMaxValues(Math.min(opcoesProponente.length, 10))
        .addOptions(opcoesProponente)
    );

    const botoesEtapa1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('confirmar_etapa1')
        .setLabel('Confirmar seleção →')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('cancelar_trade')
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger),
    );

    const embedEtapa1 = new EmbedBuilder()
      .setColor('#8B5CF6')
      .setTitle('🔄 Nova Troca — Etapa 1/3')
      .setDescription(
        `**${proponente.username}** quer trocar cartas com **${alvo.username}**!\n\n` +
        `📤 **${proponente.username}**, selecione as cartas que quer **oferecer**.\n` +
        `*(Pode não selecionar nenhuma se quiser pedir sem oferecer)*`
      )
      .setFooter({ text: '⏰ Você tem 2 minutos para responder' });

    const msgTrade = await interaction.editReply({
      embeds: [embedEtapa1],
      components: [menuProponente, botoesEtapa1],
    });

    // Coletor etapa 1 — somente o proponente
    const coletorEtapa1 = msgTrade.createMessageComponentCollector({
      time: 120_000,
      filter: i => i.user.id === proponente.id,
    });

    let etapa1Confirmada = false;

    coletorEtapa1.on('collect', async (i) => {
      if (i.customId === 'cancelar_trade') {
        coletorEtapa1.stop('cancelado');
        await i.update({
          embeds: [new EmbedBuilder().setColor('#EF4444').setTitle('❌ Troca cancelada')],
          components: [],
        });
        return;
      }

      if (i.isStringSelectMenu() && i.customId === 'selecionar_proponente') {
        cartasEscolhidasProponente = i.values;
        await i.deferUpdate();
        return;
      }

      if (i.customId === 'confirmar_etapa1') {
        etapa1Confirmada = true;
        coletorEtapa1.stop('confirmado');

        // ─── ETAPA 2: Alvo escolhe suas cartas ───────────────────────
        const opcoesAlvo = cartasAlvo.slice(0, 25).map((cu: any) => {
          const carta = cu.carta;
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${EMOJI_RARIDADE[carta.raridade]} ${carta.personagem}`)
            .setDescription(`${carta.vinculo} ${cu.quantidade > 1 ? `(x${cu.quantidade})` : ''}`)
            .setValue(carta.id);
        });

        // Monta resumo das cartas oferecidas pelo proponente
        const cartasOferecidasTexto = cartasEscolhidasProponente.length > 0
          ? cartasProponente
              .filter((cu: any) => cartasEscolhidasProponente.includes(cu.carta.id))
              .map((cu: any) => `${EMOJI_RARIDADE[cu.carta.raridade]} ${cu.carta.personagem}`)
              .join('\n')
          : '*Nenhuma carta (pedindo sem oferecer)*';

        const menuAlvo = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('selecionar_alvo')
            .setPlaceholder('Selecione as cartas que quer dar em troca (ou nenhuma)')
            .setMinValues(0)
            .setMaxValues(Math.min(opcoesAlvo.length, 10))
            .addOptions(opcoesAlvo)
        );

        const botoesEtapa2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('confirmar_etapa2')
            .setLabel('Confirmar seleção →')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('recusar_trade')
            .setLabel('Recusar troca')
            .setStyle(ButtonStyle.Danger),
        );

        const embedEtapa2 = new EmbedBuilder()
          .setColor('#8B5CF6')
          .setTitle('🔄 Troca — Etapa 2/3')
          .setDescription(
            `${alvo}, você recebeu uma proposta de troca de **${proponente.username}**!\n\n` +
            `**📤 ${proponente.username} está oferecendo:**\n${cartasOferecidasTexto}\n\n` +
            `📥 **${alvo.username}**, selecione as cartas que quer dar em troca.\n` +
            `*(Pode não selecionar nenhuma)*`
          )
          .setFooter({ text: '⏰ Você tem 2 minutos para responder' });

        await i.update({
          embeds: [embedEtapa2],
          components: [menuAlvo, botoesEtapa2],
        });

        // Coletor etapa 2 — somente o alvo
        const coletorEtapa2 = msgTrade.createMessageComponentCollector({
          time: 120_000,
          filter: j => j.user.id === alvo.id,
        });

        coletorEtapa2.on('collect', async (j) => {
          if (j.customId === 'recusar_trade') {
            coletorEtapa2.stop('recusado');
            await j.update({
              embeds: [
                new EmbedBuilder()
                  .setColor('#EF4444')
                  .setTitle('❌ Troca recusada')
                  .setDescription(`**${alvo.username}** recusou a proposta de troca.`),
              ],
              components: [],
            });
            return;
          }

          if (j.isStringSelectMenu() && j.customId === 'selecionar_alvo') {
            cartasEscolhidasAlvo = j.values;
            await j.deferUpdate();
            return;
          }

          if (j.customId === 'confirmar_etapa2') {
            coletorEtapa2.stop('confirmado');

            // ─── ETAPA 3: Proponente confirma a troca final ─────────
            const cartasAlvoTexto = cartasEscolhidasAlvo.length > 0
              ? cartasAlvo
                  .filter((cu: any) => cartasEscolhidasAlvo.includes(cu.carta.id))
                  .map((cu: any) => `${EMOJI_RARIDADE[cu.carta.raridade]} ${cu.carta.personagem}`)
                  .join('\n')
              : '*Nenhuma carta*';

            const botoesEtapa3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId('aceitar_trade_final')
                .setLabel('✅ Aceitar Troca')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId('cancelar_trade_final')
                .setLabel('❌ Cancelar')
                .setStyle(ButtonStyle.Danger),
            );

            const embedEtapa3 = new EmbedBuilder()
              .setColor('#F59E0B')
              .setTitle('🔄 Troca — Etapa 3/3 — Confirmação Final')
              .setDescription(
                `${proponente}, revise a proposta de troca:\n\n` +
                `**📤 Você dará para ${alvo.username}:**\n${cartasOferecidasTexto}\n\n` +
                `**📥 Você receberá de ${alvo.username}:**\n${cartasAlvoTexto}\n\n` +
                `**Aceita esta troca?**`
              )
              .setFooter({ text: '⏰ Você tem 1 minuto para confirmar' });

            await j.update({
              embeds: [embedEtapa3],
              components: [botoesEtapa3],
            });

            // Coletor etapa 3 — somente o proponente
            const coletorEtapa3 = msgTrade.createMessageComponentCollector({
              time: 60_000,
              filter: k => k.user.id === proponente.id,
              max: 1,
            });

            coletorEtapa3.on('collect', async (k) => {
              if (k.customId === 'cancelar_trade_final') {
                await k.update({
                  embeds: [
                    new EmbedBuilder()
                      .setColor('#EF4444')
                      .setTitle('❌ Troca cancelada')
                      .setDescription(`**${proponente.username}** cancelou a troca.`),
                  ],
                  components: [],
                });
                return;
              }

              if (k.customId === 'aceitar_trade_final') {
                try {
                  // ─── Executa a troca ─────────────────────────────
                  // Remove cartas do proponente e dá para o alvo
                  for (const cartaId of cartasEscolhidasProponente) {
                    const cuProponente = cartasProponente.find((cu: any) => cu.carta.id === cartaId) as any;
                    if (!cuProponente) continue;

                    if (cuProponente.quantidade > 1) {
                      await supabase.from('cartas_usuarios')
                        .update({ quantidade: cuProponente.quantidade - 1 })
                        .eq('id', cuProponente.id);
                    } else {
                      await supabase.from('cartas_usuarios').delete().eq('id', cuProponente.id);
                    }

                    // Dá para o alvo
                    const { data: jaTemAlvo } = await supabase
                      .from('cartas_usuarios')
                      .select('id, quantidade')
                      .eq('discord_id', alvo.id)
                      .eq('carta_id', cartaId)
                      .maybeSingle();

                    if (jaTemAlvo) {
                      await supabase.from('cartas_usuarios')
                        .update({ quantidade: jaTemAlvo.quantidade + 1 })
                        .eq('id', jaTemAlvo.id);
                    } else {
                      await supabase.from('cartas_usuarios')
                        .insert({ discord_id: alvo.id, carta_id: cartaId });
                    }
                  }

                  // Remove cartas do alvo e dá para o proponente
                  for (const cartaId of cartasEscolhidasAlvo) {
                    const cuAlvo = cartasAlvo.find((cu: any) => cu.carta.id === cartaId) as any;
                    if (!cuAlvo) continue;

                    if (cuAlvo.quantidade > 1) {
                      await supabase.from('cartas_usuarios')
                        .update({ quantidade: cuAlvo.quantidade - 1 })
                        .eq('id', cuAlvo.id);
                    } else {
                      await supabase.from('cartas_usuarios').delete().eq('id', cuAlvo.id);
                    }

                    // Dá para o proponente
                    const { data: jaTemProponente } = await supabase
                      .from('cartas_usuarios')
                      .select('id, quantidade')
                      .eq('discord_id', proponente.id)
                      .eq('carta_id', cartaId)
                      .maybeSingle();

                    if (jaTemProponente) {
                      await supabase.from('cartas_usuarios')
                        .update({ quantidade: jaTemProponente.quantidade + 1 })
                        .eq('id', jaTemProponente.id);
                    } else {
                      await supabase.from('cartas_usuarios')
                        .insert({ discord_id: proponente.id, carta_id: cartaId });
                    }
                  }

                  await k.update({
                    embeds: [
                      new EmbedBuilder()
                        .setColor('#10B981')
                        .setTitle('✅ Troca realizada com sucesso!')
                        .setDescription(
                          `**${proponente.username}** e **${alvo.username}** concluíram a troca!\n\n` +
                          `📤 **${proponente.username}** deu: ${cartasOferecidasTexto}\n` +
                          `📥 **${alvo.username}** deu: ${cartasAlvoTexto}`
                        )
                        .setTimestamp(),
                    ],
                    components: [],
                  });

                } catch (error: any) {
                  console.error('Erro ao executar troca:', error);
                  await k.update({
                    embeds: [
                      new EmbedBuilder()
                        .setColor('#EF4444')
                        .setTitle('❌ Erro na troca')
                        .setDescription('Ocorreu um erro ao processar a troca. Tente novamente.'),
                    ],
                    components: [],
                  });
                }
              }
            });

            coletorEtapa3.on('end', async (collected) => {
              if (collected.size === 0) {
                try {
                  await msgTrade.edit({
                    embeds: [
                      new EmbedBuilder()
                        .setColor('#6B7280')
                        .setTitle('⏰ Troca expirada')
                        .setDescription(`**${proponente.username}** não confirmou a tempo.`),
                    ],
                    components: [],
                  });
                } catch { }
              }
            });
          }
        });

        coletorEtapa2.on('end', async (collected, reason) => {
          if (reason === 'time') {
            try {
              await msgTrade.edit({
                embeds: [
                  new EmbedBuilder()
                    .setColor('#6B7280')
                    .setTitle('⏰ Troca expirada')
                    .setDescription(`**${alvo.username}** não respondeu a tempo.`),
                ],
                components: [],
              });
            } catch { }
          }
        });
      }
    });

    coletorEtapa1.on('end', async (collected, reason) => {
      if (reason === 'time' && !etapa1Confirmada) {
        try {
          await msgTrade.edit({
            embeds: [
              new EmbedBuilder()
                .setColor('#6B7280')
                .setTitle('⏰ Troca expirada')
                .setDescription(`**${proponente.username}** não selecionou as cartas a tempo.`),
            ],
            components: [],
          });
        } catch { }
      }
    });

  } catch (error: any) {
    console.error('Erro no /trade:', error);
    await interaction.editReply({ content: '❌ Erro ao iniciar troca. Tente novamente!' });
  }
};
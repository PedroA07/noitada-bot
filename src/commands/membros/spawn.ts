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

const COR_RARIDADE: Record<string, string> = {
  comum: '#9CA3AF', incomum: '#10B981', raro: '#3B82F6',
  epico: '#8B5CF6', lendario: '#F59E0B',
};

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

const EMOJI_GENERO: Record<string, string> = {
  masculino: '♂️', feminino: '♀️', outros: '⚧️',
};

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
  // Busca config do cargo
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
  const pesos: Record<string, number> = {
    comum: 50, incomum: 25, raro: 15, epico: 7, lendario: 3,
  };

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
    const peso = pesos[carta.raridade] || 10;
    for (let i = 0; i < peso; i++) pool.push(carta);
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const categoria = interaction.options.getString('categoria');
  const genero = interaction.options.getString('genero');

  const member = interaction.guild?.members.cache.get(userId)
    || await interaction.guild?.members.fetch(userId).catch(() => null);
  const cargoIds = member ? [...member.roles.cache.keys()] : [];

  await interaction.deferReply();

  try {
    const verificacao = await verificarCaptura(userId, guildId, cargoIds);
    if (!verificacao.pode) {
      await interaction.editReply({ content: verificacao.motivo });
      return;
    }

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

    const embed = new EmbedBuilder()
      .setColor(COR_RARIDADE[carta.raridade] as any)
      .setTitle(`${EMOJI_RARIDADE[carta.raridade]} ${carta.personagem}`)
      .setDescription(
        [
          `📖 **Vínculo:** ${carta.vinculo}`,
          `🏷️ **Categoria:** ${carta.categoria}`,
          `${EMOJI_GENERO[carta.genero]} **Gênero:** ${carta.genero.charAt(0).toUpperCase() + carta.genero.slice(1)}`,
          `✨ **Raridade:** ${carta.raridade.charAt(0).toUpperCase() + carta.raridade.slice(1)}`,
          carta.descricao ? `\n${carta.descricao}` : '',
          '\n🖐️ **Clique em Capturar para pegar essa carta!**',
        ].filter(Boolean).join('\n')
      )
      .setFooter({
        text: `${interaction.user.username} • Você tem ${(await supabase
          .from('capturas_diarias')
          .select('total_capturas, rolls_extras')
          .eq('discord_id', userId)
          .eq('guild_id', guildId)
          .gte('data_reset', new Date().toDateString())
          .maybeSingle()).data?.total_capturas || 0}/${verificacao.capturasDiarias} capturas hoje`,
        iconURL: interaction.user.displayAvatarURL(),
      })
      .setTimestamp();

    if (carta.imagem_url) embed.setImage(carta.imagem_url);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`capturar_${carta.id}_${userId}`)
        .setLabel('🖐️ Capturar!')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ignorar_${carta.id}_${userId}`)
        .setLabel('❌ Ignorar')
        .setStyle(ButtonStyle.Secondary),
    );

    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

    // Collector — 60s para capturar
    const collector = msg.createMessageComponentCollector({
      time: 60_000,
    });

    collector.on('collect', async (btn) => {
      const [acao, cartaId, donoId] = btn.customId.split('_');

      if (btn.user.id !== donoId) {
        await btn.reply({ content: '❌ Essa carta não é para você!', flags: MessageFlags.Ephemeral });
        return;
      }

      await btn.deferUpdate();

      if (acao === 'ignorar') {
        await interaction.editReply({
          content: '❌ Carta ignorada.',
          embeds: [],
          components: [],
        });
        collector.stop();
        return;
      }

      // Capturar
      const { data: jaTemCarta } = await supabase
        .from('cartas_usuarios')
        .select('id, quantidade')
        .eq('discord_id', userId)
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
          .insert({ discord_id: userId, carta_id: cartaId });
      }

      // Registra captura diária
      const hoje = new Date().toDateString();
      const agora = new Date().toISOString();
      const { data: capturaDiaria } = await supabase
        .from('capturas_diarias')
        .select('*')
        .eq('discord_id', userId)
        .eq('guild_id', guildId)
        .gte('data_reset', hoje)
        .maybeSingle();

      if (capturaDiaria) {
        await supabase
          .from('capturas_diarias')
          .update({ total_capturas: capturaDiaria.total_capturas + 1, ultima_captura: agora })
          .eq('id', capturaDiaria.id);
      } else {
        await supabase
          .from('capturas_diarias')
          .insert({ discord_id: userId, guild_id: guildId, data_reset: agora, total_capturas: 1, ultima_captura: agora });
      }

      const embedCapturada = EmbedBuilder.from(embed)
        .setTitle(`✅ ${carta.personagem} capturada!`)
        .setDescription(
          jaTemCarta
            ? `🔄 Você já tinha essa carta! Agora tem **${jaTemCarta.quantidade + 1}x**.`
            : '🆕 **Nova carta adicionada à sua coleção!**'
        )
        .setColor('#22c55e');

      await interaction.editReply({ embeds: [embedCapturada], components: [] });
      collector.stop();
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        await interaction.editReply({
          content: '⏰ Tempo esgotado! A carta fugiu...',
          embeds: [],
          components: [],
        }).catch(() => {});
      }
    });

  } catch (error: any) {
    console.error('Erro no /spawn:', error);
    await interaction.editReply({ content: '❌ Erro ao spawnar carta. Tente novamente!' });
  }
};
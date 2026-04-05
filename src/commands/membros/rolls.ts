import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
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

export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Sorteia carta(s) aleatória(s) da coleção NOITADA')
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
  );

// Busca a configuração mais generosa para os cargos do usuário
async function buscarConfigUsuario(guildId: string, cargoIds: string[]) {
  const { data: configs } = await supabase
    .from('configuracoes_roll')
    .select('*')
    .eq('guild_id', guildId)
    .in('cargo_id', cargoIds);

  if (!configs || configs.length === 0) return null;

  // Retorna a config com mais cartas por roll (mais generosa)
  return configs.reduce((melhor, atual) =>
    atual.cartas_por_roll > melhor.cartas_por_roll ? atual : melhor
  );
}

// Verifica cooldown e limite de rolls no banco
async function verificarCooldown(
  userId: string,
  guildId: string,
  config: any
): Promise<{ pode: boolean; mensagem?: string }> {
  const cooldownMs = config.cooldown_unidade === 'horas'
    ? config.cooldown_valor * 60 * 60 * 1000
    : config.cooldown_valor * 60 * 1000;

  const desde = new Date(Date.now() - cooldownMs).toISOString();

  const { data: usos } = await supabase
    .from('rolls_usuarios')
    .select('id, usado_em')
    .eq('discord_id', userId)
    .eq('guild_id', guildId)
    .gte('usado_em', desde)
    .order('usado_em', { ascending: false });

  if (!usos || usos.length === 0) return { pode: true };

  // Verifica limite de rolls no período
  if (usos.length >= config.rolls_por_periodo) {
    const maisAntigo = new Date(usos[usos.length - 1].usado_em);
    const liberaEm = new Date(maisAntigo.getTime() + cooldownMs);
    const restanteMs = liberaEm.getTime() - Date.now();
    const restanteMin = Math.ceil(restanteMs / 60000);
    const restanteHora = Math.floor(restanteMin / 60);
    const restanteSeg = Math.ceil((restanteMs % 60000) / 1000);

    let textoEspera = '';
    if (restanteHora > 0) textoEspera = `${restanteHora}h ${restanteMin % 60}min`;
    else if (restanteMin > 1) textoEspera = `${restanteMin} minutos`;
    else textoEspera = `${restanteSeg} segundos`;

    return {
      pode: false,
      mensagem: `⏳ Você usou todos os **${config.rolls_por_periodo} rolls** do período!\nPróximo roll disponível em **${textoEspera}**.`,
    };
  }

  return { pode: true };
}

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const userId = interaction.user.id;
  const guildId = process.env.DISCORD_GUILD_ID!;
  const member = interaction.guild?.members.cache.get(userId)
    || await interaction.guild?.members.fetch(userId).catch(() => null);

  await interaction.deferReply();

  try {
    const categoria = interaction.options.getString('categoria');

    // Busca configuração baseada nos cargos do usuário
    const cargoIds = member ? [...member.roles.cache.keys()] : [];
    const config = await buscarConfigUsuario(guildId, cargoIds);

    // Config padrão se não houver nenhuma configurada
    const configFinal = config || {
      cooldown_valor: 30,
      cooldown_unidade: 'minutos',
      rolls_por_periodo: 5,
      cartas_por_roll: 1,
    };

    // Verifica se pode rolar
    const verificacao = await verificarCooldown(userId, guildId, configFinal);
    if (!verificacao.pode) {
      await interaction.editReply({ content: verificacao.mensagem });
      return;
    }

    // Busca cartas disponíveis
    let query = supabase
      .from('cartas')
      .select('id, nome, personagem, vinculo, categoria, raridade, imagem_url, descricao')
      .eq('ativa', true);

    if (categoria) query = query.eq('categoria', categoria);

    const { data: cartas, error } = await query;

    if (error || !cartas || cartas.length === 0) {
      await interaction.editReply({
        content: categoria
          ? `❌ Nenhuma carta encontrada na categoria **${categoria}**.`
          : '❌ Nenhuma carta cadastrada ainda.',
      });
      return;
    }

    // Sistema de peso por raridade
    const pesos: Record<string, number> = {
      comum: 50, incomum: 25, raro: 15, epico: 7, lendario: 3,
    };

    const pool: typeof cartas = [];
    for (const carta of cartas) {
      const peso = pesos[carta.raridade] || 10;
      for (let i = 0; i < peso; i++) pool.push(carta);
    }

    // Sorteia a quantidade de cartas configurada para o cargo
    const qtdCartas = configFinal.cartas_por_roll;
    const cartasSorteadas: typeof cartas = [];

    for (let i = 0; i < qtdCartas; i++) {
      cartasSorteadas.push(pool[Math.floor(Math.random() * pool.length)]);
    }

    // Registra o uso no banco
    await supabase.from('rolls_usuarios').insert({
      discord_id: userId,
      guild_id: guildId,
    });

    // Salva cartas na coleção do usuário e monta embeds
    const embeds: EmbedBuilder[] = [];

    for (const cartaSorteada of cartasSorteadas) {
      const { data: jaTemCarta } = await supabase
        .from('cartas_usuarios')
        .select('id, quantidade')
        .eq('discord_id', userId)
        .eq('carta_id', cartaSorteada.id)
        .maybeSingle();

      if (jaTemCarta) {
        await supabase
          .from('cartas_usuarios')
          .update({ quantidade: jaTemCarta.quantidade + 1 })
          .eq('id', jaTemCarta.id);
      } else {
        await supabase
          .from('cartas_usuarios')
          .insert({ discord_id: userId, carta_id: cartaSorteada.id });
      }

      const embed = new EmbedBuilder()
        .setColor(COR_RARIDADE[cartaSorteada.raridade] as any)
        .setTitle(`${EMOJI_RARIDADE[cartaSorteada.raridade]} ${cartaSorteada.personagem}`)
        .setDescription(
          [
            `📖 **Vínculo:** ${cartaSorteada.vinculo}`,
            `🏷️ **Categoria:** ${cartaSorteada.categoria}`,
            `✨ **Raridade:** ${cartaSorteada.raridade.charAt(0).toUpperCase() + cartaSorteada.raridade.slice(1)}`,
            cartaSorteada.descricao ? `\n${cartaSorteada.descricao}` : '',
            jaTemCarta
              ? `\n🔄 Duplicata! Agora tem **${jaTemCarta.quantidade + 1}x**.`
              : '\n🆕 **Nova carta!**',
          ].filter(Boolean).join('\n')
        )
        .setFooter({
          text: `${interaction.user.username} • ${qtdCartas > 1 ? `${cartasSorteadas.indexOf(cartaSorteada) + 1}/${qtdCartas} cartas` : `Cooldown: ${configFinal.cooldown_valor} ${configFinal.cooldown_unidade}`}`,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      if (cartaSorteada.imagem_url) embed.setImage(cartaSorteada.imagem_url);

      embeds.push(embed);
    }

    // Discord permite no máximo 10 embeds por mensagem
    await interaction.editReply({ embeds: embeds.slice(0, 10) });

  } catch (error: any) {
    console.error('Erro no /roll:', error);
    await interaction.editReply({ content: '❌ Erro ao sortear carta. Tente novamente!' });
  }
};
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { supabase } from '../../lib/supabase';

const COR_RARIDADE: Record<string, string> = {
  comum: '#9CA3AF',
  incomum: '#10B981',
  raro: '#3B82F6',
  epico: '#8B5CF6',
  lendario: '#F59E0B',
};

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

// Cooldown por usuário (em ms) — 30 segundos
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 30_000;

export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Sorteia uma carta aleatória da coleção NOITADA')
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

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const userId = interaction.user.id;

  // Verifica cooldown
  const ultimoRoll = cooldowns.get(userId);
  if (ultimoRoll) {
    const restante = COOLDOWN_MS - (Date.now() - ultimoRoll);
    if (restante > 0) {
      const segundos = Math.ceil(restante / 1000);
      await interaction.reply({
        content: `⏳ Aguarde **${segundos}s** antes de rolar novamente, ${interaction.user.username}!`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  await interaction.deferReply();

  try {
    const categoria = interaction.options.getString('categoria');

    // Busca todas as cartas ativas (com filtro opcional)
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

    const cartaSorteada = pool[Math.floor(Math.random() * pool.length)];

    // Salva na coleção do usuário
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

    // Registra cooldown
    cooldowns.set(userId, Date.now());

    const embed = new EmbedBuilder()
      .setColor(COR_RARIDADE[cartaSorteada.raridade] as any)
      .setTitle(`${EMOJI_RARIDADE[cartaSorteada.raridade]} ${cartaSorteada.personagem}`)
      .setDescription(
        [
          `📖 **Vínculo:** ${cartaSorteada.vinculo}`,
          `🏷️ **Categoria:** ${cartaSorteada.categoria}`,
          `✨ **Raridade:** ${cartaSorteada.raridade.charAt(0).toUpperCase() + cartaSorteada.raridade.slice(1)}`,
          cartaSorteada.descricao ? `\n${cartaSorteada.descricao}` : '',
          jaTemCarta ? `\n🔄 Você já tinha esta carta! Agora tem **${jaTemCarta.quantidade + 1}x**.` : '\n🆕 **Nova carta adicionada à sua coleção!**',
        ]
          .filter(Boolean)
          .join('\n')
      )
      .setFooter({ text: `Rolado por ${interaction.user.username} • ⏳ Próximo roll em 30s`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    if (cartaSorteada.imagem_url) {
      embed.setImage(cartaSorteada.imagem_url);
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error: any) {
    console.error('Erro no /roll:', error);
    await interaction.editReply({ content: '❌ Erro ao sortear carta. Tente novamente!' });
  }
};
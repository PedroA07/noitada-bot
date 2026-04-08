// src/commands/membros/roll.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { supabase } from '../../lib/supabase';

const COR_RARIDADE: Record<string, string> = {
  comum:    '#9CA3AF',
  incomum:  '#10B981',
  raro:     '#3B82F6',
  epico:    '#8B5CF6',
  lendario: '#F59E0B',
};

const EMOJI_RARIDADE: Record<string, string> = {
  comum:    '⚪',
  incomum:  '🟢',
  raro:     '🔵',
  epico:    '🟣',
  lendario: '🟡',
};

// ─── Pontuação base por raridade (espelhado do site) ─────────────────────────
const PONTOS_BASE: Record<string, number> = {
  comum:    1,
  incomum:  10,
  raro:     50,
  epico:    200,
  lendario: 1000,
};

// Mesma função do site (dashboard/cartas/page.tsx e api/cartas/imagem/route.tsx)
function calcPts(raridade: string, personagem: string, vinculo: string): number {
  const base = PONTOS_BASE[raridade] ?? 1;
  let h = 0;
  const s = (personagem + vinculo).toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return base + (Math.abs(h) % 50);
}

// URL base do site — usada para gerar o card 9:16 via API
// Defina SITE_URL no .env do bot: SITE_URL=https://www.noitadaserver.com.br
const SITE_URL = (process.env.SITE_URL || 'https://www.noitadaserver.com.br').replace(/\/$/, '');

// ─── Retorna a URL da imagem para o embed ─────────────────────────────────────
// Discord exige URL pública e acessível em setImage().
// - GIFs: usa a URL do R2 diretamente (Discord anima nativamente)
// - Imagens estáticas: usa a API /api/cartas/imagem?id=... que gera o card 9:16
// - Sem imagem: retorna null (embed sem imagem)
function urlImagemEmbed(cartaId: string, imagemUrl: string | null): string | null {
  if (!imagemUrl) return null;
  if (imagemUrl.toLowerCase().endsWith('.gif')) return imagemUrl;
  return `${SITE_URL}/api/cartas/imagem?id=${cartaId}`;
}

// ─── Busca config de roll do usuário pelo cargo mais alto ────────────────────
async function buscarConfigUsuario(guildId: string, cargoIds: string[]) {
  if (!cargoIds.length) return null;

  const { data: configs } = await supabase
    .from('configuracoes_roll')
    .select('*')
    .eq('guild_id', guildId)
    .in('cargo_id', cargoIds);

  if (!configs || configs.length === 0) return null;

  return configs.reduce((melhor, atual) =>
    atual.cartas_por_roll > melhor.cartas_por_roll ? atual : melhor
  );
}

// ─── Verifica cooldown ────────────────────────────────────────────────────────
async function verificarCooldown(
  userId: string,
  guildId: string,
  config: any
): Promise<{ pode: boolean; mensagem?: string }> {
  const cooldownMs =
    config.cooldown_unidade === 'horas'
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

  if (usos.length >= config.rolls_por_periodo) {
    const maisAntigo = new Date(usos[usos.length - 1].usado_em);
    const liberaEm   = new Date(maisAntigo.getTime() + cooldownMs);
    const restanteMs = liberaEm.getTime() - Date.now();

    const restanteH   = Math.floor(restanteMs / 3_600_000);
    const restanteMin = Math.ceil((restanteMs % 3_600_000) / 60_000);
    const restanteSeg = Math.ceil((restanteMs % 60_000) / 1_000);

    const textoEspera =
      restanteH   > 0 ? `${restanteH}h ${restanteMin}min` :
      restanteMin > 1 ? `${restanteMin} minutos` :
                        `${restanteSeg} segundos`;

    return {
      pode: false,
      mensagem: `⏳ Você usou todos os **${config.rolls_por_periodo} rolls** do período!\nPróximo roll disponível em **${textoEspera}**.`,
    };
  }

  return { pode: true };
}

// ─── Comando ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Sorteia carta(s) aleatória(s) da coleção NOITADA')
  .addStringOption(option =>
    option
      .setName('categoria')
      .setDescription('Filtrar por categoria (opcional)')
      .setRequired(false)
      .addChoices(
        { name: '🎌 Anime',    value: 'anime'   },
        { name: '📺 Série',    value: 'serie'   },
        { name: '🎬 Filme',    value: 'filme'   },
        { name: '🖼️ Desenho',  value: 'desenho' },
        { name: '🎮 Jogo',     value: 'jogo'    },
        { name: '🎵 Música',   value: 'musica'  },
        { name: '🌀 Outro',    value: 'outro'   },
      )
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const userId  = interaction.user.id;
  const guildId = process.env.DISCORD_GUILD_ID!;
  const member  =
    interaction.guild?.members.cache.get(userId) ||
    (await interaction.guild?.members.fetch(userId).catch(() => null));

  await interaction.deferReply();

  try {
    const categoria = interaction.options.getString('categoria');
    const cargoIds  = member ? [...member.roles.cache.keys()] : [];
    const config    = await buscarConfigUsuario(guildId, cargoIds);

    const configFinal = config || {
      cooldown_valor:    30,
      cooldown_unidade:  'minutos',
      rolls_por_periodo: 5,
      cartas_por_roll:   1,
    };

    const verificacao = await verificarCooldown(userId, guildId, configFinal);
    if (!verificacao.pode) {
      await interaction.editReply({ content: verificacao.mensagem });
      return;
    }

    // Busca cartas ativas
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

    // Pool ponderado por raridade (mesmos pesos do site)
    const PESOS_SPAWN: Record<string, number> = {
      comum: 50, incomum: 25, raro: 15, epico: 7, lendario: 3,
    };
    const pool: typeof cartas = [];
    for (const carta of cartas) {
      const peso = PESOS_SPAWN[carta.raridade] ?? 10;
      for (let i = 0; i < peso; i++) pool.push(carta);
    }

    const qtdCartas = configFinal.cartas_por_roll;
    const cartasSorteadas: typeof cartas = [];
    for (let i = 0; i < qtdCartas; i++) {
      cartasSorteadas.push(pool[Math.floor(Math.random() * pool.length)]);
    }

    // Registra o uso do roll
    await supabase.from('rolls_usuarios').insert({ discord_id: userId, guild_id: guildId });

    const embeds: EmbedBuilder[] = [];

    for (let idx = 0; idx < cartasSorteadas.length; idx++) {
      const cartaSorteada = cartasSorteadas[idx];

      // Atualiza ou insere na coleção do usuário
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

      // Calcula pontuação da carta
      const pts = calcPts(cartaSorteada.raridade, cartaSorteada.personagem, cartaSorteada.vinculo);

      // URL da imagem: card 9:16 gerado pela API ou GIF direto
      const urlImg = urlImagemEmbed(cartaSorteada.id, cartaSorteada.imagem_url);

      // Monta embed
      const embed = new EmbedBuilder()
        .setColor(COR_RARIDADE[cartaSorteada.raridade] as any)
        .setTitle(`${EMOJI_RARIDADE[cartaSorteada.raridade]} ${cartaSorteada.personagem}`)
        .setDescription(
          [
            `📖 **Vínculo:** ${cartaSorteada.vinculo}`,
            `🏷️ **Categoria:** ${cartaSorteada.categoria.charAt(0).toUpperCase() + cartaSorteada.categoria.slice(1)}`,
            `✨ **Raridade:** ${cartaSorteada.raridade.charAt(0).toUpperCase() + cartaSorteada.raridade.slice(1)}`,
            `⭐ **Pontuação:** ${pts.toLocaleString('pt-BR')} pts`,
            cartaSorteada.descricao ? `\n${cartaSorteada.descricao}` : '',
            jaTemCarta
              ? `\n🔄 Duplicata! Agora você tem **${jaTemCarta.quantidade + 1}x**.`
              : '\n🆕 **Nova carta adicionada à sua coleção!**',
          ]
            .filter(Boolean)
            .join('\n')
        )
        .setFooter({
          text: `${interaction.user.username} • ${
            qtdCartas > 1
              ? `${idx + 1}/${qtdCartas} cartas`
              : `Cooldown: ${configFinal.cooldown_valor} ${configFinal.cooldown_unidade}`
          }`,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      // Imagem principal do embed (card 9:16 ou GIF)
      if (urlImg) {
        embed.setImage(urlImg);
      }

      embeds.push(embed);
    }

    // Discord suporta até 10 embeds por mensagem
    await interaction.editReply({ embeds: embeds.slice(0, 10) });

  } catch (error: any) {
    console.error('Erro no /roll:', error);
    await interaction.editReply({ content: '❌ Erro ao sortear carta. Tente novamente!' });
  }
};
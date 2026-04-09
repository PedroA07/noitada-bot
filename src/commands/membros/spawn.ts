import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  AttachmentBuilder,
} from 'discord.js';
import { supabase } from '../../lib/supabase';

const PESOS_SPAWN: Record<string, number> = {
  comum: 50, incomum: 25, raro: 15, epico: 7, lendario: 3,
};

const PONTOS_BASE: Record<string, number> = {
  comum: 1, incomum: 10, raro: 50, epico: 200, lendario: 1000,
};

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

function calcPts(raridade: string, personagem: string, vinculo: string): number {
  const base = PONTOS_BASE[raridade] ?? 1;
  let h = 0;
  const s = (personagem + vinculo).toLowerCase();
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return base + (Math.abs(h) % 50);
}

const SITE_URL = (process.env.SITE_URL || 'https://www.noitadaserver.com.br').replace(/\/$/, '');

async function buscarImagemCard(cartaId: string, imagemUrl: string | null): Promise<Buffer | null> {
  if (!imagemUrl) return null;

  // GIF: usa diretamente a URL do R2
  if (imagemUrl.toLowerCase().endsWith('.gif')) {
    try {
      const res = await fetch(imagemUrl);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > 0 ? buf : null;
    } catch {
      return null;
    }
  }

  // Tenta buscar o card 9:16 renderizado pela API do site
  try {
    const urlCard = `${SITE_URL}/api/cartas/imagem?id=${cartaId}`;
    const res = await fetch(urlCard, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 0) return buf;
    }
  } catch {
    // API do site falhou — usa fallback abaixo
  }

  // Fallback: imagem direta do R2
  try {
    const res = await fetch(imagemUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

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
    const peso = PESOS_SPAWN[carta.raridade] || 10;
    for (let i = 0; i < peso; i++) pool.push(carta);
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const userId = interaction.user.id;
  const guildId = interaction.guildId!;
  const categoria = interaction.options.getString('categoria');
  const genero = interaction.options.getString('genero');

  await interaction.deferReply();

  try {
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

    const pts = calcPts(carta.raridade, carta.personagem, carta.vinculo);
    const emoji = EMOJI_RARIDADE[carta.raridade] ?? '❓';

    const textoSpawn = [
      `${emoji} **${carta.personagem}** — ${carta.vinculo}`,
      `✨ ${carta.raridade.charAt(0).toUpperCase() + carta.raridade.slice(1)} • ⭐ ${pts.toLocaleString('pt-BR')} pts`,
      `\n🖐️ **Clique em Capturar para pegar essa carta!**`,
    ].join('\n');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`capturar_${carta.id}`)
        .setLabel('🖐️ Capturar!')
        .setStyle(ButtonStyle.Success),
    );

    const imageBuffer = await buscarImagemCard(carta.id, carta.imagem_url);

    let msg;
    if (imageBuffer) {
      const ext = carta.imagem_url?.toLowerCase().endsWith('.gif') ? 'gif' : 'png';
      const attachment = new AttachmentBuilder(imageBuffer, { name: `carta-${carta.id}.${ext}` });
      msg = await interaction.editReply({ content: textoSpawn, files: [attachment], components: [row] });
    } else {
      msg = await interaction.editReply({ content: textoSpawn, components: [row] });
    }

    const collector = msg.createMessageComponentCollector({ time: 60_000 });

    collector.on('collect', async (btn) => {
      const capturadorId = btn.user.id;

      // Verifica limite diário do jogador que está capturando
      const capturadorMember = interaction.guild?.members.cache.get(capturadorId)
        || await interaction.guild?.members.fetch(capturadorId).catch(() => null);
      const cargoIdsCapturador = capturadorMember ? [...capturadorMember.roles.cache.keys()] : [];

      const verificacaoCapturador = await verificarCaptura(capturadorId, guildId, cargoIdsCapturador);
      if (!verificacaoCapturador.pode) {
        await btn.reply({ content: verificacaoCapturador.motivo!, flags: MessageFlags.Ephemeral });
        return;
      }

      await btn.deferUpdate();

      // Registra a carta na coleção do capturador
      const cartaId = btn.customId.split('_')[1];
      const { data: jaTemCarta } = await supabase
        .from('cartas_usuarios')
        .select('id, quantidade')
        .eq('discord_id', capturadorId)
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
          .insert({ discord_id: capturadorId, carta_id: cartaId });
      }

      // Atualiza capturas diárias do capturador
      const hoje = new Date().toDateString();
      const agora = new Date().toISOString();
      const { data: capturaDiariaAtual } = await supabase
        .from('capturas_diarias')
        .select('*')
        .eq('discord_id', capturadorId)
        .eq('guild_id', guildId)
        .gte('data_reset', hoje)
        .maybeSingle();

      if (capturaDiariaAtual) {
        await supabase
          .from('capturas_diarias')
          .update({ total_capturas: capturaDiariaAtual.total_capturas + 1, ultima_captura: agora })
          .eq('id', capturaDiariaAtual.id);
      } else {
        await supabase
          .from('capturas_diarias')
          .insert({ discord_id: capturadorId, guild_id: guildId, data_reset: agora, total_capturas: 1, ultima_captura: agora });
      }

      const textoCaptura = [
        `${emoji} **${carta.personagem}** — ${carta.vinculo}`,
        `✨ ${carta.raridade.charAt(0).toUpperCase() + carta.raridade.slice(1)} • ⭐ ${pts.toLocaleString('pt-BR')} pts`,
        jaTemCarta
          ? `\n🔄 <@${capturadorId}> capturou! Agora tem **${jaTemCarta.quantidade + 1}x**.`
          : `\n🆕 **<@${capturadorId}> adicionou à coleção!**`,
      ].join('\n');

      await interaction.editReply({ content: textoCaptura, components: [] });
      collector.stop();
    });

    collector.on('end', async (_, reason) => {
      if (reason === 'time') {
        await interaction.editReply({
          content: '⏰ Tempo esgotado! A carta fugiu...',
          components: [],
        }).catch(() => {});
      }
    });

  } catch (error: any) {
    console.error('Erro no /spawn:', error);
    await interaction.editReply({ content: '❌ Erro ao spawnar carta. Tente novamente!' });
  }
};

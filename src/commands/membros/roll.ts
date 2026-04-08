// src/commands/membros/roll.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AttachmentBuilder,
} from 'discord.js';
import { supabase } from '../../lib/supabase';

// Pesos de spawn por raridade
const PESOS_SPAWN: Record<string, number> = {
  comum: 50, incomum: 25, raro: 15, epico: 7, lendario: 3,
};

// Pontuação base por raridade (igual ao site)
const PONTOS_BASE: Record<string, number> = {
  comum: 1, incomum: 10, raro: 50, epico: 200, lendario: 1000,
};

// Emoji de raridade para o texto
const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

// Calcula pontuação — igual ao site
function calcPts(raridade: string, personagem: string, vinculo: string): number {
  const base = PONTOS_BASE[raridade] ?? 1;
  let h = 0;
  const s = (personagem + vinculo).toLowerCase();
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return base + (Math.abs(h) % 50);
}

// URL do site — para buscar o card 9:16 gerado pela API
const SITE_URL = (process.env.SITE_URL || 'https://www.noitadaserver.com.br').replace(/\/$/, '');

// Busca a imagem do card como buffer para anexar como arquivo
// O Discord mostra arquivos anexados em tamanho grande, sem embed
async function buscarImagemCard(cartaId: string, imagemUrl: string | null): Promise<Buffer | null> {
  if (!imagemUrl) return null;

  try {
    // GIF: usa diretamente a URL do R2
    if (imagemUrl.toLowerCase().endsWith('.gif')) {
      const res = await fetch(imagemUrl);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }

    // Imagem estática: busca o card 9:16 renderizado pela API do site
    const urlCard = `${SITE_URL}/api/cartas/imagem?id=${cartaId}`;
    const res = await fetch(urlCard);
    if (!res.ok) {
      console.warn(`[roll] API imagem retornou ${res.status} para carta ${cartaId}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    console.error('[roll] erro ao buscar imagem:', err?.message);
    return null;
  }
}

// ─── Config de roll por cargo ─────────────────────────────────────────────────
async function buscarConfigUsuario(guildId: string, cargoIds: string[]) {
  if (!cargoIds.length) return null;
  const { data } = await supabase
    .from('configuracoes_roll')
    .select('*')
    .eq('guild_id', guildId)
    .in('cargo_id', cargoIds);
  if (!data?.length) return null;
  return data.reduce((m, a) => a.cartas_por_roll > m.cartas_por_roll ? a : m);
}

// ─── Cooldown ─────────────────────────────────────────────────────────────────
async function verificarCooldown(userId: string, guildId: string, config: any): Promise<{ pode: boolean; mensagem?: string }> {
  const ms = config.cooldown_unidade === 'horas'
    ? config.cooldown_valor * 3_600_000
    : config.cooldown_valor * 60_000;

  const desde = new Date(Date.now() - ms).toISOString();
  const { data: usos } = await supabase
    .from('rolls_usuarios')
    .select('id, usado_em')
    .eq('discord_id', userId)
    .eq('guild_id', guildId)
    .gte('usado_em', desde)
    .order('usado_em', { ascending: false });

  if (!usos?.length) return { pode: true };
  if (usos.length >= config.rolls_por_periodo) {
    const liberaEm   = new Date(new Date(usos[usos.length - 1].usado_em).getTime() + ms);
    const restanteMs = liberaEm.getTime() - Date.now();
    const h   = Math.floor(restanteMs / 3_600_000);
    const min = Math.ceil((restanteMs % 3_600_000) / 60_000);
    const seg = Math.ceil((restanteMs % 60_000) / 1_000);
    const texto = h > 0 ? `${h}h ${min}min` : min > 1 ? `${min} minutos` : `${seg} segundos`;
    return { pode: false, mensagem: `⏳ Você usou todos os **${config.rolls_por_periodo} rolls** do período!\nPróximo roll disponível em **${texto}**.` };
  }
  return { pode: true };
}

// ─── Comando ──────────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName('roll')
  .setDescription('Sorteia carta(s) aleatória(s) da coleção NOITADA')
  .addStringOption(o =>
    o.setName('categoria').setDescription('Filtrar por categoria (opcional)').setRequired(false)
      .addChoices(
        { name: '🎌 Anime',   value: 'anime'   },
        { name: '📺 Série',   value: 'serie'   },
        { name: '🎬 Filme',   value: 'filme'   },
        { name: '🖼️ Desenho', value: 'desenho' },
        { name: '🎮 Jogo',    value: 'jogo'    },
        { name: '🎵 Música',  value: 'musica'  },
        { name: '🌀 Outro',   value: 'outro'   },
      )
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  const userId  = interaction.user.id;
  const guildId = process.env.DISCORD_GUILD_ID!;
  const member  = interaction.guild?.members.cache.get(userId)
    ?? await interaction.guild?.members.fetch(userId).catch(() => null);

  await interaction.deferReply();

  try {
    const categoria = interaction.options.getString('categoria');
    const cargoIds  = member ? [...member.roles.cache.keys()] : [];
    const config    = await buscarConfigUsuario(guildId, cargoIds) ?? {
      cooldown_valor: 30, cooldown_unidade: 'minutos', rolls_por_periodo: 5, cartas_por_roll: 1,
    };

    const verificacao = await verificarCooldown(userId, guildId, config);
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

    if (error || !cartas?.length) {
      await interaction.editReply({ content: categoria ? `❌ Nenhuma carta na categoria **${categoria}**.` : '❌ Nenhuma carta cadastrada ainda.' });
      return;
    }

    // Pool ponderado por raridade
    const pool: typeof cartas = [];
    for (const carta of cartas) {
      const peso = PESOS_SPAWN[carta.raridade] ?? 10;
      for (let i = 0; i < peso; i++) pool.push(carta);
    }

    const qtd = config.cartas_por_roll;
    const sorteadas: typeof cartas = Array.from({ length: qtd }, () => pool[Math.floor(Math.random() * pool.length)]);

    // Registra o roll
    await supabase.from('rolls_usuarios').insert({ discord_id: userId, guild_id: guildId });

    // Processa cada carta sorteada
    for (let idx = 0; idx < sorteadas.length; idx++) {
      const carta = sorteadas[idx];

      // Atualiza coleção do usuário
      const { data: jaTemCarta } = await supabase
        .from('cartas_usuarios')
        .select('id, quantidade')
        .eq('discord_id', userId)
        .eq('carta_id', carta.id)
        .maybeSingle();

      if (jaTemCarta) {
        await supabase.from('cartas_usuarios').update({ quantidade: jaTemCarta.quantidade + 1 }).eq('id', jaTemCarta.id);
      } else {
        await supabase.from('cartas_usuarios').insert({ discord_id: userId, carta_id: carta.id });
      }

      const pts      = calcPts(carta.raridade, carta.personagem, carta.vinculo);
      const emoji    = EMOJI_RARIDADE[carta.raridade] ?? '❓';
      const isDupl   = !!jaTemCarta;
      const novoPts  = isDupl ? jaTemCarta!.quantidade + 1 : 1;

      // Texto simples abaixo da imagem
      const textoRoll = [
        `${emoji} **${carta.personagem}** — ${carta.vinculo}`,
        `✨ ${carta.raridade.charAt(0).toUpperCase() + carta.raridade.slice(1)} • ⭐ ${pts.toLocaleString('pt-BR')} pts`,
        isDupl ? `🔄 Duplicata! Você agora tem **${novoPts}x**.` : `🆕 **Nova carta adicionada à sua coleção!**`,
        qtd > 1 ? `*(${idx + 1}/${qtd})*` : `*Cooldown: ${config.cooldown_valor} ${config.cooldown_unidade}*`,
      ].join('\n');

      // Tenta buscar a imagem do card 9:16
      const imageBuffer = await buscarImagemCard(carta.id, carta.imagem_url);

      if (imageBuffer) {
        // Envia como arquivo anexado — o Discord exibe em tamanho grande, sem embed
        const ext        = carta.imagem_url?.toLowerCase().endsWith('.gif') ? 'gif' : 'png';
        const attachment = new AttachmentBuilder(imageBuffer, { name: `carta-${carta.id}.${ext}` });
        await interaction.followUp({ content: textoRoll, files: [attachment] });
      } else {
        // Fallback sem imagem — só texto
        await interaction.followUp({ content: textoRoll });
      }
    }

    // Remove o "pensando..." inicial do deferReply
    await interaction.deleteReply().catch(() => {});

  } catch (err: any) {
    console.error('[roll] erro:', err);
    await interaction.editReply({ content: '❌ Erro ao sortear carta. Tente novamente!' });
  }
};
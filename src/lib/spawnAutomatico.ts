import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, TextChannel } from 'discord.js';
import { supabase } from './supabase';
import { buscarRaridadePorPopularidade } from './raridade';

const COR_RARIDADE: Record<string, string> = {
  comum: '#9CA3AF', incomum: '#10B981', raro: '#3B82F6',
  epico: '#8B5CF6', lendario: '#F59E0B',
};

const EMOJI_RARIDADE: Record<string, string> = {
  comum: '⚪', incomum: '🟢', raro: '🔵', epico: '🟣', lendario: '🟡',
};

const PESO_RARIDADE: Record<string, number> = {
  comum: 50, incomum: 25, raro: 15, epico: 7, lendario: 3,
};

// Busca configuração do sistema
async function buscarConfig(guildId: string) {
  const { data } = await supabase
    .from('configuracoes_cartas_sistema')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  return data;
}

// Busca config de cargo mais generosa para o usuário
async function buscarConfigCaptura(guildId: string, cargoIds: string[]) {
  const { data: configs } = await supabase
    .from('configuracoes_roll')
    .select('capturas_por_dia, cooldown_captura_segundos')
    .eq('guild_id', guildId)
    .in('cargo_id', cargoIds);

  if (!configs || configs.length === 0) {
    return { capturas_por_dia: 10, cooldown_captura_segundos: 30 };
  }

  return configs.reduce((melhor, atual) =>
    atual.capturas_por_dia > melhor.capturas_por_dia ? atual : melhor
  );
}

// Verifica se usuário pode capturar
async function podeCapturar(
  discordId: string,
  guildId: string,
  cargoIds: string[]
): Promise<{ pode: boolean; motivo?: string }> {
  const config = await buscarConfigCaptura(guildId, cargoIds);
  const agora = new Date();

  // Busca ou cria registro de capturas diárias
  const { data: capturaDiaria } = await supabase
    .from('capturas_diarias')
    .select('*')
    .eq('discord_id', discordId)
    .eq('guild_id', guildId)
    .gte('data_reset', new Date().toDateString())
    .maybeSingle();

  if (capturaDiaria) {
    // Verifica limite diário
    if (capturaDiaria.total_capturas >= config.capturas_por_dia) {
      return {
        pode: false,
        motivo: `❌ Você atingiu o limite de **${config.capturas_por_dia} capturas** hoje! Volta amanhã. 🌙`,
      };
    }

    // Verifica cooldown entre capturas
    if (capturaDiaria.ultima_captura && config.cooldown_captura_segundos > 0) {
      const ultimaCaptura = new Date(capturaDiaria.ultima_captura);
      const diff = (agora.getTime() - ultimaCaptura.getTime()) / 1000;
      if (diff < config.cooldown_captura_segundos) {
        const restante = Math.ceil(config.cooldown_captura_segundos - diff);
        return {
          pode: false,
          motivo: `⏳ Aguarde **${restante}s** antes de capturar outra carta!`,
        };
      }
    }
  }

  return { pode: true };
}

// Registra uma captura
async function registrarCaptura(discordId: string, guildId: string) {
  const hoje = new Date().toDateString();
  const agora = new Date().toISOString();

  const { data: existente } = await supabase
    .from('capturas_diarias')
    .select('*')
    .eq('discord_id', discordId)
    .eq('guild_id', guildId)
    .gte('data_reset', hoje)
    .maybeSingle();

  if (existente) {
    await supabase
      .from('capturas_diarias')
      .update({
        total_capturas: existente.total_capturas + 1,
        ultima_captura: agora,
      })
      .eq('id', existente.id);
  } else {
    await supabase
      .from('capturas_diarias')
      .insert({
        discord_id: discordId,
        guild_id: guildId,
        data_reset: agora,
        total_capturas: 1,
        ultima_captura: agora,
      });
  }
}

// Sorteia uma carta com peso por raridade
async function sortearCarta() {
  const { data: cartas } = await supabase
    .from('cartas')
    .select('id, nome, personagem, vinculo, categoria, raridade, imagem_url, descricao')
    .eq('ativa', true);

  if (!cartas || cartas.length === 0) return null;

  // Atualiza raridades pelo Google (só para as que ainda não têm ou são antigas)
  const cartasComRaridade = await Promise.all(
    cartas.map(async carta => {
      try {
        const raridadeGoogle = await buscarRaridadePorPopularidade(carta.personagem, carta.vinculo);
        if (raridadeGoogle !== carta.raridade) {
          await supabase.from('cartas').update({ raridade: raridadeGoogle }).eq('id', carta.id);
        }
        return { ...carta, raridade: raridadeGoogle };
      } catch {
        return carta;
      }
    })
  );

  const pool: typeof cartasComRaridade = [];
  for (const carta of cartasComRaridade) {
    const peso = PESO_RARIDADE[carta.raridade] || 10;
    for (let i = 0; i < peso; i++) pool.push(carta);
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

// Envia uma carta no canal com botão de capturar
async function enviarCartaSpawn(canal: TextChannel, guildId: string, client: Client) {
  const carta = await sortearCarta();
  if (!carta) return;

  const embed = new EmbedBuilder()
    .setColor(COR_RARIDADE[carta.raridade] as any)
    .setTitle(`${EMOJI_RARIDADE[carta.raridade]} Uma carta apareceu!`)
    .addFields(
      { name: '👤 Personagem', value: carta.personagem, inline: true },
      { name: '📖 Vínculo', value: carta.vinculo, inline: true },
      { name: '✨ Raridade', value: carta.raridade.charAt(0).toUpperCase() + carta.raridade.slice(1), inline: true },
    )
    .setDescription(carta.descricao || null)
    .setFooter({ text: '⚡ Clique rápido! Esta carta expira em 60 segundos.' })
    .setTimestamp();

  if (carta.imagem_url) embed.setImage(carta.imagem_url);

  const botao = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`spawn_pegar_${carta.id}`)
      .setLabel('🃏 CAPTURAR')
      .setStyle(ButtonStyle.Success)
  );

  const msg = await canal.send({ embeds: [embed], components: [botao] });

  // Salva no histórico
  const { data: spawn } = await supabase
    .from('spawns_historico')
    .insert({
      guild_id: guildId,
      carta_id: carta.id,
      canal_id: canal.id,
      message_id: msg.id,
    })
    .select()
    .single();

  // Coletor — qualquer pessoa pode capturar
  const coletor = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60_000,
    max: 1,
  });

  coletor.on('collect', async (btn) => {
    const quemPegou = btn.user;
    const member = canal.guild.members.cache.get(quemPegou.id)
      || await canal.guild.members.fetch(quemPegou.id).catch(() => null);

    const cargoIds = member ? [...member.roles.cache.keys()] : [];

    // Verifica se pode capturar
    const verificacao = await podeCapturar(quemPegou.id, guildId, cargoIds);
    if (!verificacao.pode) {
      await btn.reply({ content: verificacao.motivo, ephemeral: true });
      return;
    }

    // Registra na coleção
    const { data: jaTemCarta } = await supabase
      .from('cartas_usuarios')
      .select('id, quantidade')
      .eq('discord_id', quemPegou.id)
      .eq('carta_id', carta.id)
      .maybeSingle();

    if (jaTemCarta) {
      await supabase
        .from('cartas_usuarios')
        .update({ quantidade: jaTemCarta.quantidade + 1 })
        .eq('id', jaTemCarta.id);
    } else {
      await supabase
        .from('cartas_usuarios')
        .insert({ discord_id: quemPegou.id, carta_id: carta.id });
    }

    await registrarCaptura(quemPegou.id, guildId);

    // Atualiza histórico
    if (spawn) {
      await supabase
        .from('spawns_historico')
        .update({ capturada_por: quemPegou.id, capturada_em: new Date().toISOString() })
        .eq('id', spawn.id);
    }

    const embedCapturado = new EmbedBuilder()
      .setColor('#1F2937')
      .setTitle(`✅ ${carta.personagem} — Capturado!`)
      .setDescription(
        jaTemCarta
          ? `${quemPegou} capturou esta carta! *(Duplicata — agora tem ${jaTemCarta.quantidade + 1}x)*`
          : `${quemPegou} foi o mais rápido! 🎉`
      );

    const botaoDesativado = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('capturado')
        .setLabel(`✅ Capturado por ${quemPegou.username}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    await btn.update({ embeds: [embedCapturado], components: [botaoDesativado] });
  });

  coletor.on('end', async (collected) => {
    if (collected.size === 0) {
      if (spawn) {
        await supabase
          .from('spawns_historico')
          .update({ expirou: true })
          .eq('id', spawn.id);
      }

      try {
        const embedExpirado = new EmbedBuilder()
          .setColor('#374151')
          .setTitle(`⏰ ${carta.personagem} — Ninguém capturou`)
          .setFooter({ text: 'A carta voltou para o baralho.' });

        const botaoExpirado = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId('expirado')
            .setLabel('⏰ Expirado')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );

        await msg.edit({ embeds: [embedExpirado], components: [botaoExpirado] });
      } catch { }
    }
  });
}

// Loop principal de spawn automático
let spawnInterval: NodeJS.Timeout | null = null;
let resetInterval: NodeJS.Timeout | null = null;

export async function iniciarSpawnAutomatico(client: Client) {
  const guildId = process.env.DISCORD_GUILD_ID!;

  console.log('🃏 Sistema de spawn automático iniciando...');

  // Função que executa o spawn
  const executarSpawn = async () => {
    try {
      const config = await buscarConfig(guildId);
      if (!config?.ativo || !config?.canal_spawn_id) return;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      const canal = guild.channels.cache.get(config.canal_spawn_id) as TextChannel;
      if (!canal) return;

      console.log(`🃏 Spawning 10 cartas automáticas no canal ${canal.name}...`);

      // Envia 10 cartas com 3 segundos de intervalo entre cada uma
      for (let i = 0; i < 10; i++) {
        await enviarCartaSpawn(canal, guildId, client);
        if (i < 9) await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error('❌ Erro no spawn automático:', error);
    }
  };

  // Agenda o spawn com base na configuração do banco
  const agendarSpawn = async () => {
    const config = await buscarConfig(guildId);
    const intervaloMs = (config?.intervalo_spawn_minutos || 60) * 60 * 1000;

    if (spawnInterval) clearInterval(spawnInterval);

    spawnInterval = setInterval(async () => {
      // Recarrega config a cada spawn para pegar atualizações do painel
      const configAtual = await buscarConfig(guildId);
      if (configAtual?.ativo) await executarSpawn();

      // Reagenda com o intervalo atual (pode ter mudado no painel)
      const novoIntervalo = (configAtual?.intervalo_spawn_minutos || 60) * 60 * 1000;
      if (novoIntervalo !== intervaloMs) {
        clearInterval(spawnInterval!);
        spawnInterval = setInterval(executarSpawn, novoIntervalo);
      }
    }, intervaloMs);

    console.log(`⏰ Spawn agendado a cada ${config?.intervalo_spawn_minutos || 60} minutos`);
  };

  // Sistema de reset diário
  const agendarReset = async () => {
    const verificarReset = async () => {
      const config = await buscarConfig(guildId);
      if (!config) return;

      const agora = new Date();
      // Converte para horário de Brasília (UTC-3)
      const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
      const hora = brasilia.getUTCHours();
      const minuto = brasilia.getUTCMinutes();

      if (hora === config.reset_capturas_hora && minuto === config.reset_capturas_minuto) {
        console.log('🔄 Executando reset diário de capturas...');
        // O reset é feito automaticamente pela data no podeCapturar()
        // Mas podemos limpar registros antigos para manter o banco limpo
        const ontemISO = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();
        await supabase
          .from('capturas_diarias')
          .delete()
          .lt('data_reset', ontemISO);

        console.log('✅ Reset de capturas concluído');
      }
    };

    // Verifica a cada minuto
    resetInterval = setInterval(verificarReset, 60_000);
  };

  await agendarSpawn();
  await agendarReset();
}
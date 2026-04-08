import { Client } from 'discord.js';
import { supabase } from '../lib/supabase';

const INTERVALO_MS = 10000; // verifica a cada 10 segundos

export const iniciarFilaCargos = (client: Client) => {
  const guildId = process.env.DISCORD_GUILD_ID!;

  console.log('🔄 Iniciando polling da fila de cargos (a cada 10s)...');

  // Processa imediatamente ao iniciar
  processarPendentes(client, guildId);

  // Depois repete a cada 10 segundos
  setInterval(() => {
    processarPendentes(client, guildId);
  }, INTERVALO_MS);
};

async function processarPendentes(client: Client, guildId: string) {
  const { data: pendentes, error } = await supabase
    .from('fila_cargos')
    .select('*')
    .eq('status', 'pendente')
    .order('criado_em', { ascending: true });

  if (error) {
    console.error('❌ Erro ao buscar fila:', error.message);
    return;
  }

  if (!pendentes || pendentes.length === 0) return;

  console.log(`⏳ ${pendentes.length} tarefa(s) pendente(s) encontrada(s).`);

  for (const tarefa of pendentes) {
    await processarTarefa(client, tarefa, guildId);
  }
}

async function processarTarefa(
  client: Client,
  tarefa: { id: string; discord_id: string; acao: string },
  guildId: string
) {
  try {
    if (tarefa.acao !== 'dar_cargo_membro') {
      await marcarStatus(tarefa.id, 'ignorado');
      return;
    }

    // Busca cargo_membro_id configurado no painel
    const { data: config, error: configError } = await supabase
      .from('configuracoes_servidor')
      .select('cargo_membro_id')
      .eq('guild_id', guildId)
      .maybeSingle();

    if (configError || !config?.cargo_membro_id) {
      console.error('❌ cargo_membro_id não configurado no painel!');
      await marcarStatus(tarefa.id, 'erro');
      return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error('❌ Bot não está no servidor Discord.');
      await marcarStatus(tarefa.id, 'erro');
      return;
    }

    const member = await guild.members.fetch(tarefa.discord_id).catch(() => null);
    if (!member) {
      console.warn(`⚠️ Membro ${tarefa.discord_id} não encontrado no servidor. Pode ainda não ter entrado.`);
      // Não marca como erro — tenta de novo no próximo ciclo
      return;
    }

    // Verifica se já tem o cargo para não duplicar
    if (member.roles.cache.has(config.cargo_membro_id)) {
      console.log(`ℹ️ ${member.user.tag} já possui o cargo. Marcando como concluído.`);
      await marcarStatus(tarefa.id, 'concluido');
      return;
    }

    await member.roles.add(config.cargo_membro_id);
    await marcarStatus(tarefa.id, 'concluido');
    console.log(`✅ Cargo entregue para ${member.user.tag}`);

    // Envia DM confirmando o acesso
    try {
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder()
        .setColor('#22c55e')
        .setTitle('✅ Cadastro confirmado!')
        .setDescription(
          `Olá, **${member.user.username}**! 🎉\n\n` +
          `Seu cadastro foi confirmado e o cargo **Membro** foi entregue!\n\n` +
          `Agora você tem acesso completo ao servidor. Boas-vindas à **NOITADA**! 🎮`
        )
        .setTimestamp()
        .setFooter({ text: 'NOITADA • Comunidade Gamer' });

      await member.user.send({ embeds: [embed] });
      console.log(`📨 DM de confirmação enviada para ${member.user.tag}`);
    } catch {
      console.warn(`⚠️ Não foi possível enviar DM para ${member.user.tag} (DMs fechadas)`);
    }

  } catch (error: any) {
    console.error(`❌ Erro na tarefa ${tarefa.id}:`, error.message);
    await marcarStatus(tarefa.id, 'erro');
  }
}

async function marcarStatus(id: string, status: string) {
  await supabase
    .from('fila_cargos')
    .update({ status, processado_em: new Date().toISOString() })
    .eq('id', id);
}
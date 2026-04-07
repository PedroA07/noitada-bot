import { Client } from 'discord.js';
import { supabase } from '../lib/supabase';

export const iniciarFilaCargos = (client: Client) => {
  const guildId = process.env.DISCORD_GUILD_ID!;

  console.log('👂 Escutando fila de cargos no Supabase...');

  supabase
    .channel('fila-cargos')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'fila_cargos',
        // REMOVIDO o filter — checaremos o status no código
      },
      async (payload) => {
        const tarefa = payload.new as {
          id: string;
          discord_id: string;
          acao: string;
          status: string;
        };

        // Só processa se for pendente
        if (tarefa.status !== 'pendente') return;

        console.log(`📋 Nova tarefa na fila: ${tarefa.acao} para ${tarefa.discord_id}`);
        await processarTarefa(client, tarefa, guildId);
      }
    )
    .subscribe((status) => {
      console.log('📡 Realtime fila_cargos:', status);
    });

  // Processa pendentes ao iniciar
  processarPendentes(client, guildId);
};

async function processarPendentes(client: Client, guildId: string) {
  const { data: pendentes, error } = await supabase
    .from('fila_cargos')
    .select('*')
    .eq('status', 'pendente');

  if (error) {
    console.error('❌ Erro ao buscar tarefas pendentes:', error.message);
    return;
  }

  if (!pendentes || pendentes.length === 0) {
    console.log('✅ Nenhuma tarefa pendente no início.');
    return;
  }

  console.log(`⏳ Processando ${pendentes.length} tarefa(s) pendente(s)...`);
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
      console.error(`❌ Membro ${tarefa.discord_id} não encontrado.`);
      await marcarStatus(tarefa.id, 'erro');
      return;
    }

    await member.roles.add(config.cargo_membro_id);
    await marcarStatus(tarefa.id, 'concluido');
    console.log(`✅ Cargo entregue para ${member.user.tag}`);

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
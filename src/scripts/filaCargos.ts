import { Client } from 'discord.js';
import { supabase } from '../lib/supabase';

/**
 * Fica escutando a tabela fila_cargos via Realtime do Supabase.
 * Quando o site insere uma tarefa pendente, o bot processa e entrega o cargo.
 */
export const iniciarFilaCargos = (client: Client) => {
  const guildId = process.env.DISCORD_GUILD_ID!;

  console.log('👂 Escutando fila de cargos no Supabase...');

  // Escuta inserções em tempo real na fila_cargos
  supabase
    .channel('fila-cargos')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'fila_cargos',
        filter: 'status=eq.pendente',
      },
      async (payload) => {
        const tarefa = payload.new as {
          id: string;
          discord_id: string;
          acao: string;
          status: string;
        };

        console.log(`📋 Nova tarefa na fila: ${tarefa.acao} para ${tarefa.discord_id}`);
        await processarTarefa(client, tarefa, guildId);
      }
    )
    .subscribe();

  // Ao iniciar, processa tarefas pendentes que possam ter ficado paradas
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

  if (!pendentes || pendentes.length === 0) return;

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

    // Busca o cargo membro configurado no painel
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

    // Busca o servidor no cache do bot
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.error('❌ Bot não está no servidor Discord.');
      await marcarStatus(tarefa.id, 'erro');
      return;
    }

    // Busca o membro (pode não estar em cache, força fetch)
    const member = await guild.members.fetch(tarefa.discord_id).catch(() => null);
    if (!member) {
      console.error(`❌ Membro ${tarefa.discord_id} não encontrado no servidor.`);
      await marcarStatus(tarefa.id, 'erro');
      return;
    }

    // Entrega o cargo!
    await member.roles.add(config.cargo_membro_id);
    await marcarStatus(tarefa.id, 'concluido');

    console.log(`✅ Cargo membro entregue para ${member.user.tag} (${tarefa.discord_id})`);

  } catch (error: any) {
    console.error(`❌ Erro ao processar tarefa ${tarefa.id}:`, error.message);
    await marcarStatus(tarefa.id, 'erro');
  }
}

async function marcarStatus(id: string, status: string) {
  await supabase
    .from('fila_cargos')
    .update({ status, processado_em: new Date().toISOString() })
    .eq('id', id);
}
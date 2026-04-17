import { Client } from 'discord.js';
import { supabase } from './lib/supabase';

export const iniciarMonitorDeStatus = (client: Client) => {
  // Sincronização inicial: escreve o status real de todos os membros no Supabase
  const sincronizarTodos = async () => {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) return;

    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      // Busca todos os membros com dados de presença
      const membros = await guild.members.fetch({ withPresences: true }).catch(() => null);
      if (!membros) return;

      const atualizacoes: Promise<any>[] = [];
      membros.forEach(membro => {
        const status = membro.presence?.status || 'offline';
        atualizacoes.push(
          supabase
            .from('perfis')
            .update({ status })
            .eq('discord_id', membro.id),
        );
      });

      await Promise.allSettled(atualizacoes);
      console.log(`✅ Status sincronizados: ${membros.size} membros.`);
    } catch (err) {
      console.error('❌ Erro na sincronização inicial de status:', err);
    }
  };

  // Roda a sincronização inicial
  sincronizarTodos();

  // Continua monitorando mudanças de presença em tempo real
  client.on('presenceUpdate', async (_oldPresence, newPresence) => {
    if (!newPresence?.userId) return;

    const status = newPresence.status || 'offline';

    try {
      const { error } = await supabase
        .from('perfis')
        .update({ status })
        .eq('discord_id', newPresence.userId);

      if (error) {
        console.error('❌ Erro ao atualizar status:', error.message);
      }
    } catch (error) {
      console.error('❌ Erro inesperado no monitor de status:', error);
    }
  });

  console.log('👁️ Monitor de status ativo.');
};
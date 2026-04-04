import { Client } from 'discord.js';
import { supabase } from './lib/supabase';

export const iniciarMonitorDeStatus = (client: Client) => {
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
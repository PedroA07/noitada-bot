import { Client, GuildMember, EmbedBuilder, TextChannel } from 'discord.js';
import { supabase } from '../lib/supabase';

export const iniciarBoasVindas = (client: Client) => {
  client.on('guildMemberAdd', async (member: GuildMember) => {
    try {
      const guildId = process.env.DISCORD_GUILD_ID;

      const { data: config, error } = await supabase
        .from('configuracoes_servidor')
        .select(`
          canal_boas_vindas_id,
          banner_boas_vindas,
          mostrar_avatar_boas_vindas,
          mensagem_boas_vindas,
          titulo_boas_vindas,
          descricao_boas_vindas,
          cor_boas_vindas
        `)
        .eq('guild_id', guildId)
        .maybeSingle();

      if (error) {
        console.error('❌ Erro ao buscar config de boas-vindas:', error.message);
        return;
      }

      if (!config || !config.canal_boas_vindas_id) {
        console.warn('⚠️ Canal de boas-vindas não configurado no painel.');
        return;
      }

      const canal = member.guild.channels.cache.get(config.canal_boas_vindas_id) as TextChannel;
      if (!canal) {
        console.warn(`⚠️ Canal ID ${config.canal_boas_vindas_id} não encontrado.`);
        return;
      }

      const cor = config.cor_boas_vindas || '#EC4899';
      const titulo = config.titulo_boas_vindas || '🦉 UM NOVO MEMBRO ATERRISSOU!';
      const mensagemExterna = (config.mensagem_boas_vindas || `Chega mais, @NovoMembro! 🎉`)
        .replace(/@NovoMembro/g, `<@${member.id}>`);
      const descricao = (config.descricao_boas_vindas || `Seja muito bem-vindo(a) à **NOITADA**, @NovoMembro!\n\nCrie sua conta em **noitadaserver.com.br** para liberar os canais. 🎮`)
        .replace(/@NovoMembro/g, `<@${member.id}>`);

      const embedCanal = new EmbedBuilder()
        .setColor(cor as any)
        .setTitle(titulo)
        .setDescription(descricao)
        .setTimestamp();

      if (config.banner_boas_vindas) embedCanal.setImage(config.banner_boas_vindas);
      if (config.mostrar_avatar_boas_vindas !== false) {
        embedCanal.setThumbnail(member.user.displayAvatarURL({ size: 256 }));
      }

      await canal.send({ content: mensagemExterna, embeds: [embedCanal] });
      console.log(`✅ Boas-vindas no canal para ${member.user.tag}`);

      // ── DM para o novo membro ──
      try {
        const embedDM = new EmbedBuilder()
          .setColor('#EC4899')
          .setTitle('🦉 Bem-vindo(a) à NOITADA!')
          .setDescription(
            `Olá, **${member.user.username}**! 👋\n\n` +
            `Para liberar os canais do servidor, você precisa criar sua conta em nosso site.\n\n` +
            `👉 **[Clique aqui para se cadastrar](https://www.noitadaserver.com.br/cadastro)**\n\n` +
            `Após finalizar o cadastro, o cargo **Membro** será entregue automaticamente e você terá acesso a tudo! 🎮`
          )
          .setThumbnail(member.guild.iconURL({ size: 256 }) ?? null)
          .setTimestamp()
          .setFooter({ text: 'NOITADA • Comunidade Gamer' });

        await member.user.send({ embeds: [embedDM] });
        console.log(`✅ DM enviada para ${member.user.tag}`);
      } catch (dmError) {
        // Usuário pode ter DMs desativadas — não quebra o fluxo
        console.warn(`⚠️ Não foi possível enviar DM para ${member.user.tag} (DMs fechadas)`);
      }

    } catch (error) {
      console.error('❌ Erro no evento guildMemberAdd:', error);
    }
  });
};
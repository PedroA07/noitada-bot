import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
} from 'discord.js';
import { VoiceChannel, TextChannel } from 'discord.js';
import { filas, buscarMusica, conectar, tocarProxima } from '../../lib/musicPlayer';

export const data = new SlashCommandBuilder()
  .setName('tocar')
  .setDescription('Toca uma música ou playlist (YouTube, Spotify, SoundCloud ou busca por nome)')
  .addStringOption(opt =>
    opt.setName('musica')
      .setDescription('URL ou nome da música')
      .setRequired(true)
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  await interaction.deferReply();

  const member = interaction.member as GuildMember;
  const canalVoz = member.voice.channel as VoiceChannel;

  if (!canalVoz) {
    await interaction.editReply({ content: '❌ Você precisa estar em um canal de voz!' });
    return;
  }

  const query = interaction.options.getString('musica', true);
  const guildId = interaction.guildId!;
  const canalTexto = interaction.channel as TextChannel;

  try {
    await interaction.editReply({ content: '🔍 Buscando música...' });

    const musicas = await buscarMusica(query, `<@${interaction.user.id}>`);

    let servidor = filas.get(guildId);

    if (!servidor) {
      servidor = await conectar(canalVoz, canalTexto, guildId);
    }

    servidor.fila.push(...musicas);

    if (musicas.length === 1) {
      const m = musicas[0];
      const embed = new EmbedBuilder()
        .setColor('#10B981')
        .setTitle('✅ Adicionado à fila')
        .setDescription(`**[${m.titulo}](${m.url})**`)
        .addFields(
          { name: '⏱️ Duração', value: m.duracao, inline: true },
          { name: '📋 Posição na fila', value: `#${servidor.fila.length}`, inline: true },
        );
      if (m.thumbnail) embed.setThumbnail(m.thumbnail);
      await interaction.editReply({ content: '', embeds: [embed] });
    } else {
      await interaction.editReply({
        content: '',
        embeds: [
          new EmbedBuilder()
            .setColor('#10B981')
            .setTitle('✅ Playlist adicionada')
            .setDescription(`**${musicas.length} músicas** adicionadas à fila!`)
            .addFields({ name: '🎵 Primeira música', value: musicas[0].titulo }),
        ],
      });
    }

    // Se não está tocando nada, começa
    const { AudioPlayerStatus } = await import('@discordjs/voice');
    if (servidor.player.state.status === AudioPlayerStatus.Idle) {
      await tocarProxima(guildId);
    }

  } catch (error: any) {
    console.error('Erro no /tocar:', error);
    await interaction.editReply({ content: `❌ ${error.message}` });
  }
};
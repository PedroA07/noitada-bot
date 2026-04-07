import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
} from 'discord.js';
import { filas } from '../../lib/musicPlayer';
import { AudioPlayerStatus } from '@discordjs/voice';

export const data = new SlashCommandBuilder()
  .setName('musica')
  .setDescription('Controles do player de música')
  .addSubcommand(sub => sub.setName('pausar').setDescription('Pausa a música atual'))
  .addSubcommand(sub => sub.setName('continuar').setDescription('Continua a música pausada'))
  .addSubcommand(sub => sub.setName('pular').setDescription('Pula para a próxima música'))
  .addSubcommand(sub => sub.setName('parar').setDescription('Para a música e limpa a fila'))
  .addSubcommand(sub => sub.setName('fila').setDescription('Mostra a fila de músicas'))
  .addSubcommand(sub => sub.setName('tocando').setDescription('Mostra a música atual'))
  .addSubcommand(sub => sub.setName('loop').setDescription('Ativa/desativa o loop'))
  .addSubcommand(sub =>
    sub.setName('volume')
      .setDescription('Ajusta o volume (0-100)')
      .addIntegerOption(opt =>
        opt.setName('valor').setDescription('Volume de 0 a 100').setRequired(true).setMinValue(0).setMaxValue(100)
      )
  )
  .addSubcommand(sub =>
    sub.setName('remover')
      .setDescription('Remove uma música da fila pela posição')
      .addIntegerOption(opt =>
        opt.setName('posicao').setDescription('Posição na fila').setRequired(true).setMinValue(1)
      )
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  await interaction.deferReply();

  const guildId = interaction.guildId!;
  const sub = interaction.options.getSubcommand();
  const servidor = filas.get(guildId);

  // Comandos que precisam de fila ativa
  const precisaFila = ['pausar', 'continuar', 'pular', 'parar', 'fila', 'tocando', 'loop', 'volume', 'remover'];
  if (precisaFila.includes(sub) && !servidor) {
    await interaction.editReply({ content: '❌ Não há nada tocando agora!' });
    return;
  }

  const { tocarProxima } = await import('../../lib/musicPlayer');

  switch (sub) {
    case 'pausar': {
      if (servidor!.player.state.status !== AudioPlayerStatus.Playing) {
        await interaction.editReply({ content: '❌ Nenhuma música está tocando.' });
        return;
      }
      servidor!.player.pause();
      await interaction.editReply({ content: '⏸️ Música pausada.' });
      break;
    }

    case 'continuar': {
      if (servidor!.player.state.status !== AudioPlayerStatus.Paused) {
        await interaction.editReply({ content: '❌ A música não está pausada.' });
        return;
      }
      servidor!.player.unpause();
      await interaction.editReply({ content: '▶️ Continuando...' });
      break;
    }

    case 'pular': {
      servidor!.player.stop();
      await interaction.editReply({ content: '⏭️ Pulando para a próxima música...' });
      break;
    }

    case 'parar': {
      servidor!.fila = [];
      servidor!.tocandoAgora = null;
      servidor!.player.stop();
      servidor!.connection.destroy();
      filas.delete(guildId);
      await interaction.editReply({ content: '⏹️ Player parado e fila limpa.' });
      break;
    }

    case 'fila': {
      const fila = servidor!.fila;
      const tocando = servidor!.tocandoAgora;

      if (!tocando && fila.length === 0) {
        await interaction.editReply({ content: '📋 A fila está vazia.' });
        return;
      }

      const linhas = fila.slice(0, 15).map((m, i) =>
        `\`${i + 1}.\` **${m.titulo}** (${m.duracao}) — ${m.solicitadoPor}`
      );

      const embed = new EmbedBuilder()
        .setColor('#8B5CF6')
        .setTitle('📋 Fila de Músicas')
        .setDescription(
          (tocando ? `**🎵 Tocando agora:** ${tocando.titulo}\n\n` : '') +
          (linhas.length ? linhas.join('\n') : '*Sem próximas músicas*')
        )
        .setFooter({ text: `${fila.length} música(s) na fila • Loop: ${servidor!.loop ? '🔁 Ativo' : 'Inativo'}` });

      await interaction.editReply({ embeds: [embed] });
      break;
    }

    case 'tocando': {
      const tocando = servidor!.tocandoAgora;
      if (!tocando) {
        await interaction.editReply({ content: '❌ Nenhuma música tocando.' });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor('#8B5CF6')
        .setTitle('🎵 Tocando agora')
        .setDescription(`**[${tocando.titulo}](${tocando.url})**`)
        .addFields(
          { name: '⏱️ Duração', value: tocando.duracao, inline: true },
          { name: '📻 Fonte', value: tocando.fonte.charAt(0).toUpperCase() + tocando.fonte.slice(1), inline: true },
          { name: '👤 Pedido por', value: tocando.solicitadoPor, inline: true },
          { name: '📋 Na fila', value: `${servidor!.fila.length} música(s)`, inline: true },
          { name: '🔁 Loop', value: servidor!.loop ? 'Ativo' : 'Inativo', inline: true },
          { name: '🔊 Volume', value: `${servidor!.volume}%`, inline: true },
        );

      if (tocando.thumbnail) embed.setThumbnail(tocando.thumbnail);
      await interaction.editReply({ embeds: [embed] });
      break;
    }

    case 'loop': {
      servidor!.loop = !servidor!.loop;
      await interaction.editReply({
        content: servidor!.loop ? '🔁 Loop **ativado**!' : '➡️ Loop **desativado**.',
      });
      break;
    }

    case 'volume': {
      const valor = interaction.options.getInteger('valor', true);
      servidor!.volume = valor;

      // Aplica volume na stream atual
      const state = servidor!.player.state;
      if (state.status === AudioPlayerStatus.Playing) {
        (state.resource as any).volume?.setVolume(valor / 100);
      }

      await interaction.editReply({ content: `🔊 Volume ajustado para **${valor}%**.` });
      break;
    }

    case 'remover': {
      const pos = interaction.options.getInteger('posicao', true) - 1;
      if (pos >= servidor!.fila.length) {
        await interaction.editReply({ content: '❌ Posição inválida.' });
        return;
      }
      const removida = servidor!.fila.splice(pos, 1)[0];
      await interaction.editReply({ content: `🗑️ **${removida.titulo}** removida da fila.` });
      break;
    }

    default:
      await interaction.editReply({ content: '❌ Subcomando desconhecido.' });
  }
};
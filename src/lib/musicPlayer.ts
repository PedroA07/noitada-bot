import {
  AudioPlayer,
  AudioPlayerStatus,
  AudioResource,
  VoiceConnection,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
  StreamType,
} from '@discordjs/voice';
import { VoiceChannel, TextChannel, EmbedBuilder } from 'discord.js';
import playdl from 'play-dl';

export interface Musica {
  titulo: string;
  url: string;
  duracao: string;
  thumbnail: string | null;
  solicitadoPor: string;
  fonte: 'youtube' | 'spotify' | 'soundcloud';
}

export interface FilaServidor {
  connection: VoiceConnection;
  player: AudioPlayer;
  fila: Musica[];
  tocandoAgora: Musica | null;
  volume: number;
  loop: boolean;
  canalTexto: TextChannel;
}

// Mapa global de filas por servidor
export const filas = new Map<string, FilaServidor>();

// Converte segundos em mm:ss
export function formatarDuracao(segundos: number): string {
  if (!segundos || isNaN(segundos)) return '??:??';
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Detecta a fonte da URL
export function detectarFonte(url: string): 'youtube' | 'spotify' | 'soundcloud' | null {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('spotify.com')) return 'spotify';
  if (url.includes('soundcloud.com')) return 'soundcloud';
  return null;
}

// Busca informações da música
export async function buscarMusica(query: string, solicitadoPor: string): Promise<Musica[]> {
  const fonte = detectarFonte(query);

  try {
    // Spotify — converte para YouTube via play-dl
    if (fonte === 'spotify') {
      if (playdl.is_expired()) await playdl.refreshToken();

      const spotifyInfo = await playdl.spotify(query);

      if (spotifyInfo.type === 'track') {
        const track = spotifyInfo as playdl.SpotifyTrack;
        const busca = await playdl.search(`${track.name} ${track.artists[0]?.name || ''}`, { source: { youtube: 'video' }, limit: 1 });
        if (!busca.length) throw new Error('Música não encontrada no YouTube');
        const yt = busca[0];
        return [{
          titulo: track.name,
          url: yt.url,
          duracao: formatarDuracao(track.durationInSec),
          thumbnail: track.thumbnail?.url || null,
          solicitadoPor,
          fonte: 'spotify',
        }];
      }

      if (spotifyInfo.type === 'playlist' || spotifyInfo.type === 'album') {
        const lista = spotifyInfo as playdl.SpotifyPlaylist | playdl.SpotifyAlbum;
        const tracks = await lista.all_tracks();
        const musicas: Musica[] = [];
        for (const track of tracks.slice(0, 50)) {
          const busca = await playdl.search(`${track.name} ${track.artists[0]?.name || ''}`, { source: { youtube: 'video' }, limit: 1 });
          if (busca.length) {
            musicas.push({
              titulo: track.name,
              url: busca[0].url,
              duracao: formatarDuracao(track.durationInSec),
              thumbnail: track.thumbnail?.url || null,
              solicitadoPor,
              fonte: 'spotify',
            });
          }
        }
        return musicas;
      }
    }

    // YouTube — URL direta
    if (fonte === 'youtube') {
      const tipo = await playdl.validate(query);

      if (tipo === 'yt_video') {
        const info = await playdl.video_info(query);
        return [{
          titulo: info.video_details.title || 'Sem título',
          url: info.video_details.url,
          duracao: formatarDuracao(info.video_details.durationInSec),
          thumbnail: info.video_details.thumbnails[0]?.url || null,
          solicitadoPor,
          fonte: 'youtube',
        }];
      }

      if (tipo === 'yt_playlist') {
        const playlist = await playdl.playlist_info(query, { incomplete: true });
        const videos = await playlist.all_videos();
        return videos.slice(0, 50).map(v => ({
          titulo: v.title || 'Sem título',
          url: v.url,
          duracao: formatarDuracao(v.durationInSec),
          thumbnail: v.thumbnails[0]?.url || null,
          solicitadoPor,
          fonte: 'youtube',
        }));
      }
    }

    // SoundCloud — URL direta
    if (fonte === 'soundcloud') {
      const tipo = await playdl.validate(query);
      if (tipo === 'sc_track') {
        const info = await playdl.soundcloud(query) as playdl.SoundCloudTrack;
        return [{
          titulo: info.name,
          url: info.url,
          duracao: formatarDuracao(Math.floor(info.durationInMs / 1000)),
          thumbnail: info.thumbnail || null,
          solicitadoPor,
          fonte: 'soundcloud',
        }];
      }
    }

    // Busca por texto no YouTube
    const resultados = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
    if (!resultados.length) throw new Error('Nenhum resultado encontrado.');
    const v = resultados[0];
    return [{
      titulo: v.title || 'Sem título',
      url: v.url,
      duracao: formatarDuracao(v.durationInSec || 0),
      thumbnail: v.thumbnails[0]?.url || null,
      solicitadoPor,
      fonte: 'youtube',
    }];

  } catch (error: any) {
    throw new Error(`Erro ao buscar música: ${error.message}`);
  }
}

// Toca a próxima música da fila
export async function tocarProxima(guildId: string): Promise<void> {
  const servidor = filas.get(guildId);
  if (!servidor) return;

  if (servidor.fila.length === 0) {
    servidor.tocandoAgora = null;
    // Desconecta após 5 minutos sem músicas
    setTimeout(() => {
      const s = filas.get(guildId);
      if (s && !s.tocandoAgora) {
        s.connection.destroy();
        filas.delete(guildId);
      }
    }, 5 * 60 * 1000);
    return;
  }

  const musica = servidor.fila.shift()!;
  servidor.tocandoAgora = musica;

  try {
    const stream = await playdl.stream(musica.url, { quality: 2 });
    const resource: AudioResource = createAudioResource(stream.stream, {
      inputType: stream.type as StreamType,
      inlineVolume: true,
    });
    resource.volume?.setVolume(servidor.volume / 100);

    servidor.player.play(resource);

    // Envia embed no canal de texto
    const embed = new EmbedBuilder()
      .setColor('#8B5CF6')
      .setTitle('🎵 Tocando agora')
      .setDescription(`**[${musica.titulo}](${musica.url})**`)
      .addFields(
        { name: '⏱️ Duração', value: musica.duracao, inline: true },
        { name: '📻 Fonte', value: musica.fonte.charAt(0).toUpperCase() + musica.fonte.slice(1), inline: true },
        { name: '👤 Pedido por', value: musica.solicitadoPor, inline: true },
        { name: '📋 Na fila', value: `${servidor.fila.length} música(s)`, inline: true },
      )
      .setFooter({ text: '🔁 Loop: ' + (servidor.loop ? 'Ativo' : 'Inativo') });

    if (musica.thumbnail) embed.setThumbnail(musica.thumbnail);

    await servidor.canalTexto.send({ embeds: [embed] });

  } catch (error) {
    console.error('❌ Erro ao tocar música:', error);
    await servidor.canalTexto.send(`❌ Erro ao tocar **${musica.titulo}**. Pulando...`);
    await tocarProxima(guildId);
  }
}

// Conecta ao canal de voz e inicializa a fila
export async function conectar(canal: VoiceChannel, canalTexto: TextChannel, guildId: string): Promise<FilaServidor> {
  const connection = joinVoiceChannel({
    channelId: canal.id,
    guildId,
    adapterCreator: canal.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

  const player = createAudioPlayer();
  connection.subscribe(player);

  const servidor: FilaServidor = {
    connection,
    player,
    fila: [],
    tocandoAgora: null,
    volume: 80,
    loop: false,
    canalTexto,
  };

  filas.set(guildId, servidor);

  // Quando a música termina, toca a próxima
  player.on(AudioPlayerStatus.Idle, async () => {
    const s = filas.get(guildId);
    if (!s) return;

    if (s.loop && s.tocandoAgora) {
      s.fila.unshift(s.tocandoAgora);
    }

    await tocarProxima(guildId);
  });

  // Reconecta se desconectado
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      filas.delete(guildId);
    }
  });

  return servidor;
}
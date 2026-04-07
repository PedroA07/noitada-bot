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
import * as playdl from 'play-dl';
import { spawn } from 'child_process';

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

export const filas = new Map<string, FilaServidor>();

export function formatarDuracao(segundos: number): string {
  if (!segundos || isNaN(segundos)) return '??:??';
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function detectarFonte(url: string): 'youtube' | 'spotify' | 'soundcloud' | null {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('spotify.com')) return 'spotify';
  if (url.includes('soundcloud.com')) return 'soundcloud';
  return null;
}

function streamViaYtDlp(url: string): NodeJS.ReadableStream {
  const args = [
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '--no-playlist',
    '-o', '-',
    '--quiet',
    '--no-warnings',
  ];

  const cookie = process.env.YOUTUBE_COOKIE;
  if (cookie) {
    args.push('--add-header', `Cookie:${cookie}`);
  }

  args.push(url);

  console.log('Iniciando yt-dlp para:', url);
  const ytdlp = spawn('yt-dlp', args);

  ytdlp.stderr.on('data', (data: Buffer) => {
    console.error('yt-dlp:', data.toString().trim());
  });

  ytdlp.on('error', (err) => {
    console.error('Erro ao iniciar yt-dlp:', err.message);
  });

  return ytdlp.stdout;
}

async function configurarTokens() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    await playdl.setToken({
      spotify: {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        market: 'BR',
      },
    });
    console.log('Spotify configurado!');
  }

  const youtubeCookie = process.env.YOUTUBE_COOKIE;
  if (youtubeCookie) {
    await playdl.setToken({
      youtube: { cookie: youtubeCookie },
    });
    console.log('YouTube cookie configurado!');
  }
}

configurarTokens();

export async function buscarMusica(query: string, solicitadoPor: string): Promise<Musica[]> {
  const fonte = detectarFonte(query);

  try {
    if (fonte === 'spotify') {
      if (playdl.is_expired()) await playdl.refreshToken();

      const spotifyInfo = await playdl.spotify(query);

      if (spotifyInfo.type === 'track') {
        const track = spotifyInfo as any;
        const termoBusca = `${track.name} ${track.artists?.[0]?.name || ''}`;
        const busca = await playdl.search(termoBusca, { source: { youtube: 'video' }, limit: 5 });
        const resultado = busca.find((r: any) => r.url && r.url.startsWith('https://www.youtube.com/watch'));
        if (!resultado) throw new Error('Musica nao encontrada no YouTube');
        return [{
          titulo: track.name,
          url: resultado.url,
          duracao: formatarDuracao(track.durationInSec || 0),
          thumbnail: track.thumbnail?.url || null,
          solicitadoPor,
          fonte: 'spotify',
        }];
      }

      if (spotifyInfo.type === 'playlist' || spotifyInfo.type === 'album') {
        const lista = spotifyInfo as any;
        const tracks = await lista.all_tracks();
        const musicas: Musica[] = [];
        for (const track of tracks.slice(0, 50)) {
          const termoBusca = `${track.name} ${track.artists?.[0]?.name || ''}`;
          const busca = await playdl.search(termoBusca, { source: { youtube: 'video' }, limit: 5 });
          const resultado = busca.find((r: any) => r.url && r.url.startsWith('https://www.youtube.com/watch'));
          if (resultado) {
            musicas.push({
              titulo: track.name,
              url: resultado.url,
              duracao: formatarDuracao(track.durationInSec || 0),
              thumbnail: track.thumbnail?.url || null,
              solicitadoPor,
              fonte: 'spotify',
            });
          }
        }
        return musicas;
      }
    }

    if (fonte === 'youtube') {
      const tipo = await playdl.validate(query);

      if (tipo === 'yt_video') {
        const info = await playdl.video_info(query);
        const url = info.video_details.url;
        if (!url || !url.startsWith('http')) throw new Error('URL invalida retornada pelo YouTube');
        return [{
          titulo: info.video_details.title || 'Sem titulo',
          url,
          duracao: formatarDuracao(info.video_details.durationInSec || 0),
          thumbnail: info.video_details.thumbnails?.[0]?.url || null,
          solicitadoPor,
          fonte: 'youtube',
        }];
      }

      if (tipo === 'yt_playlist') {
        const playlist = await playdl.playlist_info(query, { incomplete: true });
        const videos = await playlist.all_videos();
        return videos
          .filter((v: any) => v.url && v.url.startsWith('http'))
          .slice(0, 50)
          .map((v: any) => ({
            titulo: v.title || 'Sem titulo',
            url: v.url,
            duracao: formatarDuracao(v.durationInSec || 0),
            thumbnail: v.thumbnails?.[0]?.url || null,
            solicitadoPor,
            fonte: 'youtube' as const,
          }));
      }
    }

    if (fonte === 'soundcloud') {
      const tipo = await playdl.validate(query);
      if (tipo === 'so_track') {
        const info = await playdl.soundcloud(query) as any;
        return [{
          titulo: info.name,
          url: info.url,
          duracao: formatarDuracao(Math.floor((info.durationInMs || 0) / 1000)),
          thumbnail: info.thumbnail || null,
          solicitadoPor,
          fonte: 'soundcloud',
        }];
      }
    }

    // Busca por texto no YouTube
    const resultados = await playdl.search(query, { source: { youtube: 'video' }, limit: 10 });
    if (!resultados.length) throw new Error('Nenhum resultado encontrado.');

    const v = resultados.find((r: any) => r.url && r.url.startsWith('https://www.youtube.com/watch'));
    if (!v) throw new Error('Nenhum resultado com URL valida encontrado.');

    return [{
      titulo: v.title || 'Sem titulo',
      url: v.url,
      duracao: formatarDuracao(v.durationInSec || 0),
      thumbnail: v.thumbnails?.[0]?.url || null,
      solicitadoPor,
      fonte: 'youtube',
    }];

  } catch (error: any) {
    throw new Error(`Erro ao buscar musica: ${error.message}`);
  }
}

export async function tocarProxima(guildId: string): Promise<void> {
  const servidor = filas.get(guildId);
  if (!servidor) return;

  if (servidor.fila.length === 0) {
    servidor.tocandoAgora = null;
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

  if (!musica.url || !musica.url.startsWith('http')) {
    console.error('URL invalida:', musica.url);
    await servidor.canalTexto.send(`URL invalida para **${musica.titulo}**. Pulando...`);
    await tocarProxima(guildId);
    return;
  }

  try {
    const stream = streamViaYtDlp(musica.url);
    const resource: AudioResource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
    });
    resource.volume?.setVolume(servidor.volume / 100);
    servidor.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor('#8B5CF6')
      .setTitle('Tocando agora')
      .setDescription(`**[${musica.titulo}](${musica.url})**`)
      .addFields(
        { name: 'Duracao', value: musica.duracao, inline: true },
        { name: 'Fonte', value: musica.fonte.charAt(0).toUpperCase() + musica.fonte.slice(1), inline: true },
        { name: 'Pedido por', value: musica.solicitadoPor, inline: true },
        { name: 'Na fila', value: `${servidor.fila.length} musica(s)`, inline: true },
      )
      .setFooter({ text: 'Loop: ' + (servidor.loop ? 'Ativo' : 'Inativo') });

    if (musica.thumbnail) embed.setThumbnail(musica.thumbnail);
    await servidor.canalTexto.send({ embeds: [embed] });

  } catch (error) {
    console.error('Erro ao tocar musica:', error);
    await servidor.canalTexto.send(`Erro ao tocar **${musica.titulo}**. Pulando...`);
    await tocarProxima(guildId);
  }
}

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

  player.on(AudioPlayerStatus.Idle, async () => {
    const s = filas.get(guildId);
    if (!s) return;
    if (s.loop && s.tocandoAgora) {
      s.fila.unshift(s.tocandoAgora);
    }
    await tocarProxima(guildId);
  });

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
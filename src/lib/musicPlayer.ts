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

export const filas = new Map<string, FilaServidor>();

export function formatarDuracao(segundos: number): string {
  if (!segundos || isNaN(segundos)) return '??:??';
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function detectarFonte(url: string): 'youtube' | 'spotify' | 'soundcloud' | 'texto' {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('spotify.com')) return 'spotify';
  if (url.includes('soundcloud.com')) return 'soundcloud';
  return 'texto';
}

// ── Spotify via API oficial → resolve para YouTube ───────────────────────────

async function getSpotifyToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Credenciais Spotify não configuradas');

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) throw new Error(`Spotify token falhou: ${resp.status}`);
  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

function parseSpotifyUrl(url: string): { tipo: string; id: string } | null {
  const match = url.match(/spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/);
  return match ? { tipo: match[1], id: match[2] } : null;
}

interface SpotifyTrack {
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album?: { images: { url: string }[] };
}

async function resolverSpotifyParaYT(nome: string, artista: string): Promise<{ url: string; duracao: number } | null> {
  try {
    const query = `${nome} ${artista}`.trim();
    const results = await playdl.search(query, { limit: 1, source: { youtube: 'video' } });
    if (!results.length) return null;
    return { url: results[0].url, duracao: results[0].durationInSec || 0 };
  } catch {
    return null;
  }
}

async function buscarSpotify(url: string, solicitadoPor: string): Promise<Musica[]> {
  const token = await getSpotifyToken();
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new Error('URL Spotify inválida');

  const headers = { Authorization: `Bearer ${token}` };

  if (parsed.tipo === 'track') {
    const resp = await fetch(`https://api.spotify.com/v1/tracks/${parsed.id}`, { headers });
    if (!resp.ok) throw new Error(`Spotify API falhou: ${resp.status}`);
    const track = await resp.json() as SpotifyTrack;
    const yt = await resolverSpotifyParaYT(track.name, track.artists[0]?.name || '');
    if (!yt) throw new Error('Música não encontrada no YouTube');
    return [{
      titulo: track.name,
      url: yt.url,
      duracao: formatarDuracao(Math.floor(track.duration_ms / 1000)),
      thumbnail: track.album?.images?.[0]?.url || null,
      solicitadoPor,
      fonte: 'spotify',
    }];
  }

  if (parsed.tipo === 'playlist') {
    const resp = await fetch(`https://api.spotify.com/v1/playlists/${parsed.id}/tracks?limit=50`, { headers });
    if (!resp.ok) throw new Error(`Spotify API falhou: ${resp.status}`);
    const data = await resp.json() as { items: { track: SpotifyTrack }[] };
    const musicas: Musica[] = [];
    for (const item of data.items.slice(0, 50)) {
      if (!item.track) continue;
      try {
        const yt = await resolverSpotifyParaYT(item.track.name, item.track.artists[0]?.name || '');
        if (yt) {
          musicas.push({
            titulo: item.track.name,
            url: yt.url,
            duracao: formatarDuracao(Math.floor(item.track.duration_ms / 1000)),
            thumbnail: item.track.album?.images?.[0]?.url || null,
            solicitadoPor,
            fonte: 'spotify',
          });
        }
      } catch {
        console.warn('Erro ao resolver track Spotify:', item.track.name);
      }
    }
    if (!musicas.length) throw new Error('Nenhuma música da playlist encontrada');
    return musicas;
  }

  if (parsed.tipo === 'album') {
    const resp = await fetch(`https://api.spotify.com/v1/albums/${parsed.id}/tracks?limit=50`, { headers });
    if (!resp.ok) throw new Error(`Spotify API falhou: ${resp.status}`);
    const data = await resp.json() as { items: SpotifyTrack[] };
    const musicas: Musica[] = [];
    for (const track of data.items.slice(0, 50)) {
      try {
        const yt = await resolverSpotifyParaYT(track.name, track.artists[0]?.name || '');
        if (yt) {
          musicas.push({
            titulo: track.name,
            url: yt.url,
            duracao: formatarDuracao(Math.floor(track.duration_ms / 1000)),
            thumbnail: null,
            solicitadoPor,
            fonte: 'spotify',
          });
        }
      } catch {
        console.warn('Erro ao resolver track álbum:', track.name);
      }
    }
    if (!musicas.length) throw new Error('Nenhuma música do álbum encontrada');
    return musicas;
  }

  throw new Error('Tipo Spotify não suportado');
}

// ── Busca principal ───────────────────────────────────────────────────────────

export async function buscarMusica(query: string, solicitadoPor: string): Promise<Musica[]> {
  const fonte = detectarFonte(query);

  try {
    if (fonte === 'spotify') {
      return await buscarSpotify(query, solicitadoPor);
    }

    if (fonte === 'youtube') {
      const isPlaylist = query.includes('list=') || query.includes('/playlist');

      if (isPlaylist) {
        const playlist = await playdl.playlist_info(query, { incomplete: true });
        const videos = await playlist.all_videos();
        return videos.slice(0, 50).map(v => ({
          titulo: v.title || 'Sem título',
          url: v.url,
          duracao: formatarDuracao(v.durationInSec || 0),
          thumbnail: v.thumbnails?.[0]?.url || null,
          solicitadoPor,
          fonte: 'youtube' as const,
        }));
      }

      // URL de vídeo único
      const info = await playdl.video_info(query);
      const v = info.video_details;
      return [{
        titulo: v.title || 'Sem título',
        url: v.url,
        duracao: formatarDuracao(v.durationInSec || 0),
        thumbnail: v.thumbnails?.[0]?.url || null,
        solicitadoPor,
        fonte: 'youtube' as const,
      }];
    }

    if (fonte === 'soundcloud') {
      const scInfo = await playdl.soundcloud(query);
      if (scInfo.type === 'track') {
        return [{
          titulo: scInfo.name,
          url: scInfo.url,
          duracao: formatarDuracao(Math.floor(scInfo.durationInMs / 1000)),
          thumbnail: (scInfo as any).thumbnail || null,
          solicitadoPor,
          fonte: 'soundcloud' as const,
        }];
      }
      throw new Error('Tipo SoundCloud não suportado');
    }

    // Busca por texto no YouTube
    const results = await playdl.search(query, { limit: 1, source: { youtube: 'video' } });
    if (!results.length) throw new Error('Nenhum resultado encontrado');
    const v = results[0];
    return [{
      titulo: v.title || 'Sem título',
      url: v.url,
      duracao: formatarDuracao(v.durationInSec || 0),
      thumbnail: v.thumbnails?.[0]?.url || null,
      solicitadoPor,
      fonte: 'youtube' as const,
    }];

  } catch (error: any) {
    throw new Error(`Erro ao buscar música: ${error.message}`);
  }
}

// ── Player ────────────────────────────────────────────────────────────────────

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

  try {
    const stream = await playdl.stream(musica.url, { quality: 2 });
    const resource: AudioResource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });
    resource.volume?.setVolume(servidor.volume / 100);
    servidor.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor('#8B5CF6')
      .setTitle('🎵 Tocando agora')
      .setDescription(`**[${musica.titulo}](${musica.url})**`)
      .addFields(
        { name: '⏱️ Duração', value: musica.duracao, inline: true },
        { name: '📡 Fonte', value: musica.fonte.charAt(0).toUpperCase() + musica.fonte.slice(1), inline: true },
        { name: '👤 Pedido por', value: musica.solicitadoPor, inline: true },
        { name: '📋 Na fila', value: `${servidor.fila.length} música(s)`, inline: true },
      )
      .setFooter({ text: 'Loop: ' + (servidor.loop ? '🔁 Ativo' : '➡️ Inativo') });

    if (musica.thumbnail) embed.setThumbnail(musica.thumbnail);
    await servidor.canalTexto.send({ embeds: [embed] });

  } catch (error) {
    console.error('Erro ao tocar música:', error);
    await servidor.canalTexto.send(`❌ Erro ao tocar **${musica.titulo}**. Pulando...`);
    setTimeout(() => tocarProxima(guildId), 500);
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

  player.on('error', async (error) => {
    console.error('Erro no AudioPlayer:', error);
    const s = filas.get(guildId);
    if (s) {
      await s.canalTexto.send(`❌ Erro ao reproduzir. Pulando para próxima...`);
      setTimeout(() => tocarProxima(guildId), 500);
    }
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

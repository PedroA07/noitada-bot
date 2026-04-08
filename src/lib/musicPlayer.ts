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
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

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

const ytdlpPath = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';
const cookiePath = join('/tmp', 'yt-cookies.txt');

// Cria arquivo de cookie no formato Netscape a partir da env
function garantirCookieFile(): string | null {
  const cookie = process.env.YOUTUBE_COOKIE;
  if (!cookie) return null;

  if (!existsSync(cookiePath)) {
    try {
      // Converte string de cookie em formato Netscape
      const linhas = ['# Netscape HTTP Cookie File', '# https://curl.haxx.se/rfc/cookie_spec.html', ''];
      const pares = cookie.split(';').map(p => p.trim()).filter(Boolean);
      for (const par of pares) {
        const idx = par.indexOf('=');
        if (idx === -1) continue;
        const nome = par.substring(0, idx).trim();
        const valor = par.substring(idx + 1).trim();
        linhas.push(`.youtube.com\tTRUE\t/\tTRUE\t2147483647\t${nome}\t${valor}`);
      }
      writeFileSync(cookiePath, linhas.join('\n'));
      console.log('Cookie file criado em:', cookiePath);
    } catch (e) {
      console.error('Erro ao criar cookie file:', e);
      return null;
    }
  }
  return cookiePath;
}

function getYtDlpBaseArgs(): string[] {
  const args: string[] = ['--no-warnings', '--quiet'];
  const cf = garantirCookieFile();
  if (cf) {
    args.push('--cookies', cf);
  }
  return args;
}

interface YtDlpInfo {
  title: string;
  webpage_url: string;
  duration: number;
  thumbnail: string;
}

async function ytdlpGetInfo(query: string, isPlaylist = false): Promise<YtDlpInfo[]> {
  return new Promise((resolve, reject) => {
    const args = [
      ...getYtDlpBaseArgs(),
      '--dump-json',
      '--flat-playlist',
    ];

    if (!isPlaylist) args.push('--no-playlist');

    if (!query.startsWith('http')) {
      args.push(`ytsearch1:${query}`);
    } else {
      args.push(query);
    }

    const proc = spawn(ytdlpPath, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout) {
        return reject(new Error(`yt-dlp falhou (code ${code}): ${stderr.trim()}`));
      }
      try {
        const linhas = stdout.trim().split('\n').filter(Boolean);
        const infos = linhas.map(l => JSON.parse(l));
        resolve(infos);
      } catch {
        reject(new Error('Falha ao parsear JSON do yt-dlp'));
      }
    });

    proc.on('error', (e) => reject(new Error(`Erro ao iniciar yt-dlp: ${e.message}`)));
  });
}

// Busca token Spotify via Client Credentials
async function getSpotifyToken(): Promise<string> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Credenciais Spotify nao configuradas');

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

// Extrai ID e tipo da URL do Spotify
function parseSpotifyUrl(url: string): { tipo: string; id: string } | null {
  const match = url.match(/spotify\.com\/(track|playlist|album)\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  return { tipo: match[1], id: match[2] };
}

interface SpotifyTrack {
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album?: { images: { url: string }[] };
}

async function buscarSpotify(url: string, solicitadoPor: string): Promise<Musica[]> {
  const token = await getSpotifyToken();
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new Error('URL Spotify invalida');

  const headers = { Authorization: `Bearer ${token}` };

  if (parsed.tipo === 'track') {
    const resp = await fetch(`https://api.spotify.com/v1/tracks/${parsed.id}`, { headers });
    if (!resp.ok) throw new Error(`Spotify API falhou: ${resp.status}`);
    const track = await resp.json() as SpotifyTrack;
    const query = `${track.name} ${track.artists[0]?.name || ''}`;
    const infos = await ytdlpGetInfo(query, false);
    if (!infos.length) throw new Error('Musica nao encontrada no YouTube');
    return [{
      titulo: track.name,
      url: infos[0].webpage_url,
      duracao: formatarDuracao(Math.floor(track.duration_ms / 1000)),
      thumbnail: track.album?.images?.[0]?.url || infos[0].thumbnail || null,
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
        const query = `${item.track.name} ${item.track.artists[0]?.name || ''}`;
        const infos = await ytdlpGetInfo(query, false);
        if (infos.length) {
          musicas.push({
            titulo: item.track.name,
            url: infos[0].webpage_url,
            duracao: formatarDuracao(Math.floor(item.track.duration_ms / 1000)),
            thumbnail: item.track.album?.images?.[0]?.url || null,
            solicitadoPor,
            fonte: 'spotify',
          });
        }
      } catch (e) {
        console.warn('Erro ao buscar track Spotify:', item.track.name);
      }
    }
    if (!musicas.length) throw new Error('Nenhuma musica da playlist encontrada');
    return musicas;
  }

  if (parsed.tipo === 'album') {
    const resp = await fetch(`https://api.spotify.com/v1/albums/${parsed.id}/tracks?limit=50`, { headers });
    if (!resp.ok) throw new Error(`Spotify API falhou: ${resp.status}`);
    const data = await resp.json() as { items: SpotifyTrack[] };
    const musicas: Musica[] = [];
    for (const track of data.items.slice(0, 50)) {
      try {
        const query = `${track.name} ${track.artists[0]?.name || ''}`;
        const infos = await ytdlpGetInfo(query, false);
        if (infos.length) {
          musicas.push({
            titulo: track.name,
            url: infos[0].webpage_url,
            duracao: formatarDuracao(Math.floor(track.duration_ms / 1000)),
            thumbnail: null,
            solicitadoPor,
            fonte: 'spotify',
          });
        }
      } catch {
        console.warn('Erro ao buscar track album:', track.name);
      }
    }
    if (!musicas.length) throw new Error('Nenhuma musica do album encontrada');
    return musicas;
  }

  throw new Error('Tipo Spotify nao suportado');
}

function streamViaYtDlp(url: string): Readable {
  console.log('Iniciando stream yt-dlp:', url);

  const args = [
    ...getYtDlpBaseArgs(),
    '-f', 'bestaudio/best',
    '--no-playlist',
    '-o', '-',
    url,
  ];

  const ytdlp = spawn(ytdlpPath, args);

  ytdlp.stderr.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.error('yt-dlp stderr:', msg);
  });

  ytdlp.on('error', (err: Error) => {
    console.error('Erro yt-dlp spawn:', err.message);
  });

  return ytdlp.stdout as unknown as Readable;
}

export async function buscarMusica(query: string, solicitadoPor: string): Promise<Musica[]> {
  const fonte = detectarFonte(query);

  try {
    if (fonte === 'spotify') {
      console.log('Buscando Spotify via API...');
      return await buscarSpotify(query, solicitadoPor);
    }

    if (fonte === 'youtube') {
      const isPlaylist = query.includes('list=') || query.includes('/playlist');
      const infos = await ytdlpGetInfo(query, isPlaylist);
      if (!infos.length) throw new Error('Nenhum resultado YouTube encontrado');
      return infos.slice(0, 50).map(info => ({
        titulo: info.title || 'Sem titulo',
        url: info.webpage_url || query,
        duracao: formatarDuracao(info.duration || 0),
        thumbnail: info.thumbnail || null,
        solicitadoPor,
        fonte: 'youtube' as const,
      }));
    }

    if (fonte === 'soundcloud') {
      const infos = await ytdlpGetInfo(query, false);
      if (!infos.length) throw new Error('Nenhum resultado SoundCloud');
      return [{
        titulo: infos[0].title || 'Sem titulo',
        url: infos[0].webpage_url || query,
        duracao: formatarDuracao(infos[0].duration || 0),
        thumbnail: infos[0].thumbnail || null,
        solicitadoPor,
        fonte: 'soundcloud' as const,
      }];
    }

    // Busca por texto
    console.log('Buscando por texto no YouTube:', query);
    const infos = await ytdlpGetInfo(query, false);
    if (!infos.length) throw new Error('Nenhum resultado encontrado');
    return [{
      titulo: infos[0].title || 'Sem titulo',
      url: infos[0].webpage_url,
      duracao: formatarDuracao(infos[0].duration || 0),
      thumbnail: infos[0].thumbnail || null,
      solicitadoPor,
      fonte: 'youtube' as const,
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
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
import { spawn, execSync } from 'child_process';
import { Readable } from 'stream';

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

function getYtDlpBaseArgs(): string[] {
  const args: string[] = [
    '--no-warnings',
    '--quiet',
  ];
  const cookie = process.env.YOUTUBE_COOKIE;
  if (cookie) {
    args.push('--add-header', `Cookie:${cookie}`);
  }
  return args;
}

interface YtDlpInfo {
  title: string;
  webpage_url: string;
  duration: number;
  thumbnail: string;
  entries?: YtDlpInfo[];
}

async function ytdlpGetInfo(query: string, isPlaylist = false): Promise<YtDlpInfo[]> {
  return new Promise((resolve, reject) => {
    const args = [
      ...getYtDlpBaseArgs(),
      '--dump-json',
      '--flat-playlist',
    ];

    if (!isPlaylist) {
      args.push('--no-playlist');
    }

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
      } catch (e) {
        reject(new Error('Falha ao parsear JSON do yt-dlp'));
      }
    });

    proc.on('error', (e) => reject(new Error(`Erro ao iniciar yt-dlp: ${e.message}`)));
  });
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
    // Spotify — converte para busca no YouTube
    if (fonte === 'spotify') {
      console.log('Detectado Spotify, buscando via yt-dlp...');
      const isPlaylist = query.includes('/playlist/') || query.includes('/album/');

      const infos = await ytdlpGetInfo(query, isPlaylist);

      if (!infos.length) throw new Error('Nenhum resultado Spotify encontrado');

      const musicas: Musica[] = infos.slice(0, 50).map(info => ({
        titulo: info.title || 'Sem titulo',
        url: info.webpage_url || query,
        duracao: formatarDuracao(info.duration || 0),
        thumbnail: info.thumbnail || null,
        solicitadoPor,
        fonte: 'spotify' as const,
      }));

      return musicas;
    }

    // YouTube URL
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

    // SoundCloud
    if (fonte === 'soundcloud') {
      const infos = await ytdlpGetInfo(query, false);
      if (!infos.length) throw new Error('Nenhum resultado SoundCloud encontrado');
      const info = infos[0];
      return [{
        titulo: info.title || 'Sem titulo',
        url: info.webpage_url || query,
        duracao: formatarDuracao(info.duration || 0),
        thumbnail: info.thumbnail || null,
        solicitadoPor,
        fonte: 'soundcloud' as const,
      }];
    }

    // Busca por texto
    console.log('Buscando por texto no YouTube:', query);
    const infos = await ytdlpGetInfo(query, false);
    if (!infos.length) throw new Error('Nenhum resultado encontrado');

    const info = infos[0];
    return [{
      titulo: info.title || 'Sem titulo',
      url: info.webpage_url || `https://www.youtube.com/watch?v=${info.webpage_url}`,
      duracao: formatarDuracao(info.duration || 0),
      thumbnail: info.thumbnail || null,
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
        { name: 'Duração', value: musica.duracao, inline: true },
        { name: 'Fonte', value: musica.fonte.charAt(0).toUpperCase() + musica.fonte.slice(1), inline: true },
        { name: 'Pedido por', value: musica.solicitadoPor, inline: true },
        { name: 'Na fila', value: `${servidor.fila.length} música(s)`, inline: true },
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
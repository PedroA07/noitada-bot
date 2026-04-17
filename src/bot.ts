import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
  Collection,
} from 'discord.js';

import { iniciarBoasVindas } from './scripts/boasVindas';
import { iniciarFilaCargos } from './scripts/filaCargos';
import { iniciarMonitorDeStatus } from './monitorStatus';
import { iniciarSpawnAutomatico } from './lib/spawnAutomatico';
import { supabase } from './lib/supabase';

import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
process.env.FFMPEG_PATH = ffmpeg.path;

dotenv.config();

// Garante que o ffmpeg está disponível
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  process.env.FFMPEG_PATH = ffmpegInstaller.path;
  console.log('ffmpeg configurado:', ffmpegInstaller.path);
} catch (e) {
  console.warn('ffmpeg-installer nao encontrado, usando ffmpeg do sistema');
}


// ============================================================
// Validação das variáveis obrigatórias
// ============================================================
const varsObrigatorias = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
  'DISCORD_CLIENT_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

for (const v of varsObrigatorias) {
  if (!process.env[v]) {
    console.error(`❌ Variável de ambiente "${v}" não definida no .env`);
    process.exit(1);
  }
}

// ============================================================
// Inicialização do client Discord
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ============================================================
// Command Handler — carrega automaticamente da pasta /commands
// ============================================================
const comandos = new Collection<string, any>();
const comandosJSON: any[] = [];

const pastasPath = path.join(__dirname, 'commands');

if (fs.existsSync(pastasPath)) {
  const pastas = fs.readdirSync(pastasPath);

  for (const pasta of pastas) {
    const caminhoPasta = path.join(pastasPath, pasta);
    if (!fs.statSync(caminhoPasta).isDirectory()) continue;

    const arquivos = fs
      .readdirSync(caminhoPasta)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.js'));

    for (const arquivo of arquivos) {
      const comando = require(path.join(caminhoPasta, arquivo));
      if ('data' in comando && 'execute' in comando) {
        comandos.set(comando.data.name, comando);
        comandosJSON.push(comando.data.toJSON());
      }
    }
  }
}

// ============================================================
// Evento: Bot pronto
// ============================================================
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN!);

client.once('ready', async () => {
  console.log(`\n🦉 A Lua (${client.user?.tag}) está VIVA!\n`);

  // DEBUG — descobre onde o yt-dlp está instalado
  const ytdlpPath = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';
  if (existsSync(ytdlpPath)) {
    try {
      const version = execSync(`${ytdlpPath} --version`).toString().trim();
      console.log(`yt-dlp encontrado: ${version}`);
    } catch {
      console.warn('yt-dlp existe mas nao executou corretamente');
    }
  } else {
    console.error(`yt-dlp NAO encontrado em: ${ytdlpPath}`);
  }

  // Registra os slash commands no servidor
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID!,
        process.env.DISCORD_GUILD_ID!
      ),
      { body: comandosJSON }
    );
    console.log(`📁 ${comandos.size} comando(s) sincronizado(s).`);
  } catch (error) {
    console.error('❌ Erro ao sincronizar comandos:', error);
  }

  // Inicia todos os sistemas do bot
  iniciarBoasVindas(client);
  iniciarFilaCargos(client);
  iniciarMonitorDeStatus(client);
  iniciarSpawnAutomatico(client);
});

// ============================================================
// Handler: botão de cargo de cor
// ============================================================
async function handleBotaoCor(interaction: any, cargoId: string) {
  const guildId = process.env.DISCORD_GUILD_ID!;
  const token   = process.env.DISCORD_BOT_TOKEN!;
  const userId  = interaction.user.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { data: cfg } = await supabase
      .from('configuracoes_cores')
      .select('cargos_solidos, cargos_gradientes, cargos_permitidos_solidos, cargos_permitidos_gradientes')
      .eq('guild_id', guildId)
      .maybeSingle();

    const solidos:    string[] = cfg?.cargos_solidos    || [];
    const gradientes: string[] = cfg?.cargos_gradientes || [];
    const todosCorCargos       = [...solidos, ...gradientes];

    const isSolido    = solidos.includes(cargoId);
    const isGradiente = gradientes.includes(cargoId);

    if (!isSolido && !isGradiente) {
      return interaction.editReply({ content: '❌ Cargo inválido.' });
    }

    // Busca dados do membro
    const resM = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!resM.ok) {
      return interaction.editReply({ content: '❌ Não foi possível buscar seus dados.' });
    }
    const membro = await resM.json();
    const rolesAtuais: string[] = membro.roles || [];

    // Verifica permissão (se configurada)
    const permitidosSolidos:    string[] = cfg?.cargos_permitidos_solidos    || [];
    const permitidosGradientes: string[] = cfg?.cargos_permitidos_gradientes || [];

    if (isSolido && permitidosSolidos.length > 0) {
      const temPermissao = rolesAtuais.some(r => permitidosSolidos.includes(r));
      if (!temPermissao) {
        return interaction.editReply({ content: '❌ Você não tem o cargo necessário para escolher cores sólidas.' });
      }
    }
    if (isGradiente && permitidosGradientes.length > 0) {
      const temPermissao = rolesAtuais.some(r => permitidosGradientes.includes(r));
      if (!temPermissao) {
        return interaction.editReply({ content: '❌ Você não tem o cargo necessário para escolher cores gradiente.' });
      }
    }

    // Remove todos os outros cargos de cor que o usuário já tem
    const cargosParaRemover = todosCorCargos.filter(id => rolesAtuais.includes(id) && id !== cargoId);
    for (const id of cargosParaRemover) {
      await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${token}` },
      });
    }

    // Toggle: se já tem o cargo clicado, remove (deselecionar); senão, adiciona
    if (rolesAtuais.includes(cargoId)) {
      await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${cargoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bot ${token}` },
      });
      return interaction.editReply({ content: '✅ Cargo de cor removido!' });
    } else {
      await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${cargoId}`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${token}` },
      });
      return interaction.editReply({ content: '✅ Cargo de cor aplicado!' });
    }
  } catch (err) {
    console.error('❌ Erro no botão de cor:', err);
    try { await interaction.editReply({ content: '❌ Ocorreu um erro. Tente novamente.' }); } catch {}
  }
}

// ============================================================
// Evento: Interações (slash commands + botões)
// ============================================================
client.on('interactionCreate', async (interaction: any) => {
  // Botões de cargo de cor
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('cor:')) {
      const partes  = interaction.customId.split(':');
      const cargoId = partes[1];
      await handleBotaoCor(interaction, cargoId);
    }
    return;
  }

  // Autocomplete
  if (interaction.isAutocomplete()) {
    const comando = comandos.get(interaction.commandName);
    if (!comando?.autocomplete) return;
    try {
      await comando.autocomplete(interaction);
    } catch (error) {
      console.error('❌ Erro no autocomplete:', error);
    }
    return;
  }

  // Slash commands
  if (!interaction.isChatInputCommand()) return;

  const comando = comandos.get(interaction.commandName);
  if (!comando) return;

  try {
    await comando.execute(interaction);
  } catch (error) {
    console.error(`❌ Erro no comando /${interaction.commandName}:`, error);
    const resposta = {
      content: 'Ops! A Lua tropeçou nos fios. 🦉🔧',
      flags: MessageFlags.Ephemeral,
    };
    interaction.replied || interaction.deferred
      ? await interaction.followUp(resposta)
      : await interaction.reply(resposta);
  }
});

// ============================================================
// Login
// ============================================================
client.login(process.env.DISCORD_BOT_TOKEN);
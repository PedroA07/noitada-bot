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

dotenv.config();

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
// Evento: Interações (slash commands)
// ============================================================
client.on('interactionCreate', async (interaction: any) => {
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
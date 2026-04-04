# 🦉 NOITADA BOT — Lua

Bot Discord da NOITADA. Repositório separado do sistema web (`noitada-web`).

---

## 📁 Estrutura

```
noitada-bot/
├── src/
│   ├── bot.ts                    # Arquivo principal
│   ├── monitorStatus.ts          # Atualiza status online/offline no banco
│   ├── lib/
│   │   └── supabase.ts           # Cliente Supabase (service role key)
│   ├── scripts/
│   │   ├── boasVindas.ts         # Mensagem ao entrar no servidor
│   │   └── filaCargos.ts         # Processa fila e entrega cargos
│   └── commands/                 # Slash commands (uma pasta por categoria)
│       └── utilitarios/
│           └── ping.ts           # Exemplo
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## ⚙️ Setup local

### 1. Instale as dependências
```bash
npm install
```

### 2. Configure o `.env`
```bash
cp .env.example .env
```

Preencha:
```env
DISCORD_BOT_TOKEN=     # Bot > Token no Discord Developer Portal
DISCORD_GUILD_ID=      # ID do servidor (clique direito no servidor > Copiar ID)
DISCORD_CLIENT_ID=     # ID do bot (Aplicação > General Information > Application ID)
SUPABASE_URL=          # Supabase > Settings > API > Project URL
SUPABASE_SERVICE_ROLE_KEY=  # Supabase > Settings > API > service_role
```

### 3. Rode em desenvolvimento
```bash
npm run dev
```

---

## 🚀 Deploy no Railway

1. Crie um projeto no Railway e conecte ao repositório `noitada-bot`
2. Adicione as variáveis de ambiente (as mesmas do `.env`)
3. O Railway faz deploy automático a cada `git push`

---

## 🔗 Como funciona a integração com o site

O bot **não expõe nenhuma API HTTP**. A comunicação é feita via Supabase:

1. Usuário conclui cadastro no site (`noitada-web`)
2. Site insere uma linha na tabela `fila_cargos` com `status = 'pendente'`
3. Bot escuta a tabela via Supabase Realtime
4. Bot busca `cargo_membro_id` na tabela `configuracoes_servidor`
5. Bot entrega o cargo no Discord e marca `status = 'concluido'`

---

## 🎮 Intents necessários no Discord Developer Portal

Acesse: https://discord.com/developers/applications → seu bot → **Bot**

Ative:
- ✅ **SERVER MEMBERS INTENT**
- ✅ **PRESENCE INTENT**
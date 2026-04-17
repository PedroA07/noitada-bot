import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { supabase } from '../../lib/supabase';

export const data = new SlashCommandBuilder()
  .setName('cores')
  .setDescription('Escolha seu cargo de cor pessoal');

export async function execute(interaction: any) {
  const guildId = process.env.DISCORD_GUILD_ID!;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Busca configuração de cores
    const { data: cfg } = await supabase
      .from('configuracoes_cores')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();

    const solidos: string[]    = cfg?.cargos_solidos    || [];
    const gradientes: string[] = cfg?.cargos_gradientes || [];

    if (!solidos.length && !gradientes.length) {
      return interaction.editReply({
        content: '⚠️ Nenhum cargo de cor configurado ainda.',
      });
    }

    // Busca todos os cargos do servidor para obter nomes e cores
    const token = process.env.DISCORD_BOT_TOKEN!;
    const resRoles = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${token}` },
    });
    const todosCargos: any[] = resRoles.ok ? await resRoles.json() : [];
    const mapaRoles = new Map(todosCargos.map((r: any) => [r.id, r]));

    // Monta as linhas de botões (máx. 5 por linha, máx. 5 linhas = 25 botões)
    const todosIds = [...solidos, ...gradientes];
    const components: any[] = [];

    for (let i = 0; i < todosIds.length && i < 25; i += 5) {
      const linha = todosIds.slice(i, i + 5).map(id => {
        const role = mapaRoles.get(id) as any;
        const isSolido = solidos.includes(id);
        return {
          type: 2,           // Button
          style: 2,          // Secondary (cinza)
          label: role?.name ?? 'Cor',
          custom_id: `cor:${id}:${isSolido ? 's' : 'g'}`,
          emoji: isSolido ? { name: '🎨' } : { name: '✨' },
        };
      });
      components.push({ type: 1, components: linha }); // ActionRow
    }

    // Cor do embed em inteiro
    const corHex = (cfg?.cor_embed || '#EC4899').replace('#', '');
    const corInt = parseInt(corHex, 16);

    // Monta campos do embed com as menções de cargo
    const fields: any[] = [];
    if (solidos.length) {
      fields.push({
        name: '🎨 Cores Sólidas',
        value: solidos.map(id => `<@&${id}>`).join(' ') || '\u200b',
        inline: true,
      });
    }
    if (gradientes.length) {
      fields.push({
        name: '✨ Gradientes',
        value: gradientes.map(id => `<@&${id}>`).join(' ') || '\u200b',
        inline: true,
      });
    }

    const embed = {
      title:       cfg?.titulo_embed || '🎨 Cargos de Cor',
      color:       corInt,
      description: 'Clique em um botão para escolher sua cor. Você pode ter **apenas uma** cor por vez — clicar em outra troca automaticamente.',
      fields,
      footer:      { text: 'NOITADA · Sistema de Cores' },
    };

    await interaction.editReply({ embeds: [embed], components });
  } catch (err) {
    console.error('❌ Erro no comando /cores:', err);
    await interaction.editReply({ content: '❌ Ocorreu um erro. Tente novamente.' });
  }
}

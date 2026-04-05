import { 
  SlashCommandBuilder, 
  ChatInputCommandInteraction, 
  EmbedBuilder, 
  AutocompleteInteraction 
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('dado')
  .setDescription('Rola dados de RPG na Noitada (ex: 2d20 + 3)')
  .addIntegerOption(option =>
    option.setName('quantidade')
      .setDescription('Quantos dados você quer rolar?')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100)
  )
  .addIntegerOption(option =>
    option.setName('tipo')
      .setDescription('Tipo do dado (quantas faces?)')
      .setRequired(true)
      .addChoices(
        { name: 'd4', value: 4 }, { name: 'd6', value: 6 },
        { name: 'd8', value: 8 }, { name: 'd10', value: 10 },
        { name: 'd12', value: 12 }, { name: 'd20', value: 20 },
        { name: 'd100', value: 100 }
      )
  )
  .addStringOption(option =>
    option.setName('modificador')
      .setDescription('Insira os modificadores ou penalidades (Ex: +2 -1 +4)')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option.setName('condicao')
      .setDescription('Rolar com Vantagem ou Desvantagem?')
      .setRequired(false)
      .addChoices(
        { name: '🟢 Vantagem', value: 'vantagem' },
        { name: '🔴 Desvantagem', value: 'desvantagem' }
      )
  )
  .addStringOption(option =>
    option.setName('separado')
      .setDescription('Mostrar o valor de cada dado individualmente?')
      .setRequired(false)
      .addChoices(
        { name: 'Sim', value: 'sim' },
        { name: 'Não', value: 'nao' }
      )
  );

export const autocomplete = async (interaction: AutocompleteInteraction) => {
  try {
    const valorDigitado = interaction.options.getFocused().trim();
    const sugestoesBase = ['+1', '+2', '+3', '+4', '+5', '-1', '-2'];

    let escolhas: { name: string; value: string }[] = [];

    if (valorDigitado === '') {
      escolhas = sugestoesBase.map(s => ({ name: s, value: s }));
    } else {
      escolhas.push({ name: `${valorDigitado} (Manter assim)`, value: valorDigitado });
      sugestoesBase.forEach(s => {
        escolhas.push({ name: `${valorDigitado} ${s}`, value: `${valorDigitado} ${s}` });
      });
    }

    await interaction.respond(escolhas.slice(0, 25));
  } catch (error) {
    console.error('Erro no autocompletar do /dado:', error);
  }
};

export const execute = async (interaction: ChatInputCommandInteraction) => {
  try {
    const qtdOriginal = interaction.options.getInteger('quantidade') || 1;
    const tipo = interaction.options.getInteger('tipo') || 20;
    const modificadorStr = interaction.options.getString('modificador') || ''; // ← bug corrigido
    const condicao = interaction.options.getString('condicao');
    const separadoInput = interaction.options.getString('separado') || 'nao';
    const mostrarSeparado = separadoInput === 'sim';

    const qtdFinal = condicao && qtdOriginal === 1 ? 2 : qtdOriginal;
    const resultados: number[] = [];

    for (let i = 0; i < qtdFinal; i++) {
      resultados.push(Math.floor(Math.random() * tipo) + 1);
    }

    let somaBonus = 0;
    if (modificadorStr) {
      const numerosEncontrados = modificadorStr.match(/[+-]?\d+/g);
      if (numerosEncontrados) {
        somaBonus = numerosEncontrados.reduce((acc, atual) => acc + parseInt(atual, 10), 0);
      }
    }

    let valorBase = 0;
    let indexDestaque = -1;

    if (condicao === 'vantagem') {
      valorBase = Math.max(...resultados);
      indexDestaque = resultados.indexOf(valorBase);
    } else if (condicao === 'desvantagem') {
      valorBase = Math.min(...resultados);
      indexDestaque = resultados.indexOf(valorBase);
    } else {
      valorBase = resultados.reduce((a, b) => a + b, 0);
    }

    const totalFinal = valorBase + somaBonus;

    let descricao = `🎲 **Rolagem:** ${qtdFinal}d${tipo}\n`;

    if (condicao === 'vantagem') descricao += `🟢 **Condição:** Vantagem (Maior resultado)\n`;
    if (condicao === 'desvantagem') descricao += `🔴 **Condição:** Desvantagem (Menor resultado)\n`;

    if (!condicao && qtdFinal > 1) {
      descricao += `🔢 **Soma dos Dados:** ${valorBase}\n`;
    }

    if (somaBonus !== 0) {
      descricao += `✨ **Bônus:** ${somaBonus > 0 ? '+' : ''}${somaBonus} *(De: ${modificadorStr})*\n`;
    }

    if (qtdFinal > 1 && (mostrarSeparado || condicao)) {
      const resultadosFormatados = resultados.map((val, idx) => {
        let textoDado = `${val}`;

        if (mostrarSeparado && somaBonus !== 0) {
          textoDado = `${val} ➔ **${val + somaBonus}**`;
        }

        if (idx === indexDestaque) return `**${textoDado}**`;
        if (condicao) return `~~${textoDado}~~`;
        return textoDado;
      });
      descricao += `\n📊 **Dados:** [ ${resultadosFormatados.join(' | ')} ]`;
    }

    const embed = new EmbedBuilder()
      .setColor(
        condicao === 'vantagem' ? '#10B981' :
        condicao === 'desvantagem' ? '#EF4444' : '#06b6d4'
      )
      .setTitle(`Resultado Total: ${totalFinal}`)
      .setDescription(descricao)
      .setFooter({ 
        text: `Rolado por ${interaction.user.username}`, 
        iconURL: interaction.user.displayAvatarURL() 
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error('Erro fatal ao rolar dado:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Ops! A Lua tropeçou nos fios e não conseguiu rolar os dados. Tente de novo! 🦉🔧',
        flags: 64,
      });
    }
  }
};
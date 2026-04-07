const cacheRaridade = new Map<string, { raridade: string; expira: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function calcularRaridade(totalResultados: number): string {
  if (totalResultados >= 500_000_000) return 'lendario';
  if (totalResultados >= 100_000_000) return 'epico';
  if (totalResultados >= 10_000_000)  return 'raro';
  if (totalResultados >= 1_000_000)   return 'incomum';
  return 'comum';
}

export async function buscarRaridadePorPopularidade(
  personagem: string,
  vinculo: string
): Promise<string> {
  const chaveCache = `${personagem}:${vinculo}`.toLowerCase();

  const cached = cacheRaridade.get(chaveCache);
  if (cached && cached.expira > Date.now()) {
    return cached.raridade;
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CX;

  if (!apiKey || !cx) {
    console.warn('⚠️ Google API não configurada, usando raridade padrão');
    return 'comum';
  }

  try {
    const query = encodeURIComponent(`${personagem} ${vinculo}`);
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${query}&num=1`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google API retornou ${res.status}`);

    // Tipagem correta para evitar erro TS2339
    const data = await res.json() as {
      searchInformation?: { totalResults?: string };
    };

    const totalStr = data?.searchInformation?.totalResults || '0';
    const total = parseInt(totalStr, 10);

    const raridade = calcularRaridade(total);

    cacheRaridade.set(chaveCache, {
      raridade,
      expira: Date.now() + CACHE_TTL,
    });

    console.log(`🔍 ${personagem} (${vinculo}): ${total.toLocaleString()} resultados → ${raridade}`);
    return raridade;

  } catch (error) {
    console.error('❌ Erro ao buscar raridade no Google:', error);
    return 'comum';
  }
}
// src/lib/raridade.ts
// Calcula a raridade de uma carta baseada na popularidade do personagem via Google Custom Search API.
// Cache de 24h para evitar exceder a cota gratuita (100 req/dia).

const cacheRaridade = new Map<string, { raridade: string; total: number; expira: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

// ─── Thresholds de popularidade ──────────────────────────────────────────────
// Baseados em testes com personagens conhecidos:
// Naruto (anime global) → ~500M+ resultados → lendário
// Mikasa AoT           → ~100M+             → épico
// Personagem de série  → ~10M+              → raro
// Personagem incomum   → ~1M+               → incomum
// Desconhecido         → <1M                → comum
function calcularRaridade(total: number): string {
  if (total >= 500_000_000) return 'lendario';
  if (total >= 100_000_000) return 'epico';
  if (total >= 10_000_000)  return 'raro';
  if (total >= 1_000_000)   return 'incomum';
  return 'comum';
}

// ─── Busca via Google Custom Search API ──────────────────────────────────────
// Documentação: https://developers.google.com/custom-search/v1/using_rest
// Variáveis necessárias no .env do BOT:
//   GOOGLE_API_KEY  → Google Cloud Console > APIs > Custom Search JSON API > Credenciais
//   GOOGLE_CX       → Programmable Search Engine > ID do mecanismo (cx)
export async function buscarRaridadePorPopularidade(
  personagem: string,
  vinculo: string
): Promise<{ raridade: string; total: number; fonte: string }> {
  const chaveCache = `${personagem}:${vinculo}`.toLowerCase().trim();

  // Retorna cache se ainda válido
  const cached = cacheRaridade.get(chaveCache);
  if (cached && cached.expira > Date.now()) {
    return { raridade: cached.raridade, total: cached.total, fonte: 'cache' };
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const cx     = process.env.GOOGLE_CX;

  if (!apiKey || !cx) {
    console.warn('⚠️ GOOGLE_API_KEY ou GOOGLE_CX não configurados. Usando raridade padrão.');
    return { raridade: 'comum', total: 0, fonte: 'sem_api' };
  }

  // Query: nome do personagem + vínculo (franquia/obra) para ser mais preciso
  const query = encodeURIComponent(`"${personagem}" "${vinculo}"`);
  const url   = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${query}&num=1&fields=searchInformation(totalResults)`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      // Timeout de 5s para não travar o bot
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const corpo = await res.text();
      console.error(`❌ Google API retornou ${res.status}: ${corpo.slice(0, 200)}`);

      // 429 = quota esgotada, retorna comum sem salvar cache
      if (res.status === 429) {
        console.warn('⚠️ Quota do Google Custom Search esgotada.');
        return { raridade: 'comum', total: 0, fonte: 'quota_esgotada' };
      }

      return { raridade: 'comum', total: 0, fonte: 'erro_api' };
    }

    const data = await res.json() as {
      searchInformation?: { totalResults?: string };
    };

    const totalStr = data?.searchInformation?.totalResults ?? '0';
    const total    = parseInt(totalStr, 10) || 0;
    const raridade = calcularRaridade(total);

    // Salva no cache
    cacheRaridade.set(chaveCache, { raridade, total, expira: Date.now() + CACHE_TTL });

    console.log(`🔍 "${personagem}" (${vinculo}): ${total.toLocaleString('pt-BR')} resultados → ${raridade}`);
    return { raridade, total, fonte: 'google' };

  } catch (err: any) {
    if (err?.name === 'TimeoutError') {
      console.error('❌ Timeout ao consultar Google API (>5s)');
    } else {
      console.error('❌ Erro ao buscar raridade no Google:', err?.message ?? err);
    }
    return { raridade: 'comum', total: 0, fonte: 'erro_rede' };
  }
}

// ─── Utilitário: limpa o cache (útil em testes) ───────────────────────────────
export function limparCacheRaridade() {
  cacheRaridade.clear();
}
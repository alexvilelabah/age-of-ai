// Identidade estável do navegador + último nome usado (localStorage).
// Serve pra reassumir o mesmo nome após um refresh/queda: o servidor reconhece
// o clientId e "despeja" a conexão antiga em vez de recusar o nome.

const CID_KEY = 'ageofai:clientId';
const NAME_KEY = 'ageofai:name';

let cachedId: string | null = null;

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // segue pro fallback
  }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Id estável do navegador (mesmo entre refreshes). Cacheado em memória p/ o
 *  caso de localStorage indisponível (não pode variar dentro da sessão). */
export function getClientId(): string {
  if (cachedId) return cachedId;
  try {
    let id = localStorage.getItem(CID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(CID_KEY, id);
    }
    cachedId = id;
    return id;
  } catch {
    cachedId = randomId(); // modo restrito: id efêmero, mas estável na sessão
    return cachedId;
  }
}

export function getSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // ignora
  }
}

// Compila o servidor num arquivo só (dist/index.js), pra produção rodar com
// `node` puro em vez de `tsx`.
//
// Por que existe (e não é só uma linha no package.json): a versão em linha de
// comando quebrou no celular — o shell do Termux repartia os argumentos de um
// jeito que o esbuild lia como "vários arquivos de entrada", e o build falhava
// só lá, com o mesmo comando que funcionava no Windows. Chamando a API direto
// não há shell no meio: os argumentos são estes objetos, iguais em todo lugar.
//
// Por que buildar em vez de rodar o TypeScript direto: o `tsx` mantém um esbuild
// vivo pra sempre transpilando em tempo real — medido no celular, ~0,47% de CPU
// com o servidor PARADO (mais que o próprio servidor) e uns 30 MB de RAM, 24h
// por dia. Aqui o esbuild roda uma vez, por ~15 ms, e sai.
//
// Uso: npm run build -w server
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // `ws` é binário/nativo e vem do node_modules em tempo de execução; empacotar
  // não traria ganho. O @age/shared, sim, entra no bundle (é TypeScript nosso).
  external: ['ws'],
});

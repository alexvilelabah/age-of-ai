import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5199,
    // Escuta em todos os endereços (IPv4 0.0.0.0 + IPv6) para que a checagem de
    // prontidão (127.0.0.1), o cloudflared e a rede local alcancem o Vite de forma
    // determinística — evita o "sobe em localhost/::1 mas 127.0.0.1 não responde".
    host: true,
    // Não pular para outra porta se a 5199 estiver ocupada (falha claro em vez de
    // subir numa porta que o túnel/checagem não conhecem).
    strictPort: true,
    // Permite acesso via túnel (Cloudflare envia o Host da URL *.trycloudflare.com).
    allowedHosts: true,
    // Encaminha o WebSocket do jogo para o servidor autoritativo na porta 8080,
    // para que tudo passe por uma única origem (necessário quando servido por um túnel).
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    // pacote linkado do workspace é servido como código-fonte TS
    exclude: ['@age/shared'],
  },
});

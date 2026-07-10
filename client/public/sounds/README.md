# Sons do jogo (Age of AI)

Coloque aqui os arquivos de som (**.mp3**, ogg ou wav). Cada arquivo com o nome
exato abaixo será tocado no momento certo. Se um arquivo não existir, o jogo usa
um som sintetizado de reserva — então pode ir adicionando **um a um**.

⚠️ Use sons **livres** (CC0 / freesound.org / gerados por IA que você criou).
**Nunca** arquivos extraídos do AoE2 ou de jogos comerciais (direito autoral).

Dica: sons curtos (0,3–2s), já "no ponto" (sem silêncio longo no começo/fim).

## Lista de arquivos (nome exato → o que é)

### Seleção (clicar no objeto)
- `select_villager.mp3` — aldeão (voz/"sim senhor" curto)
- `select_swordsman.mp3` — espadachim (tinido de metal / grunhido)
- `select_archer.mp3` — arqueiro
- `select_knight.mp3` — **cavalo relinchando**
- `select_building.mp3` — prédio (baque)
- `select_resource.mp3` — árvore/mina (toque)

### Comandos (botão direito)
- `move.mp3` — mover ("sim"/passo)
- `attack.mp3` — atacar (grito/investida)
- `gather.mp3` — coletar
- `build.mp3` — mandar construir (martelo)
- `place.mp3` — assentar o prédio

### Eventos
- `ui.mp3` — clique de botão da interface
- `trained.mp3` — unidade pronta (sino)
- `ageup.mp3` — avançar de era (fanfarra)
- `research.mp3` — upgrade pesquisado (ding)
- `death.mp3` — unidade morre
- `wreck.mp3` — prédio desabando
- `hit.mp3` — **choque de espada** (golpe de combate)

### Ambiente
- `owl.mp3` — **pio da coruja** (toca ~1x/min, quando ela cruza o céu)

### Música
- `music.mp3` — **trilha de fundo** (toca em loop). Se você **não** colocar
  este arquivo, o jogo gera uma trilha calma sintetizada. Coloque uma faixa
  tranquila no estilo do jogo que ela entra no lugar automaticamente.

## Como testar
1. Baixe/gere o som, renomeie exatamente como acima, salve nesta pasta.
2. Recarregue o jogo (a página).
3. Faça a ação (ex.: selecionar o cavaleiro) e escute.
4. Tecla **M** liga/desliga todo o som; tecla **N** liga/desliga só a música.

Enquanto um arquivo não existir, você verá um `404` no console para ele — é
**normal** (só indica "ainda não adicionado"), não é erro de verdade.

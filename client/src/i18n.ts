// Tradução (i18n) do cliente: pt/en/es. Detecção pela região no boot, troca nas
// Opções (recarrega a página). Duas partes:
//   1) t('chave', {params}) — strings de interface (dicionário STR abaixo);
//   2) nomes/descrições de CONTEÚDO (unidades, prédios, nós, recursos, eras,
//      techs) — dicionários por idioma; exportamos a versão do idioma ATUAL
//      (montada no boot). Como trocar de idioma recarrega a página, esses
//      exports "congelados" no idioma corrente bastam e não quebram quem os
//      importa por índice (ex.: UNIT_NAMES[type] no hud.ts).
import type { BuildingType, NodeType, ResourceType, UnitType } from '@age/shared';
import { NODE_DEFS } from '@age/shared';
import { settings, type Lang } from './settings';

/** Idioma atual da interface (definido no boot pelo settings). */
export function getLang(): Lang {
  return settings.lang;
}

// ------------------------------------------------------------------ STR (UI)

type Dict = Record<string, string>;

const PT: Dict = {
  // comuns
  'common.back_lobby': 'Voltar ao lobby',
  'common.you_suffix': ' (você)',
  // tela de nome
  'name.welcome_to': 'Bem-vindo a',
  'name.subtitle': 'Estratégia em tempo real inspirada no Age of Empires — construída com IA.',
  'name.blurb': 'Erga sua vila desde a Idade das Trevas, colete recursos, avance pelas eras e conquiste seus rivais. Um Age of Empires enxuto, feito pra rodar no navegador.',
  'name.join_heading': 'Entrar no jogo',
  'name.placeholder': 'Seu nome de guerreiro…',
  'name.enter': 'Entrar',
  'name.footer': '✦ Projeto open source · feito com a ajuda de IA, por diversão ✦',
  'name.empty': 'Digite um nome para continuar.',
  'name.entering': 'Entrando…',
  'name.taken': 'Esse nome já está em uso. Escolha outro.',
  // conexão
  'conn.connecting': 'Conectando…',
  'conn.lost_retry': 'Sem conexão — tentando reconectar…',
  'conn.lost': 'Conexão perdida',
  'conn.lost_desc': 'A ligação com o servidor foi interrompida.',
  // lobby
  'lobby.rooms': 'Salas',
  'lobby.create': 'Criar sala',
  'lobby.refresh': 'Atualizar',
  'lobby.empty': 'Nenhuma sala aberta. Crie uma!',
  'lobby.room_of': 'Sala de {host}',
  'lobby.players_count': '{n}/{max} jogadores',
  'lobby.ingame': 'em jogo',
  'lobby.waiting': 'aguardando',
  'lobby.join': 'Entrar',
  // sala
  'room.title': 'Sala',
  'room.room_n': 'Sala {id}',
  'room.mode': 'Modo:',
  'room.mode_normal': 'Normal',
  'room.mode_normal_desc': 'Começa do zero e desenvolve a economia (padrão).',
  'room.mode_battle': 'Batalha (rápido)',
  'room.mode_battle_desc': 'Começa cheio de recursos e já na Idade dos Castelos — direto pro combate.',
  'room.ready': 'Pronto',
  'room.not_ready': 'Não estou pronto',
  'room.start': 'Iniciar partida',
  'room.add_bot': '+ Bot',
  'room.add_bot_desc': 'Adicionar um oponente de IA (jogue sozinho)',
  'room.remove_bot': '− Bot',
  'room.leave': 'Sair da sala',
  'room.chat': 'Chat',
  'room.chat_placeholder': 'Escreva uma mensagem… (Enter envia)',
  'room.tag_ready': 'Pronto',
  'room.tag_waiting': 'Aguardando',
  // opções
  'opt.title': 'Opções',
  'opt.language': 'Idioma',
  'opt.music': 'Música',
  'opt.sfx': 'Efeitos',
  'opt.resolution': 'Resolução',
  'opt.res_hint': '75% ou 50% deixam o jogo mais leve (menos nítido).',
  'opt.close': 'Fechar',
  // fim de jogo
  'over.victory': 'Vitória!',
  'over.victory_desc': 'Seu império prevaleceu.',
  'over.defeat': 'Derrota',
  'over.defeat_desc': '{winner} venceu a partida.',
  // erros do servidor (toast) — {age}/{building} vêm já traduzidos do cliente
  'err.already_in_room': 'Você já está em uma sala.',
  'err.room_not_found': 'Sala não encontrada.',
  'err.room_in_game': 'Essa sala já está em partida.',
  'err.room_full': 'Sala cheia.',
  'err.host_only_bots': 'Apenas o anfitrião pode adicionar bots.',
  'err.host_only_start': 'Apenas o anfitrião pode iniciar a partida.',
  'err.need_players': 'São necessários pelo menos {n} jogadores.',
  'err.not_all_ready': 'Nem todos os jogadores estão prontos.',
  'err.bad_json': 'Mensagem inválida (JSON malformado).',
  'err.bad_message': 'Mensagem inválida.',
  'err.need_market': 'Você precisa de um Mercado pronto para negociar.',
  'err.no_gold': 'Ouro insuficiente.',
  'err.no_resource_sell': 'Recurso insuficiente para vender.',
  'err.building_researching': 'Este prédio já está pesquisando.',
  'err.requires_age': 'Requer {age}.',
  'err.requires_prev_upgrade': 'Requer o upgrade anterior.',
  'err.no_resources': 'Recursos insuficientes.',
  'err.age_researching': 'Já há uma era em pesquisa.',
  'err.requires_tc': 'Requer um Centro da Cidade concluído.',
  'err.requires_buildings': 'Requer {n} prédio(s) diferente(s) da {age} — casa/fazenda/muralha não contam (tem {have}).',
  'err.bad_gather_target': 'Alvo de coleta inválido.',
  'err.bad_building_type': 'Tipo de construção inválido.',
  'err.requires_building': 'Requer {building} concluído.',
  'err.bad_build_location': 'Local de construção inválido.',
  'err.queue_full': 'Fila de produção cheia.',
  // HUD — barra e dicas
  'hud.pop_tip': 'população / limite',
  'hud.age_tip': 'era atual',
  'hud.idle_tip': 'Aldeão ocioso — clique (ou tecla .) seleciona e centraliza o próximo',
  'hud.chat_placeholder': 'Mensagem… (Enter envia, Esc cancela)',
  'hint.none': 'Selecione unidades ou prédios com o botão esquerdo.',
  'hint.soldiers': 'Botão direito: mover ou atacar.',
  'hint.construction': 'Em construção — clique com o botão direito usando aldeões para ajudar na obra.',
  'hint.farm': 'Fazenda pronta — envie aldeões (botão direito) para colher comida.',
  'hint.house': 'Este prédio não treina unidades.',
  'hint.enemy': 'Inimigo — selecione suas unidades para atacar.',
  'hint.node': 'Envie aldeões (botão direito) para coletar.',
  // HUD — seleção
  'hud.player': 'Jogador: {name}',
  'hud.carrying': 'Carregando: {amt} {icon}',
  'hud.units_count': '{n} unidades',
  'hud.construction_pct': 'Construção: {pct}%',
  'hud.food_left': 'Comida restante: {amt} {icon}',
  'hud.remaining': 'Restante: {amt} / {total} {icon}',
  'hud.garrison': '🛡 {n} dentro — tecla U ejeta',
  // HUD — ações
  'hud.build': 'Construir',
  'hud.train': 'Treinar',
  'hud.research_verb': 'Pesquisar',
  'hud.production': 'Produção',
  'hud.research_head': 'Pesquisa',
  'hud.idle': 'Ocioso',
  'hud.actions': 'Ações',
  'hud.shift_train5': '(Shift+clique: treina 5)',
  'hud.trade_title': 'Comércio (lotes de 100)',
  'hud.sell_100': 'Vender 100 de {res}',
  'hud.sell_desc': 'Recebe ouro pelo lote. Vender barateia o preço deste recurso para todos.',
  'hud.buy_100': 'Comprar 100 de {res}',
  'hud.buy_desc': 'Paga ouro pelo lote. Comprar encarece o preço deste recurso para todos.',
  'hud.sell': 'Vender +{gain}',
  'hud.buy': 'Comprar −{cost}',
  'hud.advance_age': 'Avançar de era',
  'hud.advance_age_desc': 'Desbloqueia novos prédios, unidades e melhorias — e seus edifícios ficam mais imponentes.',
  'hud.age_max': '🏛 {age} (máxima)',
  'hud.age_researching': '⏳ Pesquisando {age}…',
  'hud.buildings_diff': '{n} prédios diferentes',
  'hud.one_building': '1 prédio',
  'hud.age_need': '⬆ {age} — requer {req} da era ({have}/{need})',
  'hud.age_advance': '⬆ Avançar: {age} — {cost}',
  'hud.researching_age': 'Pesquisando: {age} — {pct}%',
  'hud.tech_done': '{tech} — ✓ já pesquisado',
  'hud.tech_age_locked': '{tech} — 🔒 requer {age}',
  'hud.tech_prereq': '{tech} — 🔒 requer: {prereq}',
  'hud.tech_cost': '{tech} — {cost} • {time}s',
  'hud.unit_age_locked': '{unit} — 🔒 requer {age}',
  'hud.unit_cost': '{unit} — {cost} • {time}s',
  'hud.building_cost': '{building} — {cost} • {time}s',
  'hud.house_pop_maxed': 'População no máximo ({max}) — não precisa de mais casas',
  'hud.researching_tech': 'Pesquisando: {tech} — {pct}%',
  'hud.queue_cancel': '{unit} — clique para cancelar',
  'hud.creating': 'Criando: {unit} — {pct}%',
  // HUD — efeitos de tech (tooltip)
  'hud.eff_attack': '+{n} ataque',
  'hud.eff_armor': '+{n} blindagem',
  'hud.eff_hp': '+{n} vida',
  'hud.eff_range': '+{n} alcance',
  'hud.eff_gather': '+{pct}% coleta de {res}',
  'hud.eff_carry': '+{n} de carga por viagem',
  'hud.eff_def_attack': '+{n} dano de torres/CC',
  'hud.eff_def_range': '+{n} alcance de torres/CC',
};

const EN: Dict = {
  'common.back_lobby': 'Back to lobby',
  'common.you_suffix': ' (you)',
  'name.welcome_to': 'Welcome to',
  'name.subtitle': 'Real-time strategy inspired by Age of Empires — built with AI.',
  'name.blurb': 'Build your town from the Dark Age, gather resources, advance through the ages, and conquer your rivals. A lean Age of Empires, made to run in the browser.',
  'name.join_heading': 'Join the game',
  'name.placeholder': 'Your warrior name…',
  'name.enter': 'Enter',
  'name.footer': '✦ Open source project · made with the help of AI, for fun ✦',
  'name.empty': 'Enter a name to continue.',
  'name.entering': 'Entering…',
  'name.taken': 'That name is already taken. Choose another.',
  'conn.connecting': 'Connecting…',
  'conn.lost_retry': 'No connection — reconnecting…',
  'conn.lost': 'Connection lost',
  'conn.lost_desc': 'The link to the server was interrupted.',
  'lobby.rooms': 'Rooms',
  'lobby.create': 'Create room',
  'lobby.refresh': 'Refresh',
  'lobby.empty': 'No open rooms. Create one!',
  'lobby.room_of': "{host}'s room",
  'lobby.players_count': '{n}/{max} players',
  'lobby.ingame': 'in game',
  'lobby.waiting': 'waiting',
  'lobby.join': 'Join',
  'room.title': 'Room',
  'room.room_n': 'Room {id}',
  'room.mode': 'Mode:',
  'room.mode_normal': 'Normal',
  'room.mode_normal_desc': 'Start from scratch and build up your economy (default).',
  'room.mode_battle': 'Battle (fast)',
  'room.mode_battle_desc': 'Start loaded with resources and already in the Castle Age — straight to combat.',
  'room.ready': 'Ready',
  'room.not_ready': 'Not ready',
  'room.start': 'Start game',
  'room.add_bot': '+ Bot',
  'room.add_bot_desc': 'Add an AI opponent (play solo)',
  'room.remove_bot': '− Bot',
  'room.leave': 'Leave room',
  'room.chat': 'Chat',
  'room.chat_placeholder': 'Type a message… (Enter to send)',
  'room.tag_ready': 'Ready',
  'room.tag_waiting': 'Waiting',
  'opt.title': 'Options',
  'opt.language': 'Language',
  'opt.music': 'Music',
  'opt.sfx': 'Sound effects',
  'opt.resolution': 'Resolution',
  'opt.res_hint': '75% or 50% make the game lighter (less sharp).',
  'opt.close': 'Close',
  'over.victory': 'Victory!',
  'over.victory_desc': 'Your empire prevailed.',
  'over.defeat': 'Defeat',
  'over.defeat_desc': '{winner} won the match.',
  'err.already_in_room': 'You are already in a room.',
  'err.room_not_found': 'Room not found.',
  'err.room_in_game': 'That room is already in a game.',
  'err.room_full': 'Room is full.',
  'err.host_only_bots': 'Only the host can add bots.',
  'err.host_only_start': 'Only the host can start the game.',
  'err.need_players': 'At least {n} players are required.',
  'err.not_all_ready': 'Not all players are ready.',
  'err.bad_json': 'Invalid message (malformed JSON).',
  'err.bad_message': 'Invalid message.',
  'err.need_market': 'You need a completed Market to trade.',
  'err.no_gold': 'Not enough gold.',
  'err.no_resource_sell': 'Not enough of that resource to sell.',
  'err.building_researching': 'This building is already researching.',
  'err.requires_age': 'Requires {age}.',
  'err.requires_prev_upgrade': 'Requires the previous upgrade.',
  'err.no_resources': 'Not enough resources.',
  'err.age_researching': 'An age is already being researched.',
  'err.requires_tc': 'Requires a completed Town Center.',
  'err.requires_buildings': "Requires {n} different building(s) from the {age} — house/farm/wall don't count (you have {have}).",
  'err.bad_gather_target': 'Invalid gather target.',
  'err.bad_building_type': 'Invalid building type.',
  'err.requires_building': 'Requires a completed {building}.',
  'err.bad_build_location': 'Invalid build location.',
  'err.queue_full': 'Production queue is full.',
  'hud.pop_tip': 'population / limit',
  'hud.age_tip': 'current age',
  'hud.idle_tip': 'Idle villager — click (or press .) to select and center the next one',
  'hud.chat_placeholder': 'Message… (Enter sends, Esc cancels)',
  'hint.none': 'Select units or buildings with the left button.',
  'hint.soldiers': 'Right button: move or attack.',
  'hint.construction': 'Under construction — right-click with villagers to help build it.',
  'hint.farm': 'Farm ready — send villagers (right-click) to harvest food.',
  'hint.house': 'This building does not train units.',
  'hint.enemy': 'Enemy — select your units to attack.',
  'hint.node': 'Send villagers (right-click) to gather.',
  'hud.player': 'Player: {name}',
  'hud.carrying': 'Carrying: {amt} {icon}',
  'hud.units_count': '{n} units',
  'hud.construction_pct': 'Construction: {pct}%',
  'hud.food_left': 'Food left: {amt} {icon}',
  'hud.remaining': 'Remaining: {amt} / {total} {icon}',
  'hud.garrison': '🛡 {n} inside — press U to eject',
  'hud.build': 'Build',
  'hud.train': 'Train',
  'hud.research_verb': 'Research',
  'hud.production': 'Production',
  'hud.research_head': 'Research',
  'hud.idle': 'Idle',
  'hud.actions': 'Actions',
  'hud.shift_train5': '(Shift+click: train 5)',
  'hud.trade_title': 'Trade (lots of 100)',
  'hud.sell_100': 'Sell 100 {res}',
  'hud.sell_desc': "Get gold for the lot. Selling lowers this resource's price for everyone.",
  'hud.buy_100': 'Buy 100 {res}',
  'hud.buy_desc': "Pay gold for the lot. Buying raises this resource's price for everyone.",
  'hud.sell': 'Sell +{gain}',
  'hud.buy': 'Buy −{cost}',
  'hud.advance_age': 'Advance age',
  'hud.advance_age_desc': 'Unlocks new buildings, units, and upgrades — and your buildings grow grander.',
  'hud.age_max': '🏛 {age} (max)',
  'hud.age_researching': '⏳ Researching {age}…',
  'hud.buildings_diff': '{n} different buildings',
  'hud.one_building': '1 building',
  'hud.age_need': '⬆ {age} — needs {req} from this age ({have}/{need})',
  'hud.age_advance': '⬆ Advance: {age} — {cost}',
  'hud.researching_age': 'Researching: {age} — {pct}%',
  'hud.tech_done': '{tech} — ✓ already researched',
  'hud.tech_age_locked': '{tech} — 🔒 needs {age}',
  'hud.tech_prereq': '{tech} — 🔒 needs: {prereq}',
  'hud.tech_cost': '{tech} — {cost} • {time}s',
  'hud.unit_age_locked': '{unit} — 🔒 needs {age}',
  'hud.unit_cost': '{unit} — {cost} • {time}s',
  'hud.building_cost': '{building} — {cost} • {time}s',
  'hud.house_pop_maxed': 'Population at max ({max}) — no more houses needed',
  'hud.researching_tech': 'Researching: {tech} — {pct}%',
  'hud.queue_cancel': '{unit} — click to cancel',
  'hud.creating': 'Training: {unit} — {pct}%',
  'hud.eff_attack': '+{n} attack',
  'hud.eff_armor': '+{n} armor',
  'hud.eff_hp': '+{n} HP',
  'hud.eff_range': '+{n} range',
  'hud.eff_gather': '+{pct}% {res} gathering',
  'hud.eff_carry': '+{n} carry per trip',
  'hud.eff_def_attack': '+{n} tower/TC damage',
  'hud.eff_def_range': '+{n} tower/TC range',
};

const ES: Dict = {
  'common.back_lobby': 'Volver al lobby',
  'common.you_suffix': ' (tú)',
  'name.welcome_to': 'Bienvenido a',
  'name.subtitle': 'Estrategia en tiempo real inspirada en Age of Empires — creada con IA.',
  'name.blurb': 'Levanta tu aldea desde la Edad Oscura, recolecta recursos, avanza por las edades y conquista a tus rivales. Un Age of Empires ligero, hecho para el navegador.',
  'name.join_heading': 'Entrar al juego',
  'name.placeholder': 'Tu nombre de guerrero…',
  'name.enter': 'Entrar',
  'name.footer': '✦ Proyecto de código abierto · hecho con ayuda de IA, por diversión ✦',
  'name.empty': 'Escribe un nombre para continuar.',
  'name.entering': 'Entrando…',
  'name.taken': 'Ese nombre ya está en uso. Elige otro.',
  'conn.connecting': 'Conectando…',
  'conn.lost_retry': 'Sin conexión — reconectando…',
  'conn.lost': 'Conexión perdida',
  'conn.lost_desc': 'La conexión con el servidor se interrumpió.',
  'lobby.rooms': 'Salas',
  'lobby.create': 'Crear sala',
  'lobby.refresh': 'Actualizar',
  'lobby.empty': '¡No hay salas abiertas. Crea una!',
  'lobby.room_of': 'Sala de {host}',
  'lobby.players_count': '{n}/{max} jugadores',
  'lobby.ingame': 'en juego',
  'lobby.waiting': 'esperando',
  'lobby.join': 'Unirse',
  'room.title': 'Sala',
  'room.room_n': 'Sala {id}',
  'room.mode': 'Modo:',
  'room.mode_normal': 'Normal',
  'room.mode_normal_desc': 'Empieza de cero y desarrolla tu economía (predeterminado).',
  'room.mode_battle': 'Batalla (rápido)',
  'room.mode_battle_desc': 'Empieza lleno de recursos y ya en la Edad de los Castillos — directo al combate.',
  'room.ready': 'Listo',
  'room.not_ready': 'No estoy listo',
  'room.start': 'Iniciar partida',
  'room.add_bot': '+ Bot',
  'room.add_bot_desc': 'Añadir un oponente de IA (juega solo)',
  'room.remove_bot': '− Bot',
  'room.leave': 'Salir de la sala',
  'room.chat': 'Chat',
  'room.chat_placeholder': 'Escribe un mensaje… (Enter envía)',
  'room.tag_ready': 'Listo',
  'room.tag_waiting': 'Esperando',
  'opt.title': 'Opciones',
  'opt.language': 'Idioma',
  'opt.music': 'Música',
  'opt.sfx': 'Efectos',
  'opt.resolution': 'Resolución',
  'opt.res_hint': '75% o 50% hacen el juego más ligero (menos nítido).',
  'opt.close': 'Cerrar',
  'over.victory': '¡Victoria!',
  'over.victory_desc': 'Tu imperio prevaleció.',
  'over.defeat': 'Derrota',
  'over.defeat_desc': '{winner} ganó la partida.',
  'err.already_in_room': 'Ya estás en una sala.',
  'err.room_not_found': 'Sala no encontrada.',
  'err.room_in_game': 'Esa sala ya está en partida.',
  'err.room_full': 'Sala llena.',
  'err.host_only_bots': 'Solo el anfitrión puede añadir bots.',
  'err.host_only_start': 'Solo el anfitrión puede iniciar la partida.',
  'err.need_players': 'Se necesitan al menos {n} jugadores.',
  'err.not_all_ready': 'No todos los jugadores están listos.',
  'err.bad_json': 'Mensaje inválido (JSON mal formado).',
  'err.bad_message': 'Mensaje inválido.',
  'err.need_market': 'Necesitas un Mercado terminado para comerciar.',
  'err.no_gold': 'Oro insuficiente.',
  'err.no_resource_sell': 'Recurso insuficiente para vender.',
  'err.building_researching': 'Este edificio ya está investigando.',
  'err.requires_age': 'Requiere {age}.',
  'err.requires_prev_upgrade': 'Requiere la mejora anterior.',
  'err.no_resources': 'Recursos insuficientes.',
  'err.age_researching': 'Ya se está investigando una edad.',
  'err.requires_tc': 'Requiere un Centro Urbano terminado.',
  'err.requires_buildings': 'Requiere {n} edificio(s) diferente(s) de la {age} — casa/granja/muralla no cuentan (tienes {have}).',
  'err.bad_gather_target': 'Objetivo de recolección inválido.',
  'err.bad_building_type': 'Tipo de construcción inválido.',
  'err.requires_building': 'Requiere {building} terminado.',
  'err.bad_build_location': 'Ubicación de construcción inválida.',
  'err.queue_full': 'Cola de producción llena.',
  'hud.pop_tip': 'población / límite',
  'hud.age_tip': 'edad actual',
  'hud.idle_tip': 'Aldeano inactivo — haz clic (o tecla .) para seleccionar y centrar el siguiente',
  'hud.chat_placeholder': 'Mensaje… (Enter envía, Esc cancela)',
  'hint.none': 'Selecciona unidades o edificios con el botón izquierdo.',
  'hint.soldiers': 'Botón derecho: mover o atacar.',
  'hint.construction': 'En construcción — haz clic derecho con aldeanos para ayudar en la obra.',
  'hint.farm': 'Granja lista — envía aldeanos (clic derecho) para cosechar comida.',
  'hint.house': 'Este edificio no entrena unidades.',
  'hint.enemy': 'Enemigo — selecciona tus unidades para atacar.',
  'hint.node': 'Envía aldeanos (clic derecho) para recolectar.',
  'hud.player': 'Jugador: {name}',
  'hud.carrying': 'Cargando: {amt} {icon}',
  'hud.units_count': '{n} unidades',
  'hud.construction_pct': 'Construcción: {pct}%',
  'hud.food_left': 'Comida restante: {amt} {icon}',
  'hud.remaining': 'Restante: {amt} / {total} {icon}',
  'hud.garrison': '🛡 {n} dentro — tecla U expulsa',
  'hud.build': 'Construir',
  'hud.train': 'Entrenar',
  'hud.research_verb': 'Investigar',
  'hud.production': 'Producción',
  'hud.research_head': 'Investigación',
  'hud.idle': 'Inactivo',
  'hud.actions': 'Acciones',
  'hud.shift_train5': '(Shift+clic: entrena 5)',
  'hud.trade_title': 'Comercio (lotes de 100)',
  'hud.sell_100': 'Vender 100 de {res}',
  'hud.sell_desc': 'Recibe oro por el lote. Vender abarata el precio de este recurso para todos.',
  'hud.buy_100': 'Comprar 100 de {res}',
  'hud.buy_desc': 'Paga oro por el lote. Comprar encarece el precio de este recurso para todos.',
  'hud.sell': 'Vender +{gain}',
  'hud.buy': 'Comprar −{cost}',
  'hud.advance_age': 'Avanzar de edad',
  'hud.advance_age_desc': 'Desbloquea nuevos edificios, unidades y mejoras — y tus edificios se vuelven más imponentes.',
  'hud.age_max': '🏛 {age} (máxima)',
  'hud.age_researching': '⏳ Investigando {age}…',
  'hud.buildings_diff': '{n} edificios diferentes',
  'hud.one_building': '1 edificio',
  'hud.age_need': '⬆ {age} — requiere {req} de la edad ({have}/{need})',
  'hud.age_advance': '⬆ Avanzar: {age} — {cost}',
  'hud.researching_age': 'Investigando: {age} — {pct}%',
  'hud.tech_done': '{tech} — ✓ ya investigado',
  'hud.tech_age_locked': '{tech} — 🔒 requiere {age}',
  'hud.tech_prereq': '{tech} — 🔒 requiere: {prereq}',
  'hud.tech_cost': '{tech} — {cost} • {time}s',
  'hud.unit_age_locked': '{unit} — 🔒 requiere {age}',
  'hud.unit_cost': '{unit} — {cost} • {time}s',
  'hud.building_cost': '{building} — {cost} • {time}s',
  'hud.house_pop_maxed': 'Población al máximo ({max}) — no hacen falta más casas',
  'hud.researching_tech': 'Investigando: {tech} — {pct}%',
  'hud.queue_cancel': '{unit} — haz clic para cancelar',
  'hud.creating': 'Creando: {unit} — {pct}%',
  'hud.eff_attack': '+{n} ataque',
  'hud.eff_armor': '+{n} armadura',
  'hud.eff_hp': '+{n} vida',
  'hud.eff_range': '+{n} alcance',
  'hud.eff_gather': '+{pct}% recolección de {res}',
  'hud.eff_carry': '+{n} de carga por viaje',
  'hud.eff_def_attack': '+{n} daño de torres/CU',
  'hud.eff_def_range': '+{n} alcance de torres/CU',
};

const STR: Record<Lang, Dict> = { pt: PT, en: EN, es: ES };

/** Traduz uma chave para o idioma atual, interpolando {params}. Fallback:
 *  idioma atual → inglês → português → a própria chave (nunca quebra a UI). */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = STR[getLang()]?.[key] ?? EN[key] ?? PT[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split('{' + k + '}').join(String(v));
    }
  }
  return s;
}

// ---------------------------------------------------------- conteúdo (nomes)

const UNIT_NAMES_ALL: Record<Lang, Record<UnitType, string>> = {
  pt: { villager: 'Aldeão', swordsman: 'Espadachim', archer: 'Arqueiro', knight: 'Cavaleiro' },
  en: { villager: 'Villager', swordsman: 'Swordsman', archer: 'Archer', knight: 'Knight' },
  es: { villager: 'Aldeano', swordsman: 'Espadachín', archer: 'Arquero', knight: 'Caballero' },
};

const BUILDING_NAMES_ALL: Record<Lang, Record<BuildingType, string>> = {
  pt: {
    town_center: 'Centro da Cidade', house: 'Casa', barracks: 'Quartel', farm: 'Fazenda',
    archery_range: 'Arquearia', stable: 'Estábulo', blacksmith: 'Ferraria', market: 'Mercado',
    wall: 'Muralha', watch_tower: 'Torre de Vigia', mill: 'Moinho', lumber_camp: 'Madeireira',
    mining_camp: 'Campo de Mineração',
  },
  en: {
    town_center: 'Town Center', house: 'House', barracks: 'Barracks', farm: 'Farm',
    archery_range: 'Archery Range', stable: 'Stable', blacksmith: 'Blacksmith', market: 'Market',
    wall: 'Wall', watch_tower: 'Watch Tower', mill: 'Mill', lumber_camp: 'Lumber Camp',
    mining_camp: 'Mining Camp',
  },
  es: {
    town_center: 'Centro Urbano', house: 'Casa', barracks: 'Cuartel', farm: 'Granja',
    archery_range: 'Galería de Tiro', stable: 'Establo', blacksmith: 'Herrería', market: 'Mercado',
    wall: 'Muralla', watch_tower: 'Torre de Vigía', mill: 'Molino', lumber_camp: 'Campamento Maderero',
    mining_camp: 'Campamento Minero',
  },
};

const NODE_NAMES_ALL: Record<Lang, Record<NodeType, string>> = {
  pt: { tree: 'Árvore', berry_bush: 'Arbusto de frutas', gold_mine: 'Mina de ouro', stone_mine: 'Mina de pedra' },
  en: { tree: 'Tree', berry_bush: 'Berry Bush', gold_mine: 'Gold Mine', stone_mine: 'Stone Mine' },
  es: { tree: 'Árbol', berry_bush: 'Arbusto de bayas', gold_mine: 'Mina de oro', stone_mine: 'Mina de piedra' },
};

const RESOURCE_NAMES_ALL: Record<Lang, Record<ResourceType, string>> = {
  pt: { food: 'comida', wood: 'madeira', gold: 'ouro', stone: 'pedra' },
  en: { food: 'food', wood: 'wood', gold: 'gold', stone: 'stone' },
  es: { food: 'comida', wood: 'madera', gold: 'oro', stone: 'piedra' },
};

const BUILDING_DESCS_ALL: Record<Lang, Record<BuildingType, string>> = {
  pt: {
    town_center: 'O coração da vila: treina aldeões, recebe recursos coletados e pesquisa o avanço de era.',
    house: 'Abriga sua população: cada casa aumenta o limite em +5.',
    barracks: 'Treina espadachins. Libera a Arquearia, o Estábulo e a Ferraria.',
    farm: 'Fonte de comida: mande aldeões colherem nela (esgota com o tempo). Requer um Moinho.',
    archery_range: 'Treina arqueiros, que atacam à distância.',
    stable: 'Treina cavaleiros, a cavalaria rápida e pesada.',
    blacksmith: 'Pesquisa melhorias de ataque e armadura para suas tropas.',
    market: 'Pesquisa melhorias econômicas: coleta mais rápida e mais carga por viagem.',
    wall: 'Bloqueia a passagem de inimigos. Barata — cerque sua vila (Ctrl+clique emenda vários trechos).',
    watch_tower: 'Atira flechas nos inimigos próximos. Fica mais forte (e mais imponente) a cada era.',
    mill: 'Depósito de COMIDA. Libera a Fazenda e o Mercado. Construa perto da comida.',
    lumber_camp: 'Depósito de MADEIRA. Construa junto à floresta pra encurtar a viagem dos lenhadores.',
    mining_camp: 'Depósito de OURO e PEDRA. Construa ao lado das minas.',
  },
  en: {
    town_center: 'The heart of your town: trains villagers, receives gathered resources, and researches the next age.',
    house: 'Houses your population: each house raises the limit by +5.',
    barracks: 'Trains swordsmen. Unlocks the Archery Range, the Stable, and the Blacksmith.',
    farm: 'A food source: send villagers to harvest it (it runs out over time). Requires a Mill.',
    archery_range: 'Trains archers, who attack from a distance.',
    stable: 'Trains knights, the fast and heavy cavalry.',
    blacksmith: 'Researches attack and armor upgrades for your troops.',
    market: 'Researches economic upgrades: faster gathering and more carried per trip.',
    wall: 'Blocks enemy movement. Cheap — wall off your town (Ctrl+click chains several segments).',
    watch_tower: 'Shoots arrows at nearby enemies. Grows stronger (and grander) each age.',
    mill: 'FOOD drop-off. Unlocks the Farm and the Market. Build it near food.',
    lumber_camp: "WOOD drop-off. Build it by the forest to shorten your lumberjacks' trips.",
    mining_camp: 'GOLD and STONE drop-off. Build it next to the mines.',
  },
  es: {
    town_center: 'El corazón de tu aldea: entrena aldeanos, recibe los recursos recolectados e investiga el avance de edad.',
    house: 'Aloja a tu población: cada casa aumenta el límite en +5.',
    barracks: 'Entrena espadachines. Habilita la Galería de Tiro, el Establo y la Herrería.',
    farm: 'Fuente de comida: envía aldeanos a cosecharla (se agota con el tiempo). Requiere un Molino.',
    archery_range: 'Entrena arqueros, que atacan a distancia.',
    stable: 'Entrena caballeros, la caballería rápida y pesada.',
    blacksmith: 'Investiga mejoras de ataque y armadura para tus tropas.',
    market: 'Investiga mejoras económicas: recolección más rápida y más carga por viaje.',
    wall: 'Bloquea el paso de los enemigos. Barata — amuralla tu aldea (Ctrl+clic encadena varios tramos).',
    watch_tower: 'Dispara flechas a los enemigos cercanos. Se hace más fuerte (e imponente) con cada edad.',
    mill: 'Depósito de COMIDA. Habilita la Granja y el Mercado. Constrúyelo cerca de la comida.',
    lumber_camp: 'Depósito de MADERA. Constrúyelo junto al bosque para acortar el viaje de los leñadores.',
    mining_camp: 'Depósito de ORO y PIEDRA. Constrúyelo junto a las minas.',
  },
};

const UNIT_DESCS_ALL: Record<Lang, Record<UnitType, string>> = {
  pt: {
    villager: 'Coleta recursos, constrói e conserta — a base da sua economia.',
    swordsman: 'Infantaria corpo a corpo, equilibrada e barata.',
    archer: 'Ataca de longe, mas é frágil de perto — proteja-o.',
    knight: 'Cavalaria veloz com muito dano e vida; cara de treinar.',
  },
  en: {
    villager: 'Gathers resources, builds, and repairs — the backbone of your economy.',
    swordsman: 'Melee infantry — balanced and cheap.',
    archer: 'Attacks from afar but is fragile up close — protect it.',
    knight: 'Fast cavalry with high damage and HP; expensive to train.',
  },
  es: {
    villager: 'Recolecta recursos, construye y repara — la base de tu economía.',
    swordsman: 'Infantería cuerpo a cuerpo, equilibrada y barata.',
    archer: 'Ataca de lejos, pero es frágil de cerca — protégelo.',
    knight: 'Caballería veloz con mucho daño y vida; cara de entrenar.',
  },
};

const AGE_NAMES_ALL: Record<Lang, string[]> = {
  pt: ['', 'Idade das Trevas', 'Idade Feudal', 'Idade dos Castelos', 'Idade Imperial'],
  en: ['', 'Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age'],
  es: ['', 'Edad Oscura', 'Edad Feudal', 'Edad de los Castillos', 'Edad Imperial'],
};

const TECH_NAMES_ALL: Record<Lang, Record<string, string>> = {
  pt: {
    forging: 'Forja', iron_casting: 'Fundição de Ferro', fletching: 'Retesamento', bodkin: 'Ponta Bodkin',
    scale_mail: 'Cota de Escamas', padded_armor: 'Armadura Acolchoada', man_at_arms: 'Homem de Armas',
    long_swordsman: 'Espada Longa', crossbow: 'Besteiro', cavalier: 'Cavaleiro Pesado', paladin: 'Paladino',
    sharp_sickles: 'Foices Afiadas', steel_axes: 'Machados de Aço', iron_picks: 'Picaretas de Ferro',
    wheelbarrow: 'Carrinho de Mão', ballistics: 'Balística', arrowslits: 'Frestas',
  },
  en: {
    forging: 'Forging', iron_casting: 'Iron Casting', fletching: 'Fletching', bodkin: 'Bodkin Arrow',
    scale_mail: 'Scale Mail', padded_armor: 'Padded Armor', man_at_arms: 'Man-at-Arms',
    long_swordsman: 'Long Swordsman', crossbow: 'Crossbowman', cavalier: 'Cavalier', paladin: 'Paladin',
    sharp_sickles: 'Sharp Sickles', steel_axes: 'Steel Axes', iron_picks: 'Iron Picks',
    wheelbarrow: 'Wheelbarrow', ballistics: 'Ballistics', arrowslits: 'Arrowslits',
  },
  es: {
    forging: 'Forja', iron_casting: 'Fundición de Hierro', fletching: 'Emplumado', bodkin: 'Punta Bodkin',
    scale_mail: 'Cota de Escamas', padded_armor: 'Armadura Acolchada', man_at_arms: 'Hombre de Armas',
    long_swordsman: 'Espada Larga', crossbow: 'Ballestero', cavalier: 'Caballero Pesado', paladin: 'Paladín',
    sharp_sickles: 'Hoces Afiladas', steel_axes: 'Hachas de Acero', iron_picks: 'Picos de Hierro',
    wheelbarrow: 'Carretilla', ballistics: 'Balística', arrowslits: 'Aspilleras',
  },
};

// Exports do idioma ATUAL. São CÓPIAS mutáveis (não as fontes _ALL): applyLang()
// repopula-as EM MEMÓRIA na MESMA referência, então quem indexa UNIT_NAMES[type],
// AGE_NAMES[age] etc. a cada frame (o HUD) passa a ver o novo idioma na hora —
// permitindo trocar de idioma no meio da partida sem recarregar (o reload
// derrubaria a conexão e a partida).
export const UNIT_NAMES: Record<UnitType, string> = { ...UNIT_NAMES_ALL[getLang()] };
export const BUILDING_NAMES: Record<BuildingType, string> = { ...BUILDING_NAMES_ALL[getLang()] };
export const NODE_NAMES: Record<NodeType, string> = { ...NODE_NAMES_ALL[getLang()] };
export const RESOURCE_NAMES: Record<ResourceType, string> = { ...RESOURCE_NAMES_ALL[getLang()] };
export const BUILDING_DESCS: Record<BuildingType, string> = { ...BUILDING_DESCS_ALL[getLang()] };
export const UNIT_DESCS: Record<UnitType, string> = { ...UNIT_DESCS_ALL[getLang()] };
/** Nomes das eras no idioma atual (índice = era; 0 vazio). Substitui o AGE_NAMES
 *  do shared (que fica em pt para o servidor). */
export const AGE_NAMES: string[] = [...AGE_NAMES_ALL[getLang()]];

/** Troca o idioma da interface EM TEMPO REAL (sem reload): grava em settings e
 *  repopula os dicionários de conteúdo nas MESMAS referências exportadas acima.
 *  t() já lê o idioma ao vivo. Telas/HUD que montam texto estático no construtor
 *  precisam se re-renderizar depois desta chamada. */
export function applyLang(lang: Lang): void {
  settings.lang = lang;
  Object.assign(UNIT_NAMES, UNIT_NAMES_ALL[lang]);
  Object.assign(BUILDING_NAMES, BUILDING_NAMES_ALL[lang]);
  Object.assign(NODE_NAMES, NODE_NAMES_ALL[lang]);
  Object.assign(RESOURCE_NAMES, RESOURCE_NAMES_ALL[lang]);
  Object.assign(BUILDING_DESCS, BUILDING_DESCS_ALL[lang]);
  Object.assign(UNIT_DESCS, UNIT_DESCS_ALL[lang]);
  AGE_NAMES.length = 0;
  AGE_NAMES.push(...AGE_NAMES_ALL[lang]);
}

/** Nome traduzido de uma tecnologia pelo id (o TECH_DEFS do shared guarda o pt). */
export function techName(id: string): string {
  return TECH_NAMES_ALL[getLang()][id] ?? id;
}

// ------------------------------------------------------------- ícones (iguais)

// ATENÇÃO: usar apenas emojis antigos (Unicode <= 12). Os de madeira/ouro/pedra
// (🪵🪙🪨, Unicode 13) não existem no Windows 10 — apareciam só os números.
export const RESOURCE_ICONS: Record<ResourceType, string> = {
  food: '🍖',
  wood: '🌲',
  gold: '💰',
  stone: '⛰️',
};

export const UNIT_ICONS: Record<UnitType, string> = {
  villager: '👨‍🌾',
  swordsman: '⚔️',
  archer: '🏹',
  knight: '🏇',
};

export const BUILDING_ICONS: Record<BuildingType, string> = {
  town_center: '🏰',
  house: '🏠',
  barracks: '🛡️',
  farm: '🌾',
  archery_range: '🏹',
  stable: '🐴',
  blacksmith: '⚒️',
  market: '⚖️',
  wall: '🧱',
  watch_tower: '🗼',
  mill: '🍞',
  lumber_camp: '🪓',
  mining_camp: '⛏️',
};

export const NODE_ICONS: Record<NodeType, string> = {
  tree: '🌳',
  berry_bush: '🍓',
  gold_mine: '⛏️',
  stone_mine: '⛰️',
};

/** Ícone do recurso produzido por um nó. */
export function nodeResourceIcon(type: NodeType): string {
  const def = NODE_DEFS[type];
  return def ? RESOURCE_ICONS[def.resource] : '';
}

/** Texto curto de custo, ex.: "50 🌲  20 💰". */
export function costText(cost: Partial<Record<ResourceType, number>>): string {
  const parts: string[] = [];
  for (const [res, val] of Object.entries(cost) as [ResourceType, number][]) {
    if (val && val > 0) parts.push(`${val} ${RESOURCE_ICONS[res]}`);
  }
  return parts.join('  ');
}

/** Texto longo de custo no idioma atual, ex.: "50 madeira, 20 ouro". */
export function costLongText(cost: Partial<Record<ResourceType, number>>): string {
  const parts: string[] = [];
  for (const [res, val] of Object.entries(cost) as [ResourceType, number][]) {
    if (val && val > 0) parts.push(`${val} ${RESOURCE_NAMES[res]}`);
  }
  return parts.join(', ');
}

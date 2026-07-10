// HUD DOM sobre o canvas: barra de recursos, painel de seleção, painel de
// ações (construir/treinar/fila) e chat.

import type {
  BuildingSnap,
  BuildingType,
  NodeSnap,
  ResourceType,
  TechDef,
  UnitSnap,
  UnitType,
} from '@age/shared';
import {
  AGE_COSTS,
  AGE_NAMES,
  AGE_NUMERALS,
  BUILDING_DEFS,
  buildingsToAdvance,
  countsForAgeUp,
  MAX_AGE,
  NODE_DEFS,
  TECH_DEFS,
  TRADE_LOT,
  TRAIN_QUEUE_MAX,
  UNIT_AGE_REQ,
  UNIT_DEFS,
  tradeBuyCost,
  tradeSellGain,
} from '@age/shared';
import {
  BUILDING_DESCS,
  BUILDING_ICONS,
  BUILDING_NAMES,
  costLongText,
  costText,
  NODE_ICONS,
  NODE_NAMES,
  nodeResourceIcon,
  RESOURCE_ICONS,
  RESOURCE_NAMES,
  UNIT_DESCS,
  UNIT_ICONS,
  UNIT_NAMES,
} from '../i18n';
import type { GameState } from '../state';
import { el } from '../ui';

export interface HudDeps {
  onBuild: (type: BuildingType) => void;
  onTrain: (buildingId: number, unit: UnitType) => void;
  onCancelTrain: (buildingId: number, index: number) => void;
  onAdvanceAge: () => void;
  onResearch: (buildingId: number, techId: string) => void;
  onTrade: (action: 'buy' | 'sell', resource: 'food' | 'wood' | 'stone') => void;
  onChat: (text: string) => void;
  onIdleVillager: () => void;
  getPlacement: () => BuildingType | null;
}

const BUILD_ORDER: BuildingType[] = ['house', 'farm', 'mill', 'lumber_camp', 'mining_camp', 'barracks', 'archery_range', 'stable', 'blacksmith', 'market', 'wall', 'watch_tower', 'town_center'];
const RES_ORDER: ResourceType[] = ['food', 'wood', 'gold', 'stone'];

/** Ícones da barra de recursos DESENHADOS (SVG inline). Emojis de madeira/ouro/
 *  pedra são Unicode 13 e não existem em Windows antigos (aparecia só o número);
 *  SVG renderiza igual em qualquer máquina. */
const RES_ICON_SVG: Record<ResourceType, string> = {
  food:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="10.2" cy="5.8" r="4.3" fill="#b3543a" stroke="#7d3826"/>' +
    '<path d="M7 9 3.4 12.6" stroke="#e8e0cc" stroke-width="2.4" stroke-linecap="round"/>' +
    '<circle cx="2.6" cy="13.4" r="1.6" fill="#e8e0cc"/><circle cx="4.4" cy="11.9" r="1.2" fill="#e8e0cc"/></svg>',
  wood:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="2.6" width="10.6" height="4.6" rx="2.3" fill="#7d6038" stroke="#54432c"/>' +
    '<rect x="1.6" y="8.6" width="12.6" height="5" rx="2.5" fill="#8a6a3f" stroke="#5e4326"/>' +
    '<ellipse cx="2.6" cy="11.1" rx="2" ry="2.4" fill="#c8a05a" stroke="#5e4326"/>' +
    '<circle cx="2.6" cy="11.1" r=".9" fill="#a8845c"/></svg>',
  gold:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="11.6" rx="6.2" ry="2.8" fill="#d9a93b" stroke="#8f6c1c"/>' +
    '<ellipse cx="8" cy="8.6" rx="6.2" ry="2.8" fill="#ecc73e" stroke="#8f6c1c"/>' +
    '<ellipse cx="8" cy="5.6" rx="6.2" ry="2.8" fill="#f4d968" stroke="#8f6c1c"/>' +
    '<ellipse cx="8" cy="5.4" rx="3.4" ry="1.3" fill="#f9e9a0"/></svg>',
  stone:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="8.6" width="6" height="5" rx="1.4" fill="#a8adb4" stroke="#6a6e76"/>' +
    '<rect x="8.6" y="8.6" width="5.6" height="5" rx="1.4" fill="#8f949c" stroke="#6a6e76"/>' +
    '<rect x="4.8" y="3.6" width="6.4" height="5" rx="1.4" fill="#b9bdc4" stroke="#6a6e76"/></svg>',
};

/** span com o ícone SVG de um recurso (para a barra superior). */
function resIconEl(r: ResourceType): HTMLElement {
  const s = document.createElement('span');
  s.className = 'res-ico';
  s.innerHTML = RES_ICON_SVG[r];
  return s;
}

/** Aldeão parado (ícone SVG do botão de aldeão ocioso). */
const IDLE_VIL_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4.4" r="2.6" fill="#e2b48a" stroke="#8a6a3f"/>' +
  '<path d="M8 7.2c-2.6 0-4.2 1.6-4.6 4.2-.1.8.4 1.6 1.3 1.6h6.6c.9 0 1.4-.8 1.3-1.6C12.2 8.8 10.6 7.2 8 7.2z" fill="#c8a05a" stroke="#8a6a3f"/>' +
  '<path d="M3.6 4.4h8.8" stroke="#8a6a3f" stroke-width="1.6" stroke-linecap="round"/></svg>';

const HINTS: Record<string, string> = {
  'hint:none': 'Selecione unidades ou prédios com o botão esquerdo.',
  'hint:soldiers': 'Botão direito: mover ou atacar.',
  'hint:construction': 'Em construção — clique com o botão direito usando aldeões para ajudar na obra.',
  'hint:farm': 'Fazenda pronta — envie aldeões (botão direito) para colher comida.',
  'hint:house': 'Este prédio não treina unidades.',
  'hint:enemy': 'Inimigo — selecione suas unidades para atacar.',
  'hint:node': 'Envie aldeões (botão direito) para coletar.',
};

export class Hud {
  readonly el = el('div', 'hud');

  private resVals: Partial<Record<ResourceType, HTMLElement>> = {};
  private popEl: HTMLElement;
  private popVal: HTMLElement;
  private ageVal: HTMLElement;
  private ageTxtCache = '';
  private idleBtn!: HTMLButtonElement;
  private idleVal!: HTMLElement;

  private selPanel = el('div', 'sel-panel hidden');
  private actPanel = el('div', 'act-panel');
  private prodPanel = el('div', 'prod-panel');
  /** Caixa de ajuda acima do menu (estilo AoE2): nome/custo + pra que serve. */
  private tipEl = el('div', 'cmd-tip hidden');
  private tipTitle = el('div', 'tip-title');
  private tipDesc = el('div', 'tip-desc');
  /** Região direita da barra: onde o minimapa é montado (por game.ts). */
  readonly minimapSlot = el('div', 'cb-right');
  private chatBox = el('div', 'chat-box');
  private chatInput: HTMLInputElement;

  private selSig = '';
  private actKey = '';
  private buildBtns = new Map<BuildingType, HTMLButtonElement>();
  private trainBtns = new Map<UnitType, HTMLButtonElement>();
  private trainBuildingId = -1;
  private queueEl: HTMLElement | null = null;
  private queueSig = '';
  private headFill: HTMLElement | null = null;
  private prodTxt: HTMLElement | null = null;
  private prodFill: HTMLElement | null = null;
  private ageBtn: HTMLButtonElement | null = null;
  private prodAgeRow: HTMLElement | null = null;
  private prodAgeTxt: HTMLElement | null = null;
  private prodAgeFill: HTMLElement | null = null;
  private researchBtns = new Map<string, HTMLButtonElement>();
  private prodResRow: HTMLElement | null = null;
  private prodResTxt: HTMLElement | null = null;
  private prodResFill: HTMLElement | null = null;
  /** Botões de comércio do Mercado ("sell:food", "buy:wood", ...). */
  private tradeBtns = new Map<string, HTMLButtonElement>();

  constructor(private gs: GameState, private deps: HudDeps) {
    // ---- barra superior de recursos ----
    const top = el('div', 'panel hud-top');
    for (const r of RES_ORDER) {
      const span = el('span', 'res');
      span.title = RESOURCE_NAMES[r];
      span.appendChild(resIconEl(r));
      span.append(' ');
      const val = el('b', '', '0');
      span.appendChild(val);
      this.resVals[r] = val;
      top.appendChild(span);
    }
    this.popEl = el('span', 'res pop');
    this.popEl.title = 'população / limite';
    this.popEl.append('👥 ');
    this.popVal = el('b', '', '0/0');
    this.popEl.appendChild(this.popVal);
    top.appendChild(this.popEl);
    const ageSpan = el('span', 'res age');
    ageSpan.title = 'era atual';
    ageSpan.append('🏛 ');
    this.ageVal = el('b', '', AGE_NAMES[1]);
    ageSpan.appendChild(this.ageVal);
    top.appendChild(ageSpan);
    // botão de aldeão ocioso (AoE2): seleciona/centraliza o próximo parado
    this.idleBtn = el('button', 'btn idle-vil hidden');
    this.idleBtn.title = 'Aldeão ocioso — clique (ou tecla .) seleciona e centraliza o próximo';
    const idleIco = el('span', 'res-ico');
    idleIco.innerHTML = IDLE_VIL_SVG;
    this.idleBtn.appendChild(idleIco);
    this.idleVal = el('b', '', '0');
    this.idleBtn.appendChild(this.idleVal);
    this.idleBtn.addEventListener('click', () => this.deps.onIdleVillager());
    top.appendChild(this.idleBtn);
    this.el.appendChild(top);

    // ---- barra de comando inferior (estilo AoE2): comandos à esquerda,
    //      seleção + produção no centro, minimapa à direita ----
    const bar = el('div', 'command-bar');
    const left = el('div', 'cb-left');
    left.appendChild(this.actPanel);
    const center = el('div', 'cb-center');
    center.appendChild(this.selPanel);
    center.appendChild(this.prodPanel);
    bar.appendChild(left);
    bar.appendChild(center);
    bar.appendChild(this.minimapSlot);
    this.el.appendChild(bar);

    // ---- caixa de ajuda dos botões (aparece logo acima do menu, à esquerda) ----
    this.tipEl.appendChild(this.tipTitle);
    this.tipEl.appendChild(this.tipDesc);
    this.el.appendChild(this.tipEl);
    // hover delegado: qualquer elemento com data-tip-title dentro do painel de
    // ações mostra a caixa; sair do painel esconde.
    this.actPanel.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement)?.closest('[data-tip-title]') as HTMLElement | null;
      if (t) {
        this.tipTitle.textContent = t.dataset.tipTitle ?? '';
        this.tipDesc.textContent = t.dataset.tipDesc ?? '';
        this.tipDesc.classList.toggle('hidden', !t.dataset.tipDesc);
        this.tipEl.classList.remove('hidden');
      } else {
        this.tipEl.classList.add('hidden');
      }
    });
    this.actPanel.addEventListener('mouseleave', () => this.tipEl.classList.add('hidden'));

    // ---- chat ----
    this.el.appendChild(this.chatBox);
    this.chatInput = el('input', 'txt game-chat-input hidden');
    this.chatInput.maxLength = 200;
    this.chatInput.placeholder = 'Mensagem… (Enter envia, Esc cancela)';
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) this.deps.onChat(text);
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    });
    this.el.appendChild(this.chatInput);
  }

  /** Atualização por frame (barata: só escreve DOM quando algo muda). */
  update(): void {
    this.updateResources();
    this.updateSelection();
    this.updateActions();
  }

  // ---------------------------------------------------------------- chat

  isChatOpen(): boolean {
    return !this.chatInput.classList.contains('hidden');
  }

  openChat(): void {
    this.chatInput.classList.remove('hidden');
    this.chatInput.focus();
  }

  closeChat(): void {
    this.chatInput.value = '';
    this.chatInput.classList.add('hidden');
    this.chatInput.blur();
  }

  addChat(from: string, text: string): void {
    const msg = el('div', 'chat-msg');
    msg.appendChild(el('span', 'chat-from', `${from}: `));
    msg.append(text);
    this.chatBox.appendChild(msg);
    while (this.chatBox.children.length > 6) this.chatBox.firstChild?.remove();
    window.setTimeout(() => msg.classList.add('faded'), 6000);
    window.setTimeout(() => msg.remove(), 8000);
  }

  // ---------------------------------------------------------------- recursos

  private updateResources(): void {
    const me = this.gs.me();
    if (!me) return;
    for (const r of RES_ORDER) {
      const val = this.resVals[r];
      if (!val) continue;
      const txt = String(Math.floor(me.resources?.[r] ?? 0));
      if (val.textContent !== txt) val.textContent = txt;
    }
    const popTxt = `${me.pop}/${me.popCap}`;
    if (this.popVal.textContent !== popTxt) this.popVal.textContent = popTxt;
    this.popEl.classList.toggle('full', me.pop >= me.popCap);
    // contador de aldeões ociosos (botão só aparece quando há algum)
    let idle = 0;
    for (const u of this.gs.units.values()) {
      if (u.owner === this.gs.you && u.type === 'villager' && u.state === 'idle') idle++;
    }
    const idleTxt = String(idle);
    if (this.idleVal.textContent !== idleTxt) this.idleVal.textContent = idleTxt;
    this.idleBtn.classList.toggle('hidden', idle === 0);
    const age = me.age ?? 1;
    const ageTxt = me.ageProgress !== undefined
      ? `${AGE_NUMERALS[age]} → ${AGE_NUMERALS[age + 1]} (${Math.round(me.ageProgress * 100)}%)`
      : `${AGE_NUMERALS[age]} · ${AGE_NAMES[age]}`;
    if (ageTxt !== this.ageTxtCache) {
      this.ageTxtCache = ageTxt;
      this.ageVal.textContent = ageTxt;
    }
  }

  // ---------------------------------------------------------------- seleção

  private updateSelection(): void {
    const gs = this.gs;
    const units: UnitSnap[] = [];
    for (const id of gs.selection) {
      const u = gs.units.get(id);
      if (u) units.push(u);
    }
    const building = gs.selectedBuilding();
    const node = gs.selectedNode();

    let sig = '';
    if (units.length === 1) {
      const u = units[0];
      sig = `u:${u.id}:${u.hp}:${u.carryType ?? ''}:${u.carryAmount ?? 0}`;
    } else if (units.length > 1) {
      // inclui a vida de cada um pra grade de retratos atualizar em combate
      sig = `m:${units.map((u) => `${u.id}=${Math.ceil(u.hp)}`).join(',')}`;
    } else if (building) {
      sig = `b:${building.id}:${building.hp}:${building.progress}:${building.foodLeft ?? -1}`;
    } else if (node) {
      sig = `n:${node.id}:${node.amount}`;
    }

    if (sig === this.selSig) return;
    this.selSig = sig;
    this.selPanel.innerHTML = '';
    if (!sig) {
      this.selPanel.classList.add('hidden');
      return;
    }
    this.selPanel.classList.remove('hidden');

    if (units.length === 1) this.renderUnitDetail(units[0]);
    else if (units.length > 1) this.renderMultiUnits(units);
    else if (building) this.renderBuildingDetail(building);
    else if (node) this.renderNodeDetail(node);
  }

  private titleRow(icon: string, name: string, color?: string): HTMLElement {
    const row = el('div', 'sel-title');
    row.appendChild(el('span', 'ico', icon));
    row.append(name);
    if (color) {
      const sw = el('span', 'swatch');
      sw.style.background = color;
      row.appendChild(sw);
    }
    return row;
  }

  private hpBar(hp: number, max: number): HTMLElement {
    const bar = el('div', 'hpbar');
    const fill = el('div', 'fill');
    const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    fill.style.width = `${frac * 100}%`;
    if (frac <= 0.3) fill.style.background = 'var(--red)';
    else if (frac <= 0.6) fill.style.background = '#e0b23e';
    bar.appendChild(fill);
    bar.appendChild(el('div', 'txt', `${Math.ceil(hp)} / ${max}`));
    return bar;
  }

  private renderUnitDetail(u: UnitSnap): void {
    const maxHp = UNIT_DEFS[u.type]?.hp ?? u.hp;
    this.selPanel.appendChild(this.titleRow(UNIT_ICONS[u.type] ?? '❔', UNIT_NAMES[u.type] ?? u.type, this.gs.colorOf(u.owner)));
    this.selPanel.appendChild(this.hpBar(u.hp, maxHp));
    if (u.owner !== this.gs.you) {
      this.selPanel.appendChild(el('div', 'sel-line', `Jogador: ${this.gs.nameOf(u.owner)}`));
    }
    if (u.type === 'villager' && (u.carryAmount ?? 0) > 0 && u.carryType) {
      this.selPanel.appendChild(
        el('div', 'sel-line', `Carregando: ${Math.floor(u.carryAmount ?? 0)} ${RESOURCE_ICONS[u.carryType]}`),
      );
    }
  }

  /** Seleção múltipla: grade de retratos, cada um com sua barrinha de vida
   *  (estilo AoE2). Clicar num retrato seleciona só aquela unidade. */
  private renderMultiUnits(units: UnitSnap[]): void {
    this.selPanel.appendChild(this.titleRow('⚑', `${units.length} unidades`));
    const groups = el('div', 'sel-units');
    const MAX_TILES = 14;
    for (const u of units.slice(0, MAX_TILES)) {
      const t = el('div', 'sel-unit');
      t.appendChild(el('span', 'ico', UNIT_ICONS[u.type] ?? '❔'));
      const maxHp = UNIT_DEFS[u.type]?.hp ?? u.hp;
      const frac = maxHp > 0 ? Math.max(0, Math.min(1, u.hp / maxHp)) : 0;
      const bar = el('div', 'mini-hp');
      const fill = el('div', 'fill');
      fill.style.width = `${frac * 100}%`;
      if (frac <= 0.3) fill.style.background = 'var(--red)';
      else if (frac <= 0.6) fill.style.background = '#e0b23e';
      bar.appendChild(fill);
      t.appendChild(bar);
      t.title = `${UNIT_NAMES[u.type] ?? u.type} — ${Math.ceil(u.hp)}/${maxHp}`;
      t.addEventListener('click', () => {
        this.gs.selection.clear();
        this.gs.selection.add(u.id);
      });
      groups.appendChild(t);
    }
    if (units.length > MAX_TILES) {
      groups.appendChild(el('div', 'sel-unit more', `+${units.length - MAX_TILES}`));
    }
    this.selPanel.appendChild(groups);
  }

  private renderBuildingDetail(b: BuildingSnap): void {
    const def = BUILDING_DEFS[b.type];
    const maxHp = def?.hp ?? b.hp;
    this.selPanel.appendChild(
      this.titleRow(BUILDING_ICONS[b.type] ?? '❔', BUILDING_NAMES[b.type] ?? b.type, this.gs.colorOf(b.owner)),
    );
    this.selPanel.appendChild(this.hpBar(b.hp, maxHp));
    if (b.owner !== this.gs.you) {
      this.selPanel.appendChild(el('div', 'sel-line', `Jogador: ${this.gs.nameOf(b.owner)}`));
    }
    if ((b.progress ?? 1) < 1) {
      this.selPanel.appendChild(
        el('div', 'sel-line', `Construção: ${Math.floor((b.progress ?? 0) * 100)}%`),
      );
    } else if (b.type === 'farm' && b.foodLeft !== undefined) {
      this.selPanel.appendChild(
        el('div', 'sel-line', `Comida restante: ${Math.ceil(b.foodLeft)} ${RESOURCE_ICONS.food}`),
      );
    }
  }

  private renderNodeDetail(n: NodeSnap): void {
    this.selPanel.appendChild(this.titleRow(NODE_ICONS[n.type] ?? '❔', NODE_NAMES[n.type] ?? n.type));
    const def = NODE_DEFS[n.type];
    const total = def?.amount ?? n.amount;
    this.selPanel.appendChild(
      el('div', 'sel-line', `Restante: ${Math.ceil(n.amount)} / ${total} ${nodeResourceIcon(n.type)}`),
    );
  }

  // ---------------------------------------------------------------- ações

  private actionsContext(): { key: string; building?: BuildingSnap } {
    const gs = this.gs;
    const ownUnits = gs.selectedOwnUnits();
    if (ownUnits.some((u) => u.type === 'villager')) return { key: 'build' };
    if (ownUnits.length > 0) return { key: 'hint:soldiers' };

    const b = gs.selectedBuilding();
    if (b && b.owner === gs.you) {
      const def = BUILDING_DEFS[b.type];
      const hasTechs = TECH_DEFS.some((t) => t.building === b.type);
      if (def && (b.progress ?? 1) >= 1 && (def.trains.length > 0 || hasTechs)) {
        return { key: `train:${b.id}`, building: b };
      }
      if ((b.progress ?? 1) < 1) return { key: 'hint:construction' };
      if (b.type === 'farm') return { key: 'hint:farm' };
      return { key: 'hint:house' };
    }
    if (b) return { key: 'hint:enemy' };

    if (gs.selectedNode()) return { key: 'hint:node' };

    // unidade inimiga selecionada para info
    for (const id of gs.selection) {
      const u = gs.units.get(id);
      if (u && u.owner !== gs.you) return { key: 'hint:enemy' };
    }
    return { key: 'hint:none' };
  }

  private updateActions(): void {
    const ctx = this.actionsContext();
    if (ctx.key !== this.actKey) {
      this.actKey = ctx.key;
      this.rebuildActions(ctx);
    }
    this.refreshActions(ctx);
  }

  private rebuildActions(ctx: { key: string; building?: BuildingSnap }): void {
    this.actPanel.innerHTML = '';
    this.prodPanel.innerHTML = '';
    this.buildBtns.clear();
    this.trainBtns.clear();
    this.queueEl = null;
    this.queueSig = '';
    this.headFill = null;
    this.prodTxt = null;
    this.prodFill = null;
    this.ageBtn = null;
    this.prodAgeRow = null;
    this.prodAgeTxt = null;
    this.prodAgeFill = null;
    this.researchBtns.clear();
    this.tradeBtns.clear();
    this.prodResRow = null;
    this.prodResTxt = null;
    this.prodResFill = null;
    this.trainBuildingId = -1;

    if (ctx.key === 'build') {
      this.actPanel.appendChild(el('div', 'act-title', 'Construir'));
      const grid = el('div', 'cmd-grid');
      for (const type of BUILD_ORDER) {
        const def = BUILDING_DEFS[type];
        if (!def) continue;
        // tile quadrado só com o ícone (estilo AoE2); nome/custo/descrição vão
        // pra caixa de ajuda acima do menu (data-tip-*)
        const btn = el('button', 'btn cmd-tile');
        btn.appendChild(el('span', 'ico', BUILDING_ICONS[type]));
        btn.dataset.tipTitle = `${BUILDING_NAMES[type]} — ${costLongText(def.cost)} • ${def.buildTime}s`;
        btn.dataset.tipDesc = BUILDING_DESCS[type] ?? '';
        btn.addEventListener('click', () => {
          if (!btn.classList.contains('off')) this.deps.onBuild(type);
        });
        this.buildBtns.set(type, btn);
        grid.appendChild(btn);
      }
      this.actPanel.appendChild(grid);
      return;
    }

    if (ctx.key.startsWith('train:') && ctx.building) {
      const b = ctx.building;
      const def = BUILDING_DEFS[b.type];
      const trains = def?.trains ?? [];
      const techs = TECH_DEFS.filter((t) => t.building === b.type);
      this.trainBuildingId = b.id;
      const verb = trains.length ? 'Treinar' : 'Pesquisar';
      this.actPanel.appendChild(el('div', 'act-title', `${verb} — ${BUILDING_NAMES[b.type] ?? b.type}`));
      const grid = el('div', 'cmd-grid');
      for (const unit of trains) {
        const udef = UNIT_DEFS[unit];
        if (!udef) continue;
        // tile quadrado só com o ícone; nome/custo/descrição na caixa de ajuda
        const btn = el('button', 'btn cmd-tile');
        btn.appendChild(el('span', 'ico', UNIT_ICONS[unit]));
        btn.dataset.tipTitle = `${UNIT_NAMES[unit]} — ${costLongText(udef.cost)} • ${udef.trainTime}s`;
        btn.dataset.tipDesc = `${UNIT_DESCS[unit] ?? ''} (Shift+clique: treina 5)`;
        // Shift+clique: enfileira 5 de uma vez (AoE2)
        btn.addEventListener('click', (e) => {
          if (btn.classList.contains('off')) return;
          const n = e.shiftKey ? 5 : 1;
          for (let i = 0; i < n; i++) this.deps.onTrain(b.id, unit);
        });
        this.trainBtns.set(unit, btn);
        grid.appendChild(btn);
      }
      // botões de upgrade (pesquisa) do prédio
      for (const tech of techs) {
        const btn = el('button', 'btn cmd-tile');
        btn.appendChild(el('span', 'ico', tech.icon));
        btn.dataset.tipTitle = `${tech.name} — ${costLongText(tech.cost)} • ${tech.time}s`;
        btn.dataset.tipDesc = this.techEffectText(tech);
        btn.addEventListener('click', () => {
          if (!btn.classList.contains('off')) this.deps.onResearch(b.id, tech.id);
        });
        this.researchBtns.set(tech.id, btn);
        grid.appendChild(btn);
      }
      this.actPanel.appendChild(grid);
      // Mercado: comprar/vender recursos por ouro (preços movem com as trocas)
      if (b.type === 'market') {
        this.actPanel.appendChild(el('div', 'act-title trade-title', 'Comércio (lotes de 100)'));
        const box = el('div', 'trade-box');
        for (const res of ['food', 'wood', 'stone'] as const) {
          const row = el('div', 'trade-row');
          row.appendChild(resIconEl(res));
          const sell = el('button', 'btn trade-btn');
          sell.dataset.tipTitle = `Vender 100 de ${RESOURCE_NAMES[res]}`;
          sell.dataset.tipDesc = 'Recebe ouro pelo lote. Vender barateia o preço deste recurso para todos.';
          sell.addEventListener('click', () => {
            if (!sell.classList.contains('off')) this.deps.onTrade('sell', res);
          });
          const buy = el('button', 'btn trade-btn');
          buy.dataset.tipTitle = `Comprar 100 de ${RESOURCE_NAMES[res]}`;
          buy.dataset.tipDesc = 'Paga ouro pelo lote. Comprar encarece o preço deste recurso para todos.';
          buy.addEventListener('click', () => {
            if (!buy.classList.contains('off')) this.deps.onTrade('buy', res);
          });
          this.tradeBtns.set(`sell:${res}`, sell);
          this.tradeBtns.set(`buy:${res}`, buy);
          row.appendChild(sell);
          row.appendChild(buy);
          box.appendChild(row);
        }
        this.actPanel.appendChild(box);
      }
      // Centro da Cidade: botão de avançar de era (estilo AoE2)
      if (b.type === 'town_center') {
        const btn = el('button', 'btn cmd-btn age-btn');
        btn.dataset.tipTitle = 'Avançar de era';
        btn.dataset.tipDesc = 'Desbloqueia novos prédios, unidades e melhorias — e seus edifícios ficam mais imponentes.';
        btn.addEventListener('click', () => this.deps.onAdvanceAge());
        this.ageBtn = btn;
        this.actPanel.appendChild(btn);
      }
      // centro da barra: produção/pesquisa
      this.prodPanel.appendChild(el('div', 'act-title', trains.length ? 'Produção' : 'Pesquisa'));
      if (trains.length) {
        const now = el('div', 'prod-now');
        this.prodTxt = el('span', 'prod-txt', 'Ocioso');
        now.appendChild(this.prodTxt);
        const barWrap = el('div', 'prod-bar');
        this.prodFill = el('div', 'prod-fill');
        barWrap.appendChild(this.prodFill);
        now.appendChild(barWrap);
        this.prodPanel.appendChild(now);
      }
      // linha de pesquisa de TECNOLOGIA deste prédio (aparece só durante a pesquisa)
      const resRow = el('div', 'prod-now hidden');
      this.prodResTxt = el('span', 'prod-txt', '');
      resRow.appendChild(this.prodResTxt);
      const resBar = el('div', 'prod-bar');
      this.prodResFill = el('div', 'prod-fill age');
      resBar.appendChild(this.prodResFill);
      resRow.appendChild(resBar);
      this.prodResRow = resRow;
      this.prodPanel.appendChild(resRow);
      // linha de pesquisa de era (só no Centro da Cidade, durante a pesquisa)
      const ageRow = el('div', 'prod-now hidden');
      this.prodAgeTxt = el('span', 'prod-txt', '');
      ageRow.appendChild(this.prodAgeTxt);
      const ageBar = el('div', 'prod-bar');
      this.prodAgeFill = el('div', 'prod-fill age');
      ageBar.appendChild(this.prodAgeFill);
      ageRow.appendChild(ageBar);
      this.prodAgeRow = ageRow;
      this.prodPanel.appendChild(ageRow);
      if (trains.length) {
        this.queueEl = el('div', 'queue');
        this.prodPanel.appendChild(this.queueEl);
      }
      return;
    }

    this.actPanel.appendChild(el('div', 'act-title', 'Ações'));
    this.actPanel.appendChild(el('div', 'hint', HINTS[ctx.key] ?? HINTS['hint:none']));
  }

  private refreshActions(ctx: { key: string; building?: BuildingSnap }): void {
    if (ctx.key === 'build') {
      const placement = this.deps.getPlacement();
      const myAge = this.gs.me()?.age ?? 1;
      // pré-requisitos concluídos (árvore do AoE2): tipos que EU já tenho prontos
      const done = new Set<BuildingType>();
      for (const b of this.gs.buildings.values()) {
        if (b.owner === this.gs.you && b.progress >= 1) done.add(b.type);
      }
      for (const [type, btn] of this.buildBtns) {
        const def = BUILDING_DEFS[type];
        // estilo AoE2: o que ainda não está liberado (era futura ou sem o
        // pré-requisito, ex.: Fazenda sem Moinho) NEM APARECE no menu.
        const available = !!def && myAge >= def.ageReq && (!def.requires || done.has(def.requires));
        btn.style.display = available ? '' : 'none';
        if (!available) continue;
        btn.classList.remove('locked');
        btn.classList.toggle('off', !this.canAfford(def.cost));
        btn.classList.toggle('active', placement === type);
        btn.dataset.tipTitle = `${BUILDING_NAMES[type]} — ${costLongText(def.cost)} • ${def.buildTime}s`;
      }
      return;
    }

    if (this.trainBuildingId >= 0) {
      const b = this.gs.buildings.get(this.trainBuildingId);
      if (!b) return; // seleção será podada; contexto muda no próximo frame
      const me = this.gs.me();
      const myAge = me?.age ?? 1;
      const queue = Array.isArray(b.queue) ? b.queue : [];
      for (const [unit, btn] of this.trainBtns) {
        const udef = UNIT_DEFS[unit];
        const req = UNIT_AGE_REQ[unit] ?? 1;
        const locked = myAge < req;
        btn.classList.toggle('off', !udef || locked || !this.canAfford(udef.cost) || queue.length >= TRAIN_QUEUE_MAX);
        btn.classList.toggle('locked', locked);
        if (udef) {
          btn.dataset.tipTitle = locked
            ? `${UNIT_NAMES[unit]} — 🔒 requer ${AGE_NAMES[req]}`
            : `${UNIT_NAMES[unit]} — ${costLongText(udef.cost)} • ${udef.trainTime}s`;
        }
      }
      // botão de avançar de era (só existe no Centro da Cidade)
      if (this.ageBtn && me) {
        if (myAge >= MAX_AGE) {
          this.ageBtn.textContent = `🏛 ${AGE_NAMES[MAX_AGE]} (máxima)`;
          this.ageBtn.disabled = true;
        } else if (me.ageProgress !== undefined) {
          this.ageBtn.textContent = `⏳ Pesquisando ${AGE_NAMES[myAge + 1]}…`;
          this.ageBtn.disabled = true;
        } else {
          const cost = AGE_COSTS[myAge + 1] ?? {};
          // regra do AoE2: N prédios DIFERENTES da era atual (casa/fazenda/muralha não contam)
          const needB = buildingsToAdvance(myAge);
          const have = new Set<BuildingType>();
          for (const b of this.gs.buildings.values()) {
            if (b.owner === this.gs.you && b.progress >= 1 && countsForAgeUp(b.type, myAge)) have.add(b.type);
          }
          if (have.size < needB) {
            const req = needB > 1 ? `${needB} prédios diferentes` : `1 prédio`;
            this.ageBtn.textContent = `⬆ ${AGE_NAMES[myAge + 1]} — requer ${req} da era (${have.size}/${needB})`;
            this.ageBtn.disabled = true;
          } else {
            this.ageBtn.textContent = `⬆ Avançar: ${AGE_NAMES[myAge + 1]} — ${costText(cost)}`;
            this.ageBtn.disabled = !this.canAfford(cost);
          }
        }
      }
      // linha central de pesquisa de era
      if (this.prodAgeRow && this.prodAgeTxt && this.prodAgeFill && me) {
        if (me.ageProgress !== undefined) {
          const pct = Math.round(me.ageProgress * 100);
          this.prodAgeRow.classList.remove('hidden');
          this.prodAgeTxt.textContent = `Pesquisando: ${AGE_NAMES[myAge + 1]} — ${pct}%`;
          this.prodAgeFill.style.width = `${pct}%`;
        } else {
          this.prodAgeRow.classList.add('hidden');
        }
      }
      // botões de upgrade (pesquisa) deste prédio
      const myTechs = me?.techs ?? [];
      for (const [techId, btn] of this.researchBtns) {
        const tech = TECH_DEFS.find((t) => t.id === techId);
        if (!tech) continue;
        const done = myTechs.includes(techId);
        const ageLocked = myAge < tech.ageReq;
        const prereqMissing = !!tech.prereq && !myTechs.includes(tech.prereq);
        const busy = b.research !== undefined;
        btn.classList.toggle('off', done || ageLocked || prereqMissing || busy || !this.canAfford(tech.cost));
        btn.classList.toggle('researched', done);
        btn.classList.toggle('locked', !done && (ageLocked || prereqMissing));
        btn.dataset.tipTitle = done
          ? `${tech.name} — ✓ já pesquisado`
          : ageLocked
            ? `${tech.name} — 🔒 requer ${AGE_NAMES[tech.ageReq]}`
            : prereqMissing
              ? `${tech.name} — 🔒 requer: ${TECH_DEFS.find((t) => t.id === tech.prereq)?.name ?? ''}`
              : `${tech.name} — ${costLongText(tech.cost)} • ${tech.time}s`;
      }
      // botões de comércio do Mercado: preço ao vivo + disponibilidade
      if (this.tradeBtns.size > 0 && me?.resources) {
        for (const res of ['food', 'wood', 'stone'] as const) {
          const price = this.gs.marketPrices[res] ?? 100;
          const sell = this.tradeBtns.get(`sell:${res}`);
          const buy = this.tradeBtns.get(`buy:${res}`);
          if (sell) {
            const gain = tradeSellGain(price);
            const txt = `Vender +${gain}`;
            if (sell.textContent !== txt) sell.textContent = txt;
            sell.classList.toggle('off', (me.resources[res] ?? 0) < TRADE_LOT);
          }
          if (buy) {
            const cost = tradeBuyCost(price);
            const txt = `Comprar −${cost}`;
            if (buy.textContent !== txt) buy.textContent = txt;
            buy.classList.toggle('off', (me.resources.gold ?? 0) < cost);
          }
        }
      }
      // linha central: pesquisa de tecnologia deste prédio
      if (this.prodResRow && this.prodResTxt && this.prodResFill) {
        if (b.research) {
          const tech = TECH_DEFS.find((t) => t.id === b.research!.id);
          const pct = Math.round((b.research.progress ?? 0) * 100);
          this.prodResRow.classList.remove('hidden');
          this.prodResTxt.textContent = `Pesquisando: ${tech?.name ?? ''} — ${pct}%`;
          this.prodResFill.style.width = `${pct}%`;
        } else {
          this.prodResRow.classList.add('hidden');
        }
      }
      const sig = queue.map((q) => q.unit).join(',');
      if (sig !== this.queueSig && this.queueEl) {
        this.queueSig = sig;
        this.queueEl.innerHTML = '';
        this.headFill = null;
        queue.forEach((item, index) => {
          const q = el('div', 'queue-item', UNIT_ICONS[item.unit] ?? '❔');
          q.title = `${UNIT_NAMES[item.unit] ?? item.unit} — clique para cancelar`;
          q.addEventListener('click', () => this.deps.onCancelTrain(this.trainBuildingId, index));
          if (index === 0) {
            const fill = el('div', 'qfill');
            q.appendChild(fill);
            this.headFill = fill;
          }
          this.queueEl?.appendChild(q);
        });
      }
      const head = queue[0];
      if (head && this.headFill) {
        this.headFill.style.height = `${Math.max(0, Math.min(1, head.progress)) * 100}%`;
      }
      if (this.prodTxt && this.prodFill) {
        if (head) {
          const pct = Math.round(Math.max(0, Math.min(1, head.progress)) * 100);
          this.prodTxt.textContent = `Criando: ${UNIT_NAMES[head.unit] ?? head.unit} — ${pct}%`;
          this.prodFill.style.width = `${pct}%`;
        } else {
          this.prodTxt.textContent = 'Ocioso';
          this.prodFill.style.width = '0%';
        }
      }
    }
  }

  /** Descrição curta do efeito de um upgrade, para o tooltip. */
  private techEffectText(t: TechDef): string {
    const parts: string[] = [];
    if (t.addAttack) parts.push(`+${t.addAttack} ataque`);
    if (t.addArmor) parts.push(`+${t.addArmor} blindagem`);
    if (t.addHp) parts.push(`+${t.addHp} vida`);
    if (t.addRange) parts.push(`+${t.addRange} alcance`);
    // techs econômicas (Mercado)
    if (t.gather) {
      for (const [res, frac] of Object.entries(t.gather)) {
        parts.push(`+${Math.round((frac ?? 0) * 100)}% coleta de ${RESOURCE_NAMES[res as ResourceType]}`);
      }
    }
    if (t.carry) parts.push(`+${t.carry} de carga por viagem`);
    const who = t.units.length ? ` (${t.units.map((u) => UNIT_NAMES[u]).join(', ')})` : '';
    return `${parts.join(', ')}${who} • ${costLongText(t.cost)} • ${t.time}s`;
  }

  private canAfford(cost: Partial<Record<ResourceType, number>>): boolean {
    const me = this.gs.me();
    if (!me || !me.resources) return false;
    for (const [r, v] of Object.entries(cost) as [ResourceType, number][]) {
      if ((me.resources[r] ?? 0) < (v ?? 0)) return false;
    }
    return true;
  }
}

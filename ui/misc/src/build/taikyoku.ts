// Taikyoku draft room: ban/pick, placement, then redirect to the lishogi game.
// State comes from the server (TaikyokuApi / JsonView), polled every second.
//
// Built from lishogi parts:
// - the placement board is a regular shogiground (lishogi's board, board theme, coordinates,
//   drag & drop, click-click) with inlined hands: the pieces still to place sit in hand and are
//   dropped exactly like drops in shogi;
// - every piece is a <piece> element drawn by the ryoko_2kanji set (piece-css/taikyokudraft),
//   made in the style of lishogi's default chushogi set;
// - buttons, boxes and colours come from lishogi's theme.
import { Shogiground } from 'shogiground';
import type { Api as SgApi } from 'shogiground/api';
import type { Config as SgConfig } from 'shogiground/config';
import type * as sg from 'shogiground/types';
import { forsythToRole, roleToForsyth } from 'shogiops/sfen';
import type { Role } from 'shogiops/types';
import {
  TAIKYOKU_KINDS,
  type TaikyokuKind,
  taikyokuKindOfRole,
  taikyokuRole,
} from 'shogiops/variant/taikyoku';

type ColorKey = 'sente' | 'gote';
interface Player {
  id: string;
  name: string;
}
interface State {
  id: string;
  version: number;
  phase: 'waiting' | 'draft' | 'place' | 'done';
  owner: string;
  players: { sente?: Player; gote?: Player };
  clock: { limit: number; inc: number; step: number };
  pool: string[];
  order: { color: ColorKey; ban: boolean }[];
  step: number;
  bans: Record<ColorKey, string[]>;
  picks: Record<ColorKey, string[]>;
  toPlace: Record<ColorKey, string[]>;
  placed: { color: ColorKey; kind: string; pos: string }[];
  you?: ColorKey;
  actor?: ColorKey;
  remainingMs?: number;
  placeSquares?: Record<string, string[]>;
  firstColor?: ColorKey;
  gameUrl?: string;
}
interface Opts extends State {
  urls: { state: string; join: string; act: string; login: string };
  me?: string;
  lang: string;
}

const KING = 'king';
const toForsyth = roleToForsyth('taikyokudraft');
const fromForsyth = forsythToRole('taikyokudraft');
const roleOf = (kind: string, promoted = false): string => taikyokuRole(kind, promoted);

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

// a piece image outside of a board: the ryoko_2kanji css matches `.spare-bottom.v-taikyokudraft piece.<role>`
const pieceImg = (kind: string, promoted = false, cls = '') =>
  `<span class="spare-bottom v-taikyokudraft tk-pc ${cls}"><piece class="${roleOf(kind, promoted)} sente"></piece></span>`;

function main(opts: Opts): void {
  const zh = opts.lang === 'zh';
  const t = (zhText: string, en: string) => (zh ? zhText : en);
  const root = document.getElementById('taikyoku-app')!;
  let state: State = opts;
  let deadline = Date.now() + (state.remainingMs ?? 0);
  let selectedKind: string | undefined; // draft: the card the player is about to ban / pick
  let poolHtml = '';
  let focusKind: string | undefined; // the piece shown in the detail panel
  let error: string | undefined;
  let busy = false;
  let redirected = false;
  let bannerKey = '';
  let sgApi: SgApi | undefined;

  const kind = (id: string): TaikyokuKind | undefined => TAIKYOKU_KINDS.get(id);
  const kanji = (id: string) => kind(id)?.kanji ?? id;
  const teamName = (c: ColorKey) =>
    c === 'sente' ? t('先手 · 蓝方', 'Sente · blue') : t('后手 · 红方', 'Gote · red');
  const teamShort = (c: ColorKey) => (c === 'sente' ? t('蓝方', 'Blue') : t('红方', 'Red'));
  const myTurn = () => !!state.you && state.actor === state.you;
  const used = () =>
    new Set([...state.bans.sente, ...state.bans.gote, ...state.picks.sente, ...state.picks.gote]);
  const curStep = () => (state.phase === 'draft' ? state.order[state.step] : undefined);

  // ---------- skeleton (rendered once; the board must survive state updates) ----------
  root.innerHTML = `
    <div class="tk-glow tk-glow--sente"></div><div class="tk-glow tk-glow--gote"></div>
    <div class="tk-head"><div class="tk-banner"></div><div class="tk-sub"></div><div class="tk-actions"></div></div>
    <div class="tk-cols">
      <aside class="tk-player tk-player--sente"></aside>
      <section class="tk-center">
        <div class="tk-pool"></div>
        <div class="tk-wait"></div>
        <div class="tk-board-col"><div class="main-board v-taikyokudraft tk-board"><div class="sg-wrap"></div></div></div>
      </section>
      <aside class="tk-side"><div class="tk-detail"></div></aside>
      <aside class="tk-player tk-player--gote"></aside>
    </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const boardWrap = $('.tk-board .sg-wrap');
  if (!zh) root.classList.add('tk-latin');
  // shogiground caches the bounds of the hand pieces and only drops the cache on scroll / resize;
  // here the hands change their layout (placed pieces disappear), so drop it before every press
  const clearSgBounds = () => {
    const b = sgApi?.state.dom.bounds;
    if (!b) return;
    b.board.bounds.clear();
    b.hands.bounds.clear();
    b.hands.pieceBounds.clear();
  };
  boardWrap.addEventListener('mousedown', clearSgBounds, { capture: true });
  boardWrap.addEventListener('touchstart', clearSgBounds, { capture: true, passive: true });

  const setState = (s: State) => {
    const prevPhase = state.phase;
    state = s;
    deadline = Date.now() + (s.remainingMs ?? 0);
    if (s.phase !== 'draft' || (selectedKind && used().has(selectedKind)) || !myTurn())
      selectedKind = undefined;
    if (prevPhase !== s.phase) focusKind = undefined;
    if (s.phase === 'done' && s.gameUrl && s.you && !redirected) {
      redirected = true;
      setTimeout(() => location.assign(s.gameUrl!), 1800);
    }
    render();
  };

  const post = async (url: string, body?: Record<string, string>) => {
    if (busy) return false;
    busy = true;
    error = undefined;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: body ? new URLSearchParams(body) : undefined,
        credentials: 'same-origin',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setState(json);
      else {
        error = json.error || res.statusText;
        render();
      }
      return res.ok;
    } catch (_) {
      error = t('网络错误，请重试', 'Network error, please retry');
      render();
      return false;
    } finally {
      busy = false;
    }
  };
  const act = (action: string) => post(opts.urls.act, { action });

  const poll = async () => {
    if (state.phase === 'done' && state.gameUrl) return;
    try {
      const res = await fetch(opts.urls.state, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (res.ok) {
        const s: State = await res.json();
        if (
          s.version !== state.version ||
          s.phase !== state.phase ||
          !!s.gameUrl !== !!state.gameUrl
        )
          setState(s);
        else deadline = Date.now() + (s.remainingMs ?? 0);
      }
    } catch (_) {
      /* retry on the next tick */
    }
  };
  setInterval(poll, 1000);
  const timerText = () =>
    state.actor ? `${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s` : '';
  setInterval(() => {
    const txt = timerText();
    root.querySelectorAll('.tk-timer').forEach(el => {
      el.textContent = txt;
      el.classList.toggle('tk-timer--low', !!state.actor && deadline - Date.now() < 8000);
    });
  }, 250);

  // ---------- movement diagram (7x7, the piece in the centre, pointing up) ----------
  const diagram = (k: TaikyokuKind): string => {
    const R = 3;
    const marks = new Map<string, string>();
    const set = (dx: number, dy: number, cls: string) => {
      if (Math.abs(dx) > R || Math.abs(dy) > R || (dx === 0 && dy === 0)) return;
      const key = `${dx},${dy}`;
      if (!marks.has(key)) marks.set(key, cls);
    };
    const modeCls = (m: string) => (m === 'm' ? ' tk-m' : m === 'c' ? ' tk-c' : '');
    for (const r of k.rules) {
      if (r.t === 'slide') {
        const far = r.max > R;
        for (let i = 1; i <= Math.min(r.max, R); i++)
          set(
            r.dx * i,
            r.dy * i,
            (far && i === R ? 'tk-far' : 'tk-step') + modeCls(r.mode) + (r.hops ? ' tk-hop' : ''),
          );
      } else if (r.t === 'leap') set(r.dx, r.dy, `tk-leap${modeCls(r.mode)}`);
      else if (r.t === 'jumpslide') {
        for (let i = 1; i <= R; i++)
          set(
            r.dx * i,
            r.dy * i,
            i <= r.jump ? 'tk-jump' : r.max > R && i === R ? 'tk-far' : 'tk-step',
          );
      } else if (r.t === 'hook') {
        for (let i = 1; i <= R; i++)
          set(r.dx * i, r.dy * i, i === R ? 'tk-far tk-hook' : 'tk-step tk-hook');
      } else if (r.t === 'rangecap') {
        for (let i = 1; i <= R; i++)
          set(r.dx * i, r.dy * i, i === R ? 'tk-far tk-range' : 'tk-step tk-range');
      } else if (r.t === 'lion') {
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) set(dx, dy, 'tk-lion');
      }
    }
    let html = '<div class="tk-diagram">';
    for (let dy = R; dy >= -R; dy--)
      for (let dx = -R; dx <= R; dx++) {
        const c = dx === 0 && dy === 0 ? 'tk-self' : (marks.get(`${dx},${dy}`) ?? '');
        html += `<i class="${c}"></i>`;
      }
    return `${html}</div>`;
  };

  const abilities = (k: TaikyokuKind): string[] => {
    const out: string[] = [];
    const has = (tt: string) => k.rules.some(r => r.t === tt);
    if (has('lion')) out.push(t('狮子两步走', 'lion moves'));
    if (has('igui')) out.push(t('居喰', 'igui'));
    if (has('rangecap')) out.push(t('跳越吃子', 'range capture'));
    if (has('hook')) out.push(t('钩行', 'hook move'));
    if (has('jumpslide')) out.push(t('跳跃后滑行', 'jump then slide'));
    if (k.rules.some(r => r.t === 'slide' && r.hops > 0)) out.push(t('隔子跳', 'hopping'));
    return out;
  };

  // ---------- pool card ----------
  const card = (id: string): string => {
    const k = kind(id);
    if (!k) return '';
    const banned = state.bans.sente.includes(id) || state.bans.gote.includes(id);
    const owner: ColorKey | undefined = state.picks.sente.includes(id)
      ? 'sente'
      : state.picks.gote.includes(id)
        ? 'gote'
        : undefined;
    const free = !banned && !owner;
    const cls = [
      banned ? 'tk-card--banned' : '',
      owner ? `tk-card--${owner}` : '',
      free && myTurn() && state.phase === 'draft' ? 'tk-card--clickable' : '',
    ].join(' ');
    const promo = k.promotesTo ? kind(k.promotesTo) : undefined;
    const tag = banned
      ? `<span class="tk-card__tag tk-card__tag--ban">${t('禁', 'BAN')}</span>`
      : owner
        ? `<span class="tk-card__tag tk-card__tag--${owner}">${teamShort(owner)}</span>`
        : '';
    return `<div class="tk-card ${cls}" data-kind="${id}" title="${esc(`${k.kanji} ${k.en} · ${k.betza}`)}">
      ${tag}
      <div class="tk-card__top">${pieceImg(id)}<div class="tk-card__names"><b>${k.kanji}</b><small>${esc(k.en)}</small></div></div>
      ${diagram(k)}
      <div class="tk-card__foot">${
        promo
          ? `<span class="tk-promo">${t('成', 'Prom.')} ${pieceImg(k.promotesTo!, true, 'tk-pc--xs')} ${promo.kanji}</span>`
          : `<span class="tk-nopromo">${t('不升变', 'no promotion')}</span>`
      }</div>
    </div>`;
  };

  // ---------- detail panel ----------
  const detail = (): string => {
    const id = focusKind ?? selectedKind;
    const k = id ? kind(id) : undefined;
    if (!k)
      return `<div class="tk-detail__empty">${
        state.phase === 'place' || state.phase === 'done'
          ? t('把鼠标移到棋子上查看走法', 'Hover a piece to see how it moves')
          : t('点击卡池中的棋子查看详情', 'Click a piece in the pool to see its details')
      }</div>`;
    const promo = k.promotesTo ? kind(k.promotesTo) : undefined;
    const abil = abilities(k);
    return `<div class="tk-detail__head">${pieceImg(k.id, false, 'tk-pc--lg')}<div><h3>${k.kanji}</h3><p>${esc(k.en)}</p></div></div>
      ${diagram(k)}
      <div class="tk-legend"><span><i class="tk-step"></i>${t('走到', 'step')}</span><span><i class="tk-far"></i>${t('滑行不限格', 'slides')}</span><span><i class="tk-leap"></i>${t('跳到', 'jump')}</span>${
        k.rules.some(r => r.t === 'lion')
          ? `<span><i class="tk-lion"></i>${t('狮子两步', 'lion')}</span>`
          : ''
      }</div>
      <p class="tk-betza">Betza: <code>${esc(k.betza)}</code></p>
      ${abil.length ? `<p class="tk-tags">${abil.map(a => `<span class="tk-tag">${a}</span>`).join('')}</p>` : ''}
      ${
        promo
          ? `<div class="tk-detail__promo"><div class="tk-detail__promo-head">${t('升变', 'Promotes to')} → ${pieceImg(promo.id, true, 'tk-pc--sm')} <b>${promo.kanji}</b> <small>${esc(promo.en)}</small></div>${diagram(promo)}</div>`
          : `<p class="tk-nopromo">${t('此棋子不能升变', 'This piece does not promote')}</p>`
      }`;
  };

  // ---------- player panels ----------
  const playerPanel = (c: ColorKey): string => {
    const p = state.players[c];
    const active = state.actor === c;
    const slots = (list: string[], n: number, ban: boolean) => {
      const out = list.map(b =>
        b
          ? `<span class="tk-slot${ban ? ' tk-slot--ban' : ''}" data-focus="${b}" title="${esc(kanji(b))}">${pieceImg(b)}</span>`
          : `<span class="tk-slot tk-slot--none" title="${t('未禁用', 'no ban')}">—</span>`,
      );
      while (out.length < n) out.push('<span class="tk-slot tk-slot--empty"></span>');
      return out.join('');
    };
    const nBans = state.order.filter(s => s.color === c && s.ban).length;
    const nPicks = state.order.filter(s => s.color === c && !s.ban).length;
    const roster = [KING, ...state.picks[c]];
    const placedKinds = state.placed.filter(x => x.color === c).map(x => x.kind);
    const rows = roster.map(k => {
      const done = state.phase === 'place' && placedKinds.includes(k);
      return `<li class="${done ? 'tk-roster--placed' : ''}" data-focus="${k}">${pieceImg(k)}<span><b>${kanji(k)}</b><small>${esc(kind(k)?.en ?? '')}</small></span></li>`;
    });
    for (let i = state.picks[c].length; i < nPicks; i++)
      rows.push('<li class="tk-roster--empty"><span class="tk-pc"></span><span>—</span></li>');
    return `<div class="tk-player__head"><strong>${teamName(c)}</strong>${active ? '<span class="tk-timer"></span>' : ''}</div>
      <div class="tk-player__name">${p ? esc(p.name) : t('等待加入', 'waiting')}${state.you === c ? ` <em>(${t('你', 'you')})</em>` : ''}</div>
      <label>${t('禁用', 'Bans')}</label><div class="tk-slots">${slots(state.bans[c], nBans, true)}</div>
      <label>${t('阵容', 'Line-up')}</label><ul class="tk-roster">${rows.join('')}</ul>`;
  };

  // ---------- banner ----------
  const banner = (): { key: string; title: string; mod: string; sub: string } => {
    const st = curStep();
    const timer = state.actor ? ' · <span class="tk-timer"></span>' : '';
    const you = myTurn() ? ` · <strong class="tk-you">${t('轮到你', 'your turn')}</strong>` : '';
    switch (state.phase) {
      case 'waiting':
        return {
          key: 'waiting',
          title: t('等待对手', 'Waiting'),
          mod: 'wait',
          sub: t('对手加入后开始禁选', 'The draft starts when an opponent joins'),
        };
      case 'draft':
        return {
          key: st!.ban ? 'ban' : 'pick',
          title: st!.ban ? t('禁用阶段', 'Ban phase') : t('选择阶段', 'Pick phase'),
          mod: st!.ban ? 'ban' : 'pick',
          sub: `${teamShort(st!.color)}${st!.ban ? t('禁用', ' bans') : t('选择', ' picks')} · ${t(`第 ${state.step + 1} / ${state.order.length} 步`, `step ${state.step + 1} / ${state.order.length}`)}${timer}${you}`,
        };
      case 'place':
        return {
          key: 'place',
          title: t('布阵阶段', 'Placement'),
          mod: 'place',
          sub: `${state.actor ? `${teamShort(state.actor)}${t('布阵', ' places')} · ` : ''}${t('己方底部两行 · 开局不能形成将军', 'two home ranks · no check at the start')}${timer}${you}`,
        };
      default:
        return {
          key: 'done',
          title: t('对局开始', 'Game on'),
          mod: 'done',
          sub: state.gameUrl
            ? `${t('选将完成，正在进入对局…', 'Draft complete, opening the game…')} <a class="button button-thin" href="${state.gameUrl}">${t('进入对局', 'Go to the game')}</a>`
            : t('选将完成，正在创建对局…', 'Draft complete, creating the game…'),
        };
    }
  };

  const actions = (): string => {
    const st = curStep();
    if (state.phase === 'waiting') {
      const canJoin = opts.me && opts.me !== state.owner && !state.you;
      return canJoin
        ? `<button class="button button-fat" data-join="1">${t('加入对局', 'Join')}</button>`
        : !opts.me
          ? `<a class="button" href="${opts.urls.login}?referrer=${encodeURIComponent(location.pathname)}">${t('登录后加入', 'Sign in to join')}</a>`
          : '';
    }
    if (!st || !myTurn()) return '';
    const sel = selectedKind ? kind(selectedKind) : undefined;
    const lock = `<button class="button button-fat tk-lock tk-lock--${st.ban ? 'ban' : 'pick'}" data-lock="1"${sel ? '' : ' disabled'}>${
      sel
        ? `${st.ban ? t('禁用', 'Ban') : t('选择', 'Pick')} ${sel.kanji}`
        : st.ban
          ? t('点一枚要禁用的棋子', 'Choose a piece to ban')
          : t('点一枚要选择的棋子', 'Choose a piece to pick')
    }</button>`;
    const skip = st.ban
      ? `<button class="button button-empty" data-skip="1">${t('不禁用', 'No ban')}</button>`
      : '';
    // floating dock at the bottom of the screen: phase, clock, lock-in (double-clicking a card also locks it in)
    const chip = `<span class="tk-dock__phase tk-dock__phase--${st.ban ? 'ban' : 'pick'}">${st.ban ? t('禁用', 'Ban') : t('选择', 'Pick')}</span><span class="tk-timer"></span>`;
    const hint = `<span class="tk-dock__hint">${t('双击卡片可直接锁定', 'double-click a card to lock it in')}</span>`;
    return chip + lock + skip + hint;
  };

  // ---------- placement board (shogiground) ----------
  const token = (k: string, c: ColorKey) => {
    const f = toForsyth(roleOf(k) as Role) ?? `[${k}]`;
    return c === 'sente' ? f.toUpperCase() : f.toLowerCase();
  };
  const boardSfen = (): string => {
    const at = new Map(state.placed.map(p => [p.pos, p]));
    return ['a', 'b', 'c', 'd', 'e']
      .map(r => {
        let row = '';
        let empty = 0;
        for (const f of [5, 4, 3, 2, 1]) {
          const p = at.get(`${f}${r}`);
          if (!p) {
            empty++;
            continue;
          }
          if (empty) row += empty;
          empty = 0;
          row += token(p.kind, p.color);
        }
        return empty ? row + empty : row;
      })
      .join('/');
  };
  const handsSfen = (): string => {
    const part = (c: ColorKey) => {
      const n = new Map<string, number>();
      for (const k of state.toPlace[c]) n.set(k, (n.get(k) ?? 0) + 1);
      return [...n].map(([k, cnt]) => (cnt > 1 ? cnt : '') + token(k, c)).join('');
    };
    return part('sente') + part('gote') || '-';
  };
  const handRoles = () =>
    [...new Set([KING, ...state.picks.sente, ...state.picks.gote])].map(k => roleOf(k));
  const dropDests = (): sg.DropDests => {
    const m: sg.DropDests = new Map();
    if (!myTurn() || state.phase !== 'place' || !state.placeSquares) return m;
    for (const [k, keys] of Object.entries(state.placeSquares))
      if (keys.length) m.set(`${state.you} ${roleOf(k)}` as sg.PieceName, keys as sg.Key[]);
    return m;
  };
  const lastDests = (): sg.Key[] | undefined => {
    const last = state.placed[state.placed.length - 1];
    return last ? [last.pos as sg.Key] : undefined;
  };
  const sgDynamic = (): SgConfig => ({
    sfen: { board: boardSfen(), hands: handsSfen() },
    turnColor: state.actor ?? 'sente',
    activeColor: myTurn() && state.phase === 'place' ? state.you : undefined,
    lastDests: lastDests(),
    droppable: { free: false, dests: dropDests(), showDests: true },
  });
  const ensureBoard = () => {
    if (sgApi) {
      sgApi.set(sgDynamic());
      return;
    }
    sgApi = Shogiground(
      {
        ...sgDynamic(),
        orientation: state.you ?? 'sente',
        viewOnly: !state.you,
        hands: { inlined: true, roles: handRoles() },
        movable: { free: false, dests: new Map() },
        coordinates: { enabled: true },
        highlight: { lastDests: true },
        animation: { enabled: true, hands: true },
        draggable: { enabled: true, showGhost: true },
        selectable: { enabled: true },
        forsyth: { toForsyth: r => toForsyth(r as Role), fromForsyth: s => fromForsyth(s) },
        events: {
          drop: (piece, key) => {
            const k = taikyokuKindOfRole(piece.role as Role)?.id;
            if (!k) return;
            // shogiground has already moved the piece; resync from the server state either way
            void act(`place ${k} ${key}`).then(ok => {
              if (!ok) ensureBoard();
            });
          },
        },
      },
      { board: boardWrap },
    );
  };
  // hand pieces that cannot be placed right now are dimmed, with the reason as a tooltip
  const markHands = () => {
    const me = state.you;
    const dests = state.placeSquares ?? {};
    const kingLeft = !!me && state.toPlace[me].includes(KING);
    boardWrap.querySelectorAll<HTMLElement>('sg-hand-wrap.hand-bottom sg-hp-wrap').forEach(hp => {
      const role = [...(hp.querySelector('piece')?.classList ?? [])].find(c => c.startsWith('tk-'));
      const k = role?.slice(3);
      const mine =
        !!k && !!me && myTurn() && state.phase === 'place' && state.toPlace[me].includes(k);
      const can = mine && (dests[k!]?.length ?? 0) > 0;
      hp.classList.toggle('tk-must', mine && k === KING);
      hp.classList.toggle('tk-blocked', mine && !can);
      hp.title = !mine
        ? ''
        : can
          ? t(
              '拖到己方底部两行，或点一下再点格子',
              'Drag it to your two home ranks, or click it then a square',
            )
          : kingLeft
            ? t('先布王将', 'Place the king first')
            : t(
                '这枚棋子放在哪里都会形成将军，先布其他棋子',
                'This piece gives check wherever it goes, place another one first',
              );
    });
  };

  // ---------- render ----------
  const render = () => {
    const b = banner();
    const bannerEl = $('.tk-banner');
    if (b.key !== bannerKey) {
      bannerKey = b.key;
      // re-inserted so that the entrance animation plays on every phase change
      bannerEl.innerHTML = `<div class="tk-phase tk-phase--${b.mod}"><span class="tk-phase__line"></span><h2 class="tk-phase__title" data-text="${esc(b.title)}">${esc(b.title)}</h2><span class="tk-phase__line"></span></div>`;
    }
    $('.tk-sub').innerHTML = b.sub + (error ? ` <span class="tk-error">${esc(error)}</span>` : '');
    $('.tk-actions').innerHTML = actions();
    root.classList.toggle('tk-turn-sente', state.actor === 'sente');
    root.classList.toggle('tk-turn-gote', state.actor === 'gote');
    root.classList.toggle('tk-mydraft', state.phase === 'draft' && myTurn());
    for (const c of ['sente', 'gote'] as const) {
      const el = $(`.tk-player--${c}`);
      el.innerHTML = playerPanel(c);
      el.classList.toggle('tk-player--active', state.actor === c);
    }
    const drafting = state.phase === 'waiting' || state.phase === 'draft';
    root.classList.toggle('tk-drafting', drafting);
    // the pool is only rebuilt when its content changes: replacing the cards under the pointer
    // would break double-clicks and drags; selection / focus are toggled in place by syncCards
    const html = drafting ? state.pool.map(card).join('') : '';
    if (html !== poolHtml) {
      poolHtml = html;
      $('.tk-pool').innerHTML = html;
    }
    syncCards();
    $('.tk-wait').innerHTML =
      state.phase === 'waiting'
        ? `<p>${t('把本页链接发给对手：', 'Send this link to your opponent:')} <input readonly value="${esc(location.href)}" onclick="this.select()"></p>`
        : '';
    if (!drafting) {
      ensureBoard();
      setTimeout(markHands, 30);
    }
    $('.tk-detail').innerHTML = detail();
    timerTick();
  };
  const timerTick = () =>
    root.querySelectorAll('.tk-timer').forEach(el => {
      el.textContent = timerText();
    });
  const syncCards = () =>
    root.querySelectorAll<HTMLElement>('.tk-card').forEach(c => {
      c.classList.toggle('tk-card--selected', c.dataset.kind === selectedKind);
      c.classList.toggle('tk-card--focus', c.dataset.kind === focusKind);
    });

  // ---------- events ----------
  root.addEventListener('click', e => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-join]')) return void post(opts.urls.join);
    if (el.closest('[data-skip]')) return void act('ban');
    if (el.closest('[data-lock]')) {
      const st = curStep();
      if (st && selectedKind && myTurn()) void act(`${st.ban ? 'ban' : 'pick'} ${selectedKind}`);
      return;
    }
    const c = el.closest<HTMLElement>('.tk-card');
    if (c && (state.phase === 'draft' || state.phase === 'waiting')) {
      const k = c.dataset.kind!;
      focusKind = k;
      if (state.phase === 'draft' && myTurn() && !used().has(k)) selectedKind = k;
      syncCards();
      $('.tk-actions').innerHTML = actions();
      $('.tk-detail').innerHTML = detail();
      timerTick();
      return;
    }
    const f = el.closest<HTMLElement>('[data-focus]');
    if (f) {
      focusKind = f.dataset.focus;
      $('.tk-detail').innerHTML = detail();
    }
  });
  root.addEventListener('dblclick', e => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.tk-card');
    const st = curStep();
    const k = c?.dataset.kind;
    if (k && st && state.phase === 'draft' && myTurn() && !used().has(k)) {
      selectedKind = k;
      void act(`${st.ban ? 'ban' : 'pick'} ${k}`);
    }
  });
  // hovering a piece on the board, in hand or in a panel shows its moves
  root.addEventListener('mouseover', e => {
    const el = e.target as HTMLElement;
    let k = el.closest<HTMLElement>('[data-focus]')?.dataset.focus;
    if (!k && !root.classList.contains('tk-drafting')) {
      const p = el.closest('piece');
      const role = p
        ? [...p.classList].find(c => c.startsWith('tk-') || c.startsWith('tkp-'))
        : undefined;
      k = role ? taikyokuKindOfRole(role as Role)?.id : undefined;
    }
    if (k && k !== focusKind && kind(k)) {
      focusKind = k;
      $('.tk-detail').innerHTML = detail();
    }
  });

  render();
}

window.lishogi.registerModule(__bundlename__, main);

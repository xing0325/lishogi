// Taikyoku draft room: ban/pick, placement, then redirect to the lishogi game.
// State comes from the server (TaikyokuApi / JsonView), polled every second.
import { TAIKYOKU_KINDS, type TaikyokuKind } from 'shogiops/variant/taikyoku';

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

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function main(opts: Opts): void {
  const zh = opts.lang === 'zh';
  const t = (zhText: string, en: string) => (zh ? zhText : en);
  const root = document.getElementById('taikyoku-app')!;
  let state: State = opts;
  let deadline = Date.now() + (state.remainingMs ?? 0);
  let selectedKind: string | undefined;
  let focusKind: string | undefined;
  let error: string | undefined;
  let busy = false;
  let redirected = false;

  const kind = (id: string): TaikyokuKind | undefined => TAIKYOKU_KINDS.get(id);
  const kanji = (id: string) => kind(id)?.kanji ?? id;
  const colorName = (c: ColorKey) => (c === 'sente' ? t('先手（蓝）', 'Sente (blue)') : t('后手（红）', 'Gote (red)'));
  const myTurn = () => !!state.you && state.actor === state.you;

  const setState = (s: State) => {
    state = s;
    deadline = Date.now() + (s.remainingMs ?? 0);
    if (s.phase !== 'place') selectedKind = undefined;
    else if (selectedKind && !s.toPlace[s.you ?? 'sente']?.includes(selectedKind)) selectedKind = undefined;
    if (s.phase === 'done' && s.gameUrl && s.you && !redirected) {
      redirected = true;
      setTimeout(() => location.assign(s.gameUrl!), 1500);
    }
    render();
  };

  const post = async (url: string, body?: Record<string, string>) => {
    if (busy) return;
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
    } finally {
      busy = false;
    }
  };
  const act = (action: string) => post(opts.urls.act, { action });

  const poll = async () => {
    if (state.phase === 'done' && state.gameUrl) return;
    try {
      const res = await fetch(opts.urls.state, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (res.ok) {
        const s: State = await res.json();
        if (s.version !== state.version || s.phase !== state.phase || !!s.gameUrl !== !!state.gameUrl) setState(s);
        else deadline = Date.now() + (s.remainingMs ?? 0);
      }
    } catch (_) {
      /* retry on the next tick */
    }
  };
  setInterval(poll, 1000);
  setInterval(() => {
    const el = root.querySelector('.tk-timer');
    if (el) el.textContent = timerText();
  }, 250);

  const timerText = () => {
    if (!state.actor) return '';
    const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return `${s}s`;
  };

  // Movement diagram (7x7, the piece in the centre, sente pointing up)
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
          set(r.dx * i, r.dy * i, (far && i === R ? 'tk-far' : 'tk-step') + modeCls(r.mode) + (r.hops ? ' tk-hop' : ''));
      } else if (r.t === 'leap') set(r.dx, r.dy, 'tk-leap' + modeCls(r.mode));
      else if (r.t === 'jumpslide') {
        for (let i = 1; i <= R; i++) set(r.dx * i, r.dy * i, i <= r.jump ? 'tk-jump' : r.max > R && i === R ? 'tk-far' : 'tk-step');
      } else if (r.t === 'hook') {
        for (let i = 1; i <= R; i++) set(r.dx * i, r.dy * i, i === R ? 'tk-far tk-hook' : 'tk-step tk-hook');
      } else if (r.t === 'rangecap') {
        for (let i = 1; i <= R; i++) set(r.dx * i, r.dy * i, i === R ? 'tk-far tk-range' : 'tk-step tk-range');
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
    return html + '</div>';
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

  const card = (id: string, cls = ''): string => {
    const k = kind(id);
    if (!k) return '';
    const promo = k.promotesTo ? kind(k.promotesTo) : undefined;
    const abil = abilities(k);
    return `<div class="tk-card ${cls}" data-kind="${id}" title="${esc(`${k.kanji} ${k.en} · ${k.betza}`)}">
      <div class="tk-card__head"><span class="tk-card__kanji">${k.kanji}</span><span class="tk-card__en">${esc(k.en)}</span></div>
      ${diagram(k)}
      <div class="tk-card__foot">${promo ? `<span class="tk-promo">${t('成', 'promotes')} → ${promo.kanji}</span>` : `<span class="tk-nopromo">${t('不升变', 'no promotion')}</span>`}${abil.map(a => `<span class="tk-tag">${a}</span>`).join('')}</div>
    </div>`;
  };

  const used = () => new Set([...state.bans.sente, ...state.bans.gote, ...state.picks.sente, ...state.picks.gote]);

  const playerBox = (c: ColorKey) => {
    const p = state.players[c];
    const active = state.actor === c;
    const bans = state.bans[c].map(b => (b ? `<span class="tk-chip tk-chip--ban">${kanji(b)}</span>` : `<span class="tk-chip tk-chip--none">${t('空', 'none')}</span>`));
    const picks = state.picks[c].map(k => `<span class="tk-chip tk-chip--pick" data-focus="${k}">${kanji(k)}</span>`);
    return `<div class="tk-player tk-player--${c}${active ? ' tk-player--active' : ''}">
      <div class="tk-player__name">${colorName(c)} · ${p ? esc(p.name) : '?'}${state.you === c ? ` <em>(${t('你', 'you')})</em>` : ''}${active ? ` <span class="tk-timer">${timerText()}</span>` : ''}</div>
      <div class="tk-player__row"><label>${t('禁用', 'Bans')}</label>${bans.join('')}</div>
      <div class="tk-player__row"><label>${t('已选', 'Picks')}</label>${picks.join('')}</div>
    </div>`;
  };

  const timeline = () =>
    `<div class="tk-timeline">${state.order
      .map(
        (s, i) =>
          `<span class="tk-tl tk-tl--${s.color} ${s.ban ? 'tk-tl--ban' : 'tk-tl--pick'}${i === state.step ? ' tk-tl--now' : ''}${i < state.step ? ' tk-tl--done' : ''}">${s.ban ? t('禁', 'B') : t('选', 'P')}</span>`,
      )
      .join('')}</div>`;

  const board = (): string => {
    const flip = state.you === 'gote';
    const files = flip ? [1, 2, 3, 4, 5] : [5, 4, 3, 2, 1];
    const ranks = flip ? ['e', 'd', 'c', 'b', 'a'] : ['a', 'b', 'c', 'd', 'e'];
    const at = new Map(state.placed.map(p => [p.pos, p]));
    const allowed = new Set(selectedKind && state.placeSquares ? (state.placeSquares[selectedKind] ?? []) : []);
    let html = `<div class="tk-board sg-wrap orientation-${flip ? 'gote' : 'sente'}">`;
    for (const r of ranks)
      for (const f of files) {
        const key = `${f}${r}`;
        const p = at.get(key);
        const home = (r === 'd' || r === 'e') ? 'sente' : (r === 'a' || r === 'b') ? 'gote' : '';
        html += `<div class="tk-sq${home ? ` tk-sq--home-${home}` : ''}${allowed.has(key) ? ' tk-sq--ok' : ''}" data-sq="${key}">${
          p ? `<piece class="tk-${p.kind} ${p.color}" data-focus="${p.kind}"></piece>` : ''
        }</div>`;
      }
    return html + '</div>';
  };

  const roster = (): string => {
    const me = state.you;
    if (!me) return '';
    const list = state.toPlace[me];
    if (!list.length) return `<p class="tk-hint">${t('你的棋子已全部摆好，等待对手。', 'All your pieces are placed, waiting for the opponent.')}</p>`;
    return `<div class="tk-roster">${list
      .map(k => {
        const n = state.placeSquares?.[k]?.length ?? 0;
        const disabled = myTurn() && n === 0;
        return `<button class="button tk-roster__btn${selectedKind === k ? ' active' : ''}" data-select="${k}"${disabled || !myTurn() ? ' disabled' : ''} title="${disabled ? esc(t('这枚棋子摆在哪里都会将军，先摆其他棋子', 'This piece checks wherever it is placed, place another one first')) : ''}">${kanji(k)}</button>`;
      })
      .join('')}</div>`;
  };

  const status = (): string => {
    if (state.phase === 'waiting') return t('等待对手加入…', 'Waiting for an opponent…');
    if (state.phase === 'done')
      return state.gameUrl
        ? `${t('选将完成，对局开始！', 'Draft complete, the game starts!')} <a class="button" href="${state.gameUrl}">${t('进入对局', 'Go to the game')}</a>`
        : t('选将完成，正在创建对局…', 'Draft complete, creating the game…');
    const who = state.actor ? colorName(state.actor) : '';
    if (state.phase === 'draft') {
      const st = state.order[state.step];
      const what = st.ban ? t('禁用', 'ban') : t('选择', 'pick');
      return myTurn()
        ? `<strong>${t(`轮到你${what}`, `Your turn to ${what}`)}</strong>${st.ban ? ` <button class="button button-empty" data-act="ban">${t('不禁用', 'No ban')}</button>` : ''}`
        : `${who} ${t(`正在${what}…`, `is choosing a ${what}…`)}`;
    }
    return myTurn()
      ? `<strong>${t('轮到你布阵：先选棋子，再点己方底部两行的绿色格子', 'Your turn to place: pick a piece, then a green square on your two home ranks')}</strong>`
      : `${who} ${t('正在布阵…', 'is placing…')}`;
  };

  const detail = (): string => {
    const id = focusKind ?? selectedKind;
    return id ? `<div class="tk-detail">${card(id, 'tk-card--big')}</div>` : '';
  };

  const render = () => {
    const u = used();
    const waiting = state.phase === 'waiting';
    const canJoin = waiting && opts.me && opts.me !== state.owner;
    let body = `<div class="tk-top">${playerBox('gote')}${timeline()}${playerBox('sente')}</div>
      <div class="tk-status">${status()}${error ? ` <span class="tk-error">${esc(error)}</span>` : ''}</div>`;
    if (waiting)
      body += `<div class="tk-wait"><p>${t('把本页链接发给对手：', 'Send this link to your opponent:')} <input readonly value="${esc(location.href)}" onclick="this.select()"></p>${
        canJoin
          ? `<button class="button button-fat" data-join="1">${t('加入对局', 'Join')}</button>`
          : !opts.me
            ? `<a class="button" href="${opts.urls.login}?referrer=${encodeURIComponent(location.pathname)}">${t('登录后加入', 'Sign in to join')}</a>`
            : ''
      }</div>`;
    if (state.phase === 'draft' || waiting) {
      body += `<div class="tk-pool">${state.pool
        .map(k => {
          const taken = state.bans.sente.includes(k) || state.bans.gote.includes(k) ? 'tk-card--banned' : state.picks.sente.includes(k) ? 'tk-card--sente' : state.picks.gote.includes(k) ? 'tk-card--gote' : '';
          const clickable = !u.has(k) && myTurn() && state.phase === 'draft' ? 'tk-card--clickable' : '';
          return card(k, `${taken} ${clickable}`);
        })
        .join('')}</div>`;
    } else {
      body += `<div class="tk-place">${board()}<div class="tk-side">${state.phase === 'place' ? roster() : ''}${detail()}</div></div>`;
    }
    root.innerHTML = body;
  };

  root.addEventListener('click', e => {
    const el = e.target as HTMLElement;
    const join = el.closest('[data-join]');
    if (join) return void post(opts.urls.join);
    const a = el.closest<HTMLElement>('[data-act]');
    if (a) return void act(a.dataset.act!);
    const sel = el.closest<HTMLElement>('[data-select]');
    if (sel) {
      selectedKind = sel.dataset.select;
      return render();
    }
    const sq = el.closest<HTMLElement>('[data-sq]');
    if (sq && selectedKind && state.phase === 'place' && myTurn()) {
      if (state.placeSquares?.[selectedKind]?.includes(sq.dataset.sq!)) return void act(`place ${selectedKind} ${sq.dataset.sq}`);
    }
    const c = el.closest<HTMLElement>('.tk-card--clickable');
    if (c && state.phase === 'draft' && myTurn()) {
      const st = state.order[state.step];
      const k = c.dataset.kind!;
      const name = kanji(k);
      if (st.ban ? confirm(t(`禁用 ${name}？`, `Ban ${name}?`)) : confirm(t(`选择 ${name}？`, `Pick ${name}?`)))
        act(`${st.ban ? 'ban' : 'pick'} ${k}`);
    }
  });
  root.addEventListener('mouseover', e => {
    const f = (e.target as HTMLElement).closest<HTMLElement>('[data-focus]');
    if (f && f.dataset.focus !== focusKind && state.phase !== 'draft' && state.phase !== 'waiting') {
      focusKind = f.dataset.focus;
      const d = root.querySelector('.tk-detail');
      if (d) d.outerHTML = detail();
      else render();
    }
  });

  render();
}

window.lishogi.registerModule(__bundlename__, main);

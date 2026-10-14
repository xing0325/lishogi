// Dumps every taikyokudraft role with its kanji name and promoted flag (input for gen-svgs.py).
// Run after building shogiops: node bin/taikyoku-pieces/dump-roles.mjs > bin/taikyoku-pieces/roles.json
import { TAIKYOKU_ROLES, taikyokuKindOfRole, isPromotedTaikyokuRole } from '../../ui/misc/node_modules/shogiops/dist/variant/taikyoku.js';
const roles = [...new Set(['king', ...TAIKYOKU_ROLES])].map(role => ({
  role,
  kanji: role === 'king' ? '王将' : taikyokuKindOfRole(role)?.kanji ?? '?',
  promoted: role !== 'king' && isPromotedTaikyokuRole(role),
}));
console.log(JSON.stringify(roles, null, 1));

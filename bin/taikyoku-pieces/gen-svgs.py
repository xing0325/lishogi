#!/usr/bin/env python3
"""Generate the taikyokudraft piece set "ryoko_2kanji" in the style of lishogi's default
chushogi set (ui/@build/pieces/assets/chushogi/ryoko_1kanji): same wooden pentagon body,
gradient, outline, base band and colours, with the piece's kanji name set vertically.

Taikyoku shogi has 350 roles (206 pieces + 144 promoted forms); almost every name has two
kanji, so the one-kanji abbreviation used by chushogi sets would be ambiguous here.

Glyph outlines come from Noto Serif CJK JP Black (SIL Open Font License) and are embedded
as paths, so the result does not depend on fonts installed on the player's machine.

    node bin/taikyoku-pieces/dump-roles.mjs > bin/taikyoku-pieces/roles.json
    python3 bin/taikyoku-pieces/gen-svgs.py            # writes ui/@build/pieces/assets/taikyokudraft/ryoko_2kanji
"""
import json, os, sys
from fontTools.ttLib import TTCollection
from fontTools.pens.basePen import BasePen

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "ui/@build/pieces/assets/taikyokudraft/ryoko_2kanji")
FONT = os.environ.get("TK_FONT", "/usr/share/fonts/opentype/noto/NotoSerifCJK-Black.ttc")

# --- copied from ryoko_1kanji/0_DRAGON.svg (full-size body) ---
STOPS = [("0", "#f9da9c"), (".043", "#fbe0a1"), (".067", "#fce6a6"), (".145", "#f4d593"), (".193", "#f5d797"),
         (".243", "#f7dda4"), (".263", "#f9e1ab"), (".329", "#f7dfa8"), (".383", "#f2d89e"), (".398", "#efd599"),
         (".461", "#f2d795"), (".615", "#efda9c"), (".735", "#f6e5ad"), (".773", "#f9e9b4"), (".822", "#f7e1a6"),
         (".887", "#f5db9b"), (".956", "#f4d997"), (".967", "#f4da9c"), ("1", "#f4db9e")]
BODY = "M77.6 15.4 50 5.8l-27.6 9.6-10.6 72.1v6.7h76.4v-6.7z"
BAND = "M12.3 87.5h75.4v6.2H12.3z"
OUTLINE = "#63451a"
PROMOTED = "#a00"   # ryoko_1kanji promoted pieces

# Text area inside the body, per number of characters: list of (centre-y, cell-w, cell-h).
# Cells are squeezed vertically like traditional two-character pieces.
LAYOUT = {
    1: [(50.5, 52, 52)],
    2: [(33.5, 43, 33.5), (66.5, 43, 33.5)],
    3: [(28.5, 37, 23.5), (51.5, 37, 23.5), (74.5, 37, 23.5)],
}
CX = 50.0


class PathPen(BasePen):
    """SVG path pen with a fixed affine map and 2-decimal output."""

    def __init__(self, glyphset, fx):
        super().__init__(glyphset)
        self.fx, self.d = fx, []

    def _p(self, pt):
        x, y = self.fx(pt)
        return f"{x:.2f}".rstrip("0").rstrip(".") + " " + f"{y:.2f}".rstrip("0").rstrip(".")

    def _moveTo(self, pt): self.d.append("M" + self._p(pt))
    def _lineTo(self, pt): self.d.append("L" + self._p(pt))
    def _curveToOne(self, a, b, c): self.d.append("C" + " ".join(self._p(q) for q in (a, b, c)))
    def _qCurveToOne(self, a, b): self.d.append("Q" + " ".join(self._p(q) for q in (a, b)))
    def _closePath(self): self.d.append("Z")


def load_font():
    coll = TTCollection(FONT)
    for f in coll.fonts:  # pick the Japanese member of the collection
        names = " ".join(n.toUnicode() for n in f["name"].names if n.nameID in (1, 4))
        if "JP" in names:
            return f
    return coll.fonts[0]


def glyph_path(font, ch, cy, w, h):
    cmap = font.getBestCmap()
    gname = cmap.get(ord(ch))
    if gname is None:
        raise SystemExit(f"glyph missing for {ch!r}")
    gs = font.getGlyphSet()
    adv = font["hmtx"][gname][0] or 1000
    asc, desc = 880, -120  # ideographic em box of Noto CJK (1000 upm)
    x0, y0 = CX - w / 2, cy - h / 2
    fx = lambda p: (x0 + p[0] * w / adv, y0 + (asc - p[1]) * h / (asc - desc))
    pen = PathPen(gs, fx)
    gs[gname].draw(pen)
    return "".join(pen.d)


def svg(font, name, kanji, promoted, gote):
    chars = list(kanji)
    lay = LAYOUT.get(len(chars)) or LAYOUT[3]
    if len(chars) > 3:  # never happens with the current data; keep the first three
        chars = chars[:3]
    d = "".join(glyph_path(font, c, cy, w, h) for c, (cy, w, h) in zip(chars, lay))
    gid = f"{'1' if gote else '0'}_{name}_a"
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in STOPS)
    fill = f' fill="{PROMOTED}"' if promoted else ""
    body = (
        f'<linearGradient id="{gid}" x1="19.181" x2="80.829" y1="52" y2="52" gradientTransform="matrix(1 0 0 -1 0 102)" gradientUnits="userSpaceOnUse">{stops}</linearGradient>'
        f'<path fill="url(#{gid})" stroke="{OUTLINE}" stroke-miterlimit="10" stroke-width=".954" d="{BODY}"/>'
        f'<path fill="{OUTLINE}" fill-opacity=".75" d="{BAND}"/>'
        f'<path{fill} d="{d}"/>'
    )
    if gote:
        body = f'<g transform="rotate(180 50 50)">{body}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">{body}</svg>\n'


def main():
    roles = json.load(open(os.path.join(HERE, "roles.json"), encoding="utf-8"))
    font = load_font()
    os.makedirs(OUT, exist_ok=True)
    for r in roles:
        name = r["role"].upper()
        for gote in (False, True):
            with open(os.path.join(OUT, f"{'1' if gote else '0'}_{name}.svg"), "w", encoding="utf-8") as fh:
                fh.write(svg(font, name, r["kanji"], r["promoted"], gote))
    print(f"{len(roles)} roles -> {len(roles) * 2} svgs in {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    sys.exit(main())

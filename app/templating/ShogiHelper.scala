package lila.app
package templating

import play.api.i18n.Lang

import lila.api.Context
import lila.app.ui.ScalatagsTemplate._
import lila.common.Icons
import lila.i18n.I18nKey
import lila.pref.Pref

trait ShogiHelper { self: I18nHelper =>

  // maybe locale might be needed for some langauges?
  def transWithColorName(i18nKey: I18nKey, color: shogi.Color, isHandicap: Boolean)(implicit
      ctx: Context,
  ): String =
    i18nKey
      .txt(
        if (isHandicap) handicapColorName(color)
        else standardColorName(color),
      )
      .toLowerCase
      .capitalize

  def standardColorName(color: shogi.Color)(implicit ctx: Context): String =
    ctx.pref.colorName match {
      case Pref.ColorName.SENTEJP => color.fold("先手", "後手")
      case Pref.ColorName.SENTE   => color.fold("Sente", "Gote")
      case Pref.ColorName.BLACK   => color.fold(trans.black.txt(), trans.white.txt())
      case _                      => color.fold(trans.sente.txt(), trans.gote.txt())
    }

  def handicapColorName(color: shogi.Color)(implicit ctx: Context): String =
    ctx.pref.colorName match {
      case Pref.ColorName.SENTEJP => color.fold("下手", "上手")
      case Pref.ColorName.SENTE   => color.fold("Shitate", "Uwate")
      case Pref.ColorName.BLACK   => color.fold(trans.black.txt(), trans.white.txt())
      case _                      => color.fold(trans.shitate.txt(), trans.uwate.txt())
    }

  // not translated yet
  def taikyokuText(zh: String, ja: String, en: String)(implicit lang: Lang): String =
    lang.language match {
      case "zh" => zh
      case "ja" => ja
      case _    => en
    }
  def variantName(v: shogi.variant.Variant)(implicit lang: Lang): String =
    v match {
      case shogi.variant.Minishogi  => trans.minishogi.txt()
      case shogi.variant.Chushogi   => trans.chushogi.txt()
      case shogi.variant.Annanshogi => trans.annanshogi.txt()
      case shogi.variant.Kyotoshogi => trans.kyotoshogi.txt()
      case shogi.variant.Checkshogi => trans.checkshogi.txt()
      case shogi.variant.Dobutsu    => trans.dobutsu.txt()
      case shogi.variant.Taikyokudraft =>
        taikyokuText("大局选将", "大局ドラフト", "Taikyoku Draft")
      case _ => trans.shogi.txt()
    }

  def variantDescription(v: shogi.variant.Variant)(implicit lang: Lang): String =
    v match {
      case shogi.variant.Minishogi  => trans.minishogiDescription.txt()
      case shogi.variant.Chushogi   => trans.chushogiDescription.txt()
      case shogi.variant.Annanshogi => trans.annanshogiDescription.txt()
      case shogi.variant.Kyotoshogi => trans.kyotoshogiDescription.txt()
      case shogi.variant.Checkshogi => trans.checkshogiDescription.txt()
      case shogi.variant.Dobutsu    => trans.dobutsuDescription.txt()
      case shogi.variant.Taikyokudraft =>
        taikyokuText(
          "从大局将棋的棋子池中轮流禁用、选择棋子，在 5×5 棋盘上布阵对弈。",
          "大局将棋の駒からバン・ピックで駒を選び、5×5 の盤に配置して対局します。",
          "Ban and pick pieces from taikyoku shogi, place them on a 5x5 board and play.",
        )
      case _ => trans.standardDescription.txt()
    }

  def variantIcon(v: shogi.variant.Variant): String =
    v match {
      case shogi.variant.Minishogi  => Icons.minishogi
      case shogi.variant.Chushogi   => Icons.chushogi
      case shogi.variant.Annanshogi => Icons.annanshogi
      case shogi.variant.Kyotoshogi => Icons.kyotoshogi
      case shogi.variant.Checkshogi => Icons.checkshogi
      case shogi.variant.Dobutsu    => Icons.dobutsu
      case shogi.variant.Taikyokudraft => Icons.chushogi
      case _                        => Icons.standard
    }

  def statusName(status: shogi.Status, variant: Option[shogi.variant.Variant])(implicit
      lang: Lang,
  ): String =
    status match {
      case shogi.Status.Aborted        => trans.gameAborted.txt()
      case shogi.Status.Mate           => trans.checkmate.txt()
      case shogi.Status.Resign         => trans.resignation.txt()
      case shogi.Status.UnknownFinish  => trans.finished.txt()
      case shogi.Status.Stalemate      => trans.stalemate.txt()
      case shogi.Status.TryRule        => trans.tryRule.txt()
      case shogi.Status.Impasse27      => trans.impasse.txt()
      case shogi.Status.PerpetualCheck => trans.perpetualCheck.txt()
      case shogi.Status.RoyalsLost =>
        if (variant.exists(_.dobutsu)) trans.lionCaptured.txt() else trans.royalsLost.txt()
      case shogi.Status.BareKing    => trans.bareKing.txt()
      case shogi.Status.Check       => trans.check.txt()
      case shogi.Status.IllegalMove => trans.illegalMove.txt()
      case shogi.Status.Timeout     => trans.timeOut.txt()
      case shogi.Status.Repetition  => trans.repetition.txt()
      case shogi.Status.Draw        => trans.draw.txt()
      case shogi.Status.Outoftime   => trans.timeOut.txt()
      case shogi.Status.Paused      => trans.gameAdjourned.txt()
      case shogi.Status.Cheat       => trans.cheatDetected.txt()
      case shogi.Status.NoStart     => ""
      case shogi.Status.Created     => ""
      case shogi.Status.Started     => ""
    }

}

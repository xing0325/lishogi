package views.html

import controllers.routes
import play.api.libs.json.JsObject

import lila.api.Context
import lila.app.templating.Environment._
import lila.app.ui.ScalatagsTemplate._
import lila.taikyoku.DraftRoom

object taikyoku {

  private def t(zh: String, en: String)(implicit ctx: Context) =
    if (ctx.lang.language == "zh") zh else en

  private def title(implicit ctx: Context) = variantName(shogi.variant.Taikyokudraft)

  def home(rooms: List[DraftRoom])(implicit ctx: Context) =
    views.html.base.layout(
      title = title,
      moreCss = cssTag("misc.taikyoku"),
      variant = shogi.variant.Taikyokudraft.some,
    )(
      main(cls := "page-small box box-pad taikyoku-home")(
        h1(title),
        p(cls := "taikyoku-home__desc")(variantDescription(shogi.variant.Taikyokudraft)),
        ul(cls := "taikyoku-home__rules")(
          li(
            t(
              "每局从 205 种可选的大局将棋棋子中随机抽出 24 种组成卡池，每种棋子只能被一方拿到。",
              "Every room draws 24 of the 205 draftable taikyoku shogi pieces, each piece can be taken only once.",
            ),
          ),
          li(
            t(
              "按英雄联盟职业比赛的 BP 顺序：禁 3、选 3、禁 2、选 2，双方各选 5 枚，后手拿最后一手。",
              "League of Legends tournament draft: 3 bans, 3 picks, 2 bans, 2 picks, 5 pieces each, gote has the last pick.",
            ),
          ),
          li(
            t(
              "双方轮流把王将和 5 枚棋子摆在己方底部两行，开局不能形成将军；然后用 lishogi 的对局页对弈，吃掉对方王将获胜。",
              "Players alternately place the king and their 5 pieces on their two home ranks without giving check, then play the game on lishogi; capture the king to win.",
            ),
          ),
        ),
        if (ctx.isAuth)
          postForm(cls := "form3 taikyoku-home__create", action := routes.Taikyoku.create)(
            div(cls := "taikyoku-home__selects")(
              label(t("对局时间", "Clock"))(
                select(name := "limit")(DraftRoom.clockLimits.map { s =>
                  option(value := s, (s == 300) option selected)(s"${s / 60} min")
                }),
              ),
              label(t("每步加秒", "Increment"))(
                select(name := "inc")(DraftRoom.clockIncs.map { s =>
                  option(value := s, (s == 3) option selected)(s"+$s s")
                }),
              ),
              label(t("每次禁选/布阵限时", "Time per ban, pick and placement"))(
                select(name := "step")(DraftRoom.stepTimes.map { s =>
                  option(value := s, (s == 30) option selected)(s"$s s")
                }),
              ),
            ),
            submitButton(cls := "button button-fat")(t("创建房间", "Create a room")),
          )
        else
          p(a(href := routes.Auth.login, cls := "button")(t("登录后创建或加入房间", "Sign in to create or join a room"))),
        h2(t("等待对手的房间", "Rooms waiting for an opponent")),
        if (rooms.isEmpty) p(cls := "taikyoku-home__empty")(t("暂时没有，创建一个吧。", "None yet, create one."))
        else
          table(cls := "slist taikyoku-home__rooms")(
            tbody(rooms.map { r =>
              tr(
                td(showUsernameById(r.owner.some)),
                td(s"${r.clockLimit / 60}+${r.clockInc}"),
                td(s"${r.stepSeconds} s"),
                td(a(href := routes.Taikyoku.show(r.id), cls := "button button-empty")(t("进入", "Open"))),
              )
            }),
          ),
      ),
    )

  def show(room: DraftRoom, data: JsObject)(implicit ctx: Context) =
    views.html.base.layout(
      title = title,
      moreCss = cssTag("misc.taikyoku"),
      moreJs = moduleJsTag(
        "misc.taikyoku",
        data ++ play.api.libs.json.Json.obj(
          "urls" -> play.api.libs.json.Json.obj(
            "state" -> routes.Taikyoku.state(room.id).url,
            "join"  -> routes.Taikyoku.join(room.id).url,
            "act"   -> routes.Taikyoku.act(room.id).url,
            "login" -> routes.Auth.login.url,
          ),
          "me"   -> ctx.userId,
          "lang" -> ctx.lang.language,
        ),
      ),
      variant = shogi.variant.Taikyokudraft.some,
    )(
      main(cls := "taikyoku-room v-taikyokudraft")(
        div(id := "taikyoku-app")(div(cls := "taikyoku-loading")(t("加载中…", "Loading…"))),
      ),
    )
}

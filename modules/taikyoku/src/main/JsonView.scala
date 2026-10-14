package lila.taikyoku

import play.api.libs.json._

import shogi.Color
import shogi.variant.TaikyokuDraft

import lila.common.LightUser
import lila.user.User

final class JsonView(lightUserApi: lila.user.LightUserApi) {

  private def colorKey(c: Color) = c.fold("sente", "gote")

  private def user(id: Option[User.ID]) =
    id.map { uid =>
      val l = lightUserApi.sync(uid) | LightUser.fallback(uid)
      Json.obj("id" -> l.id, "name" -> l.name)
    }

  private def sides[A: Writes](m: Color.Map[A]) = Json.obj("sente" -> m.sente, "gote" -> m.gote)

  def room(r: DraftRoom, me: Option[User], gameUrl: Option[String]): JsObject = {
    val d     = r.draft
    val mine  = me.flatMap(u => r.colorOf(u.id))
    val actor = if (r.started) d.actor else None
    Json
      .obj(
        "id"      -> r.id,
        "version" -> r.actions.size,
        "phase"   -> (if (!r.started) "waiting" else d.phase.key),
        "owner"   -> r.owner,
        "players" -> Json.obj("sente" -> user(r.sente), "gote" -> user(r.gote)),
        "clock"   -> Json.obj("limit" -> r.clockLimit, "inc" -> r.clockInc, "step" -> r.stepSeconds),
        "pool"    -> r.pool,
        "order" -> TaikyokuDraft.Order.map { s =>
          Json.obj("color" -> colorKey(s.color), "ban" -> s.ban)
        },
        "step"    -> d.step,
        "bans"    -> sides(d.bans.map(_.map(_ | ""))),
        "picks"   -> sides(d.picks),
        "toPlace" -> sides(d.toPlace),
        "placed" -> d.placed.map { p =>
          Json.obj("color" -> colorKey(p.color), "kind" -> p.kind, "pos" -> p.pos.key)
        },
      )
      .add("you" -> mine.map(colorKey))
      .add("actor" -> actor.map(colorKey))
      .add("remainingMs" -> r.deadline.filter(_ => actor.isDefined).map { dl =>
        (dl.getMillis - System.currentTimeMillis) atLeast 0L
      })
      .add("placeSquares" -> (for {
        c <- actor if mine.contains(c) && d.phase == TaikyokuDraft.Phase.Place
      } yield JsObject(d.toPlace(c).distinct.map { k =>
        k -> Json.toJson(d.placeSquares(c, k).map(_.key))
      })))
      .add("firstColor" -> (d.phase == TaikyokuDraft.Phase.Done).option(colorKey(d.firstColor)))
      .add("gameUrl" -> gameUrl)
  }
}

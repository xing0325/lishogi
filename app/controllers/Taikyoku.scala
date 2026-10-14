package controllers

import play.api.data._
import play.api.data.Forms._
import play.api.libs.json._

import lila.app._
import lila.taikyoku.DraftRoom

final class Taikyoku(env: Env) extends LilaController(env) {

  private def api = env.taikyoku.api

  private val createForm = Form(
    tuple(
      "limit" -> number.verifying(DraftRoom.clockLimits.contains _),
      "inc"   -> number.verifying(DraftRoom.clockIncs.contains _),
      "step"  -> number.verifying(DraftRoom.stepTimes.contains _),
    ),
  )

  private val actForm = Form(single("action" -> nonEmptyText(maxLength = 80)))

  def home =
    Open { implicit ctx =>
      api.openRooms map { rooms =>
        Ok(views.html.taikyoku.home(rooms))
      }
    }

  def create =
    AuthBody { implicit ctx => me =>
      implicit val body = ctx.body
      createForm
        .bindFromRequest()
        .fold(
          _ => fuccess(BadRequest("Invalid settings")),
          { case (limit, inc, step) =>
            api.create(me, limit, inc, step) map { r =>
              Redirect(routes.Taikyoku.show(r.id))
            }
          },
        )
    }

  def show(id: String) =
    Open { implicit ctx =>
      OptionFuResult(api get id) { room =>
        json(room) map { data =>
          Ok(views.html.taikyoku.show(room, data))
        }
      }
    }

  def state(id: String) =
    Open { implicit ctx =>
      api get id flatMap {
        case None       => notFoundJson()
        case Some(room) => json(room) map { Ok(_) as JSON }
      }
    }

  def join(id: String) =
    Auth { implicit ctx => me =>
      api.join(id, me) flatMap {
        case Left(err)   => fuccess(BadRequest(jsonError(err)) as JSON)
        case Right(room) => json(room) map { Ok(_) as JSON }
      }
    }

  def act(id: String) =
    AuthBody { implicit ctx => me =>
      implicit val body = ctx.body
      actForm
        .bindFromRequest()
        .fold(
          _ => fuccess(BadRequest(jsonError("Invalid action")) as JSON),
          action =>
            api.act(id, me, action) flatMap {
              case Left(err)   => fuccess(BadRequest(jsonError(err)) as JSON)
              case Right(room) => json(room) map { Ok(_) as JSON }
            },
        )
    }

  private def json(room: DraftRoom)(implicit ctx: lila.api.Context): Fu[JsObject] = {
    val mine = ctx.me.flatMap(u => room.colorOf(u.id))
    mine.fold(fuccess(room.gameId.map(gid => s"/$gid")))(c => api.playerUrl(room, c)) map {
      gameUrl => env.taikyoku.jsonView.room(room, ctx.me, gameUrl)
    }
  }
}

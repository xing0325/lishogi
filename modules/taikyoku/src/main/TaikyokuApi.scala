package lila.taikyoku

import org.joda.time.DateTime
import scala.concurrent.duration._

import shogi.Color
import shogi.variant.TaikyokuDraft

import lila.db.dsl._
import lila.game.{ Game, Player, Source }
import lila.user.User

final class TaikyokuApi(
    coll: Coll,
    gameRepo: lila.game.GameRepo,
    userRepo: lila.user.UserRepo,
    onStart: lila.round.OnStart,
)(implicit ec: scala.concurrent.ExecutionContext, system: akka.actor.ActorSystem) {

  import BSONHandlers._

  // actions on a room are applied one at a time
  private val sequencer = new lila.hub.DuctSequencers(
    maxSize = 64,
    expiration = 10 minutes,
    timeout = 5 seconds,
    name = "taikyoku",
  )

  def create(me: User, clockLimit: Int, clockInc: Int, stepSeconds: Int): Fu[DraftRoom] = {
    val room = DraftRoom.make(me.id, clockLimit, clockInc, stepSeconds)
    coll.insert.one(room) inject room
  }

  // Applies the automatic actions of expired steps, starts the game when the draft is over
  def get(id: DraftRoom.ID): Fu[Option[DraftRoom]] =
    coll.byId[DraftRoom](id) flatMap {
      case Some(r) if r.started && r.gameId.isEmpty && r.deadline.exists(_.isBeforeNow) =>
        sequencer(id)(fetch(id) flatMap { _ ?? (r => catchUp(r) dmap some) })
      case other => fuccess(other)
    }

  def openRooms: Fu[List[DraftRoom]] =
    coll
      .find($doc("gote" $exists false, "createdAt" $gt DateTime.now.minusHours(2)))
      .sort($sort desc "createdAt")
      .cursor[DraftRoom]()
      .list(30)

  def join(id: DraftRoom.ID, me: User): Fu[Either[String, DraftRoom]] =
    sequencer(id) {
      fetch(id) flatMap {
        case None                              => fuccess(Left("No such room"))
        case Some(r) if r.started              => fuccess(Left("The room is full"))
        case Some(r) if r.owner == me.id       => fuccess(Left("Wait for an opponent"))
        case Some(r) =>
          val ownerSente = lila.common.ThreadLocalRandom.nextBoolean()
          val joined = r.copy(
            sente = Some(if (ownerSente) r.owner else me.id),
            gote = Some(if (ownerSente) me.id else r.owner),
            deadline = Some(DateTime.now.plusSeconds(r.stepSeconds)),
          )
          save(joined) inject Right(joined)
      }
    }

  def act(id: DraftRoom.ID, me: User, actionStr: String): Fu[Either[String, DraftRoom]] =
    sequencer(id) {
      fetch(id) flatMap {
        case None                 => fuccess(Left("No such room"))
        case Some(r) if !r.started => fuccess(Left("Waiting for an opponent"))
        case Some(r0) =>
          catchUp(r0) flatMap { r =>
            (r.colorOf(me.id), TaikyokuDraft.Action.parse(actionStr)) match {
              case (None, _) => fuccess(Left("You are not playing in this room"))
              case (_, None) => fuccess(Left("Invalid action"))
              case (Some(color), Some(action)) =>
                r.draft(color, action) match {
                  case Left(err) => fuccess(Left(err))
                  case Right(_) =>
                    val next = r.withAction(color, action).copy(
                      deadline = Some(DateTime.now.plusSeconds(r.stepSeconds)),
                    )
                    finishIfDone(next) flatMap { n => save(n) inject Right(n) }
                }
            }
          }
      }
    }

  private def fetch(id: DraftRoom.ID) = coll.byId[DraftRoom](id)

  private def save(r: DraftRoom): Funit = coll.update.one($id(r.id), r).void

  // Automatic actions (no ban, random pick, random placement) for every expired step
  private def catchUp(room: DraftRoom): Fu[DraftRoom] = {
    @scala.annotation.tailrec
    def loop(r: DraftRoom, deadline: DateTime): DraftRoom =
      if (!deadline.isBeforeNow || r.draft.phase == TaikyokuDraft.Phase.Done) r
      else {
        val rng = new scala.util.Random(r.id.hashCode.toLong * 31 + r.actions.size)
        (r.draft.actor, r.draft.autoAction(rng)) match {
          case (Some(color), Some(action)) =>
            val next = deadline.plusSeconds(r.stepSeconds)
            loop(r.withAction(color, action).copy(deadline = Some(next)), next)
          case _ => r
        }
      }
    room.deadline.filter(_ => room.started && room.gameId.isEmpty) match {
      case Some(d) if d.isBeforeNow =>
        val next = loop(room, d)
        if (next == room) fuccess(room)
        else finishIfDone(next) flatMap { n => save(n) inject n }
      case _ => fuccess(room)
    }
  }

  private def finishIfDone(r: DraftRoom): Fu[DraftRoom] =
    if (r.gameId.isDefined || r.draft.phase != TaikyokuDraft.Phase.Done) fuccess(r)
    else
      r.draft.sfen.fold(fuccess(r)) { sfen =>
        for {
          senteUser <- r.sente ?? userRepo.byId
          goteUser  <- r.gote ?? userRepo.byId
          perfType = lila.rating.PerfType.from(shogi.variant.Taikyokudraft, hasClock = true)
          shogiGame = shogi
            .Game(Some(sfen), shogi.variant.Taikyokudraft)
            .withClock(Some(r.clockConfig.toClock))
          game = Game
            .make(
              shogi = shogiGame,
              initialSfen = Some(sfen),
              sentePlayer = Player.make(shogi.Sente, senteUser, perfType),
              gotePlayer = Player.make(shogi.Gote, goteUser, perfType),
              mode = shogi.Mode.Casual,
              proMode = false,
              source = Source.Friend,
              daysPerTurn = None,
              notationImport = None,
            )
            .withId(r.id)
            .start
          _ <- gameRepo insertDenormalized game
        } yield {
          onStart(game.id)
          r.copy(gameId = Some(game.id), deadline = None)
        }
      }

  def playerUrl(r: DraftRoom, color: Color): Fu[Option[String]] =
    r.gameId ?? { gid =>
      gameRepo game gid map {
        _.map(g => s"/${g.fullIdOf(color)}")
      }
    }
}

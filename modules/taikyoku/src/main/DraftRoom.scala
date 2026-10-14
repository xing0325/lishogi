package lila.taikyoku

import org.joda.time.DateTime

import shogi.Color
import shogi.variant.TaikyokuDraft

import lila.user.User

// A taikyokudraft room: ban/pick and placement phases, then a regular lila game (gameId).
// Only the pool and the actions are stored, the draft state is replayed from them.
case class DraftRoom(
    _id: DraftRoom.ID,
    owner: User.ID,
    sente: Option[User.ID], // colors are assigned when the second player joins
    gote: Option[User.ID],
    clockLimit: Int,        // seconds
    clockInc: Int,          // seconds
    stepSeconds: Int,       // time for every ban, pick and placement
    pool: List[String],
    actions: List[String],  // "b ban dog", "w pick free-eagle", "b place king 3e"
    deadline: Option[DateTime],
    gameId: Option[String],
    createdAt: DateTime,
) {

  def id = _id

  def started = sente.isDefined && gote.isDefined

  def playerIds = List(sente, gote).flatten

  def colorOf(userId: User.ID): Option[Color] =
    if (sente contains userId) Some(shogi.Sente)
    else if (gote contains userId) Some(shogi.Gote)
    else None

  def userIdOf(color: Color) = color.fold(sente, gote)

  lazy val parsedActions: List[(Color, TaikyokuDraft.Action)] =
    actions flatMap { str =>
      str.split(" ", 2).toList match {
        case c :: a :: Nil =>
          TaikyokuDraft.Action.parse(a).map(Color.fromSente(c == "b") -> _)
        case _ => None
      }
    }

  // stored actions are always valid, they were checked before being stored
  lazy val draft: TaikyokuDraft =
    TaikyokuDraft.replay(pool, parsedActions).getOrElse(sys.error(s"Invalid draft $id"))

  def withAction(color: Color, action: TaikyokuDraft.Action) =
    copy(actions = actions :+ s"${color.fold("b", "w")} ${TaikyokuDraft.Action.write(action)}")

  def clockConfig = shogi.Clock.Config(clockLimit, clockInc, 0, 0)
}

object DraftRoom {

  type ID = String

  val clockLimits = List(60, 180, 300, 600, 900)
  val clockIncs   = List(0, 2, 3, 5, 10)
  val stepTimes   = List(20, 30, 45, 60)

  def make(owner: User.ID, clockLimit: Int, clockInc: Int, stepSeconds: Int) = {
    val rng = new scala.util.Random(lila.common.ThreadLocalRandom.nextLong())
    DraftRoom(
      _id = lila.common.ThreadLocalRandom nextString 8,
      owner = owner,
      sente = None,
      gote = None,
      clockLimit = clockLimit,
      clockInc = clockInc,
      stepSeconds = stepSeconds,
      pool = TaikyokuDraft(rng).pool,
      actions = Nil,
      deadline = None,
      gameId = None,
      createdAt = DateTime.now,
    )
  }
}

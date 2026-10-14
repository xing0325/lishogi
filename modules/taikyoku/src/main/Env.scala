package lila.taikyoku

import com.softwaremill.macwire._

import lila.common.config.CollName

@Module
final class Env(
    db: lila.db.Db,
    gameRepo: lila.game.GameRepo,
    userRepo: lila.user.UserRepo,
    lightUserApi: lila.user.LightUserApi,
    onStart: lila.round.OnStart,
)(implicit
    ec: scala.concurrent.ExecutionContext,
    system: akka.actor.ActorSystem,
) {

  private lazy val coll = db(CollName("taikyoku_draft"))

  lazy val api = new TaikyokuApi(coll, gameRepo, userRepo, onStart)

  lazy val jsonView = wire[JsonView]
}

package lila.taikyoku

import reactivemongo.api.bson._

import lila.db.dsl._

private object BSONHandlers {

  implicit val DraftRoomBSONHandler: BSONDocumentHandler[DraftRoom] = Macros.handler[DraftRoom]
}

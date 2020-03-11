class OkPacket {
  constructor(affectedRows, insertId, warningStatus) {
    this.affectedRows = affectedRows;
    this.insertId = insertId;
    this.warningStatus = warningStatus;
  }
}

module.exports = OkPacket;

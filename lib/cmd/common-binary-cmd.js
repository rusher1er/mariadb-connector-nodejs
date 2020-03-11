'use strict';

const ResultSet = require('./resultset');
const FieldType = require('../const/field-type');
const FieldDetail = require('../const/field-detail');

class CommonBinary extends ResultSet {
  constructor(resolve, reject, cmdOpts, connOpts, sql, values) {
    super(resolve, reject);
    this.configAssign(connOpts, cmdOpts);
    this.sql = sql;
    this.initialValues = values;
  }

  /**
   * Write (and escape) current parameter value to output writer
   *
   * @param out     output writer
   * @param value   current parameter
   * @param opts    connection options
   * @param info    connection information
   */
  writeParam(out, value, opts, info) {
    let flushed = false;
    switch (typeof value) {
      case 'boolean':
        flushed = out.writeInt8(0x00);
        flushed = out.writeInt8(value ? 0x01 : 0x00) || flushed;
        break;
      case 'number':
        flushed = out.writeInt8(0x00);
        flushed = out.writeLengthStringAscii('' + value) || flushed;
        break;
      case 'object':
        if (Object.prototype.toString.call(value) === '[object Date]') {
          flushed = out.writeInt8(0x00);
          flushed = out.writeBinaryDate(value, opts) || flushed;
        } else if (Buffer.isBuffer(value)) {
          flushed = out.writeInt8(0x00);
          flushed = out.writeLengthEncodedBuffer(value) || flushed;
        } else if (typeof value.toSqlString === 'function') {
          flushed = out.writeInt8(0x00);
          flushed = out.writeLengthEncodedString(String(value.toSqlString())) || flushed;
        } else {
          if (
            value.type != null &&
            [
              'Point',
              'LineString',
              'Polygon',
              'MultiPoint',
              'MultiLineString',
              'MultiPolygon',
              'GeometryCollection'
            ].includes(value.type)
          ) {
            const geoBuff = this.getBufferFromGeometryValue(value);
            if (geoBuff) {
              flushed = out.writeInt8(0x00); //Value follow
              flushed =
                out.writeLengthEncodedBuffer(Buffer.concat([Buffer.from([0, 0, 0, 0]), geoBuff])) ||
                flushed;
            } else {
              flushed = out.writeInt8(0x01); //NULL
            }
          } else {
            //TODO check if permitSetMultiParamEntries is needed !?
            flushed = out.writeInt8(0x00);
            flushed = out.writeLengthEncodedString(JSON.stringify(value)) || flushed;
          }
        }
        break;
      default:
        flushed = out.writeInt8(0x00);
        flushed = out.writeLengthEncodedString(value) || flushed;
    }
    return flushed;
  }

  getBufferFromGeometryValue(value, headerType) {
    let geoBuff;
    let pos;
    let type;
    if (!headerType) {
      switch (value.type) {
        case 'Point':
          geoBuff = Buffer.allocUnsafe(21);
          geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
          geoBuff.writeInt32LE(1, 1); //wkbPoint
          if (
            value.coordinates &&
            Array.isArray(value.coordinates) &&
            value.coordinates.length >= 2 &&
            !isNaN(value.coordinates[0]) &&
            !isNaN(value.coordinates[1])
          ) {
            geoBuff.writeDoubleLE(value.coordinates[0], 5); //X
            geoBuff.writeDoubleLE(value.coordinates[1], 13); //Y
            return geoBuff;
          } else {
            return null;
          }

        case 'LineString':
          if (value.coordinates && Array.isArray(value.coordinates)) {
            const pointNumber = value.coordinates.length;
            geoBuff = Buffer.allocUnsafe(9 + 16 * pointNumber);
            geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
            geoBuff.writeInt32LE(2, 1); //wkbLineString
            geoBuff.writeInt32LE(pointNumber, 5);
            for (let i = 0; i < pointNumber; i++) {
              if (
                value.coordinates[i] &&
                Array.isArray(value.coordinates[i]) &&
                value.coordinates[i].length >= 2 &&
                !isNaN(value.coordinates[i][0]) &&
                !isNaN(value.coordinates[i][1])
              ) {
                geoBuff.writeDoubleLE(value.coordinates[i][0], 9 + 16 * i); //X
                geoBuff.writeDoubleLE(value.coordinates[i][1], 17 + 16 * i); //Y
              } else {
                return null;
              }
            }
            return geoBuff;
          } else {
            return null;
          }

        case 'Polygon':
          if (value.coordinates && Array.isArray(value.coordinates)) {
            const numRings = value.coordinates.length;
            let size = 0;
            for (let i = 0; i < numRings; i++) {
              size += 4 + 16 * value.coordinates[i].length;
            }
            geoBuff = Buffer.allocUnsafe(9 + size);
            geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
            geoBuff.writeInt32LE(3, 1); //wkbPolygon
            geoBuff.writeInt32LE(numRings, 5);
            pos = 9;
            for (let i = 0; i < numRings; i++) {
              const lineString = value.coordinates[i];
              if (lineString && Array.isArray(lineString)) {
                geoBuff.writeInt32LE(lineString.length, pos);
                pos += 4;
                for (let j = 0; j < lineString.length; j++) {
                  if (
                    lineString[j] &&
                    Array.isArray(lineString[j]) &&
                    lineString[j].length >= 2 &&
                    !isNaN(lineString[j][0]) &&
                    !isNaN(lineString[j][1])
                  ) {
                    geoBuff.writeDoubleLE(lineString[j][0], pos); //X
                    geoBuff.writeDoubleLE(lineString[j][1], pos + 8); //Y
                    pos += 16;
                  } else {
                    return null;
                  }
                }
              }
            }
            return geoBuff;
          } else {
            return null;
          }

        case 'MultiPoint':
          type = 'MultiPoint';
          geoBuff = Buffer.allocUnsafe(9);
          geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
          geoBuff.writeInt32LE(4, 1); //wkbMultiPoint
          break;

        case 'MultiLineString':
          type = 'MultiLineString';
          geoBuff = Buffer.allocUnsafe(9);
          geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
          geoBuff.writeInt32LE(5, 1); //wkbMultiLineString
          break;

        case 'MultiPolygon':
          type = 'MultiPolygon';
          geoBuff = Buffer.allocUnsafe(9);
          geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
          geoBuff.writeInt32LE(6, 1); //wkbMultiPolygon
          break;

        case 'GeometryCollection':
          geoBuff = Buffer.allocUnsafe(9);
          geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
          geoBuff.writeInt32LE(7, 1); //wkbGeometryCollection

          if (value.geometries && Array.isArray(value.geometries)) {
            const coordinateLength = value.geometries.length;
            const subArrays = [geoBuff];
            for (let i = 0; i < coordinateLength; i++) {
              const tmpBuf = this.getBufferFromGeometryValue(value.geometries[i]);
              if (tmpBuf == null) break;
              subArrays.push(tmpBuf);
            }
            geoBuff.writeInt32LE(subArrays.length - 1, 5);
            return Buffer.concat(subArrays);
          } else {
            geoBuff.writeInt32LE(0, 5);
            return geoBuff;
          }
        default:
          return null;
      }
      if (value.coordinates && Array.isArray(value.coordinates)) {
        const coordinateLength = value.coordinates.length;
        const subArrays = [geoBuff];
        for (let i = 0; i < coordinateLength; i++) {
          const tmpBuf = this.getBufferFromGeometryValue(value.coordinates[i], type);
          if (tmpBuf == null) break;
          subArrays.push(tmpBuf);
        }
        geoBuff.writeInt32LE(subArrays.length - 1, 5);
        return Buffer.concat(subArrays);
      } else {
        geoBuff.writeInt32LE(0, 5);
        return geoBuff;
      }
    } else {
      switch (headerType) {
        case 'MultiPoint':
          if (
            value &&
            Array.isArray(value) &&
            value.length >= 2 &&
            !isNaN(value[0]) &&
            !isNaN(value[1])
          ) {
            geoBuff = Buffer.allocUnsafe(21);
            geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
            geoBuff.writeInt32LE(1, 1); //wkbPoint
            geoBuff.writeDoubleLE(value[0], 5); //X
            geoBuff.writeDoubleLE(value[1], 13); //Y
            return geoBuff;
          }
          return null;

        case 'MultiLineString':
          if (value && Array.isArray(value)) {
            const pointNumber = value.length;
            geoBuff = Buffer.allocUnsafe(9 + 16 * pointNumber);
            geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
            geoBuff.writeInt32LE(2, 1); //wkbLineString
            geoBuff.writeInt32LE(pointNumber, 5);
            for (let i = 0; i < pointNumber; i++) {
              if (
                value[i] &&
                Array.isArray(value[i]) &&
                value[i].length >= 2 &&
                !isNaN(value[i][0]) &&
                !isNaN(value[i][1])
              ) {
                geoBuff.writeDoubleLE(value[i][0], 9 + 16 * i); //X
                geoBuff.writeDoubleLE(value[i][1], 17 + 16 * i); //Y
              } else {
                return null;
              }
            }
            return geoBuff;
          }
          return null;

        case 'MultiPolygon':
          if (value && Array.isArray(value)) {
            const numRings = value.length;
            let size = 0;
            for (let i = 0; i < numRings; i++) {
              size += 4 + 16 * value[i].length;
            }
            geoBuff = Buffer.allocUnsafe(9 + size);
            geoBuff.writeInt8(0x01, 0); //LITTLE ENDIAN
            geoBuff.writeInt32LE(3, 1); //wkbPolygon
            geoBuff.writeInt32LE(numRings, 5);
            pos = 9;
            for (let i = 0; i < numRings; i++) {
              const lineString = value[i];
              if (lineString && Array.isArray(lineString)) {
                geoBuff.writeInt32LE(lineString.length, pos);
                pos += 4;
                for (let j = 0; j < lineString.length; j++) {
                  if (
                    lineString[j] &&
                    Array.isArray(lineString[j]) &&
                    lineString[j].length >= 2 &&
                    !isNaN(lineString[j][0]) &&
                    !isNaN(lineString[j][1])
                  ) {
                    geoBuff.writeDoubleLE(lineString[j][0], pos); //X
                    geoBuff.writeDoubleLE(lineString[j][1], pos + 8); //Y
                    pos += 16;
                  } else {
                    return null;
                  }
                }
              }
            }
            return geoBuff;
          }
          return null;
      }
      return null;
    }
  }

  /**
   * Read text result-set row
   *
   * see: https://mariadb.com/kb/en/library/resultset-row/#text-resultset-row
   * data are created according to their type.
   *
   * @param columns     columns metadata
   * @param packet      current row packet
   * @param connOpts    connection options
   * @returns {*}       row data
   */
  parseRow(columns, packet, connOpts) {
    throw new Error('not implemented');
  }

  parseRowAsArray(columns, packet, connOpts) {
    const row = new Array(this._columnCount);
    for (let i = 0; i < this._columnCount; i++) {
      row[i] = this._getValue(i, columns[i], this.opts, connOpts, packet);
    }
    return row;
  }

  parseRowNested(columns, packet, connOpts) {
    const row = {};
    for (let i = 0; i < this._columnCount; i++) {
      if (!row[this.tableHeader[i][0]]) row[this.tableHeader[i][0]] = {};
      row[this.tableHeader[i][0]][this.tableHeader[i][1]] = this._getValue(
        i,
        columns[i],
        this.opts,
        connOpts,
        packet
      );
    }
    return row;
  }

  parseRowStd(columns, packet, connOpts) {
    packet.skip(1); //skip 0x00 header
    const nullBuf = packet.readBuffer(Math.floor((this._columnCount + 7 + 2) / 8));
    const row = {};
    for (let i = 0; i < this._columnCount; i++) {
      row[this.tableHeader[i]] = this._getValue(
        i,
        columns[i],
        this.opts,
        connOpts,
        packet,
        nullBuf
      );
    }
    return row;
  }

  readCastValue(index, column, opts, connOpts, packet, nullBuf) {
    this.castTextWrapper(column, opts, connOpts, packet, nullBuf);
    return opts.typeCast(
      column,
      this.readRowData.bind(this, index, column, opts, connOpts, packet, nullBuf)
    );
  }

  /**
   * Read row data.
   *
   * @param index     current data index in row
   * @param column    associate metadata
   * @param opts   query options
   * @param connOpts  connection options
   * @param packet    row packet
   * @returns {*}     data
   */
  readRowData(index, column, opts, connOpts, packet, nullBuf) {
    if ((nullBuf[1 + (index + 2) / 8] & (1 << (index + 2) % 8)) != 0) {
      return null;
    }
    switch (column.columnType) {
      case FieldType.DOUBLE:
        return packet.readDouble();
      case FieldType.LONGLONG:
        return (column.flags & FieldDetail.UNSIGNED) > 0 ? packet.readUInt64() : packet.readInt64();

      case FieldType.INT24:
      case FieldType.LONG:
        return (column.flags & FieldDetail.UNSIGNED) > 0 ? packet.readUInt32() : packet.readInt32();

      case FieldType.SHORT:
      case FieldType.YEAR:
        return (column.flags & FieldDetail.UNSIGNED) > 0 ? packet.readUInt16() : packet.readInt16();

      case FieldType.TINY:
        return (column.flags & FieldDetail.UNSIGNED) > 0 ? packet.readUInt8() : packet.readInt8();

      case FieldType.FLOAT:
        return packet.readFloat();

      case FieldType.DECIMAL:
      case FieldType.NEWDECIMAL:
        return packet.readDecimalLengthEncoded(opts.supportBigNumbers, opts.bigNumberStrings);
      case FieldType.DATE:
      case FieldType.DATETIME:
      case FieldType.TIMESTAMP:
        return packet.readBinaryDate();
      case FieldType.TIME:
        return packet.readBinaryTime();
      case FieldType.GEOMETRY:
        return packet.readGeometry();
      case FieldType.JSON:
        //for mysql only => parse string as JSON object
        return JSON.parse(packet.readStringLengthEncoded('utf8'));

      default:
        if (column.collation.index === 63) {
          return packet.readBufferLengthEncoded();
        }
        const string = packet.readStringLength();
        if (column.flags & 2048) {
          //SET
          return string == null ? null : string === '' ? [] : string.split(',');
        }
        return string;
    }
  }
}

module.exports = CommonBinary;

const { Model, Sequelize, DataTypes } = require("sequelize")

class Nukes extends Model {}

/**
 * 
 * @param {Sequelize} sequelize 
 * @param {DataTypes} DataTypes 
 * @returns {Nukes}
 */
module.exports = (sequelize, DataTypes) => {
  return Nukes.init({
    id: {
      type: DataTypes.STRING,
      primaryKey: true
    },
    room: DataTypes.STRING,
    shard: DataTypes.STRING,
    landTime: DataTypes.INTEGER,
    launchRoomName: DataTypes.STRING,
    attacker: DataTypes.STRING,
    defender: DataTypes.STRING,
    level: DataTypes.INTEGER,
    launchAnnounced: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    midwayAnnounced: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    nearLandAnnounced: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    sequelize,
    timestamps: true
  })
}

/*
    "_id": "5db50db12c71f9c92dd2e5eb",
    "type": "nuke",
    "room": "W54N45",
    "x": 25,
    "y": 16,
    "landTime": 20057549,
    "launchRoomName": "W53N44",
    "shard": "shard2",
    "attacker": "Davaned",
    "defender": "Invader",
    "level": 5,
    "midwayAnnounced": true
 */
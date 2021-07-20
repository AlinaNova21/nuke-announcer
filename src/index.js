const minimist = require('minimist')
const { ScreepsAPI } = require('screeps-api')
const { DataTypes, Sequelize, Model, Op } = require('sequelize')
const moment = require('moment')
const axios = require('axios')
const events = require('events')
const Discord = require('discord.js')

const args = minimist(process.argv.slice(2), {
  default: {
    server: process.env.NA_SERVER || 'main',
    config: process.env.NA_CONFIG || 'nuke-announcer',
    db: process.env.NA_DB || 'sqlite:nukes.db'
  }
})

let api
const times = {}

const notifiers = [
  {
    name: 'discord',
    /** @type {Discord.Client} */
    client: null,
    /** @type {Discord.Channel} */
    channel: null,
    async connect () {

      const { discord: { token, channel } = {} } = api.appConfig || {}
      console.log('Connecting Discord Bot')
      this.client = new Discord.Client()
      this.client.login(token)
      await events.once(this.client, 'ready')
      this.channel = await this.client.channels.fetch(channel)
    },
    disconnect () {
      if (!this.client) return
      console.log('Disconnecting Discord Bot')
      this.client.destroy()
    },
    link(url, label) {
      return `[${label}](${url})`
    },
    date(date) {
      return `<t:${date}>`
    },
    async send({ title, text, color, url }) {
      if (!this.channel) return
      const message = new Discord.MessageEmbed()
      .setTitle(`<:nuke:865250606058700802> ${title} <:nuke:865250606058700802>`)
      .setColor(color)
      .setDescription(text)
      .setURL(url)
      await this.channel.send(message)
    }
  },
  {
    name: 'slack',
    link(url, label) {
      return `<${url}|${label}>`
    },
    date (date) {
      const fallback = moment(date * 1000).format()
      return `<!date^${date}^{date} {time}|${fallback}>`
    },
    async send({ title, text, color, url }) {
      const { slack: { webhook, channel } = {} } = api.appConfig || {}
      if (!webhook) return
      await axios.post(webhook, {
        channel,
        text: '',
        attachments: [
          {
            fallback: text,
            text,
            title,
            title_link: url,
            color,
            ts: Math.floor(Date.now() / 1000)
          }
        ]
      })
    }
  }
]

async function run() {
  const sequelize = new Sequelize(args.db, {
    logging: !!process.env.DEBUG
  })
  const Nukes = require('./models/nukes')(sequelize, DataTypes)
  Nukes.sync()
  try {
    api = await ScreepsAPI.fromConfig(args.server, args.config)
    const { nukes: data } = await api.raw.experimental.nukes()
    const { shards } = await getShards(data)
    for (const shard of shards) {
      const { time } = await api.raw.game.time(shard.name)
      shard.time = time
      times[shard.name] = { time, tick: shard.tick }
      const rooms = new Set([...data[shard.name].map(n => n.room), ...data[shard.name].map(n => n.launchRoomName)])
      const { stats, users } = await api.raw.game.mapStats(Array.from(rooms), 'owner0', shard.name)
      for (const nuke of data[shard.name]) {
        let announce = false
        const attacker = stats[nuke.launchRoomName].own ? users[stats[nuke.launchRoomName].own.user].username : ''
        const defender = stats[nuke.room].own ? users[stats[nuke.room].own.user].username : ''
        const level = stats[nuke.room].own ? stats[nuke.room].own.level : 0
        await Nukes.findOrCreate({
          where: {
            id: nuke._id
          },
          defaults: {
            id: nuke._id,
            room: nuke.room,
            shard: shard.name,
            landTime: nuke.landTime,
            launchRoomName: nuke.launchRoomName,
            attacker,
            defender,
            level
          }
        })
      }
    }

    const nukes = await Nukes.findAll({
      where: {
        shard: {
          [Op.in]: Object.keys(times)
        }
      }
    })
    notifiers.forEach(n => {
      if (!n.connect) n.connect = () => {}
      if (!n.disconnect) n.disconnect = () => {}
    })
    await Promise.all(notifiers.map(n => n.connect()))
    for (const nuke of nukes) {
      const { time, tick } = times[nuke.shard]
      const midway = (nuke.landTime - 25000) < time
      const nearLand = (nuke.landTime - ((60 * 60 * 1000) / tick)) < time
      if (!nuke.launchAnnounced) {
        await notify(nuke, 'Nuclear Launch Detected')
        nuke.launchAnnounced = true
      }
      if (!nuke.midwayAnnounced && midway) {
        await notify(nuke, 'Nuke Reached Midway Point')
        nuke.midwayAnnounced = true
      }
      if (!nuke.nearLandAnnounced && nearLand) {
        await notify(nuke, 'Nuclear Impact Imminent')
        nuke.nearLandAnnounced = true
      }
      if (nuke.landTime < time) {
        await nuke.destroy()
        continue
      }
      await nuke.save()
    }
  } catch (err) {
    console.error(`Error processing shards:`, err)
  }
  await Promise.all(notifiers.map(n => n.disconnect()))
}


async function notify(nuke, type) {
  const eta = nuke.landTime - times[nuke.shard].time
  const etaSeconds = Math.floor((eta * times[nuke.shard].tick) / 1000)
  const impact = Math.floor(Math.floor(nuke.landTime / 100) * 100)
  const diff = Math.floor(etaSeconds * 0.05)
  const now = Math.floor(Date.now() / 1000)
  const etaEarly = now + etaSeconds - diff
  const etaLate = now + etaSeconds + diff
  const rcl = nuke.level ? ` (RCL ${nuke.level})` : ''
  await Promise.all(notifiers.map(async n => {
    const parts = []
    if (process.env.DEBUG) {
      parts.push('DEBUG MODE')
    }
    if (nuke.defender) {
      parts.push(`Defender: ${n.link(`https://screeps.com/a/#!/profile/${nuke.defender}`, nuke.defender)}`)
    }
    parts.push(`Attacker: ${n.link(`https://screeps.com/a/#!/profile/${nuke.attacker}`, nuke.attacker)}`)
    parts.push(`Launch Site: ${n.link(`https://screeps.com/a/#!/room/${nuke.shard}/${nuke.launchRoomName}`, `${nuke.shard} - ${nuke.launchRoomName}`)}`)
    parts.push(`ETA: ${eta} ticks (between ${n.date(etaEarly)} to ${n.date(etaLate)})`)
    parts.push(`History: ${n.link(`https://screeps.com/a/#!/history/${nuke.shard}/${nuke.room}?t=${impact}`, `tick #${impact}`)} (Impact time)`)
    const text = parts.join("\n")
    console.log(text)
    await n.send({
      title: `${type}: ${nuke.shard} ${nuke.room}${rcl}`,
      text,
      url: `https://screeps.com/a/#!/room/${nuke.shard}/${nuke.room}`,
      color: '#FF0000'
    })
  }))
}

async function getShards(data) {
  if (api.isOfficialServer()) {
    return api.raw.game.shards.info()
  }
  const [name] = Object.keys(data)
  const { tick } = await api.req('GET', '/api/game/tick')
  return {
    shards: [{
      name,
      tick
    }]
  }
}

run().catch(console.error)

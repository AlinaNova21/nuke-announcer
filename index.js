const minimist = require('minimist')
const { ScreepsAPI } = require('screeps-api')
const fs = require('fs').promises
const moment = require('moment')
const axios = require('axios')

const args = minimist(process.argv.slice(2), {
  default: {
    server: 'main',
    config: 'nuke-announcer',
    nukeFile: './nukes.json'
  }
})

let nukes = []
let api

async function run() {
  try {
    const data = JSON.parse(await fs.readFile(args.nukeFile, 'utf8'))
    nukes = data
  } catch(err) {
  }
  nukes = new Map(nukes.map(n => [n._id, n]))
  api = await ScreepsAPI.fromConfig(args.server, args.config)
  const { nukes: data } = await api.raw.experimental.nukes()
  const times = {}
  const rates = {}
  const { shards } = await api.raw.game.shards.info()
  for(const shard of shards) {
    const { time } = await api.raw.game.time(shard.name)
    shard.time = time
    times[shard.name] = time
    const rooms = new Set([...data[shard.name].map(n => n.room), ...data[shard.name].map(n => n.launchRoomName)])
    const { stats, users } = await api.raw.game.mapStats(Array.from(rooms), 'owner0', shard.name)
    for(const nuke of data[shard.name]) {
      if(nukes.has(nuke._id)) continue
      nuke.shard = shard.name
      if (stats[nuke.launchRoomName].own) {
        nuke.attacker = users[stats[nuke.launchRoomName].own.user].username
      }
      if (stats[nuke.room].own) {
        nuke.defender = users[stats[nuke.room].own.user].username
      }
      nukes.set(nuke._id, nuke)
      await notify(nuke, shard)
    }
  }
  for (const [id, nuke] of nukes) {
    if (nuke.landTime < times[nuke.shard]) {
      nukes.delete(id)
    }
  }
  await fs.writeFile(args.nukeFile, JSON.stringify(Array.from(nukes.values())))
}

async function notify(nuke, shard) {
  const eta = nuke.landTime - shard.time
  const parts = []
  const etaSeconds = Math.floor((eta * shard.tick) / 1000)
  const impact = Math.floor(Math.floor(nuke.landTime / 100) * 100)
  const diff = Math.floor(etaSeconds * 0.2)
  const now = Math.floor(Date.now() / 1000)
  const etaEarly = now + etaSeconds - diff
  const etaLate = now + etaSeconds + diff
  const etaEarlyText = moment(etaEarly * 1000).format()
  const etaLateText = moment(etaLate * 1000).format()
  if (nuke.defender) {
    parts.push(`Defender: <https://screeps.com/a/#!/profile/${nuke.defender}|${nuke.defender}>`)
  }
  parts.push(`Attacker: <https://screeps.com/a/#!/profile/${nuke.attacker}|${nuke.attacker}>`)
  parts.push(`Launch Site: <https://screeps.com/a/#!/room/${nuke.shard}/${nuke.launchRoomName}|${nuke.shard} - ${nuke.launchRoomName}>`)
  parts.push(`ETA: ${eta} ticks (between <!date^${etaEarly}^{date} {time}|${etaEarlyText}> to <!date^${etaLate}^{date} {time}|${etaLateText}>)`)
  parts.push(`History: <https://screeps.com/a/#!/history/${nuke.shard}/${nuke.room}?t=${impact}|tick #${impact}> (Impact time)`)
  const text = parts.join("\n")
  console.log(text)
  const { slack: { webhook, channel } = {} } = api.appConfig || {}
  if (webhook) {
    await axios.post(webhook, {
      channel,
      text: '',
      attachments: [
        {
          fallback: text,
          text,
          title: `Nuclear Launch Detected: ${nuke.shard} ${nuke.room}`,
          title_link: `https://screeps.com/a/#!/room/${nuke.shard}/${nuke.room}`,
          color: 'danger',
          ts: now
        }
      ]
    })
  }
}

run().catch(console.error)

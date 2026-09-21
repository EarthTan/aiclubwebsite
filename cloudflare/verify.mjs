/**
 * Compares the event text in `public/content/events.json` against the SHA-256
 * of every write-up as it stood in the database the site used before the move
 * to Cloudflare (`cloudflare/migration-receipt.json`, taken from that database
 * on 2026-09-21). Digest against digest, so neither side has to be read,
 * copied or trusted by hand.
 *
 *   node cloudflare/verify.mjs
 *
 * The migration itself is settled and was verified at the time: all twelve
 * events matched byte for byte. The receipt is kept because it is also the only
 * record of what the archive looked like on that date, which makes this script
 * a way to see everything written into the archive since. A failure therefore
 * now means "these write-ups have been edited", not "the migration went
 * wrong" — and it lists the slug and field of each one, so an intentional edit
 * is easy to recognise. Deliberately edited so far: the five events whose
 * subject was rewritten to the DKU AI Club on 2026-09-21.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const archive = JSON.parse(await readFile(path.join(root, 'public/content/events.json'), 'utf8'))
const receipt = JSON.parse(await readFile(path.join(root, 'cloudflare/migration-receipt.json'), 'utf8'))

const sha256Hex = (value) => createHash('sha256').update(value, 'utf8').digest('hex')

const problems = []
let checked = 0

for (const [slug, expected] of Object.entries(receipt.events)) {
  const event = archive.find((candidate) => candidate.slug === slug)
  if (!event) {
    problems.push(`${slug}: missing from the archive`)
    continue
  }
  for (const field of ['title', 'body']) {
    const actual = sha256Hex(event[field] ?? '')
    if (actual !== expected[`${field}_sha256`]) {
      problems.push(`${slug}: ${field} differs (${actual.slice(0, 12)}… vs ${expected[`${field}_sha256`].slice(0, 12)}…)`)
    }
  }
  checked += 1
}

const extra = archive.filter((event) => !(event.slug in receipt.events))
if (extra.length) {
  problems.push(`the archive holds ${extra.length} event(s) the receipt does not cover: ${extra.map((e) => e.slug).join(', ')}`)
}

if (problems.length) {
  console.error(`  FAIL  ${problems.length} problem(s):`)
  for (const problem of problems) console.error(`        ${problem}`)
  process.exit(1)
}

console.log(`  ok    ${checked} events match the pre-migration database byte for byte (title and body)`)

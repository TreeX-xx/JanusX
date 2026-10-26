// Note: .agents/notes/planning/blueprint-official-plugin.md — signed, bounded official packages.
import { createHash, createPublicKey, sign, verify, type KeyLike } from 'node:crypto'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { z } from 'zod'
import semver from 'semver'
import { parsePluginManifest, validatePluginPath, type PluginManifest } from '@janusx/plugin-sdk'

export const PACKAGE_LIMIT = 50 * 1024 * 1024
export const ARCHIVE_LIMIT = 70 * 1024 * 1024
const PACKAGE_MAGIC = Buffer.from('JANUSX-PLUGIN/2\n')
const RELEASE_LIMIT = 32 * 1024
export const SIGNED_PACKAGE_LIMIT = ARCHIVE_LIMIT + PACKAGE_MAGIC.length + 4 + RELEASE_LIMIT
const compressed = promisify(gzip)
const expanded = promisify(gunzip)
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const version = z.string().max(128).refine(value => semver.valid(value) !== null)
const range = z.string().min(1).max(128).refine(value => semver.validRange(value) !== null)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
export const releaseSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(3).max(128), version,
  name: z.string().min(1).max(80), description: z.string().max(1000),
  publisher: z.string().min(1).max(80), host: range, pluginApi: range,
  platforms: z.array(z.enum(['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64'])).min(1).max(6),
  url: z.string().max(2048).url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash }),
  bytes: z.number().int().positive().max(ARCHIVE_LIMIT), sha256: digest, contentDigest: digest,
  packageFormat: z.literal('jxp/2').optional(),
}).strict()
export type PluginRelease = z.infer<typeof releaseSchema>
export const signedPayloadSchema = z.object({ keyId: z.string().min(1).max(128), payload: base64.max(2 * 1024 * 1024), signature: base64.length(88) }).strict()
export type SignedPluginPayload = z.infer<typeof signedPayloadSchema>
export type PluginTrustKeys = Readonly<Record<string, string>>

export class PluginDistributionError extends Error {
  constructor(readonly code: 'INVALID_SIGNATURE' | 'INVALID_PACKAGE' | 'INCOMPATIBLE_PLUGIN' | 'CATALOG_EXPIRED' | 'CATALOG_ROLLBACK') { super(code) }
}
function invalid(): never { throw new PluginDistributionError('INVALID_PACKAGE') }
const decode = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) invalid()
  return bytes
}

/** Sign the exact bytes; verification never reserializes caller-controlled JSON. */
export function signPluginPayload(value: unknown, keyId: string, key: KeyLike): SignedPluginPayload {
  const bytes = Buffer.from(JSON.stringify(value))
  return signedPayloadSchema.parse({ keyId, payload: bytes.toString('base64'), signature: sign(null, bytes, key).toString('base64') })
}
export function verifyPluginPayload(input: unknown, keys: PluginTrustKeys): unknown {
  try {
    const envelope = signedPayloadSchema.parse(input)
    if (!Object.hasOwn(keys, envelope.keyId)) throw new Error('Unknown signer')
    const key = createPublicKey(keys[envelope.keyId])
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Unsupported signer')
    const bytes = decode(envelope.payload)
    if (!verify(null, bytes, key, decode(envelope.signature))) throw new Error('Invalid signature')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { throw new PluginDistributionError('INVALID_SIGNATURE') }
}
export function verifyPluginRelease(input: unknown, keys: PluginTrustKeys): PluginRelease {
  const parsed = releaseSchema.safeParse(verifyPluginPayload(input, keys))
  if (!parsed.success) invalid()
  return parsed.data
}

/** The signed release hashes the inner archive; the outer file carries that release too. */
export function pluginDownloadBytes(release: PluginRelease, envelope: SignedPluginPayload): number {
  return release.bytes + (release.packageFormat === 'jxp/2' ? PACKAGE_MAGIC.length + 4 + Buffer.byteLength(JSON.stringify(envelope)) : 0)
}
export function encodeSignedPluginPackage(archive: Buffer, envelope: SignedPluginPayload): Buffer {
  const metadata = Buffer.from(JSON.stringify(signedPayloadSchema.parse(envelope)))
  if (!archive.length || archive.length > ARCHIVE_LIMIT || metadata.length > RELEASE_LIMIT) invalid()
  const length = Buffer.alloc(4)
  length.writeUInt32BE(metadata.length)
  return Buffer.concat([PACKAGE_MAGIC, length, metadata, archive])
}
export function decodeSignedPluginPackage(bytes: Buffer): { archive: Buffer; envelope: SignedPluginPayload } {
  const header = PACKAGE_MAGIC.length + 4
  if (bytes.length <= header || bytes.length > SIGNED_PACKAGE_LIMIT || !bytes.subarray(0, PACKAGE_MAGIC.length).equals(PACKAGE_MAGIC)) invalid()
  const length = bytes.readUInt32BE(PACKAGE_MAGIC.length)
  if (!length || length > RELEASE_LIMIT || bytes.length <= header + length || bytes.length - header - length > ARCHIVE_LIMIT) invalid()
  try {
    const envelope = signedPayloadSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(header, header + length))))
    return { envelope, archive: bytes.subarray(header + length) }
  } catch { invalid() }
}
export function assertPluginCompatibility(release: PluginRelease, host: string, pluginApi: string, platform: string): void {
  if (!semver.satisfies(host, release.host) || !semver.satisfies(pluginApi, release.pluginApi) || !release.platforms.includes(platform as PluginRelease['platforms'][number])) {
    throw new PluginDistributionError('INCOMPATIBLE_PLUGIN')
  }
}

/** Same digest as the local package reader; files are immutable after installation. */
export function pluginContentDigest(files: ReadonlyMap<string, Buffer>): string {
  const checksum = createHash('sha256')
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) checksum.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes)
  return checksum.digest('hex')
}
function validateFiles(files: ReadonlyMap<string, Buffer>): PluginManifest {
  if (!files.size || files.size > 2000) invalid()
  const names = new Set<string>()
  const directories = new Set<string>()
  let total = 0
  for (const [path, bytes] of files) {
    try { validatePluginPath(path) } catch { invalid() }
    const lower = path.toLowerCase()
    if (names.has(lower) || directories.has(lower) || (path !== 'manifest.json' && !path.startsWith('dist/'))) invalid()
    const parts = path.split('/')
    if (parts.length > 33) invalid()
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/').toLowerCase()
      if (names.has(parent)) invalid()
      directories.add(parent)
    }
    names.add(lower)
    const image = /\.(png|jpe?g|webp|gif|ico)$/.test(path)
    if (!image && !/\.(html|js|mjs|cjs|css|json)$/.test(path)) invalid()
    const limit = path === 'manifest.json' ? 64 * 1024 : (image ? 10 : 5) * 1024 * 1024
    if (bytes.length > limit || (total += bytes.length) > PACKAGE_LIMIT) invalid()
  }
  const manifestBytes = files.get('manifest.json')
  if (!manifestBytes) invalid()
  let manifest: PluginManifest
  try { manifest = parsePluginManifest(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) } catch { invalid() }
  for (const view of manifest!.contributes.views) if (!files.has(view.entry)) invalid()
  if (!manifest!.native && [...files.keys()].some(path => path.endsWith('.cjs'))) invalid()
  for (const entry of [manifest!.native?.entry, manifest!.native?.mcp?.entry]) if (entry && !files.has(entry)) invalid()
  if (!manifest!.contributes.views.length && !manifest!.native && files.size !== 1) invalid()
  return manifest!
}

/** Inner archive (also the legacy JXP file): gzipped path/base64 pairs, without links or install hooks. */
export async function encodePluginArchive(files: ReadonlyMap<string, Buffer>): Promise<Buffer> {
  validateFiles(files)
  const payload = Buffer.from(JSON.stringify({ format: 'janusx-plugin/1', files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, bytes.toString('base64')]) }))
  if (payload.length > ARCHIVE_LIMIT) invalid()
  const archive = await compressed(payload)
  if (archive.length > ARCHIVE_LIMIT) invalid()
  return archive
}
export async function decodePluginArchive(archive: Buffer, release: PluginRelease): Promise<{ manifest: PluginManifest; files: Map<string, Buffer> }> {
  if (archive.length !== release.bytes || archive.length > ARCHIVE_LIMIT || hash(archive) !== release.sha256) invalid()
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await expanded(archive, { maxOutputLength: ARCHIVE_LIMIT }))) } catch { invalid() }
  const parsed = z.object({ format: z.literal('janusx-plugin/1'), files: z.array(z.tuple([z.string().max(1024), base64])).min(1).max(2000) }).strict().safeParse(payload)
  if (!parsed.success) invalid()
  const files = new Map<string, Buffer>()
  for (const [path, encoded] of parsed.data.files) {
    if (files.has(path)) invalid()
    files.set(path, decode(encoded))
  }
  const manifest = validateFiles(files)
  if (manifest.id !== release.id || manifest.version !== release.version || manifest.name !== release.name
    || manifest.engines.pluginApi !== release.pluginApi || pluginContentDigest(files) !== release.contentDigest) invalid()
  return { manifest, files }
}

const catalogSchema = z.object({ schemaVersion: z.literal(1), sequence: z.number().int().nonnegative().safe(),
  issuedAt: z.string().datetime(), expiresAt: z.string().datetime(), releases: z.array(signedPayloadSchema).max(500) }).strict()
export function verifyPluginCatalog(input: unknown, keys: PluginTrustKeys, minimumSequence = 0, now = Date.now(), allowExpired = false) {
  const parsed = catalogSchema.safeParse(verifyPluginPayload(input, keys))
  if (!parsed.success) invalid()
  const catalog = parsed.data
  if (Date.parse(catalog.issuedAt) > now || !allowExpired && Date.parse(catalog.expiresAt) <= now || Date.parse(catalog.expiresAt) <= Date.parse(catalog.issuedAt)) throw new PluginDistributionError('CATALOG_EXPIRED')
  if (catalog.sequence < minimumSequence) throw new PluginDistributionError('CATALOG_ROLLBACK')
  const seen = new Set<string>()
  const releases = catalog.releases.map(envelope => {
    const release = verifyPluginRelease(envelope, keys)
    // One immutable release per plugin in a catalog; selection must not depend on array order.
    const identity = release.id
    if (seen.has(identity)) invalid()
    seen.add(identity)
    return { release, envelope }
  })
  return { sequence: catalog.sequence, expiresAt: catalog.expiresAt, releases }
}

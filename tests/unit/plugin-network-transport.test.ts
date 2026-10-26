import { expect, it } from 'vitest'
import { createServer } from 'node:https'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve as absolute } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { generate } from 'selfsigned'

it('P5 production TLS transport pins the address, validates certificates, bounds bodies and cancels sockets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'janusx-p5-tls-'))
  const certificate = await generate([{ name: 'commonName', value: 'p5-fixture.invalid' }], { extensions: [
    { name: 'basicConstraints', cA: true }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
    { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'p5-fixture.invalid' }] },
  ] })
  const server = createServer({ key: certificate.private, cert: certificate.cert }, (request, response) => {
    if (request.url === '/large') { response.end('x'.repeat(70 * 1024)); return }
    if (request.url === '/hold') return
    let input = ''; request.on('data', bytes => { input += bytes }); request.on('end', () => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ host: request.headers.host, authorization: request.headers.authorization ?? null,
        cookie: request.headers.cookie ?? null, method: request.method, body: input }))
    })
  })
  server.on('tlsClientError', () => {})
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const origin = `https://p5-fixture.invalid:${address.port}`
    const ca = join(directory, 'fixture.pem'); await writeFile(ca, certificate.cert)
    const bundle = join(directory, 'network.cjs')
    const sdk = join(directory, 'sdk.ts')
    await writeFile(sdk, `export {PluginError} from ${JSON.stringify(absolute('packages/plugin-sdk/src/errors.ts'))}; export {networkRequestSchema} from ${JSON.stringify(absolute('packages/plugin-sdk/src/background.ts'))};`)
    await build({ entryPoints: ['src/main/plugins/network.ts'], alias: {
      '@janusx/plugin-sdk/native': absolute('packages/plugin-sdk/src/native.ts'),
      '@janusx/plugin-sdk': sdk,
    }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' })
    const source = `const {pluginNetworkTransport: io}=require(process.argv[1]); const origin=process.argv[2];
      (async()=>{let denied;try {await io.send(new URL(origin+'/ok'),'127.0.0.1',{},undefined,new AbortController().signal)}catch(error){denied=error.code}
      if(process.env.P5_UNTRUSTED){console.log(JSON.stringify({denied}));return}
      const ok=await io.send(new URL(origin+'/ok'),'127.0.0.1',{method:'POST',body:'{}'},'fixture-bearer',new AbortController().signal);
      let large; try{await io.send(new URL(origin+'/large'),'127.0.0.1',{},undefined,new AbortController().signal)}catch(error){large=error.code}
      const abort=new AbortController(); const pending=io.send(new URL(origin+'/hold'),'127.0.0.1',{},undefined,abort.signal);setTimeout(()=>abort.abort(),25);
      let stopped;try{await pending}catch(error){stopped=error.code}
      console.log(JSON.stringify({ok,large,stopped}));})().catch(error=>{console.error(error);process.exitCode=1});`
    const trusted = await promisify(execFile)(process.execPath, ['-e', source, bundle, origin], { env: { ...process.env, NODE_EXTRA_CA_CERTS: ca }, timeout: 10_000 })
    const result = JSON.parse(trusted.stdout)
    expect(result.ok.status).toBe(200)
    expect(JSON.parse(result.ok.body)).toEqual({ host: `p5-fixture.invalid:${address.port}`, authorization: 'Bearer fixture-bearer', cookie: null, method: 'POST', body: '{}' })
    expect(result.large).toBe('FILE_TOO_LARGE'); expect(result.stopped).toBe('ABORT_ERR')
    const untrusted = await promisify(execFile)(process.execPath, ['-e', source, bundle, origin], { env: { ...process.env, NODE_EXTRA_CA_CERTS: '', P5_UNTRUSTED: '1' }, timeout: 10_000 })
    expect(JSON.parse(untrusted.stdout).denied).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
}, 20_000)

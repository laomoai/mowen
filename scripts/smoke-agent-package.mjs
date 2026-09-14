import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import path from 'node:path'

const repoRoot = process.cwd()
const cliPath = path.join(repoRoot, 'agent/mowen/scripts/mowen.py')
const mcpPath = path.join(repoRoot, 'agent/mowen/mcp/server.mjs')

function run(command, args, env, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`${command} exited ${code}: ${stderr}`))
      resolve({ stdout, stderr })
    })
    child.stdin.end(input)
  })
}

async function main() {
  const requests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [] }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const env = { MOWEN_URL: `http://127.0.0.1:${address.port}`, MOWEN_KEY: 'test-key' }

  try {
    await run('python3', [cliPath, 'query', '--table', 'ledger', '--page', '2', '--limit', '10', '--sort', 'balance:asc', '--fields', 'id,balance', '--filter', 'balance__gte=1000'], env)
    const cliQuery = requests.shift()
    const cliUrl = new URL(cliQuery.url, env.MOWEN_URL)
    assert.equal(cliQuery.method, 'GET')
    assert.equal(cliUrl.searchParams.get('page'), '2')
    assert.equal(cliUrl.searchParams.get('page_size'), '10')
    assert.equal(cliUrl.searchParams.get('sort'), 'balance:asc')
    assert.equal(cliUrl.searchParams.get('fields'), 'id,balance')
    assert.equal(cliUrl.searchParams.get('filter[balance__gte]'), '1000')

    await run('python3', [cliPath, 'create-running-balance', '--table', 'ledger', '--column', 'balance', '--opening', '1000.00', '--income', 'income', '--expense', 'expense', '--order', 'transaction_date'], env)
    const cliCreate = requests.shift()
    assert.equal(cliCreate.method, 'POST')
    assert.equal(cliCreate.url, '/api/tables/ledger/fields')
    assert.equal(cliCreate.body.field_type, 'running_balance')
    assert.equal(cliCreate.body.formula_config.opening_balance, '1000.00')
    assert.equal(cliCreate.body.formula_config.order_direction, 'asc')

    const mcpInput = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'query_records', arguments: { table: 'ledger', page: 2, page_size: 10, sort: 'balance:asc', filters: { balance__gte: 1000 } } } }),
    ].join('\n') + '\n'
    const mcp = await run('node', [mcpPath], env, mcpInput)
    const messages = mcp.stdout.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(messages.find(message => message.id === 1)?.result.serverInfo.version, '1.1.0')
    const tools = messages.find(message => message.id === 2)?.result.tools ?? []
    for (const name of ['list_fields', 'create_running_balance_field', 'update_running_balance_field']) {
      assert.equal(tools.some(tool => tool.name === name), true, `MCP missing ${name}`)
    }
    const mcpQuery = requests.shift()
    const mcpUrl = new URL(mcpQuery.url, env.MOWEN_URL)
    assert.equal(mcpUrl.searchParams.get('page'), '2')
    assert.equal(mcpUrl.searchParams.get('filter[balance__gte]'), '1000')

    console.log('agent package smoke ok')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

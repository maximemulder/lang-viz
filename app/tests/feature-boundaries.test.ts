import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

/** Observe actual runtime imports after Node erases types, including transitive dependencies. */
const runtimeDependencies = (entry: string) => {
  const root = new URL('../src/', import.meta.url).href
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { registerHooks } from 'node:module'
const root = ${JSON.stringify(root)}
const dependencies = new Set()
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context)
  if (result.url.startsWith(root)) dependencies.add(result.url.slice(root.length))
  return result
} })
await import(${JSON.stringify(new URL(entry, root).href)})
process.stdout.write(JSON.stringify([...dependencies]))`,
    ],
    { encoding: 'utf8' },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as string[]
}

test('shared navigation runs without lexical implementation or data loaders', () => {
  const dependencies = runtimeDependencies('state/explorerNavigation.ts')
  assert.ok(dependencies.includes('state/explorerState.ts'))
  assert.deepEqual(
    dependencies.filter(
      (path) =>
        path.startsWith('features/') ||
        path.startsWith('integrations/') ||
        path.startsWith('data/') ||
        path === 'domain/etymology.ts',
    ),
    [],
  )
})

test('lexical traversal and search run without atlas or map implementation', () => {
  const dependencies = runtimeDependencies('domain/etymology.ts')
  assert.deepEqual(
    dependencies.filter(
      (path) =>
        path.startsWith('features/') ||
        path.startsWith('integrations/') ||
        path.startsWith('state/') ||
        path.startsWith('data/') ||
        path === 'domain/atlas.ts',
    ),
    [],
  )
})

test('WALS example selection and point geometry run without UI, catalog, navigation or loaders', () => {
  assert.deepEqual(runtimeDependencies('domain/walsExamples.ts'), ['domain/walsExamples.ts'])
})

test('shared overlay camera runs without either exploration implementation or a map runtime', () => {
  assert.deepEqual(runtimeDependencies('integrations/map/overlayCamera.ts'), [
    'integrations/map/overlayCamera.ts',
  ])
})

/** Replay an isolated ablation; never switches the application to an experiment. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { buildColorTopology, buildSemanticPalette } from '../../src/domain/colors.ts'
import { colorDistance, colorSample } from '../../src/domain/familyColors.ts'
import { buildLanguageHierarchy } from '../../src/domain/hierarchy.ts'

const here = dirname(fileURLToPath(import.meta.url))
const app = resolve(here, '../..')
const { values } = parseArgs({
  options: {
    input: { type: 'string', default: join(app, 'test-results/colors') },
    output: { type: 'string' },
    rounds: { type: 'string', default: '3' },
    'chroma-anchors': { type: 'boolean', default: false },
    chroma: { type: 'boolean', default: false },
    branches: { type: 'boolean', default: false },
  },
})
const rounds = Number(values.rounds)
assert.ok(Number.isInteger(rounds) && rounds > 0, '--rounds must be a positive integer')
const output = resolve(
  values.output ??
    join(
      app,
      values['chroma-anchors']
        ? 'test-results/color-chroma-anchors'
        : values.chroma
          ? 'test-results/color-chroma'
          : values.branches
            ? 'test-results/color-branches'
            : 'test-results/color-refinement',
    ),
)
await mkdir(output, { recursive: true })
const names = values['chroma-anchors']
  ? ['baseline', 'branches', 'baseline-chroma-anchors', 'branches-chroma-anchors']
  : values.chroma
    ? ['baseline', 'branches', 'branches-chroma', 'branches-chroma-strong']
    : values.branches
      ? ['baseline', 'spatial', 'branches', 'branches-no-aesthetic']
      : ['baseline', 'whole-family', 'spatial']
const scenes = ['dlac', 'asher', 'asher-world']
const read = async (path) => JSON.parse(await readFile(path, 'utf8'))
const save = async (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2))
const serialize = (result) => ({
  colors: Object.fromEntries(result.colors),
  anchors: Object.fromEntries([...result.regions].map(([id, region]) => [id, region.anchor])),
})
const replace = (source, before, after) => {
  assert.equal(source.split(before).length, 2, `Experiment injection no longer matches: ${before}`)
  return source.replace(before, after)
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const temporary = await mkdtemp(join(tmpdir(), 'color-refinement-'))
try {
  const sourceDirectory = join(app, 'src/domain')
  const originals = new Map(
    await Promise.all(
      (await readdir(sourceDirectory))
        .filter((name) => name.endsWith('.ts'))
        .map(async (name) => [name, await readFile(join(sourceDirectory, name), 'utf8')]),
    ),
  )
  // Reconstruct the pre-integration initializer for historical ablations.
  // The successful variant is checked against the actual app below.
  originals.set(
    'colorOptimization.ts',
    replace(
      replace(
        originals.get('colorOptimization.ts'),
        "import { branchRefinement } from './colorBranches.ts'\n",
        '',
      ),
      '  branchRefinement(groups, colors, view.columns, view.rows, distanceField)\n',
      '',
    ).replace(
      'assignFamilyAnchors(families, links, true, true)',
      'assignFamilyAnchors(families, links)',
    ),
  )
  const modules = {}
  for (const name of names) {
    const directory = join(temporary, name)
    await mkdir(directory)
    await symlink(join(app, 'node_modules'), join(directory, 'node_modules'), 'dir')
    for (const [file, original] of originals) await writeFile(join(directory, file), original)
    let source = originals.get('colorOptimization.ts')
    if (name.endsWith('chroma-anchors')) {
      source = replace(
        source,
        'assignFamilyAnchors(families, links)',
        'assignFamilyAnchors(families, links, true, true)',
      )
      await writeFile(join(output, 'anchor-source.ts'), originals.get('familyColors.ts'))
    }
    if (name === 'whole-family' || name === 'spatial') {
      source = replace(source, '  familyShade,', '  familyShade,\n  familyColorFrame,')
      source = replace(
        source,
        '  if (group.radius < 0.025) return',
        '  if (group.radius < 0.025) return\n  const bounds = familyColorFrame(group.anchor, group.radius, group.planes).box',
      )
      source = replace(
        source,
        'const [low, high] = position.box[axis]',
        'const [low, high] = bounds[axis]',
      )
    }
    const refinement = `  groups.forEach((group, i) => {
    refineShades(group, internal[i] ?? [], colors)
  })`
    if (name === 'spatial' || name.startsWith('branches')) {
      const helper = (await readFile(join(here, 'spatial.ts'), 'utf8')).replaceAll(
        '../../src/domain/',
        './',
      )
      await writeFile(join(directory, 'experimentalRefinement.ts'), helper)
      if (name.startsWith('branches')) {
        const branchHelper = (await readFile(join(here, '../color-branches/refine.ts'), 'utf8'))
          .replaceAll('../../src/domain/', './')
          .replace('../color-refinement/spatial.ts', './experimentalRefinement.ts')
        await writeFile(join(directory, 'branchRefinement.ts'), branchHelper)
        source = `import { branchRefinement } from './branchRefinement.ts'\n${source}`
      }
      source = `import { spatialRefinement } from './experimentalRefinement.ts'\n${source}`
      source = replace(
        source,
        refinement,
        name.startsWith('branches')
          ? `${refinement}
  const experiment = branchRefinement(groups, colors, links, view.columns, view.rows, distanceField${name === 'branches-chroma-anchors' ? ', 0, 0.1' : name === 'branches-chroma' ? ', 0, 0.4' : name === 'branches-chroma-strong' ? ', 0, 1.2' : name === 'branches-no-aesthetic' ? ', 0' : ''})`
          : '  const experiment = spatialRefinement(groups, colors, links, view.columns, view.rows, distanceField)',
      )
    } else {
      source = replace(
        source,
        refinement,
        `  const refinementStarted = performance.now()
${refinement}
  const experiment = {graphMs: 0, refineMs: performance.now() - refinementStarted,
    edges: internal.reduce((sum, edges) => sum + edges.length, 0), crossEdges: 0}`,
      )
    }
    source = replace(
      source,
      '    languageCount: groups.reduce',
      '    experiment,\n    languageCount: groups.reduce',
    )
    await writeFile(join(directory, 'colorOptimization.ts'), source)
    modules[name] = await import(pathToFileURL(join(directory, 'colorOptimization.ts')).href)
  }
  const hierarchy = buildLanguageHierarchy(await read(join(app, 'public/data/languages.json')))
  const topology = buildColorTopology(hierarchy)
  const reference = buildSemanticPalette(hierarchy, topology)
  const production = await import('../../src/domain/colorOptimization.ts')
  await writeFile(
    join(output, 'branch-source.ts'),
    await readFile(join(here, '../color-branches/refine.ts')),
  )
  await writeFile(join(output, 'spatial-source.ts'), await readFile(join(here, 'spatial.ts')))
  const report = {
    sourceHash: createHash('sha256')
      .update(
        [...originals]
          .sort()
          .map(([name, content]) => name + content)
          .join(''),
      )
      .digest('hex'),
    node: process.version,
    rounds,
    variants: names,
    anchorExperiment: Boolean(values['chroma-anchors']),
    experimentHash: createHash('sha256')
      .update(await readFile(join(here, '../color-branches/refine.ts')))
      .digest('hex'),
    scenes: {},
  }
  for (const scene of scenes) {
    const capture = await read(join(resolve(values.input), `${scene}-input.json`))
    assert.deepEqual(
      capture.configuration,
      { strategy: 'semantic', rootIds: [], anchors: {}, overrides: {} },
      'This ablation recomputes a common default reference; captures must use the default configuration',
    )
    capture.reference = {
      colors: [...reference.colors],
      anchors: [...reference.anchors],
      rootById: [...reference.rootById],
    }
    await save(`${scene}-input.json`, capture)
    for (const key of ['parentById', 'childrenById', 'mappedLeafCount'])
      capture.topology[key] = new Map(capture.topology[key])
    capture.reference = reference
    const expected = {}
    const runs = Object.fromEntries(names.map((name) => [name, []]))
    let baseline
    let anchorBaseline
    for (let round = -1; round < rounds; round++) {
      // Rotate ordering, with one unmeasured warmup, to reduce JIT/order bias.
      const offset = Math.max(0, round) % names.length
      for (const name of [...names.slice(offset), ...names.slice(0, offset)]) {
        const input =
          round === 0
            ? {
                ...capture,
                view: {
                  ...capture.view,
                  footprints: [...capture.view.footprints]
                    .reverse()
                    .map((footprint) => ({ ...footprint, cells: [...footprint.cells].reverse() })),
                },
              }
            : capture
        const start = performance.now()
        const result = modules[name].optimizeColors(input)
        const elapsed = performance.now() - start
        const palette = serialize(result)
        if (round === -1) {
          if (name === 'baseline') {
            baseline = result
          }
          if (name === 'branches-chroma-anchors') {
            const { experiment: _, ...actual } = result
            assert.deepEqual(
              actual,
              production.optimizeColors(capture),
              'Integrated optimizer differs from the successful experiment',
            )
          }
          if (name === 'baseline-chroma-anchors') anchorBaseline = result
          if (name === 'branches-chroma-anchors')
            assert.deepEqual(
              result.regions,
              anchorBaseline.regions,
              'Branch pass changed new anchor bounds',
            )
          if (!name.endsWith('chroma-anchors'))
            assert.deepEqual(
              result.regions,
              baseline.regions,
              'An experiment changed family anchors or bounds',
            )
          expected[name] = palette
          await save(`${name}-${scene}-palette.json`, palette)
        } else {
          assert.deepEqual(palette, expected[name], 'Repeated/reordered inputs changed the palette')
          runs[name].push({ totalMs: elapsed, ...result.experiment })
        }
        const visible = new Set(capture.view.footprints.map((vertex) => vertex.languageId))
        for (const [id, hex] of result.colors) {
          const region = result.regions.get(reference.rootById.get(id))
          assert.ok(region, `Missing family region for ${id}`)
          assert.ok(
            colorDistance(colorSample(hex), colorSample(region.anchor)) <= region.radius + 0.0015,
            `Shade escaped its family region: ${id}`,
          )
          if (!visible.has(id) && name === 'branches-chroma-anchors')
            assert.equal(
              hex,
              anchorBaseline.colors.get(id),
              `Hidden fallback changed after anchor initialization: ${id}`,
            )
          if (!visible.has(id) && !name.endsWith('chroma-anchors'))
            assert.equal(hex, baseline.colors.get(id), `Hidden fallback changed: ${id}`)
        }
      }
    }
    report.scenes[scene] = Object.fromEntries(
      names.map((name) => [
        name,
        {
          medianMs: median(runs[name].map((run) => run.totalMs)),
          medianRefineMs: median(runs[name].map((run) => run.refineMs)),
          runs: runs[name],
        },
      ]),
    )
    console.log(
      JSON.stringify({
        scene,
        timings: Object.fromEntries(
          names.map((name) => [name, report.scenes[scene][name].medianMs]),
        ),
      }),
    )
    await save('benchmark.json', report)
  }
  console.log(
    `Evaluate saved palettes: python3 scripts/color-refinement/local_evaluation.py ${output}`,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}

import { expect, test, vi } from 'vitest'
import { Niivue } from '../../src/niivue/index.js' // note the js extension
import { makeVolume } from './helpers/nifti.js'

function makeVol(name: string): ReturnType<typeof makeVolume> {
  return makeVolume(name, {
    dims: [4, 4, 4],
    srow: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0]
    ],
    value: (i, j, k) => i + j + k
  })
}

// real updateGLVolume / drawScene, with only the WebGL work stubbed out
function makeNiivue(): { nv: Niivue; recomposites: () => number; draws: () => number } {
  const nv = new Niivue()
  vi.spyOn(nv, 'refreshLayers').mockImplementation(() => {})
  vi.spyOn(nv, 'refreshColormaps').mockImplementation(() => null as never)
  vi.spyOn(nv, 'closePAQD').mockImplementation(() => {})
  const core = vi.spyOn(nv, 'drawSceneCore').mockImplementation(() => {})
  let n = 0
  nv.onVolumeUpdated = (): void => {
    n++
  }
  return { nv, recomposites: () => n, draws: () => core.mock.calls.length }
}

test('without batchUpdate every change recomposites (default unchanged)', async () => {
  const { nv, recomposites } = makeNiivue()
  const [a, b, c] = await Promise.all([makeVol('a.nii'), makeVol('b.nii'), makeVol('c.nii')])
  nv.addVolume(a)
  nv.addVolume(b)
  nv.addVolume(c)
  nv.setModulationImage(b.id, a.id)
  nv.removeVolume(c)
  expect(recomposites()).toBe(5)
})

test('batchUpdate recomposites and draws once at the end', async () => {
  const { nv, recomposites, draws } = makeNiivue()
  const [a, b, c] = await Promise.all([makeVol('a.nii'), makeVol('b.nii'), makeVol('c.nii')])
  const ret = nv.batchUpdate(() => {
    nv.addVolume(a)
    nv.addVolume(b)
    nv.addVolume(c)
    nv.setModulationImage(b.id, a.id)
    nv.removeVolume(c)
    expect(recomposites()).toBe(0)
    expect(draws()).toBe(0)
    return 42
  })
  expect(ret).toBe(42)
  expect(recomposites()).toBe(1)
  expect(draws()).toBe(1)
  expect(nv.volumes.map((v) => v.name)).toEqual(['a.nii', 'b.nii'])
})

test('batchUpdate is nested-safe', async () => {
  const { nv, recomposites } = makeNiivue()
  const [a, b] = await Promise.all([makeVol('a.nii'), makeVol('b.nii')])
  nv.batchUpdate(() => {
    nv.addVolume(a)
    nv.batchUpdate(() => {
      nv.addVolume(b)
      nv.setOpacity(1, 0.5)
    })
    expect(recomposites()).toBe(0)
  })
  expect(recomposites()).toBe(1)
})

test('batchUpdate flushes and ends the batch when fn throws', async () => {
  const { nv, recomposites } = makeNiivue()
  const a = await makeVol('a.nii')
  expect(() =>
    nv.batchUpdate(() => {
      nv.addVolume(a)
      throw new Error('boom')
    })
  ).toThrow('boom')
  expect(recomposites()).toBe(1)
  nv.updateGLVolume() // no longer batched
  expect(recomposites()).toBe(2)
})

test('batchUpdate with an async function ends when the promise settles', async () => {
  const { nv, recomposites } = makeNiivue()
  const [a, b] = await Promise.all([makeVol('a.nii'), makeVol('b.nii')])
  const p = nv.batchUpdate(async () => {
    nv.addVolume(a)
    await Promise.resolve()
    nv.addVolume(b)
  })
  expect(recomposites()).toBe(0)
  await p
  expect(recomposites()).toBe(1)
})

test('a batch with only redraws draws once and does not recomposite', () => {
  const { nv, recomposites, draws } = makeNiivue()
  nv.batchUpdate(() => {
    nv.drawScene()
    nv.drawScene()
  })
  expect(draws()).toBe(1)
  expect(recomposites()).toBe(0)
})

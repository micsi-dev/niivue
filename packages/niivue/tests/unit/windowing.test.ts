import { expect, test, vi, beforeAll } from 'vitest'
import { Niivue, NVImage } from '../../src/niivue/index.js' // note the js extension
import { makeVolume } from './helpers/nifti.js'

// Mock WebGL-dependent methods
beforeAll(() => {
  vi.spyOn(Niivue.prototype, 'drawScene').mockImplementation(() => {})
  vi.spyOn(Niivue.prototype, 'updateGLVolume').mockImplementation(() => {})
})

function fakeVolume(name: string): Record<string, unknown> {
  return { name, toRAS: [1], cal_min: 0, cal_max: 100, global_min: -1000, global_max: 1000 }
}

test('windowingHandler on the background refreshes only layer 0', () => {
  const nv = new Niivue()
  const refresh = vi.spyOn(nv, 'refreshLayers').mockImplementation(() => {})
  nv.volumes = [fakeVolume('back'), fakeVolume('overlay')] as never
  nv.uiData.windowX = 0
  nv.uiData.windowY = 0

  nv.windowingHandler(10, -5, 0)

  expect(refresh.mock.calls.map((c) => [(c[0] as { name: string }).name, c[1]])).toEqual([['back', 0]])
})

test('windowingHandler on an overlay never draws the overlay into the background slot', () => {
  const nv = new Niivue()
  const refresh = vi.spyOn(nv, 'refreshLayers').mockImplementation(() => {})
  nv.volumes = [fakeVolume('back'), fakeVolume('ov1'), fakeVolume('ov2')] as never
  nv.uiData.windowX = 0
  nv.uiData.windowY = 0

  nv.windowingHandler(10, -5, 2)

  // window applied to the overlay that was dragged
  expect(nv.volumes[2].cal_min).toBe(-10)
  expect(nv.volumes[2].cal_max).toBe(130)
  expect(nv.volumes[0].cal_min).toBe(0)
  // overlays share one blended texture: all overlays recomposited in layer order,
  // and nothing is refreshed as layer 0
  const calls = refresh.mock.calls.map((c) => [(c[0] as { name: string }).name, c[1]])
  expect(calls).toEqual([
    ['ov1', 1],
    ['ov2', 2]
  ])
})

// --- box (contrast) auto-window: calculateNewRange ---

// background: 10x10x10, 1 mm, RAS, voxel (i,j,k) at mm (i,j,k); value = 0.5*(i + 10j + 100k) + 1
async function makeBack(): Promise<NVImage> {
  return makeVolume('back.nii', {
    dims: [10, 10, 10],
    srow: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0]
    ],
    datatype: 'float32',
    sclSlope: 0.5,
    sclInter: 1,
    value: (i, j, k) => i + 10 * j + 100 * k
  })
}

// overlay: 5x5x5, 2 mm, stored LAS (x flipped), int16 with slope 2 / inter 10
// stored voxel (i,j,k) is at mm (8 - 2i, 2j, 2k); raw = i + 5j + 25k
async function makeOverlay(): Promise<NVImage> {
  return makeVolume('overlay.nii', {
    dims: [5, 5, 5],
    srow: [
      [-2, 0, 0, 8],
      [0, 2, 0, 0],
      [0, 0, 2, 0]
    ],
    datatype: 'int16',
    sclSlope: 2,
    sclInter: 10,
    value: (i, j, k) => i + 5 * j + 25 * k
  })
}

async function setupDragBox(): Promise<Niivue> {
  const nv = new Niivue()
  const back = await makeBack()
  const overlay = await makeOverlay()
  nv.volumes = [back, overlay]
  nv.back = back
  back.dims = back.dimsRAS // what refreshLayers(back, 0) sets on the GPU path
  // drag box on an axial slice from background voxel (2,2,4) to (6,6,4)
  nv.uiData.dragStart = [10, 10]
  nv.uiData.dragEnd = [50, 50]
  const fracOf = (v: number[]): number[] => v.map((x) => (x + 0.5) / 10)
  vi.spyOn(nv, 'canvasPos2frac').mockImplementation((pos) => (pos[0] === 10 ? fracOf([2, 2, 4]) : fracOf([6, 6, 4])) as never)
  return nv
}

test('calculateNewRange on the background uses calibrated values once', async () => {
  const nv = await setupDragBox()
  nv.calculateNewRange({ volIdx: 0 })
  // box x,y in [2,6), z = 4: raw 422..455 -> 0.5*raw + 1
  expect(nv.volumes[0].cal_min).toBeCloseTo(212)
  expect(nv.volumes[0].cal_max).toBeCloseTo(228.5)
})

test('calculateNewRange works for an overlay with its own grid and orientation', async () => {
  const nv = await setupDragBox()
  const before = [nv.volumes[0].cal_min, nv.volumes[0].cal_max]
  expect(() => nv.calculateNewRange({ volIdx: 1 })).not.toThrow()
  // world box (2..6, 2..6, 4) mm -> overlay RAS voxels x,y in [1,3), z = 2
  // RAS x index r is stored i = 4 - r -> stored i in {2,3}, j in {1,2}, k = 2
  // raw 57..63 -> 2*raw + 10 = 124..136
  expect(nv.volumes[1].cal_min).toBe(124)
  expect(nv.volumes[1].cal_max).toBe(136)
  // the background window is untouched
  expect([nv.volumes[0].cal_min, nv.volumes[0].cal_max]).toEqual(before)
})

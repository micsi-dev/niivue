import { expect, test, vi, beforeAll } from 'vitest'
import { Niivue, NiiVueLocation } from '../../src/niivue/index.js' // note the js extension
import { vec3 } from 'gl-matrix'
import { makeVolume } from './helpers/nifti.js'

beforeAll(() => {
  vi.spyOn(Niivue.prototype, 'drawScene').mockImplementation(() => {})
  vi.spyOn(Niivue.prototype, 'updateGLVolume').mockImplementation(() => {})
})

// background: 10x10x10 1 mm covering 0..9 mm
const makeBack = (): ReturnType<typeof makeVolume> =>
  makeVolume('back.nii', {
    dims: [10, 10, 10],
    srow: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0]
    ],
    value: (i, j, k) => 1 + i + j + k
  })

// overlay: 3x3x3 2 mm covering 0..4 mm; value 100 + i
const makeSmallOverlay = (): ReturnType<typeof makeVolume> =>
  makeVolume('small.nii', {
    dims: [3, 3, 3],
    srow: [
      [2, 0, 0, 0],
      [0, 2, 0, 0],
      [0, 0, 2, 0]
    ],
    value: (i) => 100 + i
  })

test('getValue clamps out-of-range coordinates by default (unchanged)', async () => {
  const ov = await makeSmallOverlay()
  expect(ov.getValue(7, 1, 1)).toBe(102)
  expect(ov.getValue(-3, 1, 1)).toBe(100)
  expect(ov.getValues(7, 1, 1)).toEqual([102])
})

test('getValue returns NaN outside the volume when isOutOfBoundsNaN is set', async () => {
  const ov = await makeSmallOverlay()
  expect(ov.getValue(2, 1, 1, 0, false, true)).toBe(102)
  expect(ov.getValue(0, 0, 0, 0, false, true)).toBe(100)
  expect(ov.getValue(3, 1, 1, 0, false, true)).toBeNaN()
  expect(ov.getValue(-1, 1, 1, 0, false, true)).toBeNaN()
  expect(ov.getValue(1, 1, 7, 0, false, true)).toBeNaN()
  expect(ov.getValues(1, 9, 1, 0, false, true)).toEqual([NaN])
})

async function locationAt(vox: [number, number, number]): Promise<NiiVueLocation> {
  const nv = new Niivue()
  const back = await makeBack()
  const ov = await makeSmallOverlay()
  nv.volumes = [back, ov]
  nv.back = back
  back.dims = back.dimsRAS
  // scene extents come from the GPU volume object; only used for decimal places here
  vi.spyOn(nv, 'sceneExtentsMinMax').mockReturnValue([vec3.fromValues(0, 0, 0), vec3.fromValues(9, 9, 9), vec3.fromValues(9, 9, 9)])
  nv.scene.crosshairPos = back.convertVox2Frac(vox as never)
  let loc: NiiVueLocation | undefined
  nv.onLocationChange = (msg): void => {
    loc = msg as NiiVueLocation
  }
  nv.createOnLocationChange()
  return loc!
}

test('onLocationChange values report NaN for a layer outside its field of view', async () => {
  const loc = await locationAt([8, 8, 8]) // 8 mm: outside the 0..4 mm overlay
  expect(loc.values[0].value).toBe(25) // background 1 + 8 + 8 + 8
  expect(loc.values[1].value).toBeNaN()
})

test('onLocationChange values are unchanged inside the field of view', async () => {
  const loc = await locationAt([2, 2, 2]) // 2 mm: overlay voxel 1
  expect(loc.values[0].value).toBe(7)
  expect(loc.values[1].value).toBe(101)
})

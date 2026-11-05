import { expect, test, vi, beforeAll } from 'vitest'
import { Niivue, SLICE_TYPE } from '../../src/niivue/index.js' // note the js extension

beforeAll(() => {
  vi.spyOn(Niivue.prototype, 'drawScene').mockImplementation(() => {})
  vi.spyOn(Niivue.prototype, 'updateGLVolume').mockImplementation(() => {})
})

// an instance whose (single) volume spans [mn, mx] mm on every axis
function withVolumeBox(mn: number, mx: number): Niivue {
  const nv = new Niivue()
  nv.volumes = [{ name: 'v' }] as never
  nv.volumeObject3D = { extentsMin: [mn, mn, mn], extentsMax: [mx, mx, mx] } as never
  return nv
}

test('without sharedFOV each instance fits its own volume box (unchanged)', () => {
  const nv1 = withVolumeBox(-10, 10)
  const nv2 = withVolumeBox(0, 50)
  nv1.setSliceMM(true)
  nv2.setSliceMM(true)
  nv1.broadcastTo(nv2, { '2d': true })
  expect(Array.from(nv1.screenFieldOfViewExtendedMM(SLICE_TYPE.AXIAL).mnMM)).toEqual([-10, -10, -10])
  expect(Array.from(nv2.screenFieldOfViewExtendedMM(SLICE_TYPE.AXIAL).mnMM)).toEqual([0, 0, 0])
})

test('sharedFOV makes linked instances fit the union of their boxes in world space', () => {
  const nv1 = withVolumeBox(-10, 10)
  const nv2 = withVolumeBox(0, 50)
  expect(nv1.opts.isSliceMM).toBe(false)
  nv1.broadcastTo(nv2, { '2d': true, sharedFOV: true })
  for (const nv of [nv1, nv2]) {
    expect(nv.opts.isSliceMM).toBe(true)
    for (const axCorSag of [SLICE_TYPE.AXIAL, SLICE_TYPE.CORONAL, SLICE_TYPE.SAGITTAL]) {
      const fov = nv.screenFieldOfViewExtendedMM(axCorSag)
      expect(Array.from(fov.mnMM)).toEqual([-10, -10, -10])
      expect(Array.from(fov.mxMM)).toEqual([50, 50, 50])
      expect(Array.from(fov.fovMM)).toEqual([60, 60, 60])
      expect(Array.from(nv.screenFieldOfViewMM(axCorSag))).toEqual([60, 60, 60])
    }
  }
})

test('turning sharedFOV off restores each instance and its isSliceMM', () => {
  const nv1 = withVolumeBox(-10, 10)
  const nv2 = withVolumeBox(0, 50)
  nv2.setSliceMM(true)
  nv1.broadcastTo(nv2, { '2d': true, sharedFOV: true })
  nv1.broadcastTo(nv2, { '2d': true })
  expect(nv1.opts.isSliceMM).toBe(false)
  expect(nv2.opts.isSliceMM).toBe(true)
  expect(nv1.sharedFOVExtentsMM()).toBeNull()
  expect(nv2.sharedFOVExtentsMM()).toBeNull()
  nv1.setSliceMM(true)
  expect(Array.from(nv1.screenFieldOfViewExtendedMM(SLICE_TYPE.AXIAL).mxMM)).toEqual([10, 10, 10])
  expect(Array.from(nv2.screenFieldOfViewExtendedMM(SLICE_TYPE.AXIAL).mxMM)).toEqual([50, 50, 50])
})

test('sharedFOV ignores members without data yet', () => {
  const nv1 = withVolumeBox(-10, 10)
  const empty = new Niivue()
  nv1.broadcastTo(empty, { sharedFOV: true })
  expect(Array.from(nv1.screenFieldOfViewExtendedMM(SLICE_TYPE.AXIAL).fovMM)).toEqual([20, 20, 20])
})

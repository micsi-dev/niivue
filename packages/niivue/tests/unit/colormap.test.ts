import { expect, test, vi } from 'vitest'
import { Niivue } from '../../src/niivue/index.js' // note the js extension
import { makeVolume } from './helpers/nifti.js'

function makeRamp(): ReturnType<typeof makeVolume> {
  return makeVolume('ramp.nii', {
    dims: [8, 8, 8],
    srow: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0]
    ],
    datatype: 'float32',
    value: (i, j, k) => i + 8 * j + 64 * k
  })
}

test('changing the colormap keeps the current window', async () => {
  const vol = await makeRamp()
  const robust = [vol.cal_min, vol.cal_max]
  vol.cal_min = 100
  vol.cal_max = 200
  vol.colormap = 'hot'
  expect(vol.colormap).toBe('hot')
  expect([vol.cal_min, vol.cal_max]).toEqual([100, 200])
  // invert is applied by re-setting the colormap: still keeps the window
  vol.colormapInvert = true
  vol.colormap = 'hot'
  expect([vol.cal_min, vol.cal_max]).toEqual([100, 200])
  // the robust range is still available for a reset
  expect([vol.robust_min, vol.robust_max]).toEqual(robust)
})

test('Niivue.setColormap keeps the current window', async () => {
  const nv = new Niivue()
  vi.spyOn(nv, 'updateGLVolume').mockImplementation(() => {})
  const vol = await makeRamp()
  nv.volumes = [vol]
  vol.cal_min = 10
  vol.cal_max = 20
  nv.setColormap(vol.id, 'winter')
  expect([vol.cal_min, vol.cal_max]).toEqual([10, 20])
})

test('colormap still computes the window when it is not set', async () => {
  const vol = await makeRamp()
  vol.cal_min = NaN
  vol.cal_max = NaN
  vol.colormap = 'hot'
  expect(Number.isFinite(vol.cal_min)).toBe(true)
  expect(Number.isFinite(vol.cal_max)).toBe(true)
  expect(vol.cal_max!).toBeGreaterThan(vol.cal_min!)
})

test('colormaps with their own intensity range still apply it', async () => {
  const vol = await makeRamp()
  vol.cal_min = 1
  vol.cal_max = 2
  vol.colormap = 'ct_bones' // defines min 180 / max 600
  expect([vol.cal_min, vol.cal_max]).toEqual([180, 600])
})

test('colormap change still notifies onColormapChange', async () => {
  const vol = await makeRamp()
  const cb = vi.fn()
  vol.onColormapChange = cb
  vol.colormap = 'hot'
  expect(cb).toHaveBeenCalledTimes(1)
})

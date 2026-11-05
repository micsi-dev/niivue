import { expect, test, vi } from 'vitest'
import { Niivue, NVImage } from '../../src/niivue/index.js' // note the js extension
import { configureColormapUniforms, thresholdBounds } from '../../src/niivue/data/VolumeLayerRenderer.js'
import { fragOrientShader } from '../../src/shader-srcs.js'
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

// records uniform1i / uniform1f by uniform name
function fakeGL(): { gl: WebGL2RenderingContext; values: Record<string, number> } {
  const values: Record<string, number> = {}
  const set = (loc: { name: string } | null, v: number): void => {
    if (loc) {
      values[loc.name] = v
    }
  }
  const gl = { uniform1i: set, uniform1f: set } as unknown as WebGL2RenderingContext
  return { gl, values }
}

function fakeShader(): never {
  const names = ['isAlphaThreshold', 'isColorbarFromZero', 'isAdditiveBlend', 'layer', 'cal_minNeg', 'cal_maxNeg', 'isThresholdMin', 'isThresholdMax', 'threshold_min', 'threshold_max']
  return { uniforms: Object.fromEntries(names.map((name) => [name, { name }])) } as never
}

test('threshold is off by default', () => {
  const v = new NVImage()
  expect(Number.isNaN(v.threshold_min)).toBe(true)
  expect(Number.isNaN(v.threshold_max)).toBe(true)
  expect(thresholdBounds(v)).toEqual({ isThresholdMin: false, isThresholdMax: false, thresholdMin: 0, thresholdMax: 0 })
  const { gl, values } = fakeGL()
  configureColormapUniforms({ gl, overlayItem: v, orientShader: fakeShader(), layer: 1, isAdditiveBlend: false })
  expect(values.isThresholdMin).toBe(0)
  expect(values.isThresholdMax).toBe(0)
})

test('threshold bounds become orient shader uniforms', () => {
  const v = new NVImage()
  v.threshold_min = 3
  const { gl, values } = fakeGL()
  configureColormapUniforms({ gl, overlayItem: v, orientShader: fakeShader(), layer: 1, isAdditiveBlend: false })
  expect(values).toMatchObject({ isThresholdMin: 1, isThresholdMax: 0, threshold_min: 3 })
  v.threshold_max = 8
  v.threshold_min = NaN
  configureColormapUniforms({ gl, overlayItem: v, orientShader: fakeShader(), layer: 1, isAdditiveBlend: false })
  expect(values).toMatchObject({ isThresholdMin: 0, isThresholdMax: 1, threshold_max: 8 })
  // infinite bounds are "no limit"
  v.threshold_max = Infinity
  expect(thresholdBounds(v).isThresholdMax).toBe(false)
})

test('the scalar orient shader declares and uses the threshold uniforms on calibrated values', () => {
  for (const u of ['isThresholdMin', 'isThresholdMax', 'threshold_min', 'threshold_max']) {
    expect(fragOrientShader).toMatch(new RegExp(`uniform \\w+ ${u};`))
  }
  // compared after scl_slope/scl_inter are applied
  const f = fragOrientShader.indexOf('float f = (scl_slope')
  const thr = fragOrientShader.indexOf('f >= threshold_min')
  expect(f).toBeGreaterThan(0)
  expect(thr).toBeGreaterThan(f)
})

test('setThreshold sets the bounds and recomposites once', async () => {
  const nv = new Niivue()
  vi.spyOn(nv, 'refreshLayers').mockImplementation(() => {})
  vi.spyOn(nv, 'refreshColormaps').mockImplementation(() => null as never)
  vi.spyOn(nv, 'closePAQD').mockImplementation(() => {})
  vi.spyOn(nv, 'drawSceneCore').mockImplementation(() => '')
  const [a, b] = await Promise.all([makeVol('a.nii'), makeVol('b.nii')])
  nv.addVolume(a)
  nv.addVolume(b)
  let n = 0
  nv.onVolumeUpdated = (): void => {
    n++
  }
  nv.setThreshold(b.id, 3)
  expect(b.threshold_min).toBe(3)
  expect(Number.isNaN(b.threshold_max)).toBe(true)
  expect(Number.isNaN(a.threshold_min)).toBe(true)
  nv.setThreshold(b.id, 3, 8)
  expect(b.threshold_max).toBe(8)
  nv.setThreshold(b.id, NaN, NaN)
  expect(thresholdBounds(b).isThresholdMin).toBe(false)
  expect(n).toBe(3)
})

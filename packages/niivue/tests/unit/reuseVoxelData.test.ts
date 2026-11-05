import { expect, test, vi } from 'vitest'
import { Niivue } from '../../src/niivue/index.js' // note the js extension
import { isVoxelTextureCurrent, VoxelTextureCacheEntry } from '../../src/niivue/data/VolumeTexture.js'
import { isSameModulationKey, modulationKey } from '../../src/niivue/data/VolumeModulation.js'
import { setupVolumeTextureData } from '../../src/niivue/data/VolumeLayerRenderer.js'
import { makeVolume } from './helpers/nifti.js'

function makeVol(name: string, datatype: 'int16' | 'float32' = 'float32'): ReturnType<typeof makeVolume> {
  return makeVolume(name, {
    dims: [4, 4, 4],
    datatype,
    srow: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0]
    ],
    value: (i, j, k) => i + j + k
  })
}

// real updateGLVolume, recording the reuseVoxelData flag passed to each refreshLayers call
function makeNiivue(): { nv: Niivue; reuse: () => boolean[] } {
  const nv = new Niivue()
  const refresh = vi.spyOn(nv, 'refreshLayers').mockImplementation(() => {})
  vi.spyOn(nv, 'refreshColormaps').mockImplementation(() => null as never)
  vi.spyOn(nv, 'closePAQD').mockImplementation(() => {})
  vi.spyOn(nv, 'drawSceneCore').mockImplementation(() => '')
  return {
    nv,
    reuse: (): boolean[] => {
      const flags = refresh.mock.calls.map((c) => c[2] === true)
      refresh.mockClear()
      return flags
    }
  }
}

test('updateGLVolume uploads everything by default and reuses voxels only when asked', async () => {
  const { nv, reuse } = makeNiivue()
  const [a, b] = await Promise.all([makeVol('a.nii'), makeVol('b.nii')])
  nv.addVolume(a)
  nv.addVolume(b)
  reuse()
  nv.updateGLVolume()
  expect(reuse()).toEqual([false, false])
  nv.updateGLVolume({ reuseVoxelData: true })
  expect(reuse()).toEqual([true, true])
})

test('display-only setters reuse voxel textures, data changes do not', async () => {
  const { nv, reuse } = makeNiivue()
  const [a, b] = await Promise.all([makeVol('a.nii'), makeVol('b.nii')])
  nv.addVolume(a)
  nv.addVolume(b)
  expect(reuse().every((r) => !r)).toBe(true)
  nv.setOpacity(1, 0.5)
  nv.setColormap(b.id, 'red')
  nv.setColormapNegative(b.id, 'winter')
  nv.setThreshold(b.id, 3)
  nv.setGamma(1.2)
  expect(reuse()).toEqual(Array(10).fill(true))
  nv.setModulationImage(b.id, a.id)
  nv.setFrame4D(b.id, 0)
  expect(reuse().every((r) => !r)).toBe(true)
})

test('batchUpdate reuses voxels only if every batched update allowed it', async () => {
  const { nv, reuse } = makeNiivue()
  const [a, b] = await Promise.all([makeVol('a.nii'), makeVol('b.nii')])
  nv.addVolume(a)
  nv.addVolume(b)
  reuse()
  nv.batchUpdate(() => {
    nv.setOpacity(1, 0.5)
    nv.setThreshold(b.id, 3, 8)
  })
  expect(reuse()).toEqual([true, true])
  nv.batchUpdate(() => {
    nv.setOpacity(1, 0.4)
    nv.updateGLVolume()
  })
  expect(reuse()).toEqual([false, false])
  nv.batchUpdate(() => nv.setOpacity(1, 0.3)) // the flag does not leak into the next batch
  expect(reuse()).toEqual([true, true])
})

test('a cached voxel texture is current only for the same img array, frame and type', async () => {
  const v = await makeVol('a.nii')
  const texture = {} as WebGLTexture
  const entry: VoxelTextureCacheEntry = { voxels: { texture, img: v.img, frame4D: 0, datatypeCode: v.hdr!.datatypeCode, dims: [4, 4, 4] } }
  expect(isVoxelTextureCurrent(entry, v)).toBe(true)
  expect(isVoxelTextureCurrent(undefined, v)).toBe(false)
  expect(isVoxelTextureCurrent({}, v)).toBe(false)
  v.frame4D = 1
  expect(isVoxelTextureCurrent(entry, v)).toBe(false)
  v.frame4D = 0
  v.img = v.img!.slice()
  expect(isVoxelTextureCurrent(entry, v)).toBe(false)
})

test('modulation keys change with the modulating volume display range', async () => {
  const [target, mod] = await Promise.all([makeVol('t.nii'), makeVol('m.nii')])
  const volumes = [target, mod]
  expect(modulationKey(target, target.hdr!, volumes)).toBeNull()
  target.modulationImage = 1
  const k1 = modulationKey(target, target.hdr!, volumes)
  expect(isSameModulationKey(k1, modulationKey(target, target.hdr!, volumes))).toBe(true)
  mod.cal_max = mod.cal_max + 1
  expect(isSameModulationKey(k1, modulationKey(target, target.hdr!, volumes))).toBe(false)
  mod.cal_max = mod.cal_max - 1
  target.modulateAlpha = 2
  expect(isSameModulationKey(k1, modulationKey(target, target.hdr!, volumes))).toBe(false)
  expect(isSameModulationKey(null, null)).toBe(false)
})

test('setupVolumeTextureData without upload selects the same shader and uploads nothing', async () => {
  const calls: string[] = []
  const gl = new Proxy({} as Record<string, unknown>, {
    get: (_t, name: string) => {
      if (name === name.toUpperCase()) {
        return name // GL enums
      }
      return (): void => {
        calls.push(name)
      }
    }
  }) as unknown as WebGL2RenderingContext
  const shaders = { orientShaderU: 'U', orientShaderI: 'I', orientShaderF: 'F', orientShaderRGBU: 'RGB', orientShaderAtlasU: 'AU', orientShaderAtlasI: 'AI' } as never
  for (const dt of ['int16', 'float32'] as const) {
    const v = await makeVol('a.nii', dt)
    const up = setupVolumeTextureData({ gl, hdr: v.hdr, img: v.img, ...(shaders as object) } as never)
    expect(calls).toContain('texSubImage3D')
    calls.length = 0
    const reused = setupVolumeTextureData({ gl, hdr: v.hdr, img: v.img, ...(shaders as object), upload: false } as never)
    expect(reused.orientShader).toBe(up.orientShader)
    expect(calls).toEqual([])
  }
})

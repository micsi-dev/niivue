import { test, expect } from '@playwright/test'
import { Niivue } from '../../dist/index.js'
import { httpServerAddress } from './helpers.js'
import { TEST_OPTIONS } from './test.types.js'

test.beforeEach(async ({ page }) => {
    await page.goto(httpServerAddress)
})

test('niivue updateGLVolume({ reuseVoxelData: true }) does not re-upload voxels for display changes', async ({ page }) => {
    const r = await page.evaluate(async (testOptions) => {
        const nv = new Niivue(testOptions)
        await nv.attachTo('gl')
        nv.setSliceType(nv.sliceTypeMultiplanar)
        nv.opts.multiplanarShowRender = 1 // ALWAYS: a 3D render tile, which needs the gradient
        await nv.loadVolumes([{ url: './images/mni152.nii.gz' }, { url: './images/mni152.nii.gz', colormap: 'red' }, { url: './images/spmMotor.nii.gz', colormap: 'warm', cal_min: 3, cal_max: 8 }])
        nv.updateGLVolume({ reuseVoxelData: true }) // keeps the uploaded overlay voxels
        // the background composite was unchanged above (so it was not redone); recomposite it once
        // so that its voxels are kept too
        nv.volumes[0].cal_max = 75
        nv.updateGLVolume({ reuseVoxelData: true })
        nv.drawScene()
        const gl = nv.gl
        let uploadedBytes = 0
        const texSubImage3D = gl.texSubImage3D.bind(gl)
        gl.texSubImage3D = (...a: unknown[]): void => {
            // voxel and modulation data are single channel or RGB; RGBA uploads are composites/zero-fills
            const data = a[10] as ArrayBufferView | null
            if (a[8] !== gl.RGBA && data && data.byteLength) {
                uploadedBytes += data.byteLength
            }
            ;(texSubImage3D as (...b: unknown[]) => void)(...a)
        }
        let gradients = 0
        const gradientGL = nv.gradientGL.bind(nv)
        nv.gradientGL = (hdr): void => {
            gradients++
            gradientGL(hdr)
        }
        const ov = nv.volumes[1]
        const measure = (fn: () => void): { bytes: number; gradients: number } => {
            uploadedBytes = 0
            gradients = 0
            fn()
            nv.drawScene()
            return { bytes: uploadedBytes, gradients }
        }
        const window = measure(() => {
            ov.cal_min = 50
            ov.cal_max = 70
            nv.updateGLVolume({ reuseVoxelData: true })
        })
        const setters = measure(() => {
            nv.setColormap(ov.id, 'green')
            nv.setOpacity(1, 0.5)
            nv.setThreshold(ov.id, 55, 80)
            nv.setColormapNegative(ov.id, 'winter')
        })
        const batched = measure(() => {
            nv.batchUpdate(() => {
                nv.setOpacity(1, 0.7)
                nv.setThreshold(ov.id, 60)
            })
        })
        const background = measure(() => {
            nv.volumes[0].cal_max = 70
            nv.updateGLVolume({ reuseVoxelData: true }) // background recomposited, voxels reused
        })
        const full = measure(() => nv.updateGLVolume())
        const batchedFull = measure(() => {
            nv.batchUpdate(() => {
                nv.setOpacity(1, 0.6)
                nv.updateGLVolume() // one caller did not declare the voxels unchanged
            })
        })
        // a replaced img array is detected
        const v2 = nv.volumes[2]
        v2.img = v2.img.slice()
        const replaced = measure(() => nv.updateGLVolume({ reuseVoxelData: true }))
        // removing a volume releases its cached textures
        const cache = (nv as unknown as { _voxelTextureCache?: Map<unknown, unknown> })._voxelTextureCache
        const cachedBefore = cache?.size
        nv.removeVolume(v2)
        const cachedAfter = cache?.size
        return { window, setters, batched, background, full, batchedFull, replaced, v2Bytes: v2.img.byteLength, cachedBefore, cachedAfter }
    }, TEST_OPTIONS)
    for (const k of ['window', 'setters', 'batched'] as const) {
        expect(r[k].bytes, k).toBe(0)
        expect(r[k].gradients, k).toBe(0) // background unchanged: its gradient is kept
    }
    expect(r.background.bytes).toBe(0)
    expect(r.background.gradients).toBe(1)
    expect(r.full.bytes).toBeGreaterThanOrEqual(2 * 207 * 256 * 215)
    expect(r.batchedFull.bytes).toBeGreaterThanOrEqual(2 * 207 * 256 * 215)
    expect(r.replaced.bytes).toBeGreaterThanOrEqual(r.v2Bytes)
    expect(r.replaced.bytes).toBeLessThan(207 * 256 * 215)
    expect(r.cachedBefore).toBe(3)
    expect(r.cachedAfter).toBe(2)
})

// reusing cached textures must give exactly the same composites and canvas as uploading again
test('niivue reuseVoxelData composites the same as a full update', async ({ page }) => {
    const r = await page.evaluate(async (testOptions) => {
        const nv = new Niivue({ ...testOptions, isAntiAlias: false })
        await nv.attachTo('gl')
        nv.setSliceType(nv.sliceTypeMultiplanar)
        nv.opts.multiplanarShowRender = 1
        await nv.loadVolumes([{ url: './images/mni152.nii.gz' }, { url: './images/mni152.nii.gz', colormap: 'red' }, { url: './images/mni152.nii.gz', colormap: 'green', opacity: 0.5 }])
        await nv.setVolumeRenderIllumination(0.6)
        // volume 2 modulated by volume 1: its modulation texture is cached too
        nv.setModulationImage(nv.volumes[2].id, nv.volumes[1].id)
        const gl = nv.gl
        const dims = nv.back.dims
        const readTex = (tex: WebGLTexture, z: number): Uint8Array => {
            const fb = gl.createFramebuffer()
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z)
            const px = new Uint8Array(dims[1] * dims[2] * 4)
            gl.readPixels(0, 0, dims[1], dims[2], gl.RGBA, gl.UNSIGNED_BYTE, px)
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.deleteFramebuffer(fb)
            return px
        }
        const snapshot = (): Uint8Array[] => {
            nv.drawScene()
            const canvas = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
            const zs = [Math.floor(dims[3] / 3), Math.floor(dims[3] / 2)]
            return [canvas, ...zs.map((z) => readTex(nv.volumeTexture, z)), ...zs.map((z) => readTex(nv.overlayTexture, z))]
        }
        const nDiff = (a: Uint8Array[], b: Uint8Array[]): number => {
            let n = 0
            for (let i = 0; i < a.length; i++) {
                for (let j = 0; j < a[i].length; j++) {
                    if (a[i][j] !== b[i][j]) {
                        n++
                    }
                }
            }
            return n
        }
        const changes: Array<[string, () => void]> = [
            [
                'overlay window',
                (): void => {
                    nv.volumes[1].cal_min = 45
                    nv.volumes[1].cal_max = 75
                }
            ],
            [
                'overlay threshold',
                (): void => {
                    nv.volumes[1].threshold_min = 55
                }
            ],
            [
                'overlay colormap',
                (): void => {
                    nv.volumes[1].colormap = 'blue'
                }
            ],
            [
                'overlay opacity',
                (): void => {
                    nv.volumes[2].opacity = 0.8
                }
            ],
            [
                'modulating window',
                (): void => {
                    nv.volumes[1].cal_max = 60
                }
            ],
            [
                'background window',
                (): void => {
                    nv.volumes[0].cal_min = 30
                }
            ],
            [
                'background threshold',
                (): void => {
                    nv.volumes[0].threshold_max = 70
                }
            ],
            [
                'background colormap',
                (): void => {
                    nv.volumes[0].colormap = 'hot'
                }
            ],
            ['nothing', (): void => {}]
        ]
        nv.updateGLVolume({ reuseVoxelData: true })
        const result: Record<string, { diff: number; changed: number }> = {}
        for (const [name, change] of changes) {
            const before = snapshot()
            change()
            nv.updateGLVolume({ reuseVoxelData: true })
            const reused = snapshot()
            nv.updateGLVolume()
            const uploaded = snapshot()
            nv.updateGLVolume({ reuseVoxelData: true }) // back to cached textures for the next change
            result[name] = { diff: nDiff(reused, uploaded), changed: nDiff(before, uploaded) }
        }
        return result
    }, TEST_OPTIONS)
    for (const [name, { diff, changed }] of Object.entries(r)) {
        expect(diff, name).toBe(0)
        if (name !== 'nothing') {
            expect(changed, name).toBeGreaterThan(0)
        }
    }
})

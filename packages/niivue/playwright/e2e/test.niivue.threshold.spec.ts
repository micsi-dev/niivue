import { test, expect } from '@playwright/test'
import { Niivue } from '../../dist/index.js'
import { httpServerAddress } from './helpers.js'
import { TEST_OPTIONS } from './test.types.js'

test.beforeEach(async ({ page }) => {
    await page.goto(httpServerAddress)
})

// For one axial slice of the composited texture (background or overlay), every voxel must be
// visible exactly when it was visible without a threshold and its calibrated value is in range.
test('niivue threshold_min/threshold_max hide voxels outside the calibrated range on the GPU', async ({ page }) => {
    const result = await page.evaluate(async (testOptions) => {
        const nv = new Niivue(testOptions)
        await nv.attachTo('gl')
        nv.setSliceType(nv.sliceTypeAxial)
        await nv.loadVolumes([{ url: './images/mni152.nii.gz' }, { url: './images/mni152.nii.gz', colormap: 'red' }])
        const overlay = nv.volumes[1]
        // calibrated = 2 * raw - 5: thresholds must be compared after scl_slope/scl_inter
        overlay.hdr.scl_slope = 2
        overlay.hdr.scl_inter = -5
        overlay.cal_min = -5
        overlay.cal_max = 400
        nv.updateGLVolume()
        const gl = nv.gl
        const dims = nv.back.dims
        const z = Math.floor(dims[3] / 2)
        const readAlpha = (tex: WebGLTexture): Uint8Array => {
            const fb = gl.createFramebuffer()
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z)
            const px = new Uint8Array(dims[1] * dims[2] * 4)
            gl.readPixels(0, 0, dims[1], dims[2], gl.RGBA, gl.UNSIGNED_BYTE, px)
            gl.bindFramebuffer(gl.FRAMEBUFFER, null)
            gl.deleteFramebuffer(fb)
            const a = new Uint8Array(dims[1] * dims[2])
            for (let i = 0; i < a.length; i++) {
                a[i] = px[i * 4 + 3]
            }
            return a
        }
        const check = (before: Uint8Array, after: Uint8Array, vol: typeof overlay, lo: number, hi: number): { mismatches: number; shown: number; hidden: number } => {
            let mismatches = 0
            let shown = 0
            let hidden = 0
            for (let y = 0; y < dims[2]; y++) {
                for (let x = 0; x < dims[1]; x++) {
                    const i = x + y * dims[1]
                    const f = vol.getValue(x, y, z)
                    const inRange = !(f < lo) && !(f > hi)
                    const expected = before[i] > 0 && inRange
                    if (expected !== after[i] > 0) {
                        mismatches++
                    }
                    if (after[i] > 0) {
                        shown++
                    } else if (before[i] > 0) {
                        hidden++
                    }
                }
            }
            return { mismatches, shown, hidden }
        }
        const overlay0 = readAlpha(nv.overlayTexture)
        // lower bound only (inclusive; 101 is an exact calibrated value)
        nv.setThreshold(overlay.id, 101)
        const lowerOnly = check(overlay0, readAlpha(nv.overlayTexture), overlay, 101, Infinity)
        // lower and upper bound
        nv.setThreshold(overlay.id, 101, 250)
        const both = check(overlay0, readAlpha(nv.overlayTexture), overlay, 101, 250)
        // properties set directly behave the same
        overlay.threshold_min = NaN
        overlay.threshold_max = 150
        nv.updateGLVolume()
        const upperOnly = check(overlay0, readAlpha(nv.overlayTexture), overlay, -Infinity, 150)
        // clearing restores the unthresholded texture
        nv.setThreshold(overlay.id, NaN, NaN)
        const cleared = readAlpha(nv.overlayTexture)
        let clearedDiff = 0
        for (let i = 0; i < cleared.length; i++) {
            if (cleared[i] !== overlay0[i]) {
                clearedDiff++
            }
        }
        // the background (layer 0) honours its own threshold
        const back0 = readAlpha(nv.volumeTexture)
        nv.setThreshold(nv.volumes[0].id, 50, 70)
        const background = check(back0, readAlpha(nv.volumeTexture), nv.volumes[0], 50, 70)
        return { lowerOnly, both, upperOnly, clearedDiff, background }
    }, TEST_OPTIONS)
    for (const r of [result.lowerOnly, result.both, result.upperOnly, result.background]) {
        expect(r.mismatches).toBe(0)
        expect(r.shown).toBeGreaterThan(100)
        expect(r.hidden).toBeGreaterThan(100)
    }
    expect(result.clearedDiff).toBe(0)
})

test('niivue threshold also applies to the 3D render', async ({ page }) => {
    const nDiff = await page.evaluate(async (testOptions) => {
        const nv = new Niivue({ ...testOptions, isAntiAlias: false })
        await nv.attachTo('gl')
        nv.setSliceType(nv.sliceTypeRender)
        await nv.loadVolumes([{ url: './images/mni152.nii.gz' }, { url: './images/mni152.nii.gz', colormap: 'red' }])
        nv.drawScene()
        const gl = nv.gl
        const read = (): Uint8Array => {
            const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px)
            return px
        }
        const before = read()
        nv.setThreshold(nv.volumes[1].id, 1e9) // hides the whole overlay
        nv.drawScene()
        const hidden = read()
        nv.setThreshold(nv.volumes[1].id, NaN, NaN)
        nv.drawScene()
        const restored = read()
        let changed = 0
        let notRestored = 0
        for (let i = 0; i < before.length; i++) {
            if (before[i] !== hidden[i]) {
                changed++
            }
            if (before[i] !== restored[i]) {
                notRestored++
            }
        }
        return { changed, notRestored }
    }, TEST_OPTIONS)
    expect(nDiff.changed).toBeGreaterThan(1000)
    expect(nDiff.notRestored).toBe(0)
})

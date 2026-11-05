import { test, expect } from '@playwright/test'
import { Niivue } from '../../dist/index.js'
import { httpServerAddress } from './helpers.js'
import { TEST_OPTIONS } from './test.types.js'

test.beforeEach(async ({ page }) => {
    await page.goto(httpServerAddress)
})

test('niivue gradient texture is only computed when a 3D render is drawn', async ({ page }) => {
    const counts = await page.evaluate(async (testOptions) => {
        const nv = new Niivue(testOptions)
        await nv.attachTo('gl')
        let n = 0
        const orig = nv.gradientGL.bind(nv)
        nv.gradientGL = (hdr): void => {
            n++
            orig(hdr)
        }
        nv.setSliceType(nv.sliceTypeAxial)
        await nv.loadVolumes([{ url: './images/mni152.nii.gz' }])
        nv.volumes[0].cal_max = 90
        nv.updateGLVolume()
        nv.drawScene()
        const after2D = n
        nv.setSliceType(nv.sliceTypeRender)
        const afterRender = n
        nv.drawScene()
        nv.setRenderAzimuthElevation(30, 20)
        const afterRedraws = n
        nv.volumes[0].cal_max = 80
        nv.updateGLVolume() // background changed: recomputed on the next render draw
        const afterChange = n
        nv.setSliceType(nv.sliceTypeMultiplanar)
        nv.opts.multiplanarShowRender = 0 // SHOW_RENDER.NEVER
        nv.volumes[0].cal_max = 70
        nv.updateGLVolume()
        nv.drawScene()
        const afterMultiplanarNoRender = n
        return { after2D, afterRender, afterRedraws, afterChange, afterMultiplanarNoRender }
    }, TEST_OPTIONS)
    expect(counts.after2D).toBe(0)
    expect(counts.afterRender).toBe(1)
    expect(counts.afterRedraws).toBe(1)
    expect(counts.afterChange).toBe(2)
    expect(counts.afterMultiplanarNoRender).toBe(2)
})

test('niivue lazily computed gradient renders the same as an eager one', async ({ page }) => {
    const same = await page.evaluate(async (testOptions) => {
        const nv = new Niivue({ ...testOptions, isAntiAlias: false })
        await nv.attachTo('gl')
        nv.setSliceType(nv.sliceTypeRender)
        await nv.loadVolumes([{ url: './images/mni152.nii.gz', cal_min: 30, cal_max: 80 }])
        await nv.setVolumeRenderIllumination(0.6)
        nv.setRenderAzimuthElevation(110, 15)
        nv.drawScene()
        const gl = nv.gl
        const read = (): Uint8Array => {
            const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
            gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px)
            return px
        }
        const lazy = read()
        // force an eager recompute from the same background and redraw
        nv.gradientGL(nv.back.hdr)
        nv.drawScene()
        const eager = read()
        let nDiff = 0
        let nonBlack = 0
        for (let i = 0; i < lazy.length; i++) {
            if (lazy[i] !== eager[i]) {
                nDiff++
            }
            if (i % 4 !== 3 && lazy[i] > 0) {
                nonBlack++
            }
        }
        return { nDiff, nonBlack }
    }, TEST_OPTIONS)
    expect(same.nonBlack).toBeGreaterThan(1000)
    expect(same.nDiff).toBe(0)
})

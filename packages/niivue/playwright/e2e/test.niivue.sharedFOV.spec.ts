import { test, expect } from '@playwright/test'
import { Niivue } from '../../dist/index.js'
import { httpServerAddressSync } from './helpers.js'
import { TEST_OPTIONS } from './test.types.js'

test.beforeEach(async ({ page }) => {
    await page.goto(httpServerAddressSync)
})

// two canvases with volumes that have different fields of view
async function slicesFor(page, sharedFOV: boolean): Promise<{ a: number[][]; b: number[][] }> {
    return page.evaluate(
        async ({ testOptions, sharedFOV }) => {
            const nv1 = new Niivue(testOptions)
            await nv1.attachTo('gl1')
            const nv2 = new Niivue(testOptions)
            await nv2.attachTo('gl2')
            await nv1.loadVolumes([{ url: './images/mni152.nii.gz' }])
            await nv2.loadVolumes([{ url: './images/hippo.nii.gz' }])
            for (const nv of [nv1, nv2]) {
                nv.setSliceType(nv.sliceTypeAxial)
            }
            const opts = { '2d': true, sharedFOV }
            nv1.broadcastTo(nv2, opts)
            nv2.broadcastTo(nv1, opts)
            nv1.drawScene()
            nv2.drawScene()
            const tile = (nv): number[][] => [Array.from(nv.screenSlices[0].leftTopMM), Array.from(nv.screenSlices[0].fovMM), Array.from(nv.screenSlices[0].leftTopWidthHeight)]
            return { a: tile(nv1), b: tile(nv2) }
        },
        { testOptions: TEST_OPTIONS, sharedFOV }
    )
}

test('niivue broadcastTo without sharedFOV: each view fits its own volume', async ({ page }) => {
    const { a, b } = await slicesFor(page, false)
    expect(a[0]).not.toEqual(b[0])
})

test('niivue broadcastTo sharedFOV: linked views show the same world region at the same scale', async ({ page }) => {
    const { a, b } = await slicesFor(page, true)
    expect(a[2]).toEqual(b[2]) // same tile on screen
    for (let i = 0; i < 2; i++) {
        expect(a[0][i]).toBeCloseTo(b[0][i], 4) // same left/top in mm
        expect(a[1][i]).toBeCloseTo(b[1][i], 4) // same width/height in mm
    }
})

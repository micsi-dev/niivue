import { expect, test, vi, beforeAll } from 'vitest'
import { Niivue } from '../../src/niivue/index.js' // note the js extension

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

// @vitest-environment node
// (Node provides File with arrayBuffer(); the jsdom File does not)
import { beforeEach, describe, expect, test, vi } from 'vitest'

// Stand-in for @niivue/dcm2niix: one fake Worker per Dcm2niix instance
const state = vi.hoisted(() => ({
  instances: [] as Array<{ worker: { terminate: ReturnType<typeof vi.fn> } | null }>,
  runResult: null as null | (() => Promise<File[]>),
  initError: null as null | Error
}))

vi.mock('@niivue/dcm2niix', () => {
  class Dcm2niix {
    worker: { terminate: ReturnType<typeof vi.fn> } | null = null
    constructor() {
      state.instances.push(this)
    }

    async init(): Promise<void> {
      this.worker = { terminate: vi.fn() }
      if (state.initError) {
        throw state.initError
      }
    }

    input(_files: File[]): { run: () => Promise<File[]> } {
      return { run: () => state.runResult!() }
    }
  }
  return { Dcm2niix }
})

const { dicomLoader } = await import('../src/index')

describe('dicomLoader worker lifecycle', () => {
  beforeEach(() => {
    state.instances.length = 0
    state.initError = null
    state.runResult = async () => [new File([new Uint8Array([1, 2, 3])], 'out.nii'), new File(['{}'], 'out.json')]
  })

  test('returns the converted NIfTI files (API unchanged)', async () => {
    const out = await dicomLoader([{ name: 'a.dcm', data: new ArrayBuffer(4) }])
    expect(out.map((f) => f.name)).toEqual(['out.nii'])
    expect(new Uint8Array(out[0].data)).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('terminates the worker after each conversion', async () => {
    await dicomLoader([{ name: 'a.dcm', data: new ArrayBuffer(4) }])
    await dicomLoader([new File([new Uint8Array(4)], 'b.dcm'), new File([new Uint8Array(4)], 'c.dcm')])
    expect(state.instances).toHaveLength(2)
    for (const inst of state.instances) {
      expect(inst.worker!.terminate).toHaveBeenCalledTimes(1)
    }
  })

  test('terminates the worker when the conversion fails', async () => {
    state.runResult = async () => {
      throw new Error('dcm2niix processing failed with exit code 2')
    }
    await expect(dicomLoader([{ name: 'a.dcm', data: new ArrayBuffer(4) }])).rejects.toThrow('exit code 2')
    expect(state.instances[0].worker!.terminate).toHaveBeenCalledTimes(1)
  })

  test('terminates the worker when init fails', async () => {
    state.initError = new Error('Worker failed to load')
    await expect(dicomLoader([{ name: 'a.dcm', data: new ArrayBuffer(4) }])).rejects.toThrow('Worker failed to load')
    expect(state.instances[0].worker!.terminate).toHaveBeenCalledTimes(1)
  })
})

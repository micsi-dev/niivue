import { NVImage } from '../../../src/niivue/index.js'

export type SyntheticNiftiOptions = {
  dims: [number, number, number]
  // srow_x, srow_y, srow_z (voxel -> mm, sform)
  srow: [number[], number[], number[]]
  datatype?: 'int16' | 'float32'
  sclSlope?: number
  sclInter?: number
  // raw (stored) value for stored voxel (i, j, k)
  value: (i: number, j: number, k: number) => number
}

/** Build a minimal single-file NIfTI-1 (.nii) in memory. */
export function makeNifti(opts: SyntheticNiftiOptions): ArrayBuffer {
  const [nx, ny, nz] = opts.dims
  const isInt16 = opts.datatype === 'int16'
  const bpv = isInt16 ? 2 : 4
  const nvox = nx * ny * nz
  const buf = new ArrayBuffer(352 + nvox * bpv)
  const v = new DataView(buf)
  const le = true
  v.setInt32(0, 348, le)
  const dim = [3, nx, ny, nz, 1, 1, 1, 1]
  dim.forEach((d, i) => v.setInt16(40 + 2 * i, d, le))
  v.setInt16(70, isInt16 ? 4 : 16, le) // datatype
  v.setInt16(72, bpv * 8, le) // bitpix
  const pixdim = [1, Math.hypot(...opts.srow.map((r) => r[0])), Math.hypot(...opts.srow.map((r) => r[1])), Math.hypot(...opts.srow.map((r) => r[2])), 1, 1, 1, 1]
  pixdim.forEach((d, i) => v.setFloat32(76 + 4 * i, d, le))
  v.setFloat32(108, 352, le) // vox_offset
  v.setFloat32(112, opts.sclSlope ?? 1, le)
  v.setFloat32(116, opts.sclInter ?? 0, le)
  v.setInt16(252, 0, le) // qform_code
  v.setInt16(254, 1, le) // sform_code
  opts.srow.forEach((row, r) => row.forEach((x, c) => v.setFloat32(280 + 16 * r + 4 * c, x, le)))
  ;[0x6e, 0x2b, 0x31, 0].forEach((c, i) => v.setUint8(344 + i, c)) // "n+1\0"
  let o = 352
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const raw = opts.value(i, j, k)
        if (isInt16) {
          v.setInt16(o, raw, le)
        } else {
          v.setFloat32(o, raw, le)
        }
        o += bpv
      }
    }
  }
  return buf
}

export async function makeVolume(name: string, opts: SyntheticNiftiOptions): Promise<NVImage> {
  return NVImage.new(makeNifti(opts), name)
}
